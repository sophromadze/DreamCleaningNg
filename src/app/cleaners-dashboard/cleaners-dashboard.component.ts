import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
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
  CleanerNote
} from '../services/cleaner-management.service';
import { compressImage } from '../utils/image-compression';
import { normalizePhone10, sanitizePhoneInput, telHrefUS } from '../utils/phone.utils';

type ModalMode = 'create' | 'edit';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
interface AvailabilityDayState {
  enabled: boolean;
  from: string;
  to: string;
}

type AvailabilityDays = Record<DayKey, AvailabilityDayState>;
type CleanerExperience = 'Good' | 'Normal' | 'None';

interface AvailabilitySlot {
  day: DayKey;
  from: string;
  to: string;
}

const RANKING_INDEX: Record<CleanerRanking, number> = {
  Top: 0,
  Standard: 1,
  Beginner: 2,
  Restricted: 3
};

const DOCUMENT_TYPE_INDEX: Record<CleanerDocumentType, number> = {
  IdCard: 0,
  Passport: 1,
  DriverLicense: 2
};

const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './cleaners-dashboard.component.html',
  styleUrls: ['./cleaners-dashboard.component.scss']
})
export class CleanersDashboardComponent implements OnInit, OnDestroy {
  cleaners: CleanerListItem[] = [];
  loading = false;
  errorMessage = '';

  searchTerm = '';
  includeInactive = false;
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

  availabilityDays: AvailabilityDays = this.emptyAvailability();

  photoUploading = false;
  documentUploading = false;

  formPhotoFile: File | null = null;
  formPhotoPreview: string | null = null;
  formDocumentFile: File | null = null;
  formDocumentPreview: string | null = null;

  newNote: CreateCleanerNotePayload = { text: '', orderId: null, orderPerformance: null };
  addingNote = false;

