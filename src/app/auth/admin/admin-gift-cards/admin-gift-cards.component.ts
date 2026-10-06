// admin-gift-cards.component.ts
import { Component, OnInit, AfterViewInit, OnDestroy, ElementRef, HostListener, ChangeDetectionStrategy, inject, viewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { formatNyDateTime } from '../../../shared/ny-time.util';

interface GiftCardAdmin {
  id: number;
  code: string;
  originalAmount: number;
  currentBalance: number;
  /** Null while a "buy for myself - send later" card has not been sent yet. */
  recipientName: string | null;
  recipientEmail: string | null;
  senderName: string;
  senderEmail: string;
  message?: string;
  isActive: boolean;
  isPaid: boolean;
  createdAt: Date;
  paidAt?: Date;
  purchasedByUserName: string | null;
  purchasedByUserEmail?: string | null;
  /** "Buy for myself - send later" card the customer has not sent yet. */
  isPendingSend: boolean;
  sentAt?: Date | null;
  totalAmountUsed: number;
  timesUsed: number;
  lastUsedAt?: Date;
  isFullyUsed: boolean;
  usages: GiftCardUsage[];
}

interface GiftCardUsage {
  id: number;
  amountUsed: number;
  balanceAfterUsage: number;
  usedAt: Date;
  orderReference: string;
  usedByName: string;
  usedByEmail: string;
}

@Component({
  selector: 'app-admin-gift-cards',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './admin-gift-cards.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin-gift-cards.component.scss'
})
export class AdminGiftCardsComponent implements OnInit, AfterViewInit, OnDestroy {
  private adminService = inject(AdminService);

  readonly tableWrapper = viewChild<ElementRef<HTMLDivElement>>('tableWrapper');
  readonly tableHeader = viewChild<ElementRef<HTMLTableSectionElement>>('tableHeader');
  
  giftCards: GiftCardAdmin[] = [];
  filteredGiftCards: GiftCardAdmin[] = [];
  readonly selectedGiftCard = signal<GiftCardAdmin | null>(null);
  
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
  
  // Filters
  readonly searchTerm = signal('');
  readonly filterStatus = signal('all'); // all, active, inactive, fullyUsed, partiallyUsed
  readonly filterPaidStatus = signal('all'); // all, paid, unpaid
  readonly filterDeliveryStatus = signal('all'); // all, notSent, sent
  
  // Pagination
  readonly currentPage = signal(1);
  itemsPerPage = 20;
  readonly totalPages = signal(1);
  readonly paginatedGiftCards = signal<GiftCardAdmin[]>([]);
  
  // Stats
  readonly totalGiftCards = signal(0);
  readonly totalAmountSold = signal(0);
  readonly totalAmountUsed = signal(0);
  readonly activeGiftCards = signal(0);

  readonly giftCardBackgroundPath = signal<string>('');
  readonly hasGiftCardBackground = signal<boolean>(false);
  /** True when an upload is configured but its file is gone — the preview shows the default. */
  readonly giftCardBackgroundMissing = signal<boolean>(false);
  isUpdatingBackground: boolean = false;

  selectedFile: File | null = null;
  readonly isUploading = signal<boolean>(false);
  readonly imagePreviewUrl = signal<string | null>(null);
  
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly isSuperAdmin = signal(false);
  readonly userPermissions = signal<any>({
    permissions: {
      canActivate: false,
      canDeactivate: false
    }
  });

  ngOnInit() {
    this.checkUserRole();
    this.loadGiftCards();
    this.loadGiftCardConfig();
  }

  ngAfterViewInit() {
    this.initializeStickyHeader();
  }

  private initializeStickyHeader() {
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
    if (!tableWrapper || !this.tableHeader()) {
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

    this.horizontalScrollListener = () => {
      this.syncHorizontalScroll();
    };
    tableWrapper.nativeElement.addEventListener('scroll', this.horizontalScrollListener);

    this.stickyHeaderInitialized = true;
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
      header.style.left = `${wrapperLeft}px`;
      
      // Translate header horizontally to match the wrapper's scroll position
      // Use translate3d for better performance and to force GPU acceleration
      header.style.transform = `translate3d(-${scrollLeft}px, 0, 0)`;
      header.style.webkitTransform = `translate3d(-${scrollLeft}px, 0, 0)`;
      
      // Use will-change for better performance on mobile
      header.style.willChange = 'transform';
    }
  }

  checkUserRole() {
    this.adminService.getUserPermissions().subscribe({
      next: (permissions) => {
        this.isSuperAdmin.set(permissions.role === 'SuperAdmin');
        this.userPermissions.set(permissions);
      },
      error: () => {
        this.isSuperAdmin.set(false);
      }
    });
  }

  canToggleGiftCardStatus(giftCard: GiftCardAdmin): boolean {
    if (this.isSuperAdmin()) return true;
    if (!this.userPermissions().permissions) return false;
    
    return giftCard.isActive 
      ? this.userPermissions().permissions.canDeactivate 
      : this.userPermissions().permissions.canActivate;
  }

  maskGiftCardCode(code: string): string {
    return this.isSuperAdmin() ? code : '*'.repeat(code.length);
  }

  loadGiftCards() {
    this.loading.set(true);
    this.errorMessage.set('');
    
    this.adminService.getAllGiftCards().subscribe({
      next: (cards) => {
        setTimeout(() => {
          if (!this.stickyHeaderInitialized) {
            this.initializeStickyHeader();
          } else {
            this.updateStickyHeader();
          }
        }, 150);
        this.giftCards = cards;
        this.calculateStats();
        this.applyFilters();
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Failed to load gift cards');
        this.loading.set(false);
      }
    });
  }

  calculateStats() {
    this.totalGiftCards.set(this.giftCards.length);
    this.totalAmountSold.set(this.giftCards
      .filter(g => g.isPaid)
      .reduce((sum, g) => sum + g.originalAmount, 0));
    this.totalAmountUsed.set(this.giftCards
      .reduce((sum, g) => sum + g.totalAmountUsed, 0));
    this.activeGiftCards.set(this.giftCards
      .filter(g => g.isActive && !g.isFullyUsed).length);
  }

  applyFilters() {
    let filtered = [...this.giftCards];

    // Search filter
    if (this.searchTerm()) {
      const term = this.searchTerm().toLowerCase();
      filtered = filtered.filter(g =>
        g.id.toString().includes(term) ||
        (g.senderEmail || '').toLowerCase().includes(term) ||
        (g.recipientEmail || '').toLowerCase().includes(term) ||
        (g.purchasedByUserEmail || '').toLowerCase().includes(term)
      );
    }

    // Status filter
    switch (this.filterStatus()) {
      case 'active':
        filtered = filtered.filter(g => g.isActive && !g.isFullyUsed);
        break;
      case 'inactive':
        filtered = filtered.filter(g => !g.isActive);
        break;
      case 'fullyUsed':
        filtered = filtered.filter(g => g.isFullyUsed);
        break;
      case 'partiallyUsed':
        filtered = filtered.filter(g => g.totalAmountUsed > 0 && !g.isFullyUsed);
        break;
    }

    // Paid status filter
    switch (this.filterPaidStatus()) {
      case 'paid':
        filtered = filtered.filter(g => g.isPaid);
        break;
      case 'unpaid':
        filtered = filtered.filter(g => !g.isPaid);
        break;
    }

    // Delivery filter ("send later" cards the customer hasn't sent yet)
    switch (this.filterDeliveryStatus()) {
      case 'notSent':
        filtered = filtered.filter(g => g.isPendingSend);
        break;
      case 'sent':
        filtered = filtered.filter(g => !g.isPendingSend);
        break;
    }

    this.filteredGiftCards = filtered;
    this.updatePagination();
  }

  updatePagination() {
    this.totalPages.set(Math.ceil(this.filteredGiftCards.length / this.itemsPerPage));
    this.currentPage.set(Math.min(this.currentPage(), this.totalPages()));
    this.currentPage.set(Math.max(1, this.currentPage()));
    
    const startIndex = (this.currentPage() - 1) * this.itemsPerPage;
    this.paginatedGiftCards.set(this.filteredGiftCards.slice(
      startIndex,
      startIndex + this.itemsPerPage
    ));
  }

  changePage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.updatePagination();
    }
  }

  getVisiblePages(): number[] {
    const pages: number[] = [];
    const maxVisiblePages = 3; // Number of pages to show in the middle

    if (this.totalPages() <= 5) {
      // If total pages is 5 or less, show all pages
      for (let i = 2; i < this.totalPages(); i++) {
        pages.push(i);
      }
    } else {
      // Calculate the range of pages to show
      let start = Math.max(2, this.currentPage() - 1);
      let end = Math.min(this.totalPages() - 1, start + maxVisiblePages - 1);

      // Adjust start if we're near the end
      if (end === this.totalPages() - 1) {
        start = Math.max(2, end - maxVisiblePages + 1);
      }

      // Add pages to the array
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    }

    return pages;
  }

  previousPage() {
    if (this.currentPage() > 1) {
      this.changePage(this.currentPage() - 1);
    }
  }

  nextPage() {
    if (this.currentPage() < this.totalPages()) {
      this.changePage(this.currentPage() + 1);
    }
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.changePage(page);
    }
  }

  viewDetails(giftCard: GiftCardAdmin) {
    if (this.selectedGiftCard()?.id === giftCard.id) {
      this.selectedGiftCard.set(null);
    } else {
      this.selectedGiftCard.set(giftCard);
    }
  }

  closeDetails() {
    this.selectedGiftCard.set(null);
  }

  toggleGiftCardStatus(giftCard: GiftCardAdmin) {
    const action = giftCard.isActive ? 'deactivate' : 'activate';
    
    if (confirm(`Are you sure you want to ${action} this gift card?`)) {
      this.adminService.toggleGiftCardStatus(giftCard.id, action).subscribe({
        next: () => {
          this.loadGiftCards();
        },
        error: () => {
          alert(`Failed to ${action} gift card`);
        }
      });
    }
  }

  formatCurrency(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }

  formatDate(date: any): string {
    return new Date(date).toLocaleDateString();
  }

  formatDateTime(date: any): string {
    // createdAt/paidAt/usedAt are UTC — display in NY (business) time.
    return formatNyDateTime(date);
  }

  loadGiftCardConfig() {
    this.adminService.getGiftCardConfig().subscribe({
      next: (config) => {
        // The server sends the background IN EFFECT (the default when nothing usable is
        // uploaded), so the preview always shows what customers and the email get.
        this.giftCardBackgroundPath.set(config.backgroundImagePath || '');
        this.hasGiftCardBackground.set(config.hasBackground);
        this.giftCardBackgroundMissing.set(!!config.configuredImageMissing);
      },
      error: () => {}
    });
  }
  
  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      // Validate file type - ADDED image/webp
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        alert('Please select a valid image file (JPG, PNG, GIF, or WebP)');
        return;
      }
      
      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB');
        return;
      }
      
      this.selectedFile = file;
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.imagePreviewUrl.set(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  }
  
  uploadImage() {
    if (!this.selectedFile) {
      alert('Please select an image first');
      return;
    }
    
    this.isUploading.set(true);
    
    this.adminService.uploadGiftCardBackground(this.selectedFile).subscribe({
      next: (response) => {
        this.isUploading.set(false);
        
        if (response && response.imagePath) {
          this.giftCardBackgroundPath.set(response.imagePath);
          this.hasGiftCardBackground.set(true);
          this.giftCardBackgroundMissing.set(false);
          this.selectedFile = null;
          this.imagePreviewUrl.set(null);
          
          // Clear file input
          const fileInput = document.getElementById('file-input') as HTMLInputElement;
          if (fileInput) fileInput.value = '';
          
          // Clear the cache immediately
          localStorage.removeItem('giftCardBackground');
          localStorage.removeItem('giftCardBackgroundTimestamp');
          
          // Verify the image is accessible by trying to load it
          const testImg = new Image();
          testImg.onload = () => {
            alert('Background image uploaded and verified successfully!');
            // Reload config after verification
            setTimeout(() => {
              this.loadGiftCardConfig();
            }, 300);
          };
          testImg.onerror = () => {
            alert('Image uploaded but may not be accessible. Please check:\n1. Backend server is running\n2. Static file serving is configured correctly\n3. Try refreshing the gift cards page');
            // Still reload config even if verification fails
            setTimeout(() => {
              this.loadGiftCardConfig();
            }, 300);
          };
          
          // Every upload gets a new file name, so no cache-buster is needed.
          testImg.src = response.imagePath;
        } else {
          alert('Upload succeeded but no image path returned');
        }
      },
      error: (error) => {
        this.isUploading.set(false);
        const errorMessage = error.error?.message || error.message || 'Unknown error';
        alert('Upload failed: ' + errorMessage);
      }
    });
  }
}