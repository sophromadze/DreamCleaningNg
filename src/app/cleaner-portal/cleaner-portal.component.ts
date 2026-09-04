import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import {
  CleanerPortalService,
  CleanerPortalContext,
  CleanerPortalJob,
  CleanerPortalAdminJob,
  CleanerPortalOrderDetail
} from '../services/cleaner-portal.service';
import { formatTime12h } from '../shared/booking/extra-service-display.utils';
import { extractApiErrorMessage } from '../utils/http-error.utils';
import {
  PortalLanguage,
  PortalStrings,
  PORTAL_LANGUAGES,
  PORTAL_LANGUAGE_NAMES,
  PORTAL_LANGUAGE_SHORT_NAMES,
  PORTAL_LOCALES,
  formatPortalDuration,
  formatServiceLine,
  plural,
  portalStrings,
  resolvePortalLanguage
} from './cleaner-portal.i18n';

/** A dot under a day. Two states only: work still to do, and work already done. */
export type CleanerCalendarDot = 'active' | 'done';

/**
 * One square of the cleaner's month calendar. The dots are what put the month to work: a day with
 * cleanings says so before anything is clicked, and says whether they are still ahead.
 */
export interface CleanerCalendarCell {
  /** "yyyy-MM-dd" - the same key a NY wall-clock serviceDate reduces to. */
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  jobCount: number;
  /** At most three, so a busy day cannot widen the square. */
  dots: CleanerCalendarDot[];
}

/**
 * THE CLEANER PORTAL - one read-only section, two audiences.
 *
 *   Cleaner    - their month: the jobs they are staffed on and the ones they have finished, with a
 *                briefing on any job still ahead. Rendered in THEIR language.
 *   SuperAdmin - every cleaning in the system, past, current and future, for every cleaner, with
 *                a fuller read-only panel on any one of them.
 *
 * NO ORDER DATA IS WRITTEN HERE. There is no status control, no edit form and no action button
 * that changes a cleaning, because the service behind it exposes no such call. The one write in
 * the whole section is the language preference, which belongs to the person reading the page.
 *
 * Which mode to render, AND which language, are both answered by the SERVER (GET context) rather
 * than read off the JWT: the cleaner link and the language both live in the database and an admin
 * can change either at any moment, so a token minted earlier is not evidence of either.
 */
@Component({
  selector: 'app-cleaner-portal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cleaner-portal.component.html',
  styleUrls: ['./cleaner-portal.component.scss']
})
export class CleanerPortalComponent implements OnInit, OnDestroy {
  /**
   * Rendered INSIDE another page (the Cleaners section's Portal tab) rather than as a route of its
   * own. It drops this component's page padding and its own title, because the host already
   * provides both — nothing about WHICH view is rendered depends on it. That stays the server's
   * answer, so the tab cannot claim a mode the API will not serve.
   */
  @Input() embedded = false;

  context: CleanerPortalContext | null = null;

  // Cleaner view
  currentJobs: CleanerPortalJob[] = [];
  pastJobs: CleanerPortalJob[] = [];

  // ── Language ────────────────────────────────────────────────────────────────────────────
  //
  // `language` is what is RENDERED and always resolves to something; `preferredLanguage` is the
  // cleaner's explicit choice and is null while they are following their nationality. The two are
  // separate on purpose - collapsing them would turn "Automatic" into a pinned language the first
  // time anybody saved, and a corrected nationality would then never reach them.
  language: PortalLanguage = 'en';
  preferredLanguage: string | null = null;
  savingLanguage = false;
  // Both forms of every option, so the narrow picker on a phone is the SAME list abbreviated
  // rather than a second list free to drift from this one.
  readonly languageOptions = PORTAL_LANGUAGES.map(code => ({
    code,
    name: PORTAL_LANGUAGE_NAMES[code],
    short: PORTAL_LANGUAGE_SHORT_NAMES[code]
  }));

