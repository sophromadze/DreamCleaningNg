import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NyDatePipe } from '../shared/ny-time.util';
import { Subject, of, forkJoin, Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, takeUntil, catchError, finalize, tap } from 'rxjs/operators';
import {
  CleanerManagementService,
  CleanerListItem,
  CleanerDetail,
  CreateCleanerPayload,
  UpdateCleanerPayload,
  CreateCleanerNotePayload,
  CleanerRanking,
  CleanerDocumentType,
  CleanerNote,
  CleanerVacation,
  CleanerPaymentMethod,
  CLEANER_PAYMENT_METHOD_INDEX,
  CLEANER_PAYMENT_DETAILS_LABEL,
  normalizeCleanerPaymentMethod
} from '../services/cleaner-management.service';
import { compressImage } from '../utils/image-compression';
import { normalizePhone10, sanitizePhoneInput, telHrefUS } from '../utils/phone.utils';

type ModalMode = 'create' | 'edit';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

// Whether each weekday the cleaner is available on. Checked = available.
type AvailableDays = Record<DayKey, boolean>;

// One editable vacation range row in the form (dates as yyyy-MM-dd for <input type="date">).
interface VacationRow {
  startDate: string;
  endDate: string;
  note: string;
}

type CleanerExperience = 'Good' | 'Normal' | 'None';

type CleanerSort = 'default' | 'rankBest' | 'rankWorst' | 'expHigh' | 'expLow' | 'name' | 'createdNew' | 'createdOld';
type CleanerFilter =
  | 'all'
  | 'best'
  | 'good'
  | 'normal'
  | 'bad'
  | 'noexp'
  | 'active'
  | 'reserve'
  | 'new';

const RANKING_INDEX: Record<CleanerRanking, number> = {
  Top: 0,
  Standard: 1,
  Beginner: 2,
  Restricted: 3,
  NoExp: 4
};

const EXPERIENCE_INDEX: Record<CleanerExperience, number> = {
  Good: 0,
  Normal: 1,
  None: 2
};

const DOCUMENT_TYPE_INDEX: Record<CleanerDocumentType, number> = {
  IdCard: 0,
  Passport: 1,
  DriverLicense: 2
};

const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Maps to System.DayOfWeek integers used by the backend (0=Sun … 6=Sat).
const DAY_KEY_TO_INT: Record<DayKey, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
};
const INT_TO_DAY_KEY: Record<number, DayKey> = {
  0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat'
};

const DAY_LABEL: Record<DayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun'
};

@Component({
  selector: 'app-cleaners-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, NyDatePipe],
  templateUrl: './cleaners-dashboard.component.html',
  styleUrls: ['./cleaners-dashboard.component.scss']
})
export class CleanersDashboardComponent implements OnInit, OnDestroy {
  cleaners: CleanerListItem[] = [];
  loading = false;
  errorMessage = '';

  searchTerm = '';
  includeInactive = false;
  sortBy: CleanerSort = 'default';
  filterBy: CleanerFilter = 'all';
  // '' = no weekday filter; otherwise show only cleaners NOT busy that weekday.
  availableOnDay: DayKey | '' = '';
  // '' = any borough; otherwise keep only cleaners who operate in that borough.
  filterBorough = '';
  // '' = any nationality; otherwise keep only cleaners with that nationality.
  filterNationality = '';
  private search$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  selectedDetail: CleanerDetail | null = null;
  loadingDetail = false;

  formOpen = false;
  formMode: ModalMode = 'create';
  formModel: UpdateCleanerPayload = this.emptyFormModel();
  formSaving = false;
  formError = '';
  editingId: number | null = null;

  availableDays: AvailableDays = this.emptyAvailableDays();
  vacations: VacationRow[] = [];
  // Which operating boroughs are checked in the form. Keyed by borough name.
  // Populated by openCreate/openEdit before the form renders (kept empty here so this
  // field initializer doesn't run before locationOptions is initialized).
  operatingBoroughs: Record<string, boolean> = {};

  photoUploading = false;
  documentUploading = false;

  formPhotoFile: File | null = null;
  formPhotoPreview: string | null = null;
  formDocumentFile: File | null = null;
  formDocumentPreview: string | null = null;

  newNote: CreateCleanerNotePayload = { text: '', orderId: null, orderPerformance: null };
  addingNote = false;
  addNoteModalOpen = false;

  editingNoteId: number | null = null;
  editingNoteText = '';
  savingNoteEdit = false;

  performanceModalOpen = false;
  performanceModal: {
    orderId: number;
    performance: 'Praise' | 'Issue' | 'Warning' | '';
    text: string;
    existingNoteId: number | null;
    saving: boolean;
    error: string;
  } | null = null;

  imageViewer: { src: string; alt: string; title: string } | null = null;

  readonly performanceOptions: { value: 'Praise' | 'Issue' | 'Warning'; label: string; icon: string }[] = [
    { value: 'Praise', label: 'Praise', icon: '✓' },
    { value: 'Issue', label: 'Issue', icon: '●' },
    { value: 'Warning', label: 'Warning', icon: '⚠' }
  ];

  readonly dayOrder = DAY_ORDER;
  readonly dayLabel = DAY_LABEL;

