import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener, Input } from '@angular/core';
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
  UserCleaningPhoto,
  LoyaltyDiscountDto
} from '../../../services/admin.service';
import { OrderService, OrderList } from '../../../services/order.service';
import { Apartment, CreateApartment } from '../../../services/profile.service';
import { formatNy } from '../../../shared/ny-time.util';
import { BubbleRewardsService } from '../../../services/bubble-rewards.service';
import { AdminBonusService, AdminBonusSummary } from '../../../services/admin-bonus.service';
import { environment } from '../../../../environments/environment';
import { normalizePhone10, sanitizePhoneInput } from '../../../utils/phone.utils';
import { ADMIN_VIEWABLE_PAGES } from '../../../shared/admin-viewable-pages';

type DetailTab = 'details' | 'history' | 'photos' | 'notes' | 'tasks';

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

  /** Set from the ?userId= query param (e.g. the orders panel's "View User" button) — auto-opens that user. */
  @Input() openUserId: number | null = null;

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
  // Customer-type filter, based on non-cancelled order count: 'new' = exactly one order,
  // 'returning' = two or more, 'none' = no orders yet.
  customerTypeFilter: string = 'all';
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
    phone: '',
    noEmail: false
  };
  isRegistering = false;
  registerModalError = '';

  // ── Export (SuperAdmin-only) ──
  showExportModal = false;
  exporting = false;
  exportError = '';
  /** Column keys must match the backend ExportUsers endpoint. */
  exportColumns: Array<{ key: string; label: string; selected: boolean }> = [
    { key: 'userId',          label: 'ID',                    selected: true },
    { key: 'fullName',        label: 'Full Name',             selected: true },
    { key: 'phone',           label: 'Phone',                 selected: true },
    { key: 'email',           label: 'Email',                 selected: true },
    { key: 'lastServiceType', label: 'Service Type',          selected: true },
    { key: 'lastServiceAt',   label: 'Date & Time',           selected: true },
    { key: 'lastAddress',     label: 'Address',               selected: true },
    { key: 'lastBorough',     label: 'Borough',               selected: true },
    { key: 'lastZip',         label: 'Zip',                   selected: true },
    { key: 'lastBedsBaths',   label: 'Rooms',                 selected: true },
    { key: 'lastSquareFeet',  label: 'Sq.Ft',                 selected: true },
    { key: 'totalSpent',      label: 'Total Spent',           selected: true }
  ];

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
  detailTab: DetailTab = 'details';

  // SuperAdmin full edit
  editingUser = false;
  editUserForm: SuperAdminUpdateUserDto = { firstName: '', lastName: '', email: '', role: 'Customer', isActive: true, firstTimeOrder: true, canReceiveCommunications: true, canReceiveEmails: true, canReceiveMessages: true };
  savingUser = false;
  togglingCommsUserId: number | null = null;
  /** User id whose flag is mid-update (disables the flag buttons). */
  flaggingUserId: number | null = null;

  // Manual "we miss you" reminder (Admin/SuperAdmin)
  sendingReminder = false;

  // Address editing (Admin/SuperAdmin)
  editingAddressId: number | null = null;
  editAddressDraft: Apartment | null = null;
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

  // Set/correct "referred by" (SuperAdmin)
  newReferrerEmail = '';
  newReferrerSearchResults: { id: number; email: string; name: string }[] = [];
  settingReferredBy = false;

  // ── Customer-care: notes (general only) ──
  generalNotes: UserNote[] = [];
  loadingNotes = false;

  newNoteContent = '';
  savingNote = false;

  editingNoteId: number | null = null;
  editNoteContent = '';

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

  // ── Customer-care: tasks ──
  userTasks: any[] = [];
  loadingTasks = false;
  private userLastCleaningVariantCache: Map<number, 'Deep' | 'Regular'> = new Map();

  // Admin bonus stats — only loaded when the user being viewed has the Admin role.
  adminBonusAllTime: AdminBonusSummary | null = null;
  adminBonusThisMonth: AdminBonusSummary | null = null;
  loadingAdminBonus = false;

  constructor(
    private adminService: AdminService,
    private orderService: OrderService,
    private bubbleRewardsService: BubbleRewardsService,
    private adminBonusService: AdminBonusService
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
        this.openPendingUserDetails();
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

  /**
   * Opens the detail panel for the ?userId= deep link once the list has loaded, then forgets it
   * so a later refresh doesn't re-open the panel. Also jumps the list to the page holding that
   * user so the highlighted row is visible behind the panel.
   */
  private openPendingUserDetails(): void {
    const pendingId = this.openUserId;
    if (!pendingId) return;
    this.openUserId = null;

    const user = this.users.find(u => u.id === pendingId);
    if (!user) {
      this.errorMessage = `User #${pendingId} was not found.`;
      return;
    }

    const index = this.matchingUsers.findIndex(u => u.id === pendingId);
    if (index >= 0) {
      this.currentPage = Math.floor(index / this.itemsPerPage) + 1;
    }

    setTimeout(() => this.openUserDetails(user), 100);
  }

  openUserDetails(user: UserAdmin): void {
    if (this.viewingUserId === user.id) {
      this.closeDetailPanel();
      return;
    }

    this.viewingUserId = user.id;
    this.detailTab = 'details';
    this.roleDropdownUserId = null;
    this.editingUser = false;
    this.loadingUserDetails = true;
    this.selectedUser = { ...user };

    // Reset child sections
    this.generalNotes = [];
    this.cleaningPhotoGroups = [];
    this.userTasks = [];
    this.editingNoteId = null;
    this.newNoteContent = '';

    this.loadUserOrders(user.id);
    this.loadUserApartments(user.id);
    this.loadUserRewards(user.id);
    this.loadUserLoyalty(user.id);
    this.loadUserNotes(user.id);
    this.loadUserTasksList(user.id);
    this.loadCleaningPhotos(user.id);
    this.loadAdminBonusStats(user);
  }

  // Only fetched for users with the Admin role — the bonus system doesn't apply to others.
  // SuperAdmins are managers (they don't earn the per-order bonus), so we skip them too.
  private loadAdminBonusStats(user: UserAdmin): void {
    this.adminBonusAllTime = null;
    this.adminBonusThisMonth = null;
    if (user.role !== 'Admin') return;

    this.loadingAdminBonus = true;

    // Current calendar month (UTC) — same window the shifts panel uses.
    const now = new Date();
    const monthFrom = this.toYmd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
    const monthTo   = this.toYmd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));

    this.adminBonusService.getForAdmin(user.id).subscribe({
      next: s => this.adminBonusAllTime = s,
      error: () => { /* leave null — UI hides the stat */ }
    });
    this.adminBonusService.getForAdmin(user.id, monthFrom, monthTo).subscribe({
      next: s => { this.adminBonusThisMonth = s; this.loadingAdminBonus = false; },
      error: () => { this.loadingAdminBonus = false; }
    });
  }

  private toYmd(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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
    this.adminBonusAllTime = null;
    this.adminBonusThisMonth = null;
  }

  setDetailTab(tab: DetailTab): void {
    this.detailTab = tab;
    if (!this.selectedUser) return;
    if (tab === 'photos' && this.cleaningPhotoGroups.length === 0 && !this.loadingPhotos) {
      this.loadCleaningPhotos(this.selectedUser.id);
    }
    if (tab === 'tasks' && this.userTasks.length === 0 && !this.loadingTasks) {
      this.loadUserTasksList(this.selectedUser.id);
    }
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
        this.loadingUserDetails = false;
      },
      error: (error) => {
        console.error('Failed to load user orders', error);
        if (this.selectedUser && this.selectedUser.id === userId) {
          this.selectedUser.orders = [];
          this.selectedUser.totalOrders = 0;
          this.selectedUser.totalSpent = 0;
        }
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

  // ── Loyalty Discount (re-engagement) ──
  // The view always loads the current state. Editing is gated to Admin/SuperAdmin via
  // canEditUserDetails in the template — Moderator sees the badge but no Edit button.
  loyaltyDiscount: LoyaltyDiscountDto | null = null;
  loadingLoyalty = false;
  editingLoyalty = false;
  loyaltyForm: { percentage: number } = { percentage: 0 };
  savingLoyalty = false;
  loyaltyError = '';
  loyaltySuccess = '';

  loadUserLoyalty(userId: number): void {
    this.loadingLoyalty = true;
    this.loyaltyDiscount = null;
    this.loyaltyError = '';
    this.editingLoyalty = false;
    this.adminService.getUserLoyaltyDiscount(userId).subscribe({
      next: (dto) => {
        if (this.selectedUser?.id !== userId) return;
        this.loyaltyDiscount = dto;
        this.loyaltyForm = { percentage: dto?.percentage ?? 0 };
        this.loadingLoyalty = false;
      },
      error: () => { this.loadingLoyalty = false; }
    });
  }

  startEditLoyaltyDiscount(): void {
    this.loyaltyForm = { percentage: this.loyaltyDiscount?.percentage ?? 0 };
    this.loyaltyError = '';
    this.loyaltySuccess = '';
    this.editingLoyalty = true;
  }

  cancelEditLoyalty(): void {
    this.editingLoyalty = false;
    this.loyaltyError = '';
  }

  saveLoyaltyDiscount(): void {
    if (!this.selectedUser || this.savingLoyalty) return;
    const userId = this.selectedUser.id;
    this.savingLoyalty = true;
    this.loyaltyError = '';
    this.loyaltySuccess = '';
    this.adminService.setUserLoyaltyDiscount(userId, this.loyaltyForm.percentage).subscribe({
      next: (dto) => {
        if (this.selectedUser?.id !== userId) { this.savingLoyalty = false; return; }
        this.loyaltyDiscount = dto;
        this.editingLoyalty = false;
        this.savingLoyalty = false;
        this.loyaltySuccess = 'Loyalty discount updated.';
        setTimeout(() => { this.loyaltySuccess = ''; }, 4000);
      },
      error: (err) => {
        this.loyaltyError = err?.error?.message || 'Failed to update loyalty discount.';
        this.savingLoyalty = false;
      }
    });
  }

  clearLoyaltyDiscount(): void {
    if (!this.selectedUser || this.savingLoyalty) return;
    const userId = this.selectedUser.id;
    this.savingLoyalty = true;
    this.loyaltyError = '';
    this.loyaltySuccess = '';
    this.adminService.clearUserLoyaltyDiscount(userId).subscribe({
      next: (dto) => {
        if (this.selectedUser?.id !== userId) { this.savingLoyalty = false; return; }
        this.loyaltyDiscount = dto;
        this.loyaltyForm = { percentage: 0 };
        this.editingLoyalty = false;
        this.savingLoyalty = false;
        this.loyaltySuccess = 'Loyalty discount cleared.';
        setTimeout(() => { this.loyaltySuccess = ''; }, 4000);
      },
      error: (err) => {
        this.loyaltyError = err?.error?.message || 'Failed to clear loyalty discount.';
        this.savingLoyalty = false;
      }
    });
  }

  loadUserRewards(userId: number): void {
    this.rewardsLoading = true;
    this.userRewardsSummary = null;
    this.adjustPointsDesc = '';
    this.newReferralEmail = '';
    this.newReferralSearchResults = [];
    this.newReferrerEmail = '';
    this.newReferrerSearchResults = [];
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
        // Only general notes exist now — follow-up notes were removed.
        this.generalNotes = notes.filter(n => n.type === 'General');
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
      type: 'General',
      content
    };

    this.savingNote = true;
    this.adminService.createUserCareNote(this.selectedUser.id, dto).subscribe({
      next: (note) => {
        this.generalNotes = [note, ...this.generalNotes];
        this.newNoteContent = '';
        this.savingNote = false;
        this.successMessage = 'Note added.';
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
  }

  cancelEditNote(): void {
    this.editingNoteId = null;
    this.editNoteContent = '';
  }

  saveEditNote(note: UserNote): void {
    if (this.editingNoteId !== note.id) return;
    const content = this.editNoteContent.trim();
    if (!content) return;

    const dto: UpdateUserNoteDto = { content };

    this.adminService.updateUserCareNote(note.id, dto).subscribe({
      next: (updated) => {
        const idx = this.generalNotes.findIndex(n => n.id === updated.id);
        if (idx >= 0) this.generalNotes[idx] = updated;
        this.cancelEditNote();
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
    // Photos must always be attached to a specific order — unassigned uploads are not allowed.
    if (this.photoUploadOrderId == null) {
      this.photoUploadError = 'Select the order these photos belong to first.';
      setTimeout(() => this.photoUploadError = '', 4000);
      return;
    }
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
   * Resolve the displayable image URL for a cleaning photo. We route through the
   * /api endpoint by photo id so it works in dev (Angular proxy) and prod (same
   * origin via /api) without needing a server-side alias for the upload directory.
   * Accepts either a UserCleaningPhoto object or a raw string (legacy callers).
   */
  resolvePhotoUrl(photoOrUrl: UserCleaningPhoto | string | number | undefined | null): string {
    if (!photoOrUrl) return '';
    if (typeof photoOrUrl === 'number') {
      return `${environment.apiUrl}/admin/user-care/cleaning-photos/${photoOrUrl}/raw`;
    }
    if (typeof photoOrUrl === 'object' && 'id' in photoOrUrl && photoOrUrl.id) {
      return `${environment.apiUrl}/admin/user-care/cleaning-photos/${photoOrUrl.id}/raw`;
    }
    return typeof photoOrUrl === 'string' ? photoOrUrl : '';
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

  // ── Restricted-page view grants (SuperAdmin → regular Admin, read-only) ──

  /** Registry of grantable restricted pages, used to render one toggle each. */
  readonly viewablePageOptions = ADMIN_VIEWABLE_PAGES;

  /** Show the page-access control only when a SuperAdmin is viewing a regular Admin. */
  canManagePageAccess(user: DetailedUser | UserAdmin | null): boolean {
    return !!user && this.currentUserRole === 'SuperAdmin' && user.role === 'Admin';
  }

  isPageGranted(user: DetailedUser | UserAdmin | null, pageKey: string): boolean {
    return !!user && Array.isArray(user.viewablePages) && user.viewablePages.includes(pageKey);
  }

  togglingPageAccessUserId: number | null = null;

  toggleUserPageAccess(user: DetailedUser | UserAdmin, pageKey: string, granted: boolean, event?: Event) {
    event?.stopPropagation();
    if (!this.canManagePageAccess(user)) return;

    this.errorMessage = '';
    this.successMessage = '';

    const original = Array.isArray(user.viewablePages) ? [...user.viewablePages] : [];
    const next = granted
      ? Array.from(new Set([...original, pageKey]))
      : original.filter(k => k !== pageKey);

    // Optimistic update on both the row and the open panel copy.
    user.viewablePages = next;
    if (this.selectedUser && this.selectedUser.id === user.id) {
      this.selectedUser.viewablePages = next;
    }
    this.togglingPageAccessUserId = user.id;

    this.adminService.updateUserViewablePages(user.id, next).subscribe({
      next: (res) => {
        this.togglingPageAccessUserId = null;
        user.viewablePages = res.pages;
        if (this.selectedUser && this.selectedUser.id === user.id) {
          this.selectedUser.viewablePages = res.pages;
        }
      },
      error: (error) => {
        this.togglingPageAccessUserId = null;
        user.viewablePages = original;
        if (this.selectedUser && this.selectedUser.id === user.id) {
          this.selectedUser.viewablePages = original;
        }
        this.errorMessage = error.error?.message || 'Failed to update page access.';
        setTimeout(() => this.errorMessage = '', 4000);
      }
    });
  }

  // -- Direct order-edit saves (SuperAdmin -> regular Admin) --
  //
  // Separate from the page-view grants above because this one grants a WRITE: a granted Admin
  // applies order edits immediately (still reviewing the change list first) instead of sending
  // them to a SuperAdmin. Rule: shared/order-edit-approval.policy.ts.

  /** Same audience as the page grants: a SuperAdmin looking at a regular Admin. */
  canManageOrderEditAccess(user: DetailedUser | UserAdmin | null): boolean {
    return this.canManagePageAccess(user);
  }

  isOrderEditGranted(user: DetailedUser | UserAdmin | null): boolean {
    return !!user && !!user.canEditOrdersWithoutApproval;
  }

  togglingOrderEditAccessUserId: number | null = null;

  toggleUserOrderEditAccess(user: DetailedUser | UserAdmin, granted: boolean, event?: Event) {
    event?.stopPropagation();
    if (!this.canManageOrderEditAccess(user)) return;
    if (this.isOrderEditGranted(user) === granted) return;

    this.errorMessage = '';
    this.successMessage = '';

    const original = !!user.canEditOrdersWithoutApproval;

    // Optimistic update on both the row and the open panel copy (same as the page grants).
    user.canEditOrdersWithoutApproval = granted;
    if (this.selectedUser && this.selectedUser.id === user.id) {
      this.selectedUser.canEditOrdersWithoutApproval = granted;
    }
    this.togglingOrderEditAccessUserId = user.id;

    this.adminService.updateUserOrderEditApproval(user.id, granted).subscribe({
      next: (res) => {
        this.togglingOrderEditAccessUserId = null;
        user.canEditOrdersWithoutApproval = res.canEditOrdersWithoutApproval;
        if (this.selectedUser && this.selectedUser.id === user.id) {
          this.selectedUser.canEditOrdersWithoutApproval = res.canEditOrdersWithoutApproval;
        }
      },
      error: (error) => {
        this.togglingOrderEditAccessUserId = null;
        user.canEditOrdersWithoutApproval = original;
        if (this.selectedUser && this.selectedUser.id === user.id) {
          this.selectedUser.canEditOrdersWithoutApproval = original;
        }
        this.errorMessage = error.error?.message || 'Failed to update order edit access.';
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

  /**
   * Set/clear this customer's admin-only problem flag. The flag lives on the User (single
   * source of truth), so every one of their orders picks up the same tint automatically.
   * Updates both the selected copy and the matching list row. `reason` carries over when
   * only switching level.
   */
  setUserFlag(user: UserAdmin, level: string, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.canUpdate) return;

    const row = this.users.find(u => u.id === user.id);
    const reason = level === 'None' ? null : (user.flagReason ?? row?.flagReason ?? null);

    this.flaggingUserId = user.id;
    this.errorMessage = '';
    this.adminService.setUserFlag(user.id, level, reason).subscribe({
      next: () => {
        if (row) { row.flag = level; row.flagReason = level === 'None' ? null : reason; }
        if (this.selectedUser && this.selectedUser.id === user.id) {
          this.selectedUser.flag = level;
          this.selectedUser.flagReason = level === 'None' ? null : reason;
        }
        this.successMessage = level === 'None'
          ? `Flag cleared for ${user.firstName} ${user.lastName}.`
          : `${user.firstName} ${user.lastName} flagged ${level}.`;
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to update flag.';
        setTimeout(() => { this.errorMessage = ''; }, 3000);
      },
      complete: () => { this.flaggingUserId = null; }
    });
  }

  /** Persist an edited flag reason on blur (keeps the current level). */
  saveUserFlagReason(user: UserAdmin, event: Event): void {
    const value = ((event.target as HTMLInputElement)?.value || '').trim();
    const level = user.flag || 'None';
    if (level === 'None') return;
    const row = this.users.find(u => u.id === user.id);
    if ((user.flagReason ?? '') === value && (row?.flagReason ?? '') === value) return;

    this.adminService.setUserFlag(user.id, level, value || null).subscribe({
      next: () => {
        if (row) row.flagReason = value || null;
        if (this.selectedUser && this.selectedUser.id === user.id) this.selectedUser.flagReason = value || null;
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to save flag reason.';
        setTimeout(() => { this.errorMessage = ''; }, 3000);
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

  /** Every user matching the current filters, sorted — before pagination slices it. */
  private get matchingUsers(): UserAdmin[] {
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
    if (this.customerTypeFilter !== 'all') {
      // totalOrdersCount counts non-cancelled orders (from the users-list endpoint).
      filtered = filtered.filter(user => {
        const count = user.totalOrdersCount ?? 0;
        switch (this.customerTypeFilter) {
          case 'new': return count === 1;
          case 'returning': return count >= 2;
          case 'none': return count === 0;
          default: return true;
        }
      });
    }
    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });
  }

  get filteredUsers(): UserAdmin[] {
    const filtered = this.matchingUsers;
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

  /** For NY wall-clock dates (serviceDate, dueDate, lastCleaningDate) — no timezone conversion. */
  formatShortDate(date: any): string {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }

  /** For UTC timestamps (createdAt, activatedAt, lastUsedAt) — shown in NY time. */
  formatUtcShortDate(date: any): string {
    if (!date) return '—';
    return formatNy(date, { month: 'short', day: 'numeric', year: '2-digit' });
  }

  /** All call sites pass UTC timestamps (createdAt, interactionDate) — shown in NY time. */
  formatDateTime(date: any): string {
    if (!date) return 'N/A';
    return formatNy(date, { month: 'short', day: 'numeric' }) +
      ' • ' + formatNy(date, { hour: '2-digit', minute: '2-digit' });
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

  /** True for Admin or SuperAdmin — both can open the user edit form. */
  get canEditUsers(): boolean {
    return this.currentUserRole === 'SuperAdmin' || this.currentUserRole === 'Admin';
  }

  /** True if current admin is allowed to edit this specific target user. Admins cannot edit SuperAdmin users. */
  canEditUserDetails(user: any): boolean {
    if (!user) return false;
    if (this.currentUserRole === 'SuperAdmin') return true;
    if (this.currentUserRole === 'Admin' && user.role !== 'SuperAdmin') return true;
    return false;
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

  /**
   * A social-login photo URL can 404 (Google rotates them) — drop it so the coloured
   * initials bubble takes over instead of leaving a broken-image glyph in the circle.
   * Clears it on the list row and the open detail panel, which are separate objects.
   */
  onAvatarError(user: UserAdmin | DetailedUser | null): void {
    if (!user) return;
    user.profilePictureUrl = null;
    const listRow = this.users.find(u => u.id === user.id);
    if (listRow) listRow.profilePictureUrl = null;
    if (this.selectedUser && this.selectedUser.id === user.id) this.selectedUser.profilePictureUrl = null;
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

  searchReferrers(query: string): void {
    if (!this.selectedUser || query.length < 2) { this.newReferrerSearchResults = []; return; }
    this.bubbleRewardsService.searchEligibleReferrers(this.selectedUser.id, query).subscribe({
      next: (r) => this.newReferrerSearchResults = r,
      error: () => this.newReferrerSearchResults = []
    });
  }

  selectReferrerSuggestion(email: string): void {
    this.newReferrerEmail = email;
    this.newReferrerSearchResults = [];
  }

  setReferredBy(): void {
    if (!this.selectedUser || !this.isSuperAdmin || this.settingReferredBy || !this.newReferrerEmail.trim()) return;
    this.settingReferredBy = true;
    this.referralActionMessage = '';
    this.bubbleRewardsService.setReferredBy(this.selectedUser.id, this.newReferrerEmail.trim()).subscribe({
      next: () => {
        this.settingReferredBy = false;
        this.newReferrerEmail = '';
        this.newReferrerSearchResults = [];
        this.referralActionMessage = 'Referrer set.';
        this.loadUserRewards(this.selectedUser!.id);
        setTimeout(() => this.referralActionMessage = '', 3000);
      },
      error: (err) => {
        this.settingReferredBy = false;
        this.referralActionMessage = err?.error?.message ?? 'Failed to set referrer.';
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
    if (!this.selectedUser || !this.canEditUserDetails(this.selectedUser)) return;
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

  private buildUserEditPayload(): SuperAdminUpdateUserDto {
    const user = this.selectedUser!;
    return {
      firstName: this.editUserForm.firstName,
      lastName: this.editUserForm.lastName,
      // null (not "") when blank — the backend's [EmailAddress] rejects an empty string.
      // Blank is valid only for no-email (cash) accounts, whose email field starts empty.
      email: this.editUserForm.email?.trim() ? this.editUserForm.email.trim() : null,
      phone: this.editUserForm.phone,
      firstTimeOrder: this.editUserForm.firstTimeOrder,
      role: user.role,
      isActive: user.isActive,
      canReceiveCommunications: user.canReceiveCommunications !== false,
      canReceiveEmails: this.userCanReceiveEmails(user),
      canReceiveMessages: this.userCanReceiveMessages(user)
    };
  }

  /** Send Reminder button: checks reminder history first, confirms (with an "already
   *  reminded N days ago" warning when relevant), then sends the "we miss you" reminder. */
  sendReminderToUser(): void {
    if (!this.selectedUser || !this.canEditUserDetails(this.selectedUser) || this.sendingReminder) return;
    const user = this.selectedUser;
    this.sendingReminder = true;

    this.adminService.getUserReminderStatus(user.id).subscribe({
      next: (status) => {
        // Never-ordered users get "book your first cleaning" copy instead of "we miss you".
        const reminderKind = status.hasOrders ? '"we miss you" reminder' : '"book your first cleaning" invite';
        let question: string;
        if (status.daysAgo !== null && status.lastReminderSentAt) {
          const when = status.daysAgo === 0 ? 'today'
            : status.daysAgo === 1 ? 'yesterday'
            : `${status.daysAgo} days ago`;
          question = `${user.firstName} ${user.lastName} already got a reminder ${when}. Do you still want to send the ${reminderKind} again?`;
        } else {
          question = `Send a ${reminderKind} to ${user.firstName} ${user.lastName}?`;
        }

        if (!confirm(question)) {
          this.sendingReminder = false;
          return;
        }

        this.adminService.sendUserReminder(user.id).subscribe({
          next: (res) => {
            this.sendingReminder = false;
            this.successMessage = res.message;
            setTimeout(() => { this.successMessage = ''; }, 5000);
          },
          error: (err) => {
            this.sendingReminder = false;
            this.errorMessage = err.error?.message || 'Failed to send the reminder.';
            setTimeout(() => { this.errorMessage = ''; }, 5000);
          }
        });
      },
      error: (err) => {
        this.sendingReminder = false;
        this.errorMessage = err.error?.message || 'Could not check this user\'s reminder history.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      }
    });
  }

  cancelEditUser(): void {
    this.editingUser = false;
    this.editingAddressId = null;
    this.editAddressDraft = null;
    this.showAddAddress = false;
    this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
  }

  saveUserEdit(): void {
    if (!this.selectedUser || !this.canEditUserDetails(this.selectedUser) || this.savingUser) return;
    this.editUserForm.phone = normalizePhone10(this.editUserForm.phone);
    const payload = this.buildUserEditPayload();
    this.savingUser = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.superAdminFullUpdateUser(this.selectedUser.id, payload).subscribe({
      next: () => {
        this.successMessage = 'User updated successfully.';
        this.editingUser = false;
        this.selectedUser!.firstName = payload.firstName;
        this.selectedUser!.lastName = payload.lastName;
        this.selectedUser!.email = payload.email ?? this.selectedUser!.email;
        this.selectedUser!.phone = payload.phone ?? this.selectedUser!.phone;
        this.selectedUser!.firstTimeOrder = payload.firstTimeOrder;
        // Giving a no-email (cash) account a real email converts it to a normal account.
        if (this.selectedUser!.isNoEmailUser && payload.email?.trim()) {
          this.selectedUser!.isNoEmailUser = false;
        }
        const userIndex = this.users.findIndex(user => user.id === this.selectedUser!.id);
        if (userIndex !== -1) {
          const updatedUser = this.users[userIndex];
          updatedUser.firstName = payload.firstName;
          updatedUser.lastName = payload.lastName;
          updatedUser.email = payload.email ?? updatedUser.email;
          updatedUser.phone = payload.phone ?? updatedUser.phone;
          updatedUser.firstTimeOrder = payload.firstTimeOrder;
          updatedUser.isNoEmailUser = this.selectedUser!.isNoEmailUser;
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

  /** SuperAdmin-only: reset a locked-out / forgotten staff PIN. Clears the PIN, the lock
   *  and all trusted devices; the coworker sets a brand-new PIN on their next login. */
  resettingPin = false;
  resetStaffPin(user: any, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.isSuperAdmin || !this.isStaffRole(user.role) || this.resettingPin) return;
    if (!confirm(`Reset the login PIN for ${user.firstName} ${user.lastName}? This unlocks their account and clears the PIN — they'll set a new one on their next login.`)) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.resettingPin = true;
    this.adminService.resetStaffTwoFactorPin(user.id).subscribe({
      next: (res) => {
        this.successMessage = res?.message || 'PIN reset. The user will set a new PIN on their next login.';
        setTimeout(() => { this.successMessage = ''; }, 6000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to reset PIN.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.resettingPin = false; }
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

  // ── Address (apartment) editing (Admin/SuperAdmin) ──
  startEditAddress(apartment: Apartment): void {
    if (!this.selectedUser || !this.canEditUserDetails(this.selectedUser)) return;
    this.editingAddressId = apartment.id;
    this.editAddressDraft = { ...apartment };
    this.showAddAddress = false;
  }

  cancelEditAddress(): void {
    this.editingAddressId = null;
    this.editAddressDraft = null;
  }

  saveEditAddress(): void {
    if (!this.selectedUser || !this.editAddressDraft || this.savingAddress) return;
    const draft = this.editAddressDraft;
    this.savingAddress = true;
    this.errorMessage = '';
    this.adminService.updateUserApartment(this.selectedUser.id, draft.id, { ...draft }).subscribe({
      next: (updated) => {
        const idx = this.selectedUser!.apartments?.findIndex(a => a.id === draft.id) ?? -1;
        if (idx !== -1 && this.selectedUser!.apartments)
          this.selectedUser!.apartments[idx] = updated;
        this.editingAddressId = null;
        this.editAddressDraft = null;
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
    this.editAddressDraft = null;
  }

  cancelAddAddress(): void {
    this.showAddAddress = false;
    this.newAddress = { name: '', address: '', city: '', state: '', postalCode: '' };
  }

  addNewAddress(): void {
    if (!this.selectedUser || !this.canEditUserDetails(this.selectedUser) || this.savingAddress) return;
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
    if (!this.selectedUser || !this.canEditUserDetails(this.selectedUser) || this.savingAddress) return;
    if (!confirm(`Delete address "${apartment.name}"?`)) return;
    this.savingAddress = true;
    this.errorMessage = '';
    this.adminService.deleteUserApartment(this.selectedUser.id, apartment.id).subscribe({
      next: () => {
        if (this.selectedUser!.apartments)
          this.selectedUser!.apartments = this.selectedUser!.apartments.filter(a => a.id !== apartment.id);
        if (this.editingAddressId === apartment.id) {
          this.editingAddressId = null;
          this.editAddressDraft = null;
        }
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
    this.registerForm = { firstName: '', lastName: '', email: '', phone: '', noEmail: false };
    this.registerModalError = '';
    this.showRegisterModal = true;
  }

  closeRegisterModal(): void {
    this.showRegisterModal = false;
    this.registerModalError = '';
  }

  registerUser(): void {
    const f = this.registerForm;
    if (!f.firstName?.trim() || !f.lastName?.trim()) {
      this.registerModalError = 'First name and last name are required.';
      return;
    }
    if (!f.noEmail && !f.email?.trim()) {
      this.registerModalError = 'Email is required (or mark the customer as having no email).';
      return;
    }
    if (f.noEmail && !normalizePhone10(f.phone)) {
      this.registerModalError = 'Phone is required for customers without an email.';
      return;
    }
    this.registerModalError = '';
    this.isRegistering = true;
    this.adminService.registerUser({
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      email: f.noEmail ? undefined : f.email.trim(),
      phone: normalizePhone10(f.phone) || undefined,
      noEmail: f.noEmail
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

  openExportModal(): void {
    if (!this.isSuperAdmin) return;
    // Reset to all-checked every time per requirement: "show me all that things already checked".
    this.exportColumns.forEach(c => c.selected = true);
    this.exportError = '';
    this.showExportModal = true;
  }

  closeExportModal(): void {
    if (this.exporting) return;
    this.showExportModal = false;
    this.exportError = '';
  }

  toggleExportColumn(key: string): void {
    const col = this.exportColumns.find(c => c.key === key);
    if (col) col.selected = !col.selected;
  }

  get hasAnyExportColumnSelected(): boolean {
    return this.exportColumns.some(c => c.selected);
  }

  runExport(): void {
    if (!this.isSuperAdmin || this.exporting) return;
    const selected = this.exportColumns.filter(c => c.selected).map(c => c.key);
    if (selected.length === 0) {
      this.exportError = 'Select at least one column to export.';
      return;
    }
    this.exporting = true;
    this.exportError = '';
    this.adminService.exportUsers(selected).subscribe({
      next: (res) => {
        const blob = res.body;
        if (!blob) {
          this.exportError = 'Export returned an empty file.';
          this.exporting = false;
          return;
        }
        // Try to honor the server-provided filename, fall back to a timestamped default.
        let filename = `users-export-${new Date().toISOString().slice(0,10)}.xlsx`;
        const disposition = res.headers.get('Content-Disposition');
        if (disposition) {
          const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(disposition);
          if (match && match[1]) filename = decodeURIComponent(match[1]);
        }
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.exporting = false;
        this.showExportModal = false;
        this.successMessage = 'Export downloaded.';
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.exporting = false;
        this.exportError = err?.error?.message || err?.message || 'Failed to export users.';
      }
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
    if (s.includes('arranged') || s.includes('pre-arranged') || s.includes('pre arranged')) return 'Arranged';
    if (s.includes('heavy')) return 'Heavy';

    if (s.includes('residential')) {
      if (order?.lastCleaningServiceType !== undefined && order?.id && this.userLastCleaningVariantCache.has(order.id)) {
        return this.userLastCleaningVariantCache.get(order.id) || 'Regular';
      }
      return this.resolveIsDeepResidential(order as any) || s.includes('deep') ? 'Deep' : 'Regular';
    }
    if (s.includes('deep')) return 'Deep';
    if (s.includes('regular') || s.includes('standard')) return 'Regular';
    if (s.includes('post')) return 'Construction';

    return raw
      .replace(/cleaning/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Service';
  }
}