  // Cleaner + SuperAdmin - the month calendar and the day it is showing.
  //
  // The calendar is BUILT, never derived in a template getter: rebuilding 42 cells on every change
  // detection pass would churn the *ngFor and is the shape that produces NG0100 the moment anyone
  // adds a write to it.
  calendarCells: CleanerCalendarCell[] = [];
  calendarMonthLabel = '';
  /** "yyyy-MM-dd" of the day whose jobs are listed. Defaults to today in New York. */
  selectedDateKey = '';
  /** The job whose briefing fills the side card. Never a completed one - see selectJob. */
  selectedJob: CleanerPortalJob | null = null;

  // SuperAdmin view.
  //
  // Two MODES, and the distinction is the whole design: with the search box empty the page is the
  // same month calendar the cleaner gets, fetched a month at a time; with a term typed it is a
  // flat list of every match across all time. A search scoped to whichever month happened to be on
  // screen would be worse than the table it replaced - an admin looking somebody up does not know
  // which month to be standing in.
  allJobs: CleanerPortalAdminJob[] = [];
  searchTerm = '';
  selectedAdminJob: CleanerPortalAdminJob | null = null;

  // Detail panel (SuperAdmin only)
  selectedDetail: CleanerPortalOrderDetail | null = null;
  detailLoading = false;
  detailError = '';

  loading = true;
  errorMessage = '';

  private calendarYear = 0;
  /** 0-based, as JS months are. */
  private calendarMonthIndex = 0;
  private todayKey = '';
  /** 'morning' | 'afternoon' | 'evening', resolved once so it cannot drift mid-session. */
  private timeOfDay: 'morning' | 'afternoon' | 'evening' = 'morning';

  // One index per view rather than one of a union type: the SuperAdmin's rows carry a status and
  // a cleaner list the cleaner's rows do not, and widening them into a shared type is how a
  // template ends up reading a field that is only sometimes there.
  private jobsByDate = new Map<string, CleanerPortalJob[]>();
  private adminJobsByDate = new Map<string, CleanerPortalAdminJob[]>();
  /** Shared empty arrays so an empty day hands the template the SAME reference every pass. */
  private readonly noJobs: CleanerPortalJob[] = [];
  private readonly noAdminJobs: CleanerPortalAdminJob[] = [];

  /** Debounced so a typed search costs one request, not one per keystroke. */
  private readonly searchInput$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  constructor(private portal: CleanerPortalService) {}

  ngOnInit(): void {
    this.searchInput$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => this.loadAllJobs());

    this.todayKey = this.nyTodayKey();
    this.selectedDateKey = this.todayKey;
    this.timeOfDay = this.resolveTimeOfDay();
    const [ty, tm] = this.todayKey.split('-').map(n => parseInt(n, 10));
    this.calendarYear = ty;
    this.calendarMonthIndex = tm - 1;
    this.buildCalendar();

    this.loadContext();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Language ────────────────────────────────────────────────────────────────────────────

  /** Every visible string on the page. Swapping this swaps the page. */
  get t(): PortalStrings {
    return portalStrings(this.language);
  }

  get locale(): string {
    return PORTAL_LOCALES[this.language];
  }

  /**
   * The name in the greeting is the cleaner's FIRST name only (owner's call, 2026-09).
   * "Hello, Nika!" is how somebody is greeted; "Hello, Nika Sophromadze!" reads like a letter from
   * an institution, on the one page in the app that is addressed to them personally.
   * `cleanerName` itself stays the FULL name - it is the record's name, and the admin side of this
   * component and the detail panel both want all of it.
   */
  get greetingName(): string {
    return (this.context?.cleanerName || '').trim().split(/\s+/)[0] || '';
  }

  get greeting(): string {
    if (this.timeOfDay === 'morning') return this.t.greetingMorning;
    if (this.timeOfDay === 'afternoon') return this.t.greetingAfternoon;
    return this.t.greetingEvening;
  }

  /**
   * The picker's value: '' for Automatic, a code otherwise. Bound to preferredLanguage rather than
   * to the rendered language, so somebody following their nationality sees "Automatic" and not the
   * language that happens to have resolved from it.
   */
  get languageChoice(): string {
    return this.preferredLanguage || '';
  }

