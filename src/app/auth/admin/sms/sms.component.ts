import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ROLES } from '../../../services/mail.service';
import { AdminService, UserPermissions } from '../../../services/admin.service';
import {
  ScheduledSmsService,
  ScheduledSmsDto,
  CreateScheduledSmsDto,
  UpdateScheduledSmsDto,
  SmsStatsDto,
  SmsUserCountDto
} from '../../../services/scheduled-sms.service';

const STATUS_DRAFT = 0;
const STATUS_SCHEDULED = 1;
const STATUS_SENT = 2;

@Component({
  selector: 'app-sms',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sms.component.html',
  styleUrls: ['./sms.component.scss']
})
export class SmsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tableWrapper', { static: false }) tableWrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('tableHeader', { static: false }) tableHeader!: ElementRef<HTMLTableSectionElement>;
  
  ROLES = ROLES;

  // Sticky header management
  private scrollListener?: () => void;
  private horizontalScrollListener?: () => void;
  private stickyHeaderInitialized = false;
  private initializationRetries = 0;
  private readonly maxRetries = 20;
  
  get headerStickyOffset(): number {
    if (window.innerWidth <= 768) {
      return 60;
    }
    return 80;
  }

  list: ScheduledSmsDto[] = [];
  stats: SmsStatsDto | null = null;
  userCounts: SmsUserCountDto[] = [];
  userPermissions: UserPermissions | null = null;
  filterStatus: number | null = null;
  isComposing = false;
  editingId: number | null = null;
  content = '';
  selectedRoles: Record<string, boolean> = {};
  sendNow = true;
  scheduleType = 0;
  scheduledDate = '';
  scheduledTime = '09:00';
  frequency: number | null = null;
  dayOfWeek: number | null = 1;
  dayOfMonth: number | null = 1;
  readonly scheduleTimezone = 'America/New_York';
  readonly daysOfMonth = Array.from({ length: 31 }, (_, i) => i + 1);

  error = '';
  success = '';

  constructor(
    private adminService: AdminService,
    private scheduledSmsService: ScheduledSmsService
  ) {
    ROLES.forEach(r => this.selectedRoles[r] = false);
  }

  ngOnInit() {
    this.adminService.getUserPermissions().subscribe({ next: p => { this.userPermissions = p; }, error: () => {} });
    this.load();
  }

  ngAfterViewInit() {
    this.initializeStickyHeader();
  }

  private initializeStickyHeader() {
    if (!this.tableWrapper || !this.tableHeader) {
      if (this.initializationRetries < this.maxRetries) {
        this.initializationRetries++;
        setTimeout(() => {
          this.initializeStickyHeader();
        }, 50);
      }
      return;
    }
    
    if (!this.tableWrapper.nativeElement || !this.tableHeader.nativeElement) {
      if (this.initializationRetries < this.maxRetries) {
        this.initializationRetries++;
        setTimeout(() => {
          this.initializeStickyHeader();
        }, 50);
      }
      return;
    }
    
    this.initializationRetries = 0;
    this.setupStickyHeader();
  }

  ngOnDestroy() {
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true);
    }
    if (this.horizontalScrollListener && this.tableWrapper) {
      const wrapperEl = this.tableWrapper.nativeElement;
      wrapperEl.removeEventListener('scroll', this.horizontalScrollListener);
      wrapperEl.removeEventListener('touchmove', this.horizontalScrollListener);
      wrapperEl.removeEventListener('wheel', this.horizontalScrollListener);
    }
    this.stickyHeaderInitialized = false;
    this.initializationRetries = 0;
  }

  @HostListener('window:resize')
  onResize() {
    setTimeout(() => {
      this.updateStickyHeader();
    }, 50);
  }

  private setupStickyHeader() {
    if (!this.tableWrapper || !this.tableHeader) {
      return;
    }

    if (this.stickyHeaderInitialized) {
      this.updateStickyHeader();
      return;
    }

    this.scrollListener = () => {
      this.updateStickyHeader();
    };
    window.addEventListener('scroll', this.scrollListener, true);

    // Direct sync for immediate updates on mobile
    this.horizontalScrollListener = () => {
      this.syncHorizontalScroll();
    };
    const wrapperEl = this.tableWrapper.nativeElement;
    wrapperEl.addEventListener('scroll', this.horizontalScrollListener, { passive: true });
    wrapperEl.addEventListener('touchmove', this.horizontalScrollListener, { passive: true });
    wrapperEl.addEventListener('wheel', this.horizontalScrollListener, { passive: true });

    this.stickyHeaderInitialized = true;
    this.updateStickyHeader();
  }

  private updateStickyHeader() {
    if (!this.tableWrapper || !this.tableHeader) {
      return;
    }

    const wrapper = this.tableWrapper.nativeElement;
    const header = this.tableHeader.nativeElement;
    const rect = wrapper.getBoundingClientRect();
    const offset = this.headerStickyOffset;
    
    const shouldBeSticky = rect.top <= offset;
    
    if (shouldBeSticky) {
      const table = header.closest('table') as HTMLTableElement;
      if (!table) return;
      
      const headerCells = header.querySelectorAll('th');
      const firstDataRow = table.querySelector('tbody tr') as HTMLTableRowElement;
      
      // IMPORTANT: Capture widths BEFORE making header sticky to get accurate measurements
      const cellWidths: number[] = [];
      if (firstDataRow) {
        const dataCells = firstDataRow.querySelectorAll('td');
        dataCells.forEach((td: Element, index: number) => {
          const tdElement = td as HTMLElement;
          const cellRect = tdElement.getBoundingClientRect();
          cellWidths[index] = cellRect.width;
        });
      } else {
        headerCells.forEach((th: Element) => {
          const thElement = th as HTMLElement;
          const cellRect = thElement.getBoundingClientRect();
          cellWidths.push(cellRect.width);
        });
      }
      
      // Store wrapper's current left position for horizontal positioning
      const wrapperLeft = rect.left;
      
      // Get the actual table width (not just visible wrapper width)
      const tableRect = table.getBoundingClientRect();
      const tableWidth = tableRect.width;
      
      // Make header sticky
      header.style.position = 'fixed';
      header.style.top = `${offset}px`;
      header.style.left = `${wrapperLeft}px`;
      // Set header width to match the FULL table width, not just visible wrapper width
      header.style.width = `${tableWidth}px`;
      header.style.zIndex = '100';
      header.style.backgroundColor = '#f8f9fa';
      header.style.display = 'table-header-group';
      header.style.tableLayout = 'fixed';
      header.style.overflow = 'hidden';
      
      // Initialize transform to match current scroll position
      const initialScrollLeft = wrapper.scrollLeft;
      header.style.transform = `translate3d(-${initialScrollLeft}px, 0, 0)`;
      header.style.webkitTransform = `translate3d(-${initialScrollLeft}px, 0, 0)`;
      
      const headerRow = header.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = 'visible';
        headerRow.style.width = `${tableWidth}px`;
      }
      
      headerCells.forEach((th: Element, index: number) => {
        const thElement = th as HTMLElement;
        if (cellWidths[index] !== undefined) {
          thElement.style.width = `${cellWidths[index]}px`;
          thElement.style.minWidth = `${cellWidths[index]}px`;
          thElement.style.maxWidth = `${cellWidths[index]}px`;
        }
        thElement.style.backgroundColor = '#f8f9fa';
        thElement.style.display = 'table-cell';
        thElement.style.textAlign = 'center';
        thElement.style.overflow = 'hidden';
        thElement.style.textOverflow = 'ellipsis';
      });
      
      // Also preserve widths on data cells to prevent them from changing
      if (firstDataRow) {
        const dataCells = firstDataRow.querySelectorAll('td');
        dataCells.forEach((td: Element, index: number) => {
          const tdElement = td as HTMLElement;
          if (cellWidths[index] !== undefined) {
            tdElement.style.width = `${cellWidths[index]}px`;
            tdElement.style.minWidth = `${cellWidths[index]}px`;
            tdElement.style.maxWidth = `${cellWidths[index]}px`;
          }
        });
      }
      
      // Sync horizontal scroll immediately
      setTimeout(() => {
        this.syncHorizontalScroll();
      }, 0);
    } else {
      header.style.position = '';
      header.style.top = '';
      header.style.left = '';
      header.style.width = '';
      header.style.zIndex = '';
      header.style.transform = '';
      header.style.display = '';
      header.style.tableLayout = '';
      header.style.overflow = '';
      header.style.maxWidth = '';
      
      const headerRow = header.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = '';
        headerRow.style.maxWidth = '';
      }
      
      const headerCells = header.querySelectorAll('th');
      headerCells.forEach((cell: Element) => {
        const cellElement = cell as HTMLElement;
        cellElement.style.width = '';
        cellElement.style.minWidth = '';
        cellElement.style.maxWidth = '';
        cellElement.style.display = '';
        cellElement.style.overflow = '';
        cellElement.style.textOverflow = '';
      });
    }
  }

  private syncHorizontalScroll() {
    if (!this.tableWrapper || !this.tableHeader) {
      return;
    }

    const wrapper = this.tableWrapper.nativeElement;
    const header = this.tableHeader.nativeElement;
    
    // Sync horizontal scroll position by translating the header
    // Only sync if header is currently fixed/sticky
    if (header.style.position === 'fixed') {
      // Get the scroll position
      const scrollLeft = wrapper.scrollLeft;
      
      // Get current wrapper position to ensure left is correct
      const wrapperRect = wrapper.getBoundingClientRect();
      const wrapperLeft = wrapperRect.left;
      
      // Update left position to match wrapper's current position
      header.style.left = `${wrapperLeft}px`;
      
      // Translate header horizontally to match the wrapper's scroll position
      // Use translate3d for better performance and to force GPU acceleration
      header.style.transform = `translate3d(-${scrollLeft}px, 0, 0)`;
      header.style.webkitTransform = `translate3d(-${scrollLeft}px, 0, 0)`;
      
      // Use will-change for better performance on mobile
      header.style.willChange = 'transform';
    }
  }

  load() {
    this.scheduledSmsService.getList(this.filterStatus ?? undefined).subscribe({
      next: list => {
        this.list = list;
        setTimeout(() => {
          if (!this.stickyHeaderInitialized) {
            this.initializeStickyHeader();
          } else {
            this.updateStickyHeader();
          }
        }, 150);
      },
      error: e => this.error = e?.error?.message || 'Failed to load SMS.'
    });
    this.scheduledSmsService.getStats().subscribe({ next: s => this.stats = s, error: () => {} });
    this.scheduledSmsService.getUserCounts().subscribe({ next: c => this.userCounts = c, error: () => {} });
  }

  setFilter(s: number | null) {
    this.filterStatus = s;
    this.load();
  }

  targetRolesJson(): string {
    return JSON.stringify(ROLES.filter(r => this.selectedRoles[r]));
  }

  withValidPhoneCount(): number {
    return (this.userCounts || [])
      .filter(c => ROLES.includes(c.role as any) && this.selectedRoles[c.role])
      .reduce((n, c) => n + c.withValidPhone, 0);
  }

  startCompose() {
    this.isComposing = true;
    this.editingId = null;
    this.content = '';
    ROLES.forEach(r => this.selectedRoles[r] = false);
    this.sendNow = true;
    this.scheduleType = 0;
    this.scheduledDate = '';
    this.scheduledTime = '09:00';
    this.frequency = null;
    this.dayOfWeek = 1;
    this.dayOfMonth = 1;
    this.error = '';
    this.success = '';
  }

  cancelCompose() {
    this.isComposing = false;
    this.editingId = null;
  }

  edit(s: ScheduledSmsDto) {
    if (s.status !== STATUS_DRAFT && s.status !== STATUS_SCHEDULED) return;
    this.editingId = s.id;
    this.isComposing = true;
    this.content = s.content;
    try {
      const arr: string[] = JSON.parse(s.targetRoles || '[]');
      ROLES.forEach(r => this.selectedRoles[r] = arr.includes(r));
    } catch { ROLES.forEach(r => this.selectedRoles[r] = false); }
    this.sendNow = false;
    this.scheduleType = s.scheduleType;
    this.scheduledDate = s.scheduledDate ? String(s.scheduledDate).slice(0, 10) : '';
    this.scheduledTime = s.scheduledTime ? String(s.scheduledTime).slice(0, 5) : '09:00';
    this.frequency = s.frequency ?? null;
    this.dayOfWeek = s.dayOfWeek ?? 1;
    this.dayOfMonth = s.dayOfMonth ?? 1;
    this.error = '';
    this.success = '';
  }

  doSendNow() {
    this.error = '';
    this.success = '';
    if (!(this.content || '').trim()) { this.error = 'Message is required.'; return; }
    const dto: CreateScheduledSmsDto = {
      content: this.content.trim(),
      targetRoles: this.targetRolesJson(),
      scheduleType: 0,
      scheduleTimezone: this.scheduleTimezone,
      sendNow: true
    };
    this.scheduledSmsService.create(dto).subscribe({
      next: () => { this.cancelCompose(); this.success = 'SMS sent.'; this.load(); },
      error: e => this.error = e?.error?.message || 'Failed to send.'
    });
  }

  doSaveDraft() {
    this.error = '';
    this.success = '';
    if (!(this.content || '').trim()) { this.error = 'Message is required.'; return; }
    if (this.editingId != null) {
      const dto: UpdateScheduledSmsDto = { content: this.content.trim(), targetRoles: this.targetRolesJson() };
      this.scheduledSmsService.update(this.editingId, dto).subscribe({
        next: () => { this.cancelCompose(); this.success = 'Draft updated.'; this.load(); },
        error: e => this.error = e?.error?.message || 'Failed to update.'
      });
      return;
    }
    const dto: CreateScheduledSmsDto = {
      content: this.content.trim(),
      targetRoles: this.targetRolesJson(),
      scheduleType: 0,
      scheduleTimezone: this.scheduleTimezone,
      sendNow: false
    };
    this.scheduledSmsService.create(dto).subscribe({
      next: () => { this.cancelCompose(); this.success = 'Draft saved.'; this.load(); },
      error: e => this.error = e?.error?.message || 'Failed to save.'
    });
  }

  doSchedule() {
    this.error = '';
    this.success = '';
    if (!(this.content || '').trim()) { this.error = 'Message is required.'; return; }
    if (!this.scheduledTime) { this.error = 'Time is required for scheduling.'; return; }
    if (this.frequency === null && !this.scheduledDate) { this.error = 'Date is required for one-time scheduling.'; return; }
    if (this.frequency === 1 && this.dayOfWeek == null) { this.error = 'Day of week is required for weekly scheduling.'; return; }
    if (this.frequency === 2 && this.dayOfMonth == null) { this.error = 'Day of month is required for monthly scheduling.'; return; }
    const time = this.scheduledTime.length === 5 ? `${this.scheduledTime}:00` : this.scheduledTime;
    const scheduledDateIso = this.scheduledDate ? `${this.scheduledDate}T00:00:00` : undefined;
    const payload = {
      content: this.content.trim(),
      targetRoles: this.targetRolesJson(),
      scheduleType: 1,
      scheduledDate: scheduledDateIso,
      scheduledTime: time,
      frequency: this.frequency ?? undefined,
      dayOfWeek: this.frequency === 1 ? this.dayOfWeek ?? undefined : undefined,
      dayOfMonth: this.frequency === 2 ? this.dayOfMonth ?? undefined : undefined,
      scheduleTimezone: this.scheduleTimezone
    };
    if (this.editingId != null) {
      this.scheduledSmsService.update(this.editingId, payload as UpdateScheduledSmsDto).subscribe({
        next: () => { this.cancelCompose(); this.success = 'Schedule updated.'; this.load(); },
        error: e => this.error = e?.error?.message || 'Failed to update.'
      });
      return;
    }
    this.scheduledSmsService.create({ ...payload, sendNow: false } as CreateScheduledSmsDto).subscribe({
      next: () => { this.cancelCompose(); this.success = 'SMS scheduled.'; this.load(); },
      error: e => this.error = e?.error?.message || 'Failed to schedule.'
    });
  }

  sendNowFor(id: number) {
    this.scheduledSmsService.sendNow(id).subscribe({
      next: () => { this.success = 'SMS sent.'; this.load(); },
      error: e => this.error = e?.error?.message || 'Failed to send.'
    });
  }

  disable(id: number) {
    if (!confirm('Disable this scheduled SMS? It will not be sent until you enable it again.')) return;
    this.scheduledSmsService.disable(id).subscribe({
      next: () => { this.success = 'Disabled.'; this.load(); },
      error: e => this.error = e?.error?.message || 'Failed to disable.'
    });
  }

  enable(id: number) {
    this.scheduledSmsService.enable(id).subscribe({
      next: () => { this.success = 'Enabled.'; this.load(); },
      error: e => this.error = e?.error?.message || 'Failed to enable.'
    });
  }

  delete(id: number) {
    if (!confirm('Delete this SMS?')) return;
    this.scheduledSmsService.delete(id).subscribe({
      next: () => { this.success = 'Deleted.'; this.load(); },
      error: e => this.error = e?.error?.message || 'Failed to delete.'
    });
  }

  statusLabel(s: ScheduledSmsDto): string {
    const status = s.status;
    if (status === STATUS_DRAFT) return 'Draft';
    if (status === STATUS_SCHEDULED) return s.isActive ? 'Scheduled' : 'Disabled';
    if (status === STATUS_SENT) return 'Sent';
    if (status === 3) return 'Disabled'; // legacy cancelled
    if (status === 4) return 'Failed';
    return 'Unknown';
  }

  frequencyLabel(f: number | null | undefined): string {
    if (f == null) return 'Once';
    if (f === 1) return 'Weekly';
    if (f === 2) return 'Monthly';
    return 'Once';
  }

  targetRolesDisplay(t: string | undefined): string {
    if (!t) return '–';
    try {
      const a: string[] = JSON.parse(t);
      return Array.isArray(a) ? a.join(', ') : t;
    } catch { return t; }
  }
}