  readonly rankingOptions: { value: CleanerRanking; label: string }[] = [
    { value: 'Top', label: 'Best' },
    { value: 'Standard', label: 'Good' },
    { value: 'Beginner', label: 'Normal' },
    { value: 'Restricted', label: 'Bad' },
    { value: 'NoExp', label: 'No-Exp' }
  ];

  readonly experienceOptions: { value: CleanerExperience; label: string }[] = [
    { value: 'Good', label: 'Good' },
    { value: 'Normal', label: 'Normal' },
    { value: 'None', label: 'None' }
  ];

  readonly sortOptions: { value: CleanerSort; label: string }[] = [
    { value: 'default', label: 'Default (best first)' },
    { value: 'rankBest', label: 'Rank: best → worst' },
    { value: 'rankWorst', label: 'Rank: worst → best' },
    { value: 'expHigh', label: 'Experience: high → low' },
    { value: 'expLow', label: 'Experience: low → high' },
    { value: 'name', label: 'Name (A–Z)' },
    { value: 'createdNew', label: 'Created: newest first' },
    { value: 'createdOld', label: 'Created: oldest first' }
  ];

  readonly filterOptions: { value: CleanerFilter; label: string }[] = [
    { value: 'all', label: 'Show all' },
    { value: 'best', label: 'Best rank' },
    { value: 'good', label: 'Good rank' },
    { value: 'normal', label: 'Normal rank' },
    { value: 'bad', label: 'Bad rank' },
    { value: 'noexp', label: 'No-Exp rank' },
    { value: 'active', label: 'Active only' },
    { value: 'reserve', label: 'Reserve only' },
    { value: 'new', label: 'New cleaners' }
  ];

  readonly availableDayOptions: { value: DayKey; label: string }[] = [
    { value: 'mon', label: 'Monday' },
    { value: 'tue', label: 'Tuesday' },
    { value: 'wed', label: 'Wednesday' },
    { value: 'thu', label: 'Thursday' },
    { value: 'fri', label: 'Friday' },
    { value: 'sat', label: 'Saturday' },
    { value: 'sun', label: 'Sunday' }
  ];

  // Operating boroughs a cleaner can work in (multi-select; all selected by default).
  readonly locationOptions: { value: string; label: string }[] = [
    { value: 'Brooklyn', label: 'Brooklyn' },
    { value: 'Queens', label: 'Queens' },
    { value: 'Manhattan', label: 'Manhattan' }
  ];

  readonly nationalityOptions: { value: string; label: string }[] = [
    { value: 'Georgian', label: 'Georgian' },
    { value: 'English', label: 'English' },
    { value: 'Spanish', label: 'Spanish' },
    { value: 'Russian', label: 'Russian' }
  ];

  readonly documentTypeOptions: { value: CleanerDocumentType | ''; label: string }[] = [
    { value: '', label: '—' },
    { value: 'IdCard', label: 'ID Card' },
    { value: 'Passport', label: 'Passport' },
    { value: 'DriverLicense', label: "Driver's License" }
  ];

  /** How this cleaner is paid their wages. Blank is a valid, common answer. */
  readonly paymentMethodOptions: { value: CleanerPaymentMethod | ''; label: string }[] = [
    { value: '', label: '—' },
    { value: 'Zelle', label: 'Zelle' },
    { value: 'Cash', label: 'Cash' },
    { value: 'Check', label: 'Check' },
    { value: 'Other', label: 'Other' }
  ];

  /**
   * Label/placeholder for the payment-details box, following the chosen method. A generic
   * "details" prompt reads as a mistake when the answer is a Zelle number in one case and a
   * payee name in another.
   */
  get paymentDetailsLabel(): string {
    const method = normalizeCleanerPaymentMethod(this.formModel.paymentMethod);
    return method ? CLEANER_PAYMENT_DETAILS_LABEL[method] : 'Payment details';
  }

