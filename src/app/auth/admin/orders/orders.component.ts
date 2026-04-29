import { Component, OnInit, ChangeDetectorRef, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, OrderUpdateHistory, UserPermissions, SuperAdminUpdateOrderDto, PendingOrderEditListDto, PendingOrderEditDetailDto, AssignedCleanerAdmin } from '../../../services/admin.service';
import { OrderService, Order, OrderList } from '../../../services/order.service';
import { CleanerService, AvailableCleaner } from '../../../services/cleaner.service';
import { BookingService, ServiceType, ExtraService, Service } from '../../../services/booking.service';
import { DurationUtils } from '../../../utils/duration.utils';
import { OrderReminderService } from '../../../services/order-reminder.service';
import { FloorTypeSelectorComponent, FloorTypeSelection } from '../../../shared/components/floor-type-selector/floor-type-selector.component';
import { NewOrderNotificationService } from '../../../services/new-order-notification.service';
import { BubbleRewardsService } from '../../../services/bubble-rewards.service';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { normalizePhone10, sanitizePhoneInput } from '../../../utils/phone.utils';

// Extended interface for admin orders with additional properties
export interface AdminOrderList extends OrderList {
  userId: number;
  contactEmail: string;
  contactFirstName: string;
  contactLastName: string;
  totalDuration: number;
  tips: number;
  companyDevelopmentTips: number;
  cancellationReason?: string;
  isLateCancellation?: boolean;
}

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, FloorTypeSelectorComponent],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.scss']
})
export class OrdersComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tableWrapper', { static: false }) tableWrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('tableHeader', { static: false }) tableHeader!: ElementRef<HTMLTableSectionElement>;

  @Input() openOrderId: number | null = null;

  orders: AdminOrderList[] = [];
  selectedOrder: Order | null = null;
  viewingOrderId: number | null = null;

  Math = Math;
  
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
  itemsPerPage = 20;
  totalPages = 1;

  // Mark as Done modal
  showDoneModal = false;
  doneModalOrder: AdminOrderList | null = null;
  sendingReview = false;

  // Cancel order modal
  showAdminCancelModal = false;
  adminCancelOrderId: number | null = null;
  adminCancelReason = '';

  // New properties for cleaner assignment
  showCleanerModal = false;
  availableCleaners: AvailableCleaner[] = [];
  /** Filters the assign-cleaners modal list by name or email (client-side). */
  cleanerAssignmentSearchQuery = '';
  selectedCleaners: number[] = [];
  tipsForCleaner = '';
  assigningOrderId: number | null = null;
  assignedCleanersCache: Map<number, AssignedCleanerAdmin[]> = new Map();
  /** Tracks which orders have had their cleaners loaded (to distinguish "loading" from "not assigned") */
  cleanersLoadedSet: Set<number> = new Set();
  /** Cached resolved residential variant for list rows (without opening details). */
  residentialVariantCache: Map<number, 'Deep' | 'Regular'> = new Map();
  cleanerHourlySalary: number = 20; // Default hourly rate shown in assign modal

  loadingStates = {
    orders: false,
    orderDetails: false,
    assignedCleaners: false,
    assigningCleaners: false,
    removingCleaner: false,
    sendAssignmentMails: false
  };
  private resendingCleanerEmailKeys = new Set<string>();

  orderUpdateHistory: OrderUpdateHistory[] = [];
  loadingUpdateHistory = false;

  // Pending order edits (SuperAdmin: list and review; Admin: submit only)
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

  // SuperAdmin full order edit
  editingOrder = false;
  editOrderForm: Partial<SuperAdminUpdateOrderDto> = {};
  savingOrder = false;
  editOrderFormOriginalSubTotal = 0;
  editOrderFormOriginalDiscount = 0;
  editOrderFormOriginalSubscriptionDiscount = 0;
  editOrderFormPrevServiceQuantities: number[] = [];
  editOrderFormPrevExtraQuantities: number[] = [];
  editOrderFormPrevExtraHours: number[] = [];

  // Floor type edit state for admin edit form
  editFloorTypes: string[] = [];
  editFloorTypeOther: string = '';
  /** Extras available for the order's service type (for Add extra service dropdown). */
  editOrderAvailableExtras: ExtraService[] = [];
  serviceTypesCache: ServiceType[] = [];

  // Booking-consistent tax rate (8.875%)
  private readonly salesTaxRate = 0.08875;

  // Bubble Points settings (for estimated pts display in edit form)
  pointsPerDollar = 0;
  pointsEnabled = false;
  editEstimatedPoints = 0;

  // Statistics for SuperAdmin
  isSuperAdmin = false;
  /** True if user can edit orders: SuperAdmin (direct save) or Admin (submit for approval). */
  get canEditOrder(): boolean {
    return this.isSuperAdmin || (this.userRole === 'Admin' && this.userPermissions.permissions.canUpdate);
  }
  totalOrders = 0;
  totalAmount = 0;
  totalTaxes = 0;
  totalTips = 0;
  totalAmountWithoutTipsAndTaxes = 0;
  totalDuration = 0;

  constructor(
    private adminService: AdminService,
    private orderService: OrderService,
    private cleanerService: CleanerService,
    private bookingService: BookingService,
    public orderReminderService: OrderReminderService,
    public newOrderNotificationService: NewOrderNotificationService,
    private bubbleRewardsService: BubbleRewardsService,
    private cdr: ChangeDetectorRef
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
        this.loadOrders();
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.errorMessage = 'Failed to load permissions. Please try again.';
      }
    });
  }

  loadOrders() {
    this.loadingStates.orders = true;
    this.assignedCleanersCache.clear();
    this.cleanersLoadedSet.clear();
    this.residentialVariantCache.clear();
    this.clearMessages();

    if (this.userRole && this.userRole !== 'Customer') {
      this.adminService.getAllOrders().subscribe({
        next: (orders) => {
          this.orders = orders as AdminOrderList[];
          this.preloadResidentialVariants();
          this.preloadAssignedCleaners();
          this.orderReminderService.initialize(this.orders);
          if (this.isSuperAdmin) {
            this.calculateStatistics();
            this.loadPendingOrderEdits();
          }
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

    // Load ALL orders' cleaners in batches of 15 to avoid overwhelming the server
    const batchSize = 15;
    const allOrders = [...this.orders];

    const loadBatch = (startIndex: number) => {
      const batch = allOrders.slice(startIndex, startIndex + batchSize);
      if (batch.length === 0) {
        this.loadingStates.assignedCleaners = false;
        return;
      }

      const cleanerRequests = batch.map(order =>
        this.adminService.getAssignedCleanersWithIds(order.id).pipe(
          catchError((error) => {
            console.warn(`Failed to load cleaners for order ${order.id}:`, error);
            return of([] as AssignedCleanerAdmin[]);
          })
        )
      );

      forkJoin(cleanerRequests).subscribe({
        next: (allCleaners) => {
          batch.forEach((order, index) => {
            this.assignedCleanersCache.set(order.id, allCleaners[index] || []);
            this.cleanersLoadedSet.add(order.id);
          });
        },
        error: (error) => {
          console.error('Error preloading assigned cleaners batch:', error);
          // Mark batch orders as loaded (with empty) so they don't stay in loading state
          batch.forEach(order => this.cleanersLoadedSet.add(order.id));
        },
        complete: () => {
          const nextIndex = startIndex + batchSize;
          if (nextIndex < allOrders.length) {
            // Load next batch
            loadBatch(nextIndex);
          } else {
            // All batches done
            this.loadingStates.assignedCleaners = false;
          }
        }
      });
    };

    loadBatch(0);
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

  private calculateStatistics() {
    // Filter out pending and cancelled orders for calculations
    const validOrders = this.orders.filter(order => 
      order.status && 
      order.status.toLowerCase() !== 'pending' && 
      order.status.toLowerCase() !== 'cancelled'
    );
    
    this.totalOrders = validOrders.length;
    // Calculate total amount without tips (since tips don't count for taxes)
    this.totalAmount = validOrders.reduce((sum, order) => {
      const orderTotal = order.total || 0;
      const orderTips = order.tips || 0;
      const orderCompanyTips = order.companyDevelopmentTips || 0;
      return sum + (orderTotal - orderTips - orderCompanyTips);
    }, 0);
    
    // Calculate total taxes as 8.887% of total amount (no tips)
    const taxRate = 0.08887;
    this.totalTaxes = this.totalAmount * taxRate;
    
    // Calculate total tips (cleaner tips + company development tips)
    this.totalTips = validOrders.reduce((sum, order) => {
      const orderTips = order.tips || 0;
      const orderCompanyTips = order.companyDevelopmentTips || 0;
      return sum + orderTips + orderCompanyTips;
    }, 0);
    
    // Calculate total amount without tips and taxes (base service amount)
    this.totalAmountWithoutTipsAndTaxes = this.totalAmount - this.totalTaxes;
    
    // Calculate total duration from the totalDuration property
    this.totalDuration = validOrders.reduce((sum, order) => sum + (order.totalDuration || 0), 0);
  }

  private calculateStatisticsFromFiltered(filteredOrders: AdminOrderList[]) {
    // Filter out pending and cancelled orders for calculations
    const validOrders = filteredOrders.filter(order => 
      order.status && 
      order.status.toLowerCase() !== 'pending' && 
      order.status.toLowerCase() !== 'cancelled'
    );
    
    this.totalOrders = validOrders.length;
    // Calculate total amount without tips (since tips don't count for taxes)
    this.totalAmount = validOrders.reduce((sum, order) => {
      const orderTotal = order.total || 0;
      const orderTips = order.tips || 0;
      const orderCompanyTips = order.companyDevelopmentTips || 0;
      return sum + (orderTotal - orderTips - orderCompanyTips);
    }, 0);
    
    // Calculate total taxes as 8.887% of total amount (no tips)
    const taxRate = 0.08887;
    this.totalTaxes = this.totalAmount * taxRate;
    
    // Calculate total tips (cleaner tips + company development tips)
    this.totalTips = validOrders.reduce((sum, order) => {
      const orderTips = order.tips || 0;
      const orderCompanyTips = order.companyDevelopmentTips || 0;
      return sum + orderTips + orderCompanyTips;
    }, 0);
    
    // Calculate total amount without tips and taxes (base service amount)
    this.totalAmountWithoutTipsAndTaxes = this.totalAmount - this.totalTaxes;
    
    // Calculate total duration from the totalDuration property
    this.totalDuration = validOrders.reduce((sum, order) => sum + (order.totalDuration || 0), 0);
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
      this.viewingOrderId = null;
      this.selectedOrder = null;
      this.editingOrder = false;
      return;
    }

    this.viewingOrderId = orderId;
    this.editingOrder = false;
    this.loadingStates.orderDetails = true;

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

  formatUpdateDate(date: any): string {
    const d = new Date(date);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
    this.cleanerHourlySalary = 20;
  }

  /** Cleaners shown in the assign modal after applying the name/email search. */
  get availableCleanersFiltered(): AvailableCleaner[] {
    const q = this.cleanerAssignmentSearchQuery.trim().toLowerCase();
    if (!q) {
      return this.availableCleaners;
    }
    return this.availableCleaners.filter((c) => {
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase().trim();
      const email = (c.email ?? '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }

  /** Get default hourly rate based on whether order has deep cleaning extra service */
  getDefaultHourlyRate(orderId: number): number {
    if (this.selectedOrder && this.selectedOrder.id === orderId) {
      const hasDeepCleaning = this.selectedOrder.extraServices?.some(
        es => es.extraServiceName?.toLowerCase().includes('deep cleaning') &&
              !es.extraServiceName?.toLowerCase().includes('super')
      );
      return hasDeepCleaning ? 21 : 20;
    }
    return 20;
  }

  /** Round duration to nearest 15 minutes (same as DurationUtils) */
  roundToQuarter(minutes: number): number {
    return Math.round(minutes / 15) * 15;
  }

  /** Calculate per-cleaner rounded duration for salary */
  private getPerCleanerRoundedDuration(totalDuration: number, maidsCount: number, hasCleanersService: boolean): number {
    // For cleaner-hours service type (e.g. Office Cleaning), TotalDuration is per cleaner
    // For regular services, TotalDuration is total across all cleaners
    const perCleaner = hasCleanersService
      ? totalDuration
      : (maidsCount > 1 ? totalDuration / maidsCount : totalDuration);
    return this.roundToQuarter(perCleaner);
  }

  /** Calculate estimated total salary for display in modal */
  getEstimatedTotalSalary(): number {
    if (!this.selectedOrder) return 0;
    const roundedPerCleaner = this.getPerCleanerRoundedDuration(
      this.selectedOrder.totalDuration,
      this.selectedOrder.maidsCount,
      this.selectedOrder.hasCleanersService
    );
    return Math.round(roundedPerCleaner / 60 * this.selectedOrder.maidsCount * this.cleanerHourlySalary * 100) / 100;
  }

  /** Display value for the "Cleaners Total Salary" row in the details view.
   *  ALWAYS computed on-the-fly from current TotalDuration × MaidsCount × HourlyRate so the
   *  number matches what the user sees for Duration/Cleaners on the page, even when the stored
   *  cleanerTotalSalary is stale (e.g. an older edit added Extra Minutes without recalculating).
   *  Only cleaner-hours orders (Office Cleaning) store TotalDuration as per-cleaner; everything
   *  else (including Custom Pricing) stores TotalDuration as TOTAL across all maids and we divide. */
  getDisplayCleanerTotalSalary(): number {
    const order = this.selectedOrder;
    if (!order) return 0;
    const totalDuration = Number(order.totalDuration) || 0;
    const maids = Number(order.maidsCount) || 1;
    const rate = Number(order.cleanerHourlyRate) || 0;
    if (rate <= 0 || maids <= 0 || totalDuration <= 0) return 0;
    const hasCleaners = order.hasCleanersService;
    const perCleaner = hasCleaners
      ? totalDuration
      : (maids > 1 ? totalDuration / maids : totalDuration);
    const roundedPerCleaner = this.roundToQuarter(perCleaner);
    return Math.round(roundedPerCleaner / 60 * maids * rate * 100) / 100;
  }

  /** Recalculate cleaner total salary in edit form when hourly rate changes */
  recalcCleanerTotalSalary(): void {
    const rate = Number(this.editOrderForm.cleanerHourlyRate) || 0;
    const totalDuration = Number(this.editOrderForm.totalDuration) || 0;
    const maidsCount = Number(this.editOrderForm.maidsCount) || 1;
    const hasCleanersService = this.selectedOrder?.hasCleanersService ?? false;
    const roundedPerCleaner = this.getPerCleanerRoundedDuration(totalDuration, maidsCount, hasCleanersService);
    this.editOrderForm.cleanerTotalSalary = Math.round(roundedPerCleaner / 60 * maidsCount * rate * 100) / 100;
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
    } else {
      this.selectedCleaners.push(cleanerId);
    }
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
        this.errorMessage = 'Failed to assign cleaners. Please try again.';
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

  updateOrderStatus(order: AdminOrderList, newStatus: string) {
    this.adminService.updateOrderStatus(order.id, newStatus).subscribe({
      next: () => {
        order.status = newStatus;
        // Also update selectedOrder if it's the same order
        if (this.selectedOrder && this.selectedOrder.id === order.id) {
          this.selectedOrder.status = newStatus;
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
    this.showDoneModal = true;
  }

  closeDoneModal() {
    this.showDoneModal = false;
    this.doneModalOrder = null;
  }

  confirmDone(sendReview: boolean) {
    if (!this.doneModalOrder) return;
    const order = this.doneModalOrder;

    this.updateOrderStatus(order, 'Done');

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
    const newStatus = order.isPaid ? 'Active' : 'Pending';
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

  // Filtering methods
  get filteredOrders(): AdminOrderList[] {
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

    // Date filter
    if (this.dateFilter !== 'all') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      filtered = filtered.filter(order => {
        const serviceDateOnly = this.getServiceDateOnly(order.serviceDate);
        if (!serviceDateOnly) return false;
        
        switch (this.dateFilter) {
          case 'today':
            return serviceDateOnly >= today;
          case 'week':
            // Get start of current week (Sunday)
            const startOfWeek = new Date(today);
            const dayOfWeek = startOfWeek.getDay(); // 0 = Sunday, 1 = Monday, etc.
            startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek);
            startOfWeek.setHours(0, 0, 0, 0);
            return serviceDateOnly >= startOfWeek;
          case 'month':
            // Get start of current month (1st day)
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            return serviceDateOnly >= startOfMonth;
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

    // Update pagination
    this.totalPages = Math.ceil(filtered.length / this.itemsPerPage);
    
    // Recalculate statistics for SuperAdmin based on filtered data
    if (this.isSuperAdmin) {
      this.calculateStatisticsFromFiltered(filtered);
    }
    
    // Return paginated results
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return filtered.slice(start, start + this.itemsPerPage);
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

  getServiceTypeDisplay(order: AdminOrderList): string {
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

  private formatServiceTypeLabel(serviceTypeName: string | null | undefined): string {
    if (!serviceTypeName) return 'N/A';

    let normalized = serviceTypeName
      .toLowerCase()
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/\bcleaning\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Keep "in/out" formatting for move in/out service labels.
    normalized = normalized.replace(/\bin out\b/g, 'in/out');
    normalized = normalized.replace(/\bheavy conditional\b/g, 'heavy');
    normalized = normalized.replace(/\bpre arranged\b/g, 'arranged');

    if (!normalized) return 'N/A';

    return normalized.replace(/\b\w+\b/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
  }

  private isResidentialServiceType(serviceTypeName: string | null | undefined): boolean {
    const normalized = (serviceTypeName || '').toLowerCase().trim().replace(/[_\s]+/g, '-');
    return normalized === 'residential-cleaning' || normalized === 'residentialcleaning';
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

  getStatusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'active':
        return 'status-active';
      case 'pending':
        return 'status-pending';
      case 'done':
        return 'status-done';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return '';
    }
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

  getEditServiceDurationMin(s: { quantity: number }, index: number): number {
    const def = this.getEditServiceDefinition(index);
    if (!def) return 0;
    if (def.serviceKey === 'bedrooms' && (Number(s.quantity) || 0) === 0) return 20; // studio (matches booking + backend)
    return def.timeDuration * (Number(s.quantity) || 0);
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

  /** Hint text shown next to the "Duration (min)" input in the edit form: always per-cleaner.
   *  Stored TotalDuration is total work for non-custom & custom; admin sees the per-cleaner value
   *  here so it matches what's displayed on the order details page and what the customer saw. */
  getEditDurationHintText(): string {
    const totalDuration = Number(this.editOrderForm?.totalDuration ?? 0) || 0;
    const maidsCount = Number(this.editOrderForm?.maidsCount ?? 1) || 1;
    const hasCleaners = this.selectedOrder?.hasCleanersService ?? false;
    const perCleaner = hasCleaners
      ? totalDuration
      : (maidsCount > 1 ? totalDuration / maidsCount : totalDuration);
    return DurationUtils.formatDurationRounded(perCleaner);
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
      entryMethod: this.selectedOrder.entryMethod ?? null,
      specialInstructions: this.selectedOrder.specialInstructions ?? null,
      floorTypes: this.selectedOrder.floorTypes ?? null,
      floorTypeOther: this.selectedOrder.floorTypeOther ?? null,
      tips: this.selectedOrder.tips,
      companyDevelopmentTips: this.selectedOrder.companyDevelopmentTips,
      status: this.selectedOrder.status,
      cancellationReason: this.selectedOrder.cancellationReason ?? null,
      subTotal: this.selectedOrder.subTotal,
      tax: this.selectedOrder.tax,
      total: this.selectedOrder.total,
      discountAmount: this.selectedOrder.discountAmount,
      subscriptionDiscountAmount: (this.selectedOrder as any).subscriptionDiscountAmount ?? 0,
      cleanerHourlyRate: this.selectedOrder.cleanerHourlyRate ?? 20,
      cleanerTotalSalary: this.selectedOrder.cleanerTotalSalary ?? 0,
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
    const parsed = this.parseFloorTypesForEdit(this.selectedOrder.floorTypes, this.selectedOrder.floorTypeOther);
    this.editFloorTypes = parsed.types;
    this.editFloorTypeOther = parsed.otherText;
    this.editOrderFormOriginalSubTotal = this.selectedOrder.subTotal;
    this.editOrderFormOriginalDiscount = this.selectedOrder.discountAmount;
    this.editOrderFormOriginalSubscriptionDiscount = (this.selectedOrder as any).subscriptionDiscountAmount ?? 0;
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
    const cost = extra.hasHours ? extra.price * hours : extra.price * 1;
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
   * Recalculate Tax + Total. When subTotal changes, apply discount ratio so discount scales with subtotal.
   * discountedSubTotal = subTotal - discountAmount - subscriptionDiscountAmount; tax = round(discounted * 0.08875, 2); total = discounted + tax + tips + companyTips - giftCard.
   */
  recalculateEditPricing(): void {
    if (!this.selectedOrder || !this.editingOrder) return;

    let subTotal = Number(this.editOrderForm.subTotal ?? 0) || 0;
    let discountAmount = Number(this.editOrderForm.discountAmount ?? 0) || 0;
    let subscriptionDiscountAmount = Number(this.editOrderForm.subscriptionDiscountAmount ?? 0) || 0;

    if (this.editOrderFormOriginalSubTotal > 0 && subTotal !== this.editOrderFormOriginalSubTotal) {
      const ratioDiscount = this.editOrderFormOriginalDiscount / this.editOrderFormOriginalSubTotal;
      const ratioSub = this.editOrderFormOriginalSubscriptionDiscount / this.editOrderFormOriginalSubTotal;
      discountAmount = Math.round(subTotal * ratioDiscount * 100) / 100;
      subscriptionDiscountAmount = Math.round(subTotal * ratioSub * 100) / 100;
      this.editOrderForm.discountAmount = discountAmount;
      this.editOrderForm.subscriptionDiscountAmount = subscriptionDiscountAmount;
    }

    let discountedSubTotal = subTotal - discountAmount - subscriptionDiscountAmount;
    if (discountedSubTotal < 0) discountedSubTotal = 0;

    const tax = Math.round(discountedSubTotal * this.salesTaxRate * 100) / 100;
    // Tips are displayed and saved but do not affect the order total (payments) in admin
    const giftCardAmountUsed = Number((this.selectedOrder as any).giftCardAmountUsed ?? 0) || 0;
    const pointsRedeemedDiscount = Number((this.selectedOrder as any).pointsRedeemedDiscount ?? 0) || 0;
    const rewardBalanceUsed = Number((this.selectedOrder as any).rewardBalanceUsed ?? 0) || 0;
    const totalBeforeGiftCard = discountedSubTotal + tax;
    const total = Math.round(Math.max(0, totalBeforeGiftCard - giftCardAmountUsed - pointsRedeemedDiscount - rewardBalanceUsed) * 100) / 100;

    this.editOrderForm.tax = tax;
    this.editOrderForm.total = total;

    const tips = Number(this.editOrderForm.tips ?? 0) || 0;
    const companyTips = Number(this.editOrderForm.companyDevelopmentTips ?? 0) || 0;
    const base = total - tax - tips - companyTips;
    this.editEstimatedPoints = this.pointsEnabled && this.pointsPerDollar > 0
      ? Math.floor(Math.max(0, base) * this.pointsPerDollar)
      : 0;
  }

  /** Recompute subtotal from base price + services + extras (same formula as backend). */
  recalcSubtotalFromServicesAndExtras(): void {
    const st = this.getEditOrderServiceType();
    const priceMultiplier = Number((this.selectedOrder?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
    let sum = (Number(st?.basePrice ?? 0) || 0) * priceMultiplier;
    (this.editOrderForm.services ?? []).forEach(s => { sum += Number(s.cost ?? 0) || 0; });
    (this.editOrderForm.extraServices ?? []).forEach(e => { sum += Number(e.cost ?? 0) || 0; });
    this.editOrderForm.subTotal = Math.round(sum * 100) / 100;
    this.recalculateEditPricing();
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

  /** True when the selected order's service type is in Custom Pricing mode (ServiceType.isCustom). */
  private isCustomModeOrder(): boolean {
    const stId = this.selectedOrder?.serviceTypeId;
    if (stId == null) return false;
    const st = this.serviceTypesCache.find(s => s.id === stId);
    return !!st?.isCustom;
  }

  /** Compute total duration from service type base + all services + extras; set totalDuration and maidsCount (1 maid per 6h). */
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

    const baseOnly = st?.timeDuration ?? 0;
    let totalMin = baseOnly;
    services.forEach((s, i) => {
      totalMin += this.getEditServiceDurationMin(s, i);
    });
    (this.editOrderForm.extraServices ?? []).forEach((e, i) => {
      totalMin += this.getEditExtraDurationMin(e, i);
    });
    const currentFormDuration = Number(this.editOrderForm.totalDuration) || 0;
    // When services contribute nothing (e.g. custom Cleaners with timeDuration 0), don't overwrite order's duration
    if (totalMin <= baseOnly && currentFormDuration > baseOnly) {
      totalMin = currentFormDuration;
    }
    totalMin = Math.max(Math.round(totalMin), 60);
    this.editOrderForm.totalDuration = totalMin;
    this.updateMaidsFromDuration();
  }

  /** When user manually changes duration (or after recalc), set maids from duration (1 per 6h).
   *  Skipped when the service type has explicit Cleaners + Hours rows — those are authoritative.
   *  Also skipped for Custom Pricing mode — admin manages maids manually there. */
  updateMaidsFromDuration(): void {
    if (this.isCustomModeOrder()) return;
    if (this.isCleanerHoursOrder()) {
      const services = this.editOrderForm.services ?? [];
      const cleanerIdx = this.findCleanerRowIndexRobust();
      const cleanersQty = (cleanerIdx >= 0 && cleanerIdx < services.length)
        ? (Number(services[cleanerIdx].quantity) || 0) : 0;
      if (cleanersQty > 0) {
        this.editOrderForm.maidsCount = cleanersQty;
        return;
      }
    }
    const totalMin = Number(this.editOrderForm.totalDuration) || 0;
    const totalHours = totalMin / 60;
    this.editOrderForm.maidsCount = totalHours > 6 ? Math.ceil(totalHours / 6) : 1;
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
  private readonly studioBaseCost = 10;

  onEditServiceQuantityChange(s: { quantity: number; cost: number }, index: number): void {
    const q = Number(s.quantity) || 0;
    const def = this.getEditServiceDefinition(index);
    const isHoursRow = def?.serviceRelationType === 'hours' || def?.serviceKey === 'hours';
    if (isHoursRow) {
      this.onEditServiceHoursChange(index, q);
      return;
    }
    const prevQ = this.editOrderFormPrevServiceQuantities[index] ?? 1;
    const prevCost = Number(s.cost) || 0;
    // Studio: bedrooms quantity 0 has fixed cost and duration (handled in getEditServiceDurationMin)
    if (def?.serviceKey === 'bedrooms' && q === 0) {
      s.cost = this.studioBaseCost;
      this.editOrderFormPrevServiceQuantities[index] = 0;
      this.recalcSubtotalFromServicesAndExtras();
      return;
    }
    const isCleanerRow = def?.serviceRelationType === 'cleaner' || def?.serviceKey === 'cleaners';
    if (isCleanerRow) {
      const hours = this.getEditServiceHours(index);
      const priceMultiplier = Number((this.selectedOrder?.services?.[0] as any)?.priceMultiplier ?? 1) || 1;
      const rate = (def.cost ?? 0) * priceMultiplier;
      s.cost = Math.round(rate * q * hours * 100) / 100;
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
    s.cost = Math.round(unitPrice * q * 100) / 100;
    this.editOrderFormPrevServiceQuantities[index] = q;
    this.recalcSubtotalFromServicesAndExtras();
  }

  onEditServiceCostChange(): void {
    this.recalcSubtotalFromServicesAndExtras();
  }

  onEditExtraQuantityChange(e: { orderExtraServiceId?: number | null; quantity: number; hours: number; cost: number }, index: number): void {
    const q = Number(e.quantity) || 0;
    const def = this.getEditExtraDefinition(e, index);
    if (def?.hasQuantity) {
      e.cost = Math.round(def.price * q * 100) / 100;
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
    if (def?.hasHours) {
      e.cost = Math.round(def.price * h * 100) / 100;
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
  }

  /** Pending edits for the currently selected order (for template; avoids arrow fn in template). */
  getPendingEditsForSelectedOrder(): PendingOrderEditListDto[] {
    if (!this.selectedOrder) return [];
    return this.pendingOrderEdits.filter(p => p.orderId === this.selectedOrder!.id);
  }

  loadPendingOrderEdits(): void {
    if (!this.isSuperAdmin) return;
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

  /** Load extra service id -> name and hasHours from service types for pending edit diff labels. */
  private loadExtraServiceNamesForPendingEdit(): void {
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
      },
      error: () => { this.extraServiceNamesMap = new Map(); this.extraServiceHasHoursMap = new Map(); }
    });
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

  /** Build a list of field-level changes (current vs proposed) for display. */
  getPendingEditChanges(): { field: string; current: string; proposed: string }[] {
    const d = this.selectedPendingEdit;
    if (!d?.currentOrder || !d?.proposedChanges) return [];
    const cur = d.currentOrder as any;
    const prop = d.proposedChanges;
    const changes: { field: string; current: string; proposed: string }[] = [];
    const fmt = (v: any): string => v == null || v === '' ? '—' : String(v);
    const push = (field: string, c: any, p: any) => {
      const cv = fmt(c);
      const pv = fmt(p);
      if (cv !== pv) changes.push({ field, current: cv, proposed: pv });
    };
    const pushTime = (field: string, c: any, p: any) => {
      const cv = this.normalizeTimeToHHmm(c);
      const pv = this.normalizeTimeToHHmm(p);
      if (cv !== pv) changes.push({ field, current: cv || '—', proposed: pv || '—' });
    };
    push('Contact First Name', cur.contactFirstName, prop.contactFirstName);
    push('Contact Last Name', cur.contactLastName, prop.contactLastName);
    push('Email', cur.contactEmail, prop.contactEmail);
    push('Phone', cur.contactPhone, prop.contactPhone);
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
    if (curDate !== propDate) changes.push({ field: 'Service Date', current: curDate || '—', proposed: propDate || '—' });
    pushTime('Service Time', cur.serviceTime, prop.serviceTime);
    push('Duration (min)', cur.totalDuration, prop.totalDuration);
    push('Maids', cur.maidsCount, prop.maidsCount);
    push('Entry', cur.entryMethod, prop.entryMethod);
    const instructionsFieldLabel = this.isCustomServiceType(cur) ? 'Description' : 'Instructions';
    push(instructionsFieldLabel, cur.specialInstructions, prop.specialInstructions);
    push('Floor Types', cur.floorTypes, prop.floorTypes);
    push('SubTotal', cur.subTotal, prop.subTotal);
    push('Tax', cur.tax, prop.tax);
    push('Tips', cur.tips, prop.tips);
    push('Company Tips', cur.companyDevelopmentTips, prop.companyDevelopmentTips);
    push('Total', cur.total, prop.total);
    push('Discount', cur.discountAmount, prop.discountAmount);
    push('Subscription Discount', cur.subscriptionDiscountAmount, prop.subscriptionDiscountAmount);
    push('Status', cur.status, prop.status);
    push('Cancellation Reason', cur.cancellationReason, prop.cancellationReason);

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
          changes.push({ field: `${name} (qty/cost)`, current: `(${cq}/${cc})`, proposed: `(${pq}/${pc})` });
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
          changes.push({ field: `${label} ${unit}`, current: `(${cVal}/${cc})`, proposed: `(${pVal}/${pc})` });
        }
      } else if (oeId === 0 && (pe.extraServiceId ?? (pe as any).extraServiceId)) {
        const eid = pe.extraServiceId ?? (pe as any).extraServiceId;
        const extraName = this.extraServiceNamesMap.get(Number(eid)) ?? `Extra #${eid}`;
        const useHours = this.extraServiceHasHoursMap.get(Number(eid));
        const pVal = useHours ? Number(pe.hours) : Number(pe.quantity);
        const pc = Number(pe.cost);
        changes.push({ field: `${extraName} (new) ${unit}`, current: '—', proposed: `(${pVal}/${pc})` });
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
      changes.push({ field: `${extraLabel} (removed) ${unit}`, current: `(${cVal}/${cc})`, proposed: '—' });
    }
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

  saveOrderEdit(): void {
    if (!this.selectedOrder || !this.canEditOrder || this.savingOrder) return;
    this.savingOrder = true;
    this.errorMessage = '';
    this.successMessage = '';
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
      entryMethod: this.editOrderForm.entryMethod ?? undefined,
      specialInstructions: this.editOrderForm.specialInstructions ?? undefined,
      floorTypes: this.editOrderForm.floorTypes ?? undefined,
      floorTypeOther: this.editOrderForm.floorTypeOther ?? undefined,
      tips: this.editOrderForm.tips ?? undefined,
      companyDevelopmentTips: this.editOrderForm.companyDevelopmentTips ?? undefined,
      status: this.editOrderForm.status ?? undefined,
      cancellationReason: this.editOrderForm.cancellationReason ?? undefined,
      subTotal: this.editOrderForm.subTotal ?? undefined,
      tax: this.editOrderForm.tax ?? undefined,
      total: this.editOrderForm.total ?? undefined,
      discountAmount: this.editOrderForm.discountAmount ?? undefined,
      subscriptionDiscountAmount: this.editOrderForm.subscriptionDiscountAmount ?? undefined,
      cleanerHourlyRate: this.editOrderForm.cleanerHourlyRate ?? undefined,
      cleanerTotalSalary: this.editOrderForm.cleanerTotalSalary ?? undefined,
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

    if (this.isSuperAdmin) {
      this.adminService.superAdminFullUpdateOrder(this.selectedOrder.id, dto).subscribe({
        next: () => {
          this.successMessage = 'Order updated successfully. All changes are recorded in Audit logs.';
          this.editingOrder = false;
          this.refreshOrderAfterSave();
          setTimeout(() => { this.successMessage = ''; }, 5000);
        },
        error: (err) => {
          this.errorMessage = err.error?.message || 'Failed to update order.';
          setTimeout(() => { this.errorMessage = ''; }, 5000);
        },
        complete: () => { this.savingOrder = false; }
      });
    } else {
      // Admin: submit for SuperAdmin approval
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