  onLanguageChange(value: string): void {
    const choice = value ? value : null;

    // Applied optimistically: the page is already translated client-side, so waiting on the round
    // trip would leave somebody staring at a language they just said they could not read.
    this.preferredLanguage = choice;
    if (choice) this.language = resolvePortalLanguage(choice);

    this.savingLanguage = true;
    this.portal.setLanguage(choice).subscribe({
      next: result => {
        // The server has the last word on the fallback: clearing to Automatic resolves back
        // through the nationality, which only it knows.
        this.language = resolvePortalLanguage(result.language);
        this.preferredLanguage = result.preferredLanguage ?? null;
        this.savingLanguage = false;
      },
      error: err => {
        this.errorMessage = extractApiErrorMessage(err, this.t.loadError);
        this.savingLanguage = false;
      }
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────────────────────

  private loadContext(): void {
    this.loading = true;
    this.portal.getContext().subscribe({
      next: ctx => {
        this.context = ctx;
        this.language = resolvePortalLanguage(ctx.language);
        this.preferredLanguage = ctx.preferredLanguage ?? null;

        if (ctx.isCleanerView) {
          this.loadMyJobs();
        } else if (ctx.isSystemWideView) {
          this.loadAllJobs();
        } else {
          this.loading = false;
        }
      },
      error: err => {
        this.errorMessage = extractApiErrorMessage(err, this.t.loadError);
        this.loading = false;
      }
    });
  }

  private loadMyJobs(): void {
    this.loading = true;
    this.portal.getMyJobs().subscribe({
      next: jobs => {
        this.currentJobs = jobs.current || [];
        this.pastJobs = jobs.past || [];
        this.indexJobsByDate();
        this.loading = false;
      },
      error: err => {
        this.errorMessage = extractApiErrorMessage(err, this.t.loadError);
        this.loading = false;
      }
    });
  }

  /**
   * Month mode asks for the visible month and nothing else, so paging back through a year costs
   * twelve small requests rather than one that returns every cleaning the company has ever done.
   * Search mode drops the bounds entirely - that is the point of it.
   */
  loadAllJobs(): void {
    this.loading = true;
    const searching = this.isSearchMode;

    this.portal
      .getAllJobs(
        searching ? null : this.monthStartKey(),
        searching ? null : this.monthEndKey(),
        searching ? this.searchTerm.trim() : null
      )
      .subscribe({
        next: jobs => {
          this.allJobs = jobs || [];
          this.indexAdminJobsByDate();
          this.loading = false;
        },
        error: err => {
          this.errorMessage = extractApiErrorMessage(err, this.t.loadError);
          this.loading = false;
        }
      });
  }

  /** A typed term switches the page to the search list; an empty one puts the month back. */
  get isSearchMode(): boolean {
    return this.searchTerm.trim().length > 0;
  }

  onSearchChanged(value: string): void {
    this.searchTerm = value;
    this.searchInput$.next(value);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.loadAllJobs();
  }

  /**
   * SuperAdmin only. The cleaner view has no detail panel at all - a cleaner already sees
   * everything they are entitled to on the page itself, so there is nothing to open into.
   */
  openDetail(orderId: number): void {
    if (!this.context?.isSystemWideView) return;

    this.detailLoading = true;
    this.detailError = '';
    this.selectedDetail = null;

    this.portal.getOrderDetail(orderId).subscribe({
      next: detail => {
        this.selectedDetail = detail;
        this.detailLoading = false;
      },
      error: err => {
        this.detailError = extractApiErrorMessage(err, 'Could not load that order.');
        this.detailLoading = false;
      }
    });
  }

  closeDetail(): void {
    this.selectedDetail = null;
    this.detailError = '';
  }

  // ── The month calendar ──────────────────────────────────────────────────────────────────

  /**
   * A NY wall-clock serviceDate reduces to its date part and nothing else. Handing the whole ISO
   * string to Date() would apply the viewer's offset and file a job under the previous day for
   * anybody west of New York - the same rule formatDate() below follows.
   */
  private dateKeyOf(value: string | Date | null | undefined): string {
    if (!value) return '';
    const iso = typeof value === 'string' ? value : value.toISOString();
    return iso.split('T')[0];
  }

  /** Today in NEW YORK, not in the browser - the business day is the one the schedule is about. */
  private nyTodayKey(): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private resolveTimeOfDay(): 'morning' | 'afternoon' | 'evening' {
    const hour = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false
    }).format(new Date()), 10);
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

  private keyOfDate(date: Date): string {
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
  }

  /** Files jobs under their NY service date, each day read top to bottom in working order. */
  private groupByDate<T extends { serviceDate: string; serviceTime: string }>(jobs: T[]): Map<string, T[]> {
    const byDate = new Map<string, T[]>();
    for (const job of jobs) {
      const key = this.dateKeyOf(job.serviceDate);
      if (!key) continue;
      const bucket = byDate.get(key);
      if (bucket) bucket.push(job);
      else byDate.set(key, [job]);
    }
    byDate.forEach(list => list.sort((a, b) => (a.serviceTime || '').localeCompare(b.serviceTime || '')));
    return byDate;
  }

  /**
   * Current AND completed jobs share one index, so the month reads as a whole - a cleaner looking
   * back at last week sees what they worked, not an empty grid. What separates them is the dot and
   * whether the card opens: a finished job is a record, not a briefing.
   */
  private indexJobsByDate(): void {
    this.jobsByDate = this.groupByDate([...this.currentJobs, ...this.pastJobs]);
    this.buildCalendar();
    this.selectedJob = this.firstOpenableJob(this.selectedDayJobs);
  }

  private indexAdminJobsByDate(): void {
    // In search mode there is no month on screen to put dots on, and indexing the results would
    // leave a calendar describing a set the page is not showing.
    this.adminJobsByDate = this.isSearchMode
      ? new Map<string, CleanerPortalAdminJob[]>()
      : this.groupByDate(this.allJobs);

    this.buildCalendar();
    this.selectAdminJob(this.selectedDayAdminJobs[0] ?? null, false);
  }

  private buildCalendar(): void {
    const first = new Date(this.calendarYear, this.calendarMonthIndex, 1);
    // Back up to the Sunday on or before the 1st, so every month starts on the same column.
    const start = new Date(this.calendarYear, this.calendarMonthIndex, 1 - first.getDay());

    const cells: CleanerCalendarCell[] = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = this.keyOfDate(day);
      const jobs: { isCompleted: boolean }[] = [
        ...(this.jobsByDate.get(key) ?? []),
        ...(this.adminJobsByDate.get(key) ?? [])
      ];

      cells.push({
        key,
        day: day.getDate(),
        inMonth: day.getMonth() === this.calendarMonthIndex && day.getFullYear() === this.calendarYear,
        isToday: key === this.todayKey,
        jobCount: jobs.length,
        dots: this.buildDots(jobs)
      });
    }
    // Drop a trailing week that belongs entirely to the next month rather than always paying for
    // six rows of height.
    if (cells.slice(35).every(cell => !cell.inMonth)) cells.length = 35;

    this.calendarCells = cells;
    this.calendarMonthLabel = first.toLocaleDateString(this.locale, { month: 'long', year: 'numeric' });
  }

