import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, AuditLog, AuditMetadata, UserPermissions } from '../../../services/admin.service';
import { formatNyDateTime } from '../../../shared/ny-time.util';
import {
  formatAuditValue,
  formatAuditTimestamp,
  getAuditActionClass,
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditFieldLabel,
  shouldShowAuditField,
} from '../../../shared/admin/audit-field-display';

@Component({
  selector: 'app-audit-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './audit-history.component.html',
  styleUrls: ['./audit-history.component.scss']
})
export class AuditHistoryComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tableWrapper', { static: false }) tableWrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('tableHeader', { static: false }) tableHeader!: ElementRef<HTMLTableSectionElement>;
  
  auditLogs: AuditLog[] = [];
  isLoading = false;
  errorMessage = '';
  
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
  
  // ── Filters. All of these are sent to the server; none of them filter in the browser. ──
  selectedEntityType = 'all';
  selectedAction = 'all';
  selectedAdminId: number | 'all' = 'all';
  selectedDays = 180; // Default to 6 months (all available logs)
  searchTerm = '';
  /** Explicit date range (yyyy-MM-dd). When either is set it OVERRIDES the days dropdown. */
  fromDate = '';
  toDate = '';

  /** Debounce handle for the search box — one request per pause, not one per keystroke. */
  private searchDebounce?: ReturnType<typeof setTimeout>;

  // ── Pagination. Server-side: `auditLogs` holds ONE page, never the whole window. ──
  currentPage = 1;
  itemsPerPage = 20;
  totalPages = 1;
  totalCount = 0;

  /** Entity types / actions / admins that actually occur in the log. Filled from the API. */
  metadata: AuditMetadata = {
    entityTypes: [], actions: [], admins: [],
    undoBlockedEntityTypes: [], undoBlockedReasons: {},
  };

  /** Admin id -> display name, for rendering "Paid By: 4" as a person. */
  private adminNames = new Map<number, string>();
  
  // Expanded row state
  viewingLogId: number | null = null;
  
  // User permissions
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
  
  /**
   * Entity-type filter options, derived from the rows that exist rather than hardcoded.
   *
   * The old hardcoded list of 13 was already incomplete before the 2026-08-31 coverage sweep and
   * would have been badly wrong after it — a stream with no dropdown entry is a stream nobody can
   * find. Labels come from the shared display module, which humanizes anything unmapped, so a
   * newly audited action appears here with no frontend change at all.
   */
  get entityTypes(): { value: string; label: string }[] {
    return [
      { value: 'all', label: 'All Changes' },
      ...this.metadata.entityTypes.map(t => ({ value: t, label: getAuditEntityLabel(t) })),
    ];
  }

  get actionOptions(): { value: string; label: string }[] {
    return [
      { value: 'all', label: 'All Actions' },
      ...this.metadata.actions.map(a => ({ value: a, label: getAuditActionLabel(a) })),
    ];
  }

  constructor(private adminService: AdminService) {}

  ngOnInit() {
    this.loadUserPermissions();
  }

  /** Resolve an admin/user id to a name for the diff table. Null when we do not know them. */
  private resolveAdminName = (id: number): string | null => this.adminNames.get(id) ?? null;

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
        thElement.style.textAlign = 'left';
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
      header.style.left = `${wrapperLeft}px`;
      
      // Translate header horizontally to match the wrapper's scroll position
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
        this.loadMetadata();
        this.loadRecentLogs();
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.errorMessage = 'Failed to load permissions. Please try again.';
      }
    });
  }

  /**
   * Load ONE page from the server. Entity type, action, changed-by admin, date range and search
   * are all query parameters — nothing is filtered in the browser any more.
   */
  loadRecentLogs() {
    this.isLoading = true;
    this.errorMessage = '';

    const hasRange = !!this.fromDate || !!this.toDate;

    this.adminService.getAuditLogs({
      // An explicit range wins over the dropdown; sending both would let the narrower one silently
      // clip the range the admin actually picked.
      days: hasRange ? undefined : this.selectedDays,
      from: this.fromDate || undefined,
      to: this.toDate || undefined,
      entityType: this.selectedEntityType === 'all' ? undefined : this.selectedEntityType,
      action: this.selectedAction === 'all' ? undefined : this.selectedAction,
      changedByUserId: this.selectedAdminId === 'all' ? undefined : Number(this.selectedAdminId),
      search: this.searchTerm.trim() || undefined,
      page: this.currentPage,
      pageSize: this.itemsPerPage,
    }).subscribe({
      next: (page) => {
        this.auditLogs = this.processAuditLogs(page?.items ?? []);
        this.totalCount = page?.totalCount ?? 0;
        this.totalPages = Math.max(1, page?.totalPages ?? 1);
        // A filter change can leave the current page past the end of a shorter result set.
        if (this.currentPage > this.totalPages) {
          this.currentPage = this.totalPages;
          this.loadRecentLogs();
          return;
        }
        this.isLoading = false;
        setTimeout(() => {
          if (!this.stickyHeaderInitialized) {
            this.initializeStickyHeader();
          } else {
            this.updateStickyHeader();
          }
        }, 150);
      },
      error: () => {
        this.errorMessage = 'Failed to load audit logs';
        this.isLoading = false;
      }
    });
  }

  /** Filter vocabulary + the undo block list. Loaded once, alongside the first page. */
  private loadMetadata() {
    this.adminService.getAuditMetadata(180).subscribe({
      next: (meta) => {
        this.metadata = meta ?? this.metadata;
        this.adminNames = new Map((meta?.admins ?? []).map(a => [a.id, a.name || a.email]));
      },
      // A missing metadata response costs the dropdowns their options, not the page — the feed
      // itself still renders, so this must not surface as an error banner.
      error: () => { /* filters degrade to "All"; the log still loads */ }
    });
  }

  /** Any filter other than the page: reset to page 1, because page 5 of the old result set is
   *  meaningless against the new one. */
  onFilterChange() {
    this.currentPage = 1;
    this.loadRecentLogs();
  }

  /** Search is debounced so typing an email does not fire a request per character. */
  onSearchChange() {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => this.onFilterChange(), 350);
  }

  /** Picking an explicit range makes the days dropdown meaningless, so it is visibly disabled. */
  get hasExplicitDateRange(): boolean {
    return !!this.fromDate || !!this.toDate;
  }

  clearDateRange() {
    this.fromDate = '';
    this.toDate = '';
    this.onFilterChange();
  }

  clearAllFilters() {
    this.selectedEntityType = 'all';
    this.selectedAction = 'all';
    this.selectedAdminId = 'all';
    this.selectedDays = 180;
    this.searchTerm = '';
    this.fromDate = '';
    this.toDate = '';
    this.onFilterChange();
  }

  get hasActiveFilters(): boolean {
    return this.selectedEntityType !== 'all'
        || this.selectedAction !== 'all'
        || this.selectedAdminId !== 'all'
        || !!this.searchTerm.trim()
        || this.hasExplicitDateRange;
  }

  /**
   * Readable name for a changed field.
   *
   * Delegates to the shared map, which has a HUMANIZED FALLBACK. The old local map knew 18 names
   * and returned the raw identifier for everything else — `CleanerTotalSalary` rendered as
   * `CleanerTotalSalary`, which is the specific complaint this replaces.
   */
  getFieldDisplayName(field: string): string {
    return getAuditFieldLabel(field);
  }

  processAuditLogs(logs: any[]): any[] {   
    // First, process individual logs
    const processedLogs = logs.map((log, index) => {    
      const processedLog = {
        ...log,
        oldValues: log.oldValues || log.OldValues,
        newValues: log.newValues || log.NewValues,
        changedFields: log.changedFields || log.ChangedFields,
        changedBy: log.changedBy || log.ChangedBy,
        changedByEmail: log.changedByEmail || log.ChangedByEmail
      };
      
      // Parse oldValues if it's a string
      if (typeof processedLog.oldValues === 'string' && processedLog.oldValues) {
        try {
          processedLog.oldValues = JSON.parse(processedLog.oldValues);
        } catch (e) {
          console.error('Failed to parse oldValues:', e);
          processedLog.oldValues = {};
        }
      } else if (!processedLog.oldValues) {
        processedLog.oldValues = {};
      }
      
      // Parse newValues if it's a string
      if (typeof processedLog.newValues === 'string' && processedLog.newValues) {
        try {
          processedLog.newValues = JSON.parse(processedLog.newValues);
        } catch (e) {
          console.error('Failed to parse newValues:', e);
          processedLog.newValues = {};
        }
      } else if (!processedLog.newValues) {
        processedLog.newValues = {};
      }
      
      // Parse changedFields if it's a string
      if (typeof processedLog.changedFields === 'string' && processedLog.changedFields) {
        try {
          processedLog.changedFields = JSON.parse(processedLog.changedFields);
        } catch (e) {
          console.error('Failed to parse changedFields:', e);
          processedLog.changedFields = [];
        }
      } else if (!processedLog.changedFields) {
        processedLog.changedFields = [];
      }

      // Process changed fields to combine ServiceDate and ServiceTime
      processedLog.changedFields = this.processChangedFields(processedLog.changedFields, processedLog.oldValues, processedLog.newValues);
  
      return processedLog;
    });

    // Group related logs together
    return this.groupRelatedLogs(processedLogs);
  }

  // Process changed fields to combine ServiceDate and ServiceTime when both are present
  processChangedFields(changedFields: string[], oldValues: any, newValues: any): string[] {
    const hasServiceDate = changedFields.includes('ServiceDate');
    const hasServiceTime = changedFields.includes('ServiceTime');
    
    if (hasServiceDate && hasServiceTime) {
      // Remove individual ServiceDate and ServiceTime fields
      const filteredFields = changedFields.filter(field => field !== 'ServiceDate' && field !== 'ServiceTime');
      // Add combined field
      return [...filteredFields, 'ServiceDate&Time'];
    }
    
    return changedFields;
  }

  // Get combined ServiceDate&Time value for display
  getCombinedServiceDateTimeValue(value: any): string {
    // This method will be called for the combined field
    // We need to extract the date and time from the old and new values
    // For now, return a placeholder - we'll handle this in the template
    return 'Combined Date & Time';
  }

  // Get combined ServiceDate&Time display for old/new values
  getCombinedServiceDateTimeDisplay(values: any, type: 'old' | 'new'): string {
    const serviceDate = values.ServiceDate;
    const serviceTime = values.ServiceTime;
    
    if (!serviceDate && !serviceTime) {
      return 'Not set';
    }
    
    let dateStr = '';
    let timeStr = '';
    
    // Format date
    if (serviceDate) {
      try {
        const date = new Date(serviceDate);
        if (!isNaN(date.getTime())) {
          dateStr = date.toLocaleDateString();
        }
      } catch {
        dateStr = String(serviceDate);
      }
    }
    
    // Format time
    if (serviceTime) {
      let timeString = serviceTime;
      
      // If value is an object (TimeSpan serialized as object), extract the time string
      if (typeof serviceTime === 'object' && serviceTime !== null) {
        timeString = serviceTime.Hours !== undefined ? 
          `${String(serviceTime.Hours).padStart(2, '0')}:${String(serviceTime.Minutes || 0).padStart(2, '0')}` : 
          serviceTime.toString();
      }
      
      // Convert to string if needed
      timeString = String(timeString);
      
      // Parse time parts
      const timeParts = timeString.split(':');
      if (timeParts.length >= 2) {
        const hours = parseInt(timeParts[0]);
        const minutes = timeParts[1];
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHour = hours % 12 || 12;
        timeStr = `${displayHour}:${minutes} ${ampm}`;
      } else {
        timeStr = timeString;
      }
    }
    
    // Combine date and time
    if (dateStr && timeStr) {
      return `${dateStr} at ${timeStr}`;
    } else if (dateStr) {
      return dateStr;
    } else if (timeStr) {
      return timeStr;
    }
    
    return 'Not set';
  }

  // NEW: Group related audit logs together
  groupRelatedLogs(logs: any[]): any[] {
    const groupedLogs: any[] = [];
    const processedIds = new Set<number>();

    logs.forEach((log, index) => {
      if (processedIds.has(log.id)) {
        return; // Skip if already processed
      }

      // Check if this is an Order update that might have related OrderServicesUpdate
      if (log.entityType === 'Order' && log.action === 'Update') {
        // Look for related OrderServicesUpdate logs with same entityId and timestamp
        const relatedServiceLogs = logs.filter(otherLog => 
          otherLog.id !== log.id &&
          otherLog.entityType === 'OrderServicesUpdate' &&
          otherLog.entityId === log.entityId &&
          Math.abs(new Date(otherLog.createdAt).getTime() - new Date(log.createdAt).getTime()) < 5000 && // Within 5 seconds
          otherLog.changedBy === log.changedBy
        );

        if (relatedServiceLogs.length > 0) {
          // Merge the logs
          const mergedLog = {
            ...log,
            hasServiceChanges: true,
            serviceLogs: relatedServiceLogs,
            // Combine changed fields
            changedFields: [
              ...(log.changedFields || []),
              ...relatedServiceLogs.flatMap(serviceLog => serviceLog.changedFields || [])
            ]
          };

          groupedLogs.push(mergedLog);
          
          // Mark all related logs as processed
          processedIds.add(log.id);
          relatedServiceLogs.forEach(serviceLog => processedIds.add(serviceLog.id));
        } else {
          // No related service logs, add as is
          groupedLogs.push(log);
          processedIds.add(log.id);
        }
      } else if (log.entityType === 'OrderServicesUpdate') {
        // Check if this service log is already handled by an Order log
        const isHandled = logs.some(otherLog => 
          otherLog.entityType === 'Order' &&
          otherLog.entityId === log.entityId &&
          Math.abs(new Date(otherLog.createdAt).getTime() - new Date(log.createdAt).getTime()) < 5000 &&
          otherLog.changedBy === log.changedBy
        );

        if (!isHandled) {
          // This is a standalone service update, add as is
          groupedLogs.push(log);
          processedIds.add(log.id);
        }
      } else {
        // Other entity types, add as is
        groupedLogs.push(log);
        processedIds.add(log.id);
      }
    });

    return groupedLogs;
  }

  /**
   * The rows on screen. This is now simply the page the server returned.
   *
   * It used to filter and page in the browser, and its search had a defect worth remembering:
   * `search.startsWith('e')` treated ANY term beginning with "e" as an entity-id prefix, so
   * searching `eugene@…` looked for entity ids containing `ugene@…` and found nothing. Every
   * customer and admin whose email starts with an "e" was unsearchable. Search is server-side now
   * (AdminAuditController.ApplySearch), where the entity-id form is recognised only when the rest
   * of the term is digits.
   *
   * Assigning component state from a template-called getter is also how NG0100 happens; this one
   * assigns nothing.
   */
  get filteredLogs(): any[] {
    return this.auditLogs;
  }

  /** "Showing 21–40 of 512" — a page count means nothing without the total behind it. */
  get pageRangeLabel(): string {
    if (this.totalCount === 0) return 'No changes found';
    const first = (this.currentPage - 1) * this.itemsPerPage + 1;
    const last = Math.min(this.currentPage * this.itemsPerPage, this.totalCount);
    return `Showing ${first}–${last} of ${this.totalCount}`;
  }

  formatDate(date: any): string {
    // Audit timestamps are UTC — display in NY (business) time.
    return formatNyDateTime(date);
  }

  /** Badge colour. Shared so a newly coined action still reads as create-ish / delete-ish
   *  instead of falling through to no class at all. */
  getActionClass(action: string): string {
    return getAuditActionClass(action);
  }

  /** Friendly label for the action badge. Create/Update/Delete are unchanged; anything else is
   *  humanized, so `PayoutRecorded` reads as "Payout Recorded". */
  getActionDisplayLabel(action: string): string {
    return getAuditActionLabel(action);
  }

  /** Readable form of a value with no field context. Never returns raw JSON. */
  getFieldValue(value: any): string {
    return formatAuditValue(value, undefined, this.resolveAdminName);
  }

  private formatAuditTimestamp(value: any): string {
    return formatAuditTimestamp(value);
  }

  // UPDATED: Special handling for CleanerAssignment logs
  showChangedFields(log: AuditLog): boolean {
    // For CleanerAssignment logs, we want to show details differently
    if (log.entityType === 'CleanerAssignment') {
      return true; // Always show details for cleaner assignments
    }
    
    return log.action === 'Update' && 
           !!log.changedFields && 
           Array.isArray(log.changedFields) &&
           log.changedFields.length > 0 &&
           !!log.oldValues &&
           !!log.newValues;
  }

  // NEW: Check if there are any meaningful changed fields to display
  hasMeaningfulChangedFields(log: AuditLog): boolean {
    if (!log.changedFields || !Array.isArray(log.changedFields)) {
      return false;
    }
    
    // Check if there are any fields that should be shown
    return log.changedFields.some(field => this.shouldShowField(field));
  }

  // NEW: Get cleaner assignment details for display
  getCleanerAssignmentDetails(log: AuditLog): { cleanerEmail: string; orderId: number } | null {
    if (log.entityType !== 'CleanerAssignment' || !log.newValues) {
      return null;
    }

    try {
      const details = typeof log.newValues === 'string' ? JSON.parse(log.newValues) : log.newValues;
      return {
        cleanerEmail: details.CleanerEmail || 'Unknown',
        orderId: details.OrderId || log.entityId
      };
    } catch (e) {
      console.error('Failed to parse cleaner assignment details:', e);
      return null;
    }
  }

  /**
   * Readable form of one changed value, WITH its field name for context.
   *
   * All of the formatting lives in the shared audit-field-display module so the Audits tab, the
   * created/deleted value lists and any future reader agree: money gets a $, dates render in NY
   * business time (date-only fields are NOT shifted), enums resolve to labels by their declared
   * numeric value, booleans read Yes/No, durations read as hours and minutes, and user ids
   * resolve to names through the admin list the metadata endpoint returned.
   *
   * The old local version detected dates by handing the value to Date.parse and accepting
   * anything that did not come back NaN — which accepts "5" and "Deep Clean 2", so ordinary text
   * was being rendered as a date. The shared version matches an ISO shape instead.
   */
  getFieldDisplayValue(value: any, fieldName?: string): string {
    // Gift card codes stay masked for anyone below SuperAdmin — a permission rule, not
    // formatting, so it is decided here rather than in the shared module.
    if (fieldName === 'Code' && this.userRole !== 'SuperAdmin' && typeof value === 'string') {
      return '*'.repeat(value.length);
    }

    if (fieldName === 'ServiceDate&Time') {
      return this.getCombinedServiceDateTimeValue(value);
    }

    return formatAuditValue(value, fieldName, this.resolveAdminName);
  }

  isServiceUpdateLog(log: any): boolean {
    return log.entityType === 'OrderServicesUpdate';
  }

  /** Returns null rather than throwing when the stored JSON is unreadable — a malformed row must
   *  degrade to an explicit "could not be read" message, not to an empty expansion row. */
  getServiceUpdateDetails(log: any): any {
    if (!log.oldValues || !log.newValues) return null;

    let oldValues: any;
    let newValues: any;
    try {
      oldValues = typeof log.oldValues === 'string' ? JSON.parse(log.oldValues) : log.oldValues;
      newValues = typeof log.newValues === 'string' ? JSON.parse(log.newValues) : log.newValues;
    } catch {
      return null;
    }
    if (!oldValues || !newValues) return null;

    return {
      services: {
        old: oldValues.Services || [],
        new: newValues.Services || []
      },
      extraServices: {
        old: oldValues.ExtraServices || [],
        new: newValues.ExtraServices || []
      }
    };
  }

  /**
   * Would ANY of the detail blocks in the expansion row actually render?
   *
   * The expansion `<tr>` is emitted unconditionally, while every block inside it is separately
   * gated, so when they all fail the admin gets a literally blank `<td colspan="7">`. That is
   * what produced the empty row between #2113 and #2112 (2026-08-31): an order edit whose only
   * changed field was `UpdatedAt`, which `shouldShowField` hides. The backend no longer writes
   * those rows, but existing ones still have to render as something.
   *
   * The conditions below mirror the template's gates one for one. Keep them in step.
   */
  hasAnyRenderableDetail(log: any): boolean {
    if (log.entityType === 'BubblePointsAdjustment') return !!log.newValues;
    if (log.entityType === 'CleanerAssignment') return !!this.getCleanerAssignmentDetails(log);
    if (log.entityType === 'UserLoyaltyDiscount') return true;

    // Merged Order + OrderServicesUpdate view.
    if (log.hasServiceChanges && log.serviceLogs) {
      if (this.showChangedFields(log) && this.hasMeaningfulChangedFields(log)) return true;
      return (log.serviceLogs as any[]).some(sl => this.serviceLogHasVisibleRows(sl));
    }

    // Standalone service-update view.
    if (this.isServiceUpdateLog(log)) return this.serviceLogHasVisibleRows(log);

    // Standard view.
    if (this.showChangedFields(log) && this.hasMeaningfulChangedFields(log)) return true;
    if (log.action === 'Create' && log.newValues) return true;
    if (log.action === 'Delete' && log.oldValues) return true;
    return false;
  }

  /** True when a service-update row carries JSON we could not parse — distinguishes "nothing to
   *  show" from "we have something and cannot read it", which are different problems. */
  isDetailUnreadable(log: any): boolean {
    const candidates: any[] = log.hasServiceChanges && log.serviceLogs
      ? log.serviceLogs
      : (this.isServiceUpdateLog(log) ? [log] : []);

    return candidates.some(l => !!l.oldValues && !!l.newValues && this.getServiceUpdateDetails(l) === null);
  }

  private serviceLogHasVisibleRows(log: any): boolean {
    const details = this.getServiceUpdateDetails(log);
    if (!details) return false;
    return this.getAllServices(details.services.old, details.services.new).length > 0
        || this.getAllExtraServices(details.extraServices.old, details.extraServices.new).length > 0;
  }
  
  isServiceInList(service: any, list: any[]): boolean {
    return list.some(s => s.ServiceId === service.ServiceId);
  }
  
  isServiceModified(service: any, oldList: any[]): boolean {
    const oldService = oldList.find(s => s.ServiceId === service.ServiceId);
    return oldService && oldService.Quantity !== service.Quantity;
  }
  
  isExtraServiceInList(service: any, list: any[]): boolean {
    return list.some(s => s.ExtraServiceId === service.ExtraServiceId);
  }
  
  isExtraServiceModified(service: any, oldList: any[]): boolean {
    const oldService = oldList.find(s => s.ExtraServiceId === service.ExtraServiceId);
    return oldService && (oldService.Quantity !== service.Quantity || oldService.Hours !== service.Hours);
  }

  /** Secrets, plumbing and the row's own id are never rendered. Shared with the diff module. */
  shouldShowField(fieldName: string): boolean {
    return shouldShowAuditField(fieldName);
  }

  /** Readable entity-type label, humanized when unmapped. */
  getEntityTypeDisplayName(entityType: string): string {
    return getAuditEntityLabel(entityType);
  }

  getObjectKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }

  debugLog(log: any): string {
    return JSON.stringify({
      action: log.action,
      changedFields: log.changedFields,
      oldValuesKeys: log.oldValues ? Object.keys(log.oldValues) : [],
      newValuesKeys: log.newValues ? Object.keys(log.newValues) : []
    }, null, 2);
  }

  // Pagination. Each move refetches — the browser only ever holds one page.
  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.loadRecentLogs();
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.loadRecentLogs();
    }
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.currentPage = page;
      this.loadRecentLogs();
    }
  }

  clearMessages() {
    this.errorMessage = '';
  }

  viewLogDetails(logId: number) {
    if (this.viewingLogId === logId) {
      this.viewingLogId = null;
    } else {
      this.viewingLogId = logId;
    }
  }

  /**
   * Can this row be undone?
   *
   * The answer comes from the SERVER, as `undoBlockedReason` on each row. This component used to
   * keep its own copy of the block list, which had already drifted from AuditService's (it was
   * missing OrderNotification, OrderRefund and OrderTransfer) — so the button rendered enabled on
   * rows the API was always going to refuse, and the Phase 1 fabricated-before-image refusal was
   * invisible here entirely. There is now ONE definition, in AuditEntityTypes, shipped by
   * GET api/admin/audit-logs/metadata.
   */
  canUndoRedo(log: AuditLog): boolean {
    return !log.undoBlockedReason;
  }

  /** Tooltip for the disabled Undo control — the reason, verbatim from the server. */
  undoBlockedReason(log: AuditLog): string {
    return log.undoBlockedReason || '';
  }

  // Display helper for the UserLoyaltyDiscount details panel. Pulls a single field out of the
  // parsed old/new JSON bundle and formats it cleanly for the UI. Percentage gets a "%" suffix,
  // booleans become Yes/No, dates render in locale form, nulls become "—".
  getLoyaltyValue(values: any, field: string): string {
    if (!values || values[field] === undefined || values[field] === null) return '—';
    const v = values[field];
    if (field === 'Percentage') {
      const n = Number(v);
      return Number.isFinite(n) ? `${n}%` : String(v);
    }
    if (field === 'IsManualOverride' || typeof v === 'boolean') {
      return v ? 'Yes' : 'No';
    }
    if (field === 'ActivatedAt' || field === 'LastUsedAt') {
      // UTC timestamps — display in NY (business) time.
      const formatted = formatNyDateTime(v);
      return formatted || String(v);
    }
    return String(v);
  }

  isLogUndone(log: AuditLog): boolean {
    return !!log.undoneAt;
  }

  // Pending state per row keeps two undo buttons in different rows independent.
  undoingLogIds = new Set<number>();
  successMessage = '';

  undoLog(log: AuditLog, event?: Event) {
    event?.stopPropagation();
    if (this.undoingLogIds.has(log.id)) return;
    this.undoingLogIds.add(log.id);
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.undoAuditLog(log.id).subscribe({
      next: () => {
        log.undoneAt = new Date();
        this.successMessage = `Change #${log.id} undone.`;
        setTimeout(() => { this.successMessage = ''; }, 4000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to undo change.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.undoingLogIds.delete(log.id); }
    });
  }

  redoLog(log: AuditLog, event?: Event) {
    event?.stopPropagation();
    if (this.undoingLogIds.has(log.id)) return;
    this.undoingLogIds.add(log.id);
    this.errorMessage = '';
    this.successMessage = '';
    this.adminService.redoAuditLog(log.id).subscribe({
      next: () => {
        log.undoneAt = null;
        this.successMessage = `Change #${log.id} redone.`;
        setTimeout(() => { this.successMessage = ''; }, 4000);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to redo change.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      },
      complete: () => { this.undoingLogIds.delete(log.id); }
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

  // NEW: Helper method to display service quantity with special handling for bedrooms
  getServiceQuantityDisplay(service: any): string {
    if (service.ServiceName === 'Bedrooms' && service.Quantity === 0) {
      return 'Studio';
    }
    return service.Quantity.toString();
  }

  // NEW: Helper method to display extra service details properly
  getExtraServiceDisplay(service: any): string {
    const parts: string[] = [];
    
    // Only show quantity if it's greater than 0 and the service doesn't primarily use hours
    if (service.Quantity > 0 && (!service.Hours || service.Hours === 0)) {
      parts.push(`Qty ${service.Quantity}`);
    }
    
    // Show hours if present and greater than 0
    if (service.Hours && service.Hours > 0) {
      parts.push(`${service.Hours}h`);
    }
    
    return parts.join(' ');
  }

  // NEW: Helper method to check if extra service should show quantity
  shouldShowExtraServiceQuantity(service: any): boolean {
    return service.Quantity > 0 && (!service.Hours || service.Hours === 0);
  }

  // NEW: Helper method to check if extra service should show hours
  shouldShowExtraServiceHours(service: any): boolean {
    return service.Hours && service.Hours > 0;
  }

  // UPDATED: Get all extra services including removed ones for display, but filter out unchanged ones
  getAllExtraServices(oldServices: any[], newServices: any[]): any[] {
    const changedServices: any[] = [];
    
    // Add new services that are added, modified, or reduced
    newServices.forEach(newService => {
      const oldService = oldServices.find(s => s.ExtraServiceId === newService.ExtraServiceId);
      
      // Check if it's added, modified, or reduced
      if (!oldService || 
          this.isExtraServiceModified(newService, oldServices) || 
          this.isExtraServiceReduced(newService, oldServices)) {
        changedServices.push(newService);
      }
    });
    
    // Add removed services
    oldServices.forEach(oldService => {
      const exists = newServices.some(newService => 
        newService.ExtraServiceId === oldService.ExtraServiceId
      );
      if (!exists) {
        changedServices.push({
          ...oldService,
          isRemoved: true
        });
      }
    });
    
    return changedServices;
  }

  // NEW: Get all regular services including removed ones for display, but filter out unchanged ones
  getAllServices(oldServices: any[], newServices: any[]): any[] {
    const changedServices: any[] = [];
    
    // Add new services that are added or modified
    newServices.forEach(newService => {
      const oldService = oldServices.find(s => s.ServiceId === newService.ServiceId);
      
      // Check if it's added or modified
      if (!oldService || this.isServiceModified(newService, oldServices)) {
        changedServices.push(newService);
      }
    });
    
    // Add removed services
    oldServices.forEach(oldService => {
      const exists = newServices.some(newService => 
        newService.ServiceId === oldService.ServiceId
      );
      if (!exists) {
        changedServices.push({
          ...oldService,
          isRemoved: true
        });
      }
    });
    
    return changedServices;
  }

  // NEW: Check if extra service was removed
  isExtraServiceRemoved(service: any): boolean {
    return service.isRemoved === true;
  }

  // NEW: Check if extra service was reduced in quantity
  isExtraServiceReduced(service: any, oldList: any[]): boolean {
    const oldService = oldList.find(s => s.ExtraServiceId === service.ExtraServiceId);
    if (!oldService) return false;
    
    // Check if quantity was reduced
    if (service.Quantity !== undefined && oldService.Quantity !== undefined) {
      return service.Quantity < oldService.Quantity;
    }
    
    // Check if hours were reduced
    if (service.Hours !== undefined && oldService.Hours !== undefined) {
      return service.Hours < oldService.Hours;
    }
    
    return false;
  }

  // NEW: Check if regular service was removed
  isServiceRemoved(service: any): boolean {
    return service.isRemoved === true;
  }

  // NEW: Get old service data for comparison
  getOldService(service: any, oldServices: any[]): any {
    return oldServices.find(s => s.ServiceId === service.ServiceId) || service;
  }

  // NEW: Get old extra service data for comparison
  getOldExtraService(service: any, oldServices: any[]): any {
    return oldServices.find(s => s.ExtraServiceId === service.ExtraServiceId) || service;
  }

  // NEW: Get changed services for "Before" section (services that were modified or removed)
  getChangedServices(oldServices: any[], newServices: any[]): any[] {
    const changedServices: any[] = [];
    
    oldServices.forEach(oldService => {
      const newService = newServices.find(s => s.ServiceId === oldService.ServiceId);
      
      // Include if it was removed or modified
      if (!newService || this.isServiceModified(newService, oldServices)) {
        changedServices.push(oldService);
      }
    });
    
    return changedServices;
  }

  // NEW: Get changed extra services for "Before" section (services that were modified or removed)
  getChangedExtraServices(oldServices: any[], newServices: any[]): any[] {
    const changedServices: any[] = [];
    
    oldServices.forEach(oldService => {
      const newService = newServices.find(s => s.ExtraServiceId === oldService.ExtraServiceId);
      
      // Include if it was removed, modified, or reduced
      if (!newService || 
          this.isExtraServiceModified(newService, oldServices) || 
          this.isExtraServiceReduced(newService, oldServices)) {
        changedServices.push(oldService);
      }
    });
    
    return changedServices;
  }
}