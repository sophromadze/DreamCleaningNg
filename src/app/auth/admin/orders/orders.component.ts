import { Component, OnInit, ChangeDetectorRef, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, OrderUpdateHistory, UserPermissions, SuperAdminUpdateOrderDto, PendingOrderEditListDto, PendingOrderEditDetailDto, AssignedCleanerAdmin, UserCleaningPhoto, OrderAdminNote, OrderTransferInfo, UserAdmin, OrderRefundSummary, OrderRefundInfo } from '../../../services/admin.service';
import { environment } from '../../../../environments/environment';
import { OrderService, Order, OrderList } from '../../../services/order.service';
import { CleanerService, AvailableCleaner } from '../../../services/cleaner.service';
import { BookingService, ServiceType, ExtraService, Service } from '../../../services/booking.service';
import { DurationUtils } from '../../../utils/duration.utils';
import { OrderReminderService } from '../../../services/order-reminder.service';
import { FloorTypeSelection } from '../../../shared/components/floor-type-selector/floor-type-selector.component';
import { PAYMENT_METHOD_OPTIONS, PaymentMethodValue } from '../../../shared/payment-method';
import { NewOrderNotificationService } from '../../../services/new-order-notification.service';
import { BubbleRewardsService } from '../../../services/bubble-rewards.service';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { normalizePhone10, sanitizePhoneInput } from '../../../utils/phone.utils';
import { ShiftService, ShiftAdmin } from '../../../services/shift.service';
import { CardOnFileService, OrderSavedCardInfo } from '../../../services/card-on-file.service';
import { CARD_ON_FILE_ENABLED } from '../../../shared/card-on-file.flag';
import { formatNy, formatNyDateTime } from '../../../shared/ny-time.util';
import {
  formatAdminServiceTypeLabel,
  isResidentialServiceTypeName
} from '../../../shared/admin/service-type-short-label';
import {
  calculateQuote,
  calculateTotals,
  calculateCleanerTotalSalary,
  calculatePerCleanerBillableMinutes,
  getDefaultCleanerHourlyRate,
  getServiceDisplayDuration,
  getSquareFeetForBedrooms,
  resolveSquareFeetForBedroomChange,
  rescaleDiscountToSubTotal,
  resolveGiftCardAmountToUse,
  round2,
  QuoteResult,
  REGULAR_CLEANER_HOURLY_RATE,
  SALES_TAX_RATE,
  STUDIO_PRICE
} from '../../../shared/pricing/order-pricing.calculator';
import { buildAdminEditQuoteInput } from '../../../shared/pricing/admin-order-edit.pricing';
import { solveSubTotalForTypedTotal } from '../../../shared/pricing/admin-total-solve';
import {
  PROPERTY_TYPE_APARTMENT,
  PROPERTY_TYPE_HOUSE,
  isHouse,
  isLevelsService,
  LEVEL_OPTIONS,
  MIN_LEVELS,
  levelsToDisplay,
  normalizePropertyType,
  serviceTypeCollectsPropertyType
} from '../../../shared/booking/property-type.utils';
import { buildCustomServiceTypeNameOptions } from '../../../shared/booking/custom-service-type.util';
// Aliased: the component has a field of the same name holding the resolved answer.
import { canSaveOrderEditsDirectly as canSaveOrderEditsDirectlyFor } from '../../../shared/order-edit-approval.policy';

/** One row of an order-edit review table (approval modal and save-confirmation modal). */
export interface OrderEditChange {
  field: string;
  current: string;
  proposed: string;
  /** Signed numeric delta (proposed - current), or '—' when the field isn't numeric. */
  difference: string;
  /**
   * True for the Total row, which is styled to stand out and is the ONE row emitted even when
   * nothing changed — it is the number the customer actually pays, so a reviewer should never
   * have to infer it from its absence.
   */
  emphasised?: boolean;
}

