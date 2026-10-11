import { Component, OnInit, ChangeDetectorRef, AfterViewInit, OnDestroy, ElementRef, HostListener, input, ChangeDetectionStrategy, ApplicationRef, inject, viewChild, signal, computed, DestroyRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, OrderUpdateHistory, UserPermissions, SuperAdminUpdateOrderDto, PendingOrderEditListDto, PendingOrderEditDetailDto, AssignedCleanerAdmin, UserCleaningPhoto, OrderAdminNote, OrderTransferInfo, UserAdmin, OrderRefundSummary, OrderRefundInfo, OrderCleanerPayroll, OrderCleanerPayrollLine, OrderStaffingWarningsMap, OrderChangeRequest, OrderStatusChangeResult } from '../../../services/admin.service';
import { environment } from '../../../../environments/environment';
import { OrderService, Order, OrderList, OrderPartialPayment, OrderPaymentBalance } from '../../../services/order.service';
import { CleanerService, AvailableCleaner } from '../../../services/cleaner.service';
import { BookingService, ServiceType, ExtraService, Service } from '../../../services/booking.service';
import { DurationUtils } from '../../../utils/duration.utils';
import { OrderReminderService } from '../../../services/order-reminder.service';
import { FloorTypeSelection } from '../../../shared/components/floor-type-selector/floor-type-selector.component';
import {
  PAYMENT_METHOD_OPTIONS, PaymentMethodValue, isSettledOnRecord, paymentMethodLabel
} from '../../../shared/payment-method';

/** The payment-method editor's choices: the stored methods plus the regular-invoice shortcut. */
type PaymentMethodEditChoice = PaymentMethodValue | 'RegularInvoice';
import { InvoiceService, InvoiceClientOption, OrderInvoices, LinkedInvoiceSummary } from '../../../services/invoice.service';
import { CustomerInvoiceService, CustomerInvoice, CUSTOMER_INVOICE_STATUS_LABELS } from '../../../services/customer-invoice.service';
import { OrderChangeEntry, buildOrderChangeEntries } from './order-changes.util';
import { NewOrderNotificationService } from '../../../services/new-order-notification.service';
import { BubbleRewardsService } from '../../../services/bubble-rewards.service';
import { forkJoin, of, Observable, concat } from 'rxjs';
import { catchError, finalize, last } from 'rxjs/operators';
import { matchesPhoneSearch, normalizePhone10, sanitizePhoneInput } from '../../../utils/phone.utils';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';
import { ShiftService, ShiftAdmin } from '../../../services/shift.service';
import { BillingService, AdminOrderSavedCardInfo } from '../../../services/billing.service';
import { formatNy, formatNyDateTime, parseUtcDate } from '../../../shared/ny-time.util';
import {
  formatAdminServiceTypeLabel,
  isResidentialServiceTypeOrKey
} from '../../../shared/admin/service-type-short-label';
import {
  isPartiallyRefundedOrder,
  orderStatusBadgeClass,
  orderStatusBadgeLabel,
  orderStatusBadgeTitle,
} from '../../../shared/admin/order-status-badge';
import {
  calculateQuote,
  calculateTotals,
  calculateCleanerTotalSalary,
  calculatePerCleanerBillableMinutes,
  resolveCleanerSplitCount,
  getDefaultCleanerHourlyRate,
  getServiceDisplayDuration,
  getSquareFeetForBedrooms,
  resolveSquareFeetForBedroomChange,
  isExtraCleaners,
  resolveGiftCardAmountToUse,
  round2,
  QuoteResult,
  REGULAR_CLEANER_HOURLY_RATE,
  SALES_TAX_RATE,
  STUDIO_PRICE
} from '../../../shared/pricing/order-pricing.calculator';
import { isDeepOrSuperDeepExtra, isSuperDeepExtra } from '../../../shared/booking/extra-service-keys';
import { buildAdminEditQuoteInput } from '../../../shared/pricing/admin-order-edit.pricing';
import { discountsForSubTotal, EditDiscountSnapshot, solveSubTotalForTypedTotal } from '../../../shared/pricing/admin-total-solve';
import {
  PROPERTY_TYPE_APARTMENT,
  PROPERTY_TYPE_HOUSE,
  isHouse,
  isLevelsService,
  findLevelsService,
  LEVEL_OPTIONS,
  MIN_LEVELS,
  levelsToDisplay,
  normalizePropertyType,
  serviceTypeCollectsPropertyType
} from '../../../shared/booking/property-type.utils';
import { buildCustomServiceTypeNameOptions } from '../../../shared/booking/custom-service-type.util';
import { composeTime24h, parseTime12h } from '../../../shared/booking/extra-service-display.utils';
// Aliased: the component has a field of the same name holding the resolved answer.
import { canSaveOrderEditsDirectly as canSaveOrderEditsDirectlyFor } from '../../../shared/order-edit-approval.policy';
import { doneMoveNeedsRequest } from '../../../shared/order-done-approval.policy';
import {
  RecurringSeriesPanelComponent
} from '../../../shared/components/recurring-series-panel/recurring-series-panel.component';
import { isBedroomsLine, isCleanersLine, isHoursLine, KeyedOrderService, orderServiceKeyOf } from '../../../shared/booking/order-service-keys';

/** One row of an order-edit review table (approval modal and save-confirmation modal). */
export interface OrderEditChange {
  field: string;
  current: string;
  proposed: string;
  /**
   * The field's value on the order AS IT STANDS NOW, set only when this row came from a stored
   * submit-time payload (the approval table). The save-confirmation table has no such distinction
   * — it is built from the form that is open in front of you.
   */
  liveCurrent?: string;
  /**
   * True when {@link liveCurrent} disagrees with {@link current}: the order moved underneath the
   * request, so approving it would apply a change reviewed against a state that no longer exists.
   */
  hasDrifted?: boolean;
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
  /** Stored as bare digits. Lets the orders search match a phone number. */
  contactPhone?: string;
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
  /** Regular (false) or Commercial (true): which Orders sub-tab lists the order. */
  isCommercial?: boolean;
  /** A Done request is waiting for approval — the row shows "Done requested" instead of the
   *  Done button, so nobody sends a duplicate. */
  hasPendingDoneRequest?: boolean;
}

/** The Orders tab's two sub-tabs (2026-10). Kept in the URL as `?ordersTab=`. */
export type OrdersSubTab = 'regular' | 'commercial';

/** Everything an admin can set on the list itself — search, filters, sort and page — which each
 *  sub-tab keeps for itself so switching tabs never loses what was set on the other one. */
interface OrdersListViewState {
  searchTerm: string;
  statusFilter: string;
  dateFilter: string;
  customDateFrom: string;
  customDateTo: string;
  serviceTypeFilter: string;
  bookedByFilter: string;
  paymentMethodFilter: string;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  currentPage: number;
}

/** One row of the order panel's single Payments list (see `paymentTimeline`). */
export interface PaymentTimelineRow {
  key: string;
  when: string | Date | null;
  label: string;
  amount: number;
  sign: '' | '+' | '−';
  status: 'paid' | 'due' | 'void' | 'info';
  statusText: string;
  paidAt?: string | Date | null;
  invoice: CustomerInvoice | null;
  /** Set on an order-edit row, so the row can carry "Record manual payment". */
  update?: OrderUpdateHistory;
  /** Set on a part-payment row, so a manually recorded one can be corrected. */
  slice?: OrderPartialPayment;
}

@Component({
  selector: 'app-orders',
  imports: [CommonModule, FormsModule, RecurringSeriesPanelComponent],
  templateUrl: './orders.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./orders.component.scss']
})
export class OrdersComponent implements OnInit, AfterViewInit, OnDestroy {
  private adminService = inject(AdminService);
  private orderService = inject(OrderService);
  private cleanerService = inject(CleanerService);
  private bookingService = inject(BookingService);
  orderReminderService = inject(OrderReminderService);
  newOrderNotificationService = inject(NewOrderNotificationService);
  private bubbleRewardsService = inject(BubbleRewardsService);
  private billingService = inject(BillingService);
  private cdr = inject(ChangeDetectorRef);
  private shiftService = inject(ShiftService);
  private invoiceService = inject(InvoiceService);
  private customerInvoiceService = inject(CustomerInvoiceService);