  /**
   * The dots under a day: DONE ON THE LEFT, still-to-do on the RIGHT, so a month scanned left to
   * right reads as work finished then work remaining rather than as the order the jobs happen to
   * be booked in.
   *
   * Capped at three, past which they stop being countable and the square would start to grow. The
   * cap keeps at least one of EACH kind whenever both are present: dropping the red ones off a
   * busy day would say the day was finished when it is not, which is the one thing this mark
   * exists to answer.
   */
  private buildDots(jobs: { isCompleted: boolean }[]): CleanerCalendarDot[] {
    const done = jobs.filter(j => j.isCompleted).length;
    const active = jobs.length - done;

    const doneShown = Math.min(done, active > 0 ? 2 : 3);
    const activeShown = Math.min(active, 3 - doneShown);

    return [
      ...Array<CleanerCalendarDot>(doneShown).fill('done'),
      ...Array<CleanerCalendarDot>(activeShown).fill('active')
    ];
  }

  previousMonth(): void {
    this.calendarMonthIndex -= 1;
    if (this.calendarMonthIndex < 0) {
      this.calendarMonthIndex = 11;
      this.calendarYear -= 1;
    }
    this.onMonthChanged();
  }

  nextMonth(): void {
    this.calendarMonthIndex += 1;
    if (this.calendarMonthIndex > 11) {
      this.calendarMonthIndex = 0;
      this.calendarYear += 1;
    }
    this.onMonthChanged();
  }

