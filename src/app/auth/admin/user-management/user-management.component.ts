import { Component, OnInit, AfterViewInit, OnDestroy, ElementRef, HostListener, input, model, ChangeDetectionStrategy, inject, output, viewChild, signal, computed } from '@angular/core';
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
import {
  ContractPermissions, ContractService, OrgTitle, OrgTitleOverview
} from '../../../services/contract.service';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { AdminBonusService, AdminBonusSummary } from '../../../services/admin-bonus.service';
import { environment } from '../../../../environments/environment';
import { matchesPhoneSearch, normalizePhone10, sanitizePhoneInput } from '../../../utils/phone.utils';
import { ADMIN_VIEWABLE_PAGES } from '../../../shared/admin-viewable-pages';
import { getAdminAvatarColor, getAdminAvatarInitials } from '../../../shared/admin/admin-avatar.utils';
import {
  RegisterCustomerModalComponent,
  RegisteredCustomer
} from '../../../shared/components/register-customer-modal/register-customer-modal.component';
import { RecreateOrderModalComponent } from '../../../shared/components/recreate-order-modal/recreate-order-modal.component';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { AdminUserBillingComponent } from './user-billing/admin-user-billing.component';
import {
  InvoiceService, InvoiceClientOption, LinkedInvoiceSummary
} from '../../../services/invoice.service';
import { isDeepOrSuperDeepExtra, isSuperDeepExtra } from '../../../shared/booking/extra-service-keys';
import { orderServiceKeyOf } from '../../../shared/booking/order-service-keys';
import {
  isCancelledOrRefundedStatus,
  orderStatusBadgeClass,
  orderStatusBadgeLabel,
  orderStatusBadgeTitle,
} from '../../../shared/admin/order-status-badge';

type DetailTab = 'details' | 'history' | 'photos' | 'notes' | 'tasks' | 'invoices' | 'billing';

@Component({
  selector: 'app-user-management',
  imports: [CommonModule, FormsModule, RegisterCustomerModalComponent, RecreateOrderModalComponent, AdminUserBillingComponent],
  templateUrl: './user-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./user-management.component.scss']
})
export class UserManagementComponent implements OnInit, AfterViewInit, OnDestroy {
  private adminService = inject(AdminService);
  private orderService = inject(OrderService);
  private bubbleRewardsService = inject(BubbleRewardsService);
  private adminBonusService = inject(AdminBonusService);
  private contractService = inject(ContractService);
  private invoiceService = inject(InvoiceService);

  readonly tableWrapper = viewChild<ElementRef<HTMLDivElement>>('tableWrapper');
  readonly tableHeader = viewChild<ElementRef<HTMLTableSectionElement>>('tableHeader');

  /** Set from the ?userId= query param (e.g. the orders panel's "View User" button) — auto-opens that user. */
  readonly openUserId = model<number | null>(null);

  /**
   * WHICH AUDIENCE this instance lists — Users → Customers, or Users → Staff.
   *
   * ONE COMPONENT, TWO SCOPES, deliberately. Customers and staff are the same records with the
   * same detail panel, the same notes, the same flags and the same permission model; the only
   * difference is which roles belong on screen. A second component would be a second copy of two
   * thousand lines that would drift on the first change either side.
   *
   * Defaults to 'customers' so the tab an admin lands on shows what "Users" has always meant.
   * Filtering is applied on TOP of the ordinary role filter — see `scopedUsers` — so a scope can
   * never widen what the filter narrowed.
   */
  readonly scope = input<'customers' | 'staff'>('customers');

  /**
   * PANEL-ONLY MODE: render just this one account's detail panel, with no list around it.
   *
   * Business Clients opens the customer behind a linked client in place, as a second tab of its
   * own panel, rather than sending the admin to the Customers tab to read the other half of a
   * customer they already have open. What it shows there has to be the REAL record — every tab,
   * every action, the same permission gates — so this mounts the component itself rather than
   * lifting the panel's 850 lines of markup into a shared child.
   *
   * Extracting it was the other option and is the wrong trade here: the panel's styles live in
   * this component's stylesheet, which Cleaners and Business Clients both list FIRST in their own
   * styleUrls to get the shell, the table and the slide-in panel. Moving those rules into a child
   * would take them away from two other panels that render the same classes in their own
   * templates — so extraction buys a second stylesheet or a copy of one, and this buys neither.
   *
   * Everything below is untouched by it: the same handlers, the same loads, the same guards. The
   * mode only decides what is DRAWN — the list, the filters, the header and the click-away
   * overlay all belong to the host in this mode, not to us.
   */
  readonly embeddedUserId = input<number | null>(null);

  /** Closed from inside the panel (its ✕), so an embedding host can drop it. */
  readonly closed = output<void>();

  get isEmbedded(): boolean {
    return this.embeddedUserId() !== null;
  }

  /** The roles that count as STAFF. SuperAdmin / Admin / Moderator — never a customer. */
  private static readonly STAFF_ROLES = ['superadmin', 'admin', 'moderator'];

  readonly users = signal<UserAdmin[]>([], { equal: () => false });
  readonly loadingUsers = signal(false);
  readonly userRole = signal<string>('');
  readonly currentUserRole = signal<string>('');
  roleDropdownUserId: number | null = null;
  userPermissions: UserPermissions | null = null;
  readonly canCreate = signal(false);
  readonly canUpdate = signal(false);
  canDelete = false;
  readonly canActivate = signal(false);
  readonly canDeactivate = signal(false);
  readonly searchTerm = signal<string>('');
  readonly statusFilter = signal<string>('all');
  readonly roleFilter = signal<string>('all');
  // Customer-type filter, based on non-cancelled order count: 'new' = exactly one order,
  // 'returning' = two or more, 'none' = no orders yet.
  readonly customerTypeFilter = signal<string>('all');
  readonly currentPage = signal(1);
  itemsPerPage = 20;
  /** Derived from the filtered list (it used to be written as a side effect of rendering filteredUsers). */
  get totalPages(): number {
    return Math.ceil(this.matchingUsers.length / this.itemsPerPage);
  }

  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  /** Register-customer modal visibility. The form itself lives in the shared modal component. */
  readonly showRegisterModal = signal(false);

  // ── Export (SuperAdmin-only) ──
  readonly showExportModal = signal(false);
  readonly exporting = signal(false);
  readonly exportError = signal('');
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
  readonly selectedUser = signal<DetailedUser | null>(null, { equal: () => false });
  readonly viewingUserId = signal<number | null>(null);
  readonly loadingUserDetails = signal(false);
  readonly detailTab = signal<DetailTab>('details');

  // SuperAdmin full edit
  readonly editingUser = signal(false);
  readonly editUserForm = signal<SuperAdminUpdateUserDto>({ firstName: '', lastName: '', email: '', role: 'Customer', isActive: true, firstTimeOrder: true, canReceiveCommunications: true, canReceiveEmails: true, canReceiveMessages: true }, { equal: () => false });
  readonly savingUser = signal(false);
  readonly togglingCommsUserId = signal<number | null>(null);
  /** User id whose flag is mid-update (disables the flag buttons). */
  readonly flaggingUserId = signal<number | null>(null);

  // Manual "we miss you" reminder (Admin/SuperAdmin)
  readonly sendingReminder = signal(false);

  // Address editing (Admin/SuperAdmin)
  readonly editingAddressId = signal<number | null>(null);
  readonly editAddressDraft = signal<Apartment | null>(null);
  readonly showAddAddress = signal(false);
  readonly newAddress = signal<CreateApartment>({ name: '', address: '', city: '', state: '', postalCode: '' });
  readonly savingAddress = signal(false);

  // Bubble Rewards (admin view)
  readonly userRewardsSummary = signal<any>(null);
  rewardsLoading = false;
  readonly adjustPointsAmount = signal<number>(0);
  readonly adjustPointsDesc = signal<string>('');
  readonly savingPoints = signal(false);
  readonly pointsSaveMessage = signal('');

  // Referral management (SuperAdmin)
  readonly newReferralEmail = signal('');
  readonly newReferralSearchResults = signal<{ id: number; email: string; name: string }[]>([]);
  readonly addingReferral = signal(false);
  readonly referralActionMessage = signal('');
  readonly removingReferralId = signal<number | null>(null);
  readonly removingReferredBy = signal(false);

  // Set/correct "referred by" (SuperAdmin)
  readonly newReferrerEmail = signal('');
  readonly newReferrerSearchResults = signal<{ id: number; email: string; name: string }[]>([]);
  readonly settingReferredBy = signal(false);

  // ── Customer-care: notes (general only) ──
  readonly generalNotes = signal<UserNote[]>([], { equal: () => false });
  readonly loadingNotes = signal(false);

  readonly newNoteContent = signal('');
  readonly savingNote = signal(false);

  readonly editingNoteId = signal<number | null>(null);
  readonly editNoteContent = signal('');

  // ── Customer-care: photos ──
  readonly cleaningPhotoGroups = signal<UserCleaningPhotosByOrder[]>([]);
  readonly loadingPhotos = signal(false);
  readonly uploadingPhoto = signal(false);
  /** Progress label shown on the upload button while a batch is in flight (e.g. "Uploading 2/5…"). */
  readonly photoUploadProgress = signal('');
  readonly photoUploadOrderId = signal<number | null>(null);
  readonly photoUploadError = signal('');
  readonly photoUploadSuccess = signal('');
  readonly lightboxPhoto = signal<UserCleaningPhoto | null>(null);

  // ── Customer-care: tasks ──
  userTasks: any[] = [];
  loadingTasks = false;
  private readonly userLastCleaningVariantCache = signal<Map<number, 'Deep' | 'Regular'>>(new Map(), { equal: () => false });

  // Admin bonus stats — only loaded when the user being viewed has the Admin role.
  readonly adminBonusAllTime = signal<AdminBonusSummary | null>(null);
  readonly adminBonusThisMonth = signal<AdminBonusSummary | null>(null);
  loadingAdminBonus = false;

  ngOnInit() {
    // Panel-only mode opens straight onto its account, through the SAME path the ?userId= deep
    // link uses — so the panel is filled by exactly the code that fills it on the Users tab, and
    // there is no second way for a record to arrive in it.
    if (this.embeddedUserId() !== null) this.openUserId.set(this.embeddedUserId());

    this.loadUserPermissions();
    this.loadUsers();
    // Both controls below are authorized by rules the role hierarchy does not express, so the
    // server is asked rather than inferred from currentUserRole.
    this.loadContractPermissions();
    this.loadOrgTitleAccess();
  }

  ngAfterViewInit() {
    this.initializeStickyHeader();
  }