  private readonly appRef = inject(ApplicationRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  // ── Regular / Commercial sub-tabs (2026-10) ──
  /** Which sub-tab is showing. Mirrored into `?ordersTab=` so Back and refresh restore it. */
  readonly ordersSubTab = signal<OrdersSubTab>('regular');
  /** The view state each sub-tab had when the admin last left it. */
  private readonly subTabViewStates = new Map<OrdersSubTab, OrdersListViewState>();
  readonly regularOrderCount = computed(() => this.orders().filter(o => !o.isCommercial).length);
  readonly commercialOrderCount = computed(() => this.orders().filter(o => !!o.isCommercial).length);
  readonly ordersSubTabs: ReadonlyArray<{ key: OrdersSubTab; label: string }> = [
    { key: 'regular', label: 'Regular' },
    { key: 'commercial', label: 'Commercial' }
  ];
  /** The order whose Regular/Commercial move is on the wire. */
  readonly movingOrderTypeId = signal<number | null>(null);

  // ── Change requests on the open order (edits + Done requests, any status) ──
  readonly orderChangeRequests = signal<OrderChangeRequest[]>([]);
  /** Decided requests are kept short; waiting ones are always listed. */
  readonly showAllOrderChangeRequests = signal(false);
  readonly tableWrapper = viewChild<ElementRef<HTMLDivElement>>('tableWrapper');
  readonly tableHeader = viewChild<ElementRef<HTMLTableSectionElement>>('tableHeader');

  readonly openOrderId = input<number | null>(null);

  readonly orders = signal<AdminOrderList[]>([], { equal: () => false });
  readonly selectedOrder = signal<Order | null>(null, { equal: () => false });
  /** User id whose flag is mid-update (disables the panel flag buttons). */
  readonly flaggingOrderUserId = signal<number | null>(null);
  readonly viewingOrderId = signal<number | null>(null);

  // ── Internal order note (admin-only free text, above Assigned Cleaners) ──
  readonly orderNoteMaxLength = 2000;
  /** What the textarea is bound to. Never null, so the counter and length checks stay simple. */
  readonly orderNoteDraft = signal('');
  /** Last saved text, used to tell an unchanged draft from an edited one. */
  private readonly orderNoteSaved = signal('');
  readonly orderNoteUpdatedAt = signal<string | null>(null);
  readonly orderNoteUpdatedByName = signal<string | null>(null);
  readonly loadingOrderNote = signal(false);
  readonly savingOrderNote = signal(false);
  readonly orderNoteError = signal('');
  readonly orderNoteSuccess = signal('');

  // ── Order cleaning photos (shared with the per-user photo library) ──
  readonly orderPhotos = signal<UserCleaningPhoto[]>([]);
  readonly loadingOrderPhotos = signal(false);
  readonly uploadingOrderPhoto = signal(false);
  readonly orderPhotoProgress = signal('');
  readonly orderPhotoError = signal('');
  readonly orderPhotoSuccess = signal('');
  readonly lightboxOrderPhoto = signal<UserCleaningPhoto | null>(null);

  // SuperAdmin order deletion
  readonly deletingOrder = signal(false);

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
  readonly searchTerm = signal<string>('');
  readonly statusFilter = signal<string>('all');
  readonly dateFilter = signal<string>('all');
  // Specific-days window, active when dateFilter === 'custom'. yyyy-MM-dd strings from the
  // date inputs; both bounds inclusive. Same date in both = a single specific day.
  readonly customDateFrom = signal<string>('');
  readonly customDateTo = signal<string>('');
  // Service-type filter. Values are the canonical category keys produced by
  // getServiceTypeFilterKey() — residential splits into 'deep'/'regular'.
  readonly serviceTypeFilter = signal<string>('all');
  // Who created the order: 'admin' = created via the admin create-for-user flow,
  // 'user' = the customer booked it themselves.
  readonly bookedByFilter = signal<string>('all');

  // ── Export (SuperAdmin-only), mirrors the users-tab export ──
  readonly showExportModal = signal(false);
  readonly exporting = signal(false);
  readonly exportError = signal('');
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
  readonly sortColumn = signal<string>('serviceDate');
  readonly sortDirection = signal<'asc' | 'desc'>('desc');
  
  // Permissions
  readonly userRole = signal<string>('');
  readonly userPermissions = signal<UserPermissions>({
    role: '',
    permissions: {
      canView: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canActivate: false,
      canDeactivate: false
    }
  }, { equal: () => false });

  // UI State
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  
  // Store customer names and details
  customerNames: Map<number, string> = new Map();
  customerDetails: Map<number, {id: number, email: string}> = new Map();
  
  // Pagination
  readonly currentPage = signal(1);
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
  readonly showDoneModal = signal(false);
  readonly doneModalOrder = signal<AdminOrderList | null>(null);
  /** Optional note for the reviewer when the Done modal sends a REQUEST. */
  readonly doneRequestReason = signal('');
  sendingReview = false;

  // Phase 1 manual payment tracking — Done modal payment method block.
  // Pre-filled from the order's current PaymentMethod when the modal opens, so admin can
  // either accept it (e.g. Pending Zelle order with reference already recorded) or change
  // if the customer ended up paying differently.
  paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  readonly donePaymentMethod = signal<PaymentMethodValue>('Normal');
  readonly donePaymentReference = signal('');
  readonly donePaymentNotes = signal('');

  // Payment Method filter dropdown (Phase 1)
  readonly paymentMethodFilter = signal<string>('all');

  // Cancel order modal
  readonly showAdminCancelModal = signal(false);
  readonly adminCancelOrderId = signal<number | null>(null);
  readonly adminCancelReason = signal('');

  // New properties for cleaner assignment
  readonly showCleanerModal = signal(false);
  readonly availableCleaners = signal<AvailableCleaner[]>([]);
  /** Filters the assign-cleaners modal list by name or email (client-side). */
  readonly cleanerAssignmentSearchQuery = signal('');
  /** When true, the assign list also shows cleaners marked busy that day (still assignable). */
  readonly showBusyCleaners = signal(false);
  /** The admin has read the same-day conflict warning on the cleaners they picked and wants
   *  them anyway. Reset every time the modal opens or closes — an acknowledgement belongs to
   *  the selection it was given for, never to the next one. */
  readonly acknowledgeScheduleConflicts = signal(false);
  readonly selectedCleaners = signal<number[]>([], { equal: () => false });
  readonly tipsForCleaner = signal('');
  readonly assigningOrderId = signal<number | null>(null);
  readonly assignedCleanersCache = signal<Map<number, AssignedCleanerAdmin[]>>(new Map(), { equal: () => false });
  /** Tracks which orders have had their cleaners loaded (to distinguish "loading" from "not assigned") */
  readonly cleanersLoadedSet = signal<Set<number>>(new Set(), { equal: () => false });
  /** Cached resolved residential variant for list rows (without opening details). */
  readonly residentialVariantCache = signal<Map<number, 'Deep' | 'Regular'>>(new Map(), { equal: () => false });
  /** The per-cleaner wage breakdown for the order whose detail panel is open. */
  readonly selectedOrderPayroll = signal<OrderCleanerPayroll | null>(null, { equal: () => false });
  readonly loadingOrderPayroll = signal(false);

  // ── Editing the wage breakdown, mirroring the Outgoing Payments panel ──────────────
  //
  // TWO editors of the same shape — one line, or everybody — each holding BOTH figures. It was
  // briefly three controls ("change the rate for all" / "change the hours for all" as separate
  // buttons), which made an admin decide what KIND of change they were making before they could
  // type anything, when the answer is usually "both". Both go through the same server-side
  // service the Outgoing Payments page writes with, so the two screens can never record the same
  // change differently.
  //
  // Only ONE editor is open at a time (each start* closes the other): two half-typed figures on
  // screen invite saving the wrong one.

  /** `orderCleanerId` of the line being edited, or null. Unassigned slots are never editable. */
  readonly payrollEditingCleanerId = signal<number | null>(null);
  readonly payrollEditRate = signal<number | null>(null);
  /** Decimal hours, matching the "$21 × 4.25" working the row prints. Converted to minutes on save. */
  readonly payrollEditHours = signal<number | null>(null);

  /** The order-level editor: hours for every assigned cleaner, plus the order's default rate. */
  readonly editingPayrollForAll = signal(false);
  readonly payrollAllHoursInput = signal<number | null>(null);
  readonly payrollAllRateInput = signal<number | null>(null);
  /**
   * What the for-all editor was SEEDED with, so the save can send only what actually moved.
   *
   * This is load-bearing rather than tidiness: the hours box is seeded with the AUTOMATIC split,
   * and sending it back unchanged would write an explicit override of that figure onto every
   * line. An explicit value stays put when the order is re-priced; a null keeps tracking it. So
   * an admin who only meant to change the rate must not silently pin everyone's hours.
   */
  private payrollAllSeed: { hours: number | null; rate: number | null } = { hours: null, rate: null };

  readonly savingPayroll = signal(false);
  /** Kept out of `errorMessage`: it belongs beside the block that failed, not in the page banner. */
  readonly payrollError = signal('');
  /**
   * Staffing warnings by order id, for the table's ⚠ tooltip and the detail panel's warning
   * block. Loaded in one bulk request alongside the orders (Admin + SuperAdmin — unlike the wage
   * breakdown above, which is SuperAdmin-only).
   *
   * Orders with nothing wrong are ABSENT rather than mapped to an empty array, and
   * `staffingWarningsLoaded` is what separates "checked, all clear" from "not asked yet" — the
   * same distinction the panel already draws for the payroll block.
   */
  readonly staffingWarningsByOrderId = signal<Map<number, string[]>>(new Map(), { equal: () => false });
  private staffingWarningsLoaded = false;
  // Hourly rate shown in the assign modal; set per order from getDefaultHourlyRate() on open.
  readonly cleanerHourlySalary = signal<number>(REGULAR_CLEANER_HOURLY_RATE);

  readonly loadingStates = signal({
    orders: false,
    orderDetails: false,
    assignedCleaners: false,
    assigningCleaners: false,
    removingCleaner: false,
    sendAssignmentMails: false,
    sendPaymentLink: false,
    chargingSavedCard: false,
    resendingConfirmation: false,
    partialPayment: false
  }, { equal: () => false });

  // Card on file for the open order's owner (Charge button). Loaded when the details
  // panel opens; null until then / when the owner has no saved card.
  readonly orderSavedCardInfo = signal<AdminOrderSavedCardInfo | null>(null);
  private readonly resendingCleanerEmailKeys = signal(new Set<string>(), { equal: () => false });

  // "Send Payment Link" modal — re-sends the original payment-link email/SMS to the
  // customer's current account contact (after an admin fixes a mistyped email/phone).
  readonly showSendPaymentLinkModal = signal(false);
  readonly sendPaymentLinkChannels = signal({ email: true, sms: true });

  readonly orderUpdateHistory = signal<OrderUpdateHistory[]>([]);
  readonly loadingUpdateHistory = signal(false);

  // Pending order edits. Reviewed by anyone who may apply an order edit directly (SuperAdmin, or
  // an Admin granted it); every other Admin only submits them.
  readonly pendingOrderEdits = signal<PendingOrderEditListDto[]>([]);
  loadingPendingEdits = false;
  readonly selectedPendingEdit = signal<PendingOrderEditDetailDto | null>(null);
  readonly loadingPendingEditDetail = signal(false);
  readonly approvingPendingId = signal<number | null>(null);
  readonly rejectingPendingId = signal<number | null>(null);
  /** Map extraServiceId -> name for showing "Extra (new)" label in pending edit diff. */
  readonly extraServiceNamesMap = signal<Map<number, string>>(new Map());
  /** Map extraServiceId -> true if extra uses hours (for "(hours/cost)" vs "(qty/cost)" label). */
  readonly extraServiceHasHoursMap = signal<Map<number, boolean>>(new Map());

  // Save-confirmation modal — shown to whoever saves an order edit DIRECTLY (SuperAdmin, or an
  // Admin granted it). It lists the same change rows a SuperAdmin sees when approving another
  // admin's edit, so nobody applies an order change without reading it first. Admins who still
  // need approval skip this: their submission is reviewed on the other side.
  readonly showSaveConfirm = signal(false);
  /** The DTO built from the open edit form, held until the confirmation is accepted. */
  pendingSaveDto: SuperAdminUpdateOrderDto | null = null;
  /** Diff rows computed once when the modal opens, not re-derived per change-detection pass. */
  readonly saveConfirmChanges = signal<OrderEditChange[]>([]);

  // ── Editable Total (tax-inclusive, discount-aware) ──
  //
  // The admin can type what the customer should pay instead of working back from a subtotal, the
  // same way Custom Pricing works at booking. The typed figure is what the CUSTOMER PAYS: tax
  // included, this order's discounts applied, bubble points / reward balance already deducted,
  // tips excluded. Only a gift card takes the field read-only — see canEditTotalDirectly.
  /** What the Total input shows and edits: the tip-free total. Kept in sync by recalculateEditPricing. */
  readonly editOrderTotalInput = signal<number | null>(null);
  /**
   * The exact tax this order is priced with, plus the discounted subtotal it was split out of.
   * Both travel to the server, which honours the tax only if the base still matches — so a stale
   * override can never silently mis-price an order.
   *
   * Set when the admin types a Total, AND seeded from the order's OWN stored tax on open (see
   * resolveStoredTaxOverride) so merely opening the editor cannot move what the customer pays.
   */
  editOrderTaxOverride: { tax: number; base: number } | null = null;
  /**
   * True once the admin TYPES a price (SubTotal or Total) in this editing session, and false again
   * the moment the lines re-price it. Sent as priceTypedByAdmin: without it the server prices the
   * order from its lines and ignores the posted subtotal (2026-10).
   */
  editOrderPriceTyped = false;

  // SuperAdmin full order edit
  readonly editingOrder = signal(false);
  readonly editOrderForm = signal<Partial<SuperAdminUpdateOrderDto>>({}, { equal: () => false });
  // Service time is edited as 12-hour + AM/PM (admins misread a 24-hour field and booked
  // 08:00 jobs at 20:00). `editOrderForm.serviceTime` stays the 24-hour "HH:mm" the API
  // expects - these three are only the picker, recomposed by onEditServiceTimeChange().
  readonly editTimeHour12 = signal<number | null>(null);
  readonly editTimeMinute = signal(0);
  readonly editTimeMeridiem = signal<'AM' | 'PM'>('AM');
  readonly editTimeHourOptions = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  readonly editTimeMinuteOptions = signal<number[]>([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  readonly savingOrder = signal(false);
  editOrderFormOriginalSubTotal = 0;
  editOrderFormOriginalDiscount = 0;
  editOrderFormOriginalSubscriptionDiscount = 0;
  // Loyalty Discount: amount is the snapshot at booking time, percentage is the locked
  // multiplier we re-apply on subtotal edits (subscription/promo use a ratio because they
  // can be flat-dollar; loyalty is always %-based per spec section 4.5).
  editOrderFormOriginalLoyaltyDiscount = 0;
  readonly editOrderFormOriginalLoyaltyPercentage = signal(0);
  // Gift card on edit: available balance (current remaining + what this order already used) so a
  // price increase can be re-drawn from leftover funds before charging the customer. Mirrors the
  // user order-edit page; matches the backend ApplyEditGiftCardAsync re-resolution.
  readonly editGiftCardCode = signal<string | null>(null);
  readonly editGiftCardOriginalUsed = signal(0);
  readonly editGiftCardAvailableBalance = signal(0);
  readonly editGiftCardAmountToUse = signal(0);
  editOrderFormPrevServiceQuantities: number[] = [];
  editOrderFormPrevExtraQuantities: number[] = [];
  editOrderFormPrevExtraHours: number[] = [];
  /**
   * Remembers the Sq.ft value a bedroom raise is ABOUT to overwrite, so reducing bedrooms back
   * to that exact count restores it instead of landing on the (lower) floor. Once a raise snaps
   * Sq.ft onto the new floor, the value is numerically indistinguishable from "was tracking the
   * floor" — resolveSquareFeetForBedroomChange alone can't tell those apart on the way back down,
   * so this survives across the whole up/down chain until either bedrooms return to this exact
   * count (restored, baseline kept) or the admin types a Sq.ft value directly (baseline cleared —
   * that keystroke is a new deliberate choice, not the one being remembered).
   */
  private editOrderFormSqftBaseline: { bedrooms: number; sqft: number } | null = null;

  // Floor type edit state for admin edit form
  readonly editFloorTypes = signal<string[]>([]);
  readonly editFloorTypeOther = signal<string>('');
  /** Extras available for the order's service type (for Add extra service dropdown). */
  readonly editOrderAvailableExtras = signal<ExtraService[]>([]);
  readonly serviceTypesCache = signal<ServiceType[]>([]);

  // Booking-consistent tax rate from the shared calculator
  private readonly salesTaxRate = SALES_TAX_RATE;

  // Bubble Points settings (for estimated pts display in edit form)
  pointsPerDollar = 0;
  readonly pointsEnabled = signal(false);
  readonly editEstimatedPoints = signal(0);

  // Statistics for SuperAdmin
  readonly isSuperAdmin = signal(false);
  /**
   * True when this user's order edits are applied on save instead of being sent to a SuperAdmin
   * for approval — always for SuperAdmins, and for Admins a SuperAdmin has granted it. Resolved
   * server-side by the permissions endpoint (Helpers/OrderEditApprovalPolicy) so a grant made
   * mid-session takes effect on the next page load; shared/order-edit-approval.policy.ts is the
   * client-side mirror used when only a user object is at hand.
   */
  readonly canSaveOrderEditsDirectly = signal(false);
  /** True if user can edit orders: direct save, or Admin submitting for approval. */
  get canEditOrder(): boolean {
    return this.isSuperAdmin() || (this.userRole() === 'Admin' && this.userPermissions().permissions.canUpdate);
  }
  /** True if user may re-label a custom ("Pre-Arranged") order: SuperAdmin or any Admin (direct
   *  save) — independent of the canUpdate permission, matching the backend's role-only gate. */
  readonly canEditCustomServiceName = computed<boolean>(() => this.isSuperAdmin() || this.userRole() === 'Admin');
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
  readonly availableAdmins = signal<ShiftAdmin[]>([]);
  readonly showAssignedAdminEditor = signal(false);
  readonly isSavingAssignedAdmin = signal(false);

  // Booked-by pill: SuperAdmin toggle to backfill orders that predate BookedByAdminUserId.
  readonly isSavingBookedBy = signal(false);

  // SuperAdmin-only editor for an existing custom ("Pre-Arranged") order's display name.
  showCustomServiceNameEditor = false;
  readonly isSavingCustomServiceName = signal(false);

  // ── SuperAdmin order transfer (move order to another customer, undoable) ──
  readonly showTransferPanel = signal(false);
  readonly transferSearchTerm = signal('');
  transferCandidates: UserAdmin[] = [];      // all active customers (lazy-loaded on first open)
  readonly transferSearchResults = signal<UserAdmin[]>([]);
  readonly transferTargetUser = signal<UserAdmin | null>(null);
  readonly transferNotes = signal('');
  readonly isTransferring = signal(false);
  readonly loadingTransferCandidates = signal(false);
  readonly orderTransfers = signal<OrderTransferInfo[]>([]);
  readonly undoingTransferId = signal<number | null>(null);
  readonly transferError = signal('');

  // ── SuperAdmin refunds (money back to the customer's card) ──
  // refundSummary.remainingRefundable comes live from the payment provider, so it already
  // reflects refunds issued outside this panel — it is the only cap the UI trusts.
  readonly refundSummary = signal<OrderRefundSummary | null>(null);
  readonly loadingRefunds = signal(false);
  readonly showRefundModal = signal(false);
  readonly refundMode = signal<'full' | 'partial'>('full');
  readonly refundAmountInput = signal<number | null>(null);
  readonly refundReason = signal('');
  readonly refundSendEmail = signal(true);
  /** Second step of the modal — the admin has to confirm before any money moves. */
  readonly refundConfirming = signal(false);
  readonly isRefunding = signal(false);
  readonly refundError = signal('');
  /** Set when the modal was opened from a table row rather than the detail panel, so the
   *  modal has an order to name and submit against without the panel being open. */
  readonly refundTargetOrder = signal<AdminOrderList | null>(null);
  /** "Sync from Stripe" — imports refunds issued in the Stripe Dashboard. */
  readonly isSyncingRefunds = signal(false);
  /** Per-refund-row manual email send; holds the row id in flight. */
  readonly sendingRefundEmailId = signal<number | null>(null);

  // ── SuperAdmin soft-hide (view filter only; never touches order data or revenue) ──
  /** "Show hidden orders" filter. Visible to every admin role — all roles can VIEW hidden
   *  orders, only SuperAdmin can hide/unhide. Toggling reloads from the server. */
  readonly showHiddenOrders = signal(false);
  readonly hideConfirmOrder = signal<AdminOrderList | null>(null);
  readonly isHidingOrder = signal(false);

  ngOnInit() {
    this.applyOrdersSubTab(this.parseOrdersSubTab(this.route.snapshot.queryParamMap.get('ordersTab')), false);
    // Back / Forward between the sub-tabs changes only the query string; follow it.
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const tab = this.parseOrdersSubTab(params.get('ordersTab'));
        if (tab !== this.ordersSubTab()) this.applyOrdersSubTab(tab, false);
      });
    this.loadUserPermissions();
    this.bubbleRewardsService.getSummary().subscribe({
      next: (s) => {
        this.pointsPerDollar = s.guide?.pointsPerDollar ?? 0;
        this.pointsEnabled.set(s.pointsSystemEnabled ?? false);
      },
      error: () => {}
    });
  }

  // ── SuperAdmin order transfer ──

  resetTransferPanel(): void {
    this.showTransferPanel.set(false);
    this.transferSearchTerm.set('');
    this.transferSearchResults.set([]);
    this.transferTargetUser.set(null);
    this.transferNotes.set('');
    this.transferError.set('');
    this.orderTransfers.set([]);
  }

  loadOrderTransfers(orderId: number): void {
    this.adminService.getOrderTransfers(orderId).subscribe({
      next: (transfers) => {
        // Ignore late responses after the admin switched to a different order.
        if (this.viewingOrderId() === orderId) this.orderTransfers.set(transfers);
      },
      error: () => { /* non-fatal: panel simply shows no history */ }
    });
  }

  toggleTransferPanel(): void {
    if (!this.isSuperAdmin()) return;
    this.showTransferPanel.set(!this.showTransferPanel());
    this.transferError.set('');
    if (this.showTransferPanel() && this.transferCandidates.length === 0 && !this.loadingTransferCandidates()) {
      this.loadingTransferCandidates.set(true);
      this.adminService.getUsers().subscribe({
        next: (response: any) => {
          const list: UserAdmin[] = Array.isArray(response) ? response : (response?.users ?? []);
          this.transferCandidates = list.filter(u => u.role === 'Customer' && u.isActive);
          this.loadingTransferCandidates.set(false);
          this.filterTransferCandidates();
        },
        error: () => { this.loadingTransferCandidates.set(false); }
      });
    }
  }

  onTransferSearchInput(value: string): void {
    this.transferSearchTerm.set(value);
    this.transferTargetUser.set(null);
    this.filterTransferCandidates();
  }

  private filterTransferCandidates(): void {
    const search = this.transferSearchTerm().toLowerCase().trim();
    const currentOwnerId = this.selectedOrder()?.userId;
    const pool = this.transferCandidates.filter(u => u.id !== currentOwnerId);
    if (!search) {
      this.transferSearchResults.set(pool.slice(0, 8));
      return;
    }
    this.transferSearchResults.set(pool.filter(u =>
      (u.email || '').toLowerCase().includes(search) ||
      u.firstName.toLowerCase().includes(search) ||
      u.lastName.toLowerCase().includes(search) ||
      u.id.toString().includes(search)
    ).slice(0, 8));
  }

  selectTransferTarget(user: UserAdmin): void {
    this.transferTargetUser.set(user);
    this.transferSearchResults.set([]);
  }

  clearTransferTarget(): void {
    this.transferTargetUser.set(null);
    this.transferSearchTerm.set('');
    this.filterTransferCandidates();
  }

  transferUserLabel(user: UserAdmin): string {
    const emailLabel = user.isNoEmailUser ? 'No email' : (user.email || '—');
    return `${user.firstName} ${user.lastName} (${emailLabel}, ID ${user.id})`;
  }

  submitTransfer(): void {
    const target = this.transferTargetUser();
    if (!this.selectedOrder() || !target || this.isTransferring()) return;
    if (!confirm(`Transfer order #${this.selectedOrder()!.id} and everything it earned (points, spent amount, photos, address) to ${target.firstName} ${target.lastName}? This is recorded in Audit logs and can be undone.`)) {
      return;
    }
    this.isTransferring.set(true);
    this.transferError.set('');
    const orderId = this.selectedOrder()!.id;
    this.adminService.transferOrder(orderId, target.id, this.transferNotes().trim() || undefined).subscribe({
      next: () => {
        this.isTransferring.set(false);
        this.successMessage.set(`Order #${orderId} transferred to ${target.firstName} ${target.lastName}.`);
        setTimeout(() => { this.successMessage.set(''); }, 5000);
        this.showTransferPanel.set(false);
        this.transferTargetUser.set(null);
        this.transferNotes.set('');
        // Refresh the details panel + list so the new owner shows everywhere.
        this.loadOrderTransfers(orderId);
        this.refreshSelectedOrderAfterTransfer(orderId);
      },
      error: (err) => {
        this.isTransferring.set(false);
        this.transferError.set(err.error?.message || 'Transfer failed.');
      }
    });
  }

  undoTransfer(transfer: OrderTransferInfo): void {
    if (this.undoingTransferId() !== null) return;
    if (!confirm(`Undo the transfer of order #${transfer.orderId} to ${transfer.toUserName}? Everything moves back to ${transfer.fromUserName}.`)) {
      return;
    }
    this.undoingTransferId.set(transfer.id);
    this.transferError.set('');
    this.adminService.undoOrderTransfer(transfer.id).subscribe({
      next: () => {
        this.undoingTransferId.set(null);
        this.successMessage.set(`Transfer undone — order #${transfer.orderId} is back with ${transfer.fromUserName}.`);
        setTimeout(() => { this.successMessage.set(''); }, 5000);
        this.loadOrderTransfers(transfer.orderId);
        this.refreshSelectedOrderAfterTransfer(transfer.orderId);
      },
      error: (err) => {
        this.undoingTransferId.set(null);
        this.transferError.set(err.error?.message || 'Undo failed.');
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
    const orderId = this.selectedOrder()?.id;
    if (!this.isSuperAdmin() || orderId == null || this.isSyncingRefunds()) return;

    this.isSyncingRefunds.set(true);
    this.refundError.set('');

    this.adminService.syncOrderRefunds(orderId).subscribe({
      next: (result) => {
        this.isSyncingRefunds.set(false);

        if (result.summary && this.viewingOrderId() === orderId) {
          this.refundSummary.set(result.summary);
        }

        if (result.success) {
          this.successMessage.set(result.message);
          // Longer than usual: the dispute warning is appended to this message and is worth reading.
          setTimeout(() => { this.successMessage.set(''); }, result.hasDispute ? 15000 : 8000);
          // An import can flip the order to Refunded and move the revenue totals.
          if (result.refundsImported > 0) this.loadOrders();
          if (result.refundsImported > 0 && this.selectedOrder()?.id === orderId) this.refreshOrderAfterSave();
        } else {
          this.refundError.set(result.message);
        }
      },
      error: (err) => {
        this.isSyncingRefunds.set(false);
        this.refundError.set(err.error?.message || 'Could not reach Stripe. Please try again.');
      }
    });
  }

  /** Send the customer's refund confirmation for one history row, on explicit request. */
  sendRefundEmail(refund: OrderRefundInfo): void {
    const orderId = this.selectedOrder()?.id;
    if (!this.isSuperAdmin() || orderId == null || this.sendingRefundEmailId() !== null) return;

    this.sendingRefundEmailId.set(refund.id);
    this.refundError.set('');

    this.adminService.sendRefundEmail(orderId, refund.id).subscribe({
      next: (result) => {
        this.sendingRefundEmailId.set(null);
        if (result.summary && this.viewingOrderId() === orderId) this.refundSummary.set(result.summary);
        if (result.success) {
          this.successMessage.set(result.message);
          setTimeout(() => { this.successMessage.set(''); }, 6000);
        } else {
          this.refundError.set(result.message);
        }
      },
      error: (err) => {
        this.sendingRefundEmailId.set(null);
        this.refundError.set(err.error?.message || 'The email could not be sent.');
      }
    });
  }

  resetRefundState(): void {
    this.refundSummary.set(null);
    this.isSyncingRefunds.set(false);
    this.sendingRefundEmailId.set(null);
    this.showRefundModal.set(false);
    this.refundMode.set('full');
    this.refundAmountInput.set(null);
    this.refundReason.set('');
    this.refundSendEmail.set(true);
    this.refundConfirming.set(false);
    this.isRefunding.set(false);
    this.refundError.set('');
    this.refundTargetOrder.set(null);
  }

  loadOrderRefunds(orderId: number): void {
    this.loadingRefunds.set(true);
    this.adminService.getOrderRefunds(orderId).subscribe({
      next: (summary) => {
        // Ignore late responses after the admin switched to a different order.
        if (this.viewingOrderId() === orderId) this.refundSummary.set(summary);
        this.loadingRefunds.set(false);
      },
      error: () => {
        // Non-fatal: the refund section simply stays hidden rather than breaking the panel.
        this.loadingRefunds.set(false);
      }
    });
  }

  /** True only when the loaded summary belongs to the order currently in the detail panel.
   *  Refunding from a table row overwrites refundSummary, so without this check the open panel
   *  could briefly render another order's refund figures. */
  get refundSummaryMatchesPanel(): boolean {
    return !!this.refundSummary() && !!this.selectedOrder()
      && this.refundSummary()!.orderId === this.selectedOrder()!.id;
  }

  /** Refund button shows only when the provider says there is money left to give back. */
  get canRefundSelectedOrder(): boolean {
    return this.isSuperAdmin() && this.refundSummaryMatchesPanel && !!this.refundSummary()?.canRefund;
  }

  get maxRefundable(): number {
    return this.refundSummary()?.remainingRefundable ?? 0;
  }

  /** The order the open refund modal acts on — a table row when launched from the list,
   *  otherwise the order in the detail panel. */
  get refundOrderId(): number | null {
    return this.refundTargetOrder()?.id ?? this.selectedOrder()?.id ?? null;
  }

  get refundOrderCustomerName(): string {
    const target = this.refundTargetOrder();
    if (target) return `${target.contactFirstName} ${target.contactLastName}`.trim();
    if (this.selectedOrder()) return `${this.selectedOrder()!.contactFirstName} ${this.selectedOrder()!.contactLastName}`.trim();
    return 'the customer';
  }

  get refundOrderCustomerEmail(): string {
    return this.refundTargetOrder()?.contactEmail || this.selectedOrder()?.contactEmail || 'the customer';
  }

  openRefundModal(): void {
    if (!this.canRefundSelectedOrder) return;
    this.refundTargetOrder.set(null);   // detail-panel path: submit against selectedOrder
    this.showRefundModal.set(true);
    this.refundMode.set('full');
    this.refundAmountInput.set(this.maxRefundable);
    this.refundReason.set('');
    this.refundSendEmail.set(true);
    this.refundConfirming.set(false);
    this.refundError.set('');
  }

  /**
   * Refund straight from a table row, without opening the detail panel. The refundable ceiling
   * is not in the list payload (it comes live from the payment provider), so it is fetched first
   * and the modal only opens once we know there is something to refund.
   */
  openRefundModalForOrder(order: AdminOrderList): void {
    if (!this.isSuperAdmin() || this.loadingRefunds()) return;

    this.refundTargetOrder.set(order);
    this.refundSummary.set(null);
    this.refundError.set('');
    this.loadingRefunds.set(true);

    this.adminService.getOrderRefunds(order.id).subscribe({
      next: (summary) => {
        this.loadingRefunds.set(false);
        // The admin may have clicked another row while this was in flight.
        if (this.refundTargetOrder()?.id !== order.id) return;

        this.refundSummary.set(summary);

        if (!summary.canRefund) {
          this.refundTargetOrder.set(null);
          this.errorMessage.set(summary.unavailableReason || 'There is nothing to refund on this order.');
          setTimeout(() => { this.errorMessage.set(''); }, 6000);
          return;
        }

        this.showRefundModal.set(true);
        this.refundMode.set('full');
        this.refundAmountInput.set(summary.remainingRefundable);
        this.refundReason.set('');
        this.refundSendEmail.set(true);
        this.refundConfirming.set(false);
      },
      error: () => {
        this.loadingRefunds.set(false);
        this.refundTargetOrder.set(null);
        this.errorMessage.set('Could not check what is refundable on this order. Please try again.');
        setTimeout(() => { this.errorMessage.set(''); }, 6000);
      }
    });
  }

  closeRefundModal(): void {
    // A request is in flight and the money may already be moving — closing now would hide the
    // outcome from the admin.
    if (this.isRefunding()) return;
    this.showRefundModal.set(false);
    this.refundConfirming.set(false);
    this.refundError.set('');
    this.refundTargetOrder.set(null);
  }

  onRefundModeChange(mode: 'full' | 'partial'): void {
    this.refundMode.set(mode);
    this.refundError.set('');
    // Pre-fill partial with the max so the admin edits down rather than typing from scratch.
    this.refundAmountInput.set(this.maxRefundable);
  }

  /** Dollars this submission will refund. Full mode always means the whole remaining balance. */
  get effectiveRefundAmount(): number {
    if (this.refundMode() === 'full') return this.maxRefundable;
    return Number(this.refundAmountInput() ?? 0);
  }

  get refundAmountIsValid(): boolean {
    const amount = this.effectiveRefundAmount;
    // Rounded before comparing so a value like 100.005 can't slip past the cap.
    return amount > 0 && Math.round(amount * 100) <= Math.round(this.maxRefundable * 100);
  }

  /** Step 1 → step 2. Nothing is sent until the admin confirms on the second step. */
  proceedToRefundConfirm(): void {
    if (!this.refundAmountIsValid) {
      this.refundError.set(`Enter an amount between $0.01 and $${this.maxRefundable.toFixed(2)}.`);
      return;
    }
    this.refundError.set('');
    this.refundConfirming.set(true);
  }

  cancelRefundConfirm(): void {
    if (this.isRefunding()) return;
    this.refundConfirming.set(false);
  }

  submitRefund(): void {
    // Guarded rather than merely disabled: a double-click can land before change detection
    // repaints the button, and a duplicate submit here means refunding real money twice.
    const orderId = this.refundOrderId;
    if (this.isRefunding() || orderId === null || !this.refundAmountIsValid) return;
    // Full mode sends null so the server refunds whatever is still refundable at that instant,
    // rather than a stale number this screen read earlier.
    const amount = this.refundMode() === 'full' ? null : Number(this.refundAmountInput());

    this.isRefunding.set(true);
    this.refundError.set('');

    this.adminService.refundOrder(orderId, amount, this.refundReason().trim() || null, this.refundSendEmail()).subscribe({
      next: (result) => {
        this.isRefunding.set(false);

        if (result.summary && this.viewingOrderId() === orderId) {
          this.refundSummary.set(result.summary);
        }

        if (result.success) {
          this.showRefundModal.set(false);
          this.refundConfirming.set(false);
          this.refundTargetOrder.set(null);
          this.successMessage.set(result.message);
          setTimeout(() => { this.successMessage.set(''); }, 8000);
          // A full refund flips the order to Refunded and changes the revenue totals, so the
          // list and its header cards have to come back from the server.
          this.loadOrders();
          if (this.selectedOrder()?.id === orderId) this.refreshOrderAfterSave();
        } else {
          // Covers the partial case too: some money may already have moved, so the modal stays
          // open showing exactly what happened instead of inviting a blind full retry.
          this.refundConfirming.set(false);
          this.refundError.set(result.message);
        }
      },
      error: (err) => {
        this.isRefunding.set(false);
        this.refundConfirming.set(false);
        this.refundError.set(err.error?.message || 'The refund could not be completed. Please try again.');
        // The request may have reached the server before failing — re-read the authoritative
        // state so the admin never retries against a stale balance.
        this.loadOrderRefunds(orderId);
      }
    });
  }

  // ── SuperAdmin soft-hide ──

  /** Reloads from the server — the hidden/visible split is decided by the API, not client-side. */
  toggleShowHiddenOrders(): void {
    this.showHiddenOrders.set(!this.showHiddenOrders());
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
    if (!this.isSuperAdmin() || !this.canHideOrder(order)) return;
    this.hideConfirmOrder.set(order);
  }

  closeHideConfirm(): void {
    if (this.isHidingOrder()) return;
    this.hideConfirmOrder.set(null);
  }

  confirmHideOrder(): void {
    const order = this.hideConfirmOrder();
    if (!order || this.isHidingOrder()) return;

    this.isHidingOrder.set(true);

    this.adminService.hideOrder(order.id).subscribe({
      next: (res) => {
        this.isHidingOrder.set(false);
        this.hideConfirmOrder.set(null);
        this.successMessage.set(res.message);
        setTimeout(() => { this.successMessage.set(''); }, 5000);
        this.loadOrders();
      },
      error: (err) => {
        this.isHidingOrder.set(false);
        this.hideConfirmOrder.set(null);
        this.errorMessage.set(err.error?.message || 'Could not hide the order.');
      }
    });
  }

  /** Unhide needs no confirmation — it only makes a row visible again. */
  unhideOrder(order: AdminOrderList): void {
    if (!this.isSuperAdmin() || this.isHidingOrder()) return;

    this.isHidingOrder.set(true);
    this.adminService.unhideOrder(order.id).subscribe({
      next: (res) => {
        this.isHidingOrder.set(false);
        this.successMessage.set(res.message);
        setTimeout(() => { this.successMessage.set(''); }, 5000);
        this.loadOrders();
      },
      error: (err) => {
        this.isHidingOrder.set(false);
        this.errorMessage.set(err.error?.message || 'Could not restore the order.');
      }
    });
  }

  private refreshSelectedOrderAfterTransfer(orderId: number): void {
    this.adminService.getOrderDetails(orderId).subscribe({
      next: (order) => {
        if (this.viewingOrderId() === orderId) {
          this.selectedOrder.set(order);
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
    this.orderSavedCardInfo.set(null);
    const order = this.selectedOrder();
    // Nothing to ask about for a settled or non-card order.
    if (order && (order.isPaid || (order.paymentMethod && order.paymentMethod !== 'Normal'))) return;
    this.billingService.getAdminOrderSavedCardInfo(orderId).subscribe({
      next: (info) => {
        if (this.viewingOrderId() === orderId) this.orderSavedCardInfo.set(info);
      },
      error: () => { /* no Charge button — everything else still works */ }
    });
  }

  /**
   * The Charge button — the server decides. It is offered only when the customer has a usable
   * card AND has authorised card charges for office-booked orders (with the SMS / fee / Terms
   * consents), and nothing else is paying the order. Otherwise the panel shows why, and the
   * answer is the existing "Send payment link".
   */
  canChargeSavedCard(): boolean {
    const order = this.selectedOrder();
    const info = this.orderSavedCardInfo();
    return !!order && !order.isPaid && !!info && info.featureEnabled && info.hasCard
      && info.hasOfficeAuthorization && !info.unavailableReason;
  }

  /** Why the Charge button is absent, when the customer has a card but it can't be used here. */
  savedCardUnavailableReason(): string | null {
    const info = this.orderSavedCardInfo();
    if (!info || !info.featureEnabled || !info.hasCard || this.selectedOrder()?.isPaid) return null;
    return info.unavailableReason;
  }

  chargeSavedCard(): void {
    const order = this.selectedOrder();
    const info = this.orderSavedCardInfo();
    if (!order || !info || this.loadingStates().chargingSavedCard || !this.canChargeSavedCard()) return;

    const cardLabel = info.last4 ? `card ending ${info.last4}` : 'saved card';
    // The BALANCE DUE — never the order total, which would re-take a deposit already paid.
    const backup = info.backupAllowed ? ' If it is declined, their authorised Backup card will be tried once.' : '';
    if (!confirm(`Charge $${info.amountDue.toFixed(2)} (balance due) to the customer's ${cardLabel} now?${backup}`)) return;

    this.loadingStates().chargingSavedCard = true;
    this.loadingStates.set(this.loadingStates());
    this.successMessage.set('');
    this.errorMessage.set('');

    this.billingService.adminChargeOrder(order.id).subscribe({
      next: (res) => {
        this.loadingStates().chargingSavedCard = false;
        this.loadingStates.set(this.loadingStates());
        // charged=false is a clean outcome (declined / needs the customer present) —
        // the backend message says exactly what happened and the order stays unpaid.
        if (res.charged) {
          this.successMessage.set(res.message);
          setTimeout(() => { this.successMessage.set(''); }, 8000);
        } else {
          this.errorMessage.set(res.message);
        }
        this.refreshSelectedOrderAfterTransfer(order.id);
        this.refreshOrderAfterSave();
      },
      error: (err) => {
        this.loadingStates().chargingSavedCard = false;
        this.loadingStates.set(this.loadingStates());
        // No answer is not a "no": the charge may have gone through with only the response lost.
        // The server's lock refuses a second charge while it finds out, but say so plainly.
        this.errorMessage.set(err.error?.message
          || 'We could not confirm the result of this charge. Do NOT charge again — refresh the order in a minute to see whether it was paid.');
        this.refreshSelectedOrderAfterTransfer(order.id);
      }
    });
  }

  // Assigned-admin pill helpers (mirror order-details.component but local to this view).
  assignedAdminLabel(): string {
    return this.selectedOrder()?.assignedAdminDisplayName?.trim() || 'Unassigned';
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
    if (!this.isSuperAdmin()) return;
    this.showAssignedAdminEditor.set(!this.showAssignedAdminEditor());
  }

  selectAssignedAdminForOrder(adminId: number | null): void {
    if (!this.selectedOrder() || this.isSavingAssignedAdmin()) return;
    if ((this.selectedOrder()!.assignedAdminId ?? null) === adminId) {
      this.showAssignedAdminEditor.set(false);
      return;
    }
    this.isSavingAssignedAdmin.set(true);
    const orderId = this.selectedOrder()!.id;
    this.orderService.setAssignedAdmin(orderId, adminId).subscribe({
      next: (result) => {
        if (this.selectedOrder() && this.selectedOrder()!.id === orderId) {
          this.selectedOrder()!.assignedAdminId = result.adminId ?? null;
          this.selectedOrder.set(this.selectedOrder());
          this.selectedOrder()!.assignedAdminFirstName = result.firstName ?? null;
          this.selectedOrder.set(this.selectedOrder());
          this.selectedOrder()!.assignedAdminLastName = result.lastName ?? null;
          this.selectedOrder.set(this.selectedOrder());
          this.selectedOrder()!.assignedAdminDisplayName = result.displayName ?? null;
          this.selectedOrder.set(this.selectedOrder());
        }
        this.isSavingAssignedAdmin.set(false);
        this.showAssignedAdminEditor.set(false);
      },
      error: () => {
        this.isSavingAssignedAdmin.set(false);
      }
    });
  }

  // Booked-by pill helpers. The value lives on the LIST row (the details DTO doesn't
  // carry it), so read/write the row in `orders` — the filter reacts immediately.
  private get viewedOrderListRow(): AdminOrderList | null {
    return this.orders().find(o => o.id === this.viewingOrderId()) ?? null;
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
    if (!this.userPermissions().permissions.canUpdate || !this.selectedOrder()) return;
    const userId = this.selectedOrder()!.userId;
    if (!userId) return;

    const reason = level === 'None' ? null : (this.selectedOrder()!.flagReason ?? null);
    this.flaggingOrderUserId.set(userId);
    this.adminService.setUserFlag(userId, level, reason).subscribe({
      next: () => {
        if (this.selectedOrder() && this.selectedOrder()!.userId === userId) {
          this.selectedOrder()!.flag = level;
          this.selectedOrder.set(this.selectedOrder());
          this.selectedOrder()!.flagReason = level === 'None' ? null : reason;
          this.selectedOrder.set(this.selectedOrder());
        }
        this.orders().forEach(o => {
          if (o.userId === userId) { o.flag = level; o.flagReason = level === 'None' ? null : reason; }
        });
      },
      complete: () => { this.flaggingOrderUserId.set(null); },
      error: () => { this.flaggingOrderUserId.set(null); }
    });
  }

  toggleBookedByAdmin(): void {
    if (!this.isSuperAdmin() || this.isSavingBookedBy()) return;
    const row = this.viewedOrderListRow;
    if (!row) return;
    this.isSavingBookedBy.set(true);
    this.orderService.setBookedByAdmin(row.id, !row.bookedByAdmin).subscribe({
      next: (result) => {
        // Effective value from the backend — legacy orders with a creation-time
        // manual-payment stamp stay admin-booked even after clearing.
        row.bookedByAdmin = result.bookedByAdmin;
        this.calculateStatistics();
        this.isSavingBookedBy.set(false);
      },
      error: () => {
        this.isSavingBookedBy.set(false);
      }
    });
  }

  /** Whether the open detail order is a custom ("Pre-Arranged") order whose name can be re-labeled. */
  get selectedOrderIsCustomServiceType(): boolean {
    return !!(this.selectedOrder() && (this.selectedOrder() as any).isCustomServiceType);
  }

  /** Display-name options for the custom-service-type editor (Residential -> Regular/Deep). */
  get customServiceNameOptions(): string[] {
    return buildCustomServiceTypeNameOptions(this.serviceTypesCache());
  }

  toggleCustomServiceNameEditor(): void {
    // SuperAdmin and Admins (with update permission) may re-label; others just see the value.
    if (!this.canEditCustomServiceName()) return;
    this.showCustomServiceNameEditor = !this.showCustomServiceNameEditor;
  }

  selectCustomServiceNameForOrder(name: string | null): void {
    if (!this.selectedOrder() || this.isSavingCustomServiceName()) return;
    const current = (this.selectedOrder() as any).customServiceDisplayName ?? null;
    if ((current || null) === (name || null)) {
      this.showCustomServiceNameEditor = false;
      return;
    }
    this.isSavingCustomServiceName.set(true);
    const orderId = this.selectedOrder()!.id;
    this.orderService.setCustomServiceName(orderId, name || null).subscribe({
      next: (result) => {
        if (this.selectedOrder() && this.selectedOrder()!.id === orderId) {
          (this.selectedOrder() as any).customServiceDisplayName = result.customServiceDisplayName;
          this.selectedOrder()!.serviceTypeName = result.serviceTypeName;
          this.selectedOrder.set(this.selectedOrder());
        }
        // Keep the table row in sync so the Service Type column updates without a reload.
        const row = this.orders().find(o => o.id === orderId);
        if (row) {
          row.customServiceDisplayName = result.customServiceDisplayName;
          this.orders.set(this.orders());
          row.serviceTypeName = result.serviceTypeName;
          this.orders.set(this.orders());
        }
        this.residentialVariantCache().delete(orderId);
        this.residentialVariantCache.set(this.residentialVariantCache());
        this.isSavingCustomServiceName.set(false);
        this.showCustomServiceNameEditor = false;
      },
      error: () => {
        this.isSavingCustomServiceName.set(false);
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
    const tableWrapper = this.tableWrapper();
    const tableHeader = this.tableHeader();
    if (!tableWrapper || !tableHeader) {
      setTimeout(() => {
        this.initializeStickyHeader();
      }, 50);
      return;
    }
    
    // Double check elements are in DOM
    if (!tableWrapper.nativeElement || !tableHeader.nativeElement) {
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
    const tableWrapper = this.tableWrapper();
    if (this.horizontalScrollListener && tableWrapper) {
      const wrapperEl = tableWrapper.nativeElement;
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
      const tableHeader = this.tableHeader();
      if (tableHeader && tableHeader.nativeElement.style.position === 'fixed') {
        // Update left position on resize since wrapper position may have changed
        const wrapper = this.tableWrapper()?.nativeElement;
        const header = tableHeader.nativeElement;
        if (wrapper) {
          const wrapperRect = wrapper.getBoundingClientRect();
          header.style.left = `${wrapperRect.left}px`;
        }
        this.syncHorizontalScroll();
      }
    }, 50);
  }

  private setupStickyHeader() {
    const tableWrapper = this.tableWrapper();
    if (!tableWrapper || !this.tableHeader()) {
      return;
    }

    const wrapperEl = tableWrapper.nativeElement;

    // Set up vertical scroll listener for sticky positioning (only once)
    if (!this.scrollListener) {
      this.scrollListener = () => {
        this.updateStickyHeader();
        // Also sync horizontal scroll when vertical scrolling (in case wrapper moved)
        const tableHeader = this.tableHeader();
        if (tableHeader && tableHeader.nativeElement.style.position === 'fixed') {
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
    const tableWrapper = this.tableWrapper();
    const tableHeader = this.tableHeader();
    if (!tableWrapper || !tableHeader) {
      return;
    }

    const wrapper = tableWrapper.nativeElement;
    const header = tableHeader.nativeElement;
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
    const tableWrapper = this.tableWrapper();
    const tableHeader = this.tableHeader();
    if (!tableWrapper || !tableHeader) {
      return;
    }

    const wrapper = tableWrapper.nativeElement;
    const header = tableHeader.nativeElement;
    
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
        this.userRole.set(response.role);
        this.userPermissions.set(response);
        this.isSuperAdmin.set(response.role === 'SuperAdmin');
        // Prefer the server's answer; fall back to the shared rule for an older API response that
        // predates the flag (SuperAdmins still save directly, Admins still submit for approval).
        this.canSaveOrderEditsDirectly.set(response.canSaveOrderEditsDirectly
          ?? canSaveOrderEditsDirectlyFor({ role: response.role }));
        // Admins-list for the assigned-admin pill dropdown. Same source the shifts page uses.
        // Endpoint is Admin/SuperAdmin-only — skip for Moderators (avoids a 403) since they
        // can't reassign anyway.
        if (this.userRole() === 'Admin' || this.isSuperAdmin()) {
          this.shiftService.getShiftAdmins().subscribe({
            next: a => this.availableAdmins.set(a),
            error: () => {}
          });
        }
        this.loadOrders();
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.errorMessage.set('Failed to load permissions. Please try again.');
      }
    });
  }

  /** Opens the Users tab with this customer's account expanded. Always the CUSTOMERS list. */
  openUserInAdmin(userId: number): void {
    window.open('/admin?userId=' + userId + '&usersTab=customers', '_blank');
  }

  /**
   * "View User" for the order on screen — and for a commercial order that means the BUSINESS
   * CLIENT, not the customer list.
   *
   * The old behaviour sent every order to Users → Customers, so opening an invoice-billed
   * cleaning showed a plain customer record with none of the billing entity, contracts or
   * invoices the admin had come to see. The record they want is decided by the ORDER: one billed
   * to a commercial client (or belonging to an account linked to one) opens that client.
   *
   * Both panels now show the other half as well, so landing on either is recoverable — this only
   * decides which one opens first.
   */
  viewOrderCustomer(): void {
    const clientId = this.orderInvoices()?.contractClientId
                  ?? this.orderInvoices()?.suggestedContractClientId
                  ?? null;

    if (clientId) {
      window.open('/admin?clientId=' + clientId, '_blank');
      return;
    }
    if (this.selectedOrder()?.userId) this.openUserInAdmin(this.selectedOrder()!.userId);
  }

  // ── "Send Invoice" — the commercial replacement for Send Payment Link ──────────────────────
  //
  // A cleaning billed on a commercial invoice is never paid through a Stripe payment link: the
  // client receives an invoice and pays it by bank transfer or ACH. Offering the residential link
  // there would send the customer to a checkout for money the invoice is already collecting —
  // which is the same reasoning that suppresses the residential booking confirmation for these
  // orders (ResidentialBookingCommunicationPolicy).
  //
  // NOTHING IS SENT OR CREATED BY OPENING THIS. The panel is a read; sending goes through the
  // existing invoice send endpoint, and creating opens the invoice form as a DRAFT.

  /** Which invoices cover the open order, and which client a new one would bill. */
  readonly orderInvoices = signal<OrderInvoices | null>(null);
  readonly loadingOrderInvoices = signal(false);
  readonly showSendInvoiceModal = signal(false);
  readonly sendingInvoiceId = signal<number | null>(null);

  private loadOrderInvoices(orderId: number): void {
    this.orderInvoices.set(null);
    this.invoiceClientForOrder.set(null);
    this.showSendInvoiceModal.set(false);
    this.sendingInvoiceId.set(null);
    this.loadingOrderInvoices.set(true);

    this.invoiceService.invoicesForOrder(orderId)
      .pipe(finalize(() => this.loadingOrderInvoices.set(false)))
      .subscribe({
        next: res => {
          // The panel may have moved on to another order while this was in flight.
          if (this.viewingOrderId() !== orderId) return;
          this.orderInvoices.set(res);
          this.resolveInvoiceClientForOrder(res);
        },
        // Non-fatal: without it the panel simply keeps offering the payment link, which is the
        // behaviour every order had before this existed.
        error: () => {
          if (this.viewingOrderId() !== orderId) return;
          this.orderInvoices.set(null);
          this.invoiceClientForOrder.set(null);
        }
      });
  }

  /**
   * True when this cleaning is billed commercially and the payment link is the wrong offer.
   *
   * Reads the ORDER's own payment method first — that is the fact that decides — and falls back
   * to "an invoice already covers it", which catches a cleaning adopted by an invoice whose
   * method has not been re-read into the panel yet.
   */
  get isInvoiceBilledOrder(): boolean {
    return this.selectedOrder()?.paymentMethod === 'Invoice'
        || (this.orderInvoices()?.invoices?.length ?? 0) > 0;
  }

  /**
   * True when the order was paid in person — Cash, Zelle, Check or Other. Recording one of those
   * methods MEANS the money has arrived (PaymentMethodRules.IsSettledOnRecord), so the order owes
   * nothing on its own total and must never be offered a payment link or an invoice for it. An
   * admin who switches the method back to card (Normal) or Invoice brings those offers back.
   * Invoice is deliberately NOT in this list: it is outside Stripe but still unpaid.
   */
  get isSettledOffline(): boolean {
    const m = this.selectedOrder()?.paymentMethod;
    return m === 'Cash' || m === 'Zelle' || m === 'Check' || m === 'BankTransfer' || m === 'Other';
  }

  /** The invoices covering the open order, newest first. */
  get coveringInvoices(): LinkedInvoiceSummary[] {
    return this.orderInvoices()?.invoices ?? [];
  }

  /**
   * The client a new invoice for this cleaning would be raised for, if any.
   *
   * A FIELD, not a getter. The template reads it on every change-detection pass, and a getter
   * returning a fresh object literal each time would allocate one per pass for a value that only
   * changes when a different order is opened.
   */
  readonly invoiceClientForOrder = signal<{ id: number; name: string } | null>(null);

  private resolveInvoiceClientForOrder(res: OrderInvoices | null): void {
    const id = res?.contractClientId ?? res?.suggestedContractClientId;
    this.invoiceClientForOrder.set(id
      ? { id, name: res?.clientName || res?.suggestedClientName || 'this client' }
      : null);
  }

  openSendInvoiceModal(): void {
    if (!this.selectedOrder()) return;
    this.showSendInvoiceModal.set(true);
  }

  closeSendInvoiceModal(): void {
    this.showSendInvoiceModal.set(false);
  }

  /**
   * Emails one invoice to its client — the SAME endpoint Commercial → Invoices uses, so sending
   * from here commits the covered cleanings' agreed prices and stamps the invoice Sent exactly as
   * sending it from the invoice page does. There is deliberately no second send path.
   */
  sendInvoiceForOrder(invoice: LinkedInvoiceSummary): void {
    if (this.sendingInvoiceId()) return;

    this.sendingInvoiceId.set(invoice.id);
    this.errorMessage.set('');

    // attachPdf: the client's own copy of the bill travels with the mail, same as sending from
    // the invoice page. An invoice email with no invoice attached is the thing clients reply to.
    this.invoiceService.send(invoice.id, { attachPdf: true })
      .pipe(finalize(() => this.sendingInvoiceId.set(null)))
      .subscribe({
        next: () => {
          this.successMessage.set(`Invoice ${invoice.invoiceNumber} was emailed to ${invoice.clientName}.`);
          this.showSendInvoiceModal.set(false);
          this.clearMessagesAfterDelay();
          // Sending ADOPTS the cleaning — its price, payment method and billing client can all
          // have moved — so both the panel's copy and this list are re-read rather than patched.
          if (this.viewingOrderId()) {
            this.loadOrderInvoices(this.viewingOrderId()!);
            this.refreshSelectedOrderFromServer(this.viewingOrderId()!);
          }
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(
            err, `Invoice ${invoice.invoiceNumber} could not be emailed.`));
        }
      });
  }

  /**
   * Starts a DRAFT invoice for this cleaning. Opens the invoice form with the client selected and
   * the cleaning ticked; nothing is created until the admin saves, and nothing is emailed until
   * they press Send there. That gap is deliberate — an invoice going out with figures nobody
   * reviewed is the failure this flow exists to avoid.
   */
  createInvoiceForOrder(): void {
    const client = this.invoiceClientForOrder();
    if (!client || !this.selectedOrder()) return;

    window.open(
      `/admin/commercial/invoices/create?clientId=${client.id}&orderId=${this.selectedOrder()!.id}`,
      '_blank');
  }

  /** Re-reads the open order after an action that can have changed it server-side. */
  private refreshSelectedOrderFromServer(orderId: number): void {
    this.adminService.getOrderDetails(orderId).subscribe({
      next: order => { if (this.viewingOrderId() === orderId) this.selectedOrder.set(order); },
      error: () => { /* the panel keeps what it has; the list reload below is the safety net */ }
    });
  }

  /**
   * A recurring series just created (or filled in) future orders.
   *
   * The list is reloaded because those orders are real bookings that belong in it immediately —
   * an admin who has just set up a fortnightly clean expects to see the next three appear, and
   * leaving them out until the next refresh reads as the button having failed.
   */
  onRecurringOrdersGenerated(): void {
    this.loadOrders();
  }

  /**
   * Stop recurrence deleted orders. When the order on screen was one of them its panel has nothing
   * left to show, so it closes and the outcome (with any "tell the cleaner" warning) moves to the
   * page banner; otherwise the panel already says so itself.
   */
  onRecurringOrdersDeleted(event: { deletedOrderIds: number[]; warnings: string[] }): void {
    const open = this.selectedOrder();
    if (open && event.deletedOrderIds.includes(open.id)) {
      this.closeOrderDetails();
      this.successMessage.set([`Recurrence stopped. ${event.deletedOrderIds.length} order(s) deleted.`, ...event.warnings].join(' '));
      setTimeout(() => this.clearMessages(), event.warnings.length ? 12000 : 4000);
    }
    this.loadOrders();
  }

  private ordersLoadVersion = 0;

  loadOrders() {
    const version = ++this.ordersLoadVersion;
    this.loadingStates().orders = true;
    this.loadingStates.set(this.loadingStates());
    this.assignedCleanersCache().clear();
    this.assignedCleanersCache.set(this.assignedCleanersCache());
    this.cleanersLoadedSet().clear();
    this.cleanersLoadedSet.set(this.cleanersLoadedSet());
    this.residentialVariantCache().clear();
    this.residentialVariantCache.set(this.residentialVariantCache());
    this.clearMessages();

    if (this.userRole() && this.userRole() !== 'Customer') {
      this.adminService.getAllOrders(this.showHiddenOrders()).subscribe({
        next: (orders) => {
          if (version !== this.ordersLoadVersion) return;
          this.orders.set(orders as AdminOrderList[]);
          this.preloadResidentialVariants();
          this.preloadAssignedCleaners();
          this.preloadStaffingWarnings();
          this.orderReminderService.initialize(this.orders());
          if (this.isSuperAdmin()) {
            this.calculateStatistics();
          }
          // The review queue follows the direct-save grant, not the role: a granted Admin
          // reviews colleagues' submissions, but the header statistics stay SuperAdmin-only.
          this.loadPendingOrderEdits();
          if (this.openOrderId()) {
            setTimeout(() => this.viewOrderDetails(this.openOrderId()!), 100);
          }
        },
        error: (error) => {
          if (version !== this.ordersLoadVersion) return;
          console.error('Error loading orders:', error);
          this.errorMessage.set('Failed to load orders. Please try again.');
        },
        complete: () => {
          if (version !== this.ordersLoadVersion) return;
          this.loadingStates().orders = false;
          this.loadingStates.set(this.loadingStates());
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
          if (version !== this.ordersLoadVersion) return;
          this.orders.set(orders as AdminOrderList[]);
          this.preloadResidentialVariants();
        },
        error: (error) => {
          if (version !== this.ordersLoadVersion) return;
          console.error('Error loading orders:', error);
          this.errorMessage.set('Failed to load orders. Please try again.');
        },
        complete: () => {
          if (version !== this.ordersLoadVersion) return;
          this.loadingStates().orders = false;
          this.loadingStates.set(this.loadingStates());
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
    if (this.orders().length === 0) return;

    this.loadingStates().assignedCleaners = true;
    this.loadingStates.set(this.loadingStates());

    // Single bulk request for ALL orders' cleaners. This used to be an N+1 — one request per
    // order, batched 15 at a time but run sequentially — which took several seconds with many
    // orders. One round-trip now resolves every row's cleaners.
    this.adminService.getAssignedCleanersWithIdsBulk().subscribe({
      next: (cleanersByOrderId) => {
        this.orders().forEach(order => {
          const cleaners = cleanersByOrderId[order.id] ?? cleanersByOrderId[String(order.id)] ?? [];
          this.assignedCleanersCache().set(order.id, cleaners);
          this.cleanersLoadedSet().add(order.id);
        });
        this.assignedCleanersCache.set(this.assignedCleanersCache());
        this.cleanersLoadedSet.set(this.cleanersLoadedSet());
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error preloading assigned cleaners:', error);
        // Mark all orders as loaded (with empty) so they don't stay stuck in the loading state.
        this.orders().forEach(order => this.cleanersLoadedSet().add(order.id));
        this.cleanersLoadedSet.set(this.cleanersLoadedSet());
      },
      complete: () => {
        this.loadingStates().assignedCleaners = false;
        this.loadingStates.set(this.loadingStates());
      }
    });
  }

  /** Admin or SuperAdmin — the two roles the staffing-warnings endpoint accepts. Checked at the
   *  call site so a Moderator never fires a request that can only 403. */
  private readonly canSeeStaffingWarnings = computed<boolean>(() => this.isSuperAdmin() || this.userRole() === 'Admin');

  /**
   * One bulk request for the whole list's staffing warnings, alongside the cleaners preload.
   *
   * Deliberately not per-page: paging, search, status/date filters and sorting are all
   * client-side here and each of them changes the visible rows, so a per-page fetch would have
   * to hook into every one of them and would eventually miss one — leaving a row whose ⚠ has
   * nothing to say. `includeHidden` has to match what the list was loaded with, or a hidden
   * order's row would be the one with no warnings behind it.
   */
  private preloadStaffingWarnings(orderIds?: number[]) {
    if (!this.canSeeStaffingWarnings() || this.orders().length === 0) return;

    this.adminService
      .getOrdersStaffingWarnings(orderIds, this.showHiddenOrders(), !!orderIds)
      .subscribe({
        next: (warningsByOrderId) => this.applyStaffingWarnings(warningsByOrderId, orderIds),
        // Non-fatal and silent, like the payroll breakdown: a failed fetch costs the tooltip its
        // reasons, not the admin their orders list. staffingWarningsLoaded stays false so the
        // panel keeps saying nothing rather than rendering an all-clear it cannot vouch for.
        error: (error) => console.error('Error loading staffing warnings:', error)
      });
  }

  /** Merges a warnings response into the cache. A targeted refresh must CLEAR the ids it asked
   *  about first — an order whose last warning was just resolved comes back absent from the map,
   *  and a plain merge would leave its stale entry in place. */
  private applyStaffingWarnings(warningsByOrderId: OrderStaffingWarningsMap, refreshedIds?: number[]) {
    if (refreshedIds) {
      refreshedIds.forEach(id => this.staffingWarningsByOrderId().delete(id));
      this.staffingWarningsByOrderId.set(this.staffingWarningsByOrderId());
    } else {
      this.staffingWarningsByOrderId().clear();
      this.staffingWarningsByOrderId.set(this.staffingWarningsByOrderId());
    }

    Object.entries(warningsByOrderId ?? {}).forEach(([orderId, warnings]) => {
      if (warnings?.length) this.staffingWarningsByOrderId().set(Number(orderId), warnings);
    });
    this.staffingWarningsByOrderId.set(this.staffingWarningsByOrderId());

    this.staffingWarningsLoaded = true;
    this.cdr.detectChanges();
  }

  /** Preload Deep/Regular variant for residential rows from order details API. */
  private preloadResidentialVariants() {
    const residentialOrders = this.orders().filter(order => this.isResidentialServiceType(order));
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
            this.residentialVariantCache().set(orderId, isDeep ? 'Deep' : 'Regular');
          });
          this.residentialVariantCache.set(this.residentialVariantCache());
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

    // Background enrichment, one batch after another for as long as there are residential orders,
    // so it can easily outlast the 10s hydration window: it starts once the app is first stable
    // (an immediate start when it already is), instead of keeping a freshly loaded /admin
    // unstable until the last batch lands (NG0506).
    this.appRef.whenStable().then(() => loadBatch(0));
  }

  // Bumped whenever order DATA changes (load, status update, edit save) so the
  // memoized stats recompute. Filter-input changes are part of the cache key directly.
  private readonly statsVersion = signal(0);
  private statsCacheKey: string | null = null;
  private statsCache = {
    totalOrders: 0, totalAmount: 0, totalTaxes: 0,
    totalTips: 0, totalAmountWithoutTipsAndTaxes: 0, totalDuration: 0
  };

  /** Existing call sites signal "order data changed" — invalidates the memoized stats. */
  private calculateStatistics() {
    this.statsVersion.update(v => v + 1);
  }

  /** Memoized statistics over the CURRENT filtered orders. Stable within a change-detection
   *  pass (no template-bound state is mutated), which fixes NG0100 on search. */
  private get stats() {
    const key = [
      this.statsVersion(), this.orders().length, this.ordersSubTab(), this.searchTerm(),
      this.statusFilter(), this.paymentMethodFilter(), this.dateFilter(),
      this.customDateFrom(), this.customDateTo(),
      this.serviceTypeFilter(), this.bookedByFilter()
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
        this.assignedCleanersCache().set(orderId, cleaners);
        this.assignedCleanersCache.set(this.assignedCleanersCache());
        this.cleanersLoadedSet().add(orderId);
        this.cleanersLoadedSet.set(this.cleanersLoadedSet());
      },
      error: (error) => {
        console.error(`Error refreshing cleaners for order ${orderId}:`, error);
        this.assignedCleanersCache().set(orderId, []);
        this.assignedCleanersCache.set(this.assignedCleanersCache());
        this.cleanersLoadedSet().add(orderId);
        this.cleanersLoadedSet.set(this.cleanersLoadedSet());
      }
    });
  }

  // ── Part-payments: splitting one order's total across several links (2026-09) ──────────
  //
  // "Can you clarify the amount of the pre-payment needed?" — an admin agrees a deposit on the
  // phone, asks for it here, and the customer gets a link for that amount. The order stays
  // Pending and unpaid, carrying a visible balance, until the last slice lands.
  //
  // Nothing here decides what may be asked for: the amount is validated server-side against the
  // live balance, and this panel only reports what came back. A figure computed here would be
  // the one that drifts from the figure the payment page actually charges.

  /** The open order's balance, live request and history. Null while loading or unavailable. */
  readonly partialBalance = signal<OrderPaymentBalance | null>(null);
  loadingPartialBalance = false;

  /** The "ask for an amount" form. Reset every time the panel opens another order. */
  readonly partialAmountInput = signal<number | null>(null);
  readonly partialNoteInput = signal('');
  readonly partialChannels = signal({ email: true, sms: true });
  readonly partialPaymentMessage = signal('');
  readonly partialPaymentError = signal('');

  private resetPartialPaymentState(): void {
    this.partialBalance.set(null);
    this.loadingPartialBalance = false;
    this.partialAmountInput.set(null);
    this.partialNoteInput.set('');
    this.partialChannels.set({ email: true, sms: true });
    this.partialPaymentMessage.set('');
    this.partialPaymentError.set('');
    this.recordingManualPartialPaymentForId.set(null);
  }

  private loadPartialPayments(orderId: number): void {
    this.resetPartialPaymentState();
    this.loadingPartialBalance = true;
    // Invoice statuses are derived from the same balance, so they are refreshed with it.
    this.loadCustomerInvoices(orderId);
    this.receiptPaymentKeys.set(new Set());
    this.receiptDefaultEmail = '';
    this.sendingReceiptKey.set(null);
    this.loadReceiptPayments(orderId);

    this.adminService.getOrderPartialPayments(orderId)
      .pipe(finalize(() => this.loadingPartialBalance = false))
      .subscribe({
        next: balance => {
          // The panel may have moved on to another order while this was in flight.
          if (this.viewingOrderId() !== orderId) return;
          this.partialBalance.set(balance);
        },
        // Non-fatal: without it the panel simply doesn't offer part-payments, which is how
        // every order behaved before this existed.
        error: () => {
          if (this.viewingOrderId() !== orderId) return;
          this.partialBalance.set(null);
        }
      });
  }

  /** Whether the Payments card has anything to say about this order. */
  get showPartialPaymentsCard(): boolean {
    if (!this.selectedOrder() || !this.partialBalance()) return false;
    // Money has been taken in slices, or slices can still be asked for. A settled order with no
    // part-payment history has nothing here that the existing payment rows don't already say.
    // Also shown when an edit added money AFTER payment, and whenever the order has a regular
    // invoice. (amountPaid is reported for a fully paid order too since 2026-09, so it only
    // counts here while the order is unpaid — otherwise every settled order would grow a card.)
    return this.partialBalance()!.history.length > 0
      || this.partialBalance()!.canRequestPartialPayment
      || (this.partialBalance()!.amountPaid > 0 && !this.selectedOrder()!.isPaid)
      || this.additionalAmountDue > 0
      || this.orderCustomerInvoices().length > 0;
  }

  /** Owed on top of a PAID order because an edit raised its price afterwards. */
  get additionalAmountDue(): number {
    return this.partialBalance()?.additionalAmountDue ?? 0;
  }

  // ── Regular customer invoices from the order panel (2026-09) ──────────────────────────
  //
  // The same invoices Admin → Invoices issues (DCR-…), reachable where the admin is already
  // looking: an order booked with a Stripe pay link can be switched to an invoice, split into
  // several invoices on request, and an amount added after payment can be billed by its own
  // invoice. Every rule (what may be billed, split or combined) is the server's.

  readonly orderCustomerInvoices = signal<CustomerInvoice[]>([]);
  readonly customerInvoiceStatusLabels = CUSTOMER_INVOICE_STATUS_LABELS;
  readonly showCustomerInvoiceModal = signal(false);
  readonly customerInvoiceSplitMode = signal(false);
  readonly customerInvoiceSplitAmounts = signal<(number | null)[]>([null, null], { equal: () => false });
  readonly customerInvoiceNote = signal('');
  readonly customerInvoiceChannels = signal({ email: true, sms: true });
  readonly customerInvoiceBusy = signal(false);
  readonly customerInvoiceActionId = signal<number | null>(null);
  readonly customerInvoiceMessage = signal('');
  readonly customerInvoiceError = signal('');
  readonly customerInvoiceCopiedId = signal<number | null>(null);

  /** Re-reads the balance and invoices WITHOUT resetting the Payments card's form or messages —
   *  the refresh every action ends with, as against loadPartialPayments on opening an order. */
  private refreshPartialBalanceQuietly(orderId: number): void {
    this.loadCustomerInvoices(orderId);
    this.loadReceiptPayments(orderId);
    this.adminService.getOrderPartialPayments(orderId).subscribe({
      next: balance => { if (this.viewingOrderId() === orderId) this.partialBalance.set(balance); },
      error: () => { /* keep what is on screen */ }
    });
  }

  /** Paid, positive top-ups already invoiced by an OPEN Additional invoice — none means the
   *  extra charge still needs one, which is what puts "Create new invoice" on the card. */
  get openAdditionalInvoice(): CustomerInvoice | undefined {
    return this.openCustomerInvoices.find(i => i.kind === 'Additional');
  }

  get canCreateAdditionalInvoice(): boolean {
    return this.canOfferCustomerInvoice && this.additionalAmountDue >= 0.5 && !this.openAdditionalInvoice;
  }

  /**
   * One click: bill the amount an edit added after payment, and send it (email with PDF + SMS).
   * The server decides the amount — it is the outstanding top-up — so nothing is typed here.
   */
  createAdditionalInvoiceNow(): void {
    const order = this.selectedOrder();
    if (!order || this.customerInvoiceBusy() || !this.canCreateAdditionalInvoice) return;
    const amount = this.additionalAmountDue;
    if (!confirm(`Create and send an invoice for $${amount.toFixed(2)} (the amount added after payment)?`)) return;

    this.customerInvoiceBusy.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.customerInvoiceService.create({ orderId: order.id, sendEmail: true, sendSms: true })
      .pipe(finalize(() => this.customerInvoiceBusy.set(false)))
      .subscribe({
        next: res => {
          this.successMessage.set(res.message);
          this.clearMessagesAfterDelay();
          this.refreshOrderAfterSave();
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'The invoice could not be created.'));
          this.clearMessagesAfterDelay();
        }
      });
  }

  /** The assigned cleaner behind a wage row, so the row can carry Send email / Remove. */
  getAssignedCleanerForLine(line: OrderCleanerPayrollLine): AssignedCleanerAdmin | undefined {
    if (line.isUnassignedSlot || !this.selectedOrder()) return undefined;
    return this.getAssignedCleanersWithIds(this.selectedOrder()!.id).find(c => c.id === line.cleanerId);
  }

  /** Assigned cleaners with no wage row on screen (breakdown hidden, not loaded, or not yet
   *  refreshed after an assignment) — listed separately so each keeps their actions. */
  get cleanersWithoutPayrollRow(): AssignedCleanerAdmin[] {
    if (!this.selectedOrder()) return [];
    const assigned = this.getAssignedCleanersWithIds(this.selectedOrder()!.id);
    if (!this.canViewCleanerPayroll() || !this.selectedOrderPayroll()) return assigned;
    const onRows = new Set(this.getOrderPayrollLines().filter(l => !l.isUnassignedSlot).map(l => l.cleanerId));
    return assigned.filter(c => !onRows.has(c.id));
  }

  /**
   * THE ONE PAYMENTS LIST (2026-09). The panel used to show the same money in two places — an
   * "Invoices" list on the Payments card and an "Update History" column under pricing — with
   * some payments in both and some in neither. Every money event on the order is now one row,
   * oldest first:
   *  - the booking payment (or, when it was collected in slices, each slice — naming the invoice
   *    that collected it, if any), and a live invoice/request still waiting;
   *  - every order edit that moved the price: an increase with whether it is paid, how, and by
   *    which invoice; a decrease as information only;
   *  - voided invoices, struck through.
   * Actions (record a manual payment, send the updated-payment link) sit on the row they act on.
   */
  get paymentTimeline(): PaymentTimelineRow[] {
    const order = this.selectedOrder();
    if (!order) return [];
    const invoices = this.orderCustomerInvoices();
    const slices = this.partialBalance()?.history ?? [];
    const invoiceFor = (requestId: number) => invoices.find(i => i.partialPaymentId === requestId) ?? null;
    const paidBy = (method?: string | null, reference?: string | null) =>
      `Paid by ${!method || method === 'Normal' ? 'card' : method}${reference ? ` · ${reference}` : ''}`;
    const rows: PaymentTimelineRow[] = [];

    // ── The order's own total ──
    for (const p of slices) {
      const invoice = invoiceFor(p.id);
      const label = invoice ? `Invoice ${invoice.invoiceNumber}` : 'Part payment';
      if (p.status === 'Paid') {
        rows.push({ key: `p${p.id}`, when: p.paidAt ?? p.createdAt, label, amount: p.paidAmount ?? p.requestedAmount,
          sign: '', status: 'paid', statusText: paidBy(p.paymentMethod, p.paymentReference), invoice, slice: p });
      } else if (p.status === 'Pending') {
        // A plain request has its own block with its actions below the list; only an invoice's
        // request is listed here, so nothing appears twice.
        if (!invoice) continue;
        rows.push({ key: `p${p.id}`, when: p.createdAt, label, amount: p.requestedAmount, sign: '', status: 'due',
          statusText: invoice.lastSentAt ? 'Sent — awaiting payment' : 'Not sent yet', invoice });
      } else {
        rows.push({ key: `p${p.id}`, when: p.createdAt, label, amount: p.requestedAmount, sign: '', status: 'void',
          statusText: invoice ? 'Voided' : 'Withdrawn', invoice });
      }
    }

    if (!slices.some(p => p.status === 'Paid' || p.status === 'Pending')) {
      const base = order.initialTotal > 0
        ? order.initialTotal
        : (this.orderUpdateHistory()?.[0]?.originalTotal ?? order.total);
      const method = order.paymentMethod || 'Normal';
      const settledOutside = method !== 'Normal' && method !== 'Invoice';
      if (order.isPaid || settledOutside || !!order.invoicePaidAt) {
        rows.push({ key: 'booking', when: (order.paidAt as any) ?? order.invoicePaidAt ?? null, label: 'Booking payment',
          amount: base, sign: '', status: 'paid',
          statusText: method === 'Invoice' ? 'Paid by invoice' : paidBy(method, order.paymentReference), invoice: null });
      } else if (order.status !== 'Cancelled') {
        rows.push({ key: 'booking', when: null, label: 'Booking payment', amount: this.partialBalance()?.amountDue ?? order.total,
          sign: '', status: 'due', statusText: 'Not paid yet', invoice: null });
      }
    }

    // ── Order edits that moved the price ──
    const ms = (v: any) => parseUtcDate(v)?.getTime() ?? 0;
    const sameMoment = (a: any, b: any) => !!a && !!b && Math.abs(ms(a) - ms(b)) < 1000;
    for (const u of this.visibleOrderUpdateHistory) {
      const delta = this.getUpdateRowDelta(u);
      if (delta < 0) {
        rows.push({ key: `u${u.id}`, when: u.updatedAt, label: 'Price lowered by an edit', amount: -delta, sign: '−',
          status: 'info', statusText: 'Nothing to pay', invoice: null });
        continue;
      }
      const owed = u.additionalAmount > 0.01 ? u.additionalAmount : delta;
      const invoice = u.isPaid
        ? invoices.find(i => i.kind === 'Additional' && i.status === 'Paid' && sameMoment(i.paidAt, u.paidAt)) ?? null
        : this.openAdditionalInvoice ?? null;
      rows.push({
        key: `u${u.id}`, when: u.updatedAt, label: 'Added by an edit', amount: owed, sign: '+',
        status: u.isPaid ? 'paid' : 'due',
        statusText: u.isPaid
          ? paidBy(u.paymentMethod, u.paymentReference)
          : invoice ? `Invoice ${invoice.invoiceNumber} sent — awaiting payment`
          : u.updatedPaymentNotificationSentAt ? 'Payment link sent — unpaid' : 'Unpaid',
        paidAt: u.isPaid ? u.paidAt : null,
        invoice, update: u
      });
    }

    // ── Voided invoices for an added amount (a whole/split one shows as its withdrawn request) ──
    for (const i of invoices.filter(x => x.kind === 'Additional' && (x.status === 'Void' || x.status === 'Cancelled'))) {
      rows.push({ key: `i${i.id}`, when: i.voidedAt ?? i.createdAt, label: `Invoice ${i.invoiceNumber}`, amount: i.amount,
        sign: '', status: 'void', statusText: 'Voided', invoice: i });
    }

    return rows.sort((a, b) => ms(a.when) - ms(b.when));
  }

  trackPaymentRow(_: number, row: PaymentTimelineRow): string {
    return row.key;
  }

  /**
   * How the order is paid, in one word, for the header: Invoice, Zelle, Cash, Check, Other or
   * Card. An ordinary (website) order billed through a regular invoice reads "Invoice" — paid by
   * one, or waiting on one while the order is unpaid.
   */
  get headerPaymentLabel(): string {
    const order = this.selectedOrder();
    if (!order) return '';
    const method = order.paymentMethod || 'Normal';
    if (method === 'Invoice') return 'Invoice';
    if (method !== 'Normal') return paymentMethodLabel(method);
    if (this.paidCustomerInvoices.length > 0) return 'Invoice';
    if (!order.isPaid && this.openCustomerInvoices.some(i => i.kind !== 'Additional')) return 'Invoice';
    return 'Card';
  }

  /** Edit amounts still unpaid that an admin may record as paid outside Stripe. */
  get unpaidEditRows(): OrderUpdateHistory[] {
    return this.visibleOrderUpdateHistory.filter(u => this.canRecordManualPayment(u));
  }

  // ── Send Receipt on an online payment row (2026-09) ──
  // The server decides which rows qualify (paid online, not a manual method, not a combined
  // "Pay all upcoming" charge) — the row's method label cannot tell a website bank payment from
  // one an admin typed in. The send itself re-checks the payment live.

  readonly receiptPaymentKeys = signal(new Set<string>());
  receiptDefaultEmail = '';
  readonly sendingReceiptKey = signal<string | null>(null);
  readonly receiptEmailInput = signal('');
  readonly savingReceipt = signal(false);

  private loadReceiptPayments(orderId: number): void {
    this.adminService.getReceiptPayments(orderId).subscribe({
      next: res => {
        if (this.viewingOrderId() !== orderId) return;
        this.receiptPaymentKeys.set(new Set(res.paymentKeys ?? []));
        this.receiptDefaultEmail = res.defaultEmail ?? '';
      },
      // Non-fatal: without it the rows simply carry no Send Receipt button.
      error: () => { if (this.viewingOrderId() === orderId) this.receiptPaymentKeys.set(new Set()); }
    });
  }

  canSendReceipt(row: PaymentTimelineRow): boolean {
    const canUpdate = this.isSuperAdmin() || !!this.userPermissions()?.permissions?.canUpdate;
    return canUpdate && row.status === 'paid' && this.receiptPaymentKeys().has(row.key);
  }

  startSendReceipt(row: PaymentTimelineRow): void {
    this.sendingReceiptKey.set(row.key);
    this.receiptEmailInput.set(this.receiptDefaultEmail);
  }

  confirmSendReceipt(row: PaymentTimelineRow): void {
    const order = this.selectedOrder();
    const email = this.receiptEmailInput().trim();
    if (!order || this.savingReceipt() || !email) return;
    this.savingReceipt.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.adminService.sendPaymentReceipt(order.id, row.key, email)
      .pipe(finalize(() => this.savingReceipt.set(false)))
      .subscribe({
        next: res => {
          this.sendingReceiptKey.set(null);
          this.successMessage.set(res?.message || `Receipt sent to ${email}.`);
          this.clearMessagesAfterDelay();
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'The receipt could not be sent.'));
          this.clearMessagesAfterDelay();
        }
      });
  }

  // ── Correcting a manually recorded payment (a stray Confirm had no way back, 2026-09) ──

  readonly editingManualPaymentKey = signal<string | null>(null);
  readonly manualEditMethod = signal('Zelle');
  readonly manualEditReference = signal('');
  readonly manualEditNotes = signal('');
  readonly savingManualEdit = signal(false);

  // ── Marking an open regular invoice paid outside the website (2026-09-29) ──
  readonly markingInvoicePaidKey = signal<string | null>(null);
  readonly markInvoicePaidMethod = signal('BankTransfer');
  readonly markInvoicePaidReference = signal('');
  readonly markInvoicePaidNotes = signal('');
  readonly savingMarkInvoicePaid = signal(false);

  /** An unpaid Full/Split invoice row (it has its own part-payment request to settle). */
  canMarkInvoicePaid(row: PaymentTimelineRow): boolean {
    const canUpdate = this.isSuperAdmin() || !!this.userPermissions()?.permissions?.canUpdate;
    return canUpdate && row.status === 'due' && !row.update
      && !!row.invoice && row.invoice.partialPaymentId != null && row.invoice.kind !== 'Additional';
  }

  startMarkInvoicePaid(row: PaymentTimelineRow): void {
    this.markingInvoicePaidKey.set(row.key);
    this.markInvoicePaidMethod.set('BankTransfer');
    this.markInvoicePaidReference.set('');
    this.markInvoicePaidNotes.set('');
  }

  /** Records it against the invoice's own request — the endpoint that completes the order
   *  (Active, confirmation) when this was the last amount owed. */
  confirmMarkInvoicePaid(row: PaymentTimelineRow): void {
    const order = this.selectedOrder();
    if (!order || !row.invoice || this.savingMarkInvoicePaid()) return;
    this.savingMarkInvoicePaid.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.customerInvoiceService.recordPayment(row.invoice, this.markInvoicePaidMethod(),
        this.markInvoicePaidReference().trim() || null, this.markInvoicePaidNotes().trim() || null)
      .pipe(finalize(() => this.savingMarkInvoicePaid.set(false)))
      .subscribe({
        next: res => {
          this.markingInvoicePaidKey.set(null);
          this.successMessage.set(res?.message || `Invoice ${row.invoice!.invoiceNumber} marked paid.`);
          this.clearMessagesAfterDelay();
          this.refreshOrderAfterSave();
          this.refreshPartialBalanceQuietly(order.id);
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'The payment could not be recorded.'));
          this.clearMessagesAfterDelay();
        }
      });
  }

  canEditManualPayment(row: PaymentTimelineRow): boolean {
    const canUpdate = this.isSuperAdmin() || !!this.userPermissions()?.permissions?.canUpdate;
    if (!canUpdate || row.status !== 'paid') return false;
    if (row.update) return !!row.update.manualPaymentRecordedAt;
    return !!row.slice && !!row.slice.paymentMethod && row.slice.paymentMethod !== 'Normal';
  }

  startEditManualPayment(row: PaymentTimelineRow): void {
    const source = row.update ?? row.slice;
    this.editingManualPaymentKey.set(row.key);
    this.manualEditMethod.set(this.manualPaymentMethods.includes(source?.paymentMethod ?? '') ? source!.paymentMethod! : 'Zelle');
    this.manualEditReference.set(source?.paymentReference ?? '');
    this.manualEditNotes.set(source?.paymentNotes ?? '');
  }

  cancelManualPaymentEdit(): void {
    this.editingManualPaymentKey.set(null);
  }

  saveManualPaymentEdit(row: PaymentTimelineRow): void {
    const order = this.selectedOrder();
    if (!order || this.savingManualEdit()) return;
    const reference = this.manualEditReference().trim() || null;
    const notes = this.manualEditNotes().trim() || null;
    const request = row.update
      ? this.adminService.editManualAdditionalPayment(order.id, row.update.id, this.manualEditMethod(), reference, notes)
      : row.slice
        ? this.adminService.editPartialManualPayment(order.id, row.slice.id, this.manualEditMethod(), reference, notes)
        : null;
    if (!request) return;
    this.runManualEdit(request, 'The payment could not be updated.');
  }

  /** Only an edit (top-up) payment can be taken back — a part payment completes the order. */
  revertManualPayment(row: PaymentTimelineRow): void {
    const order = this.selectedOrder();
    if (!order || !row.update || this.savingManualEdit()) return;
    if (!confirm(`Mark $${this.formatCurrency(row.amount)} as NOT paid? It will be owed again.`)) return;
    this.runManualEdit(this.adminService.revertManualAdditionalPayment(order.id, row.update.id),
      'The payment could not be marked unpaid.');
  }

  private runManualEdit(request: Observable<{ message: string }>, fallback: string): void {
    this.savingManualEdit.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    request.pipe(finalize(() => this.savingManualEdit.set(false))).subscribe({
      next: res => {
        this.successMessage.set(res?.message || 'Payment updated.');
        this.clearMessagesAfterDelay();
        this.editingManualPaymentKey.set(null);
        this.refreshOrderAfterSave();
      },
      error: err => {
        this.errorMessage.set(extractApiErrorMessage(err, fallback));
        this.clearMessagesAfterDelay();
      }
    });
  }

  /** Everything still owed on the order: its own balance plus anything added after payment. */
  get panelAmountOwed(): number {
    // A cash / Zelle order was paid in person: only an amount an edit added afterwards is owed.
    if (this.isSettledOffline) return this.additionalAmountDue;
    return Math.round(((this.partialBalance()?.amountDue ?? 0) + this.additionalAmountDue) * 100) / 100;
  }

  /** The live part-payment request, unless it is the one behind an invoice (listed there). */
  get pendingRequestNotInvoiced(): OrderPartialPayment | null {
    const pending = this.partialBalance()?.pendingRequest ?? null;
    if (!pending) return null;
    return this.orderCustomerInvoices().some(i => i.partialPaymentId === pending.id) ? null : pending;
  }

  /**
   * Why no further amount can be requested — only when it tells the admin something the card
   * does not already show. "A request is waiting" is obvious when that request is an invoice
   * listed right above, and "already paid" is the Paid figure itself.
   */
  get paymentsRefusal(): string | null {
    const b = this.partialBalance();
    if (!b || b.canRequestPartialPayment || !b.cannotRequestReason) return null;
    if (this.selectedOrder()?.isPaid) return null;
    if (b.pendingRequest && !this.pendingRequestNotInvoiced) return null;
    return b.cannotRequestReason;
  }

  /** Partial-payment history rows that are NOT the request behind an invoice — those are
   *  already listed under Invoices, and showing them twice was the duplicate on the card. */
  get partialPaymentHistoryWithoutInvoices(): OrderPartialPayment[] {
    const invoiced = new Set(this.orderCustomerInvoices().map(i => i.partialPaymentId).filter(id => id != null));
    return this.partialPaymentHistory.filter(p => !invoiced.has(p.id));
  }

  // ── Panel tabs (2026-09): Details / Payments / Cleaners / Changes ─────────────────────────

  readonly orderPanelTab = signal<'details' | 'payments' | 'cleaners' | 'changes'>('details');

  setOrderPanelTab(tab: 'details' | 'payments' | 'cleaners' | 'changes'): void {
    this.orderPanelTab.set(tab);
    if (tab === 'changes' && this.selectedOrder() && this.orderChangesLoadedFor !== this.selectedOrder()!.id)
      this.loadOrderChanges(this.selectedOrder()!.id);
  }

  // ── Changes tab: what changed on this order after it was created ──

  readonly orderChanges = signal<OrderChangeEntry[]>([]);
  readonly loadingOrderChanges = signal(false);
  orderChangesLoadedFor: number | null = null;

  loadOrderChanges(orderId: number): void {
    this.loadingOrderChanges.set(true);
    this.orderChangesLoadedFor = orderId;
    this.adminService.getOrderChanges(orderId)
      .pipe(finalize(() => this.loadingOrderChanges.set(false)))
      .subscribe({
        next: rows => {
          if (this.viewingOrderId() !== orderId) return;
          this.orderChanges.set(buildOrderChangeEntries(rows));
        },
        error: () => { if (this.viewingOrderId() === orderId) this.orderChanges.set([]); }
      });
  }

  /** An action that is audited but moves nothing else on the panel still belongs in Changes. */
  private refreshChangesIfLoaded(orderId: number): void {
    if (this.orderChangesLoadedFor === orderId) this.loadOrderChanges(orderId);
  }

  trackChange(_: number, entry: OrderChangeEntry): number {
    return entry.id;
  }

  /** Update-history rows that actually moved the price — a $0.00 row is noise (owner's call). */
  get visibleOrderUpdateHistory(): OrderUpdateHistory[] {
    return (this.orderUpdateHistory() ?? []).filter(u => Math.abs(this.getUpdateRowDelta(u)) >= 0.01);
  }

  trackUpdate(_: number, update: OrderUpdateHistory): number {
    return update.id;
  }

  private customerInvoicesOrderId: number | null = null;

  private loadCustomerInvoices(orderId: number): void {
    // Cleared only when the panel moved to another order — a refresh of the same order keeps
    // the list on screen instead of blinking the Payments card away and back.
    if (this.customerInvoicesOrderId !== orderId) {
      this.orderCustomerInvoices.set([]);
      this.customerInvoicesOrderId = orderId;
    }
    this.customerInvoiceService.list({ orderId }).subscribe({
      next: invoices => {
        if (this.viewingOrderId() !== orderId) return;
        this.orderCustomerInvoices.set(invoices);
      },
      // Non-fatal: Moderators are refused (Admin+SuperAdmin endpoint) and simply see no invoices.
      error: () => { if (this.viewingOrderId() === orderId) this.orderCustomerInvoices.set([]); }
    });
  }

  /** Regular invoices still waiting for money. */
  get openCustomerInvoices(): CustomerInvoice[] {
    return this.orderCustomerInvoices().filter(i => i.status === 'Sent' || i.status === 'NotSent');
  }

  /** Paid invoices for the order's OWN total — what makes the pricing line read "Paid by Invoice".
   *  An Additional invoice (extra added after payment) doesn't change how the booking was paid. */
  get paidCustomerInvoices(): CustomerInvoice[] {
    // paidVia is set only when THIS invoice's own request took the money — an invoice that reads
    // Paid because the order was settled some other way must not claim the payment.
    return this.orderCustomerInvoices().filter(i => i.status === 'Paid' && i.kind !== 'Additional' && !!i.paidVia);
  }

  /**
   * Offered for every ordinary (non-commercial) order that isn't cancelled — whether it can
   * actually be billed right now is answered inside the modal, from the server's figures.
   */
  get canOfferCustomerInvoice(): boolean {
    const o = this.selectedOrder();
    if (!o || this.isInvoiceBilledOrder || this.invoiceClientForOrder() || this.isSettledOffline) return false;
    if (o.status === 'Cancelled' || o.status === 'Refunded') return false;
    return this.isSuperAdmin() || this.userRole() === 'Admin';
  }

  /** What a new invoice would bill: the extra added after payment, the unpaid balance, or nothing. */
  get customerInvoiceBillingMode(): 'additional' | 'balance' | 'none' {
    if (this.additionalAmountDue >= 0.5) return 'additional';
    const b = this.partialBalance();
    if (b && !this.selectedOrder()?.isPaid && b.amountDue >= 0.5 && this.customerInvoiceAvailable >= 0.5) return 'balance';
    return 'none';
  }

  /** Owed on the order's own total and not already on an open request or invoice. */
  get customerInvoiceAvailable(): number {
    const b = this.partialBalance();
    if (!b) return 0;
    const open = (b.history ?? []).filter(p => p.status === 'Pending').reduce((s, p) => s + p.requestedAmount, 0);
    return Math.max(0, Math.round((b.amountDue - open) * 100) / 100);
  }

  /** A whole-balance invoice cannot sit beside split ones, so an order already split stays split. */
  get customerInvoiceMustSplit(): boolean {
    return this.openCustomerInvoices.some(i => i.kind === 'Split');
  }

  get customerInvoiceSplitTotal(): number {
    return Math.round(this.customerInvoiceSplitAmounts().reduce<number>((s, a) => s + (Number(a) || 0), 0) * 100) / 100;
  }

  openCustomerInvoiceModal(): void {
    this.customerInvoiceSplitMode.set(this.customerInvoiceMustSplit);
    this.customerInvoiceSplitAmounts.set([null, null]);
    this.customerInvoiceNote.set('');
    this.customerInvoiceChannels.set({ email: true, sms: true });
    this.customerInvoiceMessage.set('');
    this.customerInvoiceError.set('');
    this.showCustomerInvoiceModal.set(true);
  }

  closeCustomerInvoiceModal(): void {
    if (this.customerInvoiceBusy()) return;
    this.showCustomerInvoiceModal.set(false);
  }

  addCustomerInvoiceSplitRow(): void {
    if (this.customerInvoiceSplitAmounts().length < 12) { this.customerInvoiceSplitAmounts().push(null); this.customerInvoiceSplitAmounts.set(this.customerInvoiceSplitAmounts()); }
  }

  removeCustomerInvoiceSplitRow(index: number): void {
    if (this.customerInvoiceSplitAmounts().length > 1) { this.customerInvoiceSplitAmounts().splice(index, 1); this.customerInvoiceSplitAmounts.set(this.customerInvoiceSplitAmounts()); }
  }

  trackByIndex(index: number): number {
    return index;
  }

  createCustomerInvoice(): void {
    const order = this.selectedOrder();
    if (!order || this.customerInvoiceBusy()) return;
    const mode = this.customerInvoiceBillingMode;
    if (mode === 'none') return;

    const split = mode === 'balance' && (this.customerInvoiceSplitMode() || this.customerInvoiceMustSplit);
    const amounts = split ? this.customerInvoiceSplitAmounts().map(a => Number(a) || 0) : undefined;
    if (amounts && (amounts.length === 0 || amounts.some(a => a < 0.5))) {
      this.customerInvoiceError.set('Every split invoice needs an amount of at least $0.50.');
      return;
    }

    this.customerInvoiceBusy.set(true);
    this.customerInvoiceError.set('');
    this.customerInvoiceMessage.set('');
    const orderId = order.id;
    this.customerInvoiceService.create({
      orderId,
      splitAmounts: amounts,
      note: this.customerInvoiceNote().trim() || null,
      sendEmail: this.customerInvoiceChannels().email,
      sendSms: this.customerInvoiceChannels().sms
    }).pipe(finalize(() => this.customerInvoiceBusy.set(false)))
      .subscribe({
        next: res => {
          this.customerInvoiceMessage.set(res.message);
          this.customerInvoiceSplitAmounts.set([null, null]);
          this.customerInvoiceNote.set('');
          this.refreshOrderAfterSave();
        },
        error: err => this.customerInvoiceError.set(extractApiErrorMessage(err, 'The invoice could not be created.'))
      });
  }

  /** The Payments card's "Send Invoice Reminder": the invoice for the added amount, sent again by
   *  email and text — the same send endpoint, so the invoice stamps another send. */
  readonly sendingInvoiceReminder = signal(false);
  sendAdditionalInvoiceReminder(invoice: CustomerInvoice): void {
    if (this.sendingInvoiceReminder()) return;
    this.sendingInvoiceReminder.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.customerInvoiceService.send(invoice.id, true, true)
      .pipe(finalize(() => this.sendingInvoiceReminder.set(false)))
      .subscribe({
        next: res => {
          this.successMessage.set(res.message || `Invoice ${invoice.invoiceNumber} sent again.`);
          this.clearMessagesAfterDelay();
          if (this.selectedOrder()) this.refreshPartialBalanceQuietly(this.selectedOrder()!.id);
        },
        error: err => {
          this.errorMessage.set(extractApiErrorMessage(err, 'The invoice reminder could not be sent.'));
          this.clearMessagesAfterDelay();
        }
      });
  }

  resendCustomerInvoice(invoice: CustomerInvoice): void {
    if (this.customerInvoiceActionId() !== null) return;
    this.customerInvoiceActionId.set(invoice.id);
    this.customerInvoiceError.set('');
    this.customerInvoiceMessage.set('');
    this.customerInvoiceService.send(invoice.id, this.customerInvoiceChannels().email, this.customerInvoiceChannels().sms)
      .pipe(finalize(() => this.customerInvoiceActionId.set(null)))
      .subscribe({
        next: res => {
          this.customerInvoiceMessage.set(res.message);
          this.refreshOrderAfterSave();
        },
        error: err => this.customerInvoiceError.set(extractApiErrorMessage(err, 'The invoice could not be sent.'))
      });
  }

  voidCustomerInvoice(invoice: CustomerInvoice): void {
    if (this.customerInvoiceActionId() !== null) return;
    if (!confirm(`Void invoice ${invoice.invoiceNumber}? The customer will no longer be able to pay it.`)) return;
    this.customerInvoiceActionId.set(invoice.id);
    this.customerInvoiceError.set('');
    this.customerInvoiceMessage.set('');
    this.customerInvoiceService.void(invoice.id, null)
      .pipe(finalize(() => this.customerInvoiceActionId.set(null)))
      .subscribe({
        next: res => {
          this.customerInvoiceMessage.set(res.message);
          this.refreshOrderAfterSave();
        },
        error: err => this.customerInvoiceError.set(extractApiErrorMessage(err, 'The invoice could not be voided.'))
      });
  }

  copyCustomerInvoiceLink(invoice: CustomerInvoice): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(invoice.publicUrl).then(() => {
      this.customerInvoiceCopiedId.set(invoice.id);
      setTimeout(() => { if (this.customerInvoiceCopiedId() === invoice.id) this.customerInvoiceCopiedId.set(null); }, 2000);
    });
  }

  /**
   * The settled and withdrawn requests, newest first — the panel reads as a log. The LIVE
   * request is deliberately excluded: it has its own block above with its own actions, and
   * listing it twice makes one waiting request look like two.
   */
  get partialPaymentHistory(): OrderPartialPayment[] {
    return [...(this.partialBalance()?.history ?? [])]
      .filter(p => p.status !== 'Pending')
      .reverse();
  }

  requestPartialPayment(): void {
    if (!this.selectedOrder() || this.loadingStates().partialPayment) return;

    const amount = Number(this.partialAmountInput());
    this.partialPaymentError.set('');
    this.partialPaymentMessage.set('');

    // A local sanity check only, so the admin isn't round-tripped for an empty box. Everything
    // that actually protects the money — the balance, the minimum, the uncollectable-remainder
    // rule — is decided server-side.
    if (!Number.isFinite(amount) || amount <= 0) {
      this.partialPaymentError.set('Enter the amount to ask the customer for.');
      return;
    }

    const orderId = this.selectedOrder()!.id;
    this.loadingStates().partialPayment = true;
    this.loadingStates.set(this.loadingStates());

    this.adminService.requestPartialPayment(orderId, amount, {
      note: this.partialNoteInput()?.trim() || undefined,
      sendEmail: this.partialChannels().email,
      sendSms: this.partialChannels().sms
    })
      .pipe(finalize(() => this.loadingStates().partialPayment = false))
      .subscribe({
        next: res => {
          if (this.viewingOrderId() !== orderId) return;
          this.partialBalance.set(res.balance);
          // The order itself may have moved (Pending → Active on the last slice), so re-read it.
          this.refreshOrderAfterSave();
          this.partialAmountInput.set(null);
          this.partialNoteInput.set('');
          this.partialPaymentMessage.set(res.message);
          // The order row and panel show a balance now, so re-read the order rather than
          // patching amountPaid here — the server is what decides it.
          this.refreshOrderAfterPartialPayment(orderId);
        },
        error: err => {
          this.partialPaymentError.set(extractApiErrorMessage(err, 'Could not create the payment request.'));
        }
      });
    this.loadingStates.set(this.loadingStates());
  }

  resendPartialPaymentLink(request: OrderPartialPayment): void {
    if (!this.selectedOrder() || this.loadingStates().partialPayment) return;

    const orderId = this.selectedOrder()!.id;
    this.partialPaymentError.set('');
    this.partialPaymentMessage.set('');
    this.loadingStates().partialPayment = true;
    this.loadingStates.set(this.loadingStates());

    this.adminService.resendPartialPaymentLink(
      orderId, request.id, this.partialChannels().email, this.partialChannels().sms)
      .pipe(finalize(() => this.loadingStates().partialPayment = false))
      .subscribe({
        next: res => {
          if (this.viewingOrderId() !== orderId) return;
          this.partialPaymentMessage.set(res.message);
          this.loadPartialPayments(orderId);
        },
        error: err => {
          this.partialPaymentError.set(extractApiErrorMessage(err, 'Could not send the payment link.'));
        }
      });
    this.loadingStates.set(this.loadingStates());
  }

  cancelPartialPaymentRequest(request: OrderPartialPayment): void {
    if (!this.selectedOrder() || this.loadingStates().partialPayment) return;
    if (!confirm(`Cancel the $${request.requestedAmount.toFixed(2)} payment request? The customer's link stops working.`)) return;

    const orderId = this.selectedOrder()!.id;
    this.partialPaymentError.set('');
    this.partialPaymentMessage.set('');
    this.loadingStates().partialPayment = true;
    this.loadingStates.set(this.loadingStates());

    this.adminService.cancelPartialPaymentRequest(orderId, request.id)
      .pipe(finalize(() => this.loadingStates().partialPayment = false))
      .subscribe({
        next: res => {
          if (this.viewingOrderId() !== orderId) return;
          this.partialBalance.set(res.balance);
          // The order itself may have moved (Pending → Active on the last slice), so re-read it.
          this.refreshOrderAfterSave();
          this.partialPaymentMessage.set(res.message);
        },
        error: err => {
          this.partialPaymentError.set(extractApiErrorMessage(err, 'Could not cancel the payment request.'));
        }
      });
    this.loadingStates.set(this.loadingStates());
  }

  // ── Record a live part-payment request as paid outside Stripe (Cash/Zelle/Check/Other/Invoice) ──
  // How a deposit split gets its "part card, part something else" half: create the request for a
  // slice (above), then instead of sending the Stripe link, record it here. Mirrors the
  // order-edit top-up's manual-payment form (recordingManualPaymentForId etc.) — same shape,
  // different target row.
  readonly recordingManualPartialPaymentForId = signal<number | null>(null);
  readonly partialManualPaymentMethod = signal('Zelle');
  readonly partialManualPaymentReference = signal('');
  readonly partialManualPaymentNotes = signal('');
  readonly savingPartialManualPayment = signal(false);
  readonly partialManualPaymentMethods = ['Zelle', 'Cash', 'Check', 'BankTransfer', 'Invoice', 'Other'];

  /** Admins with update rights (and SuperAdmin) — same gate as the order-edit manual payment. */
  canRecordPartialManualPayment(): boolean {
    return this.isSuperAdmin() || !!this.userPermissions()?.permissions?.canUpdate;
  }

  openPartialManualPaymentForm(request: OrderPartialPayment): void {
    this.recordingManualPartialPaymentForId.set(request.id);
    this.partialManualPaymentMethod.set('Zelle');
    this.partialManualPaymentReference.set('');
    this.partialManualPaymentNotes.set('');
  }

  cancelPartialManualPayment(): void {
    this.recordingManualPartialPaymentForId.set(null);
  }

  confirmPartialManualPayment(request: OrderPartialPayment): void {
    if (!this.selectedOrder() || this.savingPartialManualPayment()) return;
    const orderId = this.selectedOrder()!.id;
    this.savingPartialManualPayment.set(true);
    this.partialPaymentError.set('');
    this.partialPaymentMessage.set('');

    this.adminService.recordPartialPaymentManually(
      orderId,
      request.id,
      this.partialManualPaymentMethod(),
      this.partialManualPaymentReference()?.trim() || null,
      this.partialManualPaymentNotes()?.trim() || null
    )
      .pipe(finalize(() => this.savingPartialManualPayment.set(false)))
      .subscribe({
        next: res => {
          if (this.viewingOrderId() !== orderId) return;
          this.partialBalance.set(res.balance);
          // The order itself may have moved (Pending → Active on the last slice), so re-read it.
          this.refreshOrderAfterSave();
          this.partialPaymentMessage.set(res.message);
          this.recordingManualPartialPaymentForId.set(null);
          // Settling the last slice flips the order Pending -> Active and marks it paid;
          // re-read the order so the panel and its list row show that without a reload.
          this.refreshOrderAfterPartialPayment(orderId);
        },
        error: err => {
          this.partialPaymentError.set(extractApiErrorMessage(err, 'Could not record the manual payment.'));
        }
      });
  }

  /**
   * Re-reads the order into the panel AND its row in the list. Without the row copy the list keeps
   * showing "Unpaid — $2,743.65" next to a panel that says $1,743.65 is left, which is the same
   * class of disagreement refreshOrderAfterSave exists to prevent for cleaner counts.
   */
  private refreshOrderAfterPartialPayment(orderId: number): void {
    this.adminService.getOrderDetails(orderId).subscribe({
      next: order => {
        if (this.viewingOrderId() === orderId) this.selectedOrder.set(order);
        const row = this.orders().find(o => o.id === orderId);
        if (row) {
          row.amountPaid = order.amountPaid;
          this.orders.set(this.orders());
          row.amountDue = order.amountDue;
          this.orders.set(this.orders());
          row.isPartiallyPaid = order.isPartiallyPaid;
          this.orders.set(this.orders());
        }
      },
      error: () => { /* non-fatal: the panel already shows the balance it just got back */ }
    });
  }

  /** "Partially paid — $1,000.00 of $2,743.65" for the list row and the panel header. */
  partiallyPaidLabel(order: { amountPaid?: number; total: number }): string {
    return `Partially paid — $${(order.amountPaid ?? 0).toFixed(2)} of $${order.total.toFixed(2)}`;
  }

  viewOrderDetails(orderId: number) {
    if (this.viewingOrderId() === orderId) {
      this.closeOrderDetails();
      return;
    }

    this.viewingOrderId.set(orderId);
    // Every order opens on Details, with its own (not yet loaded) Changes feed.
    this.orderPanelTab.set('details');
    this.orderChanges.set([]);
    this.orderChangesLoadedFor = null;
    this.editingOrder.set(false);
    this.editingPaymentMethod.set(false);
    this.loadingStates().orderDetails = true;
    this.loadingStates.set(this.loadingStates());
    this.resetOrderPhotoState();
    this.loadOrderPhotos(orderId);
    this.resetOrderNoteState();
    this.loadOrderNote(orderId);
    this.loadOrderSavedCardInfo(orderId);
    this.resetTransferPanel();
    this.resetRefundState();
    this.resetPayrollEditState();
    this.loadOrderInvoices(orderId);
    this.loadPartialPayments(orderId);
    this.loadOrderChangeRequests(orderId);
    // The breakdown under "Cleaners Total Salary". Admin and SuperAdmin since 2026-09 — the
    // people who staff the job are the ones told it ran long. Moderators are View-only and the
    // server answers them 403, so the call is gated on the same test as the block that shows it.
    if (this.canViewCleanerPayroll()) this.loadOrderCleanerPayroll(orderId);
    if (this.isSuperAdmin()) {
      this.loadOrderTransfers(orderId);
      this.loadOrderRefunds(orderId);
    }

    // Acknowledge any active reminders for this order
    this.orderReminderService.acknowledgeOrder(orderId);

    // Mark new order as viewed
    this.newOrderNotificationService.markViewed(orderId);
    
    // Clear previous update history
    this.orderUpdateHistory.set([]);
    
    if (this.userRole() && this.userRole() !== 'Customer') {
      this.adminService.getOrderDetails(orderId).subscribe({
        next: (order) => {
          this.selectedOrder.set(order);
          // Make sure the service-type catalog is loaded so isCustomModeOrder() works
          // for the on-the-fly Cleaners Total Salary display.
          if (this.serviceTypesCache().length === 0) {
            this.bookingService.getServiceTypes().subscribe({
              next: (list) => { this.serviceTypesCache.set(list); },
              error: () => { /* non-fatal: details view falls back to stored value */ }
            });
          }
          this.customerNames.set(orderId, `${order.contactFirstName} ${order.contactLastName}`);
          this.customerDetails.set(orderId, {
            id: order.userId,
            email: order.contactEmail
          });
          
          // Only load assigned cleaners if not already cached
          if (!this.assignedCleanersCache().has(orderId)) {
            this.loadSingleOrderCleaners(orderId);
          }
          
          // ADD THIS - Load update history
          this.loadUpdateHistory(orderId);
        },
        error: (error) => {
          console.error('Error loading order details:', error);
          this.errorMessage.set('Failed to load order details.');
        },
        complete: () => {
          this.loadingStates().orderDetails = false;
          this.loadingStates.set(this.loadingStates());
        }
      });
    } else {
      this.orderService.getOrderById(orderId).subscribe({
        next: (order) => {
          this.selectedOrder.set(order);
          
          // ADD THIS - Load update history for regular users too if needed
          // this.loadUpdateHistory(orderId);
        },
        error: (error) => {
          console.error('Error loading order details:', error);
          this.errorMessage.set('Failed to load order details.');
        },
        complete: () => {
          this.loadingStates().orderDetails = false;
          this.loadingStates.set(this.loadingStates());
        }
      });
    }
  }

  /** Close the slide-in order detail panel. */
  closeOrderDetails(): void {
    this.viewingOrderId.set(null);
    this.selectedOrder.set(null);
    this.selectedOrderPayroll.set(null);
    this.loadingOrderPayroll.set(false);
    this.resetPayrollEditState();
    this.editingOrder.set(false);
    this.editingPaymentMethod.set(false);
    this.resetSaveConfirmState();
    this.resetOrderPhotoState();
    this.resetOrderNoteState();
    this.resetRefundState();
    this.resetPartialPaymentState();
    this.orderInvoices.set(null);
    this.invoiceClientForOrder.set(null);
    this.showSendInvoiceModal.set(false);
    this.sendingInvoiceId.set(null);
  }

  /** Drop an unconfirmed save so it can never be applied to a different order. */
  private resetSaveConfirmState(): void {
    this.showSaveConfirm.set(false);
    this.pendingSaveDto = null;
    this.saveConfirmChanges.set([]);
  }

  // ── Internal order note (admin-only free text, above Assigned Cleaners) ──

  /** Mirrors the backend's [RequirePermission(Update)] on the notes endpoint. */
  get canEditOrderNote(): boolean {
    return this.isSuperAdmin() || !!this.userPermissions()?.permissions?.canUpdate;
  }

  /** True when the textarea differs from what is stored, i.e. there is something to save. */
  readonly orderNoteDirty = computed<boolean>(() => this.orderNoteDraft().trim() !== this.orderNoteSaved());

  private resetOrderNoteState(): void {
    this.orderNoteDraft.set('');
    this.orderNoteSaved.set('');
    this.orderNoteUpdatedAt.set(null);
    this.orderNoteUpdatedByName.set(null);
    this.loadingOrderNote.set(false);
    this.savingOrderNote.set(false);
    this.orderNoteError.set('');
    this.orderNoteSuccess.set('');
  }

  private loadOrderNote(orderId: number): void {
    this.loadingOrderNote.set(true);
    this.adminService.getOrderAdminNotes(orderId).subscribe({
      next: (note) => {
        // The panel may have moved on to another order while this was in flight.
        if (this.viewingOrderId() !== orderId) return;
        this.applyLoadedOrderNote(note);
        this.loadingOrderNote.set(false);
      },
      error: () => {
        if (this.viewingOrderId() !== orderId) return;
        this.loadingOrderNote.set(false);
        this.orderNoteError.set('Failed to load the note for this order.');
      }
    });
  }

  private applyLoadedOrderNote(note: OrderAdminNote): void {
    this.orderNoteSaved.set((note.notes || '').trim());
    this.orderNoteDraft.set(this.orderNoteSaved());
    this.orderNoteUpdatedAt.set(note.updatedAt || null);
    this.orderNoteUpdatedByName.set(note.updatedByName || null);
  }

  saveOrderNote(): void {
    const orderId = this.viewingOrderId();
    if (orderId == null || this.savingOrderNote() || !this.canEditOrderNote) return;

    const text = this.orderNoteDraft().trim();
    if (text.length > this.orderNoteMaxLength) {
      this.orderNoteError.set(`The note is limited to ${this.orderNoteMaxLength} characters.`);
      return;
    }

    this.savingOrderNote.set(true);
    this.orderNoteError.set('');
    this.orderNoteSuccess.set('');

    // An empty box clears the note; the endpoint deletes the row rather than storing ''.
    this.adminService.updateOrderAdminNotes(orderId, text.length > 0 ? text : null).subscribe({
      next: (note) => {
        if (this.viewingOrderId() !== orderId) return;
        this.applyLoadedOrderNote(note);
        this.savingOrderNote.set(false);
        this.orderNoteSuccess.set(text.length > 0 ? 'Note saved.' : 'Note cleared.');
        setTimeout(() => { this.orderNoteSuccess.set(''); }, 3000);
      },
      error: (error) => {
        if (this.viewingOrderId() !== orderId) return;
        this.savingOrderNote.set(false);
        this.orderNoteError.set(error?.error?.message || 'Failed to save the note.');
      }
    });
  }

  /** Drop an unsaved edit and go back to the stored text. */
  cancelOrderNoteEdit(): void {
    this.orderNoteDraft.set(this.orderNoteSaved());
    this.orderNoteError.set('');
    this.orderNoteSuccess.set('');
  }

  /** "Aug 23, 2026, 2:15 PM" in NY time, matching every other timestamp on this panel. */
  formatOrderNoteTimestamp(value: string | null): string {
    return value ? formatNyDateTime(value) : '';
  }

  private resetOrderPhotoState(): void {
    this.orderPhotos.set([]);
    this.lightboxOrderPhoto.set(null);
    this.orderPhotoError.set('');
    this.orderPhotoSuccess.set('');
    this.orderPhotoProgress.set('');
    this.uploadingOrderPhoto.set(false);
  }

  // ── Order cleaning photos (same shared store as the per-user library) ──

  private loadOrderPhotos(orderId: number): void {
    this.loadingOrderPhotos.set(true);
    this.adminService.getOrderCleaningPhotos(orderId).subscribe({
      next: (photos) => {
        if (this.viewingOrderId() !== orderId) return;
        this.orderPhotos.set(photos);
        this.loadingOrderPhotos.set(false);
      },
      error: () => { this.loadingOrderPhotos.set(false); }
    });
  }

  onOrderPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || this.viewingOrderId() == null) return;
    const files = Array.from(input.files);
    input.value = '';
    this.uploadOrderPhotosSequentially(this.viewingOrderId()!, files);
  }

  private uploadOrderPhotosSequentially(orderId: number, files: File[]): void {
    if (this.uploadingOrderPhoto() || files.length === 0) return;
    this.uploadingOrderPhoto.set(true);
    this.orderPhotoError.set('');
    this.orderPhotoSuccess.set('');
    this.orderPhotoProgress.set('');

    const total = files.length;
    let okCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    const uploadOne = (index: number) => {
      if (this.viewingOrderId() !== orderId) {
        this.uploadingOrderPhoto.set(false);
        this.orderPhotoProgress.set('');
        return;
      }
      if (index >= total) {
        this.uploadingOrderPhoto.set(false);
        this.orderPhotoProgress.set('');
        if (okCount > 0) {
          this.orderPhotoSuccess.set(total === 1 ? 'Photo uploaded.' : `${okCount} of ${total} photos uploaded.`);
          setTimeout(() => this.orderPhotoSuccess.set(''), 3000);
        }
        if (failCount > 0) {
          this.orderPhotoError.set(`${failCount} upload${failCount === 1 ? '' : 's'} failed${errors[0] ? ': ' + errors[0] : ''}.`);
          setTimeout(() => this.orderPhotoError.set(''), 5000);
        }
        this.loadOrderPhotos(orderId);
        return;
      }

      this.orderPhotoProgress.set(total > 1 ? `Uploading ${index + 1}/${total}…` : 'Uploading…');
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
    const orderId = this.viewingOrderId();
    this.adminService.deleteUserCleaningPhoto(photo.id).subscribe({
      next: () => { if (orderId != null) this.loadOrderPhotos(orderId); }
    });
  }

  openOrderLightbox(photo: UserCleaningPhoto): void { this.lightboxOrderPhoto.set(photo); }
  closeOrderLightbox(): void { this.lightboxOrderPhoto.set(null); }

  resolvePhotoUrl(photo: UserCleaningPhoto | null | undefined): string {
    // An empty photoUrl means the server would not expose this row (not a local upload).
    if (photo && photo.id && photo.photoUrl) {
      return `${environment.apiUrl}/files/cleaning-photos/${photo.id}`;
    }
    return '';
  }

  // ── SuperAdmin order deletion ──

  deleteOrder(order: { id: number }): void {
    if (!this.isSuperAdmin() || this.deletingOrder()) return;
    if (!confirm(`Permanently delete order #${order.id}? This cannot be undone and does not issue a refund.`)) return;

    this.deletingOrder.set(true);
    this.adminService.deleteOrder(order.id).subscribe({
      next: (res) => {
        this.deletingOrder.set(false);
        // A cleaner who had been sent the assignment is named, because nothing tells them the job is off.
        const warnings = res?.warnings ?? [];
        this.successMessage.set([`Order #${order.id} deleted.`, ...warnings].join(' '));
        setTimeout(() => this.clearMessages(), warnings.length ? 12000 : 3000);
        this.closeOrderDetails();
        this.loadOrders();
      },
      error: (err) => {
        this.deletingOrder.set(false);
        this.errorMessage.set(err?.error?.message || 'Failed to delete order.');
        // The refusal names what to do first (refund, invoice, stop the recurrence) — leave time to read it.
        setTimeout(() => this.clearMessages(), 10000);
      }
    });
  }

  loadUpdateHistory(orderId: number) {
    this.loadingUpdateHistory.set(true);
    
    this.adminService.getOrderUpdateHistory(orderId).subscribe({
      next: (history) => {
        this.orderUpdateHistory.set(history);
        this.loadingUpdateHistory.set(false);
      },
      error: (error) => {
        console.error('Error loading update history:', error);
        this.loadingUpdateHistory.set(false);
      }
    });
  }
  

  // ── Record manual (non-Stripe) payment for an additional-amount row ──
  // Used when the customer paid an order top-up by Zelle/Cash/Check (e.g. cleaning ran longer).
  // Marks just that update-history row paid via the chosen method; the base order stays a Stripe
  // order, so statistics still treat the base as a card charge and exclude this from Stripe fees.
  readonly recordingManualPaymentForId = signal<number | null>(null);
  readonly manualPaymentMethod = signal('Zelle');
  readonly manualPaymentReference = signal('');
  readonly manualPaymentNotes = signal('');
  readonly savingManualPayment = signal(false);
  readonly manualPaymentMethods = ['Zelle', 'Cash', 'Check', 'BankTransfer', 'Other'];
  /** Display label for a method wire value — "BankTransfer" reads "Bank transfer". */
  readonly methodLabel = paymentMethodLabel;

  /** Admins with update rights (and SuperAdmin), for an unpaid row that has money to collect. */
  canRecordManualPayment(update: OrderUpdateHistory): boolean {
    const canUpdate = this.isSuperAdmin() || !!this.userPermissions()?.permissions?.canUpdate;
    return canUpdate && !update.isPaid && (Number(update.additionalAmount) || 0) > 0.01;
  }

  openManualPaymentForm(update: OrderUpdateHistory): void {
    this.recordingManualPaymentForId.set(update.id);
    this.manualPaymentMethod.set('Zelle');
    this.manualPaymentReference.set('');
    this.manualPaymentNotes.set('');
  }

  cancelManualPayment(): void {
    this.recordingManualPaymentForId.set(null);
  }

  confirmManualPayment(update: OrderUpdateHistory): void {
    if (!this.selectedOrder() || this.savingManualPayment()) return;
    const orderId = this.selectedOrder()!.id;
    this.savingManualPayment.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.adminService.recordManualAdditionalPayment(
      orderId,
      update.id,
      this.manualPaymentMethod(),
      this.manualPaymentReference()?.trim() || null,
      this.manualPaymentNotes()?.trim() || null
    ).subscribe({
      next: (res) => {
        this.successMessage.set(res?.message || 'Manual payment recorded.');
        setTimeout(() => { this.successMessage.set(''); }, 5000);
        this.recordingManualPaymentForId.set(null);
        // Paying off the last additional amount flips the order Pending -> Active server-side.
        // Mirror the returned status locally so the panel badge + list update without a reload.
        if (res?.status) {
          if (this.selectedOrder() && this.selectedOrder()!.id === orderId) {
            this.selectedOrder()!.status = res.status;
            this.selectedOrder.set(this.selectedOrder());
          }
          const listOrder = this.orders().find(o => o.id === orderId);
          if (listOrder) { listOrder.status = res.status; this.orders.set(this.orders()); }
        }
        // Refresh the whole panel: the row flips to "paid via <method>", unpaid totals, the
        // Payments card, invoices and status all update without a reload.
        this.refreshOrderAfterSave();
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to record manual payment.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.savingManualPayment.set(false); }
    });
  }

  // ── SuperAdmin: change the order's payment method (details panel) ──
  // For orders created expecting Stripe where the customer decided to pay cash/Zelle/etc.
  // (or the reverse). The backend re-routes the order between the Stripe and manual flows
  // (tracking fields, Pending/Active status, Stripe-fee accounting) — SuperAdmin-only.
  readonly editingPaymentMethod = signal(false);
  readonly savingPaymentMethod = signal(false);
  readonly paymentMethodEdit = signal<PaymentMethodEditChoice>('Normal');

  /**
   * The editor's choices. "Invoice" is the REGULAR customer invoice (DCR-…) — the same
   * booking-page-only choice the booking form offers: not a stored method, the order is an
   * ordinary card order billed by an invoice the customer pays by card or bank. The commercial
   * method keeps its own, clearly named entry.
   */
  readonly paymentMethodEditOptions: { value: PaymentMethodEditChoice; label: string }[] = [
    ...PAYMENT_METHOD_OPTIONS.filter(o => o.value !== 'Invoice'),
    { value: 'RegularInvoice', label: 'Invoice' },
    { value: 'Invoice', label: 'Invoice (commercial)' },
  ];
  readonly paymentMethodEditReference = signal('');
  readonly paymentMethodEditNotes = signal('');

  /** Who an Invoice-method order is billed to, and the roster to pick from. */
  readonly paymentMethodEditClientId = signal<number | null>(null);
  readonly commercialClients = signal<InvoiceClientOption[]>([]);
  loadingCommercialClients = false;

  /** SuperAdmin, and never once Stripe actually charged the card — a real charge is
   *  corrected with a refund, not a relabel (backend enforces the same rule). */
  get canEditPaymentMethod(): boolean {
    return this.isSuperAdmin() && !!this.selectedOrder() && !this.selectedOrder()!.isPaid;
  }

  /** Does choosing this method mean the money has ALREADY arrived? Mirrors the backend's
   *  PaymentMethodRules — Invoice is the one outside-Stripe method where it is false. */
  isSettledPaymentMethod(method: PaymentMethodEditChoice): boolean {
    return method !== 'RegularInvoice' && isSettledOnRecord(method);
  }

  startEditPaymentMethod(): void {
    if (!this.selectedOrder()) return;
    this.paymentMethodEdit.set(((this.selectedOrder()!.paymentMethod as PaymentMethodValue) || 'Normal'));
    // A card order already billed by a regular invoice reads "Invoice" in the header — open on it.
    if (this.paymentMethodEdit() === 'Normal' && this.headerPaymentLabel === 'Invoice') this.paymentMethodEdit.set('RegularInvoice');
    this.paymentMethodEditReference.set(this.selectedOrder()!.paymentReference || '');
    this.paymentMethodEditNotes.set(this.selectedOrder()!.paymentNotes || '');
    this.paymentMethodEditClientId.set(this.selectedOrder()!.contractClientId ?? null);
    this.editingPaymentMethod.set(true);

    // Loaded once and kept: an admin switching orders to Invoice billing does it repeatedly, and
    // the roster does not change between two clicks.
    if (!this.commercialClients().length && !this.loadingCommercialClients) {
      this.loadingCommercialClients = true;
      this.invoiceService.clients()
        .pipe(finalize(() => { this.loadingCommercialClients = false; }))
        .subscribe({
          next: list => { this.commercialClients.set(list); },
          // The save guard below refuses an Invoice change with no client, so a failed roster
          // fetch cannot produce an unbillable order.
          error: () => { this.commercialClients.set([]); }
        });
    }
  }

  /** Set while a switch to the regular "Invoice" choice is saving — the invoice modal opens after. */
  private pendingOpenInvoiceAfterMethodSave = false;

  cancelEditPaymentMethod(): void {
    this.editingPaymentMethod.set(false);
  }

  savePaymentMethod(): void {
    if (!this.selectedOrder() || this.savingPaymentMethod()) return;
    const orderId = this.selectedOrder()!.id;
    const choice = this.paymentMethodEdit();

    // Regular invoice: the order goes (back) to the card flow, and the invoice modal opens so the
    // admin creates and sends it — whole or split. Nothing is billed or sent without that step.
    if (choice === 'RegularInvoice') {
      if ((this.selectedOrder()!.paymentMethod || 'Normal') === 'Normal') {
        this.editingPaymentMethod.set(false);
        this.openCustomerInvoiceModal();
        return;
      }
      this.pendingOpenInvoiceAfterMethodSave = true;
    }
    const method: PaymentMethodValue = choice === 'RegularInvoice' ? 'Normal' : choice;

    if (method === 'Invoice' && !this.paymentMethodEditClientId()) {
      this.errorMessage.set('Choose the commercial client this order is billed to.');
      return;
    }

    this.savingPaymentMethod.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.adminService.updateOrderPaymentMethod(
      orderId,
      method,
      // Only a settled method carries a reference or notes — see isSettledPaymentMethod.
      isSettledOnRecord(method) ? (this.paymentMethodEditReference()?.trim() || null) : null,
      isSettledOnRecord(method) ? (this.paymentMethodEditNotes()?.trim() || null) : null,
      method === 'Invoice' ? this.paymentMethodEditClientId() : null
    ).subscribe({
      next: (res) => {
        this.editingPaymentMethod.set(false);
        // Mirror the returned method + status into the panel and the table row so the
        // status badge, DoneM label and Payment Method filter update without a reload.
        if (this.selectedOrder() && this.selectedOrder()!.id === orderId) {
          this.selectedOrder()!.paymentMethod = res.paymentMethod;
          this.selectedOrder.set(this.selectedOrder());
          this.selectedOrder()!.paymentReference = res.paymentReference;
          this.selectedOrder.set(this.selectedOrder());
          this.selectedOrder()!.paymentNotes = res.paymentNotes;
          this.selectedOrder.set(this.selectedOrder());
          this.selectedOrder()!.status = res.status;
          this.selectedOrder.set(this.selectedOrder());
        }
        const listOrder = this.orders().find(o => o.id === orderId);
        if (listOrder) {
          listOrder.paymentMethod = res.paymentMethod;
          this.orders.set(this.orders());
          listOrder.paymentReference = res.paymentReference;
          this.orders.set(this.orders());
          listOrder.paymentNotes = res.paymentNotes;
          this.orders.set(this.orders());
          listOrder.status = res.status;
          this.orders.set(this.orders());
        }
        this.successMessage.set(res?.message || 'Payment method updated.');
        this.clearMessagesAfterDelay();
        this.refreshOrderAfterSave();
        if (this.pendingOpenInvoiceAfterMethodSave && this.selectedOrder()?.id === orderId) this.openCustomerInvoiceModal();
        this.pendingOpenInvoiceAfterMethodSave = false;
      },
      error: (err) => {
        this.pendingOpenInvoiceAfterMethodSave = false;
        this.savingPaymentMethod.set(false);
        console.error('Error updating payment method:', err);
        this.errorMessage.set(err?.error?.message || 'Failed to update payment method.');
        this.clearMessagesAfterDelay();
      },
      complete: () => { this.savingPaymentMethod.set(false); }
    });
  }

  /**
   * Total additional payment = current total − original total, TIPS INCLUDED — not the sum of
   * the update rows. Mirrors `OrderAdditionalCharge` on the server.
   *
   * It used to compare the tip-free totals. That made a tip added to a paid order (order #386,
   * +$270.00) write an "Unpaid" history row that nothing could collect: the unpaid amount read
   * $0.00, so the Send updated payment / reminder row never appeared and the payment page said
   * "Nothing to pay". The "(no tips)" pricing columns still display tip-free; only this sum moved.
   */
  getTotalAdditionalAmount(): number {
    if (!this.selectedOrder() || !this.orderUpdateHistory()?.length) return 0;
    const current = Number(this.selectedOrder()!.total ?? 0) || 0;
    const original = this.getOriginalTotalWithTips();
    return Math.max(0, Math.round((current - original) * 100) / 100);
  }

  /** What the customer originally paid, tips included — the booking snapshot, else the earliest
   * update row's original total (legacy orders carry no snapshot). */
  private getOriginalTotalWithTips(): number {
    if (!this.selectedOrder()) return 0;
    if (this.selectedOrder()!.initialTotal > 0) return Number(this.selectedOrder()!.initialTotal) || 0;
    const first = this.orderUpdateHistory()?.[0];
    return first ? Number(first.originalTotal) || 0 : 0;
  }

  /**
   * Unpaid portion = total additional − what has already been COLLECTED.
   *
   * Positive rows only, mirroring `OrderAdditionalCharge.WasCollected` on the server. A negative
   * row is a price DECREASE, never money the customer handed over, and subtracting one adds to
   * the bill: order #359 (booked 2743.65 → edited down to 500.00 → edited back up) reported
   * 2243.65 − (−2243.65) = $4,487.30 owed instead of $2,243.65.
   */
  getUnpaidAdditionalAmount(): number {
    const total = this.getTotalAdditionalAmount();
    if (total <= 0 || !this.orderUpdateHistory()?.length) return 0;
    const paid = this.orderUpdateHistory()
      .filter(u => u.isPaid && (Number(u.additionalAmount) || 0) > 0)
      .reduce((sum, u) => sum + (Number(u.additionalAmount) || 0), 0);
    return Math.max(0, Math.round((total - paid) * 100) / 100);
  }

  /**
   * What an Update History row did to the price, for display only.
   *
   * Read from the row's own totals rather than `additionalAmount`, which is floored at zero on
   * the way in (see OrderAdditionalCharge) and so reads +$0.00 for every price decrease. The
   * decrease is still a real edit the admin needs to see; it is simply not money owed.
   */
  getUpdateRowDelta(update: { originalTotal?: number; newTotal?: number }): number {
    const original = Number(update?.originalTotal) || 0;
    const updated = Number(update?.newTotal) || 0;
    return Math.round((updated - original) * 100) / 100;
  }

  // Gate for the "Send payment reminder" / "Send updated payment" row in the order details
  // panel. The row only makes sense for Stripe-paid orders with an unpaid additional balance.
  //
  // Phase 1 manual payment: when admin marked a Done order with a non-Stripe method (Cash /
  // Zelle / Check / Other), no further reminders apply — admin recorded the payment in person,
  // there's nothing to remind. Hide the row in that case.
  shouldShowPaymentReminderRow(): boolean {
    const o = this.selectedOrder();
    if (!o) return false;
    if (!o.isPaid) return false;
    if (o.status === 'Cancelled') return false;
    if (this.getUnpaidAdditionalAmount() <= 0.01) return false;
    // Done + non-Stripe payment → no reminder. Treat missing paymentMethod as Normal so old
    // rows without the field still show the button when they would have before Phase 1.
    if (o.status === 'Done' && (o.paymentMethod || 'Normal') !== 'Normal') return false;
    return true;
  }

  readonly sendingReminder = signal(false);
  sendPaymentReminder(): void {
    if (!this.selectedOrder() || this.sendingReminder()) return;
    const orderId = this.selectedOrder()!.id;
    this.sendingReminder.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.adminService.sendPaymentReminder(orderId).subscribe({
      next: (res) => {
        this.successMessage.set(res?.message || 'Reminder sent successfully.');
        setTimeout(() => { this.successMessage.set(''); }, 5000);
        this.refreshOrderAfterSave();
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to send reminder.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.sendingReminder.set(false); }
    });
  }

  // True when the customer has not yet been told about the current outstanding additional amount.
  // The admin panel uses this to show "Send Updated Payment" (first send) instead of the regular
  // "Send Payment Reminder" button.
  hasUnnotifiedAdditionalPayment(): boolean {
    if (!this.orderUpdateHistory()?.length) return false;
    return this.orderUpdateHistory().some(
      u => !u.isPaid && (u.additionalAmount || 0) > 0.01 && !u.updatedPaymentNotificationSentAt
    );
  }

  readonly sendingUpdatedPayment = signal(false);
  sendUpdatedPayment(): void {
    if (!this.selectedOrder() || this.sendingUpdatedPayment()) return;
    const orderId = this.selectedOrder()!.id;
    this.sendingUpdatedPayment.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.adminService.sendUpdatedPayment(orderId).subscribe({
      next: (res) => {
        this.successMessage.set(res?.message || 'Updated-payment notification sent.');
        setTimeout(() => { this.successMessage.set(''); }, 5000);
        // Refresh so the button switches to "Send Payment Reminder" (and everything else updates).
        this.refreshOrderAfterSave();
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to send updated-payment notification.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.sendingUpdatedPayment.set(false); }
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
        this.assignedCleanersCache().set(orderId, cleaners);
        this.assignedCleanersCache.set(this.assignedCleanersCache());
        this.cleanersLoadedSet().add(orderId);
        this.cleanersLoadedSet.set(this.cleanersLoadedSet());
      },
      error: (error) => {
        this.assignedCleanersCache().set(orderId, []);
        this.assignedCleanersCache.set(this.assignedCleanersCache());
        this.cleanersLoadedSet().add(orderId);
        this.cleanersLoadedSet.set(this.cleanersLoadedSet());
      }
    });
  }

  /**
   * Assigning a cleaner does NOT notify them — the assignment mail is a separate, deliberate
   * action — so a cleaner unassigned before it went out has never heard of this job, and the
   * server sends them no removal email. Say so up front rather than promising a mail that is
   * not coming. The server decides; this only keeps the wording honest.
   */
  private wasCleanerNotifiedOfAssignment(orderId: number, cleanerId: number): boolean {
    const cleaner = this.getAssignedCleanersWithIds(orderId).find(c => c.id === cleanerId);
    if (!cleaner) return false;
    return cleaner.assignmentNotificationSentAt != null && cleaner.assignmentNotificationSentAt !== '';
  }

  removeCleanerFromOrder(orderId: number, cleanerId: number, cleanerName: string) {
    const wasNotified = this.wasCleanerNotifiedOfAssignment(orderId, cleanerId);
    const confirmMessage = wasNotified
      ? `Are you sure you want to remove ${cleanerName} from this order? They will receive an email notification about the removal.`
      : `Are you sure you want to remove ${cleanerName} from this order? They were never sent the assignment email, so no removal email will go out.`;

    if (confirm(confirmMessage)) {
      this.loadingStates().removingCleaner = true;
      this.loadingStates.set(this.loadingStates());
      
      this.cleanerService.removeCleanerFromOrder(orderId, cleanerId).subscribe({
        next: (response: any) => {
          const notified = response?.removalNotificationSent ?? wasNotified;
          this.successMessage.set(notified
            ? `${cleanerName} has been removed from the order and notified via email.`
            : `${cleanerName} has been removed from the order. No email was sent — they had not been notified about this job.`);

          // Removing a cleaner changes what the job costs (the duration re-splits), so the
          // order's stored salary and the breakdown both move. Refetch rather than leave the
          // panel showing the pre-removal split.
          this.refreshOrderAfterSave();

          // Refresh assigned cleaners from server after removal
          this.adminService.getAssignedCleanersWithIds(orderId).subscribe({
            next: (updatedCleaners) => {
              // Update cache with fresh data from server
              this.assignedCleanersCache().set(orderId, updatedCleaners);
              this.assignedCleanersCache.set(this.assignedCleanersCache());
              
              // Remove manual change detection to prevent loops
              // this.cdr.detectChanges();
            },
            error: (error) => {
              console.error('Error refreshing assigned cleaners after removal:', error);
              // Fallback: update cache manually
              const currentCleaners = this.assignedCleanersCache().get(orderId) || [];
              const updatedCleaners = currentCleaners.filter(c => c.id !== cleanerId);
              this.assignedCleanersCache().set(orderId, updatedCleaners);
              this.assignedCleanersCache.set(this.assignedCleanersCache());
              // Remove manual change detection to prevent loops
              // this.cdr.detectChanges();
            }
          });
          
          this.clearMessagesAfterDelay();
        },
        error: (error) => {
          console.error('Error removing cleaner:', error);
          this.errorMessage.set('Failed to remove cleaner from order.');
        },
        complete: () => {
          this.loadingStates().removingCleaner = false;
          this.loadingStates.set(this.loadingStates());
        }
      });
    }
  }

  openCleanerAssignmentModal(orderId: number) {
    this.assigningOrderId.set(orderId);
    this.selectedCleaners.set([]);
    this.tipsForCleaner.set('');
    this.cleanerAssignmentSearchQuery.set('');
    this.showBusyCleaners.set(false);
    this.acknowledgeScheduleConflicts.set(false);

    // Set hourly rate from order data if available, otherwise use default based on cleaning type
    const order = this.orders().find(o => o.id === orderId);
    if (this.selectedOrder() && this.selectedOrder()!.id === orderId) {
      this.cleanerHourlySalary.set(this.selectedOrder()!.cleanerHourlyRate || this.getDefaultHourlyRate(orderId));
    } else {
      this.cleanerHourlySalary.set(this.getDefaultHourlyRate(orderId));
    }

    this.cleanerService.getAvailableCleaners(orderId).subscribe({
      next: (cleaners) => {
        this.availableCleaners.set(cleaners);
        this.showCleanerModal.set(true);
      },
      error: (error) => {
        console.error('Error loading available cleaners:', error);
        this.errorMessage.set('Failed to load available cleaners.');
      }
    });
  }

  closeCleanerModal() {
    this.showCleanerModal.set(false);
    this.assigningOrderId.set(null);
    this.selectedCleaners.set([]);
    this.tipsForCleaner.set('');
    this.availableCleaners.set([]);
    this.cleanerAssignmentSearchQuery.set('');
    this.showBusyCleaners.set(false);
    this.acknowledgeScheduleConflicts.set(false);
    this.cleanerHourlySalary.set(REGULAR_CLEANER_HOURLY_RATE);
  }

  /**
   * Cleaners shown in the assign modal. Applies the name/email search, then — unless
   * "Show busy" is on — hides cleaners that are marked busy that day or have a same-day
   * scheduling conflict. Already-selected cleaners stay visible regardless.
   *
   * Conflicting cleaners stay HIDDEN by default even though they can now be assigned: the
   * default list is "who should do this job", and somebody with another job an hour away is
   * still the wrong first answer. "Show busy cleaners" is how an admin goes looking for them.
   */
  get availableCleanersFiltered(): AvailableCleaner[] {
    const q = this.cleanerAssignmentSearchQuery().trim().toLowerCase();
    return this.availableCleaners().filter((c) => {
      if (q) {
        const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase().trim();
        const email = (c.email ?? '').toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      if (this.showBusyCleaners()) return true;
      if (this.isCleanerSelected(c.id)) return true;
      return !c.isBusyDay && !c.hasScheduleConflict;
    });
  }

  /** Count of busy/conflicting cleaners currently hidden by the "Show busy" toggle. */
  get hiddenBusyCleanersCount(): number {
    if (this.showBusyCleaners()) return 0;
    return this.availableCleaners().filter(
      (c) => (c.isBusyDay || c.hasScheduleConflict) && !this.isCleanerSelected(c.id)
    ).length;
  }

  /**
   * The picked cleaners who already have another job within an hour that day.
   *
   * Drives the acknowledgement banner and, through it, the flag the server needs before it will
   * accept the assignment. Derived from the current selection rather than tracked as a flag, so
   * de-selecting the last conflicting cleaner takes the banner away on its own.
   */
  get selectedCleanersWithConflicts(): AvailableCleaner[] {
    return this.availableCleaners().filter(
      (c) => c.hasScheduleConflict && this.isCleanerSelected(c.id)
    );
  }

  /** Names for the acknowledgement banner, in the order they appear in the list. */
  get selectedConflictNames(): string {
    return this.selectedCleanersWithConflicts
      .map((c) => `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || `Cleaner #${c.id}`)
      .join(', ');
  }

  /**
   * Blocks the Assign button only while a conflict is picked and NOT acknowledged. A schedule
   * conflict is advice the admin may overrule — they know the two addresses are on the same
   * block — but overruling it has to be a deliberate act, which is also exactly what the server
   * requires (AssignCleanersDto.AcknowledgeScheduleConflicts).
   */
  get conflictAcknowledgementOwed(): boolean {
    return this.selectedCleanersWithConflicts.length > 0 && !this.acknowledgeScheduleConflicts();
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
   * filthy pays the highest rate, heavy condition and post construction the top rate, move in/out
   * and residential deep cleaning the mid rate, everything else the base rate. Only a fallback —
   * a rate already stored on the order (including an admin override) always wins.
   */
  getDefaultHourlyRate(orderId: number): number {
    const details = this.selectedOrder()?.id === orderId ? this.selectedOrder() : null;
    const listed = this.orders().find(o => o.id === orderId);

    // Residential deep cleaning is signalled by the extra service (but not "super deep"): its
    // flags decide, an unkeyed, un-flagged line by its name as before.
    const hasDeepCleaning = !!details?.extraServices?.some(
      es => isDeepOrSuperDeepExtra(es) && !isSuperDeepExtra(es)
    );

    // Custom ("Pre-Arranged") orders match on their per-order label, like every other
    // human-facing surface — the details DTO already resolves serviceTypeName to it.
    const serviceTypeName = details?.serviceTypeName
      ?? (listed?.isCustomServiceType ? listed?.customServiceDisplayName : listed?.serviceTypeName)
      ?? '';

    // The calculator takes the deep-cleaning FEE; here we only know whether it applies.
    // A keyed, non-custom type is rated by its key (details only - the list row carries no key).
    return getDefaultCleanerHourlyRate(hasDeepCleaning ? 1 : 0, serviceTypeName, details?.serviceTypeKey ?? null);
  }

  /** The "(3h 30m × 2 × $21)" working shown under Est. Total in the assign-cleaners modal.
   *  Built from the same per-cleaner minutes the salary uses — showing the raw total
   *  duration here would contradict the figure above it whenever maids > 1. */
  getEstimatedSalaryBreakdown(): string {
    const order = this.selectedOrder();
    if (!order) return '';
    const maids = this.getSelectedOrderSplitCount();
    const perCleaner = DurationUtils.formatMinutes(
      calculatePerCleanerBillableMinutes(Number(order.totalDuration) || 0, maids, order.hasCleanersService)
    );
    const rate = `$${this.cleanerHourlySalary()}`;
    return maids > 1 ? `${perCleaner} × ${maids} × ${rate}` : `${perCleaner} × ${rate}`;
  }

  /**
   * Estimated total salary shown in the assign-cleaners modal.
   *
   * Deliberately still a RECOMPUTE, unlike the details panel's getDisplayCleanerTotalSalary
   * (reviewed 2026-08-31). This is forward-looking: `cleanerHourlySalary` is an editable input in
   * the modal and is SENT with the assignment, so the figure answers "what will the assignment I
   * am about to make cost at the rate I am typing". Reading the stored column here would show the
   * cost of the OLD staffing, which is the opposite of what the admin is asking.
   *
   * KNOWN CAVEAT, Phase 2 (docs/phase-2-3-backlog.md): opened on an order that ALREADY has
   * cleaners, this ignores their per-cleaner rate/hours overrides, and confirming overwrites
   * Order.CleanerHourlyRate for every line that has no rate of its own. The label says "Est." and
   * the details panel now shows the real per-cleaner breakdown a few inches away, so it is left
   * as-is rather than half-fixed.
   */
  getEstimatedTotalSalary(): number {
    if (!this.selectedOrder()) return 0;
    return calculateCleanerTotalSalary(
      this.selectedOrder()!.totalDuration,
      this.getSelectedOrderSplitCount(),
      this.selectedOrder()!.hasCleanersService,
      this.cleanerHourlySalary()
    );
  }

  /**
   * Display value for the "Cleaners Total Salary" row in the details view.
   *
   * Reads the STORED figure once anybody is assigned. That column is written by
   * CleanerPayrollCalculator.ApplyOrderTotalSalary on every event that can move it (assign,
   * unassign, order edit, per-cleaner rate/hours override, order-rate change) and is what
   * Statistics and Finances report as labour cost — so it is the only number here that can agree
   * with the Outgoing Payments page.
   *
   * This used to recompute unconditionally from TotalDuration x MaidsCount x rate. That form
   * cannot see a per-cleaner rate or hours override, which live on OrderCleaner and only the
   * payroll calculator reads: order #315 had one cleaner edited down to 3h and displayed $200
   * against a payout sheet of $175 (2026-08-31). The old comment justified it as protection
   * against a stale stored value, which was true before every write path was routed through the
   * calculator and is not any more.
   *
   * The fallback survives for the pre-assignment case ONLY, where there are no per-cleaner rows
   * to be wrong about and a legacy order may still carry a stale column. Unknown load state
   * prefers the stored value: guessing "nobody is assigned" is exactly what produced the wrong
   * number, and the panel preloads assignments anyway.
   */
  getDisplayCleanerTotalSalary(): number {
    const order = this.selectedOrder();
    if (!order) return 0;

    if (!this.selectedOrderHasNoCleanersAssigned()) {
      return Number(order.cleanerTotalSalary) || 0;
    }

    const totalDuration = Number(order.totalDuration) || 0;
    const maids = this.getSelectedOrderSplitCount();
    const rate = Number(order.cleanerHourlyRate) || 0;
    if (rate <= 0 || maids <= 0 || totalDuration <= 0) return 0;
    return calculateCleanerTotalSalary(totalDuration, maids, order.hasCleanersService, rate);
  }

  /**
   * Loads the wage breakdown behind "Cleaners Total Salary".
   *
   * Failure is non-fatal and silent: the total above it comes from the order itself, so a failed
   * breakdown costs the admin the itemisation, not the figure. Nothing here is ever written back.
   */
  private loadOrderCleanerPayroll(orderId: number): void {
    this.selectedOrderPayroll.set(null);
    this.loadingOrderPayroll.set(true);
    this.adminService.getOrderCleanerPayroll(orderId).subscribe({
      next: (payroll) => {
        // A late response for an order the admin has already navigated away from must not paint
        // over the panel they are now looking at.
        if (this.viewingOrderId() === orderId) this.selectedOrderPayroll.set(payroll);
      },
      error: () => { this.selectedOrderPayroll.set(null); },
      complete: () => { this.loadingOrderPayroll.set(false); }
    });
  }

  /**
   * The staffing warnings for the open order — the SAME text the Outgoing Payments page prints
   * for the same job, built once on the server (`OrderStaffingWarnings`) and never recomputed
   * here. Two implementations of one warning is how the two screens end up disagreeing about a
   * single job, and an admin comparing them has no way to tell which is right.
   *
   * Reads the same bulk cache the table's ⚠ tooltip reads, so the tooltip and the panel cannot
   * show different reasons for one order. Visible to Admin as well as SuperAdmin — it comes from
   * the staffing-warnings endpoint, not from the SuperAdmin-only wage breakdown it renders under.
   *
   * Empty while the fetch is outstanding or if it failed: an absent warning list is not the same
   * claim as "nothing is wrong", which is why the block disappears entirely rather than rendering
   * an all-clear nobody checked.
   */
  getOrderStaffingWarnings(): string[] {
    const orderId = this.selectedOrder()?.id;
    if (orderId == null) return [];
    return this.staffingWarningsByOrderId().get(orderId) ?? [];
  }

  /**
   * Tooltip for the table row's ⚠, in the Outgoing Payments format — the reasons joined with
   * " · " on a native `title`, which is what keeps it a hover with no layout of its own.
   *
   * Two sources, answering different questions: the existing advisory staffing-review flag
   * (per-cleaner load over 6h, computed live, clears the moment an admin raises the count) and
   * the server-built warnings. The advisory one goes first — it is the cheaper signal and the one
   * an admin can act on without opening anything.
   */
  getStaffingWarningTooltip(order: AdminOrderList): string {
    const reasons: string[] = [];
    if (this.needsStaffingReview(order)) {
      reasons.push('Long job — review cleaner count (over 6h per cleaner)');
    }
    reasons.push(...(this.staffingWarningsByOrderId().get(order.id) ?? []));
    return reasons.join(' · ');
  }

  /** Whether the row's ⚠ shows at all: the advisory long-job flag, or any server-built warning. */
  hasStaffingWarnings(order: AdminOrderList): boolean {
    return this.needsStaffingReview(order)
      || (this.staffingWarningsByOrderId().get(order.id)?.length ?? 0) > 0;
  }

  /** Every line in the breakdown, assigned first then the unstaffed slots, so the rows a reader
   *  adds up are exactly the rows that make the total. */
  getOrderPayrollLines(): OrderCleanerPayrollLine[] {
    const p = this.selectedOrderPayroll();
    if (!p) return [];
    return [...p.lines, ...p.unassignedLines];
  }

  /** Label for one breakdown row. Unstaffed slots have no name to show. */
  getPayrollLineName(line: OrderCleanerPayrollLine): string {
    if (line.isUnassignedSlot) return 'Unassigned slot';
    const name = `${line.firstName ?? ''} ${line.lastName ?? ''}`.trim();
    return name || `Cleaner #${line.cleanerId}`;
  }

  /** Hours as the payouts page prints them: already on the rounding increment, never re-rounded. */
  getPayrollLineHours(line: OrderCleanerPayrollLine): string {
    return DurationUtils.formatMinutes(Number(line.billableMinutes) || 0);
  }

  /**
   * True when the breakdown's derived total disagrees with the column Statistics and Finances
   * read. It should be impossible — every write path routes through
   * CleanerPayrollCalculator.ApplyOrderTotalSalary — so it is surfaced rather than hidden: a
   * mismatch means a row written before that was true, or a write path that escaped it.
   */
  payrollDisagreesWithStored(): boolean {
    const p = this.selectedOrderPayroll();
    if (!p) return false;
    return Math.abs(Number(p.totalSalary) - Number(p.storedTotalSalary)) >= 0.01;
  }

  // ===== Editing the wage breakdown =====

  /**
   * May this user SEE what the cleaners are paid on this order?
   *
   * Admin and SuperAdmin (2026-09, owner's call). It was SuperAdmin-only, which left the people
   * who actually staff the jobs unable to check the figure they are asked about on the phone.
   * Moderators are View-only on the panel and the server answers them 403, so the block is not
   * drawn for them either — a permanently empty section reads as a broken page.
   *
   * Deliberately a role test rather than `canUpdate`: reading is not editing, and
   * `canEditCleanerPayroll` below is the separate gate on the buttons.
   */
  readonly canViewCleanerPayroll = computed<boolean>(() => this.isSuperAdmin() || this.userRole() === 'Admin');

  /**
   * May this user change what a cleaner is paid on this order?
   *
   * The same test as editing the order itself (`canEditOrder`), and deliberately so: an Admin who
   * can move the service date can record that the crew worked an extra quarter of an hour.
   * Moderators are View-only and out, which the server enforces independently with
   * `[RequirePermission(Permission.Update)]` — this only decides whether the buttons are drawn.
   *
   * Note it is NOT gated on the order-edit APPROVAL grant. A payroll figure moves no
   * customer-facing price, so it is not a change request: it lands immediately and is audited,
   * exactly as it is on the Outgoing Payments page.
   */
  get canEditCleanerPayroll(): boolean {
    return this.canEditOrder;
  }

  /**
   * Promo/special and subscription discounts are SuperAdmin-only in Edit Order (owner's rule,
   * 2026-09). Everyone else sees them read-only — they still re-scale with the subtotal — and the
   * server refuses a typed change from anyone else (Helpers/OrderDiscountEditPolicy).
   */
  readonly canEditOrderDiscounts = computed<boolean>(() => this.isSuperAdmin());

  /** True when at least one line carries a manual hours figure — i.e. there is something to reset. */
  payrollHasHoursOverrides(): boolean {
    return (this.selectedOrderPayroll()?.lines ?? []).some(l => l.hoursOverridden);
  }

  /**
   * What the for-all editor will and will not move, said before it is saved.
   *
   * "Every cleaner" MEANS every cleaner (owner's call, 2026-09): a line carrying its own rate is
   * dropped back onto the order's, because the control reads as "everyone on this job is paid X"
   * and leaving two people behind on an old figure made the panel look broken. Two things it
   * still cannot move, and each earns a sentence — an unstaffed slot has no assignment row for an
   * hours override to live on, and an already-PAID line keeps the rate its payout was calculated
   * at, because that money has left.
   */
  payrollForAllReach(): string {
    const p = this.selectedOrderPayroll();
    if (!p) return '';

    const assigned = p.assignedCount;
    const parts = [`Applies to all ${assigned} cleaner${assigned === 1 ? '' : 's'} on this order, including any set by hand.`];

    const slots = p.unassignedLines.length;
    if (slots > 0) {
      parts.push(`${slots} unstaffed slot${slots === 1 ? '' : 's'} stay on the automatic split — there is no cleaner record to set hours on.`);
    }

    parts.push('A cleaner already paid keeps the rate they were paid at.');

    return parts.join(' ');
  }

  /** Decimal hours from minutes, for the edit inputs. 255 -> 4.25. */
  private payrollHoursOf(minutes: number | null | undefined): number {
    return Math.round(((Number(minutes) || 0) / 60) * 100) / 100;
  }

  isEditingPayrollLine(line: OrderCleanerPayrollLine): boolean {
    return !line.isUnassignedSlot && this.payrollEditingCleanerId() === line.orderCleanerId;
  }

  /**
   * Opens one line's editor, seeded with what is IN FORCE rather than with the override — so an
   * untouched line shows the automatic figures and saving it unchanged pins exactly what was
   * already being paid, instead of some other number.
   */
  startEditPayrollLine(line: OrderCleanerPayrollLine): void {
    if (!this.canEditCleanerPayroll || line.isUnassignedSlot) return;
    this.cancelPayrollOrderEditors();
    this.payrollEditingCleanerId.set(line.orderCleanerId);
    this.payrollEditRate.set(Number(line.hourlyRate) || 0);
    this.payrollEditHours.set(this.payrollHoursOf(line.billableMinutes));
    this.payrollError.set('');
  }

  cancelEditPayrollLine(): void {
    this.payrollEditingCleanerId.set(null);
    this.payrollEditRate.set(null);
    this.payrollEditHours.set(null);
  }

  savePayrollLine(line: OrderCleanerPayrollLine): void {
    if (!this.isEditingPayrollLine(line) || this.savingPayroll()) return;

    const rate = this.payrollEditRate();
    const hours = this.payrollEditHours();
    if (rate == null || rate < 0 || hours == null || hours < 0) {
      this.payrollError.set('Rate and hours must both be zero or more.');
      return;
    }

    this.writePayroll(
      this.adminService.updateOrderCleanerPayroll(this.selectedOrder()!.id, line.orderCleanerId, {
        hourlyRate: rate,
        billableMinutes: Math.round(hours * 60),
        updateHourlyRate: true,
        updateBillableMinutes: true
      }),
      'Could not save that change.'
    );
  }

  /**
   * Drops both of this line's overrides so it follows the order again. Distinct from typing the
   * automatic numbers back in: a cleared override keeps tracking the order if it is re-priced
   * later, a re-typed one does not.
   */
  resetPayrollLineToAutomatic(line: OrderCleanerPayrollLine): void {
    if (!this.canEditCleanerPayroll || line.isUnassignedSlot || this.savingPayroll()) return;

    this.writePayroll(
      this.adminService.updateOrderCleanerPayroll(this.selectedOrder()!.id, line.orderCleanerId, {
        hourlyRate: null,
        billableMinutes: null,
        updateHourlyRate: true,
        updateBillableMinutes: true
      }),
      'Could not reset that line.'
    );
  }

  /**
   * Opens the one order-level editor. Hours are seeded with the AUTOMATIC split — the figure the
   * admin is about to adjust away from ("4 hours each, make it 4:15") — and the rate with the
   * order's own. Seeding hours from a line that already carries an override would silently
   * re-apply one person's exception to the whole crew.
   */
  startEditPayrollForAll(): void {
    if (!this.canEditCleanerPayroll) return;
    this.cancelEditPayrollLine();
    this.cancelEditMaidsCount();
    this.editingPayrollForAll.set(true);
    this.payrollAllHoursInput.set(this.payrollHoursOf(
      this.selectedOrderPayroll()?.automaticMinutesPerCleaner));
    this.payrollAllRateInput.set(Number(this.selectedOrderPayroll()?.orderHourlyRate ?? this.selectedOrder()?.cleanerHourlyRate) || 0);
    this.payrollAllSeed = { hours: this.payrollAllHoursInput(), rate: this.payrollAllRateInput() };
    this.payrollError.set('');
  }

  cancelEditPayrollForAll(): void {
    this.editingPayrollForAll.set(false);
    this.payrollAllHoursInput.set(null);
    this.payrollAllRateInput.set(null);
    this.payrollAllSeed = { hours: null, rate: null };
  }

  /**
   * Saves the order-level editor — hours for every assigned cleaner, the order's default rate, or
   * both.
   *
   * **Only what actually moved is sent**, and that is not tidiness: the hours box is seeded with
   * the automatic split, so re-sending it would write an explicit override of that figure onto
   * every line, and an explicit value stops tracking the order when it is re-priced. An admin who
   * only meant to change the rate must not silently pin everyone's hours.
   *
   * The rate goes FIRST when both moved, because that call pins already-paid lines to the OLD
   * rate before the order moves. Doing it after an hours change would still pin them correctly,
   * but rate-then-hours is the order the two decisions were made in, and it is the order the
   * audit log reads back as.
   */
  savePayrollForAll(): void {
    if (!this.editingPayrollForAll() || this.savingPayroll()) return;

    const orderId = this.selectedOrder()?.id;
    if (orderId == null) return;

    const hours = this.payrollAllHoursInput();
    const rate = this.payrollAllRateInput();
    // With nobody assigned there is no hours box: an override has no row to live on, and the
    // order rate is still worth setting ahead of staffing the job.
    const hasAssigned = (this.selectedOrderPayroll()?.assignedCount ?? 0) > 0;

    if (rate == null || rate < 0 || (hasAssigned && (hours == null || hours < 0))) {
      this.payrollError.set('Rate and hours must both be zero or more.');
      return;
    }

    const writes: Observable<OrderCleanerPayroll>[] = [];
    if (rate !== this.payrollAllSeed.rate) {
      writes.push(this.adminService.updateOrderCleanerHourlyRate(orderId, rate));
    }
    if (hasAssigned && hours != null && hours !== this.payrollAllSeed.hours) {
      writes.push(this.adminService.updateOrderCleanerHours(orderId, Math.round(hours * 60)));
    }

    // Nothing typed is not an error — it is a cancel that happened to go through the Save button,
    // and sending two no-op writes would put two rows in the audit log saying so.
    if (writes.length === 0) {
      this.cancelEditPayrollForAll();
      return;
    }

    // Sequential, and the LAST response wins: each endpoint answers with the whole breakdown, so
    // the final one is the state after both changes. In parallel they would race two re-sums of
    // the same order.
    this.writePayroll(concat(...writes).pipe(last()), 'Could not save that change.');
  }

  // ── Cleaners Count, on the Wages card ───────────────────────────────────────────────────
  // It used to be a box in Edit Order, which sent a pure staffing / wages figure through the
  // order-edit approval queue. It lives here now, beside the rate and hours it drives.
  readonly editingMaidsCount = signal(false);
  readonly maidsCountInput = signal<number | null>(null);

  /**
   * A cleaner+hours order is the exception: its count is the customer's PRICED Cleaners line
   * (cleaners × hours), edited through that service row in Edit Order, and the server refuses
   * a standalone write for it.
   */
  canEditMaidsCountFromWages(): boolean {
    return this.canEditCleanerPayroll && !!this.selectedOrder() && !this.selectedOrder()!.hasCleanersService;
  }

  startEditMaidsCount(): void {
    if (!this.canEditMaidsCountFromWages()) return;
    this.cancelEditPayrollLine();
    this.cancelEditPayrollForAll();
    this.maidsCountInput.set(Number(this.selectedOrder()?.maidsCount) || 1);
    this.editingMaidsCount.set(true);
    this.payrollError.set('');
  }

  cancelEditMaidsCount(): void {
    this.editingMaidsCount.set(false);
    this.maidsCountInput.set(null);
  }

  saveMaidsCount(): void {
    if (!this.editingMaidsCount() || this.savingPayroll()) return;
    const orderId = this.selectedOrder()?.id;
    if (orderId == null) return;

    const count = Number(this.maidsCountInput());
    if (!Number.isInteger(count) || count < 1) {
      this.payrollError.set('Cleaners count must be a whole number, 1 or more.');
      return;
    }
    // Unchanged is a cancel, not a write — it would only add an audit row saying nothing moved.
    if (count === (Number(this.selectedOrder()?.maidsCount) || 1)) {
      this.cancelEditMaidsCount();
      return;
    }

    this.writePayroll(this.adminService.updateOrderMaidsCount(orderId, count), 'Could not save the cleaners count.');
  }

  /** Clears every per-cleaner hours override at once, putting the order back on the even split. */
  resetPayrollHoursForAll(): void {
    if (!this.canEditCleanerPayroll || this.savingPayroll()) return;
    this.writePayroll(
      this.adminService.updateOrderCleanerHours(this.selectedOrder()!.id, null),
      'Could not reset the hours.'
    );
  }

  /**
   * Clears every open payroll editor and its error. Called when the panel opens on a DIFFERENT
   * order and when it closes — a half-typed rate left sitting in an input would otherwise be
   * saved against the next order the admin opened.
   */
  private resetPayrollEditState(): void {
    this.cancelEditPayrollLine();
    this.cancelPayrollOrderEditors();
    this.savingPayroll.set(false);
    this.payrollError.set('');
  }

  private cancelPayrollOrderEditors(): void {
    this.cancelEditPayrollForAll();
    this.cancelEditMaidsCount();
  }

  /**
   * The one place a payroll write is sent. Every endpoint answers with the WHOLE breakdown, so
   * the panel redraws from the response rather than patching a line in place — which is what kept
   * the old edit-form copy of the salary disagreeing with the payout sheet.
   *
   * `cleanerTotalSalary` on the open order and on its list row are refreshed from the same
   * response: they are what Statistics and Finances read, and leaving them stale would have the
   * panel's own total contradict the lines directly beneath it.
   */
  private writePayroll(request: Observable<OrderCleanerPayroll>, fallbackMessage: string): void {
    const orderId = this.selectedOrder()?.id;
    if (orderId == null) return;

    this.savingPayroll.set(true);
    this.payrollError.set('');

    request.subscribe({
      next: (payroll) => {
        // A late response for an order the admin has already navigated away from must not paint
        // over the panel they are now looking at.
        if (this.viewingOrderId() !== orderId) return;

        this.selectedOrderPayroll.set(payroll);
        this.applyPayrollTotalsToOrder(orderId, payroll);
        this.cancelEditPayrollLine();
        this.cancelPayrollOrderEditors();
        // The staffing warnings include "the rate is not the default for this service type", so
        // a rate change can clear or raise one.
        this.preloadStaffingWarnings([orderId]);
        this.refreshChangesIfLoaded(orderId);
      },
      error: (err) => {
        this.payrollError.set(extractApiErrorMessage(err, fallbackMessage));
      },
      complete: () => { this.savingPayroll.set(false); }
    });
  }

  /** Copies the re-summed wage figures onto the open order and its list row. */
  private applyPayrollTotalsToOrder(orderId: number, payroll: OrderCleanerPayroll): void {
    if (this.selectedOrder()?.id === orderId) {
      this.selectedOrder()!.cleanerTotalSalary = payroll.storedTotalSalary;
      this.selectedOrder.set(this.selectedOrder());
      this.selectedOrder()!.cleanerHourlyRate = payroll.orderHourlyRate;
      this.selectedOrder.set(this.selectedOrder());
      if (payroll.maidsCount != null) { this.selectedOrder()!.maidsCount = payroll.maidsCount; this.selectedOrder.set(this.selectedOrder()); }
    }
    const row: any = this.orders().find(o => o.id === orderId);
    if (row) {
      if ('cleanerTotalSalary' in row) { row.cleanerTotalSalary = payroll.storedTotalSalary; this.orders.set(this.orders()); }
      if ('cleanerHourlyRate' in row) { row.cleanerHourlyRate = payroll.orderHourlyRate; this.orders.set(this.orders()); }
      // The list row's staffing-review ⚠ reads maidsCount (same reason refreshOrderAfterSave copies it).
      if (payroll.maidsCount != null && 'maidsCount' in row) { row.maidsCount = payroll.maidsCount; this.orders.set(this.orders()); }
    }
  }

  /**
   * Is the selected order KNOWN to have nobody assigned? Deliberately phrased in the negative:
   * an unloaded assignment list must NOT read as "nobody assigned", because that is the state in
   * which recomputing the salary gives the wrong answer.
   */
  selectedOrderHasNoCleanersAssigned(): boolean {
    const order = this.selectedOrder();
    if (!order) return true;
    if (!this.cleanersLoadedSet().has(order.id)) return false; // unknown - assume assigned
    return (this.assignedCleanersCache().get(order.id)?.length ?? 0) === 0;
  }

  /** Inverse of the above, for template and guard readability. */
  selectedOrderHasAssignedCleaners(): boolean {
    return !!this.selectedOrder() && !this.selectedOrderHasNoCleanersAssigned();
  }

  /**
   * Recalculate the edit form's cleaner total salary when rate / duration / maids / lines change.
   *
   * NO-OP once anybody is assigned, and the guard lives HERE rather than at the five call sites
   * so a sixth cannot reintroduce the bug. `calculateCleanerTotalSalary` is the MaidsCount x rate
   * estimate; it cannot see a per-cleaner rate or hours override, so running it on a staffed
   * order overwrites the real figure with a wrong one and then submits it. The field is read-only
   * in that state anyway (see the template) and the server refuses the value, so there is nothing
   * to keep in sync: the stored figure seeded by startEditOrder simply stands.
   *
   * Pre-assignment it behaves exactly as before - there are no per-cleaner rows to be wrong
   * about, and the estimate is the best available answer.
   */
  recalcCleanerTotalSalary(): void {
    if (this.selectedOrderHasAssignedCleaners()) return;
    const rate = Number(this.editOrderForm().cleanerHourlyRate) || 0;
    const totalDuration = Number(this.editOrderForm().totalDuration) || 0;
    const maidsCount = Number(this.editOrderForm().maidsCount) || 1;
    const hasCleanersService = this.selectedOrder()?.hasCleanersService ?? false;
    this.editOrderForm().cleanerTotalSalary = calculateCleanerTotalSalary(totalDuration, maidsCount, hasCleanersService, rate);
    this.editOrderForm.set(this.editOrderForm());
  }

  /** The Cleaners Total Salary input is editable only while nobody is assigned. Once cleaners
   *  exist the per-cleaner rows own the figure and the server discards whatever is submitted. */
  canEditCleanerTotalSalary(): boolean {
    return !this.selectedOrderHasAssignedCleaners();
  }

  // Method to force refresh all assigned cleaners (for debugging)
  refreshAllAssignedCleaners() {
    this.assignedCleanersCache().clear();
    this.assignedCleanersCache.set(this.assignedCleanersCache());
    this.cleanersLoadedSet().clear();
    this.cleanersLoadedSet.set(this.cleanersLoadedSet());
    this.preloadAssignedCleaners();
  }

  /**
   * Every cleaner in the list is selectable, conflict or not (2026-08-31). The 1-hour-gap rule
   * cannot see that two jobs are on the same block or that the earlier one will finish early —
   * the admin can — so the conflict is surfaced on the card and acknowledged before the assign
   * goes through, rather than making the card dead.
   *
   * De-selecting the last conflicting cleaner also drops the acknowledgement: it was given for a
   * warning that is no longer on screen, and leaving it armed would carry it silently into the
   * next conflict the admin picks.
   */
  toggleCleanerSelection(cleanerId: number) {
    const index = this.selectedCleaners().indexOf(cleanerId);
    if (index > -1) {
      this.selectedCleaners().splice(index, 1);
      this.selectedCleaners.set(this.selectedCleaners());
    } else {
      this.selectedCleaners().push(cleanerId);
      this.selectedCleaners.set(this.selectedCleaners());
    }
    if (this.selectedCleanersWithConflicts.length === 0) {
      this.acknowledgeScheduleConflicts.set(false);
    }
  }

  isCleanerSelected(cleanerId: number): boolean {
    return this.selectedCleaners().includes(cleanerId);
  }

  assignCleanersToOrder() {
    if (!this.assigningOrderId() || this.selectedCleaners().length === 0) {
      this.errorMessage.set('Please select at least one cleaner.');
      return;
    }

    // The server refuses a conflicting assignment without the acknowledgement, so catching it
    // here is about the message: "tick the box" beats a 400 that reads like a hard refusal.
    if (this.conflictAcknowledgementOwed) {
      this.errorMessage.set('Confirm the schedule conflict before assigning.');
      return;
    }

    this.loadingStates().assigningCleaners = true;
    this.loadingStates.set(this.loadingStates());

    // Store the order ID before it gets cleared by modal close
    const orderIdToRefresh = this.assigningOrderId()!;
    const selectedCleanersToAssign = [...this.selectedCleaners()];
    // Only ever true off the admin's explicit tick — read before the modal close clears it.
    const conflictsAcknowledged = this.acknowledgeScheduleConflicts();

    this.cleanerService.assignCleaners(
      orderIdToRefresh,
      selectedCleanersToAssign,
      this.tipsForCleaner() || undefined,
      this.cleanerHourlySalary(),
      conflictsAcknowledged
    ).subscribe({
      next: (response) => {
        this.successMessage.set('Cleaners assigned successfully. Click “Send assignment email” when you are ready to notify them.');
        this.closeCleanerModal();

        // Refresh order details to reflect updated hourly rate and salary
        this.refreshOrderAfterSave();

        // Refresh assigned cleaners from server to get accurate current state
        setTimeout(() => {
          this.adminService.getAssignedCleanersWithIds(orderIdToRefresh).subscribe({
            next: (updatedCleaners) => {
              // Update cache with fresh data from server
              this.assignedCleanersCache().set(orderIdToRefresh, updatedCleaners);
              this.assignedCleanersCache.set(this.assignedCleanersCache());
              
              // Remove manual change detection to prevent loops
              // this.cdr.detectChanges();
            },
            error: (error) => {
              console.error('Error refreshing assigned cleaners after assignment:', error);
              // Fallback: try to update cache manually using stored data
              const newCleanerData = selectedCleanersToAssign.map(cleanerId => {
                const cleaner = this.availableCleaners().find(c => c.id === cleanerId);
                return {
                  id: cleanerId,
                  name: cleaner ? `${cleaner.firstName} ${cleaner.lastName}` : '',
                  assignmentNotificationSentAt: null as string | null
                };
              }).filter(cleaner => cleaner.name !== '');
              
              const existingCleaners = this.assignedCleanersCache().get(orderIdToRefresh) || [];
              const allCleaners = [...existingCleaners];
              newCleanerData.forEach(newCleaner => {
                if (!allCleaners.some(existing => existing.id === newCleaner.id)) {
                  allCleaners.push(newCleaner);
                }
              });
              
              this.assignedCleanersCache().set(orderIdToRefresh, allCleaners);
              this.assignedCleanersCache.set(this.assignedCleanersCache());
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
        this.errorMessage.set(error?.error?.message || 'Failed to assign cleaners. Please try again.');
      },
      complete: () => {
        this.loadingStates().assigningCleaners = false;
        this.loadingStates.set(this.loadingStates());
      }
    });
  }

  getCustomerName(orderId: number): string {
    return this.customerNames.get(orderId) || `Customer #${orderId}`;
  }

  getCustomerId(orderId: number): number | string {
    const order = this.orders().find(o => o.id === orderId);
    return order && 'userId' in order ? order.userId : 'N/A';
  }

  getCustomerEmail(orderId: number): string {
    const order = this.orders().find(o => o.id === orderId);
    return order && 'contactEmail' in order ? order.contactEmail : 'N/A';
  }

  /** Returns true if cleaners have been loaded for this order (even if none assigned) */
  isCleanersLoaded(orderId: number): boolean {
    return this.cleanersLoadedSet().has(orderId);
  }

  // OPTIMIZATION: Getter methods for template (with caching) - REMOVED CONSOLE LOGS TO PREVENT INFINITE LOGGING
  getAssignedCleaners(orderId: number): string[] {
    const cleaners = this.assignedCleanersCache().get(orderId) || [];
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
    return this.assignedCleanersCache().get(orderId) || [];
  }

  /** Cleaners on this order who have not yet received the admin-triggered assignment email. */
  getPendingAssignmentEmailCleaners(orderId: number): AssignedCleanerAdmin[] {
    return this.getAssignedCleanersWithIds(orderId).filter(
      c => c.assignmentNotificationSentAt == null || c.assignmentNotificationSentAt === ''
    );
  }

  sendCleanerAssignmentMailsForOrder(orderId: number) {
    if (this.getPendingAssignmentEmailCleaners(orderId).length === 0) {
      this.successMessage.set('All assigned cleaners already received the assignment email.');
      this.clearMessagesAfterDelay();
      return;
    }

    this.loadingStates().sendAssignmentMails = true;
    this.loadingStates.set(this.loadingStates());
    this.errorMessage.set('');

    this.adminService.sendCleanerAssignmentMails(orderId).subscribe({
      next: (result) => {
        this.successMessage.set(result.message || `Sent to ${result.emailsSent} cleaner(s).`);
        this.adminService.getAssignedCleanersWithIds(orderId).subscribe({
          next: (list) => this.assignedCleanersCache().set(orderId, list),
          error: () => { /* cache refresh optional */ }
        });
        this.assignedCleanersCache.set(this.assignedCleanersCache());
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        console.error('Error sending assignment emails:', err);
        this.errorMessage.set(err.error?.message || 'Failed to send assignment emails.');
      },
      complete: () => {
        this.loadingStates().sendAssignmentMails = false;
        this.loadingStates.set(this.loadingStates());
      }
    });
  }

  // Re-send the booking confirmation with the order's CURRENT date/time/address — the flow for
  // "please send me an updated confirmation" after an admin reschedules. Confirmed first because
  // it puts real mail in the customer's inbox; the date is spelled out so a wrong order can't be
  // notified silently.
  resendConfirmation() {
    const order = this.selectedOrder();
    if (!order || this.loadingStates().resendingConfirmation) return;

    const when = `${this.formatDate(order.serviceDate)} at ${order.serviceTime}`;
    if (!confirm(`Email and text the customer an updated confirmation for order #${order.id} — ${when}?`)) return;

    this.loadingStates().resendingConfirmation = true;
    this.loadingStates.set(this.loadingStates());
    this.errorMessage.set('');
    this.successMessage.set('');

    this.adminService.resendConfirmation(order.id).subscribe({
      next: (res) => {
        this.successMessage.set(res?.message || 'Updated confirmation sent.');
        if (this.selectedOrder()) this.refreshChangesIfLoaded(this.selectedOrder()!.id);
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to send the updated confirmation.');
      },
      complete: () => {
        this.loadingStates().resendingConfirmation = false;
        this.loadingStates.set(this.loadingStates());
      }
    });
  }

  // ── "This customer has no email" ──────────────────────────────────────────────
  // A no-email account still carries the order's FROZEN contactEmail, which can look
  // perfectly real — admins read the resulting skipped email as a bug. The three send
  // paths resolve their address differently, so the panel states each one honestly
  // rather than showing a single blanket warning:
  //   • Send Payment Link          → the ACCOUNT email only (backend refuses without one)
  //   • Updated Booking Confirmation → skips email for a no-email account, texts anyway
  //   • Payment reminder / updated payment → the order's contactEmail, falling back to
  //     the account email, so it still emails when the order carries an address.

  /** True when the selected order's owner has no email address on their account. */
  get customerHasNoAccountEmail(): boolean {
    return !!this.selectedOrder()?.customerHasNoAccountEmail;
  }

  /** The account email when it DISAGREES with the order's frozen contact email — the exact
   *  mismatch that makes a send land somewhere the admin did not expect. Null when they
   *  match, when the account has none, or when it wasn't loaded. */
  get differingAccountEmail(): string | null {
    const account = (this.selectedOrder()?.customerAccountEmail || '').trim();
    if (!account) return null;
    const contact = (this.selectedOrder()?.contactEmail || '').trim();
    return account.toLowerCase() === contact.toLowerCase() ? null : account;
  }

  /** Address the payment-reminder / updated-payment mails would actually use; '' means those
   *  can only go by text. Resolved server-side (NoEmailHelper.ResolveOrderNotificationEmail) so
   *  the panel can never name an address the sender would discard. */
  get notificationEmailTarget(): string {
    return (this.selectedOrder()?.notificationEmailTarget || '').trim();
  }

  openSendPaymentLinkModal() {
    if (!this.selectedOrder()) return;
    // Reset to both channels checked each time the modal opens — except email for an account
    // with no address, where the backend would reject the send outright.
    this.sendPaymentLinkChannels.set({ email: !this.customerHasNoAccountEmail, sms: true });
    this.showSendPaymentLinkModal.set(true);
  }

  closeSendPaymentLinkModal() {
    this.showSendPaymentLinkModal.set(false);
  }

  confirmSendPaymentLink() {
    if (!this.selectedOrder()) return;
    const { email, sms } = this.sendPaymentLinkChannels();
    if (!email && !sms) {
      this.errorMessage.set('Select at least one channel (email or phone).');
      return;
    }

    this.loadingStates().sendPaymentLink = true;
    this.loadingStates.set(this.loadingStates());
    this.errorMessage.set('');

    this.adminService.sendPaymentLink(this.selectedOrder()!.id, email, sms).subscribe({
      next: (result) => {
        this.successMessage.set(result.message || 'Payment link sent.');
        if (this.selectedOrder()) this.refreshChangesIfLoaded(this.selectedOrder()!.id);
        this.showSendPaymentLinkModal.set(false);
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        console.error('Error sending payment link:', err);
        this.errorMessage.set(err.error?.message || 'Failed to send payment link.');
      },
      complete: () => {
        this.loadingStates().sendPaymentLink = false;
        this.loadingStates.set(this.loadingStates());
      }
    });
  }

  private getCleanerResendKey(orderId: number, cleanerId: number): string {
    return `${orderId}:${cleanerId}`;
  }

  isResendingCleanerAssignmentMail(orderId: number, cleanerId: number): boolean {
    return this.resendingCleanerEmailKeys().has(this.getCleanerResendKey(orderId, cleanerId));
  }

  resendCleanerAssignmentMail(orderId: number, cleaner: AssignedCleanerAdmin) {
    const key = this.getCleanerResendKey(orderId, cleaner.id);
    if (this.resendingCleanerEmailKeys().has(key)) {
      return;
    }

    this.resendingCleanerEmailKeys().add(key);
    this.resendingCleanerEmailKeys.set(this.resendingCleanerEmailKeys());
    this.errorMessage.set('');

    this.adminService.resendCleanerAssignmentMail(orderId, cleaner.id).subscribe({
      next: (result) => {
        this.successMessage.set(result.message || `Assignment email sent to ${cleaner.name}.`);
        this.adminService.getAssignedCleanersWithIds(orderId).subscribe({
          next: (list) => this.assignedCleanersCache().set(orderId, list),
          error: () => { /* optional cache refresh */ }
        });
        this.assignedCleanersCache.set(this.assignedCleanersCache());
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        console.error('Error resending cleaner assignment email:', err);
        this.errorMessage.set(err.error?.message || 'Failed to resend assignment email.');
      },
      complete: () => {
        this.resendingCleanerEmailKeys().delete(key);
        this.resendingCleanerEmailKeys.set(this.resendingCleanerEmailKeys());
      }
    });
  }

  updateOrderStatus(
    order: AdminOrderList,
    newStatus: string,
    paymentMethod: string | null = null,
    paymentReference: string | null = null,
    paymentNotes: string | null = null,
    request: { sendReviewRequest?: boolean; reason?: string | null } = {}
  ) {
    this.adminService.updateOrderStatus(order.id, newStatus, paymentMethod, paymentReference, paymentNotes, request).subscribe({
      next: (result: OrderStatusChangeResult | null) => {
        // The server turned the move into a Done REQUEST (OrderDoneApprovalPolicy): nothing about
        // the order changed, so only the "Done requested" state is recorded here.
        if (result?.doneRequested) {
          this.markDoneRequested(order.id);
          this.successMessage.set(`Done request for order #${order.id} sent for approval.`);
          this.clearMessagesAfterDelay();
          return;
        }
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
        if (this.selectedOrder() && this.selectedOrder()!.id === order.id) {
          this.selectedOrder()!.status = newStatus;
          this.selectedOrder.set(this.selectedOrder());
          if (paymentMethod !== null && paymentMethod !== undefined) {
            this.selectedOrder()!.paymentMethod = paymentMethod;
            this.selectedOrder.set(this.selectedOrder());
            this.selectedOrder()!.paymentReference = paymentMethod !== 'Normal' ? paymentReference : null;
            this.selectedOrder.set(this.selectedOrder());
            this.selectedOrder()!.paymentNotes = paymentMethod !== 'Normal' ? paymentNotes : null;
            this.selectedOrder.set(this.selectedOrder());
          }
        }
        this.successMessage.set(`Order #${order.id} status updated to ${newStatus}`);
        this.clearMessagesAfterDelay();
      },
      error: (error) => {
        // 409: a Done request is already waiting — show that state rather than a failure.
        if (error?.status === 409 && error?.error?.doneRequested) {
          this.markDoneRequested(order.id);
          this.errorMessage.set(extractApiErrorMessage(error, 'A Done request is already waiting for approval.'));
          return;
        }
        console.error('Error updating order status:', error);
        this.errorMessage.set(extractApiErrorMessage(error, 'Failed to update order status.'));
      }
    });
  }

  /** True when this caller's Done on this order goes to a reviewer as a request. */
  doneNeedsRequest(order: { status?: string | null } | null | undefined): boolean {
    return !!order && doneMoveNeedsRequest(this.canSaveOrderEditsDirectly(), order.status);
  }

  /** Records "a Done request is waiting" on the list row and refreshes the open panel's list. */
  private markDoneRequested(orderId: number): void {
    const row = this.orders().find(o => o.id === orderId);
    if (row) {
      row.hasPendingDoneRequest = true;
      this.orders.set(this.orders());
    }
    if (this.viewingOrderId() === orderId) this.loadOrderChangeRequests(orderId);
    this.loadPendingOrderEdits();
  }

  markOrderAsDone(order: AdminOrderList) {
    this.doneModalOrder.set(order);
    // Pre-fill the payment-method block from whatever the order already carries. Default is
    // 'Normal' (Stripe flow) so existing Active orders behave as before; manual-payment orders
    // (e.g. Pending Zelle from admin booking) come up with the recorded method + reference.
    this.donePaymentMethod.set(((order.paymentMethod as PaymentMethodValue) || 'Normal'));
    this.donePaymentReference.set(order.paymentReference || '');
    this.donePaymentNotes.set(order.paymentNotes || '');
    this.doneRequestReason.set('');
    this.showDoneModal.set(true);
  }

  closeDoneModal() {
    this.showDoneModal.set(false);
    this.doneModalOrder.set(null);
  }

  confirmDone(sendReview: boolean) {
    const order = this.doneModalOrder();
    if (!order) return;

    // A Done REQUEST carries the review-link choice to the reviewer: the link is sent when the
    // request is approved, never before the order really is Done.
    if (this.doneNeedsRequest(order)) {
      this.updateOrderStatus(
        order,
        'Done',
        this.donePaymentMethod(),
        this.donePaymentMethod() !== 'Normal' ? this.donePaymentReference() : null,
        this.donePaymentMethod() !== 'Normal' ? this.donePaymentNotes() : null,
        { sendReviewRequest: sendReview, reason: this.doneRequestReason().trim() || null }
      );
      this.closeDoneModal();
      return;
    }

    // Phase 1 — pass payment method through so the backend can persist it on the Done
    // transition. Reference/Notes are sent only for manual methods (Normal ignores them).
    this.updateOrderStatus(
      order,
      'Done',
      this.donePaymentMethod(),
      this.donePaymentMethod() !== 'Normal' ? this.donePaymentReference() : null,
      this.donePaymentMethod() !== 'Normal' ? this.donePaymentNotes() : null
    );

    if (sendReview) {
      this.sendingReview = true;
      this.adminService.sendReviewRequest(order.id).subscribe({
        next: () => {
          this.sendingReview = false;
          this.successMessage.set(`Order #${order.id} marked as Done. Review request sent.`);
          this.clearMessagesAfterDelay();
        },
        error: () => {
          this.sendingReview = false;
          this.errorMessage.set('Order marked as Done but failed to send review request.');
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
    if (!this.userPermissions().permissions.canUpdate) {
      this.errorMessage.set('You do not have permission to cancel orders.');
      return;
    }
    this.adminCancelOrderId.set(order.id);
    this.adminCancelReason.set('');
    this.showAdminCancelModal.set(true);
  }

  closeAdminCancelModal() {
    this.showAdminCancelModal.set(false);
    this.adminCancelOrderId.set(null);
    this.adminCancelReason.set('');
  }

  confirmAdminCancelOrder() {
    const orderId = this.adminCancelOrderId();
    if (!orderId || !this.adminCancelReason().trim()) return;

    const order = this.orders().find(o => o.id === orderId);

    this.adminService.cancelOrder(orderId, this.adminCancelReason()).subscribe({
      next: () => {
        if (order) {
          order.status = 'Cancelled';
          this.orders.set(this.orders());
          order.cancellationReason = this.adminCancelReason();
          this.orders.set(this.orders());
        }
        if (this.selectedOrder() && this.selectedOrder()!.id === orderId) {
          this.selectedOrder()!.status = 'Cancelled';
          this.selectedOrder.set(this.selectedOrder());
          this.selectedOrder()!.cancellationReason = this.adminCancelReason();
          this.selectedOrder.set(this.selectedOrder());
        }
        this.closeAdminCancelModal();
        this.successMessage.set(`Order #${orderId} has been cancelled.`);
        this.clearMessagesAfterDelay();
      },
      error: (error) => {
        console.error('Error cancelling order:', error);
        this.errorMessage.set('Failed to cancel order.');
      }
    });
  }

  // ── Export (SuperAdmin-only), mirrors the users-tab export ──

  openExportModal(): void {
    if (!this.isSuperAdmin()) return;
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
    // Export what the admin currently sees: the filtered list (all pages, not just the current one).
    const orderIds = this.filterOrders().map(o => o.id);
    if (orderIds.length === 0) {
      this.exportError.set('No orders match the current filters.');
      return;
    }
    this.exporting.set(true);
    this.exportError.set('');
    this.adminService.exportOrders(selected, orderIds).subscribe({
      next: (res) => {
        const blob = res.body;
        if (!blob) {
          this.exportError.set('Export returned an empty file.');
          this.exporting.set(false);
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
        this.exporting.set(false);
        this.showExportModal.set(false);
        this.successMessage.set('Export downloaded.');
        setTimeout(() => { this.successMessage.set(''); }, 3000);
      },
      error: (err) => {
        this.exporting.set(false);
        this.exportError.set(err?.error?.message || err?.message || 'Failed to export orders.');
      }
    });
  }

  // Filtering methods
  /** Current page of the filtered list. PURE — no state mutations here (NG0100). */
  get filteredOrders(): AdminOrderList[] {
    const filtered = this.filterOrders();
    const start = (this.currentPage() - 1) * this.itemsPerPage;
    return filtered.slice(start, start + this.itemsPerPage);
  }

  /** Applies search/status/payment/date filters + sort. Pure function of component state. */
  private filterOrders(): AdminOrderList[] {
    // The sub-tab comes first: every filter, the search, the sort, the page and the header
    // cards below then describe Regular or Commercial work only.
    const commercial = this.ordersSubTab() === 'commercial';
    let filtered = this.orders().filter(order => !!order.isCommercial === commercial);

    // Search filter
    const search = this.searchTerm().trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(order =>
        order.id.toString().includes(search) ||
        (order.contactEmail && order.contactEmail.toLowerCase().includes(search)) ||
        matchesPhoneSearch(order.contactPhone, search)
      );
    }

    // Status filter
    if (this.statusFilter() !== 'all') {
      filtered = filtered.filter(order => order.status && order.status.toLowerCase() === this.statusFilter().toLowerCase());
    }

    // Phase 1: Payment Method filter. Treat missing paymentMethod as 'Normal' so legacy
    // rows (pre-migration cache) don't disappear when admin filters to "Normal (Card)".
    if (this.paymentMethodFilter() !== 'all') {
      filtered = filtered.filter(o => (o.paymentMethod || 'Normal') === this.paymentMethodFilter());
    }

    // Service-type filter (move in/out, arranged, deep, regular, custom, filthy, heavy).
    // Residential orders resolve to 'deep'/'regular' via the same logic as the column.
    if (this.serviceTypeFilter() !== 'all') {
      filtered = filtered.filter(o => this.getServiceTypeFilterKey(o) === this.serviceTypeFilter());
    }

    // Booked-by filter: admin-created (create-for-user) vs customer self-booked.
    if (this.bookedByFilter() !== 'all') {
      filtered = filtered.filter(o =>
        this.bookedByFilter() === 'admin' ? !!o.bookedByAdmin : !o.bookedByAdmin);
    }

    // Date filter
    if (this.dateFilter() !== 'all') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      filtered = filtered.filter(order => {
        const serviceDateOnly = this.getServiceDateOnly(order.serviceDate);
        if (!serviceDateOnly) return false;
        
        // Each window is bounded on BOTH sides — "Today"/"This Week"/"This Month"
        // must not leak future days/weeks/months into the list.
        switch (this.dateFilter()) {
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
            const from = this.parseLocalDate(this.customDateFrom());
            const to = this.parseLocalDate(this.customDateTo());
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
    if (this.sortColumn()) {
      filtered = [...filtered].sort((a, b) => {
        let cmp = 0;
        switch (this.sortColumn()) {
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
            cmp = (this.assignedCleanersCache().get(a.id)?.length ?? 0) - (this.assignedCleanersCache().get(b.id)?.length ?? 0);
            break;
          default:
            break;
        }
        return this.sortDirection() === 'asc' ? cmp : -cmp;
      });
    }

    return filtered;
  }

  setSort(column: string) {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  // Pagination methods
  previousPage() {
    if (this.currentPage() > 1) {
      this.currentPage.update(v => v - 1);
    }
  }

  nextPage() {
    if (this.currentPage() < this.totalPages) {
      this.currentPage.update(v => v + 1);
    }
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage.set(page);
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
    const selectedOrderForRow = (this.selectedOrder() && this.selectedOrder()!.id === order.id)
      ? (this.selectedOrder() as any)
      : null;
    const orderAny = order as any;
    const cleaningTypeRaw = normalize(orderAny?.cleaningType);

    const isResidential = this.isResidentialServiceType(order);
    if (isResidential) {
      const cachedVariant = this.residentialVariantCache().get(order.id);
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
    if (this.isResidentialServiceType(order)) {
      return this.getServiceTypeDisplay(order) === 'Deep' ? 'deep' : 'regular';
    }
    // By ServiceType.serviceKey; only an unkeyed type falls back to its name below. A keyed type
    // with no category here (post-construction, or a new key) is 'other', as its name was before.
    const serviceKey = (order.serviceTypeKey ?? '').trim();
    if (serviceKey) return OrdersComponent.FILTER_KEY_BY_SERVICE_KEY[serviceKey] ?? 'other';
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

  private isResidentialServiceType(order: { serviceTypeName?: string | null; serviceTypeKey?: string | null }): boolean {
    return isResidentialServiceTypeOrKey(order.serviceTypeName, order.serviceTypeKey);
  }

  /** Orders-filter category per ServiceType.serviceKey (residential is split into deep/regular above). */
  private static readonly FILTER_KEY_BY_SERVICE_KEY: Record<string, string> = {
    'move-in-out': 'move-in-out',
    'office': 'office',
    'custom': 'custom',
    'filthy': 'filthy',
    'heavy-condition': 'heavy'
  };

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

  /**
   * The address is already on screen; this just saves retyping it into a map app. Apt/suite is left
   * out because geocoders misread it and drop the pin elsewhere. Parts match
   * CleanerJobView.BuildMapsAddress / the cleaner portal, so an admin and the cleaner open the same pin.
   */
  serviceAddressMapsUrl(order: Order | null): string {
    if (!order) return '';
    const parts = [order.serviceAddress, order.city, order.state, order.zipCode]
      .map(part => (part ?? '').trim())
      .filter(part => part.length > 0);
    if (parts.length === 0) return '';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`;
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
    if (!this.selectedOrder()) return 0;
    if (this.selectedOrder()!.initialTotal > 0) {
      const t = this.selectedOrder()!.initialTotal;
      const tips = this.selectedOrder()!.initialTips ?? 0;
      const companyTips = this.selectedOrder()!.initialCompanyDevelopmentTips ?? 0;
      return Math.round((t - tips - companyTips) * 100) / 100;
    }
    if (this.orderUpdateHistory() && this.orderUpdateHistory().length > 0) {
      const u = this.orderUpdateHistory()[0];
      const t = u.originalTotal;
      const tips = u.originalTips ?? 0;
      const companyTips = u.originalCompanyDevelopmentTips ?? 0;
      return Math.round((t - tips - companyTips) * 100) / 100;
    }
    return 0;
  }

  /** Current total excluding tips (for order details pricing column). */
  getCurrentTotalWithoutTips(): number {
    if (!this.selectedOrder()) return 0;
    const t = this.selectedOrder()!.total ?? 0;
    const tips = this.selectedOrder()!.tips ?? 0;
    const companyTips = this.selectedOrder()!.companyDevelopmentTips ?? 0;
    return Math.round((t - tips - companyTips) * 100) / 100;
  }

  /**
   * "Tips for Company Development" is retired: no form, no input, no API field. Only orders
   * placed while it existed can be non-zero, and that money is part of what was charged, so
   * the panel's tip-free totals and price previews still subtract/include the STORED value.
   */
  get legacyCompanyDevelopmentTips(): number {
    return Number(this.selectedOrder()?.companyDevelopmentTips ?? 0) || 0;
  }

  /** Cleaner tips for the panel summary bar — live edit value while editing, saved value otherwise. */
  getSummaryTips(): number {
    if (this.editingOrder()) return Number(this.editOrderForm().tips ?? 0) || 0;
    return Number(this.selectedOrder()?.tips ?? 0) || 0;
  }

  /**
   * Total for the panel summary bar, always excluding tips. `editOrderForm.total` INCLUDES tips
   * (it mirrors what the backend persists), so edit mode has to subtract them here to match the
   * tip-free total shown in view mode.
   */
  getSummaryTotalWithoutTips(): number {
    if (!this.editingOrder()) return this.getCurrentTotalWithoutTips();
    const t = Number(this.editOrderForm().total ?? 0) || 0;
    const tips = Number(this.editOrderForm().tips ?? 0) || 0;
    return Math.round(Math.max(0, t - tips - this.legacyCompanyDevelopmentTips) * 100) / 100;
  }

  /**
   * Original subscription discount: derived from current discount rate applied to original subtotal.
   * (Backend does not send initialSubscriptionDiscountAmount, so we use rate: currentDiscount/currentSubTotal * originalSubTotal.)
   */
  getOriginalSubscriptionDiscountAmount(): number {
    if (!this.selectedOrder()) return 0;
    const currentDiscount = Number((this.selectedOrder() as any).subscriptionDiscountAmount ?? 0) || 0;
    const currentSub = Number(this.selectedOrder()!.subTotal ?? 0) || 0;
    let originalSub = 0;
    if (this.selectedOrder()!.initialTotal > 0) {
      originalSub = Number(this.selectedOrder()!.initialSubTotal ?? 0) || 0;
    } else if (this.orderUpdateHistory() && this.orderUpdateHistory().length > 0) {
      originalSub = Number(this.orderUpdateHistory()[0].originalSubTotal ?? 0) || 0;
    }
    if (currentSub <= 0 || originalSub <= 0) return 0;
    const rate = currentDiscount / currentSub;
    return Math.round(originalSub * rate * 100) / 100;
  }

  // The status pill (class, label, tooltip) is shared with the Users panel's History tab -
  // see shared/admin/order-status-badge.ts for the rules (RefundH, DoneM, Cancel/Refund).
  isPartiallyRefunded(order: AdminOrderList): boolean {
    return isPartiallyRefundedOrder(order);
  }

  getStatusClass(order: AdminOrderList): string {
    return orderStatusBadgeClass(order);
  }

  getStatusDisplayLabel(order: AdminOrderList): string {
    return orderStatusBadgeLabel(order);
  }

  getStatusTitle(order: AdminOrderList): string {
    return orderStatusBadgeTitle(order);
  }

  clearMessages() {
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  private clearMessagesAfterDelay() {
    setTimeout(() => {
      this.clearMessages();
    }, 5000);
  }

  hasCleanersService(): boolean {
    if (!this.selectedOrder()) return false;
    // Only true for service types with an explicit Cleaners + Hours row (e.g. Office Cleaning),
    // because for those TotalDuration is already per-cleaner. Custom Pricing now stores
    // TotalDuration as TOTAL across all maids (matching non-custom convention), so the perMaid
    // template branch handles its display correctly via TotalDuration / MaidsCount.
    if (this.selectedOrder()!.hasCleanersService) return true;
    return this.selectedOrder()!.services?.some(s => isCleanersLine(s)) ?? false;
  }

  /** Service-line checks for the template: by serviceKey, the name only for an unkeyed line. */
  isBedroomsServiceLine(line: KeyedOrderService): boolean {
    return isBedroomsLine(line);
  }

  isCleanersServiceLine(line: KeyedOrderService): boolean {
    return isCleanersLine(line);
  }

  getServiceName(order: Order | null, i: number, fallback: number): string {
    const s = (order?.services ?? [])[i];
    return s?.serviceName || '#' + fallback;
  }

  /** Service label: "Studio" when bedrooms quantity is 0, else normal name. */
  getEditServiceDisplayName(s: { quantity: number }, i: number): string {
    const def = this.getEditServiceDefinition(i);
    if (def?.serviceKey === 'bedrooms' && (Number(s.quantity) || 0) === 0) return 'Studio';
    if (!this.selectedOrder()?.services?.[i] && def) return def.name;
    return this.getServiceName(this.selectedOrder(), i, 0);
  }

  getExtraServiceName(order: Order | null, i: number, row: { orderExtraServiceId?: number | null; extraServiceId?: number }): string {
    const orderId = row.orderExtraServiceId ?? 0;
    if (orderId === 0 && row.extraServiceId != null) {
      const ex = this.editOrderAvailableExtras().find(x => x.id === row.extraServiceId);
      return ex?.name ?? 'Extra #' + row.extraServiceId;
    }
    const e = (order?.extraServices ?? []).find(x => x.id === orderId) ?? (order?.extraServices ?? [])[i];
    return e?.extraServiceName ?? '#' + orderId;
  }

  /** A catalogue service by id within a service type (for rows the order does not have yet). */
  private findCatalogueService(serviceTypeId: number | null | undefined, serviceId: number): Service | null {
    const st = this.serviceTypesCache().find(t => t.id === serviceTypeId);
    return st?.services?.find(sv => sv.id === serviceId) ?? null;
  }

  getEditOrderServiceType(): ServiceType | null {
    const stId = this.selectedOrder()?.serviceTypeId;
    if (stId == null) return null;
    return this.serviceTypesCache().find(s => s.id === stId) ?? null;
  }

  getEditServiceDefinition(index: number): Service | null {
    const st = this.getEditOrderServiceType();
    const orderService = this.selectedOrder()?.services?.[index];
    if (orderService) return st?.services?.find(s => s.id === orderService.serviceId) ?? null;
    // A row the editor ADDED (orderServiceId 0) sits after the order's own rows, so it has no
    // order line at this index; it names its catalogue service itself. See ensureEditLevelsRow.
    const added = this.editOrderForm()?.services?.[index];
    if (added && !added.orderServiceId && added.serviceId != null) {
      return st?.services?.find(s => s.id === added.serviceId) ?? null;
    }
    return null;
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
      const oes = this.selectedOrder()?.extraServices?.find(x => x.id === orderId);
      extraId = oes?.extraServiceId;
    } else {
      extraId = row.extraServiceId;
    }
    if (extraId == null) return null;
    return this.editOrderAvailableExtras().find(x => x.id === extraId) ?? null;
  }

  /**
   * Per-row duration shown in the edit form. Routed through the shared display helper so a row's
   * minutes match what the same selection contributes to the total — a linear timeDuration x
   * quantity here would disagree with the tiered figure for sqft.
   */
  getEditServiceDurationMin(s: { quantity: number }, index: number): number {
    const def = this.getEditServiceDefinition(index);
    if (!def) return 0;

    const allSelected = (this.editOrderForm().services ?? [])
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
      return Number(this.editOrderForm()?.totalDuration) || 0;
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
    const services = this.editOrderForm()?.services ?? [];
    if (!def || index >= services.length) return 0;
    if (def.serviceRelationType === 'hours' || def.serviceKey === 'hours') {
      return Number(services[index].quantity) || 0;
    }
    if (def.serviceRelationType === 'cleaner' || def.serviceKey === 'cleaners') {
      const hoursRowIndex = this.getEditHoursRowIndex();
      if (hoursRowIndex >= 0 && hoursRowIndex < services.length) {
        return Number(services[hoursRowIndex].quantity) || 0;
      }
      return Math.round((Number(this.editOrderForm()?.totalDuration) || 0) / 60 * 10) / 10;
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
    const minutes = Number(this.editOrderForm()?.totalDuration) || 0;
    return minutes > 0 ? minutes / 60 : 0;
  }

  /** Index of the 'hours' service row for the current order's service type, or -1. */
  private getEditHoursRowIndex(): number {
    const orderServices = this.selectedOrder()?.services ?? [];
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
    const orderServices = this.selectedOrder()?.services ?? [];
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
    const hours = this.clampEditHours(Number(value) || 0);
    const services = this.editOrderForm()?.services ?? [];
    const st = this.getEditOrderServiceType();
    const def = this.getEditServiceDefinition(index);
    if (!def || !st || index >= services.length) return;

    const priceMultiplier = Number((this.selectedOrder()?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
    const cleanerIdx = this.getEditCleanerRowIndex();
    const hoursIdx = this.getEditHoursRowIndex();

    this.editOrderForm().totalDuration = Math.round(hours * 60);
    this.editOrderForm.set(this.editOrderForm());
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

  /** How many people the work is split across for the SELECTED order — the staffing count,
   *  widened when more cleaners are actually assigned than it was priced for. This is the
   *  divisor Outgoing Payments and the cleaner assignment mail both use, so every per-cleaner
   *  figure in this panel has to use it too or the three surfaces disagree on an
   *  over-assigned order. Falls back to MaidsCount while the assignment list is still
   *  loading, which is what this panel always showed. */
  getSelectedOrderSplitCount(): number {
    const order = this.selectedOrder();
    if (!order) return 1;
    const assigned = this.cleanersLoadedSet().has(order.id)
      ? (this.assignedCleanersCache().get(order.id)?.length ?? 0)
      : 0;
    return resolveCleanerSplitCount(Number(order.maidsCount) || 1, assigned);
  }

  /** "12h total · 6h per cleaner" for the details panel, split the way payroll splits it. */
  getSelectedOrderDurationText(): string {
    const order = this.selectedOrder();
    if (!order) return '';

    const totalDuration = Number(order.totalDuration) || 0;
    const total = `${this.formatDuration(totalDuration)} total`;
    const splitCount = this.getSelectedOrderSplitCount();
    if (splitCount <= 1) return total;

    return `${total} · ${this.getPerCleanerDurationText(totalDuration, splitCount, false)} per cleaner`;
  }

  /** Hint text shown next to the "Duration (min)" input in the edit form.
   *  Cleaner-hours orders store TotalDuration per-cleaner, so it's shown as-is;
   *  everything else stores the TOTAL, shown as "X total" plus the per-cleaner
   *  split once the admin has set more than one maid. */
  getEditDurationHintText(): string {
    const totalDuration = Number(this.editOrderForm()?.totalDuration ?? 0) || 0;
    const hasCleaners = this.selectedOrder()?.hasCleanersService ?? false;
    if (hasCleaners) {
      return `${DurationUtils.formatDurationRounded(totalDuration)} per maid`;
    }
    // The FORM's maids count (the admin may be changing it right now), widened by the people
    // already assigned — lowering the count below the assignment list does not un-assign
    // anybody, and payroll would still split their way.
    const assigned = this.selectedOrder() && this.cleanersLoadedSet().has(this.selectedOrder()!.id)
      ? (this.assignedCleanersCache().get(this.selectedOrder()!.id)?.length ?? 0)
      : 0;
    const maidsCount = resolveCleanerSplitCount(
      Number(this.editOrderForm()?.maidsCount ?? 1) || 1, assigned);

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
      .filter(v => !this.editFloorTypes().includes(v))
      .map(v => ({ value: v, label: this.getFloorTypeLabel(v) }));
  }

  addEditFloorType(value: string): void {
    if (!value || this.editFloorTypes().includes(value)) return;
    this.editFloorTypes.set([...this.editFloorTypes(), value]);
    this.emitEditFloorTypeChange();
  }

  removeEditFloorType(value: string): void {
    this.editFloorTypes.set(this.editFloorTypes().filter(v => v !== value));
    if (value === 'other') this.editFloorTypeOther.set('');
    this.emitEditFloorTypeChange();
  }

  onEditFloorTypeOtherChange(): void {
    this.emitEditFloorTypeChange();
  }

  private emitEditFloorTypeChange(): void {
    this.onEditFloorTypeChange({ types: [...this.editFloorTypes()], otherText: this.editFloorTypeOther() });
  }

  onEditFloorTypeChange(selection: FloorTypeSelection): void {
    this.editFloorTypes.set(selection.types);
    this.editFloorTypeOther.set(selection.otherText);
    // Update the editOrderForm
    if (selection.types.length === 0) {
      this.editOrderForm().floorTypes = null;
      this.editOrderForm.set(this.editOrderForm());
      this.editOrderForm().floorTypeOther = null;
      this.editOrderForm.set(this.editOrderForm());
    } else {
      this.editOrderForm().floorTypes = selection.types.map(t => {
        if (t === 'other' && selection.otherText) return `other:${selection.otherText}`;
        return t;
      }).join(',');
      this.editOrderForm.set(this.editOrderForm());
      this.editOrderForm().floorTypeOther = selection.otherText || null;
      this.editOrderForm.set(this.editOrderForm());
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
    if (!this.selectedOrder() || !this.canEditOrder) return;
    // Load service types synchronously if cached, otherwise async — we apply the custom-mode duration
    // multiplier in a callback once the cache is populated.
    this.loadServiceTypesForEdit(() => this.applyCustomModeDurationOnOpen());
    const dateStr = this.getOrderServiceDateString(this.selectedOrder()!.serviceDate);
    let timeStr = '';
    if (this.selectedOrder()!.serviceTime) {
      const t = String(this.selectedOrder()!.serviceTime);
      if (t.includes(':')) timeStr = t.slice(0, 5);
      else timeStr = t;
    }
    this.editOrderForm.set({
      contactFirstName: this.selectedOrder()!.contactFirstName,
      contactLastName: this.selectedOrder()!.contactLastName,
      contactEmail: this.selectedOrder()!.contactEmail,
      contactPhone: normalizePhone10(this.selectedOrder()!.contactPhone) ?? this.selectedOrder()!.contactPhone,
      serviceAddress: this.selectedOrder()!.serviceAddress,
      aptSuite: this.selectedOrder()!.aptSuite ?? null,
      city: this.selectedOrder()!.city,
      state: this.selectedOrder()!.state,
      zipCode: this.selectedOrder()!.zipCode,
      serviceDate: dateStr,
      serviceTime: timeStr || null,
      maidsCount: this.selectedOrder()!.maidsCount,
      totalDuration: this.selectedOrder()!.totalDuration,
      bedroomsQuantity: this.selectedOrder()!.bedroomsQuantity ?? null,
      bathroomsQuantity: this.selectedOrder()!.bathroomsQuantity ?? null,
      // Null on a legacy order and left null unless the admin picks one, because null means
      // "no change" on the SuperAdmin update path - an admin editing the service date must not
      // silently stamp a property type onto an order that never had one.
      propertyType: normalizePropertyType((this.selectedOrder() as any).propertyType),
      levelsQuantity: (this.selectedOrder() as any).levelsQuantity ?? null,
      entryMethod: this.selectedOrder()!.entryMethod ?? null,
      specialInstructions: this.selectedOrder()!.specialInstructions ?? null,
      floorTypes: this.selectedOrder()!.floorTypes ?? null,
      floorTypeOther: this.selectedOrder()!.floorTypeOther ?? null,
      tips: this.selectedOrder()!.tips,
      status: this.selectedOrder()!.status,
      cancellationReason: this.selectedOrder()!.cancellationReason ?? null,
      subTotal: this.selectedOrder()!.subTotal,
      tax: this.selectedOrder()!.tax,
      total: this.selectedOrder()!.total,
      discountAmount: this.selectedOrder()!.discountAmount,
      subscriptionDiscountAmount: (this.selectedOrder() as any).subscriptionDiscountAmount ?? 0,
      loyaltyDiscountAmount: this.selectedOrder()!.loyaltyDiscountAmount ?? 0,
      cleanerHourlyRate: this.selectedOrder()!.cleanerHourlyRate ?? this.getDefaultHourlyRate(this.selectedOrder()!.id),
      cleanerTotalSalary: this.selectedOrder()!.cleanerTotalSalary ?? 0,
      customServiceDisplayName: (this.selectedOrder() as any).customServiceDisplayName ?? null,
      services: this.selectedOrder()!.services?.map(s => ({ orderServiceId: s.id, quantity: s.quantity, cost: s.cost })) ?? null,
      // Include extraServiceId for existing rows too (backend may require it to persist/recognize updates)
      extraServices: this.selectedOrder()!.extraServices?.map(e => ({
        orderExtraServiceId: e.id,
        extraServiceId: e.extraServiceId,
        quantity: e.quantity,
        hours: e.hours,
        cost: e.cost
      })) ?? null
    });
    this.editingOrder.set(true);
    this.setEditTimeFromForm(timeStr);
    // A typed Total belongs to one editing session; recalculateEditPricing below seeds the input.
    // The order's OWN tax carries over, though, so opening the editor cannot move the total by a
    // cent all on its own — see resolveStoredTaxOverride.
    this.editOrderTaxOverride = this.resolveStoredTaxOverride();
    this.editOrderTotalInput.set(null);
    this.editOrderPriceTyped = false;
    const parsed = this.parseFloorTypesForEdit(this.selectedOrder()!.floorTypes, this.selectedOrder()!.floorTypeOther);
    this.editFloorTypes.set(parsed.types);
    this.editFloorTypeOther.set(parsed.otherText);
    this.editOrderFormOriginalSubTotal = this.selectedOrder()!.subTotal;
    this.editOrderFormOriginalDiscount = this.selectedOrder()!.discountAmount;
    this.editOrderFormOriginalSubscriptionDiscount = (this.selectedOrder() as any).subscriptionDiscountAmount ?? 0;
    this.editOrderFormOriginalLoyaltyDiscount = this.selectedOrder()!.loyaltyDiscountAmount ?? 0;
    this.editOrderFormOriginalLoyaltyPercentage.set(this.selectedOrder()!.loyaltyDiscountPercentage ?? 0);
    this.initEditGiftCard();
    this.editOrderFormPrevServiceQuantities = (this.editOrderForm().services ?? []).map(s => s.quantity);
    this.editOrderFormSqftBaseline = null;
    this.editOrderFormPrevExtraQuantities = (this.editOrderForm().extraServices ?? []).map(e => e.quantity);
    this.editOrderFormPrevExtraHours = (this.editOrderForm().extraServices ?? []).map(e => e.hours);
    // Apply custom-mode multiplier immediately if cache is already loaded; otherwise the loadServiceTypesForEdit
    // callback will do it once the cache arrives.
    this.applyCustomModeDurationOnOpen();
    this.recalculateEditPricing();
    // Do not recalc duration/maids on open: preserve order's actual totalDuration and maidsCount
    // (e.g. custom 3h). recalcEditDurationAndMaids runs when user changes service/extra qty.
  }

  /** "HH:mm" from the order -> the three picker controls. */
  private setEditTimeFromForm(time: string | null | undefined): void {
    const parts = parseTime12h(time);
    this.editTimeHour12.set(parts ? parts.hour12 : null);
    this.editTimeMinute.set(parts ? parts.minute : 0);
    this.editTimeMeridiem.set(parts ? parts.meridiem : 'AM');
    // 5-minute steps, plus the order's own minute when it sits off that grid, so opening the
    // editor can never silently round a stored time.
    const options = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    if (!options.includes(this.editTimeMinute())) options.push(this.editTimeMinute());
    this.editTimeMinuteOptions.set(options.sort((a, b) => a - b));
  }

  /** Minute dropdown label - always two digits, so ":05" can't be read as ":50". */
  formatMinuteOption(minute: number): string {
    return String(minute).padStart(2, '0');
  }

  /** The three picker controls -> the "HH:mm" the DTO carries. */
  onEditServiceTimeChange(): void {
    if (this.editTimeHour12() == null) {
      // Order carried no time and the admin has not picked one: leave it out of the edit.
      this.editOrderForm().serviceTime = null;
      this.editOrderForm.set(this.editOrderForm());
      return;
    }
    this.editOrderForm().serviceTime = composeTime24h(
      Number(this.editTimeHour12()), Number(this.editTimeMinute()) || 0, this.editTimeMeridiem());
    this.editOrderForm.set(this.editOrderForm());
  }

  /** Read-back of the picker for labels and the change confirmation. */
  formatServiceTime12h(time: string | null | undefined): string {
    const parts = parseTime12h(time);
    if (!parts) return '';
    return `${parts.hour12}:${String(parts.minute).padStart(2, '0')} ${parts.meridiem}`;
  }

  /**
   * For Custom Pricing mode orders, the DB stores totalDuration as per-cleaner minutes (same as booking).
   * Custom Pricing now stores TotalDuration as TOTAL across all maids (matching non-custom);
   * still recompute salary on open so any stale stored cleanerTotalSalary is corrected on display.
   */
  private applyCustomModeDurationOnOpen(): void {
    if (!this.editingOrder() || !this.selectedOrder()) return;
    if (!this.isCustomModeOrder()) return;
    this.recalcCleanerTotalSalary();
  }

  private loadServiceTypesForEdit(onLoaded?: () => void): void {
    const stId = this.selectedOrder()?.serviceTypeId;
    if (stId == null) return;
    if (this.serviceTypesCache().length > 0) {
      this.setEditOrderAvailableExtras(stId);
      onLoaded?.();
      return;
    }
    this.bookingService.getServiceTypes().subscribe({
      next: (list) => {
        this.serviceTypesCache.set(list);
        this.setEditOrderAvailableExtras(stId);
        // Do not recalc duration here when edit form is open: preserve order's totalDuration/maids
        onLoaded?.();
      },
      error: () => this.editOrderAvailableExtras.set([])
    });
  }

  private setEditOrderAvailableExtras(serviceTypeId: number): void {
    const st = this.serviceTypesCache().find(s => s.id === serviceTypeId);
    this.editOrderAvailableExtras.set(st?.extraServices?.filter(x => x.isActive) ?? []);
  }

  /** Extras that can be added (not already in the form). */
  getEditOrderExtrasToAdd(): ExtraService[] {
    const existing = new Set<number>();
    for (const e of this.editOrderForm().extraServices ?? []) {
      const orderId = e.orderExtraServiceId ?? 0;
      if (orderId !== 0) {
        const oes = this.selectedOrder()?.extraServices?.find(x => x.id === orderId);
        if (oes) existing.add(oes.extraServiceId);
      } else if (e.extraServiceId != null) {
        existing.add(e.extraServiceId);
      }
    }
    return this.editOrderAvailableExtras().filter(x => !existing.has(x.id));
  }

  addEditExtraService(extra: ExtraService): void {
    const list = this.editOrderForm().extraServices ?? [];
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
    this.editOrderForm().extraServices = list;
    this.editOrderForm.set(this.editOrderForm());
    this.editOrderFormPrevExtraQuantities.push(1);
    this.editOrderFormPrevExtraHours.push(hours);
    this.recalcSubtotalFromServicesAndExtras();
  }

  onAddExtraServiceChange(value: string): void {
    const id = parseInt(value, 10);
    if (!value || isNaN(id)) return;
    const extra = this.editOrderAvailableExtras().find(x => x.id === id);
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
    const code = (this.selectedOrder() as any)?.giftCardCode ?? null;
    const used = Number((this.selectedOrder() as any)?.giftCardAmountUsed ?? 0) || 0;
    this.editGiftCardCode.set(code);
    this.editGiftCardOriginalUsed.set(used);
    this.editGiftCardAmountToUse.set(used);
    this.editGiftCardAvailableBalance.set(0);

    if (!code || used <= 0) return;

    this.bookingService.validatePromoCode(code).subscribe({
      next: (validation: any) => {
        if (validation?.isValid && validation?.isGiftCard) {
          // availableBalance from the API is the card's CURRENT remaining balance; add back what
          // this order already consumed so the edit can re-draw up to the full balance.
          this.editGiftCardAvailableBalance.set((Number(validation.availableBalance) || 0) + used);
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
    if (!this.editingOrder() || !this.selectedOrder()) return false;
    return this.editGiftCardAmountToUse() <= 0 && this.editGiftCardOriginalUsed() <= 0;
  }

  /**
   * Credits subtracted AFTER tax that the Total input therefore hides: bubble points and reward
   * balance. Both are fixed grants recorded on the order — nothing about them depends on the
   * total, which is exactly why they can be inverted and a gift card cannot.
   */
  private editCreditsHeldOffTheTotal(): number {
    if (!this.selectedOrder()) return 0;
    return (Number((this.selectedOrder() as any).pointsRedeemedDiscount ?? 0) || 0)
      + (Number((this.selectedOrder() as any).rewardBalanceUsed ?? 0) || 0);
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
    if (!this.editingOrder() || !this.canEditTotalDirectly()) return;

    const typed = Number(this.editOrderTotalInput() ?? 0) || 0;
    if (typed <= 0) {
      // Cleared or zeroed: nothing to hold on to, so hand pricing back to the subtotal.
      this.editOrderTaxOverride = null;
      this.editOrderPriceTyped = false;
      this.editOrderForm().subTotal = 0;
      this.editOrderForm.set(this.editOrderForm());
      this.recalculateEditPricing();
      return;
    }

    this.editOrderPriceTyped = true;
    const solved = solveSubTotalForTypedTotal(
      round2(typed + this.editCreditsHeldOffTheTotal()),
      this.editDiscountSnapshot(),
      {
        discountAmount: Number(this.editOrderForm().discountAmount ?? 0) || 0,
        subscriptionDiscountAmount: Number(this.editOrderForm().subscriptionDiscountAmount ?? 0) || 0,
        loyaltyDiscountAmount: Number(this.editOrderForm().loyaltyDiscountAmount ?? 0) || 0
      });

    this.editOrderTaxOverride = { tax: solved.tax, base: solved.discountedSubTotal };
    this.editOrderForm().subTotal = solved.subTotal;
    this.editOrderForm.set(this.editOrderForm());
    this.editOrderForm().discountAmount = solved.discountAmount;
    this.editOrderForm.set(this.editOrderForm());
    this.editOrderForm().subscriptionDiscountAmount = solved.subscriptionDiscountAmount;
    this.editOrderForm.set(this.editOrderForm());
    this.editOrderForm().loyaltyDiscountAmount = solved.loyaltyDiscountAmount;
    this.editOrderForm.set(this.editOrderForm());
    // Deliberately NOT rederiveDiscountsFromSubTotal: the solve above already scaled them, and
    // re-scaling from the subtotal it produced would chase its own tail.
    this.recalculateEditPricing();
  }

  /**
   * The order's OWN tax, carried into the editor so OPENING it cannot move the total.
   *
   * A Custom ("Pre-Arranged") order is priced from a TAX-INCLUSIVE amount an admin typed: the
   * subtotal and the tax are both split out of it (splitTaxInclusiveAmount) and add back to it
   * exactly. Re-deriving the tax as `round2(discountedSubTotal × rate)` instead lands a cent
   * away on roughly one amount in twenty, because no cent-valued subtotal satisfies
   * `S + round2(S × 8.875%) = 300.00`. The booking page already solves this by carrying the
   * split tax as an override; the editor did not, so it opened a $300.00 order showing $300.01
   * and every admin sent that cent through the approval queue without seeing it move.
   *
   * Rules that make this safe rather than "trust whatever is stored":
   *   - It is only honoured while the taxed amount still equals `base` (calculateTotals checks,
   *     and the server re-checks against TaxOverrideBase). Touch the subtotal or a discount and
   *     the ordinary rate math takes over again, exactly as before.
   *   - Only a difference of ONE CENT is carried. That is the entire range a tax-inclusive split
   *     can produce, so a genuinely wrong stored tax — a legacy $0, a hand-edited figure — is
   *     still corrected on open rather than perpetuated.
   *
   * Returns null when there is nothing to carry, which is every ordinary order: their stored tax
   * already IS the rate math, so nothing is sent and nothing changes for them.
   */
  private resolveStoredTaxOverride(): { tax: number; base: number } | null {
    const order = this.selectedOrder();
    if (!order) return null;

    const storedTax = round2(Number(order.tax ?? 0) || 0);
    const base = round2(
      (Number(order.subTotal ?? 0) || 0)
      - (Number(order.discountAmount ?? 0) || 0)
      - (Number((order as any).subscriptionDiscountAmount ?? 0) || 0)
      - (Number(order.loyaltyDiscountAmount ?? 0) || 0));
    if (base <= 0) return null;

    const rateTax = round2(base * SALES_TAX_RATE);
    if (rateTax === storedTax) return null;
    // Anything beyond a cent is not a tax-inclusive split — leave it to be recomputed. Compared
    // in whole CENTS, not as a float: 24.46 - 24.45 is 0.010000000000001563 in binary floating
    // point, so `> 0.01` threw away the very case this exists for.
    if (Math.abs(Math.round(rateTax * 100) - Math.round(storedTax * 100)) > 1) return null;

    return { tax: storedTax, base };
  }

  /**
   * Anything that moves the subtotal or a discount invalidates the tax figure in force — it no
   * longer describes what is owed, so pricing goes back to subtotal + rate math. Tips are
   * excluded on purpose: they sit outside the taxed amount, so they cannot invalidate it.
   */
  private clearEditTotalOverride(): void {
    this.editOrderTaxOverride = null;
  }

  /** SubTotal input: typing a subtotal is the opposite intent, so it drops a typed Total. */
  onEditSubTotalChange(): void {
    this.clearEditTotalOverride();
    this.editOrderPriceTyped = true;
    this.recalculateEditPricing(true);
  }

  /**
   * The order's discounts as opened, with the booking rule behind each (OrderDto). Everything that
   * re-derives a discount in this editor reads it, and the server re-derives from the same rules
   * (OrderPricingCalculator.ResolveEditedDiscounts), so the saved total is the one previewed.
   */
  private editDiscountSnapshot(): EditDiscountSnapshot {
    return {
      originalSubTotal: this.editOrderFormOriginalSubTotal,
      originalDiscount: this.editOrderFormOriginalDiscount,
      originalSubscriptionDiscount: this.editOrderFormOriginalSubscriptionDiscount,
      loyaltyPercentage: this.editOrderFormOriginalLoyaltyPercentage(),
      loyaltyDiscountAmount: this.editOrderFormOriginalLoyaltyDiscount,
      discountPercent: this.selectedOrder()?.discountPercent,
      discountFixedAmount: this.selectedOrder()?.discountFixedAmount,
      subscriptionDiscountPercent: this.selectedOrder()?.subscriptionDiscountPercent
    };
  }

  /** Discount inputs: they move the amount being taxed, so a typed Total no longer holds. */
  onEditDiscountChange(): void {
    this.clearEditTotalOverride();
    this.recalculateEditPricing();
  }

  recalculateEditPricing(rederiveDiscountsFromSubTotal = false): void {
    if (!this.selectedOrder() || !this.editingOrder()) return;

    let subTotal = Number(this.editOrderForm().subTotal ?? 0) || 0;
    let discountAmount = Number(this.editOrderForm().discountAmount ?? 0) || 0;
    let subscriptionDiscountAmount = Number(this.editOrderForm().subscriptionDiscountAmount ?? 0) || 0;
    let loyaltyDiscountAmount = Number(this.editOrderForm().loyaltyDiscountAmount ?? 0) || 0;

    if (this.editOrderFormOriginalSubTotal > 0 && rederiveDiscountsFromSubTotal) {
      // Derived from the ORIGINAL snapshot every time, never from the current value — that is
      // what makes a round trip land back on the exact starting numbers. Booking's rules
      // (2026-10): a percentage stays that percentage, a fixed promo stays fixed (capped), and
      // loyalty follows its locked percentage; an order with no recorded rule re-scales by ratio.
      const derived = discountsForSubTotal(this.editDiscountSnapshot(), subTotal);
      discountAmount = derived.discountAmount;
      subscriptionDiscountAmount = derived.subscriptionDiscountAmount;
      loyaltyDiscountAmount = derived.loyaltyDiscountAmount;
      this.editOrderForm().discountAmount = discountAmount;
      this.editOrderForm.set(this.editOrderForm());
      this.editOrderForm().subscriptionDiscountAmount = subscriptionDiscountAmount;
      this.editOrderForm.set(this.editOrderForm());
      this.editOrderForm().loyaltyDiscountAmount = loyaltyDiscountAmount;
      this.editOrderForm.set(this.editOrderForm());
    }

    const tips = Number(this.editOrderForm().tips ?? 0) || 0;
    // Retired field, read straight off the saved order and never editable. A legacy order that
    // carries one still had it in the total the customer paid, so the preview must keep counting
    // it or opening and saving an untouched old order would look like a price drop.
    const companyTips = this.legacyCompanyDevelopmentTips;

    const pointsRedeemedDiscount = Number((this.selectedOrder() as any).pointsRedeemedDiscount ?? 0) || 0;
    const rewardBalanceUsed = Number((this.selectedOrder() as any).rewardBalanceUsed ?? 0) || 0;

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
    const giftCardAmountToUse = this.editGiftCardAvailableBalance() > 0
      ? resolveGiftCardAmountToUse(this.editGiftCardAvailableBalance(), totals.totalBeforeGiftCard)
      : this.editGiftCardOriginalUsed();
    this.editGiftCardAmountToUse.set(giftCardAmountToUse);

    this.editOrderForm().tax = totals.tax;
    this.editOrderForm.set(this.editOrderForm());
    this.editOrderForm().total = round2(Math.max(0,
      totals.totalBeforeGiftCard - giftCardAmountToUse - pointsRedeemedDiscount - rewardBalanceUsed));
    this.editOrderForm.set(this.editOrderForm());

    // Mirror the derived figure back into the Total input, so it tracks every other edit and a
    // typed value round-trips to itself (with no credits, tip-free total === discounted + tax).
    this.editOrderTotalInput.set(this.getSummaryTotalWithoutTips());

    const base = totals.total - totals.tax - tips - companyTips;
    this.editEstimatedPoints.set(this.pointsEnabled() && this.pointsPerDollar > 0
      ? Math.floor(Math.max(0, base) * this.pointsPerDollar)
      : 0);
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
      (this.editOrderForm().services ?? []).map((row, index) => ({
        row, definition: this.getEditServiceDefinition(index)
      })),
      (this.editOrderForm().extraServices ?? []).map((row, index) => ({
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
    // The subtotal is about to be rebuilt from the lines, which is precisely what the tax figure
    // in force was overriding — EXCEPT on a custom ("Pre-Arranged") order, where this method
    // deliberately leaves the subtotal alone (extras there are informational, $0 and 0 minutes).
    // Nothing moves, so nothing invalidates the split tax; clearing it anyway made ticking an
    // extra onto a $300.00 job silently re-derive the tax and charge $300.01.
    if (!this.isCustomModeOrder()) {
      this.clearEditTotalOverride();
      // The lines price the order again, so a price typed earlier in this session no longer stands.
      this.editOrderPriceTyped = false;
    }
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
        const row = this.editOrderForm().services?.[rowIndex];
        if (row) {
          row.cost = round2(line.cost);
          // An added row has no stored minutes yet; the server takes them from here.
          if (!row.orderServiceId) row.duration = line.duration;
        }
      });
      this.editOrderForm.set(this.editOrderForm());
      built.quote.extraServiceLines.forEach((line, i) => {
        const row = this.editOrderForm().extraServices?.[built.extraRowIndices[i]];
        if (row) row.cost = round2(line.cost);
      });
      this.editOrderForm.set(this.editOrderForm());

      // The subtotal ALWAYS comes from the quote, including for cleaner+hours, so it carries the
      // MinimumPrice floor and any tiered service cost. This value is what the admin sees AND
      // what gets posted as dto.SubTotal — the SuperAdmin save path persists it verbatim.
      this.editOrderForm().subTotal = built.quote.subTotal;
      this.editOrderForm.set(this.editOrderForm());
    } else if (!this.isCustomModeOrder()) {
      // No quote available (service type missing from the cache): sum the rows as before.
      const st = this.getEditOrderServiceType();
      const priceMultiplier = Number((this.selectedOrder()?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
      let sum = (Number(st?.basePrice ?? 0) || 0) * priceMultiplier;
      (this.editOrderForm().services ?? []).forEach(s => { sum += Number(s.cost ?? 0) || 0; });
      (this.editOrderForm().extraServices ?? []).forEach(e => { sum += Number(e.cost ?? 0) || 0; });
      this.editOrderForm().subTotal = round2(sum);
      this.editOrderForm.set(this.editOrderForm());
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
    const orderServices = this.selectedOrder()?.services ?? [];
    const st = this.getEditOrderServiceType();
    for (let i = 0; i < orderServices.length; i++) {
      const def = st?.services?.find(s => s.id === orderServices[i].serviceId);
      if (def?.serviceRelationType === 'cleaner' || def?.serviceKey === 'cleaners') return i;
      if (isCleanersLine(orderServices[i])) return i;
    }
    return -1;
  }

  /** Find the index of the Hours row (relation, key, or name fallback). Returns -1 if not present. */
  private findHoursRowIndexRobust(): number {
    const orderServices = this.selectedOrder()?.services ?? [];
    const st = this.getEditOrderServiceType();
    for (let i = 0; i < orderServices.length; i++) {
      const def = st?.services?.find(s => s.id === orderServices[i].serviceId);
      if (def?.serviceRelationType === 'hours' || def?.serviceKey === 'hours') return i;
      if (isHoursLine(orderServices[i])) return i;
    }
    return -1;
  }

  /** True when the order's service type uses explicit Cleaners + Hours rows (driven by cleaner count, not duration/6). */
  private isCleanerHoursOrder(): boolean {
    if (this.selectedOrder()?.hasCleanersService) return true;
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
    return isHouse(this.editOrderForm()?.propertyType);
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
    const raw: unknown = this.editOrderForm()?.levelsQuantity;
    if (raw === null || raw === undefined || raw === '') {
      this.editOrderForm().levelsQuantity = null;
      this.editOrderForm.set(this.editOrderForm());
      return;
    }

    const parsed = Number(raw);
    if (!isFinite(parsed)) {
      this.editOrderForm().levelsQuantity = null;
      this.editOrderForm.set(this.editOrderForm());
      return;
    }

    const max = Math.max(...LEVEL_OPTIONS);
    this.editOrderForm().levelsQuantity = Math.min(Math.max(Math.round(parsed), MIN_LEVELS), max);
    this.editOrderForm.set(this.editOrderForm());

    // On a service type that prices levels, a count is never informational: it becomes the
    // priced Levels row (seeded from this value) and reprices, exactly like switching to House.
    if (this.editLevelsArePriced()) {
      this.ensureEditLevelsRow();
      this.recalcSubtotalFromServicesAndExtras();
    }
  }

  /** True when this order's service type charges for levels (has a priced Levels service). */
  editLevelsArePriced(): boolean {
    return !this.isCustomModeOrder() && findLevelsService(this.getEditOrderServiceType()) != null;
  }

  showEditInformationalLevels(): boolean {
    if (!isHouse(this.editOrderForm()?.propertyType)) return false;
    return !(this.editOrderForm()?.services ?? []).some(
      (_row: any, index: number) => isLevelsService(this.getEditServiceDefinition(index) ?? undefined));
  }

  onEditPropertyTypeChange(): void {
    if (isHouse(this.editOrderForm()?.propertyType)) {
      // Same two rules the booking page and the customer order edit apply on picking House:
      // the type's priced Levels line joins the quote, and a studio becomes 1 bedroom.
      this.ensureEditLevelsRow();
      this.raiseEditBedroomsToHouseMinimum();
      this.recalcSubtotalFromServicesAndExtras();
      this.recalculateEditPricing();
      return;
    }

    // Apartment (or cleared): the stair charge must go with it. A Levels row this editor added
    // is simply taken away again - nothing was saved, so there is nothing to keep. A row the
    // order already had is forced to the included level, which prices it at exactly $0, rather
    // than deleting a row the backend still expects.
    this.removeAddedEditLevelsRow();
    (this.editOrderForm().services ?? []).forEach((row: any, index: number) => {
      if (isLevelsService(this.getEditServiceDefinition(index) ?? undefined)) row.quantity = 1;
    });

    this.recalcSubtotalFromServicesAndExtras();
    this.recalculateEditPricing();
  }

  /**
   * Gives a house the priced Levels row its service type charges for (2026-10).
   *
   * Booking only creates a levels line when a house's level chip is clicked, so an order booked
   * as an apartment has none. Switching it to House here used to leave only the unpriced
   * "Levels (informational)" box, and the level count never reached the price - unlike booking,
   * where 3 levels on Residential or Move In/Out costs two levels' worth more. The row is
   * appended AFTER the order's own rows, so every index-aligned lookup on those rows is
   * unchanged, and it is priced by the shared calculator like any other row. The server adds it
   * on save (OrderService.AddAdminLevelsLineAsync).
   *
   * No-op for a service type with no priced levels service (Office, Pre-Arranged...), where the
   * informational box remains the right control, and when the order already has the row.
   * Seeded at the informational count the order may already carry, else the included level.
   */
  private ensureEditLevelsRow(): void {
    if (this.isCustomModeOrder()) return;
    const levelsService = findLevelsService(this.getEditOrderServiceType());
    if (!levelsService) return;
    const rows = this.editOrderForm().services ?? (this.editOrderForm().services = []);
    this.editOrderForm.set(this.editOrderForm());
    if (rows.some((_row, index) => isLevelsService(this.getEditServiceDefinition(index) ?? undefined))) return;

    const seeded = Number(this.editOrderForm().levelsQuantity) || MIN_LEVELS;
    const quantity = this.clampEditLevels(seeded, levelsService);
    rows.push({ orderServiceId: 0, serviceId: levelsService.id, quantity, cost: 0 });
    this.editOrderFormPrevServiceQuantities.push(quantity);
  }

  /** Undoes ensureEditLevelsRow: only an unsaved row is ever removed. */
  private removeAddedEditLevelsRow(): void {
    const rows = this.editOrderForm().services ?? [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if (!rows[i].orderServiceId && isLevelsService(this.getEditServiceDefinition(i) ?? undefined)) {
        rows.splice(i, 1);
        this.editOrderFormPrevServiceQuantities.splice(i, 1);
      }
    }
  }

  /**
   * A house has at least one bedroom: the booking page and the customer order edit both turn a
   * studio (bedrooms = 0) into 1 bedroom on picking House, and the server applies the same floor
   * on those paths (OrderPricingInputBuilder). Routed through the ordinary quantity handler so
   * the Sq.ft linkage follows exactly as if the admin had pressed +.
   */
  private raiseEditBedroomsToHouseMinimum(): void {
    const index = this.findEditServiceIndexByKey('bedrooms');
    if (index < 0) return;
    const row = this.editOrderForm().services![index];
    if ((Number(row.quantity) || 0) >= 1) return;
    row.quantity = 1;
    this.editOrderForm.set(this.editOrderForm());
    this.onEditServiceQuantityChange(row, index);
  }

  /**
   * The range the booking page's stepper allows for a service (2026-10): from its minValue (a
   * house has at least one bedroom) to its maxValue, with booking's defaults when unset - 10, or
   * 5000 for sq.ft. Mirrors BookingComponent.getServiceMinValue / incrementServiceQuantity. The
   * Sq.ft floor for the bedroom count is applied on top by onEditServiceQuantityChange.
   */
  private clampEditServiceQuantity(value: number, def: Service): number {
    let min = def.minValue || 0;
    if (def.serviceKey === 'bedrooms' && isHouse(this.editOrderForm()?.propertyType)) min = Math.max(min, 1);
    const max = def.maxValue || (def.serviceKey === 'sqft' ? 5000 : 10);
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Booking's hours range (2026-10): the hours service's minValue (at least 2.5h with Extra
   * Cleaners, like booking) to its maxValue (booking's default 10). A service type with no hours
   * service keeps the editor's old 0.5-24 range. Half-hour steps are the editor's own and stay.
   */
  private clampEditHours(value: number): number {
    const hoursDef = this.getEditOrderServiceType()?.services?.find(
      s => s.serviceRelationType === 'hours' || s.serviceKey === 'hours');
    if (!hoursDef) return Math.max(0.5, Math.min(24, value));
    let min = hoursDef.minValue || 0.5;
    if (this.editHasExtraCleaners()) min = Math.max(min, 2.5);
    const max = hoursDef.maxValue || 10;
    return Math.max(min, Math.min(max, value));
  }

  private editHasExtraCleaners(): boolean {
    return (this.editOrderForm()?.extraServices ?? []).some((e, index) => {
      const def = this.getEditExtraDefinition(e, index);
      return !!def && isExtraCleaners(def);
    });
  }

  /** The level range the booking page offers: the service's configured min/max, else 1-4. */
  private clampEditLevels(value: number, definition: Service | null | undefined): number {
    const min = definition?.minValue ?? MIN_LEVELS;
    const max = definition?.maxValue ?? Math.max(...LEVEL_OPTIONS);
    return Math.min(Math.max(Math.round(Number(value) || 0), min), max);
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
    const stId = this.selectedOrder()?.serviceTypeId;
    if (stId == null) return false;
    const st = this.serviceTypesCache().find(s => s.id === stId);
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
    const services = this.editOrderForm().services ?? [];

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
        this.editOrderForm().maidsCount = cleanersQty;
        this.editOrderForm.set(this.editOrderForm());
      }
      if (hoursQty > 0) {
        this.editOrderForm().totalDuration = Math.max(Math.round(hoursQty * 60), 60);
        this.editOrderForm.set(this.editOrderForm());
      } else if (!this.editOrderForm().totalDuration) {
        this.editOrderForm().totalDuration = Math.max(Number(this.selectedOrder()?.totalDuration) || 60, 60);
        this.editOrderForm.set(this.editOrderForm());
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
      (this.editOrderForm().extraServices ?? []).forEach((e, i) => {
        totalMin += this.getEditExtraDurationMin(e, i);
      });
    }
    const currentFormDuration = Number(this.editOrderForm().totalDuration) || 0;
    // When services contribute nothing (e.g. custom Cleaners with timeDuration 0), don't overwrite order's duration
    if (totalMin <= baseOnly && currentFormDuration > baseOnly) {
      totalMin = currentFormDuration;
    }
    totalMin = Math.max(Math.round(totalMin), 60);
    this.editOrderForm().totalDuration = totalMin;
    this.editOrderForm.set(this.editOrderForm());
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
      const services = this.editOrderForm().services ?? [];
      const cleanerIdx = this.findCleanerRowIndexRobust();
      const cleanersQty = (cleanerIdx >= 0 && cleanerIdx < services.length)
        ? (Number(services[cleanerIdx].quantity) || 0) : 0;
      if (cleanersQty > 0) {
        this.editOrderForm().maidsCount = cleanersQty;
        this.editOrderForm.set(this.editOrderForm());
      }
    }
  }

  /** Advisory 1-per-6h staffing suggestion for admins (regular service types only).
   *  Null when it matches the current count, so the hint only shows when actionable. */
  getSuggestedMaidsCount(): number | null {
    if (this.isCustomModeOrder() || this.isCleanerHoursOrder()) return null;
    const totalMin = Number(this.editOrderForm().totalDuration) || 0;
    if (totalMin <= 0) return null;
    const totalHours = totalMin / 60;
    const suggested = totalHours > 6 ? Math.ceil(totalHours / 6) : 1;
    const current = Number(this.editOrderForm().maidsCount) || 1;
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
    const order = this.selectedOrder();
    if (!order || this.hasCleanersService() || this.isCustomServiceType(order)) return false;
    return OrdersComponent.staffingReviewNeeded(order.totalDuration, order.maidsCount || 1);
  }

  /** Edit-form variant, from the live form values (tints the suggested-maids hint). */
  editFormNeedsStaffingReview(): boolean {
    if (this.isCustomModeOrder() || this.isCleanerHoursOrder()) return false;
    return OrdersComponent.staffingReviewNeeded(
      Number(this.editOrderForm()?.totalDuration) || 0,
      Number(this.editOrderForm()?.maidsCount) || 1);
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
    // Levels stay inside the range booking offers (1-4 as seeded): 0 levels or 9 levels is not a
    // house anybody can book, and the stepper used to accept both.
    const isHoursRow = def?.serviceRelationType === 'hours' || def?.serviceKey === 'hours';
    if (isLevelsService(def ?? undefined)) {
      q = this.clampEditLevels(q, def);
      s.quantity = q;
    } else if (def && !isHoursRow) {
      // Every other service stays inside the range the booking page's stepper allows (2026-10).
      q = this.clampEditServiceQuantity(q, def);
      s.quantity = q;
    }
    if (isHoursRow) {
      this.onEditServiceHoursChange(index, q);
      return;
    }
    // Editing sqft directly: enforce the minimum for the current bedroom count
    // (same behavior as the booking page and user order edit).
    if (def?.serviceKey === 'sqft') {
      const bedroomsIdx = this.findEditServiceIndexByKey('bedrooms');
      if (bedroomsIdx >= 0) {
        const bedroomsQty = Number(this.editOrderForm().services?.[bedroomsIdx]?.quantity) || 0;
        const minSquareFeet = this.getEditSquareFeetForBedrooms(bedroomsQty);
        if (q < minSquareFeet) {
          q = minSquareFeet;
          s.quantity = minSquareFeet;
        }
      }
      // A direct edit is a fresh deliberate choice — it supersedes whatever pre-raise value
      // the bedrooms linkage was remembering, or a later bedroom decrease would overwrite
      // this keystroke with stale history.
      this.editOrderFormSqftBaseline = null;
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
      const priceMultiplier = Number((this.selectedOrder()?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
      const rate = (def.cost ?? 0) * priceMultiplier;
      s.cost = round2(rate * q * hours);
      this.editOrderFormPrevServiceQuantities[index] = q;
      this.recalcSubtotalFromServicesAndExtras();
      return;
    }
    let unitPrice = def?.cost ?? 0;
    if (prevQ > 0 && prevCost > 0) unitPrice = prevCost / prevQ;
    else if (unitPrice === 0 && this.selectedOrder()?.services?.[index]) {
      const os = this.selectedOrder()!.services[index];
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
    const rows = this.editOrderForm().services ?? [];
    for (let i = 0; i < rows.length; i++) {
      if (this.getEditServiceDefinition(i)?.serviceKey === serviceKey) return i;
    }
    return -1;
  }

  /** Re-derive the Sq.ft row after a bedroom change and reprice it. */
  private syncEditSqftWithBedrooms(bedroomsQty: number, prevBedroomsQty: number): void {
    const sqftIdx = this.findEditServiceIndexByKey('sqft');
    if (sqftIdx < 0) return;
    const row = this.editOrderForm().services?.[sqftIdx];
    if (!row) return;

    // Quantity follows the shared bedrooms→sqft rule against the CONFIGURED allowances (same
    // resolution the booking page and customer order edit use): a Sq.ft still sitting on the
    // outgoing bedroom's allowance tracks the new one, while a value the admin or customer
    // raised above it survives. Resetting it unconditionally used to discard that value.
    // The cost is deliberately NOT computed here: recalcSubtotalFromServicesAndExtras reprices
    // every line through the shared calculator, so the tiered rate applies. The previous
    // unitPrice x quantity here was linear and ignored both the allowance and the tiers.
    const current = Number(row.quantity) || 0;
    const oldMinSquareFeet = this.getEditSquareFeetForBedrooms(prevBedroomsQty);
    const newMinSquareFeet = this.getEditSquareFeetForBedrooms(bedroomsQty);
    const baseline = this.editOrderFormSqftBaseline;

    if (baseline && bedroomsQty === baseline.bedrooms) {
      // Landing back on the exact bedroom count the raise chain started from: restore the
      // value it overwrote rather than the floor resolveSquareFeetForBedroomChange would give
      // (which reads a floor-raised current as "was tracking the floor" and drops it further).
      row.quantity = Math.max(baseline.sqft, newMinSquareFeet);
      this.editOrderForm.set(this.editOrderForm());
    } else {
      const resolved = resolveSquareFeetForBedroomChange(current, oldMinSquareFeet, newMinSquareFeet);
      // A deliberate value (current not sitting on the outgoing floor) is about to be clobbered
      // by a higher new floor — remember it before it's overwritten below.
      if (resolved > current && current !== oldMinSquareFeet) {
        this.editOrderFormSqftBaseline = { bedrooms: prevBedroomsQty, sqft: current };
      }
      row.quantity = resolved;
      this.editOrderForm.set(this.editOrderForm());
    }
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
      const priceMultiplier = Number((this.selectedOrder()?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
      const m = def.isSameDayService ? 1 : priceMultiplier;
      e.cost = round2(def.price * q * m);
    } else {
      const prevQ = this.editOrderFormPrevExtraQuantities[index] ?? 1;
      const prevCost = Number(e.cost) || 0;
      const orderId = e.orderExtraServiceId ?? 0;
      let unitPrice = (prevQ > 0 && prevCost > 0) ? (prevCost / prevQ) : (def?.price ?? 0);
      if (unitPrice === 0 && orderId !== 0 && this.selectedOrder()?.extraServices) {
        const oes = this.selectedOrder()!.extraServices.find(x => x.id === orderId);
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
      const priceMultiplier = Number((this.selectedOrder()?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
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
    const next = this.clampEditHours((this.getEditServiceHours(index) || 0) + delta);
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
    const extras = this.editOrderForm().extraServices ?? [];
    if (index < 0 || index >= extras.length) return;
    extras.splice(index, 1);
    this.editOrderFormPrevExtraQuantities.splice(index, 1);
    this.editOrderFormPrevExtraHours.splice(index, 1);
    this.recalcSubtotalFromServicesAndExtras();
  }

  cancelEditOrder(): void {
    this.editingOrder.set(false);
    // Drop any unconfirmed save with the form it was built from, so reopening the editor can
    // never surface a diff against values that are no longer on screen.
    this.resetSaveConfirmState();
  }


  /** Optional free-text reason an Admin gives when submitting an edit for approval. */
  readonly orderEditRequestReason = signal('');

  loadPendingOrderEdits(): void {
    // Whoever may apply an order edit themselves may also approve one from a colleague; the
    // endpoint enforces the same rule, so an ungranted admin would just get a 403.
    if (!this.canSaveOrderEditsDirectly()) return;
    this.loadingPendingEdits = true;
    this.adminService.getPendingOrderEdits().subscribe({
      next: (list) => {
        this.pendingOrderEdits.set(list);
        this.cdr.detectChanges();
      },
      error: () => { this.pendingOrderEdits.set([]); },
      complete: () => { this.loadingPendingEdits = false; }
    });
  }

  openPendingEditDetail(id: number): void {
    this.loadingPendingEditDetail.set(true);
    this.selectedPendingEdit.set(null);
    this.adminService.getPendingOrderEditDetail(id).subscribe({
      next: (detail) => {
        this.selectedPendingEdit.set(detail);
        this.loadExtraServiceNamesForPendingEdit();
        this.cdr.detectChanges();
      },
      error: () => { this.selectedPendingEdit.set(null); },
      complete: () => { this.loadingPendingEditDetail.set(false); }
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
        this.extraServiceNamesMap.set(nameMap);
        this.extraServiceHasHoursMap.set(hasHoursMap);
        this.cdr.detectChanges();
        done?.();
      },
      error: () => {
        this.extraServiceNamesMap.set(new Map());
        this.extraServiceHasHoursMap.set(new Map());
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
    if (this.extraServiceNamesMap().size > 0) return;
    const nameMap = new Map<number, string>();
    const hasHoursMap = new Map<number, boolean>();
    for (const st of this.serviceTypesCache()) {
      for (const es of st.extraServices ?? []) {
        if (!nameMap.has(es.id)) nameMap.set(es.id, es.name);
        if (!hasHoursMap.has(es.id)) hasHoursMap.set(es.id, !!es.hasHours);
      }
    }
    if (nameMap.size === 0) return;
    this.extraServiceNamesMap.set(nameMap);
    this.extraServiceHasHoursMap.set(hasHoursMap);
  }

  closePendingEditDetail(): void {
    this.selectedPendingEdit.set(null);
    this.loadPendingOrderEdits();
  }

  approvePendingOrderEdit(id: number): void {
    if (this.approvingPendingId() != null) return;
    this.approvingPendingId.set(id);
    // Read BEFORE closing the modal: closing clears selectedPendingEdit, and checking it after
    // (as this used to) meant the open panel was never refreshed after an approval.
    const decided = this.selectedPendingEdit();
    this.adminService.approvePendingOrderEdit(id).subscribe({
      next: (res) => {
        this.successMessage.set(res?.message || 'Order edit approved and applied.');
        this.closePendingEditDetail();
        if (decided) this.afterChangeRequestDecided(decided.orderId);
        this.calculateStatistics();
        setTimeout(() => { this.successMessage.set(''); }, 5000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to approve.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.approvingPendingId.set(null); }
    });
  }

  rejectPendingOrderEdit(id: number, reason?: string): void {
    if (this.rejectingPendingId() != null) return;
    this.rejectingPendingId.set(id);
    const decided = this.selectedPendingEdit();
    this.adminService.rejectPendingOrderEdit(id, reason).subscribe({
      next: () => {
        this.successMessage.set(this.pendingEditIsDoneRequest() ? 'Done request rejected.' : 'Order edit rejected.');
        this.closePendingEditDetail();
        if (decided) this.afterChangeRequestDecided(decided.orderId);
        setTimeout(() => { this.successMessage.set(''); }, 5000);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to reject.');
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.rejectingPendingId.set(null); }
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

  /**
   * The change table a reviewer reads.
   *
   * Prefers the SUBMIT-TIME payload stored with the request — that is what the requesting admin
   * actually saw and confirmed. Falls back to diffing the proposal against the live order for
   * requests that predate the payload (order #296 among them), which is the old behaviour and is
   * why those rows still render at all instead of blanking the panel.
   *
   * Each row carries the live value alongside the stored one, so DRIFT is visible: if somebody
   * else edited the order after the request was submitted, approving it applies a change measured
   * against a state that no longer exists.
   */
  getPendingEditChanges(): OrderEditChange[] {
    const d = this.selectedPendingEdit();
    if (!d) return [];

    // A Done request is a status move, not a field edit: its rows are stored by the server, and
    // the only thing that can drift underneath it is the order's status.
    if (d.kind === 'Done') {
      const liveStatus = d.currentOrder?.status ?? '';
      return (d.requestedChanges ?? []).map(s => {
        const isStatus = s.field === 'Status';
        return {
          field: s.field,
          current: s.current || '—',
          proposed: s.proposed,
          difference: s.difference || '—',
          emphasised: s.emphasised,
          liveCurrent: isStatus ? liveStatus : undefined,
          hasDrifted: isStatus && !!liveStatus && liveStatus.toLowerCase() !== (s.current || '').toLowerCase(),
        } as OrderEditChange;
      });
    }

    const live = this.computeLivePendingEditChanges();

    const stored = d.requestedChanges;
    if (!stored || stored.length === 0) return live;

    // Match by field LABEL: both sides are produced by computeOrderEditChanges, so the labels are
    // generated by one implementation and cannot drift apart on formatting alone.
    const liveByField = new Map(live.map(c => [c.field, c]));

    return stored.map(s => {
      const liveRow = liveByField.get(s.field);
      // No live row for this field means the order already matches what was requested — somebody
      // has applied it by hand. That is drift too, and the most important kind.
      const liveCurrent = liveRow ? liveRow.current : s.proposed;
      return {
        field: s.field,
        current: s.current,
        proposed: s.proposed,
        difference: s.difference,
        emphasised: s.emphasised,
        liveCurrent,
        hasDrifted: liveCurrent !== s.current,
      } as OrderEditChange;
    });
  }

  /** The proposal diffed against the order AS IT STANDS NOW. */
  private computeLivePendingEditChanges(): OrderEditChange[] {
    const d = this.selectedPendingEdit();
    if (!d?.currentOrder || !d?.proposedChanges) return [];
    return this.computeOrderEditChanges(d.currentOrder, d.proposedChanges);
  }

  /** True when the order moved under the request. Drives the warning banner in the modal. */
  pendingEditHasDrift(): boolean {
    // Only meaningful while the request is still open: once approved the order SHOULD have moved
    // (this request moved it), and once rejected nobody is going to act on it.
    if (!this.selectedPendingEdit() || this.selectedPendingEdit()!.status !== 'Pending') return false;
    return this.getPendingEditChanges().some(c => c.hasDrifted);
  }

  /** Rows whose live value no longer matches what the requester saw. */
  pendingEditDriftedFields(): OrderEditChange[] {
    return this.getPendingEditChanges().filter(c => c.hasDrifted);
  }

  /** True when this request predates the field-level payload, so there is nothing stored to read. */
  pendingEditPayloadUnavailable(): boolean {
    return !!this.selectedPendingEdit()?.requestedChangesUnavailable;
  }

  /** A decided request is read-only: the buttons would apply a change that was already settled. */
  pendingEditIsDecided(): boolean {
    const s = this.selectedPendingEdit()?.status;
    return !!s && s !== 'Pending';
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
      // Compared in 24-hour form (one canonical string), shown in 12-hour form - the reviewer
      // reads the same clock the picker and every other admin surface use.
      if (cv !== pv) {
        changes.push({
          field,
          current: this.formatServiceTime12h(cv) || '—',
          proposed: this.formatServiceTime12h(pv) || '—',
          difference: '—'
        });
      }
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
    push('Cleaners Count', cur.maidsCount, prop.maidsCount);
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
    } else {
      // A Levels row added by this edit (apartment order turned house): the order had no line,
      // so "before" is whatever informational count it carried, if any.
      const addedLevelsRow = (prop.services ?? []).find((s: any) => !s.orderServiceId && s.serviceId != null
        && this.findCatalogueService(cur.serviceTypeId, s.serviceId)?.serviceKey === 'levels');
      if (addedLevelsRow) push('Levels', levelsToDisplay(cur.propertyType, cur.levelsQuantity), addedLevelsRow.quantity);
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
      } else if (!osId && ps.serviceId != null) {
        // A row this edit adds (the priced Levels line) - same "(new)" shape as an added extra.
        const addedName = this.findCatalogueService(cur.serviceTypeId, ps.serviceId)?.name ?? `Service #${ps.serviceId}`;
        const pq = Number(ps.quantity);
        const pc = Number(ps.cost);
        changes.push({ field: `${addedName} (new) (qty/cost)`, current: '—', proposed: `(${pq}/${pc})`, difference: fmtDiff(0, pc) });
      }
    }
    // Extra services: label with (qty/cost) or (hours/cost) depending on extra type; show removed
    const curExtras = cur.extraServices ?? [];
    const propExtras = prop.extraServices ?? [];
    const propExtraIds = new Set((propExtras as any[]).map((e: any) => e.orderExtraServiceId ?? (e as any).orderExtraServiceId ?? 0));
    const extraUnit = (extraId: number) => this.extraServiceHasHoursMap().get(Number(extraId)) ? '(hours/cost)' : '(qty/cost)';
    for (const pe of propExtras) {
      const oeId = pe.orderExtraServiceId ?? (pe as any).orderExtraServiceId ?? 0;
      const ce = curExtras.find((e: any) => e.id === oeId);
      const extraId = (ce?.extraServiceId ?? pe.extraServiceId ?? (pe as any).extraServiceId) ?? 0;
      const label = ce ? (ce.extraServiceName ?? `Extra #${ce.extraServiceId ?? oeId}`) : '';
      const unit = extraUnit(extraId);
      if (ce) {
        const useHours = this.extraServiceHasHoursMap().get(Number(ce.extraServiceId ?? extraId));
        const cVal = useHours ? Number(ce.hours) : Number(ce.quantity);
        const pVal = useHours ? Number(pe.hours) : Number(pe.quantity);
        const cc = Number(ce.cost);
        const pc = Number(pe.cost);
        if (cVal !== pVal || cc !== pc) {
          changes.push({ field: `${label} ${unit}`, current: `(${cVal}/${cc})`, proposed: `(${pVal}/${pc})`, difference: fmtDiff(cc, pc) });
        }
      } else if (oeId === 0 && (pe.extraServiceId ?? (pe as any).extraServiceId)) {
        const eid = pe.extraServiceId ?? (pe as any).extraServiceId;
        const extraName = this.extraServiceNamesMap().get(Number(eid)) ?? `Extra #${eid}`;
        const useHours = this.extraServiceHasHoursMap().get(Number(eid));
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
      const useHours = this.extraServiceHasHoursMap().get(Number(eid));
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
    this.editOrderForm().contactPhone = cleaned;
    this.editOrderForm.set(this.editOrderForm());
  }

  /**
   * Assemble the update DTO from the open edit form. Pure: it neither sends anything nor touches
   * component state, so the save-confirmation modal can diff the exact payload that will be sent.
   */
  private buildOrderEditDto(): SuperAdminUpdateOrderDto {
    // Custom pricing: totalDuration is per-cleaner minutes (matches booking payload).
    const persistedTotalDuration = this.editOrderForm().totalDuration ?? undefined;
    const dto: SuperAdminUpdateOrderDto = {
      contactFirstName: this.editOrderForm().contactFirstName ?? undefined,
      contactLastName: this.editOrderForm().contactLastName ?? undefined,
      contactEmail: this.editOrderForm().contactEmail ?? undefined,
      contactPhone: normalizePhone10(this.editOrderForm().contactPhone) ?? undefined,
      serviceAddress: this.editOrderForm().serviceAddress ?? undefined,
      aptSuite: this.editOrderForm().aptSuite ?? undefined,
      city: this.editOrderForm().city ?? undefined,
      state: this.editOrderForm().state ?? undefined,
      zipCode: this.editOrderForm().zipCode ?? undefined,
      serviceDate: this.editOrderForm().serviceDate ?? undefined,
      serviceTime: this.editOrderForm().serviceTime ?? undefined,
      // Set on the Wages card now, so the form only sends a count its own Cleaners service line
      // (cleaner+hours types) moved — never the value it was opened with, which could overwrite
      // a count changed on the Wages card in the meantime.
      maidsCount: this.editOrderForm().maidsCount != null && this.editOrderForm().maidsCount !== this.selectedOrder()?.maidsCount
        ? this.editOrderForm().maidsCount
        : undefined,
      totalDuration: persistedTotalDuration ?? undefined,
      bedroomsQuantity: this.editOrderForm().bedroomsQuantity ?? undefined,
      bathroomsQuantity: this.editOrderForm().bathroomsQuantity ?? undefined,
      // undefined = no change, which is what a legacy order the admin did not touch must send.
      propertyType: this.editOrderForm().propertyType ?? undefined,
      // Informational only; a priced levels row in `services` wins server-side.
      levelsQuantity: this.editOrderForm().levelsQuantity ?? undefined,
      entryMethod: this.editOrderForm().entryMethod ?? undefined,
      specialInstructions: this.editOrderForm().specialInstructions ?? undefined,
      floorTypes: this.editOrderForm().floorTypes ?? undefined,
      floorTypeOther: this.editOrderForm().floorTypeOther ?? undefined,
      tips: this.editOrderForm().tips ?? undefined,
      status: this.editOrderForm().status ?? undefined,
      cancellationReason: this.editOrderForm().cancellationReason ?? undefined,
      subTotal: this.editOrderForm().subTotal ?? undefined,
      tax: this.editOrderForm().tax ?? undefined,
      total: this.editOrderForm().total ?? undefined,
      // Only present when the admin typed a Total. The server re-checks the base against the
      // subtotal this order's discounts leave behind before honouring the tax.
      taxOverride: this.editOrderTaxOverride?.tax ?? undefined,
      taxOverrideBase: this.editOrderTaxOverride?.base ?? undefined,
      // Only when the admin typed the price; otherwise the server prices the lines itself.
      priceTypedByAdmin: this.editOrderPriceTyped ? true : undefined,
      discountAmount: this.editOrderForm().discountAmount ?? undefined,
      subscriptionDiscountAmount: this.editOrderForm().subscriptionDiscountAmount ?? undefined,
      // Loyalty Discount: persist the rescaled $ amount. Backend leaves the original
      // LoyaltyDiscountPercentage untouched per SuperAdminFullUpdateOrder comment.
      loyaltyDiscountAmount: this.editOrderForm().loyaltyDiscountAmount ?? undefined,
      // Not part of an order edit any more: the rate is set on the Wages card
      // (updateOrderCleanerHourlyRate), and resending the value seeded when the form opened could
      // overwrite a rate changed there in the meantime.
      cleanerHourlyRate: undefined,
      // Omitted entirely once cleaners are assigned: the per-cleaner rows own the figure and the
      // server refuses a submitted one (OrderService.SuperAdminFullUpdateOrder). Sending it
      // anyway put a "Cleaners Total Salary" row in the save-confirmation modal describing a
      // change that was never going to happen - undefined means "not part of this edit", which is
      // exactly right here and is what computeOrderEditChanges already skips on.
      cleanerTotalSalary: this.canEditCleanerTotalSalary()
        ? (this.editOrderForm().cleanerTotalSalary ?? undefined)
        : undefined,
      // Only meaningful for custom orders; backend ignores it for other service types.
      // Send '' (not undefined) when cleared so the backend can reset it to "Arranged".
      customServiceDisplayName: this.selectedOrderIsCustomServiceType
        ? (this.editOrderForm().customServiceDisplayName ?? '')
        : undefined,
      // Existing rows as they are; an added row also names its service and carries its minutes.
      services: (this.editOrderForm().services ?? undefined)?.map(row => row.orderServiceId
        ? { orderServiceId: row.orderServiceId, quantity: row.quantity, cost: row.cost }
        : { orderServiceId: 0, serviceId: row.serviceId, quantity: row.quantity, cost: row.cost, duration: row.duration ?? 0 }),
      // Send extra services: existing rows with orderExtraServiceId; new rows with orderExtraServiceId: 0 and extraServiceId (backend may expect 0 for "create")
      extraServices: (this.editOrderForm().extraServices ?? undefined)?.map(e => {
        const orderExtraServiceId = Number((e as any).orderExtraServiceId ?? 0) || 0;
        const maybeExtraServiceId = Number((e as any).extraServiceId ?? 0) || 0;
        const existingExtraServiceId = orderExtraServiceId > 0
          ? (this.selectedOrder()?.extraServices?.find(x => x.id === orderExtraServiceId)?.extraServiceId ?? 0)
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
    if (!this.selectedOrder() || !this.canEditOrder || this.savingOrder()) return;
    this.errorMessage.set('');
    this.successMessage.set('');

    const dto = this.buildOrderEditDto();

    if (!this.canSaveOrderEditsDirectly()) {
      this.savingOrder.set(true);
      this.submitOrderEditForApproval(dto);
      return;
    }

    // Names/units are only needed to label "(new)" and "(removed)" extra rows; they come from the
    // catalogue the open editor already loaded, so the modal opens on the click.
    this.hydrateExtraServiceLabelMapsFromCache();
    this.pendingSaveDto = dto;
    this.saveConfirmChanges.set(this.computeOrderEditChanges(this.selectedOrder(), dto));
    this.showSaveConfirm.set(true);
  }

  /** Apply the reviewed changes. Only reachable from the save-confirmation modal. */
  confirmSaveOrderEdit(): void {
    if (!this.selectedOrder() || !this.pendingSaveDto || this.savingOrder()) return;
    const dto = this.pendingSaveDto;
    this.savingOrder.set(true);
    this.adminService.superAdminFullUpdateOrder(this.selectedOrder()!.id, dto).subscribe({
      next: () => {
        this.successMessage.set('Order updated successfully. All changes are recorded in Audit logs.');
        this.editingOrder.set(false);
        this.resetSaveConfirmState();
        this.refreshOrderAfterSave();
        setTimeout(() => { this.successMessage.set(''); }, 5000);
      },
      error: (err) => {
        // Keep the edit form open with the admin's values intact so they can retry or adjust.
        this.errorMessage.set(err.error?.message || 'Failed to update order.');
        this.resetSaveConfirmState();
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.savingOrder.set(false); }
    });
  }

  /** Dismiss the confirmation and return to the still-open edit form with nothing sent. */
  closeSaveConfirm(): void {
    if (this.savingOrder()) return;
    this.showSaveConfirm.set(false);
    this.pendingSaveDto = null;
    this.saveConfirmChanges.set([]);
  }

  private submitOrderEditForApproval(dto: SuperAdminUpdateOrderDto): void {
    if (!this.selectedOrder()) return;

    // Send the field-level diff the requesting admin is looking at, so the reviewer reads back the
    // request that was actually made rather than the proposal re-measured against whatever the
    // order looks like by the time they open it. Same computeOrderEditChanges the save-confirm
    // modal uses — one implementation, so requester and reviewer see identical rows.
    this.hydrateExtraServiceLabelMapsFromCache();
    const fieldChanges = this.computeOrderEditChanges(this.selectedOrder(), dto);

    this.adminService.submitPendingOrderEdit(
      this.selectedOrder()!.id, dto, fieldChanges, this.orderEditRequestReason().trim() || undefined
    ).subscribe({
      next: () => {
        this.successMessage.set('Your changes have been sent for approval. They appear on the order once a reviewer approves them.');
        this.editingOrder.set(false);
        this.loadOrderChangeRequests(this.selectedOrder()!.id);
        this.orderEditRequestReason.set('');
        setTimeout(() => { this.successMessage.set(''); }, 5000);
      },
      error: (err) => {
        // extractApiErrorMessage, not err.error?.message: a rejection from [ApiController] model
        // binding is a ValidationProblemDetails with no 'message' property, so the real reason
        // used to be swallowed behind this generic fallback.
        this.errorMessage.set(extractApiErrorMessage(err, 'Failed to submit edit for approval.'));
        setTimeout(() => { this.errorMessage.set(''); }, 5000);
      },
      complete: () => { this.savingOrder.set(false); }
    });
  }

  /**
   * Re-reads EVERYTHING the order panel shows after any action on it — the order itself, its
   * update history, balance, invoices, card info, refunds, cleaners and the Changes feed — so a
   * payment, invoice, edit or staffing change is visible at once, never after a page reload.
   * Called from every action handler; each read is independent, so one failing hides nothing else.
   */
  private refreshOrderAfterSave(): void {
    if (!this.selectedOrder()) return;
    const orderId = this.selectedOrder()!.id;
    this.loadUpdateHistory(orderId);
    this.loadOrderChangeRequests(orderId);
    this.refreshPartialBalanceQuietly(orderId);
    this.loadOrderSavedCardInfo(orderId);
    this.loadSingleOrderCleaners(orderId);
    if (this.isSuperAdmin()) this.loadOrderRefunds(orderId);
    if (this.orderChangesLoadedFor === orderId) this.loadOrderChanges(orderId);
    // The salary can move on any save (services, duration, maids, rate), so the breakdown is
    // refetched with the order rather than left showing the pre-save split.
    if (this.canViewCleanerPayroll()) this.loadOrderCleanerPayroll(this.selectedOrder()!.id);
    // So can the warnings — a save that raises the cleaner count or records a payment resolves
    // one. Targeted at this order so a single save does not drag the whole table over the wire.
    this.preloadStaffingWarnings([this.selectedOrder()!.id]);
    this.adminService.getOrderDetails(this.selectedOrder()!.id).subscribe({
      next: (o) => {
        this.selectedOrder.set(o);
        this.customerNames.set(o.id, `${o.contactFirstName} ${o.contactLastName}`);
        this.customerDetails.set(o.id, { id: o.userId, email: o.contactEmail });
        const orderIndex = this.orders().findIndex(order => order.id === o.id);
        if (orderIndex !== -1) {
          const updatedOrder = this.orders()[orderIndex];
          updatedOrder.contactFirstName = o.contactFirstName;
          this.orders.set(this.orders());
          updatedOrder.contactLastName = o.contactLastName;
          this.orders.set(this.orders());
          updatedOrder.contactEmail = o.contactEmail;
          this.orders.set(this.orders());
          updatedOrder.serviceAddress = o.serviceAddress;
          this.orders.set(this.orders());
          updatedOrder.serviceDate = o.serviceDate;
          this.orders.set(this.orders());
          updatedOrder.serviceTime = o.serviceTime;
          this.orders.set(this.orders());
          updatedOrder.totalDuration = o.totalDuration;
          this.orders.set(this.orders());
          // The row's staffing-review ⚠ is per-cleaner load, so it reads maidsCount. Assigning
          // cleaners now raises that count server-side; without copying it back the flag would
          // keep warning about a job that has just been staffed.
          updatedOrder.maidsCount = o.maidsCount;
          this.orders.set(this.orders());
          updatedOrder.status = o.status;
          this.orders.set(this.orders());
          updatedOrder.total = o.total;
          this.orders.set(this.orders());
          updatedOrder.tips = o.tips;
          this.orders.set(this.orders());
          updatedOrder.companyDevelopmentTips = o.companyDevelopmentTips;
          updatedOrder.isCommercial = !!o.isCommercial;
          this.orders.set(this.orders());
          if (this.isSuperAdmin()) this.calculateStatistics();
        }
      }
    });
  }

  // ── Regular / Commercial sub-tabs ─────────────────────────────────────────────────────

  private parseOrdersSubTab(raw: string | null): OrdersSubTab {
    return raw === 'commercial' ? 'commercial' : 'regular';
  }

  /** Switches sub-tab from a click. Writes `?ordersTab=` as a new history entry, so Back
   *  returns to the previous sub-tab. */
  selectOrdersSubTab(tab: OrdersSubTab): void {
    if (tab === this.ordersSubTab()) return;
    this.applyOrdersSubTab(tab, true);
  }

  private applyOrdersSubTab(tab: OrdersSubTab, writeUrl: boolean): void {
    if (tab !== this.ordersSubTab()) {
      this.subTabViewStates.set(this.ordersSubTab(), this.captureListViewState());
      this.ordersSubTab.set(tab);
      this.restoreListViewState(this.subTabViewStates.get(tab));
    }
    if (writeUrl) {
      // Only ordersTab is written. The admin shell's own deep-link params (orderId, tab,
      // userId, ...) are cleared at the same time: it re-applies them on every query-string
      // change, and a stale ?tab= would otherwise move the admin off the Orders tab.
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          ordersTab: tab === 'regular' ? null : tab,
          orderId: null, tab: null, userId: null, usersTab: null, clientId: null
        },
        queryParamsHandling: 'merge'
      });
    }
  }

  private captureListViewState(): OrdersListViewState {
    return {
      searchTerm: this.searchTerm(),
      statusFilter: this.statusFilter(),
      dateFilter: this.dateFilter(),
      customDateFrom: this.customDateFrom(),
      customDateTo: this.customDateTo(),
      serviceTypeFilter: this.serviceTypeFilter(),
      bookedByFilter: this.bookedByFilter(),
      paymentMethodFilter: this.paymentMethodFilter(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
      currentPage: this.currentPage()
    };
  }

  /** A sub-tab never visited starts from the defaults, not from the other tab's filters. */
  private restoreListViewState(state: OrdersListViewState | undefined): void {
    this.searchTerm.set(state?.searchTerm ?? '');
    this.statusFilter.set(state?.statusFilter ?? 'all');
    this.dateFilter.set(state?.dateFilter ?? 'all');
    this.customDateFrom.set(state?.customDateFrom ?? '');
    this.customDateTo.set(state?.customDateTo ?? '');
    this.serviceTypeFilter.set(state?.serviceTypeFilter ?? 'all');
    this.bookedByFilter.set(state?.bookedByFilter ?? 'all');
    this.paymentMethodFilter.set(state?.paymentMethodFilter ?? 'all');
    this.sortColumn.set(state?.sortColumn ?? 'serviceDate');
    this.sortDirection.set(state?.sortDirection ?? 'desc');
    this.currentPage.set(state?.currentPage ?? 1);
  }

  orderTypeLabel(order: { isCommercial?: boolean } | null | undefined): string {
    return order?.isCommercial ? 'Commercial' : 'Regular';
  }

  /**
   * Moves an order to the other sub-tab. Stored on the order, so the move survives any later
   * change to the customer's business flag. The row stays visible until the list re-filters,
   * which it does at once — the success line names where it went.
   */
  moveOrderType(orderId: number, toCommercial: boolean): void {
    if (this.movingOrderTypeId() != null || !this.userPermissions().permissions.canUpdate) return;
    this.movingOrderTypeId.set(orderId);
    this.adminService.updateOrderType(orderId, toCommercial).pipe(
      finalize(() => this.movingOrderTypeId.set(null))
    ).subscribe({
      next: (res) => {
        const row = this.orders().find(o => o.id === orderId);
        if (row) {
          row.isCommercial = res.isCommercial;
          this.orders.set(this.orders());
        }
        const open = this.selectedOrder();
        if (open && open.id === orderId) {
          open.isCommercial = res.isCommercial;
          this.selectedOrder.set(open);
        }
        this.calculateStatistics();
        // The current page may now be past the end of a shorter list.
        if (this.currentPage() > Math.max(1, this.totalPages)) this.currentPage.set(Math.max(1, this.totalPages));
        this.successMessage.set(res.message || `Order #${orderId} moved to ${toCommercial ? 'Commercial' : 'Regular'}.`);
        this.clearMessagesAfterDelay();
      },
      error: (err) => {
        this.errorMessage.set(extractApiErrorMessage(err, 'Could not move the order.'));
        this.clearMessagesAfterDelay();
      }
    });
  }

  // ── Change requests on the open order ─────────────────────────────────────────────────

  loadOrderChangeRequests(orderId: number): void {
    // Moderators are View-only and the endpoint is Admin + SuperAdmin.
    if (this.userRole() !== 'Admin' && this.userRole() !== 'SuperAdmin') {
      this.orderChangeRequests.set([]);
      return;
    }
    this.adminService.getOrderChangeRequests(orderId).subscribe({
      next: (list) => {
        if (this.viewingOrderId() !== orderId) return;
        this.orderChangeRequests.set(list);
        this.showAllOrderChangeRequests.set(false);
        // Keep the list row's "Done requested" pill honest with what the server says.
        const row = this.orders().find(o => o.id === orderId);
        const waiting = list.some(r => r.kind === 'Done' && r.status === 'Pending');
        if (row && !!row.hasPendingDoneRequest !== waiting) {
          row.hasPendingDoneRequest = waiting;
          this.orders.set(this.orders());
        }
      },
      error: () => { if (this.viewingOrderId() === orderId) this.orderChangeRequests.set([]); }
    });
  }

  /** Waiting requests always, then the three most recent decisions unless expanded. */
  visibleOrderChangeRequests(): OrderChangeRequest[] {
    const all = this.orderChangeRequests();
    if (this.showAllOrderChangeRequests()) return all;
    const waiting = all.filter(r => r.status === 'Pending');
    const decided = all.filter(r => r.status !== 'Pending').slice(0, 3);
    return [...waiting, ...decided];
  }

  hiddenOrderChangeRequestCount(): number {
    return this.orderChangeRequests().length - this.visibleOrderChangeRequests().length;
  }

  changeRequestKindLabel(r: OrderChangeRequest): string {
    return r.kind === 'Done' ? 'Done request' : 'Edit request';
  }

  changeRequestStatusLabel(r: OrderChangeRequest): string {
    switch (r.status) {
      case 'Pending': return 'Waiting for approval';
      case 'Approved': return 'Approved';
      case 'Rejected': return 'Rejected';
      default: return r.status;
    }
  }

  /** The open order has a Done request waiting. */
  selectedOrderHasPendingDoneRequest(): boolean {
    const order = this.selectedOrder();
    if (!order) return false;
    if (this.orderChangeRequests().some(r => r.orderId === order.id && r.kind === 'Done' && r.status === 'Pending')) return true;
    return !!this.orders().find(o => o.id === order.id)?.hasPendingDoneRequest;
  }

  /** The list row for the open order (the Done modal and the row actions work on rows). */
  selectedOrderListRow(): AdminOrderList | null {
    const order = this.selectedOrder();
    return order ? this.orders().find(o => o.id === order.id) ?? null : null;
  }

  pendingEditIsDoneRequest(): boolean {
    return this.selectedPendingEdit()?.kind === 'Done';
  }

  /** After a reviewer decides any request: the list row and, when it is open, the panel. */
  private afterChangeRequestDecided(orderId: number): void {
    this.adminService.getOrderDetails(orderId).subscribe({
      next: (o) => {
        const row = this.orders().find(r => r.id === orderId);
        if (row) {
          row.status = o.status;
          row.paymentMethod = o.paymentMethod;
          row.paymentReference = o.paymentReference;
          row.paymentNotes = o.paymentNotes;
          row.total = o.total;
          row.isCommercial = !!o.isCommercial;
          row.hasPendingDoneRequest = false;
          this.orders.set(this.orders());
          this.calculateStatistics();
        }
        if (this.selectedOrder()?.id === orderId) this.refreshOrderAfterSave();
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
      let start = Math.max(2, this.currentPage() - 1);
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