  goToToday(): void {
    const [y, m] = this.todayKey.split('-').map(n => parseInt(n, 10));
    this.calendarYear = y;
    this.calendarMonthIndex = m - 1;
    this.onMonthChanged();
    this.selectDay(this.todayKey);
  }

  /** Clicking a leading/trailing square moves the month with it, rather than doing nothing. */
  selectDay(key: string): void {
    if (!key) return;
    const [y, m] = key.split('-').map(n => parseInt(n, 10));
    if (y !== this.calendarYear || m - 1 !== this.calendarMonthIndex) {
      this.calendarYear = y;
      this.calendarMonthIndex = m - 1;
      this.onMonthChanged();
    }
    this.selectedDateKey = key;

    // One view owns the selection at a time. Running both would have the SuperAdmin branch clear
    // the cleaner's freshly-chosen job to null, since the admin index is empty in that mode.
    if (this.context?.isSystemWideView) {
      this.selectAdminJob(this.selectedDayAdminJobs[0] ?? null, false);
    } else {
      this.selectedJob = this.firstOpenableJob(this.selectedDayJobs);
    }
  }

  /**
   * A COMPLETED job has no briefing. The card stays in the list - the cleaner worked it and the
   * month should say so - but there is nothing to open into: telling somebody what to bring to a
   * cleaning they finished last week is noise dressed as instruction.
   */
  selectJob(job: CleanerPortalJob): void {
    if (job.isCompleted) return;
    this.selectedJob = job;
  }

  private firstOpenableJob(jobs: CleanerPortalJob[]): CleanerPortalJob | null {
    return jobs.find(j => !j.isCompleted) ?? null;
  }

  /**
   * The SuperAdmin's selection feeds the side card AND, when it comes from a click, opens the full
   * read-only detail. Re-indexing after a fetch passes openPanel = false: a month landing must not
   * throw a panel over the page nobody asked for.
   */
  selectAdminJob(job: CleanerPortalAdminJob | null, openPanel = true): void {
    this.selectedAdminJob = job;
    this.selectedJob = job;
    if (job && openPanel) this.openDetail(job.orderId);
  }

  /**
   * Moving the month rebuilds the grid, and for a SuperAdmin also fetches it: their calendar is
   * every cleaning in the company, so it is loaded a month at a time rather than all at once.
   */
  private onMonthChanged(): void {
    this.buildCalendar();
    if (this.context?.isSystemWideView && !this.isSearchMode) this.loadAllJobs();
  }

  /** "yyyy-MM-01" of the visible month. */
  private monthStartKey(): string {
    return this.keyOfDate(new Date(this.calendarYear, this.calendarMonthIndex, 1));
  }

  /** "yyyy-MM-<last>" of the visible month - day 0 of the next month is the last of this one. */
  private monthEndKey(): string {
    return this.keyOfDate(new Date(this.calendarYear, this.calendarMonthIndex + 1, 0));
  }

  /** The SAME array reference on every pass for an empty day - a fresh [] would churn the view. */
  get selectedDayJobs(): CleanerPortalJob[] {
    return this.jobsByDate.get(this.selectedDateKey) ?? this.noJobs;
  }