// Extended interface for admin orders with additional properties
export interface AdminOrderList extends OrderList {
  userId: number;
  contactEmail: string;
  contactFirstName: string;
  contactLastName: string;
  totalDuration: number;
  /** Staffing-review badge inputs: per-cleaner load > 6h warns (regular types only). */
  maidsCount?: number;
  /** True for cleaner+hours service types (TotalDuration is per-cleaner) — badge skips those. */
  hasCleanersService?: boolean;
  tips: number;
  /** RETIRED, read-only. 0 on new orders; legacy orders keep theirs inside `total`. */
  companyDevelopmentTips: number;
  cancellationReason?: string;
  isLateCancellation?: boolean;
  /** True when an admin created the order (create-for-user) rather than the customer. */
  bookedByAdmin?: boolean;
  /** Money already refunded. Header-card revenue totals subtract this, so a retained
   *  cancellation fee still counts as income. Keep in sync with the same-named interface
   *  in admin.service.ts — loadOrders() casts between them. */
  totalRefundedAmount?: number;
  /** Soft-hidden from the default list view. Only populated when includeHidden was requested. */
  isHidden?: boolean;
}

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.scss']
})
export class OrdersComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tableWrapper', { static: false }) tableWrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('tableHeader', { static: false }) tableHeader!: ElementRef<HTMLTableSectionElement>;

  @Input() openOrderId: number | null = null;

  orders: AdminOrderList[] = [];
  selectedOrder: Order | null = null;
  /** User id whose flag is mid-update (disables the panel flag buttons). */
  flaggingOrderUserId: number | null = null;
  viewingOrderId: number | null = null;

  // ── Internal order note (admin-only free text, above Assigned Cleaners) ──
  readonly orderNoteMaxLength = 2000;
  /** What the textarea is bound to. Never null, so the counter and length checks stay simple. */
  orderNoteDraft = '';
  /** Last saved text, used to tell an unchanged draft from an edited one. */
  private orderNoteSaved = '';
  orderNoteUpdatedAt: string | null = null;
  orderNoteUpdatedByName: string | null = null;
  loadingOrderNote = false;
  savingOrderNote = false;
  orderNoteError = '';
  orderNoteSuccess = '';

  // ── Order cleaning photos (shared with the per-user photo library) ──
  orderPhotos: UserCleaningPhoto[] = [];
  loadingOrderPhotos = false;
  uploadingOrderPhoto = false;
  orderPhotoProgress = '';
  orderPhotoError = '';
  orderPhotoSuccess = '';
  lightboxOrderPhoto: UserCleaningPhoto | null = null;

  // SuperAdmin order deletion
  deletingOrder = false;

  Math = Math;
  readonly specialInstructionsMaxLength = 2000;

  // Sticky header management
  private scrollListener?: () => void;
  private horizontalScrollListener?: () => void;
  private stickyHeaderInitialized = false;
  private initializationRetries = 0;
  private readonly maxRetries = 20; // Max 20 retries (1 second total)
  
  get headerStickyOffset(): number {
    // Match CSS responsive breakpoints
    if (window.innerWidth <= 768) {
      return 60;
    }
    return 80;
  }
  
  // Filtering and search
  searchTerm: string = '';
  statusFilter: string = 'all';
  dateFilter: string = 'all';
  // Specific-days window, active when dateFilter === 'custom'. yyyy-MM-dd strings from the
  // date inputs; both bounds inclusive. Same date in both = a single specific day.
  customDateFrom: string = '';
  customDateTo: string = '';
  // Service-type filter. Values are the canonical category keys produced by
  // getServiceTypeFilterKey() — residential splits into 'deep'/'regular'.
  serviceTypeFilter: string = 'all';
  // Who created the order: 'admin' = created via the admin create-for-user flow,
  // 'user' = the customer booked it themselves.
  bookedByFilter: string = 'all';

  // ── Export (SuperAdmin-only), mirrors the users-tab export ──
  showExportModal = false;
  exporting = false;
  exportError = '';
  /** Column keys must match the backend ExportOrders endpoint. */
  exportColumns: Array<{ key: string; label: string; selected: boolean }> = [
    { key: 'orderId',       label: 'ID',             selected: true },
    { key: 'customer',      label: 'Customer',       selected: true },
    { key: 'email',         label: 'Email',          selected: true },
    { key: 'phone',         label: 'Phone',          selected: true },
    { key: 'serviceAt',     label: 'Date & Time',    selected: true },
    { key: 'serviceType',   label: 'Service Type',   selected: true },
    { key: 'address',       label: 'Address',        selected: true },
    { key: 'borough',       label: 'Borough',        selected: true },
    { key: 'zip',           label: 'Zip',            selected: true },
    { key: 'rooms',         label: 'Rooms',          selected: true },
    { key: 'squareFeet',    label: 'Sq.Ft',          selected: true },
    { key: 'maids',         label: 'Maids',          selected: true },
    { key: 'duration',      label: 'Duration (hrs)', selected: true },
    { key: 'subTotal',      label: 'Subtotal',       selected: true },
    { key: 'tips',          label: 'Tips',           selected: true },
    { key: 'tax',           label: 'Tax',            selected: true },
    { key: 'total',         label: 'Total',          selected: true },
    { key: 'status',        label: 'Status',         selected: true },
    { key: 'paymentMethod', label: 'Payment',        selected: true }
  ];

  // Table sort (default: latest service date first)
  sortColumn: string = 'serviceDate';
  sortDirection: 'asc' | 'desc' = 'desc';
  
  // Permissions
  userRole: string = '';
  userPermissions: UserPermissions = {
    role: '',
    permissions: {
      canView: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canActivate: false,
      canDeactivate: false
    }
  };

  // UI State
  errorMessage = '';
  successMessage = '';
  
  // Store customer names and details
  customerNames: Map<number, string> = new Map();
  customerDetails: Map<number, {id: number, email: string}> = new Map();
  
  // Pagination
  currentPage = 1;
  // Derived from the filtered list (pure getter; replaces the old field that was
  // assigned inside the filteredOrders getter and triggered NG0100).
  get totalPages(): number {
    return Math.ceil(this.filterOrders().length / this.itemsPerPage);
  }
  /** Count of orders matching the current filters (all pages) — shown in the export modal. */
  get totalFilteredOrders(): number {
    return this.filterOrders().length;
  }
  itemsPerPage = 20;

  // Mark as Done modal
  showDoneModal = false;
  doneModalOrder: AdminOrderList | null = null;
  sendingReview = false;

  // Phase 1 manual payment tracking — Done modal payment method block.
  // Pre-filled from the order's current PaymentMethod when the modal opens, so admin can
  // either accept it (e.g. Pending Zelle order with reference already recorded) or change
  // if the customer ended up paying differently.
  paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  donePaymentMethod: PaymentMethodValue = 'Normal';
  donePaymentReference = '';
  donePaymentNotes = '';

  // Payment Method filter dropdown (Phase 1)
  paymentMethodFilter: string = 'all';

  // Cancel order modal
  showAdminCancelModal = false;
  adminCancelOrderId: number | null = null;
  adminCancelReason = '';

  // New properties for cleaner assignment
  showCleanerModal = false;
  availableCleaners: AvailableCleaner[] = [];
  /** Filters the assign-cleaners modal list by name or email (client-side). */
  cleanerAssignmentSearchQuery = '';
  /** When true, the assign list also shows cleaners marked busy that day (still assignable). */
  showBusyCleaners = false;
  selectedCleaners: number[] = [];
  tipsForCleaner = '';
  assigningOrderId: number | null = null;
  assignedCleanersCache: Map<number, AssignedCleanerAdmin[]> = new Map();
  /** Tracks which orders have had their cleaners loaded (to distinguish "loading" from "not assigned") */
  cleanersLoadedSet: Set<number> = new Set();
  /** Cached resolved residential variant for list rows (without opening details). */
  residentialVariantCache: Map<number, 'Deep' | 'Regular'> = new Map();
  // Hourly rate shown in the assign modal; set per order from getDefaultHourlyRate() on open.
  cleanerHourlySalary: number = REGULAR_CLEANER_HOURLY_RATE;

  loadingStates = {
    orders: false,
    orderDetails: false,
    assignedCleaners: false,
    assigningCleaners: false,
    removingCleaner: false,
    sendAssignmentMails: false,
    sendPaymentLink: false,
    chargingSavedCard: false,
    resendingConfirmation: false
  };

  // Card on file for the open order's owner (Charge button). Loaded when the details
  // panel opens; null until then / when the owner has no saved card.
  orderSavedCardInfo: OrderSavedCardInfo | null = null;
  private resendingCleanerEmailKeys = new Set<string>();

  // "Send Payment Link" modal — re-sends the original payment-link email/SMS to the
  // customer's current account contact (after an admin fixes a mistyped email/phone).
  showSendPaymentLinkModal = false;
  sendPaymentLinkChannels = { email: true, sms: true };

  orderUpdateHistory: OrderUpdateHistory[] = [];
  loadingUpdateHistory = false;

  // Pending order edits. Reviewed by anyone who may apply an order edit directly (SuperAdmin, or
  // an Admin granted it); every other Admin only submits them.
  pendingOrderEdits: PendingOrderEditListDto[] = [];
  loadingPendingEdits = false;
  selectedPendingEdit: PendingOrderEditDetailDto | null = null;
  loadingPendingEditDetail = false;
  approvingPendingId: number | null = null;
  rejectingPendingId: number | null = null;
  /** Map extraServiceId -> name for showing "Extra (new)" label in pending edit diff. */
  extraServiceNamesMap: Map<number, string> = new Map();
  /** Map extraServiceId -> true if extra uses hours (for "(hours/cost)" vs "(qty/cost)" label). */
  extraServiceHasHoursMap: Map<number, boolean> = new Map();

  // Save-confirmation modal — shown to whoever saves an order edit DIRECTLY (SuperAdmin, or an
  // Admin granted it). It lists the same change rows a SuperAdmin sees when approving another
  // admin's edit, so nobody applies an order change without reading it first. Admins who still
  // need approval skip this: their submission is reviewed on the other side.
  showSaveConfirm = false;
  /** The DTO built from the open edit form, held until the confirmation is accepted. */
  pendingSaveDto: SuperAdminUpdateOrderDto | null = null;
  /** Diff rows computed once when the modal opens, not re-derived per change-detection pass. */
  saveConfirmChanges: OrderEditChange[] = [];

  // ── Editable Total (tax-inclusive, discount-aware) ──
  //
  // The admin can type what the customer should pay instead of working back from a subtotal, the
  // same way Custom Pricing works at booking. The typed figure is what the CUSTOMER PAYS: tax
  // included, this order's discounts applied, bubble points / reward balance already deducted,
  // tips excluded. Only a gift card takes the field read-only — see canEditTotalDirectly.
  /** What the Total input shows and edits: the tip-free total. Kept in sync by recalculateEditPricing. */
  editOrderTotalInput: number | null = null;
  /**
   * Set only while a typed Total is in force: the exact tax split out of it, plus the discounted
   * subtotal it was split from. Both travel to the server, which honours the tax only if the base
   * still matches — so a stale override can never silently mis-price an order.
   */
  editOrderTaxOverride: { tax: number; base: number } | null = null;

  // SuperAdmin full order edit
  editingOrder = false;
  editOrderForm: Partial<SuperAdminUpdateOrderDto> = {};
  savingOrder = false;
  editOrderFormOriginalSubTotal = 0;
  editOrderFormOriginalDiscount = 0;
  editOrderFormOriginalSubscriptionDiscount = 0;
  // Loyalty Discount: amount is the snapshot at booking time, percentage is the locked
  // multiplier we re-apply on subtotal edits (subscription/promo use a ratio because they
  // can be flat-dollar; loyalty is always %-based per spec section 4.5).
  editOrderFormOriginalLoyaltyDiscount = 0;
  editOrderFormOriginalLoyaltyPercentage = 0;
  // Gift card on edit: available balance (current remaining + what this order already used) so a
  // price increase can be re-drawn from leftover funds before charging the customer. Mirrors the
  // user order-edit page; matches the backend ApplyEditGiftCardAsync re-resolution.
  editGiftCardCode: string | null = null;
  editGiftCardOriginalUsed = 0;
  editGiftCardAvailableBalance = 0;
  editGiftCardAmountToUse = 0;
  editOrderFormPrevServiceQuantities: number[] = [];
  editOrderFormPrevExtraQuantities: number[] = [];
  editOrderFormPrevExtraHours: number[] = [];

  // Floor type edit state for admin edit form
  editFloorTypes: string[] = [];
  editFloorTypeOther: string = '';
  /** Extras available for the order's service type (for Add extra service dropdown). */
  editOrderAvailableExtras: ExtraService[] = [];
  serviceTypesCache: ServiceType[] = [];

  // Booking-consistent tax rate from the shared calculator
  private readonly salesTaxRate = SALES_TAX_RATE;

  // Bubble Points settings (for estimated pts display in edit form)
  pointsPerDollar = 0;
  pointsEnabled = false;
  editEstimatedPoints = 0;

  // Statistics for SuperAdmin
  isSuperAdmin = false;
  /**
   * True when this user's order edits are applied on save instead of being sent to a SuperAdmin
   * for approval — always for SuperAdmins, and for Admins a SuperAdmin has granted it. Resolved
   * server-side by the permissions endpoint (Helpers/OrderEditApprovalPolicy) so a grant made
   * mid-session takes effect on the next page load; shared/order-edit-approval.policy.ts is the
   * client-side mirror used when only a user object is at hand.
   */
  canSaveOrderEditsDirectly = false;
  /** True if user can edit orders: direct save, or Admin submitting for approval. */
  get canEditOrder(): boolean {
    return this.isSuperAdmin || (this.userRole === 'Admin' && this.userPermissions.permissions.canUpdate);
  }
  /** True if user may re-label a custom ("Pre-Arranged") order: SuperAdmin or any Admin (direct
   *  save) — independent of the canUpdate permission, matching the backend's role-only gate. */
  get canEditCustomServiceName(): boolean {
    return this.isSuperAdmin || this.userRole === 'Admin';
  }
  // Statistics are DERIVED from the filtered orders via memoized getters (see `stats`
  // below) — never assigned during change detection, which previously caused NG0100
  // when searching (the filteredOrders getter mutated them mid-pass).
  get totalOrders(): number { return this.stats.totalOrders; }
  get totalAmount(): number { return this.stats.totalAmount; }
  get totalTaxes(): number { return this.stats.totalTaxes; }
  get totalTips(): number { return this.stats.totalTips; }
  get totalAmountWithoutTipsAndTaxes(): number { return this.stats.totalAmountWithoutTipsAndTaxes; }
  get totalDuration(): number { return this.stats.totalDuration; }

  // Assigned-admin pill state for the inline order-details expand.
  availableAdmins: ShiftAdmin[] = [];
  showAssignedAdminEditor = false;
  isSavingAssignedAdmin = false;

  // Booked-by pill: SuperAdmin toggle to backfill orders that predate BookedByAdminUserId.
  isSavingBookedBy = false;

  // SuperAdmin-only editor for an existing custom ("Pre-Arranged") order's display name.
  showCustomServiceNameEditor = false;
  isSavingCustomServiceName = false;

  // ── SuperAdmin order transfer (move order to another customer, undoable) ──
  showTransferPanel = false;
  transferSearchTerm = '';
  transferCandidates: UserAdmin[] = [];      // all active customers (lazy-loaded on first open)
  transferSearchResults: UserAdmin[] = [];
  transferTargetUser: UserAdmin | null = null;
  transferNotes = '';
  isTransferring = false;
  loadingTransferCandidates = false;
  orderTransfers: OrderTransferInfo[] = [];
  undoingTransferId: number | null = null;
  transferError = '';

  // ── SuperAdmin refunds (money back to the customer's card) ──
  // refundSummary.remainingRefundable comes live from the payment provider, so it already
  // reflects refunds issued outside this panel — it is the only cap the UI trusts.
  refundSummary: OrderRefundSummary | null = null;
  loadingRefunds = false;
  showRefundModal = false;
  refundMode: 'full' | 'partial' = 'full';
  refundAmountInput: number | null = null;
  refundReason = '';
  refundSendEmail = true;
  /** Second step of the modal — the admin has to confirm before any money moves. */
  refundConfirming = false;
  isRefunding = false;
  refundError = '';
  /** Set when the modal was opened from a table row rather than the detail panel, so the
   *  modal has an order to name and submit against without the panel being open. */
  refundTargetOrder: AdminOrderList | null = null;
  /** "Sync from Stripe" — imports refunds issued in the Stripe Dashboard. */
  isSyncingRefunds = false;
  /** Per-refund-row manual email send; holds the row id in flight. */
  sendingRefundEmailId: number | null = null;

  // ── SuperAdmin soft-hide (view filter only; never touches order data or revenue) ──
  /** "Show hidden orders" filter. Visible to every admin role — all roles can VIEW hidden
   *  orders, only SuperAdmin can hide/unhide. Toggling reloads from the server. */
  showHiddenOrders = false;
  hideConfirmOrder: AdminOrderList | null = null;
  isHidingOrder = false;

  constructor(
    private adminService: AdminService,
    private orderService: OrderService,
    private cleanerService: CleanerService,
    private bookingService: BookingService,
    public orderReminderService: OrderReminderService,
    public newOrderNotificationService: NewOrderNotificationService,
    private bubbleRewardsService: BubbleRewardsService,
    private cardOnFileService: CardOnFileService,
    private cdr: ChangeDetectorRef,
    private shiftService: ShiftService
  ) {}

  ngOnInit() {
    this.loadUserPermissions();
    this.bubbleRewardsService.getSummary().subscribe({
      next: (s) => {
        this.pointsPerDollar = s.guide?.pointsPerDollar ?? 0;
        this.pointsEnabled = s.pointsSystemEnabled ?? false;
      },
      error: () => {}
    });
  }

  // ── SuperAdmin order transfer ──

  resetTransferPanel(): void {
    this.showTransferPanel = false;
    this.transferSearchTerm = '';
    this.transferSearchResults = [];
    this.transferTargetUser = null;
    this.transferNotes = '';
    this.transferError = '';
    this.orderTransfers = [];
  }

  loadOrderTransfers(orderId: number): void {
    this.adminService.getOrderTransfers(orderId).subscribe({
      next: (transfers) => {
        // Ignore late responses after the admin switched to a different order.
        if (this.viewingOrderId === orderId) this.orderTransfers = transfers;
      },
      error: () => { /* non-fatal: panel simply shows no history */ }
    });
  }

  toggleTransferPanel(): void {
    if (!this.isSuperAdmin) return;
    this.showTransferPanel = !this.showTransferPanel;
    this.transferError = '';
    if (this.showTransferPanel && this.transferCandidates.length === 0 && !this.loadingTransferCandidates) {
      this.loadingTransferCandidates = true;
      this.adminService.getUsers().subscribe({
        next: (response: any) => {
          const list: UserAdmin[] = Array.isArray(response) ? response : (response?.users ?? []);
          this.transferCandidates = list.filter(u => u.role === 'Customer' && u.isActive);
          this.loadingTransferCandidates = false;
          this.filterTransferCandidates();
        },
        error: () => { this.loadingTransferCandidates = false; }
      });
    }
  }

  onTransferSearchInput(value: string): void {
    this.transferSearchTerm = value;
    this.transferTargetUser = null;
    this.filterTransferCandidates();
  }

  private filterTransferCandidates(): void {
    const search = this.transferSearchTerm.toLowerCase().trim();
    const currentOwnerId = this.selectedOrder?.userId;
    const pool = this.transferCandidates.filter(u => u.id !== currentOwnerId);
    if (!search) {
      this.transferSearchResults = pool.slice(0, 8);
      return;
    }
    this.transferSearchResults = pool.filter(u =>
      (u.email || '').toLowerCase().includes(search) ||
      u.firstName.toLowerCase().includes(search) ||
      u.lastName.toLowerCase().includes(search) ||
      u.id.toString().includes(search)
    ).slice(0, 8);
  }

  selectTransferTarget(user: UserAdmin): void {
    this.transferTargetUser = user;
    this.transferSearchResults = [];
  }

  clearTransferTarget(): void {
    this.transferTargetUser = null;
    this.transferSearchTerm = '';
    this.filterTransferCandidates();
  }

  transferUserLabel(user: UserAdmin): string {
    const emailLabel = user.isNoEmailUser ? 'No email' : (user.email || '—');
    return `${user.firstName} ${user.lastName} (${emailLabel}, ID ${user.id})`;
  }

  submitTransfer(): void {
    if (!this.selectedOrder || !this.transferTargetUser || this.isTransferring) return;
    const target = this.transferTargetUser;
    if (!confirm(`Transfer order #${this.selectedOrder.id} and everything it earned (points, spent amount, photos, address) to ${target.firstName} ${target.lastName}? This is recorded in Audit logs and can be undone.`)) {
      return;
    }
    this.isTransferring = true;
    this.transferError = '';
    const orderId = this.selectedOrder.id;
    this.adminService.transferOrder(orderId, target.id, this.transferNotes.trim() || undefined).subscribe({
      next: () => {
        this.isTransferring = false;
        this.successMessage = `Order #${orderId} transferred to ${target.firstName} ${target.lastName}.`;
        setTimeout(() => { this.successMessage = ''; }, 5000);
        this.showTransferPanel = false;
        this.transferTargetUser = null;
        this.transferNotes = '';
        // Refresh the details panel + list so the new owner shows everywhere.
        this.loadOrderTransfers(orderId);
        this.refreshSelectedOrderAfterTransfer(orderId);
      },
      error: (err) => {
        this.isTransferring = false;
        this.transferError = err.error?.message || 'Transfer failed.';
      }
    });
  }

  undoTransfer(transfer: OrderTransferInfo): void {
    if (this.undoingTransferId !== null) return;
    if (!confirm(`Undo the transfer of order #${transfer.orderId} to ${transfer.toUserName}? Everything moves back to ${transfer.fromUserName}.`)) {
      return;
    }
    this.undoingTransferId = transfer.id;
    this.transferError = '';
    this.adminService.undoOrderTransfer(transfer.id).subscribe({
      next: () => {
        this.undoingTransferId = null;
        this.successMessage = `Transfer undone — order #${transfer.orderId} is back with ${transfer.fromUserName}.`;
        setTimeout(() => { this.successMessage = ''; }, 5000);
        this.loadOrderTransfers(transfer.orderId);
        this.refreshSelectedOrderAfterTransfer(transfer.orderId);
      },
      error: (err) => {
        this.undoingTransferId = null;
        this.transferError = err.error?.message || 'Undo failed.';
      }
    });
  }

  // ── SuperAdmin refunds ──

  /**
   * Reconcile this order against Stripe. Picks up refunds issued in the Stripe Dashboard (or
   * before the CRM refund flow existed) and records them here. Deliberately manual — there is no
   * webhook. Safe to run repeatedly: a second run imports nothing.
   */
  syncRefundsFromStripe(): void {
    const orderId = this.selectedOrder?.id;
    if (!this.isSuperAdmin || orderId == null || this.isSyncingRefunds) return;

    this.isSyncingRefunds = true;
    this.refundError = '';

    this.adminService.syncOrderRefunds(orderId).subscribe({
      next: (result) => {
        this.isSyncingRefunds = false;

        if (result.summary && this.viewingOrderId === orderId) {
          this.refundSummary = result.summary;
        }

        if (result.success) {
          this.successMessage = result.message;
          // Longer than usual: the dispute warning is appended to this message and is worth reading.
          setTimeout(() => { this.successMessage = ''; }, result.hasDispute ? 15000 : 8000);
          // An import can flip the order to Refunded and move the revenue totals.
          if (result.refundsImported > 0) this.loadOrders();
        } else {
          this.refundError = result.message;
        }
      },
      error: (err) => {
        this.isSyncingRefunds = false;
        this.refundError = err.error?.message || 'Could not reach Stripe. Please try again.';
      }
    });
  }

  /** Send the customer's refund confirmation for one history row, on explicit request. */
  sendRefundEmail(refund: OrderRefundInfo): void {
    const orderId = this.selectedOrder?.id;
    if (!this.isSuperAdmin || orderId == null || this.sendingRefundEmailId !== null) return;

    this.sendingRefundEmailId = refund.id;
    this.refundError = '';

    this.adminService.sendRefundEmail(orderId, refund.id).subscribe({
      next: (result) => {
        this.sendingRefundEmailId = null;
        if (result.summary && this.viewingOrderId === orderId) this.refundSummary = result.summary;
        if (result.success) {
          this.successMessage = result.message;
          setTimeout(() => { this.successMessage = ''; }, 6000);
        } else {
          this.refundError = result.message;
        }
      },
      error: (err) => {
        this.sendingRefundEmailId = null;
        this.refundError = err.error?.message || 'The email could not be sent.';
      }
    });
  }

  resetRefundState(): void {
    this.refundSummary = null;
    this.isSyncingRefunds = false;
    this.sendingRefundEmailId = null;
    this.showRefundModal = false;
    this.refundMode = 'full';
    this.refundAmountInput = null;
    this.refundReason = '';
    this.refundSendEmail = true;
    this.refundConfirming = false;
    this.isRefunding = false;
    this.refundError = '';
    this.refundTargetOrder = null;
  }

  loadOrderRefunds(orderId: number): void {
    this.loadingRefunds = true;
    this.adminService.getOrderRefunds(orderId).subscribe({
      next: (summary) => {
        // Ignore late responses after the admin switched to a different order.
        if (this.viewingOrderId === orderId) this.refundSummary = summary;
        this.loadingRefunds = false;
      },
      error: () => {
        // Non-fatal: the refund section simply stays hidden rather than breaking the panel.
        this.loadingRefunds = false;
      }
    });
  }

  /** True only when the loaded summary belongs to the order currently in the detail panel.
   *  Refunding from a table row overwrites refundSummary, so without this check the open panel
   *  could briefly render another order's refund figures. */
  get refundSummaryMatchesPanel(): boolean {
    return !!this.refundSummary && !!this.selectedOrder
      && this.refundSummary.orderId === this.selectedOrder.id;
  }

  /** Refund button shows only when the provider says there is money left to give back. */
  get canRefundSelectedOrder(): boolean {
    return this.isSuperAdmin && this.refundSummaryMatchesPanel && !!this.refundSummary?.canRefund;
  }

  get maxRefundable(): number {
    return this.refundSummary?.remainingRefundable ?? 0;
  }

  /** The order the open refund modal acts on — a table row when launched from the list,
   *  otherwise the order in the detail panel. */
  get refundOrderId(): number | null {
    return this.refundTargetOrder?.id ?? this.selectedOrder?.id ?? null;
  }

  get refundOrderCustomerName(): string {
    const target = this.refundTargetOrder;
    if (target) return `${target.contactFirstName} ${target.contactLastName}`.trim();
    if (this.selectedOrder) return `${this.selectedOrder.contactFirstName} ${this.selectedOrder.contactLastName}`.trim();
    return 'the customer';
  }

  get refundOrderCustomerEmail(): string {
    return this.refundTargetOrder?.contactEmail || this.selectedOrder?.contactEmail || 'the customer';
  }

  openRefundModal(): void {
    if (!this.canRefundSelectedOrder) return;
    this.refundTargetOrder = null;   // detail-panel path: submit against selectedOrder
    this.showRefundModal = true;
    this.refundMode = 'full';
    this.refundAmountInput = this.maxRefundable;
    this.refundReason = '';
    this.refundSendEmail = true;
    this.refundConfirming = false;
    this.refundError = '';
  }

  /**
   * Refund straight from a table row, without opening the detail panel. The refundable ceiling
   * is not in the list payload (it comes live from the payment provider), so it is fetched first
   * and the modal only opens once we know there is something to refund.
   */
  openRefundModalForOrder(order: AdminOrderList): void {
    if (!this.isSuperAdmin || this.loadingRefunds) return;

    this.refundTargetOrder = order;
    this.refundSummary = null;
    this.refundError = '';
    this.loadingRefunds = true;

    this.adminService.getOrderRefunds(order.id).subscribe({
      next: (summary) => {
        this.loadingRefunds = false;
        // The admin may have clicked another row while this was in flight.
        if (this.refundTargetOrder?.id !== order.id) return;

        this.refundSummary = summary;

        if (!summary.canRefund) {
          this.refundTargetOrder = null;
          this.errorMessage = summary.unavailableReason || 'There is nothing to refund on this order.';
          setTimeout(() => { this.errorMessage = ''; }, 6000);
          return;
        }

        this.showRefundModal = true;
        this.refundMode = 'full';
        this.refundAmountInput = summary.remainingRefundable;
        this.refundReason = '';
        this.refundSendEmail = true;
        this.refundConfirming = false;
      },
      error: () => {
        this.loadingRefunds = false;
        this.refundTargetOrder = null;
        this.errorMessage = 'Could not check what is refundable on this order. Please try again.';
        setTimeout(() => { this.errorMessage = ''; }, 6000);
      }
    });
  }

  closeRefundModal(): void {
    // A request is in flight and the money may already be moving — closing now would hide the
    // outcome from the admin.
    if (this.isRefunding) return;
    this.showRefundModal = false;
    this.refundConfirming = false;
    this.refundError = '';
    this.refundTargetOrder = null;
  }

  onRefundModeChange(mode: 'full' | 'partial'): void {
    this.refundMode = mode;
    this.refundError = '';
    // Pre-fill partial with the max so the admin edits down rather than typing from scratch.
    this.refundAmountInput = this.maxRefundable;
  }

  /** Dollars this submission will refund. Full mode always means the whole remaining balance. */
  get effectiveRefundAmount(): number {
    if (this.refundMode === 'full') return this.maxRefundable;
    return Number(this.refundAmountInput ?? 0);
  }

  get refundAmountIsValid(): boolean {
    const amount = this.effectiveRefundAmount;
    // Rounded before comparing so a value like 100.005 can't slip past the cap.
    return amount > 0 && Math.round(amount * 100) <= Math.round(this.maxRefundable * 100);
  }

  /** Step 1 → step 2. Nothing is sent until the admin confirms on the second step. */
  proceedToRefundConfirm(): void {
    if (!this.refundAmountIsValid) {
      this.refundError = `Enter an amount between $0.01 and $${this.maxRefundable.toFixed(2)}.`;
      return;
    }
    this.refundError = '';
    this.refundConfirming = true;
  }

  cancelRefundConfirm(): void {
    if (this.isRefunding) return;
    this.refundConfirming = false;
  }

  submitRefund(): void {
    // Guarded rather than merely disabled: a double-click can land before change detection
    // repaints the button, and a duplicate submit here means refunding real money twice.
    const orderId = this.refundOrderId;
    if (this.isRefunding || orderId === null || !this.refundAmountIsValid) return;
    // Full mode sends null so the server refunds whatever is still refundable at that instant,
    // rather than a stale number this screen read earlier.
    const amount = this.refundMode === 'full' ? null : Number(this.refundAmountInput);

    this.isRefunding = true;
    this.refundError = '';

    this.adminService.refundOrder(orderId, amount, this.refundReason.trim() || null, this.refundSendEmail).subscribe({
      next: (result) => {
        this.isRefunding = false;

        if (result.summary && this.viewingOrderId === orderId) {
          this.refundSummary = result.summary;
        }

        if (result.success) {
          this.showRefundModal = false;
          this.refundConfirming = false;
          this.refundTargetOrder = null;
          this.successMessage = result.message;
          setTimeout(() => { this.successMessage = ''; }, 8000);
          // A full refund flips the order to Refunded and changes the revenue totals, so the
          // list and its header cards have to come back from the server.
          this.loadOrders();
        } else {
          // Covers the partial case too: some money may already have moved, so the modal stays
          // open showing exactly what happened instead of inviting a blind full retry.
          this.refundConfirming = false;
          this.refundError = result.message;
        }
      },
      error: (err) => {
        this.isRefunding = false;
        this.refundConfirming = false;
        this.refundError = err.error?.message || 'The refund could not be completed. Please try again.';
        // The request may have reached the server before failing — re-read the authoritative
        // state so the admin never retries against a stale balance.
        this.loadOrderRefunds(orderId);
      }
    });
  }

  // ── SuperAdmin soft-hide ──

  /** Reloads from the server — the hidden/visible split is decided by the API, not client-side. */
  toggleShowHiddenOrders(): void {
    this.showHiddenOrders = !this.showHiddenOrders;
    this.loadOrders();
  }

  /** Only dead orders can be hidden: cancelled, or fully refunded (a full refund is exactly what
   *  sets status to Refunded — a partial one leaves the status alone and the order is still live
   *  money). Mirrors OrderStatuses.CanBeHidden on the server, which enforces it for real. */
  canHideOrder(order: AdminOrderList): boolean {
    const status = order.status?.toLowerCase();
    return status === 'cancelled' || status === 'refunded';
  }

  openHideConfirm(order: AdminOrderList): void {
    if (!this.isSuperAdmin || !this.canHideOrder(order)) return;
    this.hideConfirmOrder = order;
  }

  closeHideConfirm(): void {
    if (this.isHidingOrder) return;
    this.hideConfirmOrder = null;
  }

  confirmHideOrder(): void {
    if (!this.hideConfirmOrder || this.isHidingOrder) return;

    const order = this.hideConfirmOrder;
    this.isHidingOrder = true;

    this.adminService.hideOrder(order.id).subscribe({
      next: (res) => {
        this.isHidingOrder = false;
        this.hideConfirmOrder = null;
        this.successMessage = res.message;
        setTimeout(() => { this.successMessage = ''; }, 5000);
        this.loadOrders();
      },
      error: (err) => {
        this.isHidingOrder = false;
        this.hideConfirmOrder = null;
        this.errorMessage = err.error?.message || 'Could not hide the order.';
      }
    });
  }

  /** Unhide needs no confirmation — it only makes a row visible again. */
  unhideOrder(order: AdminOrderList): void {
    if (!this.isSuperAdmin || this.isHidingOrder) return;

    this.isHidingOrder = true;
    this.adminService.unhideOrder(order.id).subscribe({
      next: (res) => {
        this.isHidingOrder = false;
        this.successMessage = res.message;
        setTimeout(() => { this.successMessage = ''; }, 5000);
        this.loadOrders();
      },
      error: (err) => {
        this.isHidingOrder = false;
        this.errorMessage = err.error?.message || 'Could not restore the order.';
      }
    });
  }

  private refreshSelectedOrderAfterTransfer(orderId: number): void {
    this.adminService.getOrderDetails(orderId).subscribe({
      next: (order) => {
        if (this.viewingOrderId === orderId) {
          this.selectedOrder = order;
          this.customerNames.set(orderId, `${order.contactFirstName} ${order.contactLastName}`);
          this.customerDetails.set(orderId, { id: order.userId, email: order.contactEmail });
        }
        this.loadOrders();
      },
      error: () => { this.loadOrders(); }
    });
  }

  // ── Card on file: explicit admin charge (never automatic) ──

  private loadOrderSavedCardInfo(orderId: number): void {
    this.orderSavedCardInfo = null;
    if (!CARD_ON_FILE_ENABLED) return;
    this.cardOnFileService.getOrderSavedCardInfo(orderId).subscribe({
      next: (info) => {
        if (this.viewingOrderId === orderId) this.orderSavedCardInfo = info;
      },
      error: () => { /* no Charge button — everything else still works */ }
    });
  }

  /** Charge button shows only for a plain unpaid order whose owner has a card on file. */
  canChargeSavedCard(): boolean {
    const order = this.selectedOrder;
    return CARD_ON_FILE_ENABLED &&
      !!order &&
      !order.isPaid &&
      (!order.paymentMethod || order.paymentMethod === 'Normal') &&
      (order.status || '').toLowerCase() !== 'cancelled' &&
      this.orderSavedCardInfo?.hasCard === true;
  }

  chargeSavedCard(): void {
    const order = this.selectedOrder;
    if (!order || this.loadingStates.chargingSavedCard || !this.canChargeSavedCard()) return;

    const cardLabel = this.orderSavedCardInfo?.last4
      ? `card ending ${this.orderSavedCardInfo.last4}`
      : 'saved card';
    if (!confirm(`Charge $${order.total?.toFixed(2)} to the customer's ${cardLabel} now?`)) return;

    this.loadingStates.chargingSavedCard = true;
    this.successMessage = '';
    this.errorMessage = '';

    this.cardOnFileService.chargeOrderSavedCard(order.id).subscribe({
      next: (res) => {
        this.loadingStates.chargingSavedCard = false;
        // charged=false is a clean outcome (declined / needs the customer present) —
        // the backend message says exactly what happened and the order stays unpaid.
        if (res.charged) {
          this.successMessage = res.message;
          setTimeout(() => { this.successMessage = ''; }, 8000);
        } else {
          this.errorMessage = res.message;
        }
        this.refreshSelectedOrderAfterTransfer(order.id);
      },
      error: (err) => {
        this.loadingStates.chargingSavedCard = false;
        this.errorMessage = err.error?.message || 'The charge failed unexpectedly. The order is unchanged.';
      }
    });
  }

  // Assigned-admin pill helpers (mirror order-details.component but local to this view).
  assignedAdminLabel(): string {
    return this.selectedOrder?.assignedAdminDisplayName?.trim() || 'Unassigned';
  }

  // ── Marketing origin (attribution) ──

  /** First-touch channel label, or '' when the order has no attribution (the line is hidden). */
  originFirstTouch(order: Order | null): string {
    return order?.acquisitionChannel?.trim() || '';
  }

  /** Converting-session channel — shown only when present AND different from first touch. */
  originConverted(order: Order | null): string {
    const converting = order?.convertingChannel?.trim();
    if (!converting) return '';
    return converting !== order?.acquisitionChannel?.trim() ? converting : '';
  }

  /** Tooltip with the source / medium / campaign detail behind each channel. */
  originTooltip(order: Order | null): string {
    if (!order) return '';
    const detail = (s?: string | null, m?: string | null, c?: string | null): string =>
      [s, m, c].map(x => (x || '').trim()).filter(x => x).join(' / ');
    const lines: string[] = [];
    if (order.acquisitionChannel) {
      const d = detail(order.acquisitionSource, order.acquisitionMedium, order.acquisitionCampaign);
      lines.push(`First touch: ${order.acquisitionChannel}${d ? ' — ' + d : ''}`);
    }
    if (order.convertingChannel) {
      const d = detail(order.convertingSource, order.convertingMedium, order.convertingCampaign);
      lines.push(`Converted: ${order.convertingChannel}${d ? ' — ' + d : ''}`);
    }
    return lines.join('\n');
  }

  toggleAssignedAdminEditor(): void {
    // Only SuperAdmin may reassign; Admins/Moderators get the read-only pill.
    if (!this.isSuperAdmin) return;
    this.showAssignedAdminEditor = !this.showAssignedAdminEditor;
  }

  selectAssignedAdminForOrder(adminId: number | null): void {
    if (!this.selectedOrder || this.isSavingAssignedAdmin) return;
    if ((this.selectedOrder.assignedAdminId ?? null) === adminId) {
      this.showAssignedAdminEditor = false;
      return;
    }
    this.isSavingAssignedAdmin = true;
    const orderId = this.selectedOrder.id;
    this.orderService.setAssignedAdmin(orderId, adminId).subscribe({
      next: (result) => {
        if (this.selectedOrder && this.selectedOrder.id === orderId) {
          this.selectedOrder.assignedAdminId = result.adminId ?? null;
          this.selectedOrder.assignedAdminFirstName = result.firstName ?? null;
          this.selectedOrder.assignedAdminLastName = result.lastName ?? null;
          this.selectedOrder.assignedAdminDisplayName = result.displayName ?? null;
        }
        this.isSavingAssignedAdmin = false;
        this.showAssignedAdminEditor = false;
      },
      error: () => {
        this.isSavingAssignedAdmin = false;
      }
    });
  }

  // Booked-by pill helpers. The value lives on the LIST row (the details DTO doesn't
  // carry it), so read/write the row in `orders` — the filter reacts immediately.
  private get viewedOrderListRow(): AdminOrderList | null {
    return this.orders.find(o => o.id === this.viewingOrderId) ?? null;
  }

  bookedByAdminLabel(): string {
    return this.viewedOrderListRow?.bookedByAdmin ? 'Admin' : 'Customer';
  }

  /**
   * Flag the order's OWNER (single source of truth on the User). Because the flag is the
   * customer's, we update the selected order AND every visible order that belongs to the
   * same user, so the whole table re-tints at once. level: 'None' | 'Yellow' | 'Red'.
   */
  setOrderFlag(level: string): void {
    if (!this.userPermissions.permissions.canUpdate || !this.selectedOrder) return;
    const userId = this.selectedOrder.userId;
    if (!userId) return;

    const reason = level === 'None' ? null : (this.selectedOrder.flagReason ?? null);
    this.flaggingOrderUserId = userId;
    this.adminService.setUserFlag(userId, level, reason).subscribe({
      next: () => {
        if (this.selectedOrder && this.selectedOrder.userId === userId) {
          this.selectedOrder.flag = level;
          this.selectedOrder.flagReason = level === 'None' ? null : reason;
        }
        this.orders.forEach(o => {
          if (o.userId === userId) { o.flag = level; o.flagReason = level === 'None' ? null : reason; }
        });
      },
      complete: () => { this.flaggingOrderUserId = null; },
      error: () => { this.flaggingOrderUserId = null; }
    });
  }

  toggleBookedByAdmin(): void {
    if (!this.isSuperAdmin || this.isSavingBookedBy) return;
    const row = this.viewedOrderListRow;
    if (!row) return;
    this.isSavingBookedBy = true;
    this.orderService.setBookedByAdmin(row.id, !row.bookedByAdmin).subscribe({
      next: (result) => {
        // Effective value from the backend — legacy orders with a creation-time
        // manual-payment stamp stay admin-booked even after clearing.
        row.bookedByAdmin = result.bookedByAdmin;
        this.calculateStatistics();
        this.isSavingBookedBy = false;
      },
      error: () => {
        this.isSavingBookedBy = false;
      }
    });
  }

  /** Whether the open detail order is a custom ("Pre-Arranged") order whose name can be re-labeled. */
  get selectedOrderIsCustomServiceType(): boolean {
    return !!(this.selectedOrder && (this.selectedOrder as any).isCustomServiceType);
  }

  /** Display-name options for the custom-service-type editor (Residential -> Regular/Deep). */
  get customServiceNameOptions(): string[] {
    return buildCustomServiceTypeNameOptions(this.serviceTypesCache);
  }

  toggleCustomServiceNameEditor(): void {
    // SuperAdmin and Admins (with update permission) may re-label; others just see the value.
    if (!this.canEditCustomServiceName) return;
    this.showCustomServiceNameEditor = !this.showCustomServiceNameEditor;
  }

  selectCustomServiceNameForOrder(name: string | null): void {
    if (!this.selectedOrder || this.isSavingCustomServiceName) return;
    const current = (this.selectedOrder as any).customServiceDisplayName ?? null;
    if ((current || null) === (name || null)) {
      this.showCustomServiceNameEditor = false;
      return;
    }
    this.isSavingCustomServiceName = true;
    const orderId = this.selectedOrder.id;
    this.orderService.setCustomServiceName(orderId, name || null).subscribe({
      next: (result) => {
        if (this.selectedOrder && this.selectedOrder.id === orderId) {
          (this.selectedOrder as any).customServiceDisplayName = result.customServiceDisplayName;
          this.selectedOrder.serviceTypeName = result.serviceTypeName;
        }
        // Keep the table row in sync so the Service Type column updates without a reload.
        const row = this.orders.find(o => o.id === orderId);
        if (row) {
          row.customServiceDisplayName = result.customServiceDisplayName;
          row.serviceTypeName = result.serviceTypeName;
        }
        this.residentialVariantCache.delete(orderId);
        this.isSavingCustomServiceName = false;
        this.showCustomServiceNameEditor = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isSavingCustomServiceName = false;
        this.cdr.markForCheck();
      }
    });
  }

  ngAfterViewInit() {
    // Wait for view to initialize, then set up sticky header
    // Use multiple checks to ensure elements are ready
    this.initializeStickyHeader();
  }

  private initializeStickyHeader() {
    // Check if elements exist, if not retry
    if (!this.tableWrapper || !this.tableHeader) {
      setTimeout(() => {
        this.initializeStickyHeader();
      }, 50);
      return;
    }
    
    // Double check elements are in DOM
    if (!this.tableWrapper.nativeElement || !this.tableHeader.nativeElement) {
      setTimeout(() => {
        this.initializeStickyHeader();
      }, 50);
      return;
    }
    
    // Setup sticky header once elements are confirmed ready
    this.setupStickyHeader();
  }

  ngOnDestroy() {
    // Clean up event listeners
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true);
    }
    if (this.horizontalScrollListener && this.tableWrapper) {
      const wrapperEl = this.tableWrapper.nativeElement;
      wrapperEl.removeEventListener('scroll', this.horizontalScrollListener);
      wrapperEl.removeEventListener('touchmove', this.horizontalScrollListener);
      wrapperEl.removeEventListener('wheel', this.horizontalScrollListener);
    }
    // Reset initialization flags
    this.stickyHeaderInitialized = false;
    this.initializationRetries = 0;
  }

  @HostListener('window:resize')
  onResize() {
    // Recalculate sticky header on resize
    setTimeout(() => {
      this.updateStickyHeader();
      // Also sync horizontal scroll after resize in case wrapper position changed
      if (this.tableHeader && this.tableHeader.nativeElement.style.position === 'fixed') {
        // Update left position on resize since wrapper position may have changed
        const wrapper = this.tableWrapper?.nativeElement;
        const header = this.tableHeader.nativeElement;
        if (wrapper) {
          const wrapperRect = wrapper.getBoundingClientRect();
          header.style.left = `${wrapperRect.left}px`;
        }
        this.syncHorizontalScroll();
      }
    }, 50);
  }

  private setupStickyHeader() {
    if (!this.tableWrapper || !this.tableHeader) {
      return;
    }

    const wrapperEl = this.tableWrapper.nativeElement;

    // Set up vertical scroll listener for sticky positioning (only once)
    if (!this.scrollListener) {
      this.scrollListener = () => {
        this.updateStickyHeader();
        // Also sync horizontal scroll when vertical scrolling (in case wrapper moved)
        if (this.tableHeader && this.tableHeader.nativeElement.style.position === 'fixed') {
          this.syncHorizontalScroll();
        }
      };
      window.addEventListener('scroll', this.scrollListener, true);
    }

    // Set up horizontal scroll listener to sync header (ensure it's always attached)
    if (!this.horizontalScrollListener) {
      // Direct sync without requestAnimationFrame for immediate updates on mobile
      this.horizontalScrollListener = () => {
        this.syncHorizontalScroll();
      };
      // Add scroll listener - use capture phase for better mobile support
      wrapperEl.addEventListener('scroll', this.horizontalScrollListener, { passive: true, capture: true });
      // Also listen to touchmove and touchstart for better mobile support
      wrapperEl.addEventListener('touchmove', this.horizontalScrollListener, { passive: true });
      wrapperEl.addEventListener('touchstart', this.horizontalScrollListener, { passive: true });
    }

    // Mark as initialized
    this.stickyHeaderInitialized = true;

    // Initial update
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
    
    // Calculate if header should be sticky (when wrapper top reaches sticky offset)
    const shouldBeSticky = rect.top <= offset;
    
    if (shouldBeSticky) {
      // Get the table to read cell widths BEFORE making header fixed
      const table = header.closest('table') as HTMLTableElement;
      if (!table) return;
      
      // Get all header cells and corresponding data cells
      const headerCells = header.querySelectorAll('th');
      const firstDataRow = table.querySelector('tbody tr') as HTMLTableRowElement;
      
      // IMPORTANT: Capture widths BEFORE making header sticky to get accurate measurements
      // Also capture from the actual rendered table cells, not from computed styles
      const cellWidths: number[] = [];
      if (firstDataRow) {
        const dataCells = firstDataRow.querySelectorAll('td');
        
        // Capture data cell widths from actual rendered cells
        dataCells.forEach((td: Element, index: number) => {
          const tdElement = td as HTMLElement;
          // Use getBoundingClientRect for more accurate width measurement
          const cellRect = tdElement.getBoundingClientRect();
          cellWidths[index] = cellRect.width;
        });
      } else {
        // Fallback: use header cell widths if no data rows yet
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
      // This allows the header to contain all columns and translate to reveal them
      header.style.width = `${tableWidth}px`;
      header.style.zIndex = '100';
      header.style.backgroundColor = '#f8f9fa';
      header.style.display = 'table-header-group';
      header.style.tableLayout = 'fixed';
      // Use overflow hidden to clip the header to visible area
      header.style.overflow = 'hidden';
      // Don't set max-width - we want full width to translate
      
      // Initialize transform to match current scroll position (should be 0 initially)
      // Use translate3d for better performance on mobile
      const initialScrollLeft = wrapper.scrollLeft;
      header.style.transform = `translate3d(-${initialScrollLeft}px, 0, 0)`;
      header.style.webkitTransform = `translate3d(-${initialScrollLeft}px, 0, 0)`;
      
      // Get the header row (tr) - allow overflow so content can translate
      const headerRow = header.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = 'visible';
        headerRow.style.width = `${tableWidth}px`;
      }
      
      // Apply the captured widths to header cells to prevent width changes
      headerCells.forEach((th: Element, index: number) => {
        const thElement = th as HTMLElement;
        if (cellWidths[index] !== undefined) {
          // Set exact widths to prevent recalculation
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
            // Preserve the original width on data cells too
            tdElement.style.width = `${cellWidths[index]}px`;
            tdElement.style.minWidth = `${cellWidths[index]}px`;
            tdElement.style.maxWidth = `${cellWidths[index]}px`;
          }
        });
      }
      
      // Sync horizontal scroll immediately after styles are applied
      // Call directly for immediate update, especially important on mobile
      setTimeout(() => {
        this.syncHorizontalScroll();
      }, 0);
    } else {
      // Reset to normal positioning
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
      
      // Reset header row styles
      const headerRow = header.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = '';
        headerRow.style.width = '';
      }
      
      // Reset cell widths and styles on header cells
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
      
      // Reset cell widths on data cells
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
      // This ensures the header stays aligned with the wrapper
      header.style.left = `${wrapperLeft}px`;
      
      // Translate header horizontally to match the wrapper's scroll position
      // Negative value because we want to move the header LEFT when scrolling RIGHT
      // This reveals the columns that are scrolled into view
      // Use translate3d for better performance and to force GPU acceleration
      header.style.transform = `translate3d(-${scrollLeft}px, 0, 0)`;
      header.style.webkitTransform = `translate3d(-${scrollLeft}px, 0, 0)`;
      
      // Use will-change for better performance on mobile
      header.style.willChange = 'transform';
    }
  }

  loadUserPermissions() {
    this.adminService.getUserPermissions().subscribe({
      next: (response) => {
        this.userRole = response.role;
        this.userPermissions = response;
        this.isSuperAdmin = response.role === 'SuperAdmin';
        // Prefer the server's answer; fall back to the shared rule for an older API response that
        // predates the flag (SuperAdmins still save directly, Admins still submit for approval).
        this.canSaveOrderEditsDirectly = response.canSaveOrderEditsDirectly
          ?? canSaveOrderEditsDirectlyFor({ role: response.role });
        // Admins-list for the assigned-admin pill dropdown. Same source the shifts page uses.
        // Endpoint is Admin/SuperAdmin-only — skip for Moderators (avoids a 403) since they
        // can't reassign anyway.
        if (this.userRole === 'Admin' || this.isSuperAdmin) {
          this.shiftService.getShiftAdmins().subscribe({
            next: a => this.availableAdmins = a,
            error: () => {}
          });
        }
        this.loadOrders();
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.errorMessage = 'Failed to load permissions. Please try again.';
      }
    });
  }

  /** Mirror of the Users tab's openOrderInAdmin — opens the Users tab with this customer expanded. */
  openUserInAdmin(userId: number): void {
    window.open('/admin?userId=' + userId, '_blank');
  }

  loadOrders() {
    this.loadingStates.orders = true;
    this.assignedCleanersCache.clear();
    this.cleanersLoadedSet.clear();
    this.residentialVariantCache.clear();
    this.clearMessages();

    if (this.userRole && this.userRole !== 'Customer') {
      this.adminService.getAllOrders(this.showHiddenOrders).subscribe({
        next: (orders) => {
          this.orders = orders as AdminOrderList[];
          this.preloadResidentialVariants();
          this.preloadAssignedCleaners();
          this.orderReminderService.initialize(this.orders);
          if (this.isSuperAdmin) {
            this.calculateStatistics();
          }
          // The review queue follows the direct-save grant, not the role: a granted Admin
          // reviews colleagues' submissions, but the header statistics stay SuperAdmin-only.
          this.loadPendingOrderEdits();
          if (this.openOrderId) {
            setTimeout(() => this.viewOrderDetails(this.openOrderId!), 100);
          }
        },
        error: (error) => {
          console.error('Error loading orders:', error);
          this.errorMessage = 'Failed to load orders. Please try again.';
        },
        complete: () => {
          this.loadingStates.orders = false;
          // Re-initialize sticky header after data loads (in case view changed)
          setTimeout(() => {
            if (!this.stickyHeaderInitialized) {
              this.initializeStickyHeader();
            } else {
              this.updateStickyHeader();
            }
          }, 150);
        }
      });
    } else {
      this.orderService.getUserOrders().subscribe({
        next: (orders) => {
          this.orders = orders as AdminOrderList[];
          this.preloadResidentialVariants();
        },
        error: (error) => {
          console.error('Error loading orders:', error);
          this.errorMessage = 'Failed to load orders. Please try again.';
        },
        complete: () => {
          this.loadingStates.orders = false;
          // Re-initialize sticky header after data loads (in case view changed)
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
  }

  private preloadAssignedCleaners() {
    if (this.orders.length === 0) return;

    this.loadingStates.assignedCleaners = true;

    // Single bulk request for ALL orders' cleaners. This used to be an N+1 — one request per
    // order, batched 15 at a time but run sequentially — which took several seconds with many
    // orders. One round-trip now resolves every row's cleaners.
    this.adminService.getAssignedCleanersWithIdsBulk().subscribe({
      next: (cleanersByOrderId) => {
        this.orders.forEach(order => {
          const cleaners = cleanersByOrderId[order.id] ?? cleanersByOrderId[String(order.id)] ?? [];
          this.assignedCleanersCache.set(order.id, cleaners);
          this.cleanersLoadedSet.add(order.id);
        });
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error preloading assigned cleaners:', error);
        // Mark all orders as loaded (with empty) so they don't stay stuck in the loading state.
        this.orders.forEach(order => this.cleanersLoadedSet.add(order.id));
      },
      complete: () => {
        this.loadingStates.assignedCleaners = false;
      }
    });
  }

  /** Preload Deep/Regular variant for residential rows from order details API. */
  private preloadResidentialVariants() {
    const residentialOrders = this.orders.filter(order => this.isResidentialServiceType(order.serviceTypeName));
    if (residentialOrders.length === 0) return;

    const batchSize = 10;

    const loadBatch = (startIndex: number) => {
      const batch = residentialOrders.slice(startIndex, startIndex + batchSize);
      if (batch.length === 0) return;

      const requests = batch.map(order =>
        this.adminService.getOrderDetails(order.id).pipe(catchError(() => of(null)))
      );

      forkJoin(requests).subscribe({
        next: (detailsList) => {
          detailsList.forEach((details, index) => {
            const orderId = batch[index].id;
            const isDeep = this.resolveIsDeepResidential(batch[index] as any, details as any);
            this.residentialVariantCache.set(orderId, isDeep ? 'Deep' : 'Regular');
          });
          this.cdr.detectChanges();
        },
        complete: () => {
          const nextIndex = startIndex + batchSize;
          if (nextIndex < residentialOrders.length) {
            setTimeout(() => loadBatch(nextIndex), 80);
          }
        }
      });
    };

    loadBatch(0);
  }

  // Bumped whenever order DATA changes (load, status update, edit save) so the
  // memoized stats recompute. Filter-input changes are part of the cache key directly.
  private statsVersion = 0;
  private statsCacheKey: string | null = null;
  private statsCache = {
    totalOrders: 0, totalAmount: 0, totalTaxes: 0,
    totalTips: 0, totalAmountWithoutTipsAndTaxes: 0, totalDuration: 0
  };

  /** Existing call sites signal "order data changed" — invalidates the memoized stats. */
  private calculateStatistics() {
    this.statsVersion++;
  }

  /** Memoized statistics over the CURRENT filtered orders. Stable within a change-detection
   *  pass (no template-bound state is mutated), which fixes NG0100 on search. */
  private get stats() {
    const key = [
      this.statsVersion, this.orders.length, this.searchTerm,
      this.statusFilter, this.paymentMethodFilter, this.dateFilter,
      this.customDateFrom, this.customDateTo,
      this.serviceTypeFilter, this.bookedByFilter
    ].join('|');
    if (key !== this.statsCacheKey) {
      this.statsCacheKey = key;
      this.statsCache = this.computeStats(this.filterOrders());
    }
    return this.statsCache;
  }

  private computeStats(filteredOrders: AdminOrderList[]) {
    // Filter out pending, cancelled and fully-refunded orders for calculations. Refunded joins
    // cancelled because a fully-refunded order earned nothing — matching the backend statistics.
    const validOrders = filteredOrders.filter(order =>
      order.status &&
      order.status.toLowerCase() !== 'pending' &&
      order.status.toLowerCase() !== 'cancelled' &&
      order.status.toLowerCase() !== 'refunded'
    );

    // Total amount without tips (since tips don't count for taxes), net of any partial refund.
    // Subtracting the refund here is exact: this figure is tax-INCLUSIVE minus tips, the same
    // basis the customer was charged on, so a retained $70 fee is exactly what keeps counting.
    const totalAmount = validOrders.reduce((sum, order) => {
      const orderTotal = order.total || 0;
      const orderTips = order.tips || 0;
      const orderCompanyTips = order.companyDevelopmentTips || 0;
      const orderRefunded = order.totalRefundedAmount || 0;
      return sum + (orderTotal - orderTips - orderCompanyTips - orderRefunded);
    }, 0);

    // Approximate total taxes. The order list DTO carries no per-order tax, so this stays
    // an estimate — but totalAmount above is tax-INCLUSIVE (order.total already contains the
    // tax), so the tax has to be EXTRACTED with r/(1+r), not applied with r. Multiplying by
    // the bare rate overstated it by ~8.9% and correspondingly understated the "no tips & tax"
    // card. The exact, discount-aware figures live on the Statistics/Finances pages, which
    // read Order.Tax directly (see OrderRevenueMath on the backend).
    const totalTaxes = totalAmount * (this.salesTaxRate / (1 + this.salesTaxRate));

    return {
      totalOrders: validOrders.length,
      totalAmount,
      totalTaxes,
      totalTips: validOrders.reduce((sum, order) => {
        const orderTips = order.tips || 0;
        const orderCompanyTips = order.companyDevelopmentTips || 0;
        return sum + orderTips + orderCompanyTips;
      }, 0),
      totalAmountWithoutTipsAndTaxes: totalAmount - totalTaxes,
      totalDuration: validOrders.reduce((sum, order) => sum + (order.totalDuration || 0), 0)
    };
  }

  // Helper method to refresh a single order's assigned cleaners
  private refreshOrderCleaners(orderId: number): void {
    this.adminService.getAssignedCleanersWithIds(orderId).subscribe({
      next: (cleaners) => {
        this.assignedCleanersCache.set(orderId, cleaners);
        this.cleanersLoadedSet.add(orderId);
      },
      error: (error) => {
        console.error(`Error refreshing cleaners for order ${orderId}:`, error);
        this.assignedCleanersCache.set(orderId, []);
        this.cleanersLoadedSet.add(orderId);
      }
    });
  }

  viewOrderDetails(orderId: number) {
    if (this.viewingOrderId === orderId) {
      this.closeOrderDetails();
      return;
    }

    this.viewingOrderId = orderId;
    this.editingOrder = false;
    this.editingPaymentMethod = false;
    this.loadingStates.orderDetails = true;
    this.resetOrderPhotoState();
    this.loadOrderPhotos(orderId);
    this.resetOrderNoteState();
    this.loadOrderNote(orderId);
    this.loadOrderSavedCardInfo(orderId);
    this.resetTransferPanel();
    this.resetRefundState();
    if (this.isSuperAdmin) {
      this.loadOrderTransfers(orderId);
      this.loadOrderRefunds(orderId);
    }

    // Acknowledge any active reminders for this order
    this.orderReminderService.acknowledgeOrder(orderId);

    // Mark new order as viewed
    this.newOrderNotificationService.markViewed(orderId);
    
    // Clear previous update history
    this.orderUpdateHistory = [];
    
    if (this.userRole && this.userRole !== 'Customer') {
      this.adminService.getOrderDetails(orderId).subscribe({
        next: (order) => {
          this.selectedOrder = order;
          // Make sure the service-type catalog is loaded so isCustomModeOrder() works
          // for the on-the-fly Cleaners Total Salary display.
          if (this.serviceTypesCache.length === 0) {
            this.bookingService.getServiceTypes().subscribe({
              next: (list) => { this.serviceTypesCache = list; },
              error: () => { /* non-fatal: details view falls back to stored value */ }
            });
          }
          this.customerNames.set(orderId, `${order.contactFirstName} ${order.contactLastName}`);
          this.customerDetails.set(orderId, {
            id: order.userId,
            email: order.contactEmail
          });
          
          // Only load assigned cleaners if not already cached
          if (!this.assignedCleanersCache.has(orderId)) {
            this.loadSingleOrderCleaners(orderId);
          }
          
          // ADD THIS - Load update history
          this.loadUpdateHistory(orderId);
        },
        error: (error) => {
          console.error('Error loading order details:', error);
          this.errorMessage = 'Failed to load order details.';
        },
        complete: () => {
          this.loadingStates.orderDetails = false;
        }
      });
    } else {
      this.orderService.getOrderById(orderId).subscribe({
        next: (order) => {
          this.selectedOrder = order;
          
          // ADD THIS - Load update history for regular users too if needed
          // this.loadUpdateHistory(orderId);
        },
        error: (error) => {
          console.error('Error loading order details:', error);
          this.errorMessage = 'Failed to load order details.';
        },
        complete: () => {
          this.loadingStates.orderDetails = false;
        }
      });
    }
  }

  /** Close the slide-in order detail panel. */
  closeOrderDetails(): void {
    this.viewingOrderId = null;
    this.selectedOrder = null;
    this.editingOrder = false;
    this.editingPaymentMethod = false;
    this.resetSaveConfirmState();
    this.resetOrderPhotoState();
    this.resetOrderNoteState();
    this.resetRefundState();
  }

  /** Drop an unconfirmed save so it can never be applied to a different order. */
  private resetSaveConfirmState(): void {
    this.showSaveConfirm = false;
    this.pendingSaveDto = null;
    this.saveConfirmChanges = [];
  }

  // ── Internal order note (admin-only free text, above Assigned Cleaners) ──

  /** Mirrors the backend's [RequirePermission(Update)] on the notes endpoint. */
  get canEditOrderNote(): boolean {
    return this.isSuperAdmin || !!this.userPermissions?.permissions?.canUpdate;
  }

  /** True when the textarea differs from what is stored, i.e. there is something to save. */
  get orderNoteDirty(): boolean {
    return this.orderNoteDraft.trim() !== this.orderNoteSaved;
  }

  private resetOrderNoteState(): void {
    this.orderNoteDraft = '';
    this.orderNoteSaved = '';
    this.orderNoteUpdatedAt = null;
    this.orderNoteUpdatedByName = null;
    this.loadingOrderNote = false;
    this.savingOrderNote = false;
    this.orderNoteError = '';
    this.orderNoteSuccess = '';
  }

  private loadOrderNote(orderId: number): void {
    this.loadingOrderNote = true;
    this.adminService.getOrderAdminNotes(orderId).subscribe({
      next: (note) => {
        // The panel may have moved on to another order while this was in flight.
        if (this.viewingOrderId !== orderId) return;
        this.applyLoadedOrderNote(note);
        this.loadingOrderNote = false;
      },
      error: () => {
        if (this.viewingOrderId !== orderId) return;
        this.loadingOrderNote = false;
        this.orderNoteError = 'Failed to load the note for this order.';
      }
    });
  }

  private applyLoadedOrderNote(note: OrderAdminNote): void {
    this.orderNoteSaved = (note.notes || '').trim();
    this.orderNoteDraft = this.orderNoteSaved;
    this.orderNoteUpdatedAt = note.updatedAt || null;
    this.orderNoteUpdatedByName = note.updatedByName || null;
  }

  saveOrderNote(): void {
    const orderId = this.viewingOrderId;
    if (orderId == null || this.savingOrderNote || !this.canEditOrderNote) return;

    const text = this.orderNoteDraft.trim();
    if (text.length > this.orderNoteMaxLength) {
      this.orderNoteError = `The note is limited to ${this.orderNoteMaxLength} characters.`;
      return;
    }

    this.savingOrderNote = true;
    this.orderNoteError = '';
    this.orderNoteSuccess = '';

    // An empty box clears the note; the endpoint deletes the row rather than storing ''.
    this.adminService.updateOrderAdminNotes(orderId, text.length > 0 ? text : null).subscribe({
      next: (note) => {
        if (this.viewingOrderId !== orderId) return;
        this.applyLoadedOrderNote(note);
        this.savingOrderNote = false;
        this.orderNoteSuccess = text.length > 0 ? 'Note saved.' : 'Note cleared.';
        setTimeout(() => { this.orderNoteSuccess = ''; }, 3000);
      },
      error: (error) => {
        if (this.viewingOrderId !== orderId) return;
        this.savingOrderNote = false;
        this.orderNoteError = error?.error?.message || 'Failed to save the note.';
      }
    });
  }

  /** Drop an unsaved edit and go back to the stored text. */
  cancelOrderNoteEdit(): void {
    this.orderNoteDraft = this.orderNoteSaved;
    this.orderNoteError = '';
    this.orderNoteSuccess = '';
  }

  /** "Aug 23, 2026, 2:15 PM" in NY time, matching every other timestamp on this panel. */
  formatOrderNoteTimestamp(value: string | null): string {
    return value ? formatNyDateTime(value) : '';
  }

  private resetOrderPhotoState(): void {
    this.orderPhotos = [];
    this.lightboxOrderPhoto = null;
    this.orderPhotoError = '';
    this.orderPhotoSuccess = '';
    this.orderPhotoProgress = '';
    this.uploadingOrderPhoto = false;
  }

  // ── Order cleaning photos (same shared store as the per-user library) ──

  private loadOrderPhotos(orderId: number): void {
    this.loadingOrderPhotos = true;
    this.adminService.getOrderCleaningPhotos(orderId).subscribe({
      next: (photos) => {
        if (this.viewingOrderId !== orderId) return;
        this.orderPhotos = photos;
        this.loadingOrderPhotos = false;
      },
      error: () => { this.loadingOrderPhotos = false; }
    });
  }

  onOrderPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || this.viewingOrderId == null) return;
    const files = Array.from(input.files);
    input.value = '';
    this.uploadOrderPhotosSequentially(this.viewingOrderId, files);
  }

  private uploadOrderPhotosSequentially(orderId: number, files: File[]): void {
    if (this.uploadingOrderPhoto || files.length === 0) return;
    this.uploadingOrderPhoto = true;
    this.orderPhotoError = '';
    this.orderPhotoSuccess = '';
    this.orderPhotoProgress = '';

    const total = files.length;
    let okCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    const uploadOne = (index: number) => {
      if (this.viewingOrderId !== orderId) {
        this.uploadingOrderPhoto = false;
        this.orderPhotoProgress = '';
        return;
      }
      if (index >= total) {
        this.uploadingOrderPhoto = false;
        this.orderPhotoProgress = '';
        if (okCount > 0) {
          this.orderPhotoSuccess = total === 1 ? 'Photo uploaded.' : `${okCount} of ${total} photos uploaded.`;
          setTimeout(() => this.orderPhotoSuccess = '', 3000);
        }
        if (failCount > 0) {
          this.orderPhotoError = `${failCount} upload${failCount === 1 ? '' : 's'} failed${errors[0] ? ': ' + errors[0] : ''}.`;
          setTimeout(() => this.orderPhotoError = '', 5000);
        }
        this.loadOrderPhotos(orderId);
        return;
      }

      this.orderPhotoProgress = total > 1 ? `Uploading ${index + 1}/${total}…` : 'Uploading…';
      this.adminService.uploadOrderCleaningPhoto(orderId, files[index]).subscribe({
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

  removeOrderPhoto(photo: UserCleaningPhoto): void {
    if (!confirm('Remove this photo?')) return;
    const orderId = this.viewingOrderId;
    this.adminService.deleteUserCleaningPhoto(photo.id).subscribe({
      next: () => { if (orderId != null) this.loadOrderPhotos(orderId); }
    });
  }

  openOrderLightbox(photo: UserCleaningPhoto): void { this.lightboxOrderPhoto = photo; }
  closeOrderLightbox(): void { this.lightboxOrderPhoto = null; }

  resolvePhotoUrl(photo: UserCleaningPhoto | null | undefined): string {
    if (photo && photo.id) {
      return `${environment.apiUrl}/admin/user-care/cleaning-photos/${photo.id}/raw`;
    }
    return '';
  }

  // ── SuperAdmin order deletion ──

  deleteOrder(order: { id: number }): void {
    if (!this.isSuperAdmin || this.deletingOrder) return;
    if (!confirm(`Permanently delete order #${order.id}? This cannot be undone and does not issue a refund.`)) return;

    this.deletingOrder = true;
    this.adminService.deleteOrder(order.id).subscribe({
      next: () => {
        this.deletingOrder = false;
        this.successMessage = `Order #${order.id} deleted.`;
        setTimeout(() => this.clearMessages(), 3000);
        this.closeOrderDetails();
        this.loadOrders();
      },
      error: (err) => {
        this.deletingOrder = false;
        this.errorMessage = err?.error?.message || 'Failed to delete order.';
        setTimeout(() => this.clearMessages(), 4000);
      }
    });
  }

  loadUpdateHistory(orderId: number) {
    this.loadingUpdateHistory = true;
    
    this.adminService.getOrderUpdateHistory(orderId).subscribe({
      next: (history) => {
        this.orderUpdateHistory = history;
        this.loadingUpdateHistory = false;
      },
      error: (error) => {
        console.error('Error loading update history:', error);
        this.loadingUpdateHistory = false;
      }
    });
  }
  

  // ── Record manual (non-Stripe) payment for an additional-amount row ──
  // Used when the customer paid an order top-up by Zelle/Cash/Check (e.g. cleaning ran longer).
  // Marks just that update-history row paid via the chosen method; the base order stays a Stripe
  // order, so statistics still treat the base as a card charge and exclude this from Stripe fees.
  recordingManualPaymentForId: number | null = null;
  manualPaymentMethod = 'Zelle';
  manualPaymentReference = '';
  manualPaymentNotes = '';
  savingManualPayment = false;
  readonly manualPaymentMethods = ['Zelle', 'Cash', 'Check', 'Other'];

  /** Admins with update rights (and SuperAdmin), for an unpaid row that has money to collect. */
  canRecordManualPayment(update: OrderUpdateHistory): boolean {
    const canUpdate = this.isSuperAdmin || !!this.userPermissions?.permissions?.canUpdate;
    return canUpdate && !update.isPaid && (Number(update.additionalAmount) || 0) > 0.01;
  }

  openManualPaymentForm(update: OrderUpdateHistory): void {
    this.recordingManualPaymentForId = update.id;
    this.manualPaymentMethod = 'Zelle';
    this.manualPaymentReference = '';
    this.manualPaymentNotes = '';
  }

  cancelManualPayment(): void {
    this.recordingManualPaymentForId = null;
  }

  confirmManualPayment(update: OrderUpdateHistory): void {
    if (!this.selectedOrder || this.savingManualPayment) return;
    const orderId = this.selectedOrder.id;
    this.savingManualPayment = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.recordManualAdditionalPayment(
      orderId,
      update.id,
      this.manualPaymentMethod,
      this.manualPaymentReference?.trim() || null,
      this.manualPaymentNotes?.trim() || null
    ).subscribe({
      next: (res) => {
        this.successMessage = res?.message || 'Manual payment recorded.';
        setTimeout(() => { this.successMessage = ''; }, 5000);
        this.recordingManualPaymentForId = null;
        // Paying off the last additional amount flips the order Pending -> Active server-side.
        // Mirror the returned status locally so the panel badge + list update without a reload.
        if (res?.status) {
          if (this.selectedOrder && this.selectedOrder.id === orderId) {
            this.selectedOrder.status = res.status;
          }
          const listOrder = this.orders.find(o => o.id === orderId);
          if (listOrder) listOrder.status = res.status;
        }
        // Refresh history so the row flips to "paid via <method>" and unpaid totals update.
        this.adminService.getOrderUpdateHistory(orderId).subscribe({
          next: (history) => { this.orderUpdateHistory = history; }
        });
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to record manual payment.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingManualPayment = false; }
    });
  }

  // ── SuperAdmin: change the order's payment method (details panel) ──
  // For orders created expecting Stripe where the customer decided to pay cash/Zelle/etc.
  // (or the reverse). The backend re-routes the order between the Stripe and manual flows
  // (tracking fields, Pending/Active status, Stripe-fee accounting) — SuperAdmin-only.
  editingPaymentMethod = false;
  savingPaymentMethod = false;
  paymentMethodEdit: PaymentMethodValue = 'Normal';
  paymentMethodEditReference = '';
  paymentMethodEditNotes = '';

  /** SuperAdmin, and never once Stripe actually charged the card — a real charge is
   *  corrected with a refund, not a relabel (backend enforces the same rule). */
  get canEditPaymentMethod(): boolean {
    return this.isSuperAdmin && !!this.selectedOrder && !this.selectedOrder.isPaid;
  }

  startEditPaymentMethod(): void {
    if (!this.selectedOrder) return;
    this.paymentMethodEdit = ((this.selectedOrder.paymentMethod as PaymentMethodValue) || 'Normal');
    this.paymentMethodEditReference = this.selectedOrder.paymentReference || '';
    this.paymentMethodEditNotes = this.selectedOrder.paymentNotes || '';
    this.editingPaymentMethod = true;
  }

  cancelEditPaymentMethod(): void {
    this.editingPaymentMethod = false;
  }

  savePaymentMethod(): void {
    if (!this.selectedOrder || this.savingPaymentMethod) return;
    const orderId = this.selectedOrder.id;
    const method = this.paymentMethodEdit;
    this.savingPaymentMethod = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.updateOrderPaymentMethod(
      orderId,
      method,
      method !== 'Normal' ? (this.paymentMethodEditReference?.trim() || null) : null,
      method !== 'Normal' ? (this.paymentMethodEditNotes?.trim() || null) : null
    ).subscribe({
      next: (res) => {
        this.editingPaymentMethod = false;
        // Mirror the returned method + status into the panel and the table row so the
        // status badge, DoneM label and Payment Method filter update without a reload.
        if (this.selectedOrder && this.selectedOrder.id === orderId) {
          this.selectedOrder.paymentMethod = res.paymentMethod;
          this.selectedOrder.paymentReference = res.paymentReference;
          this.selectedOrder.paymentNotes = res.paymentNotes;
          this.selectedOrder.status = res.status;
        }
        const listOrder = this.orders.find(o => o.id === orderId);
        if (listOrder) {
          listOrder.paymentMethod = res.paymentMethod;
          listOrder.paymentReference = res.paymentReference;
          listOrder.paymentNotes = res.paymentNotes;
          listOrder.status = res.status;
        }
        this.successMessage = res?.message || 'Payment method updated.';
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        this.savingPaymentMethod = false;
        console.error('Error updating payment method:', err);
        this.errorMessage = err?.error?.message || 'Failed to update payment method.';
        this.clearMessagesAfterDelay();
      },
      complete: () => { this.savingPaymentMethod = false; }
    });
  }

  /** Total additional payment = difference (current total − tips) − (original total − tips), not sum of all update amounts. */
  getTotalAdditionalAmount(): number {
    if (!this.selectedOrder || !this.orderUpdateHistory?.length) return 0;
    const current = this.getCurrentTotalWithoutTips();
    const original = this.getOriginalTotalWithoutTips();
    return Math.max(0, Math.round((current - original) * 100) / 100);
  }

  /** Unpaid portion = total additional − sum of paid update amounts. */
  getUnpaidAdditionalAmount(): number {
    const total = this.getTotalAdditionalAmount();
    if (total <= 0 || !this.orderUpdateHistory?.length) return 0;
    const paid = this.orderUpdateHistory
      .filter(u => u.isPaid)
      .reduce((sum, u) => sum + (Number(u.additionalAmount) || 0), 0);
    return Math.max(0, Math.round((total - paid) * 100) / 100);
  }

  // Gate for the "Send payment reminder" / "Send updated payment" row in the order details
  // panel. The row only makes sense for Stripe-paid orders with an unpaid additional balance.
  //
  // Phase 1 manual payment: when admin marked a Done order with a non-Stripe method (Cash /
  // Zelle / Check / Other), no further reminders apply — admin recorded the payment in person,
  // there's nothing to remind. Hide the row in that case.
  shouldShowPaymentReminderRow(): boolean {
    const o = this.selectedOrder;
    if (!o) return false;
    if (!o.isPaid) return false;
    if (o.status === 'Cancelled') return false;
    if (this.getUnpaidAdditionalAmount() <= 0.01) return false;
    // Done + non-Stripe payment → no reminder. Treat missing paymentMethod as Normal so old
    // rows without the field still show the button when they would have before Phase 1.
    if (o.status === 'Done' && (o.paymentMethod || 'Normal') !== 'Normal') return false;
    return true;
  }

  sendingReminder = false;
  sendPaymentReminder(): void {
    if (!this.selectedOrder || this.sendingReminder) return;
    const orderId = this.selectedOrder.id;
    this.sendingReminder = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.sendPaymentReminder(orderId).subscribe({
      next: (res) => {
        this.successMessage = res?.message || 'Reminder sent successfully.';
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to send reminder.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.sendingReminder = false; }
    });
  }

  // True when the customer has not yet been told about the current outstanding additional amount.
  // The admin panel uses this to show "Send Updated Payment" (first send) instead of the regular
  // "Send Payment Reminder" button.
  hasUnnotifiedAdditionalPayment(): boolean {
    if (!this.orderUpdateHistory?.length) return false;
    return this.orderUpdateHistory.some(
      u => !u.isPaid && (u.additionalAmount || 0) > 0.01 && !u.updatedPaymentNotificationSentAt
    );
  }

  sendingUpdatedPayment = false;
  sendUpdatedPayment(): void {
    if (!this.selectedOrder || this.sendingUpdatedPayment) return;
    const orderId = this.selectedOrder.id;
    this.sendingUpdatedPayment = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.sendUpdatedPayment(orderId).subscribe({
      next: (res) => {
        this.successMessage = res?.message || 'Updated-payment notification sent.';
        setTimeout(() => { this.successMessage = ''; }, 5000);
        // Refresh history so the button switches to "Send Payment Reminder".
        this.adminService.getOrderUpdateHistory(orderId).subscribe({
          next: (history) => { this.orderUpdateHistory = history; }
        });
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to send updated-payment notification.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.sendingUpdatedPayment = false; }
    });
  }

  formatUpdateDate(date: any): string {
    // Update-history timestamps are UTC — display in NY (business) time.
    // Year omitted intentionally (panel is space-constrained; month/day/time is enough).
    return formatNy(date, { month: 'short', day: 'numeric' }) +
      ' ' + formatNy(date, { hour: '2-digit', minute: '2-digit' });
  }

  // Separate method for loading individual order cleaners
  private loadSingleOrderCleaners(orderId: number) {
    this.adminService.getAssignedCleanersWithIds(orderId).subscribe({
      next: (cleaners) => {
        this.assignedCleanersCache.set(orderId, cleaners);
        this.cleanersLoadedSet.add(orderId);
      },
      error: (error) => {
        this.assignedCleanersCache.set(orderId, []);
        this.cleanersLoadedSet.add(orderId);
      }
    });
  }

  removeCleanerFromOrder(orderId: number, cleanerId: number, cleanerName: string) {
    const confirmMessage = `Are you sure you want to remove ${cleanerName} from this order? They will receive an email notification about the removal.`;
    
    if (confirm(confirmMessage)) {
      this.loadingStates.removingCleaner = true;
      
      this.cleanerService.removeCleanerFromOrder(orderId, cleanerId).subscribe({
        next: () => {
          this.successMessage = `${cleanerName} has been removed from the order and notified via email.`;
          
          // Refresh assigned cleaners from server after removal
          this.adminService.getAssignedCleanersWithIds(orderId).subscribe({
            next: (updatedCleaners) => {
              // Update cache with fresh data from server
              this.assignedCleanersCache.set(orderId, updatedCleaners);
              
              // Remove manual change detection to prevent loops
              // this.cdr.detectChanges();
            },
            error: (error) => {
              console.error('Error refreshing assigned cleaners after removal:', error);
              // Fallback: update cache manually
              const currentCleaners = this.assignedCleanersCache.get(orderId) || [];
              const updatedCleaners = currentCleaners.filter(c => c.id !== cleanerId);
              this.assignedCleanersCache.set(orderId, updatedCleaners);
              // Remove manual change detection to prevent loops
              // this.cdr.detectChanges();
            }
          });
          
          this.clearMessagesAfterDelay();
        },
        error: (error) => {
          console.error('Error removing cleaner:', error);
          this.errorMessage = 'Failed to remove cleaner from order.';
        },
        complete: () => {
          this.loadingStates.removingCleaner = false;
        }
      });
    }
  }

  openCleanerAssignmentModal(orderId: number) {
    this.assigningOrderId = orderId;
    this.selectedCleaners = [];
    this.tipsForCleaner = '';
    this.cleanerAssignmentSearchQuery = '';
    this.showBusyCleaners = false;

    // Set hourly rate from order data if available, otherwise use default based on cleaning type
    const order = this.orders.find(o => o.id === orderId);
    if (this.selectedOrder && this.selectedOrder.id === orderId) {
      this.cleanerHourlySalary = this.selectedOrder.cleanerHourlyRate || this.getDefaultHourlyRate(orderId);
    } else {
      this.cleanerHourlySalary = this.getDefaultHourlyRate(orderId);
    }

    this.cleanerService.getAvailableCleaners(orderId).subscribe({
      next: (cleaners) => {
        this.availableCleaners = cleaners;
        this.showCleanerModal = true;
      },
      error: (error) => {
        console.error('Error loading available cleaners:', error);
        this.errorMessage = 'Failed to load available cleaners.';
      }
    });
  }

  closeCleanerModal() {
    this.showCleanerModal = false;
    this.assigningOrderId = null;
    this.selectedCleaners = [];
    this.tipsForCleaner = '';
    this.availableCleaners = [];
    this.cleanerAssignmentSearchQuery = '';
    this.showBusyCleaners = false;
    this.cleanerHourlySalary = REGULAR_CLEANER_HOURLY_RATE;
  }

  /**
   * Cleaners shown in the assign modal. Applies the name/email search, then — unless
   * "Show busy" is on — hides cleaners that are marked busy that day or have a hard
   * scheduling conflict. Already-selected cleaners stay visible regardless.
   */
  get availableCleanersFiltered(): AvailableCleaner[] {
    const q = this.cleanerAssignmentSearchQuery.trim().toLowerCase();
    return this.availableCleaners.filter((c) => {
      if (q) {
        const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase().trim();
        const email = (c.email ?? '').toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      if (this.showBusyCleaners) return true;
      if (this.isCleanerSelected(c.id)) return true;
      return !c.isBusyDay && !c.hasScheduleConflict;
    });
  }

  /** Count of busy/conflicting cleaners currently hidden by the "Show busy" toggle. */
  get hiddenBusyCleanersCount(): number {
    if (this.showBusyCleaners) return 0;
    return this.availableCleaners.filter(
      (c) => (c.isBusyDay || c.hasScheduleConflict) && !this.isCleanerSelected(c.id)
    ).length;
  }

  /** Human-readable rank label for a cleaner in the assignment modal. */
  cleanerRankLabel(ranking: number | string | null | undefined): string {
    const labels: Record<string, string> = {
      '0': 'Best', Top: 'Best',
      '1': 'Good', Standard: 'Good',
      '2': 'Normal', Beginner: 'Normal',
      '3': 'Bad', Restricted: 'Bad',
      '4': 'No-Exp', NoExp: 'No-Exp'
    };
    return labels[String(ranking ?? '1')] ?? 'Good';
  }

  /** Slug used for rank-colored chips (best/good/normal/bad/noexp). */
  cleanerRankSlug(ranking: number | string | null | undefined): string {
    const slugs: Record<string, string> = {
      '0': 'best', Top: 'best',
      '1': 'good', Standard: 'good',
      '2': 'normal', Beginner: 'normal',
      '3': 'bad', Restricted: 'bad',
      '4': 'noexp', NoExp: 'noexp'
    };
    return slugs[String(ranking ?? '1')] ?? 'good';
  }

  /**
   * Default hourly rate shown in the assign-cleaners modal, from the shared calculator:
   * filthy pays the highest rate, heavy condition the top rate, post construction / move in/out
   * and residential deep cleaning the mid rate, everything else the base rate. Only a fallback —
   * a rate already stored on the order (including an admin override) always wins.
   */
  getDefaultHourlyRate(orderId: number): number {
    const details = this.selectedOrder?.id === orderId ? this.selectedOrder : null;
    const listed = this.orders.find(o => o.id === orderId);

    // Residential deep cleaning is signalled by the extra service (but not "super deep").
    const hasDeepCleaning = !!details?.extraServices?.some(
      es => es.extraServiceName?.toLowerCase().includes('deep cleaning') &&
            !es.extraServiceName?.toLowerCase().includes('super')
    );

    // Custom ("Pre-Arranged") orders match on their per-order label, like every other
    // human-facing surface — the details DTO already resolves serviceTypeName to it.
    const serviceTypeName = details?.serviceTypeName
      ?? (listed?.isCustomServiceType ? listed?.customServiceDisplayName : listed?.serviceTypeName)
      ?? '';

    // The calculator takes the deep-cleaning FEE; here we only know whether it applies.
    return getDefaultCleanerHourlyRate(hasDeepCleaning ? 1 : 0, serviceTypeName);
  }

  /** The "(3h 30m × 2 × $21)" working shown under Est. Total in the assign-cleaners modal.
   *  Built from the same per-cleaner minutes the salary uses — showing the raw total
   *  duration here would contradict the figure above it whenever maids > 1. */
  getEstimatedSalaryBreakdown(): string {
    const order = this.selectedOrder;
    if (!order) return '';
    const maids = Math.max(1, Number(order.maidsCount) || 1);
    const perCleaner = DurationUtils.formatMinutes(
      calculatePerCleanerBillableMinutes(Number(order.totalDuration) || 0, maids, order.hasCleanersService)
    );
    const rate = `$${this.cleanerHourlySalary}`;
    return maids > 1 ? `${perCleaner} × ${maids} × ${rate}` : `${perCleaner} × ${rate}`;
  }

  /** Calculate estimated total salary for display in modal (shared calculator). */
  getEstimatedTotalSalary(): number {
    if (!this.selectedOrder) return 0;
    return calculateCleanerTotalSalary(
      this.selectedOrder.totalDuration,
      this.selectedOrder.maidsCount,
      this.selectedOrder.hasCleanersService,
      this.cleanerHourlySalary
    );
  }

  /** Display value for the "Cleaners Total Salary" row in the details view.
   *  ALWAYS computed on-the-fly from current TotalDuration × MaidsCount × HourlyRate so the
   *  number matches what the user sees for Duration/Cleaners on the page, even when the stored
   *  cleanerTotalSalary is stale (e.g. an older edit added Extra Minutes without recalculating). */
  getDisplayCleanerTotalSalary(): number {
    const order = this.selectedOrder;
    if (!order) return 0;
    const totalDuration = Number(order.totalDuration) || 0;
    const maids = Number(order.maidsCount) || 1;
    const rate = Number(order.cleanerHourlyRate) || 0;
    if (rate <= 0 || maids <= 0 || totalDuration <= 0) return 0;
    return calculateCleanerTotalSalary(totalDuration, maids, order.hasCleanersService, rate);
  }

  /** Recalculate cleaner total salary in edit form when hourly rate changes (shared calculator). */
  recalcCleanerTotalSalary(): void {
    const rate = Number(this.editOrderForm.cleanerHourlyRate) || 0;
    const totalDuration = Number(this.editOrderForm.totalDuration) || 0;
    const maidsCount = Number(this.editOrderForm.maidsCount) || 1;
    const hasCleanersService = this.selectedOrder?.hasCleanersService ?? false;
    this.editOrderForm.cleanerTotalSalary = calculateCleanerTotalSalary(totalDuration, maidsCount, hasCleanersService, rate);
  }

  // Method to force refresh all assigned cleaners (for debugging)
  refreshAllAssignedCleaners() {
    this.assignedCleanersCache.clear();
    this.cleanersLoadedSet.clear();
    this.preloadAssignedCleaners();
  }

  toggleCleanerSelection(cleanerId: number) {
    const index = this.selectedCleaners.indexOf(cleanerId);
    if (index > -1) {
      this.selectedCleaners.splice(index, 1);
      return;
    }
    // Hard rule: never select a cleaner with a same-day scheduling conflict.
    const cleaner = this.availableCleaners.find((c) => c.id === cleanerId);
    if (cleaner?.hasScheduleConflict) {
      return;
    }
    this.selectedCleaners.push(cleanerId);
  }

  isCleanerSelected(cleanerId: number): boolean {
    return this.selectedCleaners.includes(cleanerId);
  }

  assignCleanersToOrder() {
    if (!this.assigningOrderId || this.selectedCleaners.length === 0) {
      this.errorMessage = 'Please select at least one cleaner.';
      return;
    }

    this.loadingStates.assigningCleaners = true;

    // Store the order ID before it gets cleared by modal close
    const orderIdToRefresh = this.assigningOrderId;
    const selectedCleanersToAssign = [...this.selectedCleaners];
  
    this.cleanerService.assignCleaners(
      orderIdToRefresh,
      selectedCleanersToAssign,
      this.tipsForCleaner || undefined,
      this.cleanerHourlySalary
    ).subscribe({
      next: (response) => {
        this.successMessage = 'Cleaners assigned successfully. Click “Send assignment email” when you are ready to notify them.';
        this.closeCleanerModal();

        // Refresh order details to reflect updated hourly rate and salary
        this.refreshOrderAfterSave();

        // Refresh assigned cleaners from server to get accurate current state
        setTimeout(() => {
          this.adminService.getAssignedCleanersWithIds(orderIdToRefresh).subscribe({
            next: (updatedCleaners) => {
              // Update cache with fresh data from server
              this.assignedCleanersCache.set(orderIdToRefresh, updatedCleaners);
              
              // Remove manual change detection to prevent loops
              // this.cdr.detectChanges();
            },
            error: (error) => {
              console.error('Error refreshing assigned cleaners after assignment:', error);
              // Fallback: try to update cache manually using stored data
              const newCleanerData = selectedCleanersToAssign.map(cleanerId => {
                const cleaner = this.availableCleaners.find(c => c.id === cleanerId);
                return {
                  id: cleanerId,
                  name: cleaner ? `${cleaner.firstName} ${cleaner.lastName}` : '',
                  assignmentNotificationSentAt: null as string | null
                };
              }).filter(cleaner => cleaner.name !== '');
              
              const existingCleaners = this.assignedCleanersCache.get(orderIdToRefresh) || [];
              const allCleaners = [...existingCleaners];
              newCleanerData.forEach(newCleaner => {
                if (!allCleaners.some(existing => existing.id === newCleaner.id)) {
                  allCleaners.push(newCleaner);
                }
              });
              
              this.assignedCleanersCache.set(orderIdToRefresh, allCleaners);
              // Remove manual change detection to prevent loops
              // this.cdr.detectChanges();
            }
          });
        }, 500); // Wait 500ms for server to process
        
        this.clearMessagesAfterDelay();
      },
      error: (error) => {
        console.error('Error assigning cleaners:', error);
        // Surface the server's reason (e.g. the 1-hour-gap conflict message) when present.
        this.errorMessage = error?.error?.message || 'Failed to assign cleaners. Please try again.';
      },
      complete: () => {
        this.loadingStates.assigningCleaners = false;
      }
    });
  }

  getCustomerName(orderId: number): string {
    return this.customerNames.get(orderId) || `Customer #${orderId}`;
  }

  getCustomerId(orderId: number): number | string {
    const order = this.orders.find(o => o.id === orderId);
    return order && 'userId' in order ? order.userId : 'N/A';
  }

  getCustomerEmail(orderId: number): string {
    const order = this.orders.find(o => o.id === orderId);
    return order && 'contactEmail' in order ? order.contactEmail : 'N/A';
  }

  /** Returns true if cleaners have been loaded for this order (even if none assigned) */
  isCleanersLoaded(orderId: number): boolean {
    return this.cleanersLoadedSet.has(orderId);
  }

  // OPTIMIZATION: Getter methods for template (with caching) - REMOVED CONSOLE LOGS TO PREVENT INFINITE LOGGING
  getAssignedCleaners(orderId: number): string[] {
    const cleaners = this.assignedCleanersCache.get(orderId) || [];
    return cleaners.map(c => c.name);
  }

  /**
   * Names for the narrow orders-table column: "John Smithson" → "John Smi.".
   * The cell's title tooltip still carries the full names.
   */
  getAssignedCleanersShort(orderId: number): string {
    return this.getAssignedCleaners(orderId).map(n => this.shortenCleanerName(n)).join(', ');
  }

  /** Last name trimmed to 3 characters + a dot. Names already 3 chars or shorter are left alone. */
  private shortenCleanerName(fullName: string): string {
    const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return parts[0] || '';
    const last = parts[parts.length - 1];
    return `${parts[0]} ${last.length > 3 ? last.slice(0, 3) + '.' : last}`;
  }

  getAssignedCleanersWithIds(orderId: number): AssignedCleanerAdmin[] {
    return this.assignedCleanersCache.get(orderId) || [];
  }

  /** Cleaners on this order who have not yet received the admin-triggered assignment email. */
  getPendingAssignmentEmailCleaners(orderId: number): AssignedCleanerAdmin[] {
    return this.getAssignedCleanersWithIds(orderId).filter(
      c => c.assignmentNotificationSentAt == null || c.assignmentNotificationSentAt === ''
    );
  }

  sendCleanerAssignmentMailsForOrder(orderId: number) {
    if (this.getPendingAssignmentEmailCleaners(orderId).length === 0) {
      this.successMessage = 'All assigned cleaners already received the assignment email.';
      this.clearMessagesAfterDelay();
      return;
    }

    this.loadingStates.sendAssignmentMails = true;
    this.errorMessage = '';

    this.adminService.sendCleanerAssignmentMails(orderId).subscribe({
      next: (result) => {
        this.successMessage = result.message || `Sent to ${result.emailsSent} cleaner(s).`;
        this.adminService.getAssignedCleanersWithIds(orderId).subscribe({
          next: (list) => this.assignedCleanersCache.set(orderId, list),
          error: () => { /* cache refresh optional */ }
        });
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        console.error('Error sending assignment emails:', err);
        this.errorMessage = err.error?.message || 'Failed to send assignment emails.';
      },
      complete: () => {
        this.loadingStates.sendAssignmentMails = false;
      }
    });
  }

  // Re-send the booking confirmation with the order's CURRENT date/time/address — the flow for
  // "please send me an updated confirmation" after an admin reschedules. Confirmed first because
  // it puts real mail in the customer's inbox; the date is spelled out so a wrong order can't be
  // notified silently.
  resendConfirmation() {
    if (!this.selectedOrder || this.loadingStates.resendingConfirmation) return;
    const order = this.selectedOrder;

    const when = `${this.formatDate(order.serviceDate)} at ${order.serviceTime}`;
    if (!confirm(`Email and text the customer an updated confirmation for order #${order.id} — ${when}?`)) return;

    this.loadingStates.resendingConfirmation = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.adminService.resendConfirmation(order.id).subscribe({
      next: (res) => {
        this.successMessage = res?.message || 'Updated confirmation sent.';
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to send the updated confirmation.';
      },
      complete: () => {
        this.loadingStates.resendingConfirmation = false;
      }
    });
  }

  // ── "This customer has no email" ──────────────────────────────────────────────
  // A no-email account still carries the order's FROZEN contactEmail, which can look
  // perfectly real — admins read the resulting skipped email as a bug. The three send
  // paths resolve their address differently, so the panel states each one honestly
  // rather than showing a single blanket warning:
  //   • Send Payment Link          → the ACCOUNT email only (backend refuses without one)
  //   • Send Updated Confirmation  → skips email for a no-email account, texts anyway
  //   • Payment reminder / updated payment → the order's contactEmail, falling back to
  //     the account email, so it still emails when the order carries an address.

  /** True when the selected order's owner has no email address on their account. */
  get customerHasNoAccountEmail(): boolean {
    return !!this.selectedOrder?.customerHasNoAccountEmail;
  }

  /** The account email when it DISAGREES with the order's frozen contact email — the exact
   *  mismatch that makes a send land somewhere the admin did not expect. Null when they
   *  match, when the account has none, or when it wasn't loaded. */
  get differingAccountEmail(): string | null {
    const account = (this.selectedOrder?.customerAccountEmail || '').trim();
    if (!account) return null;
    const contact = (this.selectedOrder?.contactEmail || '').trim();
    return account.toLowerCase() === contact.toLowerCase() ? null : account;
  }

  /** Address the payment-reminder / updated-payment mails would actually use; '' means those
   *  can only go by text. Resolved server-side (NoEmailHelper.ResolveOrderNotificationEmail) so
   *  the panel can never name an address the sender would discard. */
  get notificationEmailTarget(): string {
    return (this.selectedOrder?.notificationEmailTarget || '').trim();
  }

  openSendPaymentLinkModal() {
    if (!this.selectedOrder) return;
    // Reset to both channels checked each time the modal opens — except email for an account
    // with no address, where the backend would reject the send outright.
    this.sendPaymentLinkChannels = { email: !this.customerHasNoAccountEmail, sms: true };
    this.showSendPaymentLinkModal = true;
  }

  closeSendPaymentLinkModal() {
    this.showSendPaymentLinkModal = false;
  }

  confirmSendPaymentLink() {
    if (!this.selectedOrder) return;
    const { email, sms } = this.sendPaymentLinkChannels;
    if (!email && !sms) {
      this.errorMessage = 'Select at least one channel (email or phone).';
      return;
    }

    this.loadingStates.sendPaymentLink = true;
    this.errorMessage = '';

    this.adminService.sendPaymentLink(this.selectedOrder.id, email, sms).subscribe({
      next: (result) => {
        this.successMessage = result.message || 'Payment link sent.';
        this.showSendPaymentLinkModal = false;
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        console.error('Error sending payment link:', err);
        this.errorMessage = err.error?.message || 'Failed to send payment link.';
      },
      complete: () => {
        this.loadingStates.sendPaymentLink = false;
      }
    });
  }

  private getCleanerResendKey(orderId: number, cleanerId: number): string {
    return `${orderId}:${cleanerId}`;
  }

  isResendingCleanerAssignmentMail(orderId: number, cleanerId: number): boolean {
    return this.resendingCleanerEmailKeys.has(this.getCleanerResendKey(orderId, cleanerId));
  }

  resendCleanerAssignmentMail(orderId: number, cleaner: AssignedCleanerAdmin) {
    const key = this.getCleanerResendKey(orderId, cleaner.id);
    if (this.resendingCleanerEmailKeys.has(key)) {
      return;
    }

    this.resendingCleanerEmailKeys.add(key);
    this.errorMessage = '';

    this.adminService.resendCleanerAssignmentMail(orderId, cleaner.id).subscribe({
      next: (result) => {
        this.successMessage = result.message || `Assignment email sent to ${cleaner.name}.`;
        this.adminService.getAssignedCleanersWithIds(orderId).subscribe({
          next: (list) => this.assignedCleanersCache.set(orderId, list),
          error: () => { /* optional cache refresh */ }
        });
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        console.error('Error resending cleaner assignment email:', err);
        this.errorMessage = err.error?.message || 'Failed to resend assignment email.';
      },
      complete: () => {
        this.resendingCleanerEmailKeys.delete(key);
      }
    });
  }

  updateOrderStatus(
    order: AdminOrderList,
    newStatus: string,
    paymentMethod: string | null = null,
    paymentReference: string | null = null,
    paymentNotes: string | null = null
  ) {
    this.adminService.updateOrderStatus(order.id, newStatus, paymentMethod, paymentReference, paymentNotes).subscribe({
      next: () => {
        order.status = newStatus;
        // Mirror the payment-method update locally so the DoneM badge + filter pick up the
        // change without a full list reload. Only mutate when the caller actually passed a
        // method — null means "preserved server-side", which we should also preserve here.
        if (paymentMethod !== null && paymentMethod !== undefined) {
          order.paymentMethod = paymentMethod;
          order.paymentReference = paymentMethod !== 'Normal' ? paymentReference : null;
          order.paymentNotes = paymentMethod !== 'Normal' ? paymentNotes : null;
        }
        // Also update selectedOrder if it's the same order
        if (this.selectedOrder && this.selectedOrder.id === order.id) {
          this.selectedOrder.status = newStatus;
          if (paymentMethod !== null && paymentMethod !== undefined) {
            this.selectedOrder.paymentMethod = paymentMethod;
            this.selectedOrder.paymentReference = paymentMethod !== 'Normal' ? paymentReference : null;
            this.selectedOrder.paymentNotes = paymentMethod !== 'Normal' ? paymentNotes : null;
          }
        }
        this.successMessage = `Order #${order.id} status updated to ${newStatus}`;
        this.clearMessagesAfterDelay();
      },
      error: (error) => {
        console.error('Error updating order status:', error);
        this.errorMessage = 'Failed to update order status.';
      }
    });
  }

  markOrderAsDone(order: AdminOrderList) {
    this.doneModalOrder = order;
    // Pre-fill the payment-method block from whatever the order already carries. Default is
    // 'Normal' (Stripe flow) so existing Active orders behave as before; manual-payment orders
    // (e.g. Pending Zelle from admin booking) come up with the recorded method + reference.
    this.donePaymentMethod = ((order.paymentMethod as PaymentMethodValue) || 'Normal');
    this.donePaymentReference = order.paymentReference || '';
    this.donePaymentNotes = order.paymentNotes || '';
    this.showDoneModal = true;
  }

  closeDoneModal() {
    this.showDoneModal = false;
    this.doneModalOrder = null;
  }

  confirmDone(sendReview: boolean) {
    if (!this.doneModalOrder) return;
    const order = this.doneModalOrder;

    // Phase 1 — pass payment method through so the backend can persist it on the Done
    // transition. Reference/Notes are sent only for manual methods (Normal ignores them).
    this.updateOrderStatus(
      order,
      'Done',
      this.donePaymentMethod,
      this.donePaymentMethod !== 'Normal' ? this.donePaymentReference : null,
      this.donePaymentMethod !== 'Normal' ? this.donePaymentNotes : null
    );

    if (sendReview) {
      this.sendingReview = true;
      this.adminService.sendReviewRequest(order.id).subscribe({
        next: () => {
          this.sendingReview = false;
          this.successMessage = `Order #${order.id} marked as Done. Review request sent.`;
          this.clearMessagesAfterDelay();
        },
        error: () => {
          this.sendingReview = false;
          this.errorMessage = 'Order marked as Done but failed to send review request.';
        }
      });
    }

    this.closeDoneModal();
  }

  reactivateOrder(order: AdminOrderList) {
    const previousStatus = order.status;
    // Pending means "waiting on a Stripe payment". A manual-payment order (Cash/Zelle/Check/
    // Other) is never waiting on one — it is settled on site — so it goes back to Active even
    // with IsPaid=false. Mirrors how such orders are CREATED in BookingController
    // (initialStatus = paymentMethod == Normal ? "Pending" : "Active").
    const manualPayment = !!order.paymentMethod && order.paymentMethod !== 'Normal';
    const newStatus = (order.isPaid || manualPayment) ? 'Active' : 'Pending';
    if (confirm(`Are you sure you want to reactivate order #${order.id} from ${previousStatus} status?`)) {
      this.updateOrderStatus(order, newStatus);
    }
  }

  cancelOrder(order: AdminOrderList) {
    if (!this.userPermissions.permissions.canUpdate) {
      this.errorMessage = 'You do not have permission to cancel orders.';
      return;
    }
    this.adminCancelOrderId = order.id;
    this.adminCancelReason = '';
    this.showAdminCancelModal = true;
  }

  closeAdminCancelModal() {
    this.showAdminCancelModal = false;
    this.adminCancelOrderId = null;
    this.adminCancelReason = '';
  }

  confirmAdminCancelOrder() {
    if (!this.adminCancelOrderId || !this.adminCancelReason.trim()) return;

    const orderId = this.adminCancelOrderId;
    const order = this.orders.find(o => o.id === orderId);

    this.adminService.cancelOrder(orderId, this.adminCancelReason).subscribe({
      next: () => {
        if (order) {
          order.status = 'Cancelled';
          order.cancellationReason = this.adminCancelReason;
        }
        if (this.selectedOrder && this.selectedOrder.id === orderId) {
          this.selectedOrder.status = 'Cancelled';
          this.selectedOrder.cancellationReason = this.adminCancelReason;
        }
        this.closeAdminCancelModal();
        this.successMessage = `Order #${orderId} has been cancelled.`;
        this.clearMessagesAfterDelay();
      },
      error: (error) => {
        console.error('Error cancelling order:', error);
        this.errorMessage = 'Failed to cancel order.';
      }
    });
  }

  // ── Export (SuperAdmin-only), mirrors the users-tab export ──

  openExportModal(): void {
    if (!this.isSuperAdmin) return;
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
    // Export what the admin currently sees: the filtered list (all pages, not just the current one).
    const orderIds = this.filterOrders().map(o => o.id);
    if (orderIds.length === 0) {
      this.exportError = 'No orders match the current filters.';
      return;
    }
    this.exporting = true;
    this.exportError = '';
    this.adminService.exportOrders(selected, orderIds).subscribe({
      next: (res) => {
        const blob = res.body;
        if (!blob) {
          this.exportError = 'Export returned an empty file.';
          this.exporting = false;
          return;
        }
        // Try to honor the server-provided filename, fall back to a timestamped default.
        let filename = `orders-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
        this.exportError = err?.error?.message || err?.message || 'Failed to export orders.';
      }
    });
  }

  // Filtering methods
  /** Current page of the filtered list. PURE — no state mutations here (NG0100). */
  get filteredOrders(): AdminOrderList[] {
    const filtered = this.filterOrders();
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return filtered.slice(start, start + this.itemsPerPage);
  }

  /** Applies search/status/payment/date filters + sort. Pure function of component state. */
  private filterOrders(): AdminOrderList[] {
    let filtered = this.orders;

    // Search filter
    if (this.searchTerm) {
      const search = this.searchTerm.toLowerCase();
      filtered = filtered.filter(order => 
        order.id.toString().includes(search) ||
        (order.contactEmail && order.contactEmail.toLowerCase().includes(search))
      );
    }

    // Status filter
    if (this.statusFilter !== 'all') {
      filtered = filtered.filter(order => order.status && order.status.toLowerCase() === this.statusFilter.toLowerCase());
    }

    // Phase 1: Payment Method filter. Treat missing paymentMethod as 'Normal' so legacy
    // rows (pre-migration cache) don't disappear when admin filters to "Normal (Stripe)".
    if (this.paymentMethodFilter !== 'all') {
      filtered = filtered.filter(o => (o.paymentMethod || 'Normal') === this.paymentMethodFilter);
    }

    // Service-type filter (move in/out, arranged, deep, regular, custom, filthy, heavy).
    // Residential orders resolve to 'deep'/'regular' via the same logic as the column.
    if (this.serviceTypeFilter !== 'all') {
      filtered = filtered.filter(o => this.getServiceTypeFilterKey(o) === this.serviceTypeFilter);
    }

    // Booked-by filter: admin-created (create-for-user) vs customer self-booked.
    if (this.bookedByFilter !== 'all') {
      filtered = filtered.filter(o =>
        this.bookedByFilter === 'admin' ? !!o.bookedByAdmin : !o.bookedByAdmin);
    }

    // Date filter
    if (this.dateFilter !== 'all') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      filtered = filtered.filter(order => {
        const serviceDateOnly = this.getServiceDateOnly(order.serviceDate);
        if (!serviceDateOnly) return false;
        
        // Each window is bounded on BOTH sides — "Today"/"This Week"/"This Month"
        // must not leak future days/weeks/months into the list.
        switch (this.dateFilter) {
          case 'today':
            return serviceDateOnly.getTime() === today.getTime();
          case 'week': {
            // Current week: Sunday 00:00 (inclusive) → next Sunday 00:00 (exclusive)
            const startOfWeek = new Date(today);
            startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(endOfWeek.getDate() + 7);
            return serviceDateOnly >= startOfWeek && serviceDateOnly < endOfWeek;
          }
          case 'month': {
            // Current calendar month: the 1st (inclusive) → 1st of next month (exclusive)
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            return serviceDateOnly >= startOfMonth && serviceDateOnly < startOfNextMonth;
          }
          case 'custom': {
            // Specific days picked by the admin; both bounds inclusive. With only one bound
            // set it acts as "from that day" / "up to that day".
            const from = this.parseLocalDate(this.customDateFrom);
            const to = this.parseLocalDate(this.customDateTo);
            if (!from && !to) return true;
            if (from && serviceDateOnly < from) return false;
            if (to && serviceDateOnly > to) return false;
            return true;
          }
          default:
            return true;
        }
      });
    }

    // Sort
    if (this.sortColumn) {
      filtered = [...filtered].sort((a, b) => {
        let cmp = 0;
        switch (this.sortColumn) {
          case 'id':
            cmp = a.id - b.id;
            break;
          case 'email':
            cmp = (a.contactEmail || '').localeCompare(b.contactEmail || '');
            break;
          case 'serviceDate': {
            cmp = new Date(a.serviceDate).getTime() - new Date(b.serviceDate).getTime();
            if (cmp === 0) cmp = (a.serviceTime || '').localeCompare(b.serviceTime || '');
            break;
          }
          case 'serviceType':
            cmp = this.getServiceTypeDisplay(a).localeCompare(this.getServiceTypeDisplay(b));
            break;
          case 'city':
            cmp = (a.city || '').localeCompare(b.city || '');
            break;
          case 'total':
            cmp = this.getOrderTotalWithoutTips(a) - this.getOrderTotalWithoutTips(b);
            break;
          case 'status':
            cmp = (a.status || '').localeCompare(b.status || '');
            break;
          case 'cleaners':
            cmp = (this.assignedCleanersCache.get(a.id)?.length ?? 0) - (this.assignedCleanersCache.get(b.id)?.length ?? 0);
            break;
          default:
            break;
        }
        return this.sortDirection === 'asc' ? cmp : -cmp;
      });
    }

    return filtered;
  }

  setSort(column: string) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
  }

  // Pagination methods
  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  // Utility methods
  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString();
  }

  private getServiceDateOnly(serviceDate: Date | string | null | undefined): Date | null {
    if (!serviceDate) return null;
    const date = new Date(serviceDate);
    if (isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /** Parse a date-input value (yyyy-MM-dd) as LOCAL midnight — `new Date(string)` would
   *  parse it as UTC and shift the day for NY users. */
  private parseLocalDate(value: string): Date | null {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  getServiceTypeDisplay(order: AdminOrderList): string {
    // Custom ("Pre-Arranged") orders show the admin-chosen label bare (no "Cleaning").
    // Legacy custom orders with no chosen label fall through to the normal formatter, which
    // renders "Pre-Arranged Cleaning" as "Arranged" until a SuperAdmin assigns a real type.
    if (order.isCustomServiceType && order.customServiceDisplayName) {
      return order.customServiceDisplayName;
    }

    const normalize = (value: string | null | undefined): string =>
      (value || '').toLowerCase().trim().replace(/[_\s]+/g, '-');

    const serviceTypeRaw = normalize(order.serviceTypeName);
    const selectedOrderForRow = (this.selectedOrder && this.selectedOrder.id === order.id)
      ? (this.selectedOrder as any)
      : null;
    const orderAny = order as any;
    const cleaningTypeRaw = normalize(orderAny?.cleaningType);

    const isResidential = this.isResidentialServiceType(order.serviceTypeName);
    if (isResidential) {
      const cachedVariant = this.residentialVariantCache.get(order.id);
      if (cachedVariant) return cachedVariant;

      const extras: any[] =
        (Array.isArray(orderAny?.extraServices) ? orderAny.extraServices : [])
          .concat(Array.isArray(selectedOrderForRow?.extraServices) ? selectedOrderForRow.extraServices : []);
      const services: any[] =
        (Array.isArray(orderAny?.services) ? orderAny.services : [])
          .concat(Array.isArray(selectedOrderForRow?.services) ? selectedOrderForRow.services : []);

      const isDeep = this.resolveIsDeepResidential(
        { ...orderAny, extraServices: extras, services, cleaningType: cleaningTypeRaw },
        selectedOrderForRow
      );

      return isDeep
        ? 'Deep'
        : 'Regular';
    }

    return this.formatServiceTypeLabel(order.serviceTypeName);
  }

  /**
   * Canonical service-type category key for the orders filter. Mirrors the labels shown
   * in the Service Type column: residential splits into 'deep'/'regular'; everything else
   * maps by name to 'move-in-out' / 'arranged' / 'custom' / 'filthy' / 'heavy'. Anything
   * else falls through to 'other' (never matches a filter option, so it's hidden when a
   * specific type is selected — and always shown under "All Types").
   */
  getServiceTypeFilterKey(order: AdminOrderList): string {
    // Custom orders fold into the real categories by their chosen label so they sort/filter
    // alongside genuine Deep/Office/etc. orders. Legacy custom orders (no label) stay "arranged".
    if (order.isCustomServiceType) {
      if (!order.customServiceDisplayName) return 'arranged';
      const label = order.customServiceDisplayName.toLowerCase();
      if (label.includes('deep')) return 'deep';
      if (label.includes('regular')) return 'regular';
      if (label.includes('move')) return 'move-in-out';
      if (label.includes('office')) return 'office';
      if (label.includes('filthy')) return 'filthy';
      if (label.includes('heavy')) return 'heavy';
      return 'custom';
    }
    if (this.isResidentialServiceType(order.serviceTypeName)) {
      return this.getServiceTypeDisplay(order) === 'Deep' ? 'deep' : 'regular';
    }
    const key = (order.serviceTypeName || '').toLowerCase();
    if (key.includes('move')) return 'move-in-out';
    if (key.includes('office')) return 'office';
    if (key.includes('arranged')) return 'arranged';
    if (key.includes('custom')) return 'custom';
    if (key.includes('filthy')) return 'filthy';
    if (key.includes('heavy')) return 'heavy';
    return 'other';
  }

  /**
   * Both delegate to shared/admin/service-type-short-label.ts. The Outgoing Payments table shows
   * the identical column, and two admin tables labelling the same order differently is exactly
   * the confusion worth one shared function. Kept as thin methods so the template and the
   * sort/filter helpers below read unchanged.
   */
  private formatServiceTypeLabel(serviceTypeName: string | null | undefined): string {
    return formatAdminServiceTypeLabel(serviceTypeName);
  }

  private isResidentialServiceType(serviceTypeName: string | null | undefined): boolean {
    return isResidentialServiceTypeName(serviceTypeName);
  }

  private resolveIsDeepResidential(orderLike: any, detailsLike?: any): boolean {
    const normalize = (value: string | null | undefined): string =>
      (value || '').toLowerCase().trim().replace(/[_\s]+/g, '-');

    const cleaningTypeRaw = normalize(orderLike?.cleaningType || detailsLike?.cleaningType);
    if (cleaningTypeRaw === 'deep' || cleaningTypeRaw === 'deep-cleaning') return true;

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

  formatTime(time: string): string {
    return time || 'N/A';
  }

  formatDateTime(date: Date | string, time?: string): string {
    const dateObj = new Date(date);
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const day = dateObj.getDate().toString().padStart(2, '0');
    const year = dateObj.getFullYear().toString().slice(-2);
    const dateStr = `${month}/${day}/${year}`;
    let timeStr = '';
    if (time) {
      const [h, m] = time.split(":");
      const hour = parseInt(h, 10);
      const minute = parseInt(m, 10);
      let period = 'AM';
      let hour12 = hour;
      if (hour === 0) {
        hour12 = 12;
      } else if (hour >= 12) {
        period = 'PM';
        if (hour > 12) hour12 = hour - 12;
      }
      timeStr = `${hour12}:${minute.toString().padStart(2, '0')} ${period}`;
    } else {
      let hours = dateObj.getHours();
      let minutes = dateObj.getMinutes();
      let period = hours >= 12 ? 'PM' : 'AM';
      let hour12 = hours % 12;
      if (hour12 === 0) hour12 = 12;
      timeStr = `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
    }
    return `${dateStr} ${timeStr}`;
  }

  /** For UTC timestamps (orderDate "Booked On" etc.) — formats in NY time, "06/13/26 6:36 AM". */
  formatUtcDateTime(date: Date | string): string {
    const dateStr = formatNy(date, { year: '2-digit', month: '2-digit', day: '2-digit' });
    const timeStr = formatNy(date, { hour: 'numeric', minute: '2-digit', hour12: true });
    return dateStr && timeStr ? `${dateStr} ${timeStr}` : '';
  }

  formatDuration(minutes: number): string {
    // Ensure minimum 1 hour (60 minutes) before formatting
    const adjustedMinutes = Math.max(minutes, 60);
    return DurationUtils.formatDurationRounded(adjustedMinutes);
  }

  formatTotalDuration(minutes: number): string {
    if (minutes === 0) {
      return '0h';
    }
    
    // Use the same rounding logic as other components
    const adjustedMinutes = Math.max(minutes, 60);
    return DurationUtils.formatDurationRounded(adjustedMinutes);
  }

  formatCurrency(amount: number): string {
    return `${amount.toFixed(2)}`;
  }

  /** Total for display in admin: order amount excluding tips (tips are shown separately). */
  getOrderTotalWithoutTips(order: AdminOrderList): number {
    const total = order.total ?? 0;
    const tips = order.tips ?? 0;
    const companyTips = order.companyDevelopmentTips ?? 0;
    return Math.round((total - tips - companyTips) * 100) / 100;
  }

  /** Original total excluding tips (for order details pricing column). */
  getOriginalTotalWithoutTips(): number {
    if (!this.selectedOrder) return 0;
    if (this.selectedOrder.initialTotal > 0) {
      const t = this.selectedOrder.initialTotal;
      const tips = this.selectedOrder.initialTips ?? 0;
      const companyTips = this.selectedOrder.initialCompanyDevelopmentTips ?? 0;
      return Math.round((t - tips - companyTips) * 100) / 100;
    }
    if (this.orderUpdateHistory && this.orderUpdateHistory.length > 0) {
      const u = this.orderUpdateHistory[0];
      const t = u.originalTotal;
      const tips = u.originalTips ?? 0;
      const companyTips = u.originalCompanyDevelopmentTips ?? 0;
      return Math.round((t - tips - companyTips) * 100) / 100;
    }
    return 0;
  }

  /** Current total excluding tips (for order details pricing column). */
  getCurrentTotalWithoutTips(): number {
    if (!this.selectedOrder) return 0;
    const t = this.selectedOrder.total ?? 0;
    const tips = this.selectedOrder.tips ?? 0;
    const companyTips = this.selectedOrder.companyDevelopmentTips ?? 0;
    return Math.round((t - tips - companyTips) * 100) / 100;
  }

  /**
   * "Tips for Company Development" is retired: no form, no input, no API field. Only orders
   * placed while it existed can be non-zero, and that money is part of what was charged, so
   * the panel's tip-free totals and price previews still subtract/include the STORED value.
   */
  get legacyCompanyDevelopmentTips(): number {
    return Number(this.selectedOrder?.companyDevelopmentTips ?? 0) || 0;
  }

  /** Cleaner tips for the panel summary bar — live edit value while editing, saved value otherwise. */
  getSummaryTips(): number {
    if (this.editingOrder) return Number(this.editOrderForm.tips ?? 0) || 0;
    return Number(this.selectedOrder?.tips ?? 0) || 0;
  }

  /**
   * Total for the panel summary bar, always excluding tips. `editOrderForm.total` INCLUDES tips
   * (it mirrors what the backend persists), so edit mode has to subtract them here to match the
   * tip-free total shown in view mode.
   */
  getSummaryTotalWithoutTips(): number {
    if (!this.editingOrder) return this.getCurrentTotalWithoutTips();
    const t = Number(this.editOrderForm.total ?? 0) || 0;
    const tips = Number(this.editOrderForm.tips ?? 0) || 0;
    return Math.round(Math.max(0, t - tips - this.legacyCompanyDevelopmentTips) * 100) / 100;
  }

  /**
   * Original subscription discount: derived from current discount rate applied to original subtotal.
   * (Backend does not send initialSubscriptionDiscountAmount, so we use rate: currentDiscount/currentSubTotal * originalSubTotal.)
   */
  getOriginalSubscriptionDiscountAmount(): number {
    if (!this.selectedOrder) return 0;
    const currentDiscount = Number((this.selectedOrder as any).subscriptionDiscountAmount ?? 0) || 0;
    const currentSub = Number(this.selectedOrder.subTotal ?? 0) || 0;
    let originalSub = 0;
    if (this.selectedOrder.initialTotal > 0) {
      originalSub = Number(this.selectedOrder.initialSubTotal ?? 0) || 0;
    } else if (this.orderUpdateHistory && this.orderUpdateHistory.length > 0) {
      originalSub = Number(this.orderUpdateHistory[0].originalSubTotal ?? 0) || 0;
    }
    if (currentSub <= 0 || originalSub <= 0) return 0;
    const rate = currentDiscount / currentSub;
    return Math.round(originalSub * rate * 100) / 100;
  }

  /**
   * True when money came back on this order but NOT all of it — the retained-cancellation-fee
   * case (e.g. order #264: $250.91 returned of $320.91 charged, the $70 fee kept).
   *
   * Partial vs full is decided by the STATUS, never by comparing amounts here. The backend flips
   * Status to "Refunded" in exactly one place (OrderRefundService.ApplyRefundTotals) and exactly
   * when the refunded total clears everything actually charged — so "refunded > 0 but status is
   * not Refunded" IS the backend's own definition of partial. Re-deriving it from `total` would
   * be wrong on both sides: tips ride outside the charged amount, and an admin edit can move
   * `total` after the charge settled.
   */
  isPartiallyRefunded(order: AdminOrderList): boolean {
    return (Number(order.totalRefundedAmount) || 0) > 0
      && (order.status || '').toLowerCase() !== 'refunded';
  }

  getStatusClass(order: AdminOrderList): string {
    // A partial refund keeps its stored status but earns its own pill: the money was neither
    // fully kept nor fully returned, so neither the done/active nor the cancelled colour is
    // honest. Amber is the paired warning token, not a third red.
    if (this.isPartiallyRefunded(order)) return 'status-refund-partial';

    switch ((order.status || '').toLowerCase()) {
      case 'active':
        return 'status-active';
      case 'pending':
        return 'status-pending';
      case 'done':
        return 'status-done';
      case 'cancelled':
        return 'status-cancelled';
      case 'refunded':
        // Deliberately shares the cancelled treatment: both mean "this order brought in no money".
        return 'status-cancelled status-refunded';
      default:
        return '';
    }
  }

  /**
   * Storage → status-column label. Present-tense verbs are a deliberate display choice; the
   * stored Order.Status values stay "Cancelled"/"Refunded" and MUST NOT be renamed — roughly
   * thirty comparison sites plus OrderStatuses, OrderBookedFilter and the statistics grouping
   * key off the stored spelling.
   */
  private static readonly STATUS_LABELS: Record<string, string> = {
    pending: 'Pending',
    active: 'Active',
    done: 'Done',
    cancelled: 'Cancel',
    refunded: 'Refund',
  };

  /**
   * Status column text. Two labels are DERIVED rather than stored, on the same principle:
   *  - `DoneM`   — Done, paid by a non-Stripe method (Phase 1), so manual payments are scannable.
   *  - `RefundH` — partially refunded (see isPartiallyRefunded). Deriving it is what lets a
   *    cancelled-then-part-refunded order keep "Cancelled" in the database, leaving every
   *    reporting predicate that reads Status (IsRealBooking, CanBeHidden, WasPerformed) exactly
   *    as it was. RefundH outranks the underlying status in the pill, so that status is carried
   *    in the tooltip instead — see getStatusTitle.
   */
  getStatusDisplayLabel(order: AdminOrderList): string {
    if (this.isPartiallyRefunded(order)) return 'RefundH';

    const key = (order.status || '').toLowerCase();
    if (key === 'done' && order.paymentMethod && order.paymentMethod !== 'Normal') {
      return 'DoneM';
    }
    return OrdersComponent.STATUS_LABELS[key] ?? order.status;
  }

  /**
   * Hover text for the status pill. Only RefundH needs one: it replaces the real status on
   * screen, so the status it replaced — and how much actually came back — has to stay reachable
   * without opening the order. The plain statuses explain themselves and get no tooltip.
   */
  getStatusTitle(order: AdminOrderList): string {
    if (this.isPartiallyRefunded(order)) {
      const refunded = this.formatCurrency(Number(order.totalRefundedAmount) || 0);
      return `Partially refunded — ${refunded} returned to the customer. Order status: ${order.status}.`;
    }
    return '';
  }

  clearMessages() {
    this.errorMessage = '';
    this.successMessage = '';
  }

  private clearMessagesAfterDelay() {
    setTimeout(() => {
      this.clearMessages();
    }, 5000);
  }

  hasCleanersService(): boolean {
    if (!this.selectedOrder) return false;
    // Only true for service types with an explicit Cleaners + Hours row (e.g. Office Cleaning),
    // because for those TotalDuration is already per-cleaner. Custom Pricing now stores
    // TotalDuration as TOTAL across all maids (matching non-custom convention), so the perMaid
    // template branch handles its display correctly via TotalDuration / MaidsCount.
    if (this.selectedOrder.hasCleanersService) return true;
    return this.selectedOrder.services?.some(s => s.serviceName && s.serviceName.toLowerCase().includes('cleaner')) ?? false;
  }

  getServiceName(order: Order | null, i: number, fallback: number): string {
    const s = (order?.services ?? [])[i];
    return s?.serviceName || '#' + fallback;
  }

  /** Service label: "Studio" when bedrooms quantity is 0, else normal name. */
  getEditServiceDisplayName(s: { quantity: number }, i: number): string {
    const def = this.getEditServiceDefinition(i);
    if (def?.serviceKey === 'bedrooms' && (Number(s.quantity) || 0) === 0) return 'Studio';
    return this.getServiceName(this.selectedOrder, i, 0);
  }

  getExtraServiceName(order: Order | null, i: number, row: { orderExtraServiceId?: number | null; extraServiceId?: number }): string {
    const orderId = row.orderExtraServiceId ?? 0;
    if (orderId === 0 && row.extraServiceId != null) {
      const ex = this.editOrderAvailableExtras.find(x => x.id === row.extraServiceId);
      return ex?.name ?? 'Extra #' + row.extraServiceId;
    }
    const e = (order?.extraServices ?? []).find(x => x.id === orderId) ?? (order?.extraServices ?? [])[i];
    return e?.extraServiceName ?? '#' + orderId;
  }

  getEditOrderServiceType(): ServiceType | null {
    const stId = this.selectedOrder?.serviceTypeId;
    if (stId == null) return null;
    return this.serviceTypesCache.find(s => s.id === stId) ?? null;
  }

  getEditServiceDefinition(index: number): Service | null {
    const orderService = this.selectedOrder?.services?.[index];
    if (!orderService) return null;
    const st = this.getEditOrderServiceType();
    return st?.services?.find(s => s.id === orderService.serviceId) ?? null;
  }

  /**
   * Included square feet for a bedroom count, read from the Sq.ft service's configured
   * allowances — the same data that drives billing everywhere else. Falls back to the shared
   * defaults when the service type hasn't loaded.
   */
  private getEditSquareFeetForBedrooms(bedroomsQty: number): number {
    const st = this.getEditOrderServiceType();
    const sqftDef = st?.services?.find(s => s.serviceKey === 'sqft');
    const bedroomsDef = st?.services?.find(s => s.serviceKey === 'bedrooms');
    return getSquareFeetForBedrooms(bedroomsQty, sqftDef?.thresholds, bedroomsDef?.id);
  }

  getEditExtraDefinition(row: { orderExtraServiceId?: number | null; extraServiceId?: number }, _index: number): ExtraService | null {
    const orderId = row.orderExtraServiceId ?? 0;
    let extraId: number | undefined;
    if (orderId !== 0) {
      const oes = this.selectedOrder?.extraServices?.find(x => x.id === orderId);
      extraId = oes?.extraServiceId;
    } else {
      extraId = row.extraServiceId;
    }
    if (extraId == null) return null;
    return this.editOrderAvailableExtras.find(x => x.id === extraId) ?? null;
  }

  /**
   * Per-row duration shown in the edit form. Routed through the shared display helper so a row's
   * minutes match what the same selection contributes to the total — a linear timeDuration x
   * quantity here would disagree with the tiered figure for sqft.
   */
  getEditServiceDurationMin(s: { quantity: number }, index: number): number {
    const def = this.getEditServiceDefinition(index);
    if (!def) return 0;

    const allSelected = (this.editOrderForm.services ?? [])
      .map((row, i) => {
        const definition = this.getEditServiceDefinition(i);
        return definition ? { service: definition, quantity: Number(row.quantity) || 0 } : null;
      })
      .filter((entry): entry is { service: Service; quantity: number } => entry !== null);

    return getServiceDisplayDuration(def, Number(s.quantity) || 0, 1, allSelected);
  }

  /** Display duration for a service row. When catalog timeDuration is 0 (e.g. Cleaners), show order total. */
  getEditServiceDurationMinDisplay(s: { quantity: number }, index: number): number {
    const def = this.getEditServiceDefinition(index);
    if (!def) return 0;
    if (def.serviceKey === 'bedrooms' && (Number(s.quantity) || 0) === 0) return 20;
    const q = Number(s.quantity) || 0;
    if ((def.timeDuration === 0 || def.serviceKey === 'cleaners' || def.serviceKey === 'hours') && q > 0) {
      return Number(this.editOrderForm?.totalDuration) || 0;
    }
    return def.timeDuration * q;
  }

  /** Whether this service row should show an editable Hours field (cleaner + hours pricing). */
  getEditServiceShowsHours(index: number): boolean {
    const def = this.getEditServiceDefinition(index);
    if (!def) return false;
    return def.serviceRelationType === 'cleaner' || def.serviceRelationType === 'hours' ||
      def.serviceKey === 'cleaners' || def.serviceKey === 'hours';
  }

  /** True when this row is the "hours" row only (show — for Qty, Hours input holds the value). */
  getEditServiceIsHoursOnlyRow(index: number): boolean {
    const def = this.getEditServiceDefinition(index);
    if (!def) return false;
    return def.serviceRelationType === 'hours' || def.serviceKey === 'hours';
  }

  /** Hours value for this service row. For 'hours' row = quantity; for 'cleaner' = hours row qty or totalDuration/60. */
  getEditServiceHours(index: number): number {
    const def = this.getEditServiceDefinition(index);
    const services = this.editOrderForm?.services ?? [];
    if (!def || index >= services.length) return 0;
    if (def.serviceRelationType === 'hours' || def.serviceKey === 'hours') {
      return Number(services[index].quantity) || 0;
    }
    if (def.serviceRelationType === 'cleaner' || def.serviceKey === 'cleaners') {
      const hoursRowIndex = this.getEditHoursRowIndex();
      if (hoursRowIndex >= 0 && hoursRowIndex < services.length) {
        return Number(services[hoursRowIndex].quantity) || 0;
      }
      return Math.round((Number(this.editOrderForm?.totalDuration) || 0) / 60 * 10) / 10;
    }
    return 0;
  }

  /**
   * Hours to price a cleaner line with when the order carries no hours row — which is always,
   * since hours lines are folded into the cleaner line and never persisted. The edit form's
   * totalDuration is the live value here: it is per-cleaner minutes for cleaner+hours service
   * types, and onEditServiceHoursChange writes hours x 60 into it whenever the admin edits Hours.
   *
   * Orders that are not cleaner+hours also return a value here; the adapter discards it, because
   * it only ever synthesises an hours line for a quote that already contains a cleaner line.
   */
  private getEditFallbackHours(): number {
    if (this.getEditHoursRowIndex() >= 0) return 0; // a real hours row is already in the quote
    const minutes = Number(this.editOrderForm?.totalDuration) || 0;
    return minutes > 0 ? minutes / 60 : 0;
  }

  /** Index of the 'hours' service row for the current order's service type, or -1. */
  private getEditHoursRowIndex(): number {
    const orderServices = this.selectedOrder?.services ?? [];
    const st = this.getEditOrderServiceType();
    if (!st) return -1;
    for (let i = 0; i < orderServices.length; i++) {
      const def = st.services?.find(s => s.id === orderServices[i].serviceId);
      if (def?.serviceRelationType === 'hours' || def?.serviceKey === 'hours') return i;
    }
    return -1;
  }

  /** Index of the 'cleaner' service row for the current order's service type, or -1. */
  private getEditCleanerRowIndex(): number {
    const orderServices = this.selectedOrder?.services ?? [];
    const st = this.getEditOrderServiceType();
    if (!st) return -1;
    for (let i = 0; i < orderServices.length; i++) {
      const def = st.services?.find(s => s.id === orderServices[i].serviceId);
      if (def?.serviceRelationType === 'cleaner' || def?.serviceKey === 'cleaners') return i;
    }
    return -1;
  }

  /** When user changes hours for a cleaner/hours row: update totalDuration, cost, and hours row quantity. */
  onEditServiceHoursChange(index: number, value: number): void {
    const hours = Math.max(0.5, Math.min(24, Number(value) || 0));
    const services = this.editOrderForm?.services ?? [];
    const st = this.getEditOrderServiceType();
    const def = this.getEditServiceDefinition(index);
    if (!def || !st || index >= services.length) return;

    const priceMultiplier = Number((this.selectedOrder?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
    const cleanerIdx = this.getEditCleanerRowIndex();
    const hoursIdx = this.getEditHoursRowIndex();

    this.editOrderForm.totalDuration = Math.round(hours * 60);
    if (hoursIdx >= 0 && hoursIdx < services.length) {
      services[hoursIdx].quantity = Math.round(hours * 2) / 2; // allow 0.5 steps
    }
    if (cleanerIdx >= 0 && cleanerIdx < services.length) {
      const cleanerDef = this.getEditServiceDefinition(cleanerIdx);
      const cleanersQty = Number(services[cleanerIdx].quantity) || 0;
      if (cleanerDef && cleanersQty > 0) {
        const rate = (cleanerDef.cost ?? 0) * priceMultiplier;
        services[cleanerIdx].cost = Math.round(rate * cleanersQty * hours * 100) / 100;
      }
    }
    this.recalcSubtotalFromServicesAndExtras();
  }

  /** True if this extra uses hours (show only Hrs input); false = uses quantity (show only Qty input). */
  getEditExtraHasHours(e: { orderExtraServiceId?: number | null; extraServiceId?: number }, index: number): boolean {
    return this.getEditExtraDefinition(e, index)?.hasHours ?? false;
  }

  getEditExtraDurationMin(e: { orderExtraServiceId?: number | null; extraServiceId?: number; quantity?: number; hours?: number }, index: number): number {
    const def = this.getEditExtraDefinition(e, index);
    if (!def) return 0;
    const q = Number(e.quantity) || 0;
    const h = Number(e.hours) || 0;
    if (def.hasHours) return Math.round(def.duration * h);
    if (def.hasQuantity) return def.duration * q;
    return def.duration;
  }

  formatEditDuration(minutes: number): string {
    return DurationUtils.formatDurationRounded(Number(minutes) || 0);
  }

  /** The per-cleaner duration an admin sees, straight from the shared calculator so the
   *  label always matches the salary it explains — the split rounds DOWN (see
   *  calculatePerCleanerBillableMinutes), so it must NOT be re-rounded for display. */
  getPerCleanerDurationText(totalDuration: number, maidsCount: number, hasCleanerService: boolean): string {
    return DurationUtils.formatMinutes(
      calculatePerCleanerBillableMinutes(Number(totalDuration) || 0, Number(maidsCount) || 1, hasCleanerService)
    );
  }

  /** Hint text shown next to the "Duration (min)" input in the edit form.
   *  Cleaner-hours orders store TotalDuration per-cleaner, so it's shown as-is;
   *  everything else stores the TOTAL, shown as "X total" plus the per-cleaner
   *  split once the admin has set more than one maid. */
  getEditDurationHintText(): string {
    const totalDuration = Number(this.editOrderForm?.totalDuration ?? 0) || 0;
    const maidsCount = Number(this.editOrderForm?.maidsCount ?? 1) || 1;
    const hasCleaners = this.selectedOrder?.hasCleanersService ?? false;
    if (hasCleaners) {
      return `${DurationUtils.formatDurationRounded(totalDuration)} per maid`;
    }
    const total = `${DurationUtils.formatDurationRounded(totalDuration)} total`;
    return maidsCount > 1
      ? `${total} · ${this.getPerCleanerDurationText(totalDuration, maidsCount, false)} per cleaner`
      : total;
  }

  private readonly floorTypeDisplayNames: { [key: string]: string } = {
    'hardwood': 'Hardwood',
    'engineered-wood': 'Engineered Wood',
    'laminate': 'Laminate',
    'vinyl': 'Vinyl (LVP/LVT)',
    'tile': 'Tile (Ceramic/Porcelain)',
    'natural-stone': 'Natural Stone (Marble/Granite)',
    'carpet': 'Carpet',
    'concrete': 'Concrete',
    'other': 'Other'
  };

  formatFloorTypes(floorTypes: string | null | undefined, floorTypeOther?: string | null): string {
    if (!floorTypes) return 'Not specified';
    return floorTypes.split(',').map(t => {
      const trimmed = t.trim();
      if (trimmed.startsWith('other:')) {
        const customText = trimmed.substring(6).trim();
        return customText ? `Other (${customText})` : 'Other';
      }
      if (trimmed === 'other') {
        return floorTypeOther ? `Other (${floorTypeOther})` : 'Other';
      }
      return this.floorTypeDisplayNames[trimmed] || trimmed;
    }).join(', ');
  }

  parseFloorTypesForEdit(floorTypes: string | null | undefined, floorTypeOther?: string | null): { types: string[], otherText: string } {
    if (!floorTypes) return { types: [], otherText: '' };
    const types: string[] = [];
    let otherText = floorTypeOther || '';
    floorTypes.split(',').forEach(t => {
      const trimmed = t.trim();
      if (trimmed.startsWith('other:')) {
        types.push('other');
        otherText = trimmed.substring(6).trim();
      } else {
        types.push(trimmed);
      }
    });
    return { types, otherText };
  }

  /** Floor-type option values in display order (labels come from floorTypeDisplayNames). */
  readonly floorTypeOptionValues: string[] = [
    'hardwood', 'engineered-wood', 'laminate', 'vinyl', 'tile',
    'natural-stone', 'carpet', 'concrete', 'other'
  ];

  getFloorTypeLabel(value: string): string {
    return this.floorTypeDisplayNames[value] || value;
  }

  /** Options not yet selected — drives the "+ Add floor type" dropdown (extra-services style). */
  getFloorTypesToAdd(): { value: string; label: string }[] {
    return this.floorTypeOptionValues
      .filter(v => !this.editFloorTypes.includes(v))
      .map(v => ({ value: v, label: this.getFloorTypeLabel(v) }));
  }

  addEditFloorType(value: string): void {
    if (!value || this.editFloorTypes.includes(value)) return;
    this.editFloorTypes = [...this.editFloorTypes, value];
    this.emitEditFloorTypeChange();
  }

  removeEditFloorType(value: string): void {
    this.editFloorTypes = this.editFloorTypes.filter(v => v !== value);
    if (value === 'other') this.editFloorTypeOther = '';
    this.emitEditFloorTypeChange();
  }

  onEditFloorTypeOtherChange(): void {
    this.emitEditFloorTypeChange();
  }

  private emitEditFloorTypeChange(): void {
    this.onEditFloorTypeChange({ types: [...this.editFloorTypes], otherText: this.editFloorTypeOther });
  }

  onEditFloorTypeChange(selection: FloorTypeSelection): void {
    this.editFloorTypes = selection.types;
    this.editFloorTypeOther = selection.otherText;
    // Update the editOrderForm
    if (selection.types.length === 0) {
      this.editOrderForm.floorTypes = null;
      this.editOrderForm.floorTypeOther = null;
    } else {
      this.editOrderForm.floorTypes = selection.types.map(t => {
        if (t === 'other' && selection.otherText) return `other:${selection.otherText}`;
        return t;
      }).join(',');
      this.editOrderForm.floorTypeOther = selection.otherText || null;
    }
  }

  /** Return YYYY-MM-DD for order service date without timezone shift (e.g. 22 stays 22). */
  getOrderServiceDateString(serviceDate: any): string {
    if (serviceDate == null) return '';
    if (typeof serviceDate === 'string') {
      if (serviceDate.includes('T')) return serviceDate.split('T')[0];
      return serviceDate;
    }
    const d = new Date(serviceDate);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  startEditOrder(): void {
    if (!this.selectedOrder || !this.canEditOrder) return;
    // Load service types synchronously if cached, otherwise async — we apply the custom-mode duration
    // multiplier in a callback once the cache is populated.
    this.loadServiceTypesForEdit(() => this.applyCustomModeDurationOnOpen());
    const dateStr = this.getOrderServiceDateString(this.selectedOrder.serviceDate);
    let timeStr = '';
    if (this.selectedOrder.serviceTime) {
      const t = String(this.selectedOrder.serviceTime);
      if (t.includes(':')) timeStr = t.slice(0, 5);
      else timeStr = t;
    }
    this.editOrderForm = {
      contactFirstName: this.selectedOrder.contactFirstName,
      contactLastName: this.selectedOrder.contactLastName,
      contactEmail: this.selectedOrder.contactEmail,
      contactPhone: normalizePhone10(this.selectedOrder.contactPhone) ?? this.selectedOrder.contactPhone,
      serviceAddress: this.selectedOrder.serviceAddress,
      aptSuite: this.selectedOrder.aptSuite ?? null,
      city: this.selectedOrder.city,
      state: this.selectedOrder.state,
      zipCode: this.selectedOrder.zipCode,
      serviceDate: dateStr,
      serviceTime: timeStr || null,
      maidsCount: this.selectedOrder.maidsCount,
      totalDuration: this.selectedOrder.totalDuration,
      bedroomsQuantity: this.selectedOrder.bedroomsQuantity ?? null,
      bathroomsQuantity: this.selectedOrder.bathroomsQuantity ?? null,
      // Null on a legacy order and left null unless the admin picks one, because null means
      // "no change" on the SuperAdmin update path - an admin editing the service date must not
      // silently stamp a property type onto an order that never had one.
      propertyType: normalizePropertyType((this.selectedOrder as any).propertyType),
      levelsQuantity: (this.selectedOrder as any).levelsQuantity ?? null,
      entryMethod: this.selectedOrder.entryMethod ?? null,
      specialInstructions: this.selectedOrder.specialInstructions ?? null,
      floorTypes: this.selectedOrder.floorTypes ?? null,
      floorTypeOther: this.selectedOrder.floorTypeOther ?? null,
      tips: this.selectedOrder.tips,
      status: this.selectedOrder.status,
      cancellationReason: this.selectedOrder.cancellationReason ?? null,
      subTotal: this.selectedOrder.subTotal,
      tax: this.selectedOrder.tax,
      total: this.selectedOrder.total,
      discountAmount: this.selectedOrder.discountAmount,
      subscriptionDiscountAmount: (this.selectedOrder as any).subscriptionDiscountAmount ?? 0,
      loyaltyDiscountAmount: this.selectedOrder.loyaltyDiscountAmount ?? 0,
      cleanerHourlyRate: this.selectedOrder.cleanerHourlyRate ?? this.getDefaultHourlyRate(this.selectedOrder.id),
      cleanerTotalSalary: this.selectedOrder.cleanerTotalSalary ?? 0,
      customServiceDisplayName: (this.selectedOrder as any).customServiceDisplayName ?? null,
      services: this.selectedOrder.services?.map(s => ({ orderServiceId: s.id, quantity: s.quantity, cost: s.cost })) ?? null,
      // Include extraServiceId for existing rows too (backend may require it to persist/recognize updates)
      extraServices: this.selectedOrder.extraServices?.map(e => ({
        orderExtraServiceId: e.id,
        extraServiceId: e.extraServiceId,
        quantity: e.quantity,
        hours: e.hours,
        cost: e.cost
      })) ?? null
    };
    this.editingOrder = true;
    // A typed Total belongs to one editing session; recalculateEditPricing below seeds the input.
    this.editOrderTaxOverride = null;
    this.editOrderTotalInput = null;
    const parsed = this.parseFloorTypesForEdit(this.selectedOrder.floorTypes, this.selectedOrder.floorTypeOther);
    this.editFloorTypes = parsed.types;
    this.editFloorTypeOther = parsed.otherText;
    this.editOrderFormOriginalSubTotal = this.selectedOrder.subTotal;
    this.editOrderFormOriginalDiscount = this.selectedOrder.discountAmount;
    this.editOrderFormOriginalSubscriptionDiscount = (this.selectedOrder as any).subscriptionDiscountAmount ?? 0;
    this.editOrderFormOriginalLoyaltyDiscount = this.selectedOrder.loyaltyDiscountAmount ?? 0;
    this.editOrderFormOriginalLoyaltyPercentage = this.selectedOrder.loyaltyDiscountPercentage ?? 0;
    this.initEditGiftCard();
    this.editOrderFormPrevServiceQuantities = (this.editOrderForm.services ?? []).map(s => s.quantity);
    this.editOrderFormPrevExtraQuantities = (this.editOrderForm.extraServices ?? []).map(e => e.quantity);
    this.editOrderFormPrevExtraHours = (this.editOrderForm.extraServices ?? []).map(e => e.hours);
    // Apply custom-mode multiplier immediately if cache is already loaded; otherwise the loadServiceTypesForEdit
    // callback will do it once the cache arrives.
    this.applyCustomModeDurationOnOpen();
    this.recalculateEditPricing();
    // Do not recalc duration/maids on open: preserve order's actual totalDuration and maidsCount
    // (e.g. custom 3h). recalcEditDurationAndMaids runs when user changes service/extra qty.
  }

  /**
   * For Custom Pricing mode orders, the DB stores totalDuration as per-cleaner minutes (same as booking).
   * Custom Pricing now stores TotalDuration as TOTAL across all maids (matching non-custom);
   * still recompute salary on open so any stale stored cleanerTotalSalary is corrected on display.
   */
  private applyCustomModeDurationOnOpen(): void {
    if (!this.editingOrder || !this.selectedOrder) return;
    if (!this.isCustomModeOrder()) return;
    this.recalcCleanerTotalSalary();
  }

  private loadServiceTypesForEdit(onLoaded?: () => void): void {
    const stId = this.selectedOrder?.serviceTypeId;
    if (stId == null) return;
    if (this.serviceTypesCache.length > 0) {
      this.setEditOrderAvailableExtras(stId);
      onLoaded?.();
      return;
    }
    this.bookingService.getServiceTypes().subscribe({
      next: (list) => {
        this.serviceTypesCache = list;
        this.setEditOrderAvailableExtras(stId);
        // Do not recalc duration here when edit form is open: preserve order's totalDuration/maids
        onLoaded?.();
      },
      error: () => this.editOrderAvailableExtras = []
    });
  }

  private setEditOrderAvailableExtras(serviceTypeId: number): void {
    const st = this.serviceTypesCache.find(s => s.id === serviceTypeId);
    this.editOrderAvailableExtras = st?.extraServices?.filter(x => x.isActive) ?? [];
  }

  /** Extras that can be added (not already in the form). */
  getEditOrderExtrasToAdd(): ExtraService[] {
    const existing = new Set<number>();
    for (const e of this.editOrderForm.extraServices ?? []) {
      const orderId = e.orderExtraServiceId ?? 0;
      if (orderId !== 0) {
        const oes = this.selectedOrder?.extraServices?.find(x => x.id === orderId);
        if (oes) existing.add(oes.extraServiceId);
      } else if (e.extraServiceId != null) {
        existing.add(e.extraServiceId);
      }
    }
    return this.editOrderAvailableExtras.filter(x => !existing.has(x.id));
  }

  addEditExtraService(extra: ExtraService): void {
    const list = this.editOrderForm.extraServices ?? [];
    const hours = extra.hasHours ? 1 : 0;
    // Custom Pricing ("Pre-Arranged") orders: extras are informational only. The admin-entered
    // amount and duration are the whole quote, so the row is priced at $0 — same rule the shared
    // calculator applies on the booking side (AddInformationalExtraLines).
    const cost = this.isCustomModeOrder()
      ? 0
      : (extra.hasHours ? extra.price * hours : extra.price * 1);
    list.push({
      orderExtraServiceId: 0,
      extraServiceId: extra.id,
      quantity: 1,
      hours,
      cost: Math.round(cost * 100) / 100
    });
    this.editOrderForm.extraServices = list;
    this.editOrderFormPrevExtraQuantities.push(1);
    this.editOrderFormPrevExtraHours.push(hours);
    this.recalcSubtotalFromServicesAndExtras();
  }

  onAddExtraServiceChange(value: string): void {
    const id = parseInt(value, 10);
    if (!value || isNaN(id)) return;
    const extra = this.editOrderAvailableExtras.find(x => x.id === id);
    if (extra) this.addEditExtraService(extra);
  }

  /**
   * Recalculate Tax + Total through the shared calculator. When subTotal changes, apply the
   * discount ratio so discount scales with subtotal (loyalty scales by its locked percentage
   * snapshot instead — preserves the "this order had 10% loyalty" historical truth).
   */
  /** Load the order's gift card (if any) so an edited total can re-draw from leftover balance.
   *  availableBalance = the card's current remaining balance + what this order already used. */
  private initEditGiftCard(): void {
    const code = (this.selectedOrder as any)?.giftCardCode ?? null;
    const used = Number((this.selectedOrder as any)?.giftCardAmountUsed ?? 0) || 0;
    this.editGiftCardCode = code;
    this.editGiftCardOriginalUsed = used;
    this.editGiftCardAmountToUse = used;
    this.editGiftCardAvailableBalance = 0;

    if (!code || used <= 0) return;

    this.bookingService.validatePromoCode(code).subscribe({
      next: (validation: any) => {
        if (validation?.isValid && validation?.isGiftCard) {
          // availableBalance from the API is the card's CURRENT remaining balance; add back what
          // this order already consumed so the edit can re-draw up to the full balance.
          this.editGiftCardAvailableBalance = (Number(validation.availableBalance) || 0) + used;
          this.recalculateEditPricing();
        }
      },
      error: () => { /* keep the fixed original amount if the lookup fails */ }
    });
  }

  /**
   * @param rederiveDiscountsFromSubTotal Re-scale the discounts to the current subtotal. ONLY
   * recalcSubtotalFromServicesAndExtras passes true — it is the single place the subtotal is
   * recomputed from services/extras, so it is the only caller for which the recorded discounts
   * are stale.
   *
   * This used to be inferred from `subTotal !== editOrderFormOriginalSubTotal`, which was wrong
   * in both directions. The re-scale writes back to editOrderForm.discountAmount, the same field
   * read at the top of this method, so once the subtotal returned to its original value the
   * comparison went false, the re-scale was skipped, and the PREVIOUS step's discount survived —
   * bathrooms 2→1→2 left a 20% promo at 108.10 on a 563.00 subtotal instead of 112.60, one step
   * behind. Re-scaling unconditionally instead would have been worse: the Discount field is
   * admin-editable and calls this method on every keystroke, so a hand-typed amount would be
   * overwritten as fast as it was entered.
   *
   * The resulting rule, which is the intended one: the ratio is the authority once the subtotal
   * moves, and a hand-typed discount survives exactly as long as the subtotal does not.
   */
  /**
   * Bubble points and reward credit are FIXED amounts already granted on the order, so the field
   * simply adds them back before splitting — see editCreditsHeldOffTheTotal. Discounts are handled
   * too, and are not a reason to block anything: they are the whole point of the feature.
   *
   * A GIFT CARD is the one exception, because its draw is `min(balance, totalBeforeGiftCard)` —
   * a function of the very subtotal we would be solving for. Where the balance does not cover the
   * order that is still invertible, but where it does, "what the customer pays" and "what the
   * service costs" come apart and a typed figure has two equally valid readings (raise the service
   * price so the customer pays it, or price the service at it and let the card absorb it). Rather
   * than guess, the field stays read-only for the gift-card case alone.
   */
  canEditTotalDirectly(): boolean {
    if (!this.editingOrder || !this.selectedOrder) return false;
    return this.editGiftCardAmountToUse <= 0 && this.editGiftCardOriginalUsed <= 0;
  }

  /**
   * Credits subtracted AFTER tax that the Total input therefore hides: bubble points and reward
   * balance. Both are fixed grants recorded on the order — nothing about them depends on the
   * total, which is exactly why they can be inverted and a gift card cannot.
   */
  private editCreditsHeldOffTheTotal(): number {
    if (!this.selectedOrder) return 0;
    return (Number((this.selectedOrder as any).pointsRedeemedDiscount ?? 0) || 0)
      + (Number((this.selectedOrder as any).rewardBalanceUsed ?? 0) || 0);
  }

  /**
   * The admin typed a Total. Treat it as what the CUSTOMER PAYS — tax included, discounts applied,
   * credits already deducted, tips excluded — and work backwards:
   *
   *   typed + credits   -> the amount owed before bubble points / reward balance come off, which
   *                        is the figure the tax actually lives inside
   *   solve             -> the subtotal AND the re-scaled discounts behind it
   *
   * The discounts scale exactly as they do when the SubTotal field is edited - a 25% promo stays
   * 25% - which makes the solve circular, so the algebra lives written out in its own module:
   * shared/pricing/admin-total-solve.ts.
   *
   * The split tax rides along as an override because re-deriving it as
   * `round2(discountedSubTotal × rate)` drifts a cent on roughly one amount in twenty — the same
   * reason Custom Pricing carries one (see splitTaxInclusiveAmount).
   */
  onEditTotalChange(): void {
    if (!this.editingOrder || !this.canEditTotalDirectly()) return;

    const typed = Number(this.editOrderTotalInput ?? 0) || 0;
    if (typed <= 0) {
      // Cleared or zeroed: nothing to hold on to, so hand pricing back to the subtotal.
      this.editOrderTaxOverride = null;
      this.editOrderForm.subTotal = 0;
      this.recalculateEditPricing();
      return;
    }

    const solved = solveSubTotalForTypedTotal(
      round2(typed + this.editCreditsHeldOffTheTotal()),
      {
        originalSubTotal: this.editOrderFormOriginalSubTotal,
        originalDiscount: this.editOrderFormOriginalDiscount,
        originalSubscriptionDiscount: this.editOrderFormOriginalSubscriptionDiscount,
        loyaltyPercentage: this.editOrderFormOriginalLoyaltyPercentage
      },
      {
        discountAmount: Number(this.editOrderForm.discountAmount ?? 0) || 0,
        subscriptionDiscountAmount: Number(this.editOrderForm.subscriptionDiscountAmount ?? 0) || 0,
        loyaltyDiscountAmount: Number(this.editOrderForm.loyaltyDiscountAmount ?? 0) || 0
      });

    this.editOrderTaxOverride = { tax: solved.tax, base: solved.discountedSubTotal };
    this.editOrderForm.subTotal = solved.subTotal;
    this.editOrderForm.discountAmount = solved.discountAmount;
    this.editOrderForm.subscriptionDiscountAmount = solved.subscriptionDiscountAmount;
    this.editOrderForm.loyaltyDiscountAmount = solved.loyaltyDiscountAmount;
    // Deliberately NOT rederiveDiscountsFromSubTotal: the solve above already scaled them, and
    // re-scaling from the subtotal it produced would chase its own tail.
    this.recalculateEditPricing();
  }

  /**
   * Anything that moves the subtotal or a discount invalidates a typed Total — the figure no
   * longer describes what is owed, so pricing goes back to subtotal + rate math. Tips are
   * excluded on purpose: they sit outside the taxed amount, so they cannot invalidate it.
   */
  private clearEditTotalOverride(): void {
    this.editOrderTaxOverride = null;
  }

  /** SubTotal input: typing a subtotal is the opposite intent, so it drops a typed Total. */
  onEditSubTotalChange(): void {
    this.clearEditTotalOverride();
    this.recalculateEditPricing(true);
  }

  /** Discount inputs: they move the amount being taxed, so a typed Total no longer holds. */
  onEditDiscountChange(): void {
    this.clearEditTotalOverride();
    this.recalculateEditPricing();
  }

  recalculateEditPricing(rederiveDiscountsFromSubTotal = false): void {
    if (!this.selectedOrder || !this.editingOrder) return;

    let subTotal = Number(this.editOrderForm.subTotal ?? 0) || 0;
    let discountAmount = Number(this.editOrderForm.discountAmount ?? 0) || 0;
    let subscriptionDiscountAmount = Number(this.editOrderForm.subscriptionDiscountAmount ?? 0) || 0;
    let loyaltyDiscountAmount = Number(this.editOrderForm.loyaltyDiscountAmount ?? 0) || 0;

    if (this.editOrderFormOriginalSubTotal > 0 && rederiveDiscountsFromSubTotal) {
      // Derived from the ORIGINAL snapshot every time, never from the current value — that is
      // what makes a round trip land back on the exact starting numbers.
      discountAmount = rescaleDiscountToSubTotal(
        this.editOrderFormOriginalDiscount, this.editOrderFormOriginalSubTotal, subTotal);
      subscriptionDiscountAmount = rescaleDiscountToSubTotal(
        this.editOrderFormOriginalSubscriptionDiscount, this.editOrderFormOriginalSubTotal, subTotal);
      if (this.editOrderFormOriginalLoyaltyPercentage > 0) {
        // Loyalty locks a PERCENTAGE at booking time, so it scales off that, not off a ratio.
        loyaltyDiscountAmount = round2(subTotal * (this.editOrderFormOriginalLoyaltyPercentage / 100));
      }
      this.editOrderForm.discountAmount = discountAmount;
      this.editOrderForm.subscriptionDiscountAmount = subscriptionDiscountAmount;
      this.editOrderForm.loyaltyDiscountAmount = loyaltyDiscountAmount;
    }

    const tips = Number(this.editOrderForm.tips ?? 0) || 0;
    // Retired field, read straight off the saved order and never editable. A legacy order that
    // carries one still had it in the total the customer paid, so the preview must keep counting
    // it or opening and saving an untouched old order would look like a price drop.
    const companyTips = this.legacyCompanyDevelopmentTips;

    const pointsRedeemedDiscount = Number((this.selectedOrder as any).pointsRedeemedDiscount ?? 0) || 0;
    const rewardBalanceUsed = Number((this.selectedOrder as any).rewardBalanceUsed ?? 0) || 0;

    // Tips are included so the preview matches what the backend persists on save
    // (SuperAdminFullUpdateOrder recomputes Total with tips through the same calculator).
    // Gift card is applied AFTER, re-resolved against the live balance so an increased total
    // draws additional funds from any leftover gift-card balance (mirrors ApplyEditGiftCardAsync).
    const totals = calculateTotals({
      subTotal,
      discountAmount,
      subscriptionDiscountAmount,
      loyaltyDiscountAmount,
      tips,
      companyDevelopmentTips: companyTips,
      pointsRedeemedDiscount,
      rewardBalanceUsed,
      // Present only while a typed Total is in force. The base is the discounted subtotal it was
      // split from, so if a discount has moved since, calculateTotals ignores it by itself.
      taxOverride: this.editOrderTaxOverride?.tax ?? null,
      taxOverrideBase: this.editOrderTaxOverride?.base ?? null
    });

    // Re-resolve the gift card: draw up to min(availableBalance, totalBeforeGiftCard). Falls back
    // to the original fixed amount until the balance lookup (initEditGiftCard) resolves.
    const giftCardAmountToUse = this.editGiftCardAvailableBalance > 0
      ? resolveGiftCardAmountToUse(this.editGiftCardAvailableBalance, totals.totalBeforeGiftCard)
      : this.editGiftCardOriginalUsed;
    this.editGiftCardAmountToUse = giftCardAmountToUse;

    this.editOrderForm.tax = totals.tax;
    this.editOrderForm.total = round2(Math.max(0,
      totals.totalBeforeGiftCard - giftCardAmountToUse - pointsRedeemedDiscount - rewardBalanceUsed));

    // Mirror the derived figure back into the Total input, so it tracks every other edit and a
    // typed value round-trips to itself (with no credits, tip-free total === discounted + tax).
    this.editOrderTotalInput = this.getSummaryTotalWithoutTips();

    const base = totals.total - totals.tax - tips - companyTips;
    this.editEstimatedPoints = this.pointsEnabled && this.pointsPerDollar > 0
      ? Math.floor(Math.max(0, base) * this.pointsPerDollar)
      : 0;
  }

  /** Recompute subtotal from base price + the stored per-line costs (which the backend
   *  writes from the shared calculator). */
  /**
   * Prices the current edit-form state through the SHARED calculator — the same path the
   * booking page and customer order edit use — so included allowances, rate tiers and the
   * service type's minimum price all apply.
   *
   * Returns null ONLY for custom ("Pre-Arranged") orders, where the admin sets the amount and
   * duration by hand. That matches the shared calculator itself, whose custom-pricing branch
   * returns before the services loop and before the minimum-price floor. The caller leaves the
   * subtotal ALONE in that case — see recalcSubtotalFromServicesAndExtras.
   *
   * Cleaner+hours orders DO get a quote, and getEditFallbackHours() supplies the hours the order
   * never persisted so their cleaner line is actually priced. Without it the calculator's cleaner
   * branch found no paired hours line, left that line at $0, and the subtotal collapsed to the
   * extras alone (order #305: $345 -> $165) — a number SuperAdminFullUpdateOrder then persists
   * verbatim.
   */
  private buildEditQuote(): { quote: QuoteResult; serviceRowIndices: number[]; extraRowIndices: number[] } | null {
    if (this.isCustomModeOrder()) return null;

    const st = this.getEditOrderServiceType();
    if (!st) return null;

    const built = buildAdminEditQuoteInput(
      st,
      (this.editOrderForm.services ?? []).map((row, index) => ({
        row, definition: this.getEditServiceDefinition(index)
      })),
      (this.editOrderForm.extraServices ?? []).map((row, index) => ({
        row, definition: this.getEditExtraDefinition(row, index)
      })),
      this.getEditFallbackHours()
    );
    if (!built) return null;

    return {
      quote: calculateQuote(built.input),
      serviceRowIndices: built.serviceRowIndices,
      extraRowIndices: built.extraRowIndices
    };
  }

  recalcSubtotalFromServicesAndExtras(): void {
    // The subtotal is about to be rebuilt from the lines, which is precisely what a typed Total
    // was overriding.
    this.clearEditTotalOverride();
    const built = this.buildEditQuote();

    if (built) {
      // Per-line costs come from the tiered calculation. Two lines are deliberately not written
      // back: an hours line (shouldAddToOrder = false — its cost is folded into the cleaner line,
      // so writing it back would blank a row the admin is looking at) and the synthetic hours line
      // buildAdminEditQuoteInput appends, which has no originating row at all.
      built.quote.serviceLines.forEach((line, i) => {
        if (!line.shouldAddToOrder) return;
        const rowIndex = built.serviceRowIndices[i];
        if (rowIndex == null) return;
        const row = this.editOrderForm.services?.[rowIndex];
        if (row) row.cost = round2(line.cost);
      });
      built.quote.extraServiceLines.forEach((line, i) => {
        const row = this.editOrderForm.extraServices?.[built.extraRowIndices[i]];
        if (row) row.cost = round2(line.cost);
      });

      // The subtotal ALWAYS comes from the quote, including for cleaner+hours, so it carries the
      // MinimumPrice floor and any tiered service cost. This value is what the admin sees AND
      // what gets posted as dto.SubTotal — the SuperAdmin save path persists it verbatim.
      this.editOrderForm.subTotal = built.quote.subTotal;
    } else if (!this.isCustomModeOrder()) {
      // No quote available (service type missing from the cache): sum the rows as before.
      const st = this.getEditOrderServiceType();
      const priceMultiplier = Number((this.selectedOrder?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
      let sum = (Number(st?.basePrice ?? 0) || 0) * priceMultiplier;
      (this.editOrderForm.services ?? []).forEach(s => { sum += Number(s.cost ?? 0) || 0; });
      (this.editOrderForm.extraServices ?? []).forEach(e => { sum += Number(e.cost ?? 0) || 0; });
      this.editOrderForm.subTotal = round2(sum);
    }
    // Custom ("Pre-Arranged") orders deliberately fall through with subTotal untouched: the
    // amount is what the admin agreed with the customer and is edited directly in the SubTotal
    // field. Extras there are informational ($0), so adding or removing one must not move it —
    // the old row-sum fallback rebuilt it from the service type's base price and wiped the
    // agreed amount the moment an extra row changed.

    // The one caller that moved the subtotal, so the one caller that re-scales the discounts.
    this.recalculateEditPricing(true);
    this.recalcEditDurationAndMaids();
    // Salary depends on duration/maids/rate; refresh after duration recalc so adding/removing
    // extras (e.g. Extra Minutes) keeps cleanerTotalSalary in sync with the new totalDuration.
    this.recalcCleanerTotalSalary();
  }

  /** Find the index of the Cleaners row (relation, key, or name fallback). Returns -1 if not present. */
  private findCleanerRowIndexRobust(): number {
    const orderServices = this.selectedOrder?.services ?? [];
    const st = this.getEditOrderServiceType();
    for (let i = 0; i < orderServices.length; i++) {
      const def = st?.services?.find(s => s.id === orderServices[i].serviceId);
      if (def?.serviceRelationType === 'cleaner' || def?.serviceKey === 'cleaners') return i;
      const name = (orderServices[i].serviceName || '').toLowerCase();
      if (name.includes('cleaner')) return i;
    }
    return -1;
  }

  /** Find the index of the Hours row (relation, key, or name fallback). Returns -1 if not present. */
  private findHoursRowIndexRobust(): number {
    const orderServices = this.selectedOrder?.services ?? [];
    const st = this.getEditOrderServiceType();
    for (let i = 0; i < orderServices.length; i++) {
      const def = st?.services?.find(s => s.id === orderServices[i].serviceId);
      if (def?.serviceRelationType === 'hours' || def?.serviceKey === 'hours') return i;
      const name = (orderServices[i].serviceName || '').toLowerCase();
      if (name.includes('hour')) return i;
    }
    return -1;
  }

  /** True when the order's service type uses explicit Cleaners + Hours rows (driven by cleaner count, not duration/6). */
  private isCleanerHoursOrder(): boolean {
    if (this.selectedOrder?.hasCleanersService) return true;
    return this.findCleanerRowIndexRobust() >= 0 && this.findHoursRowIndexRobust() >= 0;
  }

  /** True when the selected order's service type is in Custom Pricing mode (ServiceType.isCustom).
   *  Public because the edit template hides the per-extra Duration/Cost fields on these orders —
   *  their extras are informational only (see addEditExtraService). */
  // ===== Property type (apartment vs house) + levels =====

  readonly propertyTypeApartment = PROPERTY_TYPE_APARTMENT;
  readonly propertyTypeHouse = PROPERTY_TYPE_HOUSE;

  /** One shared exclusion rule for every surface. See property-type.utils. */
  showEditPropertyType(): boolean {
    return serviceTypeCollectsPropertyType(this.getEditOrderServiceType());
  }

  /**
   * Whether the LEVELS row is editable in the Services table.
   *
   * Kept in the ordinary services table on purpose - unlike the customer pages, this panel is a
   * raw row editor, and the Qty stepper on a row named "Levels" IS the admin's level control,
   * repriced through the shared calculator like every other row.
   *
   * Hidden for a non-house so the panel can never show an editable stair charge on an order it
   * simultaneously labels an apartment. Its quantity is forced back to the included level when
   * the property type is switched, so hiding never leaves a charge behind.
   */
  isEditLevelsRowVisible(index: number): boolean {
    const definition = this.getEditServiceDefinition(index);
    // A levels ROW existing already means this order's type prices levels, so no second check on
    // that is needed. It is hidden only when the order is not a house.
    if (!isLevelsService(definition ?? undefined)) return true;
    return isHouse(this.editOrderForm?.propertyType);
  }

  /**
   * True when the order has NO priced levels row, so the level count is informational and the
   * only place to edit it is Order.LevelsQuantity directly.
   *
   * Shown for a house on Office / Custom / Heavy Conditional / Pre-Arranged and anything else
   * without a levels catalogue row. Editing it moves no money, exactly like the existing
   * Bedrooms / Bathrooms informational fields.
   */
  /**
   * Clamps the informational level count as it is typed.
   *
   * The min/max attributes on the input only gate the native spinner arrows and the :invalid
   * pseudo-class - a typed 99 still binds through ngModel, and Angular marks its forms novalidate
   * so there is no native bubble either. Without this an admin typed 99, saw it accepted, and got
   * a 4 back from the server with no explanation.
   *
   * Clamping in the change handler is this panel's existing convention for exactly this problem:
   * see onEditServiceQuantityChange for the sqft minimum and stepEditServiceHours for the
   * 0.5-24 hours range. The value visibly snaps in the box, so the constraint is discoverable.
   *
   * An EMPTY box stays null rather than snapping to 1: null means "no change" on the SuperAdmin
   * update path, so clearing the field leaves whatever the order already had.
   */
  onEditInformationalLevelsChange(): void {
    // Read as unknown: a cleared number input yields '' at runtime even where the field is typed
    // as number | null, so both emptiness shapes have to be handled.
    const raw: unknown = this.editOrderForm?.levelsQuantity;
    if (raw === null || raw === undefined || raw === '') {
      this.editOrderForm.levelsQuantity = null;
      return;
    }

    const parsed = Number(raw);
    if (!isFinite(parsed)) {
      this.editOrderForm.levelsQuantity = null;
      return;
    }

    const max = Math.max(...LEVEL_OPTIONS);
    this.editOrderForm.levelsQuantity = Math.min(Math.max(Math.round(parsed), MIN_LEVELS), max);
  }

  showEditInformationalLevels(): boolean {
    if (!isHouse(this.editOrderForm?.propertyType)) return false;
    return !(this.editOrderForm?.services ?? []).some(
      (_row: any, index: number) => isLevelsService(this.getEditServiceDefinition(index) ?? undefined));
  }

  onEditPropertyTypeChange(): void {
    if (isHouse(this.editOrderForm?.propertyType)) {
      this.recalcSubtotalFromServicesAndExtras();
      this.recalculateEditPricing();
      return;
    }

    // Apartment (or cleared): the stair charge must go with it. Forcing the row to the included
    // level prices it at exactly $0 rather than deleting a row the backend still expects.
    (this.editOrderForm.services ?? []).forEach((row: any, index: number) => {
      if (isLevelsService(this.getEditServiceDefinition(index) ?? undefined)) row.quantity = 1;
    });

    this.recalcSubtotalFromServicesAndExtras();
    this.recalculateEditPricing();
  }

  /** Read-only detail panel: null renders nothing at all, never an empty row. */
  getOrderPropertyTypeLabel(order: any): string | null {
    const normalized = normalizePropertyType(order?.propertyType);
    if (normalized === PROPERTY_TYPE_APARTMENT) return 'Apartment / Condo';
    if (normalized === PROPERTY_TYPE_HOUSE) return 'House / Townhouse';
    return null;
  }

  /** Levels for display; null for apartments and legacy orders. */
  getOrderLevelsLabel(order: any): string | null {
    const levels = levelsToDisplay(order?.propertyType, order?.levelsQuantity);
    if (levels == null) return null;
    return levels === 1 ? '1 level' : `${levels} levels`;
  }

  isCustomModeOrder(): boolean {
    const stId = this.selectedOrder?.serviceTypeId;
    if (stId == null) return false;
    const st = this.serviceTypesCache.find(s => s.id === stId);
    return !!st?.isCustom;
  }

  /** Compute total duration from service type base + all services + extras; maids stays
   *  admin-set except for cleaner-hours types (explicit Cleaners row is authoritative). */
  recalcEditDurationAndMaids(): void {
    // Custom Pricing mode: maids and totalDuration are admin-managed (per-cleaner minutes).
    // Adding/removing extras must not touch either field.
    if (this.isCustomModeOrder()) {
      return;
    }
    const st = this.getEditOrderServiceType();
    const services = this.editOrderForm.services ?? [];

    // If service type uses explicit Cleaners + Hours rows, those drive maids and duration directly.
    // Extras must NOT affect maids count or total duration in this mode (e.g. Vacuum Cleaner with duration 0,
    // and even if an extra has a non-zero duration, it must not change cleaner count or total time here).
    if (this.isCleanerHoursOrder()) {
      const cleanerIdx = this.findCleanerRowIndexRobust();
      const hoursIdx = this.findHoursRowIndexRobust();
      const cleanersQty = (cleanerIdx >= 0 && cleanerIdx < services.length)
        ? (Number(services[cleanerIdx].quantity) || 0) : 0;
      const hoursQty = (hoursIdx >= 0 && hoursIdx < services.length)
        ? (Number(services[hoursIdx].quantity) || 0) : 0;
      if (cleanersQty > 0) {
        this.editOrderForm.maidsCount = cleanersQty;
      }
      if (hoursQty > 0) {
        this.editOrderForm.totalDuration = Math.max(Math.round(hoursQty * 60), 60);
      } else if (!this.editOrderForm.totalDuration) {
        this.editOrderForm.totalDuration = Math.max(Number(this.selectedOrder?.totalDuration) || 60, 60);
      }
      return;
    }

    // Duration comes from the shared calculator so sqft contributes its TIERED minutes over the
    // overage rather than a linear timeDuration x quantity. Falls back to the per-row sum when
    // the quote is unavailable (custom-pricing / cleaner+hours handled above, or catalog not loaded).
    const built = this.buildEditQuote();
    const baseOnly = st?.timeDuration ?? 0;
    let totalMin = baseOnly;
    if (built) {
      totalMin = built.quote.displayDuration;
    } else {
      services.forEach((s, i) => {
        totalMin += this.getEditServiceDurationMin(s, i);
      });
      (this.editOrderForm.extraServices ?? []).forEach((e, i) => {
        totalMin += this.getEditExtraDurationMin(e, i);
      });
    }
    const currentFormDuration = Number(this.editOrderForm.totalDuration) || 0;
    // When services contribute nothing (e.g. custom Cleaners with timeDuration 0), don't overwrite order's duration
    if (totalMin <= baseOnly && currentFormDuration > baseOnly) {
      totalMin = currentFormDuration;
    }
    totalMin = Math.max(Math.round(totalMin), 60);
    this.editOrderForm.totalDuration = totalMin;
    this.updateMaidsFromDuration();
  }

  /** Keeps maids in sync ONLY for service types with explicit Cleaners + Hours rows —
   *  those are authoritative. For everything else the count is a manual admin decision
   *  (auto-staffing from duration is disabled; see AUTO_ADD_CLEANERS_BY_DURATION in the
   *  shared calculator) — getSuggestedMaidsCount() still surfaces the old 1-per-6h math
   *  as a hint next to the field. */
  updateMaidsFromDuration(): void {
    if (this.isCustomModeOrder()) return;
    if (this.isCleanerHoursOrder()) {
      const services = this.editOrderForm.services ?? [];
      const cleanerIdx = this.findCleanerRowIndexRobust();
      const cleanersQty = (cleanerIdx >= 0 && cleanerIdx < services.length)
        ? (Number(services[cleanerIdx].quantity) || 0) : 0;
      if (cleanersQty > 0) {
        this.editOrderForm.maidsCount = cleanersQty;
      }
    }
  }

  /** Advisory 1-per-6h staffing suggestion for admins (regular service types only).
   *  Null when it matches the current count, so the hint only shows when actionable. */
  getSuggestedMaidsCount(): number | null {
    if (this.isCustomModeOrder() || this.isCleanerHoursOrder()) return null;
    const totalMin = Number(this.editOrderForm.totalDuration) || 0;
    if (totalMin <= 0) return null;
    const totalHours = totalMin / 60;
    const suggested = totalHours > 6 ? Math.ceil(totalHours / 6) : 1;
    const current = Number(this.editOrderForm.maidsCount) || 1;
    return suggested === current ? null : suggested;
  }

  /** Same suggestion for the read-only details panel, from the selected order's data. */
  getSuggestedMaidsCountForOrder(order: Order): number | null {
    if (this.isCustomServiceType(order) || this.hasCleanersService()) return null;
    const totalMin = Number(order.totalDuration) || 0;
    if (totalMin <= 0) return null;
    const totalHours = totalMin / 60;
    const suggested = totalHours > 6 ? Math.ceil(totalHours / 6) : 1;
    return suggested === (order.maidsCount || 1) ? null : suggested;
  }

  // ── Staffing-review badge (advisory only) ────────────────────────────────
  // Auto-add-by-duration is disabled, so a long job stays at 1 cleaner until an
  // admin raises the count. These flags warn when the per-cleaner load exceeds
  // 6h (MAX_HOURS_PER_MAID) for regular service types — live-computed, they
  // clear as soon as the admin-set count brings per-cleaner time back under 6h.
  // Cleaner+hours and custom orders are skipped (cleaners × hours is explicit).

  private static staffingReviewNeeded(totalDuration: number, maidsCount: number): boolean {
    const total = Number(totalDuration) || 0;
    const maids = Math.max(1, Number(maidsCount) || 1);
    return total / maids > 6 * 60;
  }

  /** Table-row variant (list DTO carries the flags). Hidden once the order is Done —
   *  the advisory only matters while the job can still be re-staffed. */
  needsStaffingReview(order: AdminOrderList): boolean {
    if (!order || order.hasCleanersService || order.isCustomServiceType) return false;
    if ((order.status || '').toLowerCase() === 'done') return false;
    return OrdersComponent.staffingReviewNeeded(order.totalDuration, order.maidsCount ?? 1);
  }

  /** Detail-panel variant (full OrderDto shapes differ from list rows). */
  needsStaffingReviewForSelected(): boolean {
    const order = this.selectedOrder;
    if (!order || this.hasCleanersService() || this.isCustomServiceType(order)) return false;
    return OrdersComponent.staffingReviewNeeded(order.totalDuration, order.maidsCount || 1);
  }

  /** Edit-form variant, from the live form values (tints the suggested-maids hint). */
  editFormNeedsStaffingReview(): boolean {
    if (this.isCustomModeOrder() || this.isCleanerHoursOrder()) return false;
    return OrdersComponent.staffingReviewNeeded(
      Number(this.editOrderForm?.totalDuration) || 0,
      Number(this.editOrderForm?.maidsCount) || 1);
  }

  onEditDurationChange(): void {
    if (this.isCustomModeOrder()) {
      // Custom mode: admin manages maids manually (don't auto-derive from "1 maid per 6h" rule).
      // Just refresh the salary based on the new TOTAL duration the admin entered.
      this.recalcCleanerTotalSalary();
      return;
    }
    this.updateMaidsFromDuration();
    this.recalcCleanerTotalSalary();
  }

  /** Maids field change handler. Duration is NEVER auto-updated when maids changes — admin
   *  must change duration manually. We just recalc the salary based on the current values. */
  onEditMaidsChange(): void {
    this.recalcCleanerTotalSalary();
  }

  /** Studio (bedrooms = 0) has its own cost like in order-edit. */
  // Studio cost/duration now come from the service's ZeroQuantityCost/ZeroQuantityDuration,
  // falling back to the shared STUDIO_PRICE/STUDIO_DURATION constants. The old local
  // `studioBaseCost = 10` field was removed — it would have kept the admin order editor at $10
  // while the booking page used the configured value.

  onEditServiceQuantityChange(s: { quantity: number; cost: number }, index: number): void {
    let q = Number(s.quantity) || 0;
    const def = this.getEditServiceDefinition(index);
    const isHoursRow = def?.serviceRelationType === 'hours' || def?.serviceKey === 'hours';
    if (isHoursRow) {
      this.onEditServiceHoursChange(index, q);
      return;
    }
    // Editing sqft directly: enforce the minimum for the current bedroom count
    // (same behavior as the booking page and user order edit).
    if (def?.serviceKey === 'sqft') {
      const bedroomsIdx = this.findEditServiceIndexByKey('bedrooms');
      if (bedroomsIdx >= 0) {
        const bedroomsQty = Number(this.editOrderForm.services?.[bedroomsIdx]?.quantity) || 0;
        const minSquareFeet = this.getEditSquareFeetForBedrooms(bedroomsQty);
        if (q < minSquareFeet) {
          q = minSquareFeet;
          s.quantity = minSquareFeet;
        }
      }
    }
    const prevQ = this.editOrderFormPrevServiceQuantities[index] ?? 1;
    const prevCost = Number(s.cost) || 0;
    // Zero-quantity rule (Studio is bedrooms = 0). Duration is handled in
    // getEditServiceDurationMin; both follow the shared calculator's branch order, so an
    // admin-configured value wins over the legacy constant.
    const isZeroQuantityLine = q === 0 &&
      (def?.zeroQuantityCost != null || def?.zeroQuantityDuration != null ||
       def?.serviceKey === 'bedrooms');
    if (isZeroQuantityLine) {
      s.cost = (def?.zeroQuantityCost != null || def?.zeroQuantityDuration != null)
        ? (def?.zeroQuantityCost ?? 0)
        : STUDIO_PRICE;
      this.editOrderFormPrevServiceQuantities[index] = 0;
      // Only a BEDROOMS row drives the Sq.ft linkage. This used to fire for any row that
      // dropped to zero and happened to carry a zero-quantity cost, re-syncing Sq.ft as
      // though the order had become a studio.
      if (def?.serviceKey === 'bedrooms') {
        this.syncEditSqftWithBedrooms(0, prevQ);
      }
      this.recalcSubtotalFromServicesAndExtras();
      return;
    }
    const isCleanerRow = def?.serviceRelationType === 'cleaner' || def?.serviceKey === 'cleaners';
    if (isCleanerRow) {
      const hours = this.getEditServiceHours(index);
      const priceMultiplier = Number((this.selectedOrder?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
      const rate = (def.cost ?? 0) * priceMultiplier;
      s.cost = round2(rate * q * hours);
      this.editOrderFormPrevServiceQuantities[index] = q;
      this.recalcSubtotalFromServicesAndExtras();
      return;
    }
    let unitPrice = def?.cost ?? 0;
    if (prevQ > 0 && prevCost > 0) unitPrice = prevCost / prevQ;
    else if (unitPrice === 0 && this.selectedOrder?.services?.[index]) {
      const os = this.selectedOrder.services[index];
      if (os.quantity > 0 && os.cost > 0) unitPrice = os.cost / os.quantity;
    }
    s.cost = round2(unitPrice * q);
    this.editOrderFormPrevServiceQuantities[index] = q;
    // Bedrooms→sqft linkage (same behavior as the booking page): changing bedrooms moves the
    // Sq.ft row only if it was still sitting on the old bedroom's allowance.
    if (def?.serviceKey === 'bedrooms') {
      this.syncEditSqftWithBedrooms(q, prevQ);
    }
    this.recalcSubtotalFromServicesAndExtras();
  }

  /** Find the index of an edit-form service row by its catalog serviceKey. Returns -1 if absent. */
  private findEditServiceIndexByKey(serviceKey: string): number {
    const rows = this.editOrderForm.services ?? [];
    for (let i = 0; i < rows.length; i++) {
      if (this.getEditServiceDefinition(i)?.serviceKey === serviceKey) return i;
    }
    return -1;
  }

  /** Re-derive the Sq.ft row after a bedroom change and reprice it. */
  private syncEditSqftWithBedrooms(bedroomsQty: number, prevBedroomsQty: number): void {
    const sqftIdx = this.findEditServiceIndexByKey('sqft');
    if (sqftIdx < 0) return;
    const row = this.editOrderForm.services?.[sqftIdx];
    if (!row) return;

    // Quantity follows the shared bedrooms→sqft rule against the CONFIGURED allowances (same
    // resolution the booking page and customer order edit use): a Sq.ft still sitting on the
    // outgoing bedroom's allowance tracks the new one, while a value the admin or customer
    // raised above it survives. Resetting it unconditionally used to discard that value.
    // The cost is deliberately NOT computed here: recalcSubtotalFromServicesAndExtras reprices
    // every line through the shared calculator, so the tiered rate applies. The previous
    // unitPrice x quantity here was linear and ignored both the allowance and the tiers.
    row.quantity = resolveSquareFeetForBedroomChange(
      Number(row.quantity) || 0,
      this.getEditSquareFeetForBedrooms(prevBedroomsQty),
      this.getEditSquareFeetForBedrooms(bedroomsQty)
    );
    this.editOrderFormPrevServiceQuantities[sqftIdx] = row.quantity;
  }

  onEditServiceCostChange(): void {
    this.recalcSubtotalFromServicesAndExtras();
  }

  onEditExtraQuantityChange(e: { orderExtraServiceId?: number | null; quantity: number; hours: number; cost: number }, index: number): void {
    const q = Number(e.quantity) || 0;
    const def = this.getEditExtraDefinition(e, index);
    // Custom Pricing: the quantity is descriptive ("Windows × 5"), never billable — keep the
    // row at $0 so raising it can't move the admin-entered total.
    if (this.isCustomModeOrder()) {
      e.cost = 0;
      this.editOrderFormPrevExtraQuantities[index] = q;
      this.recalcSubtotalFromServicesAndExtras();
      return;
    }
    if (def?.hasQuantity) {
      // Same rule as the shared calculator: deep-cleaning multiplier applies, Same Day is exempt.
      const priceMultiplier = Number((this.selectedOrder?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
      const m = def.isSameDayService ? 1 : priceMultiplier;
      e.cost = round2(def.price * q * m);
    } else {
      const prevQ = this.editOrderFormPrevExtraQuantities[index] ?? 1;
      const prevCost = Number(e.cost) || 0;
      const orderId = e.orderExtraServiceId ?? 0;
      let unitPrice = (prevQ > 0 && prevCost > 0) ? (prevCost / prevQ) : (def?.price ?? 0);
      if (unitPrice === 0 && orderId !== 0 && this.selectedOrder?.extraServices) {
        const oes = this.selectedOrder.extraServices.find(x => x.id === orderId);
        if (oes && (oes.quantity > 0 || oes.hours > 0) && oes.cost > 0)
          unitPrice = oes.hours > 0 ? (oes.cost / oes.hours) : (oes.cost / oes.quantity);
      }
      e.cost = Math.round(unitPrice * q * 100) / 100;
    }
    this.editOrderFormPrevExtraQuantities[index] = q;
    this.recalcSubtotalFromServicesAndExtras();
  }

  onEditExtraHoursChange(e: { orderExtraServiceId?: number | null; quantity: number; hours: number; cost: number }, index: number): void {
    const h = Number(e.hours) ?? 0;
    const def = this.getEditExtraDefinition(e, index);
    // Custom Pricing: hours describe the job, they don't buy time — see onEditExtraQuantityChange.
    if (this.isCustomModeOrder()) {
      e.cost = 0;
      this.editOrderFormPrevExtraHours[index] = h;
      this.recalcSubtotalFromServicesAndExtras();
      return;
    }
    if (def?.hasHours) {
      // Same rule as the shared calculator: deep-cleaning multiplier applies, Same Day is exempt.
      const priceMultiplier = Number((this.selectedOrder?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
      const m = def.isSameDayService ? 1 : priceMultiplier;
      e.cost = round2(def.price * h * m);
    } else {
      const prevH = this.editOrderFormPrevExtraHours[index] ?? 0.5;
      const prevCost = Number(e.cost) || 0;
      const unitPrice = (prevH > 0 && prevCost > 0) ? (prevCost / prevH) : (def?.price ?? 0);
      e.cost = Math.round(unitPrice * h * 100) / 100;
    }
    this.editOrderFormPrevExtraHours[index] = h;
    this.recalcSubtotalFromServicesAndExtras();
  }

  onEditExtraCostChange(): void {
    this.recalcSubtotalFromServicesAndExtras();
  }

  // ── Stepper (+/−) helpers for the edit-form service/extra quantity & hours ──

  stepEditServiceQuantity(s: { quantity: number; cost: number }, index: number, delta: number): void {
    s.quantity = Math.max(0, (Number(s.quantity) || 0) + delta);
    this.onEditServiceQuantityChange(s, index);
  }

  stepEditServiceHours(index: number, delta: number): void {
    const next = Math.max(0.5, Math.min(24, (this.getEditServiceHours(index) || 0) + delta));
    this.onEditServiceHoursChange(index, next);
  }

  stepEditExtraQuantity(e: { orderExtraServiceId?: number | null; quantity: number; hours: number; cost: number }, index: number, delta: number): void {
    e.quantity = Math.max(0, (Number(e.quantity) || 0) + delta);
    this.onEditExtraQuantityChange(e, index);
  }

  stepEditExtraHours(e: { orderExtraServiceId?: number | null; quantity: number; hours: number; cost: number }, index: number, delta: number): void {
    e.hours = Math.max(0, (Number(e.hours) || 0) + delta);
    this.onEditExtraHoursChange(e, index);
  }

  removeEditExtraService(index: number): void {
    const extras = this.editOrderForm.extraServices ?? [];
    if (index < 0 || index >= extras.length) return;
    extras.splice(index, 1);
    this.editOrderFormPrevExtraQuantities.splice(index, 1);
    this.editOrderFormPrevExtraHours.splice(index, 1);
    this.recalcSubtotalFromServicesAndExtras();
  }

  cancelEditOrder(): void {
    this.editingOrder = false;
    // Drop any unconfirmed save with the form it was built from, so reopening the editor can
    // never surface a diff against values that are no longer on screen.
    this.resetSaveConfirmState();
  }

  /**
   * Pending edits for the currently selected order (for template; avoids arrow fn in template).
   * Empty for an admin who cannot review, because the list is never fetched for them.
   */
  getPendingEditsForSelectedOrder(): PendingOrderEditListDto[] {
    if (!this.selectedOrder) return [];
    return this.pendingOrderEdits.filter(p => p.orderId === this.selectedOrder!.id);
  }

  loadPendingOrderEdits(): void {
    // Whoever may apply an order edit themselves may also approve one from a colleague; the
    // endpoint enforces the same rule, so an ungranted admin would just get a 403.
    if (!this.canSaveOrderEditsDirectly) return;
    this.loadingPendingEdits = true;
    this.adminService.getPendingOrderEdits().subscribe({
      next: (list) => {
        this.pendingOrderEdits = list;
        this.cdr.detectChanges();
      },
      error: () => { this.pendingOrderEdits = []; },
      complete: () => { this.loadingPendingEdits = false; }
    });
  }

  openPendingEditDetail(id: number): void {
    this.loadingPendingEditDetail = true;
    this.selectedPendingEdit = null;
    this.adminService.getPendingOrderEditDetail(id).subscribe({
      next: (detail) => {
        this.selectedPendingEdit = detail;
        this.loadExtraServiceNamesForPendingEdit();
        this.cdr.detectChanges();
      },
      error: () => { this.selectedPendingEdit = null; },
      complete: () => { this.loadingPendingEditDetail = false; }
    });
  }

  /**
   * Load extra service id -> name and hasHours from service types, for the "(new)" / "(removed)"
   * extra rows and the "(hours/cost)" vs "(qty/cost)" unit label in the approval table. The
   * save-confirmation table reads the same maps but fills them from the editor's own cache
   * (hydrateExtraServiceLabelMapsFromCache) so it never waits on a request.
   */
  private loadExtraServiceNamesForPendingEdit(done?: () => void): void {
    this.bookingService.getServiceTypes().subscribe({
      next: (types) => {
        const nameMap = new Map<number, string>();
        const hasHoursMap = new Map<number, boolean>();
        for (const st of types) {
          for (const es of st.extraServices ?? []) {
            if (!nameMap.has(es.id)) nameMap.set(es.id, es.name);
            if (!hasHoursMap.has(es.id)) hasHoursMap.set(es.id, !!es.hasHours);
          }
        }
        this.extraServiceNamesMap = nameMap;
        this.extraServiceHasHoursMap = hasHoursMap;
        this.cdr.detectChanges();
        done?.();
      },
      error: () => {
        this.extraServiceNamesMap = new Map();
        this.extraServiceHasHoursMap = new Map();
        done?.();
      }
    });
  }

  /**
   * Fill the extra-service label maps from `serviceTypesCache`, which `startEditOrder` has already
   * populated. Synchronous on purpose: the save-confirmation modal must open on the click, not
   * after a round trip, and an empty cache only costs us "Extra #17" instead of "Oven Cleaning".
   */
  private hydrateExtraServiceLabelMapsFromCache(): void {
    if (this.extraServiceNamesMap.size > 0) return;
    const nameMap = new Map<number, string>();
    const hasHoursMap = new Map<number, boolean>();
    for (const st of this.serviceTypesCache) {
      for (const es of st.extraServices ?? []) {
        if (!nameMap.has(es.id)) nameMap.set(es.id, es.name);
        if (!hasHoursMap.has(es.id)) hasHoursMap.set(es.id, !!es.hasHours);
      }
    }
    if (nameMap.size === 0) return;
    this.extraServiceNamesMap = nameMap;
    this.extraServiceHasHoursMap = hasHoursMap;
  }

  closePendingEditDetail(): void {
    this.selectedPendingEdit = null;
    this.loadPendingOrderEdits();
  }

  approvePendingOrderEdit(id: number): void {
    if (this.approvingPendingId != null) return;
    this.approvingPendingId = id;
    this.adminService.approvePendingOrderEdit(id).subscribe({
      next: () => {
        this.successMessage = 'Order edit approved and applied.';
        this.closePendingEditDetail();
        if (this.selectedOrder && this.selectedPendingEdit && this.selectedOrder.id === this.selectedPendingEdit.orderId) {
          this.adminService.getOrderDetails(this.selectedOrder.id).subscribe({
            next: (o) => {
              this.selectedOrder = o;
              this.customerNames.set(o.id, `${o.contactFirstName} ${o.contactLastName}`);
              this.customerDetails.set(o.id, { id: o.userId, email: o.contactEmail });
            }
          });
        }
        this.calculateStatistics();
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to approve.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.approvingPendingId = null; }
    });
  }

  rejectPendingOrderEdit(id: number, reason?: string): void {
    if (this.rejectingPendingId != null) return;
    this.rejectingPendingId = id;
    this.adminService.rejectPendingOrderEdit(id, reason).subscribe({
      next: () => {
        this.successMessage = 'Order edit rejected.';
        this.closePendingEditDetail();
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to reject.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.rejectingPendingId = null; }
    });
  }

  /** Normalize time string to HH:mm for comparison (so 08:00:00 and 08:00 are equal). */
  private normalizeTimeToHHmm(v: any): string {
    if (v == null || v === '') return '';
    const s = String(v).trim();
    const match = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (match) {
      const h = match[1].padStart(2, '0');
      const m = match[2].padStart(2, '0');
      return `${h}:${m}`;
    }
    return s;
  }

  /**
   * Custom service orders are represented in `services` by a marker row with `serviceId = 0`,
   * similar to the customer order details page.
   */
  isCustomServiceType(order?: any | null): boolean {
    const services = order?.services ?? [];
    const hasCustomServiceMarker = services.some((s: any) => Number(s?.serviceId) === 0);
    const hasNoRegularServices = services.length === 0 || (services.length === 1 && Number(services[0]?.serviceId) === 0);
    return hasCustomServiceMarker || hasNoRegularServices;
  }

  /** Build a list of field-level changes for a pending edit awaiting SuperAdmin approval. */
  getPendingEditChanges(): OrderEditChange[] {
    const d = this.selectedPendingEdit;
    if (!d?.currentOrder || !d?.proposedChanges) return [];
    return this.computeOrderEditChanges(d.currentOrder, d.proposedChanges);
  }

  /**
   * Field-level diff of an order (as loaded) against a proposed update DTO.
   *
   * Shared by the two places an order edit is reviewed before it takes effect: the SuperAdmin
   * approval modal (proposal loaded from the server) and the save-confirmation modal shown to
   * whoever saves directly (proposal built from the open edit form). Both read the same rows, so
   * a granted Admin confirms exactly what a SuperAdmin would have approved.
   */
  computeOrderEditChanges(currentOrder: any, proposed: SuperAdminUpdateOrderDto | null | undefined): OrderEditChange[] {
    if (!currentOrder || !proposed) return [];
    const cur = currentOrder as any;
    const prop = proposed;
    const changes: OrderEditChange[] = [];
    const fmt = (v: any): string => v == null || v === '' ? '—' : String(v);
    // Signed numeric difference (proposed − current). Returns '—' when either side
    // isn't a finite number (text fields like names/addresses) or when there's no change.
    const fmtDiff = (c: any, p: any): string => {
      const cn = Number(c), pn = Number(p);
      if (c == null || c === '' || p == null || p === '' || !isFinite(cn) || !isFinite(pn)) return '—';
      const dlt = Math.round((pn - cn) * 100) / 100;
      if (dlt === 0) return '—';
      const body = Number.isInteger(dlt) ? String(dlt) : dlt.toFixed(2);
      return dlt > 0 ? `+${body}` : body;
    };
    const push = (field: string, c: any, p: any) => {
      // `undefined` on the DTO means the field is not part of this edit (the backend's own rule:
      // `if (dto.X != null) order.X = dto.X`). Rendering it as a change to '—' would invent
      // removals the save is not going to perform. Clearing a field sends '' or 0, not undefined.
      if (p === undefined) return;
      const cv = fmt(c);
      const pv = fmt(p);
      if (cv !== pv) changes.push({ field, current: cv, proposed: pv, difference: fmtDiff(c, p) });
    };
    const pushTime = (field: string, c: any, p: any) => {
      if (p === undefined) return; // not part of this edit — see `push`
      const cv = this.normalizeTimeToHHmm(c);
      const pv = this.normalizeTimeToHHmm(p);
      if (cv !== pv) changes.push({ field, current: cv || '—', proposed: pv || '—', difference: '—' });
    };
    push('Contact First Name', cur.contactFirstName, prop.contactFirstName);
    push('Contact Last Name', cur.contactLastName, prop.contactLastName);
    push('Email', cur.contactEmail, prop.contactEmail);
    // Both sides normalized: the form and the DTO always carry 10 digits, but a legacy order
    // can still hold a formatted number - a formatting difference is not a change.
    push('Phone', normalizePhone10(cur.contactPhone) ?? cur.contactPhone, normalizePhone10(prop.contactPhone) ?? prop.contactPhone);
    push('Address', cur.serviceAddress, prop.serviceAddress);
    push('Apt/Suite', cur.aptSuite, prop.aptSuite);
    push('City', cur.city, prop.city);
    push('State', cur.state, prop.state);
    push('Zip', cur.zipCode, prop.zipCode);
    // Service Date: compare date-only so time component (e.g. 08:00 vs 00:00) doesn't show as change
    const dateOnly = (v: any): string => {
      if (v == null || v === '') return '';
      const s = String(v);
      const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : s;
    };
    const curDate = dateOnly(cur.serviceDate);
    const propDate = dateOnly(prop.serviceDate);
    if (prop.serviceDate !== undefined && curDate !== propDate) {
      changes.push({ field: 'Service Date', current: curDate || '—', proposed: propDate || '—', difference: '—' });
    }
    pushTime('Service Time', cur.serviceTime, prop.serviceTime);
    push('Duration (min)', cur.totalDuration, prop.totalDuration);
    push('Maids', cur.maidsCount, prop.maidsCount);
    // Without these two rows a SuperAdmin would approve a property-type or level change they
    // could not see in the diff - and a level change moves the price.
    //
    // The level count is not a field on the proposed DTO: it travels as an ordinary service row,
    // so it has to be looked up by matching the current order's levels line to the proposed row
    // carrying the same orderServiceId.
    push('Property Type', cur.propertyType, prop.propertyType);
    const currentLevelsLine = (cur.services ?? []).find((s: any) => s.serviceKey === 'levels');
    if (currentLevelsLine) {
      const proposedLevelsRow = (prop.services ?? [])
        .find((s: any) => s.orderServiceId === currentLevelsLine.id);
      push('Levels', currentLevelsLine.quantity, proposedLevelsRow?.quantity ?? currentLevelsLine.quantity);
    }
    push('Entry', cur.entryMethod, prop.entryMethod);
    const instructionsFieldLabel = this.isCustomServiceType(cur) ? 'Description' : 'Instructions';
    push(instructionsFieldLabel, cur.specialInstructions, prop.specialInstructions);
    push('Floor Types', cur.floorTypes, prop.floorTypes);
    push('SubTotal', cur.subTotal, prop.subTotal);
    push('Tax', cur.tax, prop.tax);
    push('Tips', cur.tips, prop.tips);
    // Total is deliberately NOT pushed here — it is appended last and unconditionally, so it
    // always reads as the bottom line of the table.
    push('Discount', cur.discountAmount, prop.discountAmount);
    push('Subscription Discount', cur.subscriptionDiscountAmount, prop.subscriptionDiscountAmount);
    push('Status', cur.status, prop.status);
    push('Cancellation Reason', cur.cancellationReason, prop.cancellationReason);
    push('Cleaner $/hr', cur.cleanerHourlyRate, prop.cleanerHourlyRate);
    push('Cleaners Total Salary', cur.cleanerTotalSalary, prop.cleanerTotalSalary);
    // Custom ("Pre-Arranged") orders: relabeling the service-type display name. Treat an
    // empty proposed value as "Arranged" so clearing the label reads sensibly in the diff.
    // `undefined` means the field wasn't part of this edit (e.g. pending edits created before
    // this field existed) — skip it so we never show a spurious "name → Arranged" change.
    if (this.isCustomServiceType(cur) && prop.customServiceDisplayName !== undefined) {
      const curName = cur.customServiceDisplayName;
      const propName = prop.customServiceDisplayName;
      const labelOrArranged = (v: any) => (v == null || v === '' ? 'Arranged' : String(v));
      if (labelOrArranged(curName) !== labelOrArranged(propName)) {
        changes.push({
          field: 'Service Type Name',
          current: labelOrArranged(curName),
          proposed: labelOrArranged(propName),
          difference: '—'
        });
      }
    }

    // Services: one row per service with label "Name (qty/cost)"
    const curServices = cur.services ?? [];
    const propServices = prop.services ?? [];
    for (const ps of propServices) {
      const osId = ps.orderServiceId ?? (ps as any).orderServiceId;
      const cs = curServices.find((s: any) => s.id === osId);
      const name = cs?.serviceName ?? `Service #${osId}`;
      if (cs) {
        const cq = Number(cs.quantity);
        const cc = Number(cs.cost);
        const pq = Number(ps.quantity);
        const pc = Number(ps.cost);
        if (cq !== pq || cc !== pc) {
          changes.push({ field: `${name} (qty/cost)`, current: `(${cq}/${cc})`, proposed: `(${pq}/${pc})`, difference: fmtDiff(cc, pc) });
        }
      }
    }
    // Extra services: label with (qty/cost) or (hours/cost) depending on extra type; show removed
    const curExtras = cur.extraServices ?? [];
    const propExtras = prop.extraServices ?? [];
    const propExtraIds = new Set((propExtras as any[]).map((e: any) => e.orderExtraServiceId ?? (e as any).orderExtraServiceId ?? 0));
    const extraUnit = (extraId: number) => this.extraServiceHasHoursMap.get(Number(extraId)) ? '(hours/cost)' : '(qty/cost)';
    for (const pe of propExtras) {
      const oeId = pe.orderExtraServiceId ?? (pe as any).orderExtraServiceId ?? 0;
      const ce = curExtras.find((e: any) => e.id === oeId);
      const extraId = (ce?.extraServiceId ?? pe.extraServiceId ?? (pe as any).extraServiceId) ?? 0;
      const label = ce ? (ce.extraServiceName ?? `Extra #${ce.extraServiceId ?? oeId}`) : '';
      const unit = extraUnit(extraId);
      if (ce) {
        const useHours = this.extraServiceHasHoursMap.get(Number(ce.extraServiceId ?? extraId));
        const cVal = useHours ? Number(ce.hours) : Number(ce.quantity);
        const pVal = useHours ? Number(pe.hours) : Number(pe.quantity);
        const cc = Number(ce.cost);
        const pc = Number(pe.cost);
        if (cVal !== pVal || cc !== pc) {
          changes.push({ field: `${label} ${unit}`, current: `(${cVal}/${cc})`, proposed: `(${pVal}/${pc})`, difference: fmtDiff(cc, pc) });
        }
      } else if (oeId === 0 && (pe.extraServiceId ?? (pe as any).extraServiceId)) {
        const eid = pe.extraServiceId ?? (pe as any).extraServiceId;
        const extraName = this.extraServiceNamesMap.get(Number(eid)) ?? `Extra #${eid}`;
        const useHours = this.extraServiceHasHoursMap.get(Number(eid));
        const pVal = useHours ? Number(pe.hours) : Number(pe.quantity);
        const pc = Number(pe.cost);
        changes.push({ field: `${extraName} (new) ${unit}`, current: '—', proposed: `(${pVal}/${pc})`, difference: fmtDiff(0, pc) });
      }
    }
    // Removed extras: in current but not in proposed
    for (const ce of curExtras) {
      const oesId = ce.id;
      if (propExtraIds.has(oesId)) continue;
      const extraLabel = ce.extraServiceName ?? `Extra #${ce.extraServiceId ?? oesId}`;
      const eid = ce.extraServiceId ?? 0;
      const unit = extraUnit(eid);
      const useHours = this.extraServiceHasHoursMap.get(Number(eid));
      const cVal = useHours ? Number(ce.hours) : Number(ce.quantity);
      const cc = Number(ce.cost);
      changes.push({ field: `${extraLabel} (removed) ${unit}`, current: `(${cVal}/${cc})`, proposed: '—', difference: fmtDiff(cc, 0) });
    }

    // The bottom line, always shown. Every other row is omitted when it did not change; this one
    // is not, because "what will the customer pay, and by how much did it move" is the question a
    // reviewer is actually answering, and an absent row makes them go and look it up. An edit that
    // leaves the total alone says so explicitly, with a '—' difference.
    const curTotal = cur.total;
    const propTotal = prop.total !== undefined ? prop.total : cur.total;
    changes.push({
      field: 'Total',
      current: fmt(curTotal),
      proposed: fmt(propTotal),
      difference: fmtDiff(curTotal, propTotal),
      emphasised: true
    });

    return changes;
  }

  onEditOrderPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    if (input.value !== cleaned) {
      input.value = cleaned;
    }
    this.editOrderForm.contactPhone = cleaned;
  }

  /**
   * Assemble the update DTO from the open edit form. Pure: it neither sends anything nor touches
   * component state, so the save-confirmation modal can diff the exact payload that will be sent.
   */
  private buildOrderEditDto(): SuperAdminUpdateOrderDto {
    // Custom pricing: totalDuration is per-cleaner minutes (matches booking payload).
    const persistedTotalDuration = this.editOrderForm.totalDuration ?? undefined;
    const dto: SuperAdminUpdateOrderDto = {
      contactFirstName: this.editOrderForm.contactFirstName ?? undefined,
      contactLastName: this.editOrderForm.contactLastName ?? undefined,
      contactEmail: this.editOrderForm.contactEmail ?? undefined,
      contactPhone: normalizePhone10(this.editOrderForm.contactPhone) ?? undefined,
      serviceAddress: this.editOrderForm.serviceAddress ?? undefined,
      aptSuite: this.editOrderForm.aptSuite ?? undefined,
      city: this.editOrderForm.city ?? undefined,
      state: this.editOrderForm.state ?? undefined,
      zipCode: this.editOrderForm.zipCode ?? undefined,
      serviceDate: this.editOrderForm.serviceDate ?? undefined,
      serviceTime: this.editOrderForm.serviceTime ?? undefined,
      maidsCount: this.editOrderForm.maidsCount ?? undefined,
      totalDuration: persistedTotalDuration ?? undefined,
      bedroomsQuantity: this.editOrderForm.bedroomsQuantity ?? undefined,
      bathroomsQuantity: this.editOrderForm.bathroomsQuantity ?? undefined,
      // undefined = no change, which is what a legacy order the admin did not touch must send.
      propertyType: this.editOrderForm.propertyType ?? undefined,
      // Informational only; a priced levels row in `services` wins server-side.
      levelsQuantity: this.editOrderForm.levelsQuantity ?? undefined,
      entryMethod: this.editOrderForm.entryMethod ?? undefined,
      specialInstructions: this.editOrderForm.specialInstructions ?? undefined,
      floorTypes: this.editOrderForm.floorTypes ?? undefined,
      floorTypeOther: this.editOrderForm.floorTypeOther ?? undefined,
      tips: this.editOrderForm.tips ?? undefined,
      status: this.editOrderForm.status ?? undefined,
      cancellationReason: this.editOrderForm.cancellationReason ?? undefined,
      subTotal: this.editOrderForm.subTotal ?? undefined,
      tax: this.editOrderForm.tax ?? undefined,
      total: this.editOrderForm.total ?? undefined,
      // Only present when the admin typed a Total. The server re-checks the base against the
      // subtotal this order's discounts leave behind before honouring the tax.
      taxOverride: this.editOrderTaxOverride?.tax ?? undefined,
      taxOverrideBase: this.editOrderTaxOverride?.base ?? undefined,
      discountAmount: this.editOrderForm.discountAmount ?? undefined,
      subscriptionDiscountAmount: this.editOrderForm.subscriptionDiscountAmount ?? undefined,
      // Loyalty Discount: persist the rescaled $ amount. Backend leaves the original
      // LoyaltyDiscountPercentage untouched per SuperAdminFullUpdateOrder comment.
      loyaltyDiscountAmount: this.editOrderForm.loyaltyDiscountAmount ?? undefined,
      cleanerHourlyRate: this.editOrderForm.cleanerHourlyRate ?? undefined,
      cleanerTotalSalary: this.editOrderForm.cleanerTotalSalary ?? undefined,
      // Only meaningful for custom orders; backend ignores it for other service types.
      // Send '' (not undefined) when cleared so the backend can reset it to "Arranged".
      customServiceDisplayName: this.selectedOrderIsCustomServiceType
        ? (this.editOrderForm.customServiceDisplayName ?? '')
        : undefined,
      services: this.editOrderForm.services ?? undefined,
      // Send extra services: existing rows with orderExtraServiceId; new rows with orderExtraServiceId: 0 and extraServiceId (backend may expect 0 for "create")
      extraServices: (this.editOrderForm.extraServices ?? undefined)?.map(e => {
        const orderExtraServiceId = Number((e as any).orderExtraServiceId ?? 0) || 0;
        const maybeExtraServiceId = Number((e as any).extraServiceId ?? 0) || 0;
        const existingExtraServiceId = orderExtraServiceId > 0
          ? (this.selectedOrder?.extraServices?.find(x => x.id === orderExtraServiceId)?.extraServiceId ?? 0)
          : 0;
        const extraServiceId = maybeExtraServiceId || existingExtraServiceId;
        const quantity = Number((e as any).quantity ?? 0) || 0;
        const hours = Number((e as any).hours ?? 0) || 0;
        const cost = Number((e as any).cost ?? 0) || 0;
        if (orderExtraServiceId > 0) {
          return { orderExtraServiceId, extraServiceId: extraServiceId || undefined, quantity, hours, cost };
        }
        // New row: send orderExtraServiceId: 0 + extraServiceId so backend can insert (avoid null to prevent 400)
        if (!extraServiceId || extraServiceId < 1) return null;
        return { orderExtraServiceId: 0, extraServiceId, quantity, hours, cost };
      }).filter((x): x is NonNullable<typeof x> => x != null)
    };
    return dto;
  }

  /**
   * Save button. Whoever applies the edit themselves gets the change list first (same table a
   * SuperAdmin approves from) and confirms it; an Admin who still needs approval submits straight
   * away, because their changes are reviewed on the SuperAdmin side.
   */
  saveOrderEdit(): void {
    if (!this.selectedOrder || !this.canEditOrder || this.savingOrder) return;
    this.errorMessage = '';
    this.successMessage = '';

    const dto = this.buildOrderEditDto();

    if (!this.canSaveOrderEditsDirectly) {
      this.savingOrder = true;
      this.submitOrderEditForApproval(dto);
      return;
    }

    // Names/units are only needed to label "(new)" and "(removed)" extra rows; they come from the
    // catalogue the open editor already loaded, so the modal opens on the click.
    this.hydrateExtraServiceLabelMapsFromCache();
    this.pendingSaveDto = dto;
    this.saveConfirmChanges = this.computeOrderEditChanges(this.selectedOrder, dto);
    this.showSaveConfirm = true;
  }

  /** Apply the reviewed changes. Only reachable from the save-confirmation modal. */
  confirmSaveOrderEdit(): void {
    if (!this.selectedOrder || !this.pendingSaveDto || this.savingOrder) return;
    const dto = this.pendingSaveDto;
    this.savingOrder = true;
    this.adminService.superAdminFullUpdateOrder(this.selectedOrder.id, dto).subscribe({
      next: () => {
        this.successMessage = 'Order updated successfully. All changes are recorded in Audit logs.';
        this.editingOrder = false;
        this.resetSaveConfirmState();
        this.refreshOrderAfterSave();
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        // Keep the edit form open with the admin's values intact so they can retry or adjust.
        this.errorMessage = err.error?.message || 'Failed to update order.';
        this.resetSaveConfirmState();
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingOrder = false; }
    });
  }

  /** Dismiss the confirmation and return to the still-open edit form with nothing sent. */
  closeSaveConfirm(): void {
    if (this.savingOrder) return;
    this.showSaveConfirm = false;
    this.pendingSaveDto = null;
    this.saveConfirmChanges = [];
  }

  private submitOrderEditForApproval(dto: SuperAdminUpdateOrderDto): void {
    if (!this.selectedOrder) return;
    this.adminService.submitPendingOrderEdit(this.selectedOrder.id, dto).subscribe({
      next: () => {
        this.successMessage = 'Your changes have been sent to SAdmin for approval. You will see the update once a SAdmin confirms.';
        this.editingOrder = false;
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to submit edit for approval.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.savingOrder = false; }
    });
  }

  private refreshOrderAfterSave(): void {
    if (!this.selectedOrder) return;
    this.adminService.getOrderDetails(this.selectedOrder.id).subscribe({
      next: (o) => {
        this.selectedOrder = o;
        this.customerNames.set(o.id, `${o.contactFirstName} ${o.contactLastName}`);
        this.customerDetails.set(o.id, { id: o.userId, email: o.contactEmail });
        const orderIndex = this.orders.findIndex(order => order.id === o.id);
        if (orderIndex !== -1) {
          const updatedOrder = this.orders[orderIndex];
          updatedOrder.contactFirstName = o.contactFirstName;
          updatedOrder.contactLastName = o.contactLastName;
          updatedOrder.contactEmail = o.contactEmail;
          updatedOrder.serviceAddress = o.serviceAddress;
          updatedOrder.serviceDate = o.serviceDate;
          updatedOrder.serviceTime = o.serviceTime;
          updatedOrder.totalDuration = o.totalDuration;
          updatedOrder.status = o.status;
          updatedOrder.total = o.total;
          updatedOrder.tips = o.tips;
          updatedOrder.companyDevelopmentTips = o.companyDevelopmentTips;
          if (this.isSuperAdmin) this.calculateStatistics();
        }
      }
    });
  }

  getVisiblePages(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 3;

    if (this.totalPages <= 5) {
      for (let i = 2; i < this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      let start = Math.max(2, this.currentPage - 1);
      let end = Math.min(this.totalPages - 1, start + maxVisiblePages - 1);

      if (end === this.totalPages - 1) {
        start = Math.max(2, end - maxVisiblePages + 1);
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    }

    return pages;
  }
}