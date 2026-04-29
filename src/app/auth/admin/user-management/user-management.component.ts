import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService,
  UserAdmin,
  UserPermissions,
  DetailedUser,
  SuperAdminUpdateUserDto,
  UserNote,
  CreateUserNoteDto,
  UpdateUserNoteDto,
  UserCleaningPhotosByOrder,
  UserCleaningPhoto
} from '../../../services/admin.service';
import { OrderService, OrderList } from '../../../services/order.service';
import { Apartment, CreateApartment } from '../../../services/profile.service';
import { BubbleRewardsService } from '../../../services/bubble-rewards.service';
import { environment } from '../../../../environments/environment';
import { normalizePhone10, sanitizePhoneInput } from '../../../utils/phone.utils';

type DetailTab = 'overview' | 'details' | 'history' | 'photos' | 'communications' | 'notes' | 'tasks';
type NoteType = 'General' | 'FollowUp';
type NotesViewTab = 'general' | 'followup' | 'calls' | 'tasks';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.component.html',
  styleUrls: ['./user-management.component.scss']
})
export class UserManagementComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tableWrapper', { static: false }) tableWrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('tableHeader', { static: false }) tableHeader!: ElementRef<HTMLTableSectionElement>;

  users: UserAdmin[] = [];
  loadingUsers = false;
  userRole: string = '';
  currentUserRole: string = '';
  roleDropdownUserId: number | null = null;
  userPermissions: UserPermissions | null = null;
  canCreate = false;
  canUpdate = false;
  canDelete = false;
  canActivate = false;
  canDeactivate = false;
  searchTerm: string = '';
  statusFilter: string = 'all';
  roleFilter: string = 'all';
  currentPage = 1;
  itemsPerPage = 20;
  totalPages = 1;

  errorMessage = '';
  successMessage = '';

  showRegisterModal = false;
  registerForm = {
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  };
  isRegistering = false;
  registerModalError = '';

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

  // ── Detail panel state ──
  selectedUser: DetailedUser | null = null;
  viewingUserId: number | null = null;
  loadingUserDetails = false;
  detailTab: DetailTab = 'overview';

  // SuperAdmin full edit
  editingUser = false;
  editUserForm: SuperAdminUpdateUserDto = { firstName: '', lastName: '', email: '', role: 'Customer', isActive: true, firstTimeOrder: true, canReceiveCommunications: true, canReceiveEmails: true, canReceiveMessages: true };
  savingUser = false;
  togglingCommsUserId: number | null = null;

  // Address editing (SuperAdmin)
  editingAddressId: number | null = null;
  showAddAddress = false;
  newAddress: CreateApartment = { name: '', address: '', city: '', state: '', postalCode: '' };
  savingAddress = false;

  // Bubble Rewards (admin view)
  userRewardsSummary: any = null;
  rewardsLoading = false;
  adjustPointsAmount: number = 0;
  adjustPointsDesc: string = '';
  savingPoints = false;
  pointsSaveMessage = '';

  // Referral management (SuperAdmin)
  newReferralEmail = '';
  newReferralSearchResults: { id: number; email: string; name: string }[] = [];
  addingReferral = false;
  referralActionMessage = '';
  removingReferralId: number | null = null;
  removingReferredBy = false;

  // ── Customer-care: notes ──
  generalNotes: UserNote[] = [];
  followUpNotes: UserNote[] = [];
  loadingNotes = false;

  newNoteType: NoteType = 'General';
  notesViewTab: NotesViewTab = 'followup';
  newNoteContent = '';
  newNoteNextOffer = '';
  savingNote = false;

  editingNoteId: number | null = null;
  editNoteContent = '';
  editNoteNextOffer = '';

  // ── Customer-care: photos ──
  cleaningPhotoGroups: UserCleaningPhotosByOrder[] = [];
  loadingPhotos = false;
  uploadingPhoto = false;
  /** Progress label shown on the upload button while a batch is in flight (e.g. "Uploading 2/5…"). */
  photoUploadProgress = '';
  photoUploadOrderId: number | null = null;
  photoUploadError = '';
  photoUploadSuccess = '';
  lightboxPhoto: UserCleaningPhoto | null = null;

  // ── Customer-care: communications ──
  communications: any[] = [];
  loadingComms = false;
  newComm = {
    type: 'Outgoing Call',
    notes: '',
    status: 'Pending'
  };
  editingCommunicationId: number | null = null;
  savingComm = false;
  commTypes = [
    'Incoming Call',
    'Outgoing Call',
    'Email',
    'SMS',
    'No Answer',
    'Refused',
    'Voicemail',
    'Other'
  ];
  commStatuses = ['Pending', 'Resolved', 'Closed', 'Requires Follow-up'];

  // ── Customer-care: tasks ──
  userTasks: any[] = [];
  loadingTasks = false;
  private residentialVariantCache: Map<number, 'Deep' | 'Regular'> = new Map();
  private userLastCleaningVariantCache: Map<number, 'Deep' | 'Regular'> = new Map();
  overviewTimelineItems: Array<{
    date: Date;
    typeLabel: string;
    admin: string;
    body: string;
    iconClass: string;
  }> = [];
  overviewPhotoThumbs: UserCleaningPhoto[] = [];
  overviewRecentOrders: OrderList[] = [];

  constructor(
    private adminService: AdminService,
    private orderService: OrderService,
    private bubbleRewardsService: BubbleRewardsService
  ) {}

  ngOnInit() {
    this.loadUserPermissions();
    this.loadUsers();
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
    if (!this.tableWrapper || !this.tableHeader) return;
    if (this.stickyHeaderInitialized) {
      this.updateStickyHeader();
      return;
    }

    this.scrollListener = () => this.updateStickyHeader();
    window.addEventListener('scroll', this.scrollListener, true);

    this.horizontalScrollListener = () => this.syncHorizontalScroll();
    const wrapperEl = this.tableWrapper.nativeElement;
    wrapperEl.addEventListener('scroll', this.horizontalScrollListener, { passive: true });
    wrapperEl.addEventListener('touchmove', this.horizontalScrollListener, { passive: true });
    wrapperEl.addEventListener('wheel', this.horizontalScrollListener, { passive: true });

    this.stickyHeaderInitialized = true;
    this.updateStickyHeader();
  }

  private updateStickyHeader() {
    if (!this.tableWrapper || !this.tableHeader) return;

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

      const cellWidths: number[] = [];
      if (firstDataRow) {
        const dataCells = firstDataRow.querySelectorAll('td');
        dataCells.forEach((td: Element, index: number) => {
          const cellRect = (td as HTMLElement).getBoundingClientRect();
          cellWidths[index] = cellRect.width;
        });
      } else {
        headerCells.forEach((th: Element) => {
          const cellRect = (th as HTMLElement).getBoundingClientRect();
          cellWidths.push(cellRect.width);
        });
      }

      const wrapperLeft = rect.left;
      const tableRect = table.getBoundingClientRect();
      const tableWidth = tableRect.width;

      header.style.position = 'fixed';
      header.style.top = `${offset}px`;
      header.style.left = `${wrapperLeft}px`;
      header.style.width = `${tableWidth}px`;
      header.style.zIndex = '100';
      header.style.backgroundColor = '#f8f9fa';
      header.style.display = 'table-header-group';
      header.style.tableLayout = 'fixed';
      header.style.overflow = 'hidden';

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

      setTimeout(() => this.syncHorizontalScroll(), 0);
    } else {
      header.style.position = '';
      header.style.top = '';
      header.style.left = '';
      header.style.width = '';
      header.style.zIndex = '';
      header.style.transform = '';
      header.style.webkitTransform = '';
      header.style.display = '';
      header.style.tableLayout = '';
      header.style.overflow = '';
      header.style.maxWidth = '';
      header.style.willChange = '';

      const headerRow = header.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = '';
        headerRow.style.width = '';
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

      const table = header.closest('table') as HTMLTableElement;
      if (table) {
        const firstDataRow = table.querySelector('tbody tr') as HTMLTableRowElement;
        if (firstDataRow) {
          const dataCells = firstDataRow.querySelectorAll('td');
          dataCells.forEach((td: Element) => {
            const tdElement = td as HTMLElement;
            tdElement.style.width = '';
            tdElement.style.minWidth = '';
            tdElement.style.maxWidth = '';
          });
        }
      }
    }
  }

  private syncHorizontalScroll() {
    if (!this.tableWrapper || !this.tableHeader) return;

    const wrapper = this.tableWrapper.nativeElement;
    const header = this.tableHeader.nativeElement;

    if (header.style.position === 'fixed') {
      const scrollLeft = wrapper.scrollLeft;
      const wrapperRect = wrapper.getBoundingClientRect();
      const wrapperLeft = wrapperRect.left;

      header.style.left = `${wrapperLeft}px`;
      header.style.transform = `translate3d(-${scrollLeft}px, 0, 0)`;
      header.style.webkitTransform = `translate3d(-${scrollLeft}px, 0, 0)`;
      header.style.willChange = 'transform';
    }
  }

  loadUserPermissions() {
    this.adminService.getUserPermissions().subscribe({
      next: (permissions) => {
        this.userPermissions = permissions;
        this.userRole = permissions.role;
        this.currentUserRole = permissions.role;

        this.canCreate = permissions.permissions.canCreate;
        this.canUpdate = permissions.permissions.canUpdate;
        this.canDelete = permissions.permissions.canDelete;
        this.canActivate = permissions.permissions.canActivate;
        this.canDeactivate = permissions.permissions.canDeactivate;
      },
      error: (error) => {
        console.error('Failed to load permissions', error);
        this.userRole = '';
        this.canCreate = false;
        this.canUpdate = false;
        this.canDelete = false;
        this.canActivate = false;
        this.canDeactivate = false;
      }
    });
  }

  loadUsers() {
    if (this.loadingUsers) return;

    this.loadingUsers = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.currentPage = 1;
    this.roleDropdownUserId = null;
    this.closeDetailPanel();
    this.userLastCleaningVariantCache.clear();

    this.adminService.getUsers(true).subscribe({
      next: (response) => {
        this.users = Array.isArray(response) ? response : response.users;
        this.resolveUserLastCleaningVariants(this.users);
      },
      error: (error) => {
        console.error('Failed to load users', error);
        this.errorMessage = error?.error?.message || 'Failed to load users. Please try again.';
      },
      complete: () => {
        this.loadingUsers = false;
        setTimeout(() => {
          if (!this.stickyHeaderInitialized) {
            this.initializeStickyHeader();
          } else {
            this.updateStickyHeader();
          }
        }, 150);
      }
    });
  }

  // ── Detail panel ──

  openUserDetails(user: UserAdmin): void {
    if (this.viewingUserId === user.id) {
      this.closeDetailPanel();
      return;
    }

    this.viewingUserId = user.id;
    this.detailTab = 'overview';
    this.roleDropdownUserId = null;
    this.editingUser = false;
    this.loadingUserDetails = true;
    this.selectedUser = { ...user };

    // Reset child sections
    this.generalNotes = [];
    this.followUpNotes = [];
    this.cleaningPhotoGroups = [];
    this.communications = [];
    this.userTasks = [];
    this.editingNoteId = null;
    this.newNoteContent = '';
    this.newNoteNextOffer = '';
    this.notesViewTab = 'followup';

    this.loadUserOrders(user.id);
    this.loadUserApartments(user.id);
    this.loadUserRewards(user.id);
    this.loadUserNotes(user.id);
    this.loadCommunications(user.id);
    this.loadUserTasksList(user.id);
    this.loadCleaningPhotos(user.id);
    this.refreshOverviewCollections();
  }

  openUserDetailsTab(user: UserAdmin, tab: DetailTab, event?: Event): void {
    if (event) event.stopPropagation();
    if (this.viewingUserId !== user.id) {
      this.openUserDetails(user);
      setTimeout(() => this.setDetailTab(tab), 0);
      return;
    }
    this.setDetailTab(tab);
  }

  closeDetailPanel(): void {
    this.viewingUserId = null;
    this.selectedUser = null;
    this.editingUser = false;
    this.userRewardsSummary = null;
    this.lightboxPhoto = null;
  }

  setDetailTab(tab: DetailTab): void {
    this.detailTab = tab;
    if (!this.selectedUser) return;
    if (tab === 'notes') {
      this.notesViewTab = 'followup';
      this.newNoteType = 'FollowUp';
    }
    if (tab === 'photos' && this.cleaningPhotoGroups.length === 0 && !this.loadingPhotos) {
      this.loadCleaningPhotos(this.selectedUser.id);
    }
    if (tab === 'communications' && this.communications.length === 0 && !this.loadingComms) {
      this.loadCommunications(this.selectedUser.id);
    }
    if (tab === 'tasks' && this.userTasks.length === 0 && !this.loadingTasks) {
      this.loadUserTasksList(this.selectedUser.id);
    }
  }

  setNotesViewTab(tab: NotesViewTab): void {
    this.notesViewTab = tab;
    if (tab === 'general') this.newNoteType = 'General';
    if (tab === 'followup') this.newNoteType = 'FollowUp';
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.lightboxPhoto) {
      this.lightboxPhoto = null;
      return;
    }
    if (this.viewingUserId !== null) {
      this.closeDetailPanel();
    }
  }

  // ── Detail data loaders ──

  private loadUserOrders(userId: number) {
    this.adminService.getUserOrders(userId).subscribe({
      next: (orders: OrderList[]) => {
        if (this.selectedUser && this.selectedUser.id === userId) {
          const validOrders = orders.filter(order =>
            order.status && order.status.toLowerCase() !== 'cancelled'
          );

          this.selectedUser.orders = orders;
          this.residentialVariantCache.clear();
          this.resolveResidentialVariantsForOverview(orders);
          this.selectedUser.totalOrders = validOrders.length;
          this.selectedUser.totalSpent = validOrders.reduce((sum, order) => sum + (order.total || 0), 0);
          this.selectedUser.registrationDate = new Date(this.selectedUser.createdAt);

          if (validOrders.length > 0) {
            const sorted = validOrders.sort((a, b) =>
              new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
            );
            this.selectedUser.lastOrderDate = new Date(sorted[0].orderDate);
          }
        }
        this.refreshOverviewCollections();
        this.loadingUserDetails = false;
      },
      error: (error) => {
        console.error('Failed to load user orders', error);
        if (this.selectedUser && this.selectedUser.id === userId) {
          this.selectedUser.orders = [];
          this.selectedUser.totalOrders = 0;
          this.selectedUser.totalSpent = 0;
        }
        this.refreshOverviewCollections();
        this.loadingUserDetails = false;
      }
    });
  }

  private loadUserApartments(userId: number) {
    this.adminService.getUserApartments(userId).subscribe({
      next: (apartments: Apartment[]) => {
        if (this.selectedUser && this.selectedUser.id === userId) {
          this.selectedUser.apartments = apartments;
        }
      },
      error: () => {
        if (this.selectedUser && this.selectedUser.id === userId) {
          this.selectedUser.apartments = [];
        }
      }
    });
  }

  loadUserRewards(userId: number): void {
    this.rewardsLoading = true;
    this.userRewardsSummary = null;
    this.adjustPointsDesc = '';
    this.newReferralEmail = '';
    this.newReferralSearchResults = [];
    this.referralActionMessage = '';
    this.bubbleRewardsService.getAdminUserSummary(userId).subscribe({
      next: (s) => {
        this.userRewardsSummary = s;
        this.adjustPointsAmount = s.currentPoints ?? 0;
        this.rewardsLoading = false;
      },
      error: () => { this.rewardsLoading = false; }
    });
  }

  // ── Notes ──

  private loadUserNotes(userId: number): void {
    this.loadingNotes = true;
    this.adminService.getUserCareNotes(userId).subscribe({
      next: (notes) => {
        if (this.selectedUser?.id !== userId) return;
        this.generalNotes = notes.filter(n => n.type === 'General');
        this.followUpNotes = notes.filter(n => n.type === 'FollowUp');
        this.refreshOverviewCollections();
        this.loadingNotes = false;
      },
      error: () => { this.loadingNotes = false; }
    });
  }

  saveNewNote(): void {
    if (!this.selectedUser || this.savingNote) return;
    const content = this.newNoteContent.trim();
    if (!content) return;

    const dto: CreateUserNoteDto = {
      type: this.newNoteType,
      content,
      nextOffer: this.newNoteType === 'FollowUp' && this.newNoteNextOffer.trim()
        ? this.newNoteNextOffer.trim()
        : null
    };

    this.savingNote = true;
    this.adminService.createUserCareNote(this.selectedUser.id, dto).subscribe({
      next: (note) => {
        if (note.type === 'General') this.generalNotes = [note, ...this.generalNotes];
        else this.followUpNotes = [note, ...this.followUpNotes];
        this.newNoteContent = '';
        this.newNoteNextOffer = '';
        this.savingNote = false;
        this.successMessage = 'Note added.';
        this.refreshOverviewCollections();
        setTimeout(() => this.successMessage = '', 2500);
      },
      error: (err) => {
        this.savingNote = false;
        this.errorMessage = err?.error?.message || 'Failed to save note.';
        setTimeout(() => this.errorMessage = '', 3000);
      }
    });
  }

  startEditNote(note: UserNote): void {
    this.editingNoteId = note.id;
    this.editNoteContent = note.content;
    this.editNoteNextOffer = note.nextOffer || '';
  }

  cancelEditNote(): void {
    this.editingNoteId = null;
    this.editNoteContent = '';
    this.editNoteNextOffer = '';
  }

  saveEditNote(note: UserNote): void {
    if (this.editingNoteId !== note.id) return;
    const content = this.editNoteContent.trim();
    if (!content) return;

    const dto: UpdateUserNoteDto = {
      content,
      nextOffer: note.type === 'FollowUp' && this.editNoteNextOffer.trim()
        ? this.editNoteNextOffer.trim()
        : null
    };

    this.adminService.updateUserCareNote(note.id, dto).subscribe({
      next: (updated) => {
        const apply = (arr: UserNote[]) => {
          const idx = arr.findIndex(n => n.id === updated.id);
          if (idx >= 0) arr[idx] = updated;
        };
        apply(this.generalNotes);
        apply(this.followUpNotes);
        this.cancelEditNote();
        this.refreshOverviewCollections();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to update note.';
        setTimeout(() => this.errorMessage = '', 3000);
      }
    });
  }

  deleteNote(note: UserNote): void {
    if (!confirm('Delete this note?')) return;
    this.adminService.deleteUserCareNote(note.id).subscribe({
      next: () => {
        this.generalNotes = this.generalNotes.filter(n => n.id !== note.id);
        this.followUpNotes = this.followUpNotes.filter(n => n.id !== note.id);
        this.refreshOverviewCollections();
      }
    });
  }

  // ── Photos ──

  private loadCleaningPhotos(userId: number): void {
    this.loadingPhotos = true;
    this.adminService.getUserCleaningPhotos(userId).subscribe({
      next: (groups) => {
        if (this.selectedUser?.id !== userId) return;
        this.cleaningPhotoGroups = groups;
        this.refreshOverviewCollections();
        this.loadingPhotos = false;
      },
      error: () => { this.loadingPhotos = false; }
    });
  }

  /** Select an order to attach the next upload to. Used by the upload form. */
  setPhotoOrderId(orderId: number | null | undefined): void {
    this.photoUploadOrderId = orderId ?? null;
  }

  onPhotoFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !this.selectedUser) return;
    const files = Array.from(input.files);
    input.value = '';
    this.uploadPhotosSequentially(files);
  }

  /**
   * Uploads multiple files one at a time so the backend's "keep last 2 orders" prune
   * runs against a stable set; refreshes the gallery once at the end. Any individual
   * failure is recorded but doesn't abort the remaining uploads.
   */
  private uploadPhotosSequentially(files: File[]): void {
    if (!this.selectedUser || this.uploadingPhoto || files.length === 0) return;
    this.uploadingPhoto = true;
    this.photoUploadError = '';
    this.photoUploadSuccess = '';
    this.photoUploadProgress = '';

    const total = files.length;
    let okCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    const uploadOne = (index: number) => {
      if (!this.selectedUser) {
        this.uploadingPhoto = false;
        this.photoUploadProgress = '';
        return;
      }
      if (index >= total) {
        // All done — refresh once and report
        this.uploadingPhoto = false;
        this.photoUploadProgress = '';
        if (okCount > 0) {
          this.photoUploadSuccess = total === 1
            ? 'Photo uploaded.'
            : `${okCount} of ${total} photo${total === 1 ? '' : 's'} uploaded.`;
          setTimeout(() => this.photoUploadSuccess = '', 3000);
        }
        if (failCount > 0) {
          this.photoUploadError = `${failCount} upload${failCount === 1 ? '' : 's'} failed${errors[0] ? ': ' + errors[0] : ''}.`;
          setTimeout(() => this.photoUploadError = '', 5000);
        }
        if (this.selectedUser) this.loadCleaningPhotos(this.selectedUser.id);
        return;
      }

      this.photoUploadProgress = total > 1 ? `Uploading ${index + 1}/${total}…` : 'Uploading…';

      this.adminService.uploadUserCleaningPhoto(
        this.selectedUser.id,
        files[index],
        this.photoUploadOrderId ?? undefined
      ).subscribe({
        next: () => { okCount++; uploadOne(index + 1); },
        error: (err) => {
          failCount++;
          if (errors.length === 0) errors.push(err?.error?.message || 'Failed to upload photo.');
          uploadOne(index + 1);
        }
      });
    };

    uploadOne(0);
  }

  removePhoto(photo: UserCleaningPhoto): void {
    if (!confirm('Remove this photo?')) return;
    this.adminService.deleteUserCleaningPhoto(photo.id).subscribe({
      next: () => {
        if (this.selectedUser) this.loadCleaningPhotos(this.selectedUser.id);
      }
    });
  }

  openLightbox(photo: UserCleaningPhoto): void {
    this.lightboxPhoto = photo;
  }

  closeLightbox(): void {
    this.lightboxPhoto = null;
  }

  /**
   * Photo URLs are stored as root-relative paths like "/user-cleaning-photos/...".
   * The dev-server proxy maps that prefix to the backend (proxy.conf.json),
   * and in production the backend serves it directly. Same pattern as cleaner photos.
   */
  resolvePhotoUrl(url: string | undefined | null): string {
    return url || '';
  }

  // ── Communications ──

  private loadCommunications(userId: number): void {
    this.loadingComms = true;
    this.adminService.getUserCommunications(userId).subscribe({
      next: (items) => {
        if (this.selectedUser?.id !== userId) return;
        this.communications = items;
        this.refreshOverviewCollections();
        this.loadingComms = false;
      },
      error: () => { this.loadingComms = false; }
    });
  }

  saveCommunication(): void {
    if (!this.selectedUser || this.savingComm) return;
    const type = (this.newComm.type || '').trim();
    if (!type) return;

    this.savingComm = true;

    // Edit path — preserves the original timestamp & id via PUT.
    if (this.editingCommunicationId) {
      const editId = this.editingCommunicationId;
      this.adminService.updateUserCommunication(editId, {
        type,
        notes: this.newComm.notes?.trim() || null,
        status: this.newComm.status
      }).subscribe({
        next: (updated) => {
          const idx = this.communications.findIndex(c => c.id === editId);
          if (idx >= 0) this.communications[idx] = updated;
          this.refreshOverviewCollections();
          this.newComm = { type: 'Outgoing Call', notes: '', status: 'Pending' };
          this.editingCommunicationId = null;
          this.savingComm = false;
        },
        error: (err) => {
          this.savingComm = false;
          this.errorMessage = err?.error?.message || 'Failed to update communication.';
          setTimeout(() => this.errorMessage = '', 3000);
        }
      });
      return;
    }

    // Create path
    const fullName = `${this.selectedUser.firstName || ''} ${this.selectedUser.lastName || ''}`.trim();
    this.adminService.createUserCommunication(this.selectedUser.id, {
      type,
      notes: this.newComm.notes?.trim() || undefined,
      status: this.newComm.status,
      clientName: fullName || undefined
    }).subscribe({
      next: (item) => {
        this.communications = [item, ...this.communications];
        this.refreshOverviewCollections();
        this.newComm = { type: 'Outgoing Call', notes: '', status: 'Pending' };
        this.savingComm = false;
      },
      error: (err) => {
        this.savingComm = false;
        this.errorMessage = err?.error?.message || 'Failed to log communication.';
        setTimeout(() => this.errorMessage = '', 3000);
      }
    });
  }

  removeCommunication(item: any): void {
    if (!confirm('Remove this communication entry?')) return;
    this.adminService.deleteUserCommunication(item.id).subscribe({
      next: () => {
        this.communications = this.communications.filter(c => c.id !== item.id);
        this.refreshOverviewCollections();
      }
    });
  }

  startEditCommunication(item: any): void {
    this.editingCommunicationId = item.id;
    this.newComm = {
      type: item.type || 'Outgoing Call',
      notes: item.notes || '',
      status: item.status || 'Pending'
    };
  }

  cancelEditCommunication(): void {
    this.editingCommunicationId = null;
    this.newComm = { type: 'Outgoing Call', notes: '', status: 'Pending' };
  }

  /** Returns CSS class name for a communication type chip. */
  commTypeClass(type: string): string {
    const t = (type || '').toLowerCase();
    if (t.includes('incoming')) return 'comm-incoming';
    if (t.includes('outgoing')) return 'comm-outgoing';
    if (t.includes('email')) return 'comm-email';
    if (t.includes('sms')) return 'comm-sms';
    if (t.includes('no answer') || t.includes('voicemail')) return 'comm-noanswer';
    if (t.includes('refused')) return 'comm-refused';
    return 'comm-other';
  }

  // ── Tasks ──

  private loadUserTasksList(userId: number): void {
    this.loadingTasks = true;
    this.adminService.getUserTasks(userId).subscribe({
      next: (items) => {
        if (this.selectedUser?.id !== userId) return;
        this.userTasks = items;
        this.loadingTasks = false;
      },
      error: () => { this.loadingTasks = false; }
    });
  }

  // ── Existing role / status / comms toggle methods (unchanged behaviour) ──

  toggleRoleDropdown(userId: number) {
    this.roleDropdownUserId = this.roleDropdownUserId === userId ? null : userId;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.role-dropdown')) {
      this.roleDropdownUserId = null;
    }
  }

  canChangeUserRole(user: UserAdmin, newRole: string): boolean {
    const currentUserId = this.getCurrentUserId();
    if (user.id === currentUserId) return false;
    if (this.currentUserRole === 'SuperAdmin') return true;
    if (this.currentUserRole === 'Admin' && user.role !== 'SuperAdmin') return true;
    return false;
  }

  canModifyUserRole(user: any): boolean {
    const currentUserId = this.getCurrentUserId();
    if (user.id === currentUserId) return false;
    if (this.currentUserRole === 'Admin' && user.role === 'SuperAdmin') return false;
    return this.canUpdate;
  }

  getRoleButtonTooltip(user: any): string {
    const currentUserId = this.getCurrentUserId();
    if (user.id === currentUserId) return 'You cannot change your own role';
    if (this.currentUserRole === 'Admin' && user.role === 'SuperAdmin') return 'Admins cannot modify SuperAdmin roles';
    return '';
  }

  updateUserRole(user: UserAdmin, newRole: string) {
    if (!this.canChangeUserRole(user, newRole)) return;

    this.errorMessage = '';
    this.successMessage = '';

    const originalRole = user.role;
    user.role = newRole;

    this.adminService.updateUserRole(user.id, newRole).subscribe({
      next: () => {
        this.roleDropdownUserId = null;
        if (this.selectedUser && this.selectedUser.id === user.id) {
          this.selectedUser.role = newRole;
        }
        this.successMessage = `Role updated to ${this.displayRole(newRole)}.`;
        setTimeout(() => this.successMessage = '', 4000);
      },
      error: (error) => {
        user.role = originalRole;
        this.errorMessage = error.error?.message || 'Failed to update user role.';
        setTimeout(() => this.errorMessage = '', 4000);
      }
    });
  }

  updateUserStatus(user: UserAdmin, isActive: boolean) {
    this.errorMessage = '';
    this.successMessage = '';

    const originalStatus = user.isActive;
    user.isActive = isActive;

    this.adminService.updateUserStatus(user.id, isActive).subscribe({
      next: () => {
        const action = isActive ? 'unblocked' : 'blocked';
        if (this.selectedUser && this.selectedUser.id === user.id) {
          this.selectedUser.isActive = isActive;
        }
        this.successMessage = `${user.firstName} ${user.lastName} has been ${action}.`;
        setTimeout(() => this.successMessage = '', 4000);
      },
      error: (error) => {
        user.isActive = originalStatus;
        this.errorMessage = error.error?.message || 'Failed to update user status.';
        setTimeout(() => this.errorMessage = '', 4000);
      }
    });
  }

  canModifyUserStatus(user: any): boolean {
    if (this.currentUserRole === 'Admin' && user.role === 'SuperAdmin') return false;
    return true;
  }

  canBanUser(user: any): boolean {
    const currentUserId = this.getCurrentUserId();
    if (user.id === currentUserId) return false;
    return this.canDeactivate && user.isActive && this.canModifyUserStatus(user);
  }

  canUnbanUser(user: any): boolean {
    return this.canActivate && !user.isActive && this.canModifyUserStatus(user);
  }

  private getCurrentUserId(): number {
    if (environment.useCookieAuth) return 0;

    const token = localStorage.getItem('token');
    if (token) {
      try {
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) return 0;
        const payload = JSON.parse(atob(tokenParts[1]));
        return parseInt(payload.UserId || payload.sub);
      } catch {
        return 0;
      }
    }
    return 0;
  }

  getUserOnlineStatus(userId: number): void {
    this.adminService.getUserOnlineStatus(userId).subscribe({
      next: () => {},
      error: (error) => console.error('Failed to get user online status:', error)
    });
  }

  get filteredUsers(): UserAdmin[] {
    let filtered = this.users;
    if (this.searchTerm) {
      const search = this.searchTerm.toLowerCase();
      filtered = filtered.filter(user =>
        user.id.toString().includes(search) ||
        (user.email && user.email.toLowerCase().includes(search)) ||
        ((user.firstName || '') + ' ' + (user.lastName || '')).toLowerCase().includes(search) ||
        (user.phone && user.phone.toLowerCase().includes(search))
      );
    }
    if (this.statusFilter !== 'all') {
      filtered = filtered.filter(user =>
        (this.statusFilter === 'active' && user.isActive) ||
        (this.statusFilter === 'inactive' && !user.isActive)
      );
    }
    if (this.roleFilter !== 'all') {
      filtered = filtered.filter(user => user.role && user.role.toLowerCase() === this.roleFilter.toLowerCase());
    }
    filtered = filtered.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });
    this.totalPages = Math.ceil(filtered.length / this.itemsPerPage);
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return filtered.slice(start, start + this.itemsPerPage);
  }

  previousPage() { if (this.currentPage > 1) this.currentPage--; }
  nextPage() { if (this.currentPage < this.totalPages) this.currentPage++; }
  goToPage(page: number) { if (page >= 1 && page <= this.totalPages) this.currentPage = page; }

  formatDate(date: any): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  formatShortDate(date: any): string {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }

  formatDateTime(date: any): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' • ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatCurrency(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }

  getStatusClass(status: string): string {
    switch ((status || '').toLowerCase()) {
      case 'active': return 'status-active';
      case 'done': return 'status-done';
      case 'cancelled': return 'status-cancelled';
      default: return 'status-pending';
    }
  }

  get isSuperAdmin(): boolean {
    return this.currentUserRole === 'SuperAdmin';
  }

  /** Returns true if the user is an internal staff role (badge shown). */
  isStaffRole(role: string | undefined | null): boolean {
    return role === 'Admin' || role === 'SuperAdmin' || role === 'Moderator';
  }

  /** Returns initials for avatar bubble. */
  getInitials(firstName: string | undefined, lastName: string | undefined): string {
    const f = (firstName || '').trim().charAt(0);
    const l = (lastName || '').trim().charAt(0);
    const combined = (f + l).toUpperCase();
    return combined || '?';
  }

  /** Deterministic avatar bg color from user id. */
  getAvatarColor(id: number): string {
    const palette = ['#4f46e5', '#0891b2', '#ea580c', '#9333ea', '#db2777', '#16a34a', '#0284c7', '#dc2626'];
    return palette[Math.abs(id) % palette.length];
  }

  // ── Bubble rewards: existing methods ──

  getTierLabel(tier: string): string {
    if (tier === 'UltraBubble') return 'Ultra Bubble';
    if (tier === 'SuperBubble') return 'Super Bubble';
    return 'Bubble';
  }

  savePointsAdjustment(): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.savingPoints) return;
    const newTotal = Number(this.adjustPointsAmount);
    if (isNaN(newTotal) || newTotal < 0) return;
    const currentPoints = this.userRewardsSummary?.currentPoints ?? 0;
    const delta = newTotal - currentPoints;
    if (delta === 0) return;
    this.savingPoints = true;
    this.bubbleRewardsService.adjustUserPoints(
      this.selectedUser.id,
      delta,
      this.adjustPointsDesc || 'Admin adjustment'
    ).subscribe({
      next: () => {
        this.savingPoints = false;
        this.adjustPointsDesc = '';
        this.pointsSaveMessage = `Points set to ${newTotal.toLocaleString()}.`;
        this.loadUserRewards(this.selectedUser!.id);
        setTimeout(() => this.pointsSaveMessage = '', 3000);
      },
      error: () => { this.savingPoints = false; }
    });
  }

  searchReferrals(query: string): void {
    if (!this.selectedUser || query.length < 2) { this.newReferralSearchResults = []; return; }
    this.bubbleRewardsService.searchEligibleReferrals(this.selectedUser.id, query).subscribe({
      next: (r) => this.newReferralSearchResults = r,
      error: () => this.newReferralSearchResults = []
    });
  }

  selectReferralSuggestion(email: string): void {
    this.newReferralEmail = email;
    this.newReferralSearchResults = [];
  }

  addReferredUser(): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.addingReferral || !this.newReferralEmail.trim()) return;
    this.addingReferral = true;
    this.referralActionMessage = '';
    this.bubbleRewardsService.addReferredUser(this.selectedUser.id, this.newReferralEmail.trim()).subscribe({
      next: () => {
        this.addingReferral = false;
        this.newReferralEmail = '';
        this.newReferralSearchResults = [];
        this.referralActionMessage = 'Referred user added.';
        this.loadUserRewards(this.selectedUser!.id);
        setTimeout(() => this.referralActionMessage = '', 3000);
      },
      error: (err) => {
        this.addingReferral = false;
        this.referralActionMessage = err?.error?.message ?? 'Failed to add referred user.';
        setTimeout(() => this.referralActionMessage = '', 4000);
      }
    });
  }

  removeReferredUser(referralId: number): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.removingReferralId != null) return;
    this.removingReferralId = referralId;
    this.referralActionMessage = '';
    this.bubbleRewardsService.removeReferredUser(this.selectedUser.id, referralId).subscribe({
      next: () => {
        this.removingReferralId = null;
        this.loadUserRewards(this.selectedUser!.id);
      },
      error: (err) => {
        this.removingReferralId = null;
        this.referralActionMessage = err?.error?.message ?? 'Failed to remove.';
        setTimeout(() => this.referralActionMessage = '', 4000);
      }
    });
  }

  removeReferredBy(): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.removingReferredBy) return;
    this.removingReferredBy = true;
    this.referralActionMessage = '';
    this.bubbleRewardsService.removeReferredBy(this.selectedUser.id).subscribe({
      next: () => {
        this.removingReferredBy = false;
        this.loadUserRewards(this.selectedUser!.id);
      },
      error: (err) => {
        this.removingReferredBy = false;
        this.referralActionMessage = err?.error?.message ?? 'Failed to remove.';
        setTimeout(() => this.referralActionMessage = '', 4000);
      }
    });
  }

  openOrderInAdmin(orderId: number): void {
    window.open('/admin?orderId=' + orderId, '_blank');
  }

  onEditPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    if (input.value !== cleaned) input.value = cleaned;
    this.editUserForm.phone = cleaned || null;
  }

  onRegisterPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    if (input.value !== cleaned) input.value = cleaned;
    this.registerForm.phone = cleaned;
  }

  callUser(user: UserAdmin, event?: Event): void {
    if (event) event.stopPropagation();
    const phone = normalizePhone10(user.phone);
    if (!phone) return;
    window.location.href = `tel:${phone}`;
  }

  startEditUser(): void {
    if (!this.selectedUser || !this.isSuperAdmin) return;
    this.editUserForm = {
      firstName: this.selectedUser.firstName,
      lastName: this.selectedUser.lastName,
      email: this.selectedUser.email,
      phone: normalizePhone10(this.selectedUser.phone),
      role: this.selectedUser.role,
      isActive: this.selectedUser.isActive,
      firstTimeOrder: this.selectedUser.firstTimeOrder,
      canReceiveCommunications: this.selectedUser.canReceiveCommunications !== false,
      canReceiveEmails: this.userCanReceiveEmails(this.selectedUser),
      canReceiveMessages: this.userCanReceiveMessages(this.selectedUser)
    };
    this.editingUser = true;
  }

  cancelEditUser(): void {
    this.editingUser = false;
    this.editingAddressId = null;
    this.showAddAddress = false;
    this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
  }

  saveUserEdit(): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.savingUser) return;
    this.editUserForm.phone = normalizePhone10(this.editUserForm.phone);
    this.savingUser = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.superAdminFullUpdateUser(this.selectedUser.id, this.editUserForm).subscribe({
      next: () => {
        this.successMessage = 'User updated successfully.';
        this.editingUser = false;
        Object.assign(this.selectedUser!, this.editUserForm);
        const userIndex = this.users.findIndex(user => user.id === this.selectedUser!.id);
        if (userIndex !== -1) {
          const updatedUser = this.users[userIndex];
          updatedUser.firstName = this.editUserForm.firstName;
          updatedUser.lastName = this.editUserForm.lastName;
          updatedUser.email = this.editUserForm.email;
          updatedUser.phone = this.editUserForm.phone ?? updatedUser.phone;
          updatedUser.role = this.editUserForm.role;
          updatedUser.isActive = this.editUserForm.isActive;
          updatedUser.firstTimeOrder = this.editUserForm.firstTimeOrder;
          updatedUser.canReceiveCommunications = this.editUserForm.canReceiveCommunications;
          updatedUser.canReceiveEmails = this.editUserForm.canReceiveEmails;
          updatedUser.canReceiveMessages = this.editUserForm.canReceiveMessages;
        }
        this.loadUsers();
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to update user.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingUser = false; }
    });
  }

  deleteUser(user: UserAdmin, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.isSuperAdmin) return;
    if (!confirm(`Permanently delete ${user.firstName} ${user.lastName} (${user.email})? This cannot be undone.`)) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.deleteUser(user.id).subscribe({
      next: () => {
        this.successMessage = 'User deleted successfully.';
        this.closeDetailPanel();
        this.loadUsers();
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to delete user.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      }
    });
  }

  // ── Address (apartment) editing (SuperAdmin) ──
  startEditAddress(apartment: Apartment): void {
    this.editingAddressId = apartment.id;
    this.showAddAddress = false;
  }

  cancelEditAddress(): void {
    this.editingAddressId = null;
  }

  saveEditAddress(apartment: Apartment): void {
    if (!this.selectedUser || this.savingAddress) return;
    this.savingAddress = true;
    this.errorMessage = '';
    this.adminService.updateUserApartment(this.selectedUser.id, apartment.id, { ...apartment }).subscribe({
      next: (updated) => {
        const idx = this.selectedUser!.apartments?.findIndex(a => a.id === apartment.id) ?? -1;
        if (idx !== -1 && this.selectedUser!.apartments)
          this.selectedUser!.apartments[idx] = updated;
        this.editingAddressId = null;
        this.successMessage = 'Address updated.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to update address.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingAddress = false; }
    });
  }

  openAddAddress(): void {
    this.showAddAddress = true;
    this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
    this.editingAddressId = null;
  }

  cancelAddAddress(): void {
    this.showAddAddress = false;
    this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
  }

  addNewAddress(): void {
    if (!this.selectedUser || this.savingAddress) return;
    if (!this.newAddress.name?.trim() || !this.newAddress.address?.trim() || !this.newAddress.city?.trim() ||
        !this.newAddress.state?.trim() || !this.newAddress.postalCode?.trim()) {
      this.errorMessage = 'Name, address, city, state and postal code are required.';
      setTimeout(() => { this.errorMessage = ''; }, 5000);
      return;
    }
    this.savingAddress = true;
    this.errorMessage = '';
    this.adminService.addUserApartment(this.selectedUser.id, this.newAddress).subscribe({
      next: (created) => {
        if (!this.selectedUser!.apartments) this.selectedUser!.apartments = [];
        this.selectedUser!.apartments.push(created);
        this.showAddAddress = false;
        this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
        this.successMessage = 'Address added.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to add address.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingAddress = false; }
    });
  }

  deleteAddress(apartment: Apartment, event?: Event): void {
    if (event) event.stopPropagation();
    if (!this.selectedUser || this.savingAddress) return;
    if (!confirm(`Delete address "${apartment.name}"?`)) return;
    this.savingAddress = true;
    this.errorMessage = '';
    this.adminService.deleteUserApartment(this.selectedUser.id, apartment.id).subscribe({
      next: () => {
        if (this.selectedUser!.apartments)
          this.selectedUser!.apartments = this.selectedUser!.apartments.filter(a => a.id !== apartment.id);
        if (this.editingAddressId === apartment.id) this.editingAddressId = null;
        this.successMessage = 'Address deleted.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to delete address.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingAddress = false; }
    });
  }

  userCanReceiveEmails(user: { canReceiveEmails?: boolean; canReceiveCommunications?: boolean }): boolean {
    return user.canReceiveEmails ?? user.canReceiveCommunications !== false;
  }

  userCanReceiveMessages(user: { canReceiveMessages?: boolean; canReceiveCommunications?: boolean }): boolean {
    return user.canReceiveMessages ?? user.canReceiveCommunications !== false;
  }

  toggleUserEmailsPreference(user: UserAdmin, newValue: boolean, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.canUpdate) return;
    this.togglingCommsUserId = user.id;
    this.errorMessage = '';
    this.adminService.updateUserCommunicationPreference(user.id, 'emails', newValue).subscribe({
      next: () => {
        user.canReceiveEmails = newValue;
        if (this.selectedUser && this.selectedUser.id === user.id) this.selectedUser.canReceiveEmails = newValue;
        this.successMessage = newValue ? 'User will receive emails.' : 'User will not receive emails.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to update email preference.';
        setTimeout(() => { this.errorMessage = ''; }, 3000);
      },
      complete: () => { this.togglingCommsUserId = null; }
    });
  }

  toggleUserMessagesPreference(user: UserAdmin, newValue: boolean, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.canUpdate) return;
    this.togglingCommsUserId = user.id;
    this.errorMessage = '';
    this.adminService.updateUserCommunicationPreference(user.id, 'messages', newValue).subscribe({
      next: () => {
        user.canReceiveMessages = newValue;
        if (this.selectedUser && this.selectedUser.id === user.id) this.selectedUser.canReceiveMessages = newValue;
        this.successMessage = newValue ? 'User will receive messages.' : 'User will not receive messages.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to update messages preference.';
        setTimeout(() => { this.errorMessage = ''; }, 3000);
      },
      complete: () => { this.togglingCommsUserId = null; }
    });
  }

  openRegisterModal(): void {
    this.registerForm = { firstName: '', lastName: '', email: '', phone: '' };
    this.registerModalError = '';
    this.showRegisterModal = true;
  }

  closeRegisterModal(): void {
    this.showRegisterModal = false;
    this.registerModalError = '';
  }

  registerUser(): void {
    const f = this.registerForm;
    if (!f.firstName?.trim() || !f.lastName?.trim() || !f.email?.trim()) {
      this.registerModalError = 'First name, last name, and email are required.';
      return;
    }
    this.registerModalError = '';
    this.isRegistering = true;
    this.adminService.registerUser({
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      email: f.email.trim(),
      phone: normalizePhone10(f.phone) || undefined
    }).subscribe({
      next: (res: any) => {
        const name = `${res.firstName || this.registerForm.firstName} ${res.lastName || this.registerForm.lastName}`;
        this.successMessage = `User ${name} registered successfully.`;
        this.closeRegisterModal();
        this.loadUsers();
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        if (err.status === 409) {
          this.registerModalError = 'A user with this email already exists.';
        } else {
          this.registerModalError = err.error?.message || err.message || 'Registration failed. Please try again.';
        }
      },
      complete: () => { this.isRegistering = false; }
    });
  }

  getVisiblePages(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 3;

    if (this.totalPages <= 5) {
      for (let i = 2; i < this.totalPages; i++) pages.push(i);
    } else {
      let start = Math.max(2, this.currentPage - 1);
      let end = Math.min(this.totalPages - 1, start + maxVisiblePages - 1);
      if (end === this.totalPages - 1) start = Math.max(2, end - maxVisiblePages + 1);
      for (let i = start; i <= end; i++) pages.push(i);
    }

    return pages;
  }

  displayRole(role: string): string {
    return role === 'SuperAdmin' ? 'SAdmin' : role;
  }

  getPrimaryAddressLine(user: DetailedUser | null): string {
    if (!user?.apartments?.length) return 'No saved address';
    const primary = user.apartments[0];
    const address = String(primary.address || '').trim();
    const city = String(primary.city || '').trim();
    const postalCode = String(primary.postalCode || '').trim();

    const addressLower = address.toLowerCase();
    const hasCityInAddress = city ? addressLower.includes(city.toLowerCase()) : false;
    const hasPostalInAddress = postalCode ? addressLower.includes(postalCode.toLowerCase()) : false;

    const parts: string[] = [];
    if (address) parts.push(address);
    if (city && !hasCityInAddress) parts.push(city);
    if (postalCode && !hasPostalInAddress) parts.push(postalCode);

    return parts.join(', ') || 'No saved address';
  }

  private formatAdminShortName(name: string | undefined | null): string {
    const full = (name || '').trim();
    if (!full) return 'Admin';
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
  }

  getOverviewTimeline(limit = 6): Array<{
    date: Date;
    typeLabel: string;
    admin: string;
    body: string;
    iconClass: string;
  }> {
    const commItems = this.communications.map((c) => ({
      date: new Date(c.interactionDate || c.createdAt || Date.now()),
      typeLabel: this.getTimelineTypeLabel(c.type, false),
      admin: this.formatAdminShortName(c.adminName || 'Admin'),
      body: c.notes || c.status || '',
      iconClass: this.getTimelineIconClass(c.type, false)
    }));
    const noteItems = [...this.followUpNotes, ...this.generalNotes].map((n) => ({
      date: new Date(n.createdAt || Date.now()),
      typeLabel: n.type === 'FollowUp' ? 'Follow-up' : 'General',
      admin: this.formatAdminShortName(n.createdByAdminName || 'Admin'),
      body: n.content || '',
      iconClass: n.type === 'FollowUp' ? 'followup' : 'general'
    }));
    return [...commItems, ...noteItems]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, limit);
  }

  private refreshOverviewCollections(): void {
    this.overviewTimelineItems = this.getOverviewTimeline(6);
    this.overviewPhotoThumbs = this.getOverviewPhotoThumbs(4);
    this.overviewRecentOrders = this.getRecentOrders(5);
  }

  private getTimelineTypeLabel(type: string | undefined | null, isNote: boolean): string {
    if (isNote) return 'General';
    const t = (type || '').toLowerCase();
    if (t.includes('incoming')) return 'Incoming Call';
    if (t.includes('outgoing')) return 'Outgoing Call';
    if (t.includes('voicemail')) return 'Voicemail';
    if (t.includes('email')) return 'Email';
    if (t.includes('sms') || t.includes('text')) return 'SMS';
    if (t.includes('answer')) return 'No Answer';
    if (t.includes('refused')) return 'Refused';
    return type?.trim() || 'Call';
  }

  private getTimelineIconClass(type: string | undefined | null, isNote: boolean): string {
    if (isNote) return 'general';
    const t = (type || '').toLowerCase();
    if (t.includes('incoming')) return 'incoming-call';
    if (t.includes('outgoing')) return 'outgoing-call';
    if (t.includes('voicemail')) return 'voicemail';
    if (t.includes('email')) return 'email';
    if (t.includes('sms') || t.includes('text')) return 'sms';
    if (t.includes('answer')) return 'no-answer';
    if (t.includes('refused')) return 'refused';
    if (t.includes('call')) return 'call';
    return 'other';
  }

  getTimelineFaIcon(iconClass: string): string {
    switch (iconClass) {
      case 'incoming-call': return 'fa-solid fa-phone-volume';
      case 'outgoing-call': return 'fa-solid fa-phone';
      case 'voicemail': return 'fa-solid fa-microphone-lines';
      case 'email': return 'fa-solid fa-envelope';
      case 'sms': return 'fa-solid fa-comment-dots';
      case 'no-answer': return 'fa-solid fa-phone-slash';
      case 'refused': return 'fa-solid fa-ban';
      case 'followup': return 'fa-solid fa-rotate-right';
      case 'general': return 'fa-solid fa-note-sticky';
      default: return 'fa-solid fa-circle-info';
    }
  }

  getOverviewPhotoThumbs(limit = 4): UserCleaningPhoto[] {
    const all = this.cleaningPhotoGroups.flatMap((g) => g.photos || []);
    return all.slice(0, limit);
  }

  getRecentOrders(limit = 5): OrderList[] {
    if (!this.selectedUser?.orders?.length) return [];
    return [...this.selectedUser.orders]
      .filter(order => (order.status || '').toLowerCase() !== 'cancelled')
      .sort((a, b) => new Date(b.serviceDate || b.orderDate).getTime() - new Date(a.serviceDate || a.orderDate).getTime())
      .slice(0, limit);
  }

  private resolveIsDeepResidential(orderLike: any, detailsLike?: any): boolean {
    const normalize = (value: string | null | undefined): string =>
      (value || '').toLowerCase().trim().replace(/[_\s]+/g, '-');

    const cleaningTypeRaw = normalize(orderLike?.cleaningType || detailsLike?.cleaningType || orderLike?.cleaningLevel || detailsLike?.cleaningLevel);
    if (cleaningTypeRaw === 'deep' || cleaningTypeRaw === 'deep-cleaning') return true;
    if (orderLike?.isDeepCleaning === true || detailsLike?.isDeepCleaning === true) return true;
    if (orderLike?.isDeep === true || detailsLike?.isDeep === true) return true;

    const extras = []
      .concat(Array.isArray(orderLike?.extraServices) ? orderLike.extraServices : [])
      .concat(Array.isArray(detailsLike?.extraServices) ? detailsLike.extraServices : []);
    const services = []
      .concat(Array.isArray(orderLike?.services) ? orderLike.services : [])
      .concat(Array.isArray(detailsLike?.services) ? detailsLike.services : []);

    const hasDeepFromExtras = extras.some((extra: any) => {
      const name = normalize(extra?.extraServiceName || extra?.name);
      return name.includes('deep-cleaning') && !name.includes('super-deep');
    });
    if (hasDeepFromExtras) return true;

    return services.some((service: any) => {
      const name = normalize(service?.serviceName || service?.name);
      return name.includes('deep-cleaning') && !name.includes('super-deep');
    });
  }

  private isResidentialServiceType(serviceTypeName: string | null | undefined): boolean {
    const normalized = (serviceTypeName || '').toLowerCase().trim().replace(/[_\s]+/g, '-');
    return normalized === 'residential-cleaning' || normalized === 'residentialcleaning';
  }

  private resolveResidentialVariantsForOverview(orders: OrderList[]): void {
    const residentialOrders = orders.filter(o => this.isResidentialServiceType(o.serviceTypeName));
    residentialOrders.forEach(order => {
      this.adminService.getOrderDetails(order.id).subscribe({
        next: (details: any) => {
          const isDeep = this.resolveIsDeepResidential(order as any, details as any);
          this.residentialVariantCache.set(order.id, isDeep ? 'Deep' : 'Regular');
        },
        error: () => {
          const fallbackDeep = this.resolveIsDeepResidential(order as any);
          this.residentialVariantCache.set(order.id, fallbackDeep ? 'Deep' : 'Regular');
        }
      });
    });
  }

  private resolveUserLastCleaningVariants(users: UserAdmin[]): void {
    const residentialUsers = users.filter((u: any) => {
      const st = String(u?.lastCleaningServiceType || '').toLowerCase();
      return st.includes('residential');
    });

    residentialUsers.forEach((user) => {
      this.adminService.getUserOrders(user.id).subscribe({
        next: (orders) => {
          const recent = [...(orders || [])]
            .filter((o: any) => (o.status || '').toLowerCase() !== 'cancelled')
            .sort((a: any, b: any) => new Date(b.serviceDate || b.orderDate).getTime() - new Date(a.serviceDate || a.orderDate).getTime())[0];
          if (!recent?.id) return;

          this.adminService.getOrderDetails(recent.id).subscribe({
            next: (details: any) => {
              const isDeep = this.resolveIsDeepResidential(recent as any, details as any);
              this.userLastCleaningVariantCache.set(user.id, isDeep ? 'Deep' : 'Regular');
            },
            error: () => {
              const fallbackDeep = this.resolveIsDeepResidential(recent as any);
              this.userLastCleaningVariantCache.set(user.id, fallbackDeep ? 'Deep' : 'Regular');
            }
          });
        }
      });
    });
  }

  getCompactServiceType(serviceTypeName: string | undefined | null, order?: any): string {
    const raw = (serviceTypeName || '').trim();
    if (!raw) return 'Service';
    const s = raw.toLowerCase();

    if (s.includes('move') && (s.includes('in') || s.includes('out'))) return 'Move In/Out';
    if (s.includes('office')) return 'Office';
    if (s.includes('arranged') || s.includes('pre-arranged') || s.includes('pre arranged')) return 'Pre-arranged';
    if (s.includes('heavy conditional') || s === 'heavy') return 'Heavy';

    if (s.includes('residential')) {
      if (order?.lastCleaningServiceType !== undefined && order?.id && this.userLastCleaningVariantCache.has(order.id)) {
        return this.userLastCleaningVariantCache.get(order.id) || 'Regular';
      }
      if (order?.id && this.residentialVariantCache.has(order.id)) {
        return this.residentialVariantCache.get(order.id) || 'Regular';
      }
      return this.resolveIsDeepResidential(order as any) || s.includes('deep') ? 'Deep' : 'Regular';
    }
    if (s.includes('deep')) return 'Deep';
    if (s.includes('regular') || s.includes('standard')) return 'Regular';
    if (s.includes('post')) return 'Post-construction';

    return raw
      .replace(/cleaning/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Service';
  }

  /** Truncate text for display in compact table cells. */
  truncate(text: string | undefined | null, max = 38): string {
    if (!text) return '';
    return text.length <= max ? text : text.slice(0, max - 1) + '…';
  }
}