  private initializeStickyHeader() {
    // No table in panel-only mode — without this the retry loop below ticks through all of its
    // attempts on every load, waiting for an element that is never going to be drawn.
    if (this.isEmbedded) return;

    const tableWrapper = this.tableWrapper();
    const tableHeader = this.tableHeader();
    if (!tableWrapper || !tableHeader) {
      if (this.initializationRetries < this.maxRetries) {
        this.initializationRetries++;
        setTimeout(() => {
          this.initializeStickyHeader();
        }, 50);
      }
      return;
    }

    if (!tableWrapper.nativeElement || !tableHeader.nativeElement) {
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
    const tableWrapper = this.tableWrapper();
    if (this.horizontalScrollListener && tableWrapper) {
      const wrapperEl = tableWrapper.nativeElement;
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
    const tableWrapper = this.tableWrapper();
    if (!tableWrapper || !this.tableHeader()) return;
    if (this.stickyHeaderInitialized) {
      this.updateStickyHeader();
      return;
    }

    this.scrollListener = () => this.updateStickyHeader();
    window.addEventListener('scroll', this.scrollListener, true);

    this.horizontalScrollListener = () => this.syncHorizontalScroll();
    const wrapperEl = tableWrapper.nativeElement;
    wrapperEl.addEventListener('scroll', this.horizontalScrollListener, { passive: true });
    wrapperEl.addEventListener('touchmove', this.horizontalScrollListener, { passive: true });
    wrapperEl.addEventListener('wheel', this.horizontalScrollListener, { passive: true });

    this.stickyHeaderInitialized = true;
    this.updateStickyHeader();
  }

  private updateStickyHeader() {
    const tableWrapper = this.tableWrapper();
    const tableHeader = this.tableHeader();
    if (!tableWrapper || !tableHeader) return;

    const wrapper = tableWrapper.nativeElement;
    const header = tableHeader.nativeElement;
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
    const tableWrapper = this.tableWrapper();
    const tableHeader = this.tableHeader();
    if (!tableWrapper || !tableHeader) return;

    const wrapper = tableWrapper.nativeElement;
    const header = tableHeader.nativeElement;

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
        this.userRole.set(permissions.role);
        this.currentUserRole.set(permissions.role);

        this.canCreate.set(permissions.permissions.canCreate);
        this.canUpdate.set(permissions.permissions.canUpdate);
        this.canDelete = permissions.permissions.canDelete;
        this.canActivate.set(permissions.permissions.canActivate);
        this.canDeactivate.set(permissions.permissions.canDeactivate);
      },
      error: (error) => {
        console.error('Failed to load permissions', error);
        this.userRole.set('');
        this.canCreate.set(false);
        this.canUpdate.set(false);
        this.canDelete = false;
        this.canActivate.set(false);
        this.canDeactivate.set(false);
      }
    });
  }

  loadUsers() {
    if (this.loadingUsers()) return;

    this.loadingUsers.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.currentPage.set(1);
    this.roleDropdownUserId = null;
    this.closeDetailPanel();
    this.userLastCleaningVariantCache().clear();
    this.userLastCleaningVariantCache.set(this.userLastCleaningVariantCache());

    this.adminService.getUsers(true).subscribe({
      next: (response) => {
        this.users.set(Array.isArray(response) ? response : response.users);
        this.resolveUserLastCleaningVariants(this.users());
        this.openPendingUserDetails();
      },
      error: (error) => {
        console.error('Failed to load users', error);
        this.errorMessage.set(error?.error?.message || 'Failed to load users. Please try again.');
      },
      complete: () => {
        this.loadingUsers.set(false);
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
    const pendingId = this.openUserId();
    if (!pendingId) return;
    this.openUserId.set(null);

    const user = this.users().find(u => u.id === pendingId);
    if (!user) {
      this.errorMessage.set(`User #${pendingId} was not found.`);
      return;
    }

    const index = this.matchingUsers.findIndex(u => u.id === pendingId);
    if (index >= 0) {
      this.currentPage.set(Math.floor(index / this.itemsPerPage) + 1);
    }

    setTimeout(() => this.openUserDetails(user), 100);
  }

  openUserDetails(user: UserAdmin): void {
    if (this.viewingUserId() === user.id) {
      this.closeDetailPanel();
      return;
    }

    this.viewingUserId.set(user.id);
    this.detailTab.set('details');
    this.roleDropdownUserId = null;
    this.editingUser.set(false);
    this.loadingUserDetails.set(true);
    this.selectedUser.set({ ...user });

    // Reset child sections
    this.generalNotes.set([]);
    this.cleaningPhotoGroups.set([]);
    this.userTasks = [];
    this.editingNoteId.set(null);
    this.newNoteContent.set('');

    this.loadUserOrders(user.id);
    this.loadUserApartments(user.id);
    this.loadUserRewards(user.id);
    this.loadUserLoyalty(user.id);
    this.loadUserNotes(user.id);
    this.loadUserTasksList(user.id);
    this.loadCleaningPhotos(user.id);
    this.loadAdminBonusStats(user);
    this.loadUserInvoices(user.id);
    this.loadBusinessClient(user);
  }

  // ── Invoices, and the commercial record behind a business account ──────────────────────────
  //
  // TWO SEPARATE QUESTIONS, deliberately:
  //
  //  • "Does this customer have invoices?" is asked of EVERY account. An ordinary customer can
  //    have them — one of their cleanings may have been billed on a company's invoice — so the
  //    tab is driven by what comes back, not by whether the account is flagged as a business.
  //    An empty result hides the tab entirely: a tab that opens onto "no invoices" is a tab that
  //    trains people not to click it.
  //
  //  • "Is this account also a commercial client?" adds the OTHER HALF of a business customer to
  //    this same panel, so nobody has to cross to the Business Clients tab to read the billing
  //    entity, its contracts and where its invoices go. The two records are shown side by side
  //    rather than merged — an account email is a login and a notice email is where invoices go,
  //    and they are allowed to differ.

  readonly userInvoices = signal<LinkedInvoiceSummary[]>([]);
  loadingUserInvoices = false;

  readonly businessClient = signal<InvoiceClientOption | null>(null);
  readonly loadingBusinessClient = signal(false);

  private loadUserInvoices(userId: number): void {
    this.userInvoices.set([]);
    this.loadingUserInvoices = true;

    this.invoiceService.invoicesForUser(userId)
      .pipe(finalize(() => this.loadingUserInvoices = false))
      .subscribe({
        next: rows => {
          // The panel may have moved on to another user while this was in flight.
          if (this.viewingUserId() !== userId) return;
          this.userInvoices.set(rows ?? []);

          // The tab is hidden when the list is empty, so a panel sitting on it would render an
          // empty pane with no tab selected. Only reachable when a deep link or a previous user
          // left the panel there.
          if (!this.hasInvoices && this.detailTab() === 'invoices') this.detailTab.set('details');
        },
        // Non-fatal, and it fails CLOSED: no rows means no tab, which is the same thing an
        // account with no invoices sees. A broken tab would be worse than a missing one.
        error: () => { if (this.viewingUserId() === userId) this.userInvoices.set([]); }
      });
  }

  private loadBusinessClient(user: UserAdmin): void {
    this.businessClient.set(null);

    // Asked only of accounts the server has already told us are business clients, so an ordinary
    // customer's panel does not fire a request that can only answer "no".
    if (!user.hasActiveBusinessClient && !user.isBusiness) return;

    this.loadingBusinessClient.set(true);

    this.invoiceService.clientForUser(user.id)
      .pipe(finalize(() => this.loadingBusinessClient.set(false)))
      .subscribe({
        next: client => { if (this.viewingUserId() === user.id) this.businessClient.set(client ?? null); },
        error: () => { if (this.viewingUserId() === user.id) this.businessClient.set(null); }
      });
  }

  /** The Invoices tab exists only when there is something in it. */
  get hasInvoices(): boolean {
    return this.userInvoices().length > 0;
  }

  // Only fetched for users with the Admin role — the bonus system doesn't apply to others.
  // SuperAdmins are managers (they don't earn the per-order bonus), so we skip them too.
  private loadAdminBonusStats(user: UserAdmin): void {
    this.adminBonusAllTime.set(null);
    this.adminBonusThisMonth.set(null);
    if (user.role !== 'Admin') return;

    this.loadingAdminBonus = true;

    // Current calendar month (UTC) — same window the shifts panel uses.
    const now = new Date();
    const monthFrom = this.toYmd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
    const monthTo   = this.toYmd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));

    this.adminBonusService.getForAdmin(user.id).subscribe({
      next: s => this.adminBonusAllTime.set(s),
      error: () => { /* leave null — UI hides the stat */ }
    });
    this.adminBonusService.getForAdmin(user.id, monthFrom, monthTo).subscribe({
      next: s => { this.adminBonusThisMonth.set(s); this.loadingAdminBonus = false; },
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
    if (this.viewingUserId() !== user.id) {
      this.openUserDetails(user);
      setTimeout(() => this.setDetailTab(tab), 0);
      return;
    }
    this.setDetailTab(tab);
  }

  /**
   * The ✕ and the click-away overlay — a person closing the panel, as opposed to the panel being
   * emptied by a reload. `loadUsers` calls `closeDetailPanel` on every refresh, so the two cannot
   * share a handler: an embedding host would be told to unmount on the component's first load.
   */
  dismissDetailPanel(): void {
    this.closeDetailPanel();
    this.closed.emit();
  }

  closeDetailPanel(): void {
    this.viewingUserId.set(null);
    this.selectedUser.set(null);
    this.editingUser.set(false);
    this.userRewardsSummary.set(null);
    this.lightboxPhoto.set(null);
    this.adminBonusAllTime.set(null);
    this.adminBonusThisMonth.set(null);
    this.userInvoices.set([]);
    this.businessClient.set(null);
  }

  setDetailTab(tab: DetailTab): void {
    this.detailTab.set(tab);
    if (!this.selectedUser()) return;
    if (tab === 'photos' && this.cleaningPhotoGroups().length === 0 && !this.loadingPhotos()) {
      this.loadCleaningPhotos(this.selectedUser()!.id);
    }
    if (tab === 'tasks' && this.userTasks.length === 0 && !this.loadingTasks) {
      this.loadUserTasksList(this.selectedUser()!.id);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.lightboxPhoto()) {
      this.lightboxPhoto.set(null);
      return;
    }
    if (this.viewingUserId() !== null) {
      this.dismissDetailPanel();
    }
  }

  // ── Detail data loaders ──

  /**
   * The History list shows EVERY order (cancelled and refunded ones with their status badge), but
   * Total Jobs and Total Spent count only real business (owner's rule, 2026-10): no cancelled or
   * fully refunded order, and what was refunded off a partly refunded order was not spent. Both
   * figures come from the server (GET users/{id}/profile — OrderPaymentFilter.RealizedAmount), the
   * one place the paid / refunded rule lives; the panel used to re-add every non-cancelled order's
   * total here, refunds and unpaid bookings included.
   */
  private loadUserOrders(userId: number) {
    forkJoin({
      orders: this.adminService.getUserOrders(userId),
      // A failed statistics read must not blank the History list.
      profile: this.adminService.getUserProfile(userId).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ orders, profile }) => {
        if (this.selectedUser() && this.selectedUser()!.id === userId) {
          const validOrders = orders.filter(order => !isCancelledOrRefundedStatus(order.status));

          this.selectedUser()!.orders = orders;
          this.selectedUser.set(this.selectedUser());
          this.selectedUser()!.totalOrders = profile?.totalOrders ?? validOrders.length;
          this.selectedUser.set(this.selectedUser());
          this.selectedUser()!.totalSpent = profile?.totalSpent ?? 0;
          this.selectedUser.set(this.selectedUser());
          this.selectedUser()!.registrationDate = new Date(this.selectedUser()!.createdAt);
          this.selectedUser.set(this.selectedUser());

          if (validOrders.length > 0) {
            const sorted = validOrders.sort((a, b) =>
              new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
            );
            this.selectedUser()!.lastOrderDate = new Date(sorted[0].orderDate);
            this.selectedUser.set(this.selectedUser());
          }
        }
        this.loadingUserDetails.set(false);
      },
      error: (error) => {
        console.error('Failed to load user orders', error);
        if (this.selectedUser() && this.selectedUser()!.id === userId) {
          this.selectedUser()!.orders = [];
          this.selectedUser.set(this.selectedUser());
          this.selectedUser()!.totalOrders = 0;
          this.selectedUser.set(this.selectedUser());
          this.selectedUser()!.totalSpent = 0;
          this.selectedUser.set(this.selectedUser());
        }
        this.loadingUserDetails.set(false);
      }
    });
  }

  private loadUserApartments(userId: number) {
    this.adminService.getUserApartments(userId).subscribe({
      next: (apartments: Apartment[]) => {
        if (this.selectedUser() && this.selectedUser()!.id === userId) {
          this.selectedUser()!.apartments = apartments;
          this.selectedUser.set(this.selectedUser());
        }
      },
      error: () => {
        if (this.selectedUser() && this.selectedUser()!.id === userId) {
          this.selectedUser()!.apartments = [];
          this.selectedUser.set(this.selectedUser());
        }
      }
    });
  }

  // ── Loyalty Discount (re-engagement) ──
  // The view always loads the current state. Editing is gated to Admin/SuperAdmin via
  // canEditUserDetails in the template — Moderator sees the badge but no Edit button.
  readonly loyaltyDiscount = signal<LoyaltyDiscountDto | null>(null);
  readonly loadingLoyalty = signal(false);
  readonly editingLoyalty = signal(false);
  readonly loyaltyForm = signal<{ percentage: number; isLifetime: boolean }>({ percentage: 0, isLifetime: false });
  readonly savingLoyalty = signal(false);
  readonly loyaltyError = signal('');
  readonly loyaltySuccess = signal('');

  loadUserLoyalty(userId: number): void {
    this.loadingLoyalty.set(true);
    this.loyaltyDiscount.set(null);
    this.loyaltyError.set('');
    this.editingLoyalty.set(false);
    this.adminService.getUserLoyaltyDiscount(userId).subscribe({
      next: (dto) => {
        if (this.selectedUser()?.id !== userId) return;
        this.loyaltyDiscount.set(dto);
        this.loyaltyForm.set({ percentage: dto?.percentage ?? 0, isLifetime: dto?.isLifetime ?? false });
        this.loadingLoyalty.set(false);
      },
      error: () => { this.loadingLoyalty.set(false); }
    });
  }

  startEditLoyaltyDiscount(): void {
    this.loyaltyForm.set({
      percentage: this.loyaltyDiscount()?.percentage ?? 0,
      isLifetime: this.loyaltyDiscount()?.isLifetime ?? false
    });
    this.loyaltyError.set('');
    this.loyaltySuccess.set('');
    this.editingLoyalty.set(true);
  }

  cancelEditLoyalty(): void {
    this.editingLoyalty.set(false);
    this.loyaltyError.set('');
  }

  saveLoyaltyDiscount(): void {
    if (!this.selectedUser() || this.savingLoyalty()) return;
    const userId = this.selectedUser()!.id;
    this.savingLoyalty.set(true);
    this.loyaltyError.set('');
    this.loyaltySuccess.set('');
    this.adminService.setUserLoyaltyDiscount(
      userId, this.loyaltyForm().percentage, this.loyaltyForm().isLifetime
    ).subscribe({
      next: (dto) => {
        if (this.selectedUser()?.id !== userId) { this.savingLoyalty.set(false); return; }
        this.loyaltyDiscount.set(dto);
        this.editingLoyalty.set(false);
        this.savingLoyalty.set(false);
        this.loyaltySuccess.set('Loyalty discount updated.');
        setTimeout(() => { this.loyaltySuccess.set(''); }, 4000);
      },
      error: (err) => {
        this.loyaltyError.set(err?.error?.message || 'Failed to update loyalty discount.');
        this.savingLoyalty.set(false);
      }
    });
  }

  clearLoyaltyDiscount(): void {
    if (!this.selectedUser() || this.savingLoyalty()) return;
    const userId = this.selectedUser()!.id;
    this.savingLoyalty.set(true);
    this.loyaltyError.set('');
    this.loyaltySuccess.set('');
    this.adminService.clearUserLoyaltyDiscount(userId).subscribe({
      next: (dto) => {
        if (this.selectedUser()?.id !== userId) { this.savingLoyalty.set(false); return; }
        this.loyaltyDiscount.set(dto);
        this.loyaltyForm.set({ percentage: 0, isLifetime: false });
        this.editingLoyalty.set(false);
        this.savingLoyalty.set(false);
        this.loyaltySuccess.set('Loyalty discount cleared.');
        setTimeout(() => { this.loyaltySuccess.set(''); }, 4000);
      },
      error: (err) => {
        this.loyaltyError.set(err?.error?.message || 'Failed to clear loyalty discount.');
        this.savingLoyalty.set(false);
      }
    });
  }

  loadUserRewards(userId: number): void {
    this.rewardsLoading = true;
    this.userRewardsSummary.set(null);
    this.adjustPointsDesc.set('');
    this.newReferralEmail.set('');
    this.newReferralSearchResults.set([]);
    this.newReferrerEmail.set('');
    this.newReferrerSearchResults.set([]);
    this.referralActionMessage.set('');
    this.bubbleRewardsService.getAdminUserSummary(userId).subscribe({
      next: (s) => {
        this.userRewardsSummary.set(s);
        this.adjustPointsAmount.set(s.currentPoints ?? 0);
        this.rewardsLoading = false;
      },
      error: () => { this.rewardsLoading = false; }
    });
  }

  // ── Notes ──

  private loadUserNotes(userId: number): void {
    this.loadingNotes.set(true);
    this.adminService.getUserCareNotes(userId).subscribe({
      next: (notes) => {
        if (this.selectedUser()?.id !== userId) return;
        // Only general notes exist now — follow-up notes were removed.
        this.generalNotes.set(notes.filter(n => n.type === 'General'));
        this.loadingNotes.set(false);
      },
      error: () => { this.loadingNotes.set(false); }
    });
  }

  saveNewNote(): void {
    if (!this.selectedUser() || this.savingNote()) return;
    const content = this.newNoteContent().trim();
    if (!content) return;

    const dto: CreateUserNoteDto = {
      type: 'General',
      content
    };

    this.savingNote.set(true);
    this.adminService.createUserCareNote(this.selectedUser()!.id, dto).subscribe({
      next: (note) => {
        this.generalNotes.set([note, ...this.generalNotes()]);
        this.newNoteContent.set('');
        this.savingNote.set(false);
        this.successMessage.set('Note added.');
        setTimeout(() => this.successMessage.set(''), 2500);
      },
      error: (err) => {
        this.savingNote.set(false);
        this.errorMessage.set(err?.error?.message || 'Failed to save note.');
        setTimeout(() => this.errorMessage.set(''), 3000);
      }
    });
  }

  startEditNote(note: UserNote): void {
    this.editingNoteId.set(note.id);
    this.editNoteContent.set(note.content);
  }

  cancelEditNote(): void {
    this.editingNoteId.set(null);
    this.editNoteContent.set('');
  }

  saveEditNote(note: UserNote): void {
    if (this.editingNoteId() !== note.id) return;
    const content = this.editNoteContent().trim();
    if (!content) return;

    const dto: UpdateUserNoteDto = { content };

    this.adminService.updateUserCareNote(note.id, dto).subscribe({
      next: (updated) => {
        const idx = this.generalNotes().findIndex(n => n.id === updated.id);
        if (idx >= 0) { this.generalNotes()[idx] = updated; this.generalNotes.set(this.generalNotes()); }
        this.cancelEditNote();
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message || 'Failed to update note.');
        setTimeout(() => this.errorMessage.set(''), 3000);
      }
    });
  }

  deleteNote(note: UserNote): void {
    if (!confirm('Delete this note?')) return;
    this.adminService.deleteUserCareNote(note.id).subscribe({
      next: () => {
        this.generalNotes.set(this.generalNotes().filter(n => n.id !== note.id));
      }
    });
  }

  // ── Photos ──

  private loadCleaningPhotos(userId: number): void {
    this.loadingPhotos.set(true);
    this.adminService.getUserCleaningPhotos(userId).subscribe({
      next: (groups) => {
        if (this.selectedUser()?.id !== userId) return;
        this.cleaningPhotoGroups.set(groups);
        this.loadingPhotos.set(false);
      },
      error: () => { this.loadingPhotos.set(false); }
    });
  }

  /** Select an order to attach the next upload to. Used by the upload form. */
  setPhotoOrderId(orderId: number | null | undefined): void {
    this.photoUploadOrderId.set(orderId ?? null);
  }

  onPhotoFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !this.selectedUser()) return;
    const files = Array.from(input.files);
    input.value = '';
    // Photos must always be attached to a specific order — unassigned uploads are not allowed.
    if (this.photoUploadOrderId() == null) {
      this.photoUploadError.set('Select the order these photos belong to first.');
      setTimeout(() => this.photoUploadError.set(''), 4000);
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
    if (!this.selectedUser() || this.uploadingPhoto() || files.length === 0) return;
    this.uploadingPhoto.set(true);
    this.photoUploadError.set('');
    this.photoUploadSuccess.set('');
    this.photoUploadProgress.set('');

    const total = files.length;
    let okCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    const uploadOne = (index: number) => {
      if (!this.selectedUser()) {
        this.uploadingPhoto.set(false);
        this.photoUploadProgress.set('');
        return;
      }
      if (index >= total) {
        // All done — refresh once and report
        this.uploadingPhoto.set(false);
        this.photoUploadProgress.set('');
        if (okCount > 0) {
          this.photoUploadSuccess.set(total === 1
            ? 'Photo uploaded.'
            : `${okCount} of ${total} photo${total === 1 ? '' : 's'} uploaded.`);
          setTimeout(() => this.photoUploadSuccess.set(''), 3000);
        }
        if (failCount > 0) {
          this.photoUploadError.set(`${failCount} upload${failCount === 1 ? '' : 's'} failed${errors[0] ? ': ' + errors[0] : ''}.`);
          setTimeout(() => this.photoUploadError.set(''), 5000);
        }
        if (this.selectedUser()) this.loadCleaningPhotos(this.selectedUser()!.id);
        return;
      }

      this.photoUploadProgress.set(total > 1 ? `Uploading ${index + 1}/${total}…` : 'Uploading…');

      this.adminService.uploadUserCleaningPhoto(
        this.selectedUser()!.id,
        files[index],
        this.photoUploadOrderId() ?? undefined
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
        if (this.selectedUser()) this.loadCleaningPhotos(this.selectedUser()!.id);
      }
    });
  }

  openLightbox(photo: UserCleaningPhoto): void {
    this.lightboxPhoto.set(photo);
  }

  closeLightbox(): void {
    this.lightboxPhoto.set(null);
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
      return `${environment.apiUrl}/files/cleaning-photos/${photoOrUrl}`;
    }
    if (typeof photoOrUrl === 'object' && 'id' in photoOrUrl && photoOrUrl.id) {
      // An empty photoUrl means the server would not expose this row (not a local upload).
      return photoOrUrl.photoUrl ? `${environment.apiUrl}/files/cleaning-photos/${photoOrUrl.id}` : '';
    }
    return typeof photoOrUrl === 'string' ? photoOrUrl : '';
  }

  // ── Tasks ──

  private loadUserTasksList(userId: number): void {
    this.loadingTasks = true;
    this.adminService.getUserTasks(userId).subscribe({
      next: (items) => {
        if (this.selectedUser()?.id !== userId) return;
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

  /**
   * The CTO's SuperAdmin role is not removable by anyone — mirrors CtoRoleLockPolicy on the
   * server, which refuses it on both role-change endpoints whatever this returns. Checked BEFORE
   * the role hierarchy everywhere below, because a SuperAdmin passes every hierarchy test.
   * The way out is the officer title, not the role: clear CTO first.
   */
  isCtoRoleLocked(user: { role?: string; orgTitle?: string } | null): boolean {
    return !!user && user.orgTitle === 'CTO' && user.role === 'SuperAdmin';
  }

  readonly ctoRoleLockReason =
    'This account holds the CTO title, so its SuperAdmin role cannot be changed. Clear the officer title first.';

  canChangeUserRole(user: UserAdmin, newRole: string): boolean {
    const currentUserId = this.getCurrentUserId();
    if (this.isCtoRoleLocked(user)) return false;
    if (user.id === currentUserId) return false;
    if (this.currentUserRole() === 'SuperAdmin') return true;
    if (this.currentUserRole() === 'Admin' && user.role !== 'SuperAdmin') return true;
    return false;
  }

  canModifyUserRole(user: any): boolean {
    const currentUserId = this.getCurrentUserId();
    if (this.isCtoRoleLocked(user)) return false;
    if (user.id === currentUserId) return false;
    if (this.currentUserRole() === 'Admin' && user.role === 'SuperAdmin') return false;
    return this.canUpdate();
  }

  getRoleButtonTooltip(user: any): string {
    const currentUserId = this.getCurrentUserId();
    if (this.isCtoRoleLocked(user)) return this.ctoRoleLockReason;
    if (user.id === currentUserId) return 'You cannot change your own role';
    if (this.currentUserRole() === 'Admin' && user.role === 'SuperAdmin') return 'Admins cannot modify SuperAdmin roles';
    return '';
  }

  updateUserRole(user: UserAdmin, newRole: string) {
    if (!this.canChangeUserRole(user, newRole)) return;

    this.errorMessage.set('');
    this.successMessage.set('');

    const originalRole = user.role;
    user.role = newRole;

    this.adminService.updateUserRole(user.id, newRole).subscribe({
      next: () => {
        this.roleDropdownUserId = null;
        if (this.selectedUser() && this.selectedUser()!.id === user.id) {
          this.selectedUser()!.role = newRole;
          this.selectedUser.set(this.selectedUser());
        }
        this.successMessage.set(`Role updated to ${this.displayRole(newRole)}.`);
        setTimeout(() => this.successMessage.set(''), 4000);
      },
      error: (error) => {
        user.role = originalRole;
        this.errorMessage.set(error.error?.message || 'Failed to update user role.');
        setTimeout(() => this.errorMessage.set(''), 4000);
      }
    });
  }

  // ── Restricted-page view grants (SuperAdmin → regular Admin, read-only) ──

  /** Registry of grantable restricted pages, used to render one toggle each. */
  readonly viewablePageOptions = ADMIN_VIEWABLE_PAGES;

  /** Show the page-access control only when a SuperAdmin is viewing a regular Admin. */
  canManagePageAccess(user: DetailedUser | UserAdmin | null): boolean {
    return !!user && this.currentUserRole() === 'SuperAdmin' && user.role === 'Admin';
  }

  isPageGranted(user: DetailedUser | UserAdmin | null, pageKey: string): boolean {
    return !!user && Array.isArray(user.viewablePages) && user.viewablePages.includes(pageKey);
  }

  readonly togglingPageAccessUserId = signal<number | null>(null);

  toggleUserPageAccess(user: DetailedUser | UserAdmin, pageKey: string, granted: boolean, event?: Event) {
    event?.stopPropagation();
    if (!this.canManagePageAccess(user)) return;

    this.errorMessage.set('');
    this.successMessage.set('');

    const original = Array.isArray(user.viewablePages) ? [...user.viewablePages] : [];
    const next = granted
      ? Array.from(new Set([...original, pageKey]))
      : original.filter(k => k !== pageKey);

    // Optimistic update on both the row and the open panel copy.
    user.viewablePages = next;
    if (this.selectedUser() && this.selectedUser()!.id === user.id) {
      this.selectedUser()!.viewablePages = next;
      this.selectedUser.set(this.selectedUser());
    }
    this.togglingPageAccessUserId.set(user.id);

    this.adminService.updateUserViewablePages(user.id, next).subscribe({
      next: (res) => {
        this.togglingPageAccessUserId.set(null);
        user.viewablePages = res.pages;
        if (this.selectedUser() && this.selectedUser()!.id === user.id) {
          this.selectedUser()!.viewablePages = res.pages;
          this.selectedUser.set(this.selectedUser());
        }
      },
      error: (error) => {
        this.togglingPageAccessUserId.set(null);
        user.viewablePages = original;
        if (this.selectedUser() && this.selectedUser()!.id === user.id) {
          this.selectedUser()!.viewablePages = original;
          this.selectedUser.set(this.selectedUser());
        }
        this.errorMessage.set(error.error?.message || 'Failed to update page access.');
        setTimeout(() => this.errorMessage.set(''), 4000);
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

  readonly togglingOrderEditAccessUserId = signal<number | null>(null);

  toggleUserOrderEditAccess(user: DetailedUser | UserAdmin, granted: boolean, event?: Event) {
    event?.stopPropagation();
    if (!this.canManageOrderEditAccess(user)) return;
    if (this.isOrderEditGranted(user) === granted) return;

    this.errorMessage.set('');
    this.successMessage.set('');

    const original = !!user.canEditOrdersWithoutApproval;

    // Optimistic update on both the row and the open panel copy (same as the page grants).
    user.canEditOrdersWithoutApproval = granted;
    if (this.selectedUser() && this.selectedUser()!.id === user.id) {
      this.selectedUser()!.canEditOrdersWithoutApproval = granted;
      this.selectedUser.set(this.selectedUser());
    }
    this.togglingOrderEditAccessUserId.set(user.id);

    this.adminService.updateUserOrderEditApproval(user.id, granted).subscribe({
      next: (res) => {
        this.togglingOrderEditAccessUserId.set(null);
        user.canEditOrdersWithoutApproval = res.canEditOrdersWithoutApproval;
        if (this.selectedUser() && this.selectedUser()!.id === user.id) {
          this.selectedUser()!.canEditOrdersWithoutApproval = res.canEditOrdersWithoutApproval;
          this.selectedUser.set(this.selectedUser());
        }
      },
      error: (error) => {
        this.togglingOrderEditAccessUserId.set(null);
        user.canEditOrdersWithoutApproval = original;
        if (this.selectedUser() && this.selectedUser()!.id === user.id) {
          this.selectedUser()!.canEditOrdersWithoutApproval = original;
          this.selectedUser.set(this.selectedUser());
        }
        this.errorMessage.set(error.error?.message || 'Failed to update order edit access.');
        setTimeout(() => this.errorMessage.set(''), 4000);
      }
    });
  }

  // ── Position: Manager vs Administrator (SuperAdmin → regular Admin) ──
  //
  // NOT a permission. The position changes nothing about what a staff member may do — it decides
  // which side of the per-order bonus they earn, and who can be attached to whom. That is why it
  // sits beside the grants rather than inside them, and why it is a plain select rather than a
  // Yes/No toggle.

  /** Same audience as the grants: a SuperAdmin looking at a regular Admin. */
  canManageAdminPosition(user: DetailedUser | UserAdmin | null): boolean {
    return this.canManagePageAccess(user);
  }

  // ── Officer title (CEO / CTO) ────────────────────────────────────────────────
  // Relocated here from the Contracts tab (2026-09), so a staff member's title sits with the
  // other things about who they are, next to Role and Position.
  //
  // Its authority is NOT the role hierarchy the rest of this panel uses. Assigning a title is
  // governed by the bootstrap/locked rule on the server (OrgTitlePolicy): while no CTO exists any
  // SuperAdmin may assign one, and the moment one does, only that person may. `canAssignOrgTitle`
  // is the SERVER's answer to "may you", fetched once — never re-derived from a role here.

  /** Bootstrap/locked state for the signed-in account, from GET api/admin/org-titles. */
  readonly orgTitleAccess = signal<OrgTitleOverview | null>(null);
  readonly savingOrgTitleUserId = signal<number | null>(null);

  readonly orgTitleOptions = [
    { value: 'None', label: 'None' },
    { value: 'CEO', label: 'CEO' },
    { value: 'CTO', label: 'CTO' }
  ];

  /**
   * Officer titles exist on staff accounts only — a title on a customer or cleaner would mean
   * nothing. Deliberately wider than canManagePageAccess (SuperAdmin viewing an Admin): a
   * SuperAdmin can hold a title too, which is exactly who Nodar and Nika are.
   */
  isOfficerTitleApplicable(user: DetailedUser | UserAdmin | null): boolean {
    return !!user && (user.role === 'Admin' || user.role === 'SuperAdmin');
  }

  get canAssignOrgTitle(): boolean {
    return this.orgTitleAccess()?.canAssign === true;
  }

  /** Why the dropdown is read-only, in the same words the old Contracts panel used. */
  get orgTitleLockReason(): string {
    if (this.orgTitleAccess()?.isBootstrapMode) {
      return 'Only a SuperAdmin can assign officer titles until a CTO exists.';
    }
    return 'Locked to the current CTO — only that account can assign or clear officer titles.';
  }

  private loadOrgTitleAccess(): void {
    this.contractService.getOrgTitles().subscribe({
      next: overview => this.orgTitleAccess.set(overview),
      // Unknown authority renders the field read-only rather than offering a control the server
      // would refuse.
      error: () => this.orgTitleAccess.set(null)
    });
  }

  updateOrgTitle(user: DetailedUser | UserAdmin, orgTitle: string, event?: Event) {
    event?.stopPropagation();
    if (!this.canAssignOrgTitle || !this.isOfficerTitleApplicable(user)) return;
    if ((user.orgTitle || 'None') === orgTitle) return;

    const previous = user.orgTitle || 'None';
    this.savingOrgTitleUserId.set(user.id);
    this.errorMessage.set('');
    this.successMessage.set('');

    const title = orgTitle === 'CEO' ? OrgTitle.CEO : orgTitle === 'CTO' ? OrgTitle.CTO : OrgTitle.None;

    this.contractService.setOrgTitle(user.id, title).subscribe({
      next: res => {
        this.savingOrgTitleUserId.set(null);
        this.successMessage.set(res.message);

        // A title is held by one person at a time, and granting CTO closes bootstrap mode — which
        // can change who may use this control at all, including the person who just used it. So
        // the whole list and the authorization state are both refreshed rather than patched.
        this.loadUsers();
        this.loadOrgTitleAccess();
      },
      error: err => {
        this.savingOrgTitleUserId.set(null);
        user.orgTitle = previous;
        this.errorMessage.set(extractApiErrorMessage(err, 'That officer title could not be changed.'));
      }
    });
  }

  // ── Business flag ────────────────────────────────────────────────────────────
  // Also relocated here (2026-09). Gated by the CONTRACTS permission matrix rather than the
  // ordinary role hierarchy — Manager and CTO hold it, the CEO deliberately does not — so the
  // answer comes from the server rather than from currentUserRole.

  readonly contractPermissions = signal<ContractPermissions | null>(null);
  readonly togglingBusinessUserId = signal<number | null>(null);

  get canToggleBusinessFlag(): boolean {
    return this.contractPermissions()?.toggleBusinessFlag === true;
  }

  /** The flag only means anything on a customer account. */
  isBusinessFlagApplicable(user: DetailedUser | UserAdmin | null): boolean {
    return !!user && user.role === 'Customer';
  }

  private loadContractPermissions(): void {
    this.contractService.getMyPermissions().subscribe({
      next: permissions => this.contractPermissions.set(permissions),
      error: () => this.contractPermissions.set(null)
    });
  }

  toggleBusinessFlag(user: DetailedUser | UserAdmin, isBusiness: boolean, event?: Event) {
    event?.stopPropagation();
    if (!this.canToggleBusinessFlag || !this.isBusinessFlagApplicable(user)) return;
    if ((user.isBusiness ?? false) === isBusiness) return;

    const previous = user.isBusiness ?? false;
    this.togglingBusinessUserId.set(user.id);
    this.errorMessage.set('');
    this.successMessage.set('');

    // Optimistic, like the other toggles in this panel; reverted on failure.
    user.isBusiness = isBusiness;
    this.syncBusinessTabMembership(user.id, isBusiness);

    this.contractService.setBusinessFlag(user.id, isBusiness).subscribe({
      next: res => {
        this.togglingBusinessUserId.set(null);
        user.isBusiness = res.isBusiness;
        this.syncBusinessTabMembership(user.id, res.isBusiness);
        this.successMessage.set(res.message);
      },
      error: err => {
        this.togglingBusinessUserId.set(null);
        user.isBusiness = previous;
        this.syncBusinessTabMembership(user.id, previous);
        // The server refuses to unflag an account a contract still depends on, and that message
        // is the useful one — surfaced verbatim rather than replaced with a generic failure.
        this.errorMessage.set(extractApiErrorMessage(err, 'The business flag could not be changed.'));
      }
    });
  }

  /**
   * Moves the row between the Customers and Business Clients sub-tabs, in step with the flag.
   *
   * `scopedUsers` partitions on `hasActiveBusinessClient` — the SERVER's answer to "is this
   * account on the Business Clients tab" — and the optimistic flag flip above does not touch it,
   * so without this the row sat on Customers until the next full list load and the account looked
   * like it had been flagged twice. Setting the flag is precisely what makes the linked client
   * active or inactive (BusinessClientService's state machine is exhaustive: on ⇒ active client,
   * off ⇒ deactivated), so the flag IS the local answer until the list is fetched again.
   *
   * Reloading the list instead would be the wrong trade: `loadUsers` resets to page 1 and closes
   * the detail panel the admin is toggling from.
   *
   * Looked up by id rather than written through `user`, because the toggle lives in the detail
   * panel and `selectedUser` is a SEPARATE object from the table row it was opened from — the row
   * in `users` is the only one the tab filters, and the one the flip never reached.
   */
  private syncBusinessTabMembership(userId: number, isBusiness: boolean): void {
    const row = this.users().find(u => u.id === userId);
    if (!row) return;

    row.isBusiness = isBusiness;
    this.users.set(this.users());
    row.hasActiveBusinessClient = isBusiness;
    this.users.set(this.users());
  }

  isManagerPosition(user: DetailedUser | UserAdmin | null): boolean {
    return user?.adminPosition === 'Manager';
  }

  /**
   * Managers this administrator could report to. Blocked accounts are excluded (they earn nothing
   * and the backend refuses them anyway), and so is the person themselves — an administrator
   * cannot be their own manager.
   */
  managerOptionsFor(user: DetailedUser | UserAdmin | null): UserAdmin[] {
    return this.users().filter(u =>
      u.role === 'Admin' &&
      u.adminPosition === 'Manager' &&
      u.isActive &&
      u.id !== user?.id);
  }

  readonly savingAdminPositionUserId = signal<number | null>(null);

  updateAdminPosition(user: DetailedUser | UserAdmin, position: string, event?: Event) {
    event?.stopPropagation();
    if (!this.canManageAdminPosition(user)) return;
    if ((user.adminPosition || 'Administrator') === position) return;

    // Promoting to Manager drops the reporting line: a manager does not report to a manager, and
    // the backend clears it either way, so the optimistic copy has to match or the panel would
    // briefly show a manager with a manager.
    const managerId = position === 'Manager' ? null : (user.managerId ?? null);
    this.saveAdminPosition(user, position, managerId);
  }

  updateUserManager(user: DetailedUser | UserAdmin, rawManagerId: string | number | null, event?: Event) {
    event?.stopPropagation();
    if (!this.canManageAdminPosition(user)) return;

    // The "no manager" option submits an empty string, which must become null rather than 0.
    const managerId = rawManagerId === '' || rawManagerId == null ? null : Number(rawManagerId);
    if ((user.managerId ?? null) === managerId) return;

    this.saveAdminPosition(user, user.adminPosition || 'Administrator', managerId);
  }

  private saveAdminPosition(
    user: DetailedUser | UserAdmin, position: string, managerId: number | null) {

    this.errorMessage.set('');
    this.successMessage.set('');

    const originalPosition = user.adminPosition;
    const originalManagerId = user.managerId ?? null;
    const originalManagerName = user.managerName ?? null;

    const applyTo = (target: DetailedUser | UserAdmin | null, pos: string | undefined, mid: number | null) => {
      if (!target) return;
      target.adminPosition = pos;
      target.managerId = mid;
      // Resolved from the loaded list so the panel can name the manager without a refetch.
      const manager = mid == null ? null : this.users().find(u => u.id === mid);
      target.managerName = manager ? `${manager.firstName} ${manager.lastName}` : null;
    };

    applyTo(user, position, managerId);
    if (this.selectedUser() && this.selectedUser()!.id === user.id) {
      applyTo(this.selectedUser(), position, managerId);
    }
    this.savingAdminPositionUserId.set(user.id);

    this.adminService.updateAdminPosition(user.id, position, managerId).subscribe({
      next: (res) => {
        this.savingAdminPositionUserId.set(null);
        applyTo(user, res.adminPosition, res.managerId ?? null);
        if (this.selectedUser() && this.selectedUser()!.id === user.id) {
          applyTo(this.selectedUser(), res.adminPosition, res.managerId ?? null);
        }
      },
      error: (error) => {
        this.savingAdminPositionUserId.set(null);
        // Roll back BOTH copies. The most likely rejection is "N administrators still report to
        // this manager", which the admin has to read and act on — so it is shown, not swallowed.
        const restore = (target: DetailedUser | UserAdmin | null) => {
          if (!target) return;
          target.adminPosition = originalPosition;
          target.managerId = originalManagerId;
          target.managerName = originalManagerName;
        };
        restore(user);
        if (this.selectedUser() && this.selectedUser()!.id === user.id) restore(this.selectedUser());

        this.errorMessage.set(error.error?.message || 'Failed to update position.');
        setTimeout(() => this.errorMessage.set(''), 6000);
      }
    });
  }

  updateUserStatus(user: UserAdmin, isActive: boolean) {
    this.errorMessage.set('');
    this.successMessage.set('');

    const originalStatus = user.isActive;
    user.isActive = isActive;

    this.adminService.updateUserStatus(user.id, isActive).subscribe({
      next: () => {
        const action = isActive ? 'unblocked' : 'blocked';
        if (this.selectedUser() && this.selectedUser()!.id === user.id) {
          this.selectedUser()!.isActive = isActive;
          this.selectedUser.set(this.selectedUser());
        }
        this.successMessage.set(`${user.firstName} ${user.lastName} has been ${action}.`);
        setTimeout(() => this.successMessage.set(''), 4000);
      },
      error: (error) => {
        user.isActive = originalStatus;
        this.errorMessage.set(error.error?.message || 'Failed to update user status.');
        setTimeout(() => this.errorMessage.set(''), 4000);
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
    if (!this.canUpdate()) return;

    const row = this.users().find(u => u.id === user.id);
    const reason = level === 'None' ? null : (user.flagReason ?? row?.flagReason ?? null);

    this.flaggingUserId.set(user.id);
    this.errorMessage.set('');
    this.adminService.setUserFlag(user.id, level, reason).subscribe({
      next: () => {
        if (row) { row.flag = level;
        this.users.set(this.users()); row.flagReason = level === 'None' ? null : reason;
        this.users.set(this.users()); }
        if (this.selectedUser() && this.selectedUser()!.id === user.id) {
          this.selectedUser()!.flag = level;
          this.selectedUser.set(this.selectedUser());
          this.selectedUser()!.flagReason = level === 'None' ? null : reason;
          this.selectedUser.set(this.selectedUser());
        }
        this.successMessage.set(level === 'None'
          ? `Flag cleared for ${user.firstName} ${user.lastName}.`
          : `${user.firstName} ${user.lastName} flagged ${level}.`);
        setTimeout(() => { this.successMessage.set(''); }, 3000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to update flag.');
        setTimeout(() => { this.errorMessage.set(''); }, 3000);
      },
      complete: () => { this.flaggingUserId.set(null); }
    });
  }

  /** Persist an edited flag reason on blur (keeps the current level). */
  saveUserFlagReason(user: UserAdmin, event: Event): void {
    const value = ((event.target as HTMLInputElement)?.value || '').trim();
    const level = user.flag || 'None';
    if (level === 'None') return;
    const row = this.users().find(u => u.id === user.id);
    if ((user.flagReason ?? '') === value && (row?.flagReason ?? '') === value) return;

    this.adminService.setUserFlag(user.id, level, value || null).subscribe({
      next: () => {
        if (row) { row.flagReason = value || null; this.users.set(this.users()); }
        if (this.selectedUser() && this.selectedUser()!.id === user.id) { this.selectedUser()!.flagReason = value || null; this.selectedUser.set(this.selectedUser()); }
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to save flag reason.');
        setTimeout(() => { this.errorMessage.set(''); }, 3000);
      }
    });
  }

  canModifyUserStatus(user: any): boolean {
    if (this.currentUserRole() === 'Admin' && user.role === 'SuperAdmin') return false;
    return true;
  }

  canBanUser(user: any): boolean {
    const currentUserId = this.getCurrentUserId();
    if (user.id === currentUserId) return false;
    return this.canDeactivate() && user.isActive && this.canModifyUserStatus(user);
  }

  canUnbanUser(user: any): boolean {
    return this.canActivate() && !user.isActive && this.canModifyUserStatus(user);
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

  /**
   * The rows this tab is ABOUT, before any of the user-chosen filters run.
   *
   * Staff is the three admin roles; Customers is everybody else. A row with no role at all falls
   * in with Customers, because an unrecognised role is far more likely to be a legacy customer
   * than a staff member — and hiding a real customer from the customer tab is the worse failure
   * of the two (they would appear nowhere at all).
   *
   * That same "worse failure" is why Customers hides a business account on exactly ONE test:
   * `hasActiveBusinessClient`, which is the server's answer to "is this account on the Business
   * Clients tab right now". The tabs then partition the accounts between them, and an account
   * that is not on Business Clients is always on Customers. Testing `isBusiness` here as well
   * looks harmless and is not: the two facts are separate columns, and any state where the flag
   * outlives an active link (a failed auto-create, a client deactivated by another route) hides
   * the customer from every tab in the panel. Deactivating the client is exactly what "Move to
   * Customers" does, so that state is reachable and was the bug (2026-09).
   */
  private get scopedUsers(): UserAdmin[] {
    const isStaff = (u: UserAdmin) =>
      !!u.role && UserManagementComponent.STAFF_ROLES.includes(u.role.toLowerCase());

    return this.scope() === 'staff'
      ? this.users().filter(isStaff)
      : this.users().filter(u => !isStaff(u) && !u.hasActiveBusinessClient);
  }

  /** Every user matching the current filters, sorted — before pagination slices it. */
  private get matchingUsers(): UserAdmin[] {
    // The SCOPE comes first and the filters narrow within it, so no filter can ever surface a
    // staff account on the Customers tab (or the reverse).
    let filtered = this.scopedUsers;
    const search = this.searchTerm().trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(user =>
        user.id.toString().includes(search) ||
        (user.email && user.email.toLowerCase().includes(search)) ||
        ((user.firstName || '') + ' ' + (user.lastName || '')).toLowerCase().includes(search) ||
        matchesPhoneSearch(user.phone, search)
      );
    }
    if (this.statusFilter() !== 'all') {
      filtered = filtered.filter(user =>
        (this.statusFilter() === 'active' && user.isActive) ||
        (this.statusFilter() === 'inactive' && !user.isActive)
      );
    }
    if (this.roleFilter() !== 'all') {
      filtered = filtered.filter(user => user.role && user.role.toLowerCase() === this.roleFilter().toLowerCase());
    }
    if (this.customerTypeFilter() !== 'all') {
      // totalOrdersCount counts REAL orders - not cancelled, not fully refunded (users-list endpoint).
      filtered = filtered.filter(user => {
        const count = user.totalOrdersCount ?? 0;
        switch (this.customerTypeFilter()) {
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
    const start = (this.currentPage() - 1) * this.itemsPerPage;
    return filtered.slice(start, start + this.itemsPerPage);
  }

  previousPage() { if (this.currentPage() > 1) this.currentPage.update(v => v - 1); }
  nextPage() { if (this.currentPage() < this.totalPages) this.currentPage.update(v => v + 1); }
  goToPage(page: number) { if (page >= 1 && page <= this.totalPages) this.currentPage.set(page); }

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

  // History pill: the Orders tab's own class/label/tooltip (shared/admin/order-status-badge.ts).
  getStatusClass(order: OrderList): string {
    return orderStatusBadgeClass(order);
  }

  getStatusLabel(order: OrderList): string {
    return orderStatusBadgeLabel(order);
  }

  getStatusTitle(order: OrderList): string {
    return orderStatusBadgeTitle(order);
  }

  isCancelledOrRefunded(order: OrderList): boolean {
    return isCancelledOrRefundedStatus(order.status);
  }

  /**
   * The History tab's count: REAL orders only — not cancelled, not fully refunded (owner's rule,
   * 2026-10; it replaced "N (2 cancelled, 1 refunded)"). The list itself still shows every order,
   * the cancelled and refunded ones with their status badge. A partly refunded order keeps its own
   * status, so it still counts here.
   */
  /**
   * Bubble points taken back for a refund or cancellation (2026-10): the admin view of the history
   * carries the full record, which the customer never sees.
   */
  get pointsReversals(): { points: number; description?: string | null; createdAt: string }[] {
    const reversalTypes = ['RefundReversal', 'RefundCorrection', 'CancellationCorrection'];
    return ((this.userRewardsSummary()?.pointsHistory ?? []) as any[]).filter(h => reversalTypes.includes(h.type));
  }

  get historyRealOrderCount(): number {
    return (this.selectedUser()?.orders ?? []).filter((o: OrderList) => !isCancelledOrRefundedStatus(o.status)).length;
  }

  readonly isSuperAdmin = computed<boolean>(() => this.currentUserRole() === 'SuperAdmin');

  /** True for Admin or SuperAdmin — both can open the user edit form. */
  readonly canEditUsers = computed<boolean>(() => this.currentUserRole() === 'SuperAdmin' || this.currentUserRole() === 'Admin');

  /** True if current admin is allowed to edit this specific target user. Admins cannot edit SuperAdmin users. */
  canEditUserDetails(user: any): boolean {
    if (!user) return false;
    if (this.currentUserRole() === 'SuperAdmin') return true;
    if (this.currentUserRole() === 'Admin' && user.role !== 'SuperAdmin') return true;
    return false;
  }

  /** Returns true if the user is an internal staff role (badge shown). */
  isStaffRole(role: string | undefined | null): boolean {
    return role === 'Admin' || role === 'SuperAdmin' || role === 'Moderator';
  }

  /** Returns initials for avatar bubble. */
  getInitials(firstName: string | undefined, lastName: string | undefined): string {
    return getAdminAvatarInitials(firstName, lastName);
  }

  /**
   * A social-login photo URL can 404 (Google rotates them) — drop it so the coloured
   * initials bubble takes over instead of leaving a broken-image glyph in the circle.
   * Clears it on the list row and the open detail panel, which are separate objects.
   */
  onAvatarError(user: UserAdmin | DetailedUser | null): void {
    if (!user) return;
    user.profilePictureUrl = null;
    const listRow = this.users().find(u => u.id === user.id);
    if (listRow) { listRow.profilePictureUrl = null; this.users.set(this.users()); }
    if (this.selectedUser() && this.selectedUser()!.id === user.id) { this.selectedUser()!.profilePictureUrl = null; this.selectedUser.set(this.selectedUser()); }
  }

  /** Deterministic avatar bg colour — shared with the Cleaners tab so one person is one colour. */
  getAvatarColor(id: number): string {
    return getAdminAvatarColor(id);
  }

  // ── Bubble rewards: existing methods ──

  getTierLabel(tier: string): string {
    if (tier === 'UltraBubble') return 'Ultra Bubble';
    if (tier === 'SuperBubble') return 'Super Bubble';
    return 'Bubble';
  }

  savePointsAdjustment(): void {
    if (!this.selectedUser() || !this.isSuperAdmin() || this.savingPoints()) return;
    const newTotal = Number(this.adjustPointsAmount());
    if (isNaN(newTotal) || newTotal < 0) return;
    const currentPoints = this.userRewardsSummary()?.currentPoints ?? 0;
    const delta = newTotal - currentPoints;
    if (delta === 0) return;
    this.savingPoints.set(true);
    this.bubbleRewardsService.adjustUserPoints(
      this.selectedUser()!.id,
      delta,
      this.adjustPointsDesc() || 'Admin adjustment'
    ).subscribe({
      next: () => {
        this.savingPoints.set(false);
        this.adjustPointsDesc.set('');
        this.pointsSaveMessage.set(`Points set to ${newTotal.toLocaleString()}.`);
        this.loadUserRewards(this.selectedUser()!.id);
        setTimeout(() => this.pointsSaveMessage.set(''), 3000);
      },
      error: () => { this.savingPoints.set(false); }
    });
  }

  searchReferrals(query: string): void {
    if (!this.selectedUser() || query.length < 2) { this.newReferralSearchResults.set([]); return; }
    this.bubbleRewardsService.searchEligibleReferrals(this.selectedUser()!.id, query).subscribe({
      next: (r) => this.newReferralSearchResults.set(r),
      error: () => this.newReferralSearchResults.set([])
    });
  }

  selectReferralSuggestion(email: string): void {
    this.newReferralEmail.set(email);
    this.newReferralSearchResults.set([]);
  }

  addReferredUser(): void {
    if (!this.selectedUser() || !this.isSuperAdmin() || this.addingReferral() || !this.newReferralEmail().trim()) return;
    this.addingReferral.set(true);
    this.referralActionMessage.set('');
    this.bubbleRewardsService.addReferredUser(this.selectedUser()!.id, this.newReferralEmail().trim()).subscribe({
      next: () => {
        this.addingReferral.set(false);
        this.newReferralEmail.set('');
        this.newReferralSearchResults.set([]);
        this.referralActionMessage.set('Referred user added.');
        this.loadUserRewards(this.selectedUser()!.id);
        setTimeout(() => this.referralActionMessage.set(''), 3000);
      },
      error: (err) => {
        this.addingReferral.set(false);
        this.referralActionMessage.set(err?.error?.message ?? 'Failed to add referred user.');
        setTimeout(() => this.referralActionMessage.set(''), 4000);
      }
    });
  }

  removeReferredUser(referralId: number): void {
    if (!this.selectedUser() || !this.isSuperAdmin() || this.removingReferralId() != null) return;
    this.removingReferralId.set(referralId);
    this.referralActionMessage.set('');
    this.bubbleRewardsService.removeReferredUser(this.selectedUser()!.id, referralId).subscribe({
      next: () => {
        this.removingReferralId.set(null);
        this.loadUserRewards(this.selectedUser()!.id);
      },
      error: (err) => {
        this.removingReferralId.set(null);
        this.referralActionMessage.set(err?.error?.message ?? 'Failed to remove.');
        setTimeout(() => this.referralActionMessage.set(''), 4000);
      }
    });
  }

  removeReferredBy(): void {
    if (!this.selectedUser() || !this.isSuperAdmin() || this.removingReferredBy()) return;
    this.removingReferredBy.set(true);
    this.referralActionMessage.set('');
    this.bubbleRewardsService.removeReferredBy(this.selectedUser()!.id).subscribe({
      next: () => {
        this.removingReferredBy.set(false);
        this.loadUserRewards(this.selectedUser()!.id);
      },
      error: (err) => {
        this.removingReferredBy.set(false);
        this.referralActionMessage.set(err?.error?.message ?? 'Failed to remove.');
        setTimeout(() => this.referralActionMessage.set(''), 4000);
      }
    });
  }

  searchReferrers(query: string): void {
    if (!this.selectedUser() || query.length < 2) { this.newReferrerSearchResults.set([]); return; }
    this.bubbleRewardsService.searchEligibleReferrers(this.selectedUser()!.id, query).subscribe({
      next: (r) => this.newReferrerSearchResults.set(r),
      error: () => this.newReferrerSearchResults.set([])
    });
  }

  selectReferrerSuggestion(email: string): void {
    this.newReferrerEmail.set(email);
    this.newReferrerSearchResults.set([]);
  }

  setReferredBy(): void {
    if (!this.selectedUser() || !this.isSuperAdmin() || this.settingReferredBy() || !this.newReferrerEmail().trim()) return;
    this.settingReferredBy.set(true);
    this.referralActionMessage.set('');
    this.bubbleRewardsService.setReferredBy(this.selectedUser()!.id, this.newReferrerEmail().trim()).subscribe({
      next: () => {
        this.settingReferredBy.set(false);
        this.newReferrerEmail.set('');
        this.newReferrerSearchResults.set([]);
        this.referralActionMessage.set('Referrer set.');
        this.loadUserRewards(this.selectedUser()!.id);
        setTimeout(() => this.referralActionMessage.set(''), 3000);
      },
      error: (err) => {
        this.settingReferredBy.set(false);
        this.referralActionMessage.set(err?.error?.message ?? 'Failed to set referrer.');
        setTimeout(() => this.referralActionMessage.set(''), 4000);
      }
    });
  }

  openOrderInAdmin(orderId: number): void {
    window.open('/admin?orderId=' + orderId, '_blank');
  }

  // ─── Recreate an order from the customer's cleaning history ───────────────────────────
  // Gated on `canCreate` from GET api/admin/permissions rather than a local role test, for the
  // same reason "Register Customer" is: PermissionService's map (Create for Admin + SuperAdmin,
  // Moderator View-only) is what the endpoint enforces, and a second copy of it here would be
  // free to drift. The reorder-preview endpoint carries [RequirePermission(Permission.Create)].

  readonly recreateSourceOrderId = signal<number | null>(null);
  readonly showRecreateModal = signal(false);
  readonly recreateSuccessMessage = signal('');

  startRecreateOrder(orderId: number, event: Event): void {
    // The whole history row navigates to the order in the admin panel; the button must not.
    event.stopPropagation();
    if (!this.canCreate()) return;
    this.recreateSuccessMessage.set('');
    this.recreateSourceOrderId.set(orderId);
    this.showRecreateModal.set(true);
  }

  closeRecreateModal(): void {
    this.showRecreateModal.set(false);
    this.recreateSourceOrderId.set(null);
  }

  onOrderRecreated(result: { orderId: number; total: number }): void {
    this.recreateSuccessMessage.set(`Order #${result.orderId} created. It is on this customer's history below.`);
    // The new order belongs in the list the admin is looking at, and the header's order count and
    // lifetime total are derived from that same list — reloading is what keeps all three honest.
    if (this.selectedUser()) this.loadUserOrders(this.selectedUser()!.id);
  }

  onEditPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    if (input.value !== cleaned) input.value = cleaned;
    this.editUserForm().phone = cleaned || null;
    this.editUserForm.set(this.editUserForm());
  }

  callUser(user: UserAdmin, event?: Event): void {
    if (event) event.stopPropagation();
    const phone = normalizePhone10(user.phone);
    if (!phone) return;
    window.location.href = `tel:${phone}`;
  }

  startEditUser(): void {
    if (!this.selectedUser() || !this.canEditUserDetails(this.selectedUser())) return;
    this.editUserForm.set({
      firstName: this.selectedUser()!.firstName,
      lastName: this.selectedUser()!.lastName,
      email: this.selectedUser()!.email,
      phone: normalizePhone10(this.selectedUser()!.phone),
      role: this.selectedUser()!.role,
      isActive: this.selectedUser()!.isActive,
      firstTimeOrder: this.selectedUser()!.firstTimeOrder,
      canReceiveCommunications: this.selectedUser()!.canReceiveCommunications !== false,
      canReceiveEmails: this.userCanReceiveEmails(this.selectedUser()!),
      canReceiveMessages: this.userCanReceiveMessages(this.selectedUser()!)
    });
    this.editingUser.set(true);
  }

  private buildUserEditPayload(): SuperAdminUpdateUserDto {
    const user = this.selectedUser()!;
    return {
      firstName: this.editUserForm().firstName,
      lastName: this.editUserForm().lastName,
      // null (not "") when blank — the backend's [EmailAddress] rejects an empty string.
      // Blank is valid only for no-email (cash) accounts, whose email field starts empty.
      email: this.editUserForm().email?.trim() ? this.editUserForm().email!.trim() : null,
      phone: this.editUserForm().phone,
      firstTimeOrder: this.editUserForm().firstTimeOrder,
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
    const user = this.selectedUser();
    if (!user || !this.canEditUserDetails(user) || this.sendingReminder()) return;
    this.sendingReminder.set(true);

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
          this.sendingReminder.set(false);
          return;
        }

        this.adminService.sendUserReminder(user.id).subscribe({
          next: (res) => {
            this.sendingReminder.set(false);
            this.successMessage.set(res.message);
            setTimeout(() => { this.successMessage.set(''); }, 5000);
          },
          error: (err) => {
            this.sendingReminder.set(false);
            this.errorMessage.set(err.error?.message || 'Failed to send the reminder.');
            setTimeout(() => { this.errorMessage.set(''); }, 5000);
          }
        });
      },
      error: (err) => {
        this.sendingReminder.set(false);
        this.errorMessage.set(err.error?.message || 'Could not check this user\'s reminder history.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      }
    });
  }

  cancelEditUser(): void {
    this.editingUser.set(false);
    this.editingAddressId.set(null);
    this.editAddressDraft.set(null);
    this.showAddAddress.set(false);
    this.newAddress.set({ name: '', address: '', city: '', state: '', postalCode: '' });
  }

  saveUserEdit(): void {
    if (!this.selectedUser() || !this.canEditUserDetails(this.selectedUser()) || this.savingUser()) return;
    this.editUserForm().phone = normalizePhone10(this.editUserForm().phone);
    this.editUserForm.set(this.editUserForm());
    const payload = this.buildUserEditPayload();
    this.savingUser.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.adminService.superAdminFullUpdateUser(this.selectedUser()!.id, payload).subscribe({
      next: () => {
        this.successMessage.set('User updated successfully.');
        this.editingUser.set(false);
        this.selectedUser()!.firstName = payload.firstName;
        this.selectedUser.set(this.selectedUser());
        this.selectedUser()!.lastName = payload.lastName;
        this.selectedUser.set(this.selectedUser());
        this.selectedUser()!.email = payload.email ?? this.selectedUser()!.email;
        this.selectedUser.set(this.selectedUser());
        this.selectedUser()!.phone = payload.phone ?? this.selectedUser()!.phone;
        this.selectedUser.set(this.selectedUser());
        this.selectedUser()!.firstTimeOrder = payload.firstTimeOrder;
        this.selectedUser.set(this.selectedUser());
        // Giving a no-email (cash) account a real email converts it to a normal account.
        if (this.selectedUser()!.isNoEmailUser && payload.email?.trim()) {
          this.selectedUser()!.isNoEmailUser = false;
          this.selectedUser.set(this.selectedUser());
        }
        const userIndex = this.users().findIndex(user => user.id === this.selectedUser()!.id);
        if (userIndex !== -1) {
          const updatedUser = this.users()[userIndex];
          updatedUser.firstName = payload.firstName;
          this.users.set(this.users());
          updatedUser.lastName = payload.lastName;
          this.users.set(this.users());
          updatedUser.email = payload.email ?? updatedUser.email;
          this.users.set(this.users());
          updatedUser.phone = payload.phone ?? updatedUser.phone;
          this.users.set(this.users());
          updatedUser.firstTimeOrder = payload.firstTimeOrder;
          this.users.set(this.users());
          updatedUser.isNoEmailUser = this.selectedUser()!.isNoEmailUser;
          this.users.set(this.users());
        }
        this.loadUsers();
        setTimeout(() => { this.successMessage.set(''); }, 5000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to update user.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.savingUser.set(false); }
    });
  }

  /** SuperAdmin-only: reset a locked-out / forgotten staff PIN. Clears the PIN, the lock
   *  and all trusted devices; the coworker sets a brand-new PIN on their next login. */
  readonly resettingPin = signal(false);
  resetStaffPin(user: any, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.isSuperAdmin() || !this.isStaffRole(user.role) || this.resettingPin()) return;
    if (!confirm(`Reset the login PIN for ${user.firstName} ${user.lastName}? This unlocks their account and clears the PIN — they'll set a new one on their next login.`)) return;
    this.errorMessage.set('');
    this.successMessage.set('');
    this.resettingPin.set(true);
    this.adminService.resetStaffTwoFactorPin(user.id).subscribe({
      next: (res) => {
        this.successMessage.set(res?.message || 'PIN reset. The user will set a new PIN on their next login.');
        setTimeout(() => { this.successMessage.set(''); }, 6000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to reset PIN.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.resettingPin.set(false); }
    });
  }

  deleteUser(user: UserAdmin, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.isSuperAdmin()) return;
    if (!confirm(`Permanently delete ${user.firstName} ${user.lastName} (${user.email})? This cannot be undone.`)) return;
    this.errorMessage.set('');
    this.successMessage.set('');
    this.adminService.deleteUser(user.id).subscribe({
      next: () => {
        this.successMessage.set('User deleted successfully.');
        this.closeDetailPanel();
        this.loadUsers();
        setTimeout(() => { this.successMessage.set(''); }, 5000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to delete user.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      }
    });
  }

  // ── Address (apartment) editing (Admin/SuperAdmin) ──
  startEditAddress(apartment: Apartment): void {
    if (!this.selectedUser() || !this.canEditUserDetails(this.selectedUser())) return;
    this.editingAddressId.set(apartment.id);
    this.editAddressDraft.set({ ...apartment });
    this.showAddAddress.set(false);
  }

  cancelEditAddress(): void {
    this.editingAddressId.set(null);
    this.editAddressDraft.set(null);
  }

  saveEditAddress(): void {
    const draft = this.editAddressDraft();
    if (!this.selectedUser() || !draft || this.savingAddress()) return;
    this.savingAddress.set(true);
    this.errorMessage.set('');
    this.adminService.updateUserApartment(this.selectedUser()!.id, draft.id, { ...draft }).subscribe({
      next: (updated) => {
        const idx = this.selectedUser()!.apartments?.findIndex(a => a.id === draft.id) ?? -1;
        if (idx !== -1 && this.selectedUser()!.apartments)
          { this.selectedUser()!.apartments![idx] = updated; this.selectedUser.set(this.selectedUser()); }
        this.editingAddressId.set(null);
        this.editAddressDraft.set(null);
        this.successMessage.set('Address updated.');
        setTimeout(() => { this.successMessage.set(''); }, 3000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to update address.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.savingAddress.set(false); }
    });
  }

  openAddAddress(): void {
    this.showAddAddress.set(true);
    this.newAddress.set({ name: '', address: '', city: '', state: '', postalCode: '' });
    this.editingAddressId.set(null);
    this.editAddressDraft.set(null);
  }

  cancelAddAddress(): void {
    this.showAddAddress.set(false);
    this.newAddress.set({ name: '', address: '', city: '', state: '', postalCode: '' });
  }

  addNewAddress(): void {
    if (!this.selectedUser() || !this.canEditUserDetails(this.selectedUser()) || this.savingAddress()) return;
    if (!this.newAddress().name?.trim() || !this.newAddress().address?.trim() || !this.newAddress().city?.trim() ||
        !this.newAddress().state?.trim() || !this.newAddress().postalCode?.trim()) {
      this.errorMessage.set('Name, address, city, state and postal code are required.');
      setTimeout(() => { this.errorMessage.set(''); }, 5000);
      return;
    }
    this.savingAddress.set(true);
    this.errorMessage.set('');
    this.adminService.addUserApartment(this.selectedUser()!.id, this.newAddress()).subscribe({
      next: (created) => {
        if (!this.selectedUser()!.apartments) { this.selectedUser()!.apartments = []; this.selectedUser.set(this.selectedUser()); }
        this.selectedUser()!.apartments!.push(created);
        this.selectedUser.set(this.selectedUser());
        this.showAddAddress.set(false);
        this.newAddress.set({ name: '', address: '', city: '', state: '', postalCode: '' });
        this.successMessage.set('Address added.');
        setTimeout(() => { this.successMessage.set(''); }, 3000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to add address.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.savingAddress.set(false); }
    });
  }

  deleteAddress(apartment: Apartment, event?: Event): void {
    if (event) event.stopPropagation();
    if (!this.selectedUser() || !this.canEditUserDetails(this.selectedUser()) || this.savingAddress()) return;
    if (!confirm(`Delete address "${apartment.name}"?`)) return;
    this.savingAddress.set(true);
    this.errorMessage.set('');
    this.adminService.deleteUserApartment(this.selectedUser()!.id, apartment.id).subscribe({
      next: () => {
        if (this.selectedUser()!.apartments)
          { this.selectedUser()!.apartments = this.selectedUser()!.apartments!.filter(a => a.id !== apartment.id); this.selectedUser.set(this.selectedUser()); }
        if (this.editingAddressId() === apartment.id) {
          this.editingAddressId.set(null);
          this.editAddressDraft.set(null);
        }
        this.successMessage.set('Address deleted.');
        setTimeout(() => { this.successMessage.set(''); }, 3000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to delete address.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.savingAddress.set(false); }
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
    if (!this.canUpdate()) return;
    this.togglingCommsUserId.set(user.id);
    this.errorMessage.set('');
    this.adminService.updateUserCommunicationPreference(user.id, 'emails', newValue).subscribe({
      next: () => {
        user.canReceiveEmails = newValue;
        if (this.selectedUser() && this.selectedUser()!.id === user.id) { this.selectedUser()!.canReceiveEmails = newValue; this.selectedUser.set(this.selectedUser()); }
        this.successMessage.set(newValue ? 'User will receive emails.' : 'User will not receive emails.');
        setTimeout(() => { this.successMessage.set(''); }, 3000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to update email preference.');
        setTimeout(() => { this.errorMessage.set(''); }, 3000);
      },
      complete: () => { this.togglingCommsUserId.set(null); }
    });
  }

  toggleUserMessagesPreference(user: UserAdmin, newValue: boolean, event?: Event): void {
    if (event) (event as Event).stopPropagation();
    if (!this.canUpdate()) return;
    this.togglingCommsUserId.set(user.id);
    this.errorMessage.set('');
    this.adminService.updateUserCommunicationPreference(user.id, 'messages', newValue).subscribe({
      next: () => {
        user.canReceiveMessages = newValue;
        if (this.selectedUser() && this.selectedUser()!.id === user.id) { this.selectedUser()!.canReceiveMessages = newValue; this.selectedUser.set(this.selectedUser()); }
        this.successMessage.set(newValue ? 'User will receive messages.' : 'User will not receive messages.');
        setTimeout(() => { this.successMessage.set(''); }, 3000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to update messages preference.');
        setTimeout(() => { this.errorMessage.set(''); }, 3000);
      },
      complete: () => { this.togglingCommsUserId.set(null); }
    });
  }

  openRegisterModal(): void {
    this.showRegisterModal.set(true);
  }

  closeRegisterModal(): void {
    this.showRegisterModal.set(false);
  }

  /** The shared modal has already created the customer; refresh the table and say so. */
  onCustomerRegistered(customer: RegisteredCustomer): void {
    this.successMessage.set(`User ${customer.firstName} ${customer.lastName} registered successfully.`);
    this.loadUsers();
    setTimeout(() => { this.successMessage.set(''); }, 5000);
  }

  openExportModal(): void {
    if (!this.isSuperAdmin()) return;
    // Reset to all-checked every time per requirement: "show me all that things already checked".
    this.exportColumns.forEach(c => c.selected = true);
    this.exportError.set('');
    this.showExportModal.set(true);
  }

  closeExportModal(): void {
    if (this.exporting()) return;
    this.showExportModal.set(false);
    this.exportError.set('');
  }

  toggleExportColumn(key: string): void {
    const col = this.exportColumns.find(c => c.key === key);
    if (col) col.selected = !col.selected;
  }

  get hasAnyExportColumnSelected(): boolean {
    return this.exportColumns.some(c => c.selected);
  }

  runExport(): void {
    if (!this.isSuperAdmin() || this.exporting()) return;
    const selected = this.exportColumns.filter(c => c.selected).map(c => c.key);
    if (selected.length === 0) {
      this.exportError.set('Select at least one column to export.');
      return;
    }
    this.exporting.set(true);
    this.exportError.set('');
    this.adminService.exportUsers(selected).subscribe({
      next: (res) => {
        const blob = res.body;
        if (!blob) {
          this.exportError.set('Export returned an empty file.');
          this.exporting.set(false);
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
        this.exporting.set(false);
        this.showExportModal.set(false);
        this.successMessage.set('Export downloaded.');
        setTimeout(() => { this.successMessage.set(''); }, 3000);
      },
      error: (err) => {
        this.exporting.set(false);
        this.exportError.set(err?.error?.message || err?.message || 'Failed to export users.');
      }
    });
  }

  getVisiblePages(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 3;

    if (this.totalPages <= 5) {
      for (let i = 2; i < this.totalPages; i++) pages.push(i);
    } else {
      let start = Math.max(2, this.currentPage() - 1);
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

    // The extra's isDeepCleaning / isSuperDeepCleaning flags and its extraServiceKey decide; only an
    // unkeyed extra with neither flag is read by name (extra-service-keys.ts).
    const hasDeepFromExtras = extras.some((extra: any) => isDeepOrSuperDeepExtra(extra) && !isSuperDeepExtra(extra));
    if (hasDeepFromExtras) return true;

    // A service line is never the deep option once keyed; an unkeyed (legacy) one by its name.
    return services.some((service: any) => {
      if (orderServiceKeyOf(service)) return false;
      const name = normalize(service?.serviceName || service?.name);
      return name.includes('deep-cleaning') && !name.includes('super-deep');
    });
  }

  private resolveUserLastCleaningVariants(users: UserAdmin[]): void {
    const residentialUsers = users.filter((u: any) => {
      // By the type's serviceKey; only an unkeyed (or custom) type falls back to its name.
      const typeKey = String(u?.lastCleaningServiceTypeKey ?? '').trim();
      if (typeKey) return typeKey === 'residential';
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
              this.userLastCleaningVariantCache().set(user.id, isDeep ? 'Deep' : 'Regular');
              this.userLastCleaningVariantCache.set(this.userLastCleaningVariantCache());
            },
            error: () => {
              const fallbackDeep = this.resolveIsDeepResidential(recent as any);
              this.userLastCleaningVariantCache().set(user.id, fallbackDeep ? 'Deep' : 'Regular');
              this.userLastCleaningVariantCache.set(this.userLastCleaningVariantCache());
            }
          });
        }
      });
    });
  }

  /** Short labels per ServiceType.serviceKey; a keyed type not listed here shows its name, trimmed. */
  private static readonly COMPACT_LABEL_BY_SERVICE_KEY: Record<string, string> = {
    'move-in-out': 'Move In/Out',
    'office': 'Office',
    'heavy-condition': 'Heavy',
    'post-construction': 'Construction'
  };

  getCompactServiceType(serviceTypeName: string | undefined | null, order?: any): string {
    const raw = (serviceTypeName || '').trim();
    if (!raw) return 'Service';
    const s = raw.toLowerCase();

    // By the type's serviceKey (sent for non-custom types); only an unkeyed type is read by name below.
    const typeKey = String(order?.lastCleaningServiceTypeKey ?? '').trim();
    if (typeKey) {
      if (typeKey === 'residential') return this.compactResidentialLabel(s, order);
      return UserManagementComponent.COMPACT_LABEL_BY_SERVICE_KEY[typeKey]
        ?? (raw.replace(/cleaning/gi, '').replace(/\s+/g, ' ').trim() || 'Service');
    }

    if (s.includes('move') && (s.includes('in') || s.includes('out'))) return 'Move In/Out';
    if (s.includes('office')) return 'Office';
    if (s.includes('arranged') || s.includes('pre-arranged') || s.includes('pre arranged')) return 'Arranged';
    if (s.includes('heavy')) return 'Heavy';

    if (s.includes('residential')) return this.compactResidentialLabel(s, order);
    if (s.includes('deep')) return 'Deep';
    if (s.includes('regular') || s.includes('standard')) return 'Regular';
    if (s.includes('post')) return 'Construction';

    return raw
      .replace(/cleaning/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Service';
  }

  /** Residential splits into Deep / Regular (cached per user once their last order is resolved). */
  private compactResidentialLabel(lowerName: string, order?: any): string {
    if (order?.lastCleaningServiceType !== undefined && order?.id && this.userLastCleaningVariantCache().has(order.id)) {
      return this.userLastCleaningVariantCache().get(order.id) || 'Regular';
    }
    return this.resolveIsDeepResidential(order as any) || lowerName.includes('deep') ? 'Deep' : 'Regular';
  }
}