  performanceModalOpen = false;
  performanceModal: {
    orderId: number;
    performance: 'Praise' | 'Issue' | 'Warning' | '';
    text: string;
    existingNoteId: number | null;
    saving: boolean;
    error: string;
  } | null = null;

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
    { value: 'Restricted', label: 'Bad' }
  ];

  readonly experienceOptions: { value: CleanerExperience; label: string }[] = [
    { value: 'Good', label: 'Good' },
    { value: 'Normal', label: 'Normal' },
    { value: 'None', label: 'None' }
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
          this.hydrateCleanerMainNotes(list);
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
  }

  openCreate(): void {
    this.formMode = 'create';
    this.editingId = null;
    this.formModel = this.emptyFormModel();
    this.availabilityDays = this.emptyAvailability();
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
      location: detail.location ?? null,
      availability: detail.availability ?? null,
      alreadyWorkedWithUs: detail.alreadyWorkedWithUs,
      nationality: detail.nationality ?? null,
      ranking: this.normalizeRanking(detail.ranking),
      restrictedReason: detail.restrictedReason ?? null,
      allergies: detail.allergies ?? null,
      restrictions: detail.restrictions ?? null,
      mainNote: detail.mainNote ?? null,
      documentType: this.normalizeDocumentType(detail.documentType),
      isActive: detail.isActive
    };
    this.availabilityDays = this.parseAvailability(detail.availability);
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
    this.availabilityDays = this.emptyAvailability();
    this.formPhotoFile = null;
    this.formPhotoPreview = null;
    this.formDocumentFile = null;
    this.formDocumentPreview = null;
    this.editingId = null;
    this.formError = '';
  }

  toggleDay(day: DayKey): void {
    const current = this.availabilityDays[day];
    this.availabilityDays = {
      ...this.availabilityDays,
      [day]: { ...current, enabled: !current.enabled }
    };
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
      },
      error: err => {
        this.addingNote = false;
        this.errorMessage = this.extractError(err) || 'Failed to add note';
      }
    });
  }

  deleteNote(noteId: number): void {
    const confirmed = confirm('Delete this note?');
    if (!confirmed) return;

    this.cleanerService.deleteNote(noteId).subscribe({
      next: () => {
        if (this.selectedDetail) {
          this.selectedDetail.notes = this.selectedDetail.notes.filter(n => n.id !== noteId);
        }
      },
      error: err => {
        this.errorMessage = this.extractError(err) || 'Failed to delete note';
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
      return (['Top', 'Standard', 'Beginner', 'Restricted'][value] ?? 'Standard') as CleanerRanking;
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

  formatAvailability(value: string | null | undefined): string {
    if (!value) return '';
    const slots = this.parseAvailabilityToSlots(value);
    if (!slots.length) return value;
    return slots
      .map(s => `${DAY_LABEL[s.day]} ${s.from}–${s.to}`)
      .join(', ');
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
      location: null,
      availability: null,
      alreadyWorkedWithUs: false,
      nationality: 'Georgian',
      ranking: 'Standard',
      restrictedReason: null,
      allergies: null,
      restrictions: null,
      mainNote: null,
      documentType: null,
      isActive: true
    };
  }

  private emptyAvailability(): AvailabilityDays {
    const obj: Partial<AvailabilityDays> = {};
    for (const d of DAY_ORDER) {
      obj[d] = { enabled: false, from: '09:00', to: '17:00' };
    }
    return obj as AvailabilityDays;
  }

  private parseAvailability(value: string | null | undefined): AvailabilityDays {
    const base = this.emptyAvailability();
    const slots = this.parseAvailabilityToSlots(value);
    for (const slot of slots) {
      base[slot.day] = { enabled: true, from: slot.from, to: slot.to };
    }
    return base;
  }

  private parseAvailabilityToSlots(value: string | null | undefined): AvailabilitySlot[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(p => p && typeof p === 'object' && DAY_ORDER.includes(p.day))
        .map(p => ({ day: p.day as DayKey, from: String(p.from ?? ''), to: String(p.to ?? '') }));
    } catch {
      return [];
    }
  }

  private serializeAvailability(): string | null {
    const slots: AvailabilitySlot[] = [];
    for (const day of DAY_ORDER) {
      const state = this.availabilityDays[day];
      if (state.enabled && state.from && state.to) {
        slots.push({ day, from: state.from, to: state.to });
      }
    }
    if (slots.length === 0) return null;
    return JSON.stringify(slots);
  }

  private buildPayload(): CreateCleanerPayload | UpdateCleanerPayload {
    const rankingStr = (this.formModel.ranking ?? 'Standard') as CleanerRanking;
    const docTypeStr = this.formModel.documentType as CleanerDocumentType | null;

    const payload: UpdateCleanerPayload = {
      firstName: this.formModel.firstName.trim(),
      lastName: this.formModel.lastName.trim(),
      age: this.formModel.age ?? null,
      experience: this.normalizeExperience(this.formModel.experience),
      phone: normalizePhone10(this.formModel.phone),
      email: this.nullIfBlank(this.formModel.email),
      location: this.nullIfBlank(this.formModel.location),
      availability: this.serializeAvailability(),
      alreadyWorkedWithUs: !!this.formModel.alreadyWorkedWithUs,
      nationality: this.nullIfBlank(this.formModel.nationality),
      ranking: RANKING_INDEX[rankingStr] ?? 1,
      restrictedReason: this.nullIfBlank(this.formModel.restrictedReason),
      allergies: this.nullIfBlank(this.formModel.allergies),
      restrictions: this.nullIfBlank(this.formModel.restrictions),
      mainNote: this.nullIfBlank(this.formModel.mainNote),
      documentType: docTypeStr ? DOCUMENT_TYPE_INDEX[docTypeStr] : null,
      isActive: this.formModel.isActive
    };
    return payload;
  }

  private hydrateCleanerMainNotes(list: CleanerListItem[]): void {
    if (!list.length) return;

    const idsMissingMainNote = list
      .filter(item => item.mainNote === undefined)
      .map(item => item.id);

    if (!idsMissingMainNote.length) return;

    const requests = idsMissingMainNote.map(id =>
      this.cleanerService.getById(id).pipe(catchError(() => of(null)))
    );

    forkJoin(requests)
      .pipe(takeUntil(this.destroy$))
      .subscribe(details => {
        const noteById = new Map<number, string | null>();
        for (const detail of details) {
          if (detail) {
            noteById.set(detail.id, detail.mainNote ?? null);
          }
        }

        this.cleaners = this.cleaners.map(item =>
          noteById.has(item.id) ? { ...item, mainNote: noteById.get(item.id) ?? null } : item
        );
        this.cdr.markForCheck();
      });
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