  get selectedDayAdminJobs(): CleanerPortalAdminJob[] {
    return this.adminJobsByDate.get(this.selectedDateKey) ?? this.noAdminJobs;
  }

  /** How many cleanings the chosen day holds, whichever view is asking. */
  get selectedDayCount(): number {
    return this.selectedDayJobs.length + this.selectedDayAdminJobs.length;
  }

  /**
   * The calendar layout is shown to a linked cleaner once their jobs are in, and to a SuperAdmin
   * whenever they are not searching. The SuperAdmin's stays up WHILE a month loads - the grid is
   * the navigation, and taking it away mid-fetch is what makes a page feel like it lost its place.
   */
  get showSchedule(): boolean {
    if (this.context?.isCleanerView) return !this.loading && !!this.context?.cleanerId;
    if (this.context?.isSystemWideView) return !this.isSearchMode;
    return false;
  }

  get isSelectedDayToday(): boolean {
    return this.selectedDateKey === this.todayKey;
  }

  get selectedDayLongLabel(): string {
    return this.formatKey(this.selectedDateKey, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  get selectedDayShortLabel(): string {
    return this.formatKey(this.selectedDateKey, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  private formatKey(key: string, options: Intl.DateTimeFormatOptions): string {
    if (!key) return '';
    const [y, m, d] = key.split('-').map(n => parseInt(n, 10));
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString(this.locale, options);
  }

  /** The address is already on screen; this just saves retyping it into a phone's map app. */
  mapsUrl(address: string | null | undefined): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || '')}`;
  }

  // ── Display helpers ──────────────────────────────────────────────────────────────────

  /**
   * ServiceDate is NY wall-clock and arrives as an ISO string. Split on 'T' and rebuild from the
   * parts rather than handing the whole string to Date(), which would apply the viewer's timezone
   * and slide a job to the previous day for anybody west of New York.
   */
  formatDate(value: string | Date | null | undefined): string {
    if (!value) return '';
    const iso = typeof value === 'string' ? value : value.toISOString();
    const [y, m, d] = iso.split('T')[0].split('-').map(n => parseInt(n, 10));
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString(this.locale, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  formatTime(time: string | null | undefined): string {
    return formatTime12h(time);
  }

  /** "2 Bedrooms" / "2 спальни" / "Studio" - the counted noun in the reader's own language. */
  formatServiceLine(line: { name: string; quantity: number; serviceKey?: string | null }): string {
    return formatServiceLine(line, this.language);
  }

  /** The hours this cleaner works, in their own units. */
  formatDuration(minutes: number | null | undefined): string {
    return formatPortalDuration(minutes ?? 0, this.language);
  }

  /** "Cleaning" / "Cleanings" / "уборки" - correct for the count AND the language. */
  cleaningsWord(count: number): string {
    return plural(this.language, count, this.t.cleanings);
  }

  /** Localised "Apartment" / "House", or empty when the order never recorded one. */
  propertyTypeLabel(propertyType: string | null | undefined): string {
    const value = (propertyType || '').trim().toLowerCase();
    if (!value) return '';
    return value === 'house' ? this.t.house : this.t.apartment;
  }

  levelsLabel(levels: number | null | undefined): string {
    if (!levels) return '';
    return `${levels} ${plural(this.language, levels, this.t.levels)}`;
  }

  statusClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s === 'done') return 'status-done';
    if (s === 'active') return 'status-active';
    if (s === 'cancelled' || s === 'refunded') return 'status-cancelled';
    return 'status-pending';
  }

  /** Under-staffed jobs are what a system-wide list is scanned for. */
  isUnderstaffed(job: CleanerPortalAdminJob): boolean {
    return (job.assignedCleaners?.length ?? 0) < (job.maidsCount || 1);
  }

  trackByCellKey(_index: number, cell: CleanerCalendarCell): string {
    return cell.key;
  }

  trackByOrderId(_index: number, job: { orderId: number }): number {
    return job.orderId;
  }
}