  /**
   * True for 2s after the payment details are copied, so the button can confirm. A tick that
   * never clears stops meaning anything.
   */
  paymentDetailsCopied = false;
  private paymentCopiedTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Copies the payment destination out of the form — the Zelle number / payee alone, never the
   * method with it, because it is pasted straight into a banking app.
   *
   * `navigator.clipboard` needs a browser and a secure context; the execCommand fallback covers
   * the rest, and a failure is reported rather than silently swallowed — somebody is about to
   * paste an account number somewhere.
   */
  copyFormPaymentDetails(): void {
    const text = (this.formModel.paymentDetails || '').trim();
    if (!text) return;

    const confirmCopied = () => {
      this.paymentDetailsCopied = true;
      if (this.paymentCopiedTimer) clearTimeout(this.paymentCopiedTimer);
      this.paymentCopiedTimer = setTimeout(() => {
        this.paymentDetailsCopied = false;
        this.cdr.markForCheck();
      }, 2000);
      this.cdr.markForCheck();
    };

    const fallback = () => {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        if (ok) confirmCopied();
      } catch {
        // Nothing else to try; the value is on screen and selectable by hand.
      }
      this.cdr.markForCheck();
    };

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(confirmCopied, fallback);
      return;
    }

    fallback();
  }

  /** Read-only summary for the detail panel, e.g. "Zelle · 6465550134". */
  paymentSummary(cleaner: { paymentMethod?: CleanerPaymentMethod | number | null; paymentDetails?: string | null }): string {
    const method = normalizeCleanerPaymentMethod(cleaner.paymentMethod);
    const details = (cleaner.paymentDetails || '').trim();
    if (!method && !details) return '';
    if (!details) return method as string;
    return method ? `${method} · ${details}` : details;
  }

  constructor(
    private cleanerService: CleanerManagementService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap(() => this.fetchCleaners$()),
        takeUntil(this.destroy$)
      )
      .subscribe();

    this.loadCleaners();
  }

  ngOnDestroy(): void {
    if (this.paymentCopiedTimer) clearTimeout(this.paymentCopiedTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(): void {
    this.search$.next(this.searchTerm);
  }

  onToggleInactive(): void {
    this.loadCleaners();
  }

  loadCleaners(): void {
    this.loading = true;
    this.errorMessage = '';
    this.fetchCleaners$().subscribe();
  }

  private fetchCleaners$() {
    this.loading = true;
    return this.cleanerService
      .getAll({ includeInactive: this.includeInactive, search: this.searchTerm })
      .pipe(
        tap(list => {
          this.cleaners = list;
        }),
        catchError(err => {
          this.errorMessage = this.extractError(err) || 'Failed to load cleaners';
          this.cleaners = [];
          return of([] as CleanerListItem[]);
        }),
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        })
      );
  }

  openDetail(cleaner: CleanerListItem): void {
    this.loadingDetail = true;
    this.selectedDetail = null;
    this.cleanerService.getById(cleaner.id).subscribe({
      next: detail => {
        this.selectedDetail = detail;
        this.cleaners = this.cleaners.map(item =>
          item.id === detail.id ? { ...item, mainNote: detail.mainNote ?? null } : item
        );
        this.loadingDetail = false;
      },
      error: err => {
        this.errorMessage = this.extractError(err) || 'Failed to load cleaner details';
        this.loadingDetail = false;
      }
    });
  }

  closeDetail(): void {
    this.selectedDetail = null;
    this.newNote = { text: '', orderId: null, orderPerformance: null };
    this.cancelEditNote();
  }

  openCreate(): void {
    this.formMode = 'create';
    this.editingId = null;
    this.formModel = this.emptyFormModel();
    this.availableDays = this.emptyAvailableDays();
    // New cleaners operate in all boroughs by default.
    this.operatingBoroughs = this.emptyBoroughs(true);
    this.vacations = [];
    this.formPhotoFile = null;
    this.formPhotoPreview = null;
    this.formDocumentFile = null;
    this.formDocumentPreview = null;
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(detail: CleanerDetail): void {
    this.formMode = 'edit';
    this.editingId = detail.id;
    this.formModel = {
      firstName: detail.firstName,
      lastName: detail.lastName,
      age: detail.age ?? null,
      experience: this.normalizeExperience(detail.experience),
      phone: normalizePhone10(detail.phone),
      email: detail.email ?? null,
      address: detail.address ?? null,
      location: detail.location ?? null,
      busyDaysOfWeek: detail.busyDaysOfWeek ?? [],
      vacations: detail.vacations ?? [],
      alreadyWorkedWithUs: detail.alreadyWorkedWithUs,
      nationality: detail.nationality ?? null,
      ranking: this.normalizeRanking(detail.ranking),
      restrictedReason: detail.restrictedReason ?? null,
      allergies: detail.allergies ?? null,
      restrictions: detail.restrictions ?? null,
      mainNote: detail.mainNote ?? null,
      documentType: this.normalizeDocumentType(detail.documentType),
      paymentMethod: normalizeCleanerPaymentMethod(detail.paymentMethod),
      paymentDetails: detail.paymentDetails ?? null,
      isActive: detail.isActive
    };
    this.availableDays = this.intsToAvailableDays(detail.busyDaysOfWeek);
    this.operatingBoroughs = this.csvToBoroughs(detail.operatingAreas);
    this.vacations = (detail.vacations ?? []).map(v => ({
      startDate: this.toDateInput(v.startDate),
      endDate: this.toDateInput(v.endDate),
      note: v.note ?? ''
    }));
    this.formPhotoFile = null;
    this.formPhotoPreview = detail.photoUrl ?? null;
    this.formDocumentFile = null;
    this.formDocumentPreview = detail.documentUrl ?? null;
    this.formError = '';
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.formModel = this.emptyFormModel();
    this.availableDays = this.emptyAvailableDays();
    this.operatingBoroughs = this.emptyBoroughs(true);
    this.vacations = [];
    this.formPhotoFile = null;
    this.formPhotoPreview = null;
    this.formDocumentFile = null;
    this.formDocumentPreview = null;
    this.editingId = null;
    this.formError = '';
  }

  toggleAvailableDay(day: DayKey): void {
    this.availableDays = { ...this.availableDays, [day]: !this.availableDays[day] };
  }

  toggleBorough(borough: string): void {
    this.operatingBoroughs = { ...this.operatingBoroughs, [borough]: !this.operatingBoroughs[borough] };
  }

  addVacation(): void {
    const today = this.toDateInput(new Date().toISOString());
    this.vacations = [...this.vacations, { startDate: today, endDate: today, note: '' }];
  }

  removeVacation(index: number): void {
    this.vacations = this.vacations.filter((_, i) => i !== index);
  }

  onFormPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    input.value = '';
    this.formPhotoFile = file;
    this.readAsDataUrl(file).then(url => { this.formPhotoPreview = url; });
  }

  clearFormPhoto(): void {
    this.formPhotoFile = null;
    this.formPhotoPreview = null;
  }

  onFormDocumentSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    input.value = '';
    this.formDocumentFile = file;
    this.readAsDataUrl(file).then(url => { this.formDocumentPreview = url; });
  }

  clearFormDocument(): void {
    this.formDocumentFile = null;
    this.formDocumentPreview = null;
  }

  async saveForm(): Promise<void> {
    if (!this.formModel.firstName?.trim() || !this.formModel.lastName?.trim()) {
      this.formError = 'First name and last name are required.';
      return;
    }

    this.formSaving = true;
    this.formError = '';

    try {
      const payload = this.buildPayload();

      const save$ =
        this.formMode === 'create'
          ? this.cleanerService.create(payload as CreateCleanerPayload)
          : this.cleanerService.update(this.editingId!, payload as UpdateCleanerPayload);

      save$.subscribe({
        next: async detail => {
          try {
            const uploaded = await this.uploadFormAssets(detail.id);
            const finalDetail = uploaded || detail;
            this.selectedDetail = finalDetail;
            this.formOpen = false;
            this.formSaving = false;
            this.loadCleaners();
          } catch (uploadErr: any) {
            this.formSaving = false;
            this.formError = this.extractError(uploadErr) || 'Upload failed after saving cleaner';
          }
        },
        error: err => {
          this.formSaving = false;
          this.formError = this.extractError(err) || 'Failed to save cleaner';
        }
      });
    } catch (err: any) {
      this.formSaving = false;
      this.formError = this.extractError(err) || 'Failed to save cleaner';
    }
  }

  private async uploadFormAssets(cleanerId: number): Promise<CleanerDetail | null> {
    const tasks: Observable<any>[] = [];

    if (this.formPhotoFile) {
      const compressed = await compressImage(this.formPhotoFile, {
        maxWidth: 1200,
        maxHeight: 1200,
        maxSizeBytes: 500 * 1024
      });
      tasks.push(this.cleanerService.uploadPhoto(cleanerId, compressed));
    }

    if (this.formDocumentFile) {
      const compressed = await compressImage(this.formDocumentFile, {
        maxWidth: 2000,
        maxHeight: 2000,
        maxSizeBytes: 800 * 1024
      });
      tasks.push(this.cleanerService.uploadDocument(cleanerId, compressed));
    }

    if (tasks.length === 0) {
      return null;
    }

    await forkJoin(tasks).toPromise();
    return await this.cleanerService.getById(cleanerId).toPromise() as CleanerDetail;
  }

  deleteCleaner(detail: CleanerDetail): void {
    const confirmed = confirm(`Delete cleaner "${detail.firstName} ${detail.lastName}"?`);
    if (!confirmed) return;

    this.cleanerService.delete(detail.id).subscribe({
      next: () => {
        this.selectedDetail = null;
        this.loadCleaners();
      },
      error: err => {
        this.errorMessage = this.extractError(err) || 'Failed to delete cleaner';
      }
    });
  }

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !this.selectedDetail) return;

    const file = input.files[0];
    input.value = '';

    this.photoUploading = true;
    try {
      const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, maxSizeBytes: 500 * 1024 });
      this.cleanerService.uploadPhoto(this.selectedDetail.id, compressed).subscribe({
        next: result => {
          if (this.selectedDetail) this.selectedDetail.photoUrl = result.url;
          this.photoUploading = false;
          this.loadCleaners();
        },
        error: err => {
          this.photoUploading = false;
          this.errorMessage = this.extractError(err) || 'Photo upload failed';
        }
      });
    } catch (e) {
      this.photoUploading = false;
      this.errorMessage = 'Failed to process image';
    }
  }

  async onDocumentSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !this.selectedDetail) return;

    const file = input.files[0];
    input.value = '';

    this.documentUploading = true;
    try {
      const compressed = await compressImage(file, { maxWidth: 2000, maxHeight: 2000, maxSizeBytes: 800 * 1024 });
      this.cleanerService.uploadDocument(this.selectedDetail.id, compressed).subscribe({
        next: result => {
          if (this.selectedDetail) this.selectedDetail.documentUrl = result.url;
          this.documentUploading = false;
        },
        error: err => {
          this.documentUploading = false;
          this.errorMessage = this.extractError(err) || 'Document upload failed';
        }
      });
    } catch (e) {
      this.documentUploading = false;
      this.errorMessage = 'Failed to process document';
    }
  }

  addNote(): void {
    if (!this.selectedDetail || !this.newNote.text?.trim()) return;

    this.addingNote = true;
    this.cleanerService.addNote(this.selectedDetail.id, this.newNote).subscribe({
      next: note => {
        if (this.selectedDetail) {
          this.selectedDetail.notes = [note, ...(this.selectedDetail.notes || [])];
        }
        this.newNote = { text: '', orderId: null, orderPerformance: null };
        this.addingNote = false;
        this.addNoteModalOpen = false;
      },
      error: err => {
        this.addingNote = false;
        this.errorMessage = this.extractError(err) || 'Failed to add note';
      }
    });
  }

  openAddNoteModal(): void {
    this.newNote = { text: '', orderId: null, orderPerformance: null };
    this.addNoteModalOpen = true;
  }

  closeAddNoteModal(): void {
    if (this.addingNote) return;
    this.addNoteModalOpen = false;
  }

  saveAddNoteFromModal(): void {
    this.addNote();
  }

  deleteNote(noteId: number): void {
    const confirmed = confirm('Delete this note?');
    if (!confirmed) return;

    this.cleanerService.deleteNote(noteId).subscribe({
      next: () => {
        if (this.selectedDetail) {
          this.selectedDetail.notes = this.selectedDetail.notes.filter(n => n.id !== noteId);
        }
        if (this.editingNoteId === noteId) {
          this.cancelEditNote();
        }
      },
      error: err => {
        this.errorMessage = this.extractError(err) || 'Failed to delete note';
      }
    });
  }

  startEditNote(note: CleanerNote): void {
    this.editingNoteId = note.id;
    this.editingNoteText = note.text;
  }

  cancelEditNote(): void {
    this.editingNoteId = null;
    this.editingNoteText = '';
    this.savingNoteEdit = false;
  }

  saveEditNote(): void {
    if (this.editingNoteId == null) return;
    const text = (this.editingNoteText || '').trim();
    if (!text) return;

    this.savingNoteEdit = true;
    const noteId = this.editingNoteId;
    this.cleanerService.updateNote(noteId, { text }).subscribe({
      next: updated => {
        if (this.selectedDetail) {
          this.selectedDetail.notes = this.selectedDetail.notes.map(n =>
            n.id === noteId ? { ...n, ...updated } : n
          );
        }
        this.cancelEditNote();
      },
      error: err => {
        this.savingNoteEdit = false;
        this.errorMessage = this.extractError(err) || 'Failed to update note';
      }
    });
  }

  rankingClass(ranking: CleanerRanking | number): string {
    const normalized = this.normalizeRanking(ranking);
    return `ranking-badge ranking-${normalized.toLowerCase()}`;
  }

  rankingLabel(ranking: CleanerRanking | number): string {
    const normalized = this.normalizeRanking(ranking);
    const found = this.rankingOptions.find(opt => opt.value === normalized);
    return found?.label ?? 'Good';
  }

  normalizeRanking(value: CleanerRanking | number): CleanerRanking {
    if (typeof value === 'number') {
      return (['Top', 'Standard', 'Beginner', 'Restricted', 'NoExp'][value] ?? 'Standard') as CleanerRanking;
    }
    return value ?? 'Standard';
  }

  isNewCleaner(cleaner: { experience?: string | null }): boolean {
    return this.normalizeExperience(cleaner.experience) === 'None';
  }

  normalizeExperience(value: string | null | undefined): CleanerExperience {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'good') return 'Good';
    if (normalized === 'normal') return 'Normal';
    return 'None';
  }

  normalizeDocumentType(value: CleanerDocumentType | number | null | undefined): CleanerDocumentType | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
      return (['IdCard', 'Passport', 'DriverLicense'][value] ?? null) as CleanerDocumentType | null;
    }
    return value;
  }

  documentTypeLabel(value: CleanerDocumentType | number | null | undefined): string {
    const normalized = this.normalizeDocumentType(value);
    if (!normalized) return '';
    const found = this.documentTypeOptions.find(o => o.value === normalized);
    return found?.label ?? '';
  }

  /**
   * Available-weekday names (e.g. "Mon, Tue") for the detail panel. `ints` is the
   * stored busy-day CSV; available days are every weekday NOT in that list, so an
   * empty/unset value means the cleaner is available every day.
   */
  availableDayNames(ints: number[] | null | undefined): string {
    const busy = ints ?? [];
    return DAY_ORDER
      .filter(day => !busy.includes(DAY_KEY_TO_INT[day]))
      .map(day => DAY_LABEL[day])
      .join(', ');
  }

  /** Formats a date-only value (yyyy-MM-dd / ISO) without timezone drift, e.g. "Jul 1, 2026". */
  formatDateOnly(value: string | null | undefined): string {
    if (!value) return '';
    const parts = value.substring(0, 10).split('-');
    if (parts.length !== 3) return value;
    const [y, m, d] = parts.map(p => parseInt(p, 10));
    if (!y || !m || !d) return value;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[m - 1]} ${d}, ${y}`;
  }

  telHref(phone: string | null | undefined): string {
    return telHrefUS(phone);
  }

  onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    if (input.value !== cleaned) {
      input.value = cleaned;
    }
    this.formModel.phone = cleaned || null;
  }

  formatServiceTime(value: string | null | undefined): string {
    if (!value) return '';
    const match = value.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return value;
    const hours = parseInt(match[1], 10);
    const minutes = match[2];
    if (isNaN(hours)) return value;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHours}:${minutes} ${period}`;
  }

  isCompletedOrder(status: string | null | undefined): boolean {
    return (status || '').toLowerCase() === 'done';
  }

  get completedOrders(): CleanerDetail['assignedOrders'] {
    if (!this.selectedDetail) return [];
    return this.selectedDetail.assignedOrders
      .filter(o => this.isCompletedOrder(o.status))
      .sort((a, b) => new Date(b.serviceDate).getTime() - new Date(a.serviceDate).getTime());
  }

  get upcomingOrders(): CleanerDetail['assignedOrders'] {
    if (!this.selectedDetail) return [];
    return this.selectedDetail.assignedOrders
      .filter(o => !this.isCompletedOrder(o.status) && (o.status || '').toLowerCase() !== 'cancelled')
      .sort((a, b) => new Date(a.serviceDate).getTime() - new Date(b.serviceDate).getTime());
  }

  get jobsCompletedCount(): number {
    return this.completedOrders.length;
  }

  get lastCompletedJobDate(): string | null {
    const first = this.completedOrders[0];
    return first ? first.serviceDate : null;
  }

  get issuesCount(): number {
    if (!this.selectedDetail) return 0;
    return this.selectedDetail.notes.filter(n => this.performanceCategory(n.orderPerformance) === 'issue').length;
  }

  get generalNotes(): CleanerNote[] {
    if (!this.selectedDetail) return [];
    return this.selectedDetail.notes
      .filter(n => !n.orderId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  performanceCategory(value: string | null | undefined): 'praise' | 'issue' | 'warning' | null {
    if (!value) return null;
    const v = value.trim().toLowerCase();
    if (!v) return null;
    if (v.includes('warn')) return 'warning';
    if (v.includes('issue') || v.includes('problem') || v.includes('bad')) return 'issue';
    if (v.includes('praise') || v.includes('good') || v.includes('great') || v.includes('excellent')) return 'praise';
    return null;
  }

  private noteForOrder(orderId: number): CleanerNote | null {
    if (!this.selectedDetail) return null;
    return this.selectedDetail.notes.find(n => n.orderId === orderId) || null;
  }

  orderPerformance(orderId: number): { category: 'praise' | 'issue' | 'warning'; label: string } | null {
    const note = this.noteForOrder(orderId);
    if (!note || !note.orderPerformance) return null;
    const category = this.performanceCategory(note.orderPerformance);
    if (!category) return null;
    return { category, label: note.orderPerformance };
  }

  isOrderPerformance(orderId: number, value: 'Praise' | 'Issue' | 'Warning'): boolean {
    const current = this.orderPerformance(orderId);
    if (!current) return false;
    return current.category === value.toLowerCase();
  }

  performanceOptionForOrder(orderId: number): { value: 'Praise' | 'Issue' | 'Warning'; label: string; icon: string } | null {
    const current = this.orderPerformance(orderId);
    if (!current) return null;
    const byCategory: Record<string, 'Praise' | 'Issue' | 'Warning'> = {
      praise: 'Praise',
      issue: 'Issue',
      warning: 'Warning'
    };
    const value = byCategory[current.category];
    return this.performanceOptions.find(o => o.value === value) || null;
  }

  openPerformanceModal(orderId: number, preselect?: 'Praise' | 'Issue' | 'Warning'): void {
    const note = this.noteForOrder(orderId);
    const currentCategory = note?.orderPerformance ? this.performanceCategory(note.orderPerformance) : null;
    const currentValue: 'Praise' | 'Issue' | 'Warning' | '' =
      preselect ?? (currentCategory
        ? (currentCategory === 'praise' ? 'Praise' : currentCategory === 'issue' ? 'Issue' : 'Warning')
        : '');

    this.performanceModal = {
      orderId,
      performance: currentValue,
      text: note?.text ?? '',
      existingNoteId: note?.id ?? null,
      saving: false,
      error: ''
    };
    this.performanceModalOpen = true;
  }

  closePerformanceModal(): void {
    this.performanceModalOpen = false;
    this.performanceModal = null;
  }

  openImageViewer(src: string | null | undefined, title: string, alt: string): void {
    if (!src) return;
    this.imageViewer = { src, alt, title };
  }

  closeImageViewer(): void {
    this.imageViewer = null;
  }

  savePerformance(): void {
    if (!this.performanceModal || !this.selectedDetail) return;

    const cleanerId = this.selectedDetail.id;
    const payload = {
      orderId: this.performanceModal.orderId,
      performance: this.performanceModal.performance || null,
      text: this.performanceModal.text?.trim() || null
    };

    this.performanceModal.saving = true;
    this.performanceModal.error = '';

    this.cleanerService.upsertOrderPerformance(cleanerId, payload).subscribe({
      next: () => {
        this.cleanerService.getById(cleanerId).subscribe({
          next: detail => {
            this.selectedDetail = detail;
            this.cleaners = this.cleaners.map(item =>
              item.id === detail.id ? { ...item, mainNote: detail.mainNote ?? null } : item
            );
            this.closePerformanceModal();
          },
          error: () => { this.closePerformanceModal(); }
        });
      },
      error: err => {
        if (this.performanceModal) {
          this.performanceModal.saving = false;
          this.performanceModal.error = this.extractError(err) || 'Failed to save performance';
        }
      }
    });
  }

  clearPerformance(): void {
    if (!this.performanceModal) return;
    this.performanceModal.performance = '';
    this.performanceModal.text = '';
    this.savePerformance();
  }

  get displayedCleaners(): CleanerListItem[] {
    const filtered = this.cleaners.filter(c => this.matchesFilter(c));
    return this.sortCleaners(filtered);
  }

  private matchesFilter(c: CleanerListItem): boolean {
    if (!this.matchesAvailableDay(c)) return false;
    if (!this.matchesBorough(c)) return false;
    if (!this.matchesNationality(c)) return false;
    switch (this.filterBy) {
      case 'best': return this.normalizeRanking(c.ranking) === 'Top';
      case 'good': return this.normalizeRanking(c.ranking) === 'Standard';
      case 'normal': return this.normalizeRanking(c.ranking) === 'Beginner';
      case 'bad': return this.normalizeRanking(c.ranking) === 'Restricted';
      case 'noexp': return this.normalizeRanking(c.ranking) === 'NoExp';
      case 'active': return !!c.alreadyWorkedWithUs;
      case 'reserve': return !c.alreadyWorkedWithUs;
      case 'new': return this.isNewCleaner(c);
      case 'all':
      default: return true;
    }
  }

  /** When a weekday is selected, keep only cleaners NOT marked busy on that day. */
  private matchesAvailableDay(c: CleanerListItem): boolean {
    if (!this.availableOnDay) return true;
    const dayInt = DAY_KEY_TO_INT[this.availableOnDay];
    return !(c.busyDaysOfWeek ?? []).includes(dayInt);
  }

  /** When a borough is selected, keep cleaners who WORK there (no operating areas set = works everywhere). */
  private matchesBorough(c: CleanerListItem): boolean {
    if (!this.filterBorough) return true;
    const boroughs = this.parseBoroughs(c.operatingAreas);
    if (boroughs.length === 0) return true;
    return boroughs.includes(this.filterBorough);
  }

  /** When a nationality is selected, keep only cleaners with that exact nationality. */
  private matchesNationality(c: CleanerListItem): boolean {
    if (!this.filterNationality) return true;
    return (c.nationality || '').trim() === this.filterNationality;
  }

  /** Distinct nationalities present in the loaded cleaners, for the nationality filter dropdown. */
  get availableNationalities(): string[] {
    const set = new Set<string>();
    for (const c of this.cleaners) {
      const n = (c.nationality || '').trim();
      if (n) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  private sortCleaners(list: CleanerListItem[]): CleanerListItem[] {
    const byName = (a: CleanerListItem, b: CleanerListItem) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    const rank = (c: CleanerListItem) => RANKING_INDEX[this.normalizeRanking(c.ranking)];
    const exp = (c: CleanerListItem) => EXPERIENCE_INDEX[this.normalizeExperience(c.experience)];
    const created = (c: CleanerListItem) => new Date(c.createdAt).getTime() || 0;

    const sorted = [...list];
    switch (this.sortBy) {
      case 'rankBest':
        return sorted.sort((a, b) => rank(a) - rank(b) || byName(a, b));
      case 'rankWorst':
        return sorted.sort((a, b) => rank(b) - rank(a) || byName(a, b));
      case 'expHigh':
        return sorted.sort((a, b) => exp(a) - exp(b) || byName(a, b));
      case 'expLow':
        return sorted.sort((a, b) => exp(b) - exp(a) || byName(a, b));
      case 'name':
        return sorted.sort(byName);
      case 'createdNew':
        return sorted.sort((a, b) => created(b) - created(a) || byName(a, b));
      case 'createdOld':
        return sorted.sort((a, b) => created(a) - created(b) || byName(a, b));
      case 'default':
      default:
        // Mirrors backend default: Top rank first, then alphabetical.
        return sorted.sort((a, b) => {
          const aTop = this.normalizeRanking(a.ranking) === 'Top' ? 0 : 1;
          const bTop = this.normalizeRanking(b.ranking) === 'Top' ? 0 : 1;
          return aTop - bTop || byName(a, b);
        });
    }
  }

  trackCleaner(_: number, item: CleanerListItem): number {
    return item.id;
  }

  trackNote(_: number, note: { id: number }): number {
    return note.id;
  }

  trackOrder(_: number, order: { orderId: number }): number {
    return order.orderId;
  }

  private emptyFormModel(): UpdateCleanerPayload {
    return {
      firstName: '',
      lastName: '',
      age: null,
      experience: 'None',
      phone: null,
      email: null,
      address: null,
      location: null,
      busyDaysOfWeek: [],
      vacations: [],
      alreadyWorkedWithUs: false,
      nationality: 'Georgian',
      ranking: 'Standard',
      restrictedReason: null,
      allergies: null,
      restrictions: null,
      mainNote: null,
      documentType: null,
      paymentMethod: null,
      paymentDetails: null,
      isActive: true
    };
  }

  // Default is fully available: every weekday checked (matches old cleaners with no
  // busy days stored, who are available every day).
  private emptyAvailableDays(): AvailableDays {
    const obj: Partial<AvailableDays> = {};
    for (const d of DAY_ORDER) {
      obj[d] = true;
    }
    return obj as AvailableDays;
  }

  // The stored value is a list of busy-day ints; a day is available when it's NOT busy.
  private intsToAvailableDays(ints: number[] | null | undefined): AvailableDays {
    const base = this.emptyAvailableDays();
    for (const n of ints ?? []) {
      const key = INT_TO_DAY_KEY[n];
      if (key) base[key] = false;
    }
    return base;
  }

  // Back to the stored busy-day ints: every weekday the cleaner is NOT available on.
  private availableDaysToBusyInts(): number[] {
    return DAY_ORDER
      .filter(day => !this.availableDays[day])
      .map(day => DAY_KEY_TO_INT[day]);
  }

  /** Initial borough-checkbox map, all on or all off. */
  private emptyBoroughs(allSelected: boolean): Record<string, boolean> {
    const obj: Record<string, boolean> = {};
    for (const opt of this.locationOptions) {
      obj[opt.value] = allSelected;
    }
    return obj;
  }

  /** Splits the stored CSV (e.g. "Brooklyn,Queens") into a checkbox map. */
  private csvToBoroughs(csv: string | null | undefined): Record<string, boolean> {
    const list = this.parseBoroughs(csv);
    // Old cleaners with nothing saved default to all boroughs selected.
    if (list.length === 0) {
      return this.emptyBoroughs(true);
    }
    const set = new Set(list);
    const obj: Record<string, boolean> = {};
    for (const opt of this.locationOptions) {
      obj[opt.value] = set.has(opt.value);
    }
    return obj;
  }

  /** Selected boroughs back to CSV for the payload, or null when none selected. */
  private boroughsToCsv(): string | null {
    const selected = this.locationOptions
      .filter(opt => this.operatingBoroughs[opt.value])
      .map(opt => opt.value);
    return selected.length ? selected.join(',') : null;
  }

  /** Parses a borough CSV into a trimmed, non-empty list. */
  private parseBoroughs(csv: string | null | undefined): string[] {
    return (csv || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  /** Human-readable operating areas for cards/detail. Every borough selected (or nothing saved) = "All areas". */
  boroughsDisplay(csv: string | null | undefined): string {
    const list = this.parseBoroughs(csv);
    if (list.length === 0 || this.locationOptions.every(opt => list.includes(opt.value))) {
      return 'All areas';
    }
    return list.join(', ');
  }

  /** Vacation rows ready to POST — only complete rows (both dates) are sent. */
  private buildVacationPayload(): CleanerVacation[] {
    return this.vacations
      .filter(v => v.startDate && v.endDate)
      .map(v => ({
        startDate: v.startDate,
        endDate: v.endDate,
        note: v.note && v.note.trim() ? v.note.trim() : null
      }));
  }

  /** Normalizes an ISO/date string to the yyyy-MM-dd a date input expects. */
  private toDateInput(value: string | null | undefined): string {
    if (!value) return '';
    return value.length >= 10 ? value.substring(0, 10) : value;
  }

  private buildPayload(): CreateCleanerPayload | UpdateCleanerPayload {
    const rankingStr = (this.formModel.ranking ?? 'Standard') as CleanerRanking;
    const docTypeStr = this.formModel.documentType as CleanerDocumentType | null;
    const payMethodStr = normalizeCleanerPaymentMethod(this.formModel.paymentMethod);

    const payload: UpdateCleanerPayload = {
      firstName: this.formModel.firstName.trim(),
      lastName: this.formModel.lastName.trim(),
      age: this.formModel.age ?? null,
      experience: this.normalizeExperience(this.formModel.experience),
      phone: normalizePhone10(this.formModel.phone),
      email: this.nullIfBlank(this.formModel.email),
      // Address is hidden from the UI but preserved on save so it can be re-surfaced later.
      address: this.nullIfBlank(this.formModel.address),
      // Location = where the cleaner lives (single borough); OperatingAreas = where they work (CSV).
      location: this.nullIfBlank(this.formModel.location),
      operatingAreas: this.boroughsToCsv(),
      busyDaysOfWeek: this.availableDaysToBusyInts(),
      vacations: this.buildVacationPayload(),
      alreadyWorkedWithUs: !!this.formModel.alreadyWorkedWithUs,
      nationality: this.nullIfBlank(this.formModel.nationality),
      ranking: RANKING_INDEX[rankingStr] ?? 1,
      restrictedReason: this.nullIfBlank(this.formModel.restrictedReason),
      allergies: this.nullIfBlank(this.formModel.allergies),
      restrictions: this.nullIfBlank(this.formModel.restrictions),
      mainNote: this.nullIfBlank(this.formModel.mainNote),
      documentType: docTypeStr ? DOCUMENT_TYPE_INDEX[docTypeStr] : null,
      paymentMethod: payMethodStr ? CLEANER_PAYMENT_METHOD_INDEX[payMethodStr] : null,
      paymentDetails: this.nullIfBlank(this.formModel.paymentDetails),
      isActive: this.formModel.isActive
    };
    return payload;
  }

  private nullIfBlank(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.toString().trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private extractError(err: any): string {
    return err?.error?.message || err?.error?.title || err?.message || '';
  }
}
