import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, PromoCode, CreatePromoCode, UpdatePromoCode, UserPermissions } from '../../../services/admin.service';

@Component({
  selector: 'app-promo-codes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './promo-codes.component.html',
  styleUrls: ['./promo-codes.component.scss']
})
export class PromoCodesComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tableWrapper', { static: false }) tableWrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('tableHeader', { static: false }) tableHeader!: ElementRef<HTMLTableSectionElement>;
  
  promoCodes: PromoCode[] = [];
  isAddingPromoCode = false;
  editingPromoCodeId: number | null = null;
  newPromoCode: CreatePromoCode = {
    code: '',
    description: '',
    isPercentage: false,
    discountValue: 0,
    maxUsageCount: undefined,
    maxUsagePerUser: undefined,
    validFrom: undefined,
    validTo: undefined,
    minimumOrderAmount: undefined
  };

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

  constructor(private adminService: AdminService) {}

  ngOnInit() {
    this.loadUserPermissions();
    this.loadPromoCodes();
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

    this.horizontalScrollListener = () => {
      this.syncHorizontalScroll();
    };
    this.tableWrapper.nativeElement.addEventListener('scroll', this.horizontalScrollListener);

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
    if (!this.tableWrapper || !this.tableHeader) {
      return;
    }

    const wrapper = this.tableWrapper.nativeElement;
    const header = this.tableHeader.nativeElement;
    
    if (header.style.position === 'fixed') {
      header.style.transform = `translateX(-${wrapper.scrollLeft}px)`;
    }
  }

  loadUserPermissions() {
    this.adminService.getUserPermissions().subscribe({
      next: (response) => {
        this.userRole = response.role;
        this.userPermissions = response;
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.errorMessage = 'Failed to load permissions. Please try again.';
      }
    });
  }

  loadPromoCodes() {
    this.adminService.getPromoCodes().subscribe({
      next: (codes) => {
        this.promoCodes = codes;
        setTimeout(() => {
          if (!this.stickyHeaderInitialized) {
            this.initializeStickyHeader();
          } else {
            this.updateStickyHeader();
          }
        }, 150);
      },
      error: (error) => {
        console.error('Error loading promo codes:', error);
        this.errorMessage = 'Failed to load promo codes. Please try again.';
      }
    });
  }

  startAddingPromoCode() {
    this.isAddingPromoCode = true;
    this.editingPromoCodeId = null;
    this.newPromoCode = {
      code: '',
      description: '',
      isPercentage: false,
      discountValue: 0,
      maxUsageCount: undefined,
      maxUsagePerUser: undefined,
      validFrom: undefined,
      validTo: undefined,
      minimumOrderAmount: undefined
    };
  }

  cancelAddPromoCode() {
    this.isAddingPromoCode = false;
    this.newPromoCode = {
      code: '',
      description: '',
      isPercentage: false,
      discountValue: 0,
      maxUsageCount: undefined,
      maxUsagePerUser: undefined,
      validFrom: undefined,
      validTo: undefined,
      minimumOrderAmount: undefined
    };
  }

  addPromoCode() {
    this.adminService.createPromoCode(this.newPromoCode).subscribe({
      next: (response) => {
        this.promoCodes.push(response);
        this.isAddingPromoCode = false;
        this.newPromoCode = {
          code: '',
          description: '',
          isPercentage: false,
          discountValue: 0,
          maxUsageCount: undefined,
          maxUsagePerUser: undefined,
          validFrom: undefined,
          validTo: undefined,
          minimumOrderAmount: undefined
        };
        this.successMessage = 'Promo code added successfully.';
      },
      error: (error) => {
        console.error('Error creating promo code:', error);
        this.errorMessage = 'Failed to create promo code. Please try again.';
      }
    });
  }

  editPromoCode(code: PromoCode) {
    this.editingPromoCodeId = code.id;
  }

  cancelEditPromoCode() {
    this.editingPromoCodeId = null;
  }

  savePromoCode(code: PromoCode) {
    const updateData: UpdatePromoCode = {
      description: code.description,
      isPercentage: code.isPercentage,
      discountValue: code.discountValue,
      maxUsageCount: code.maxUsageCount,
      maxUsagePerUser: code.maxUsagePerUser,
      validFrom: code.validFrom,
      validTo: code.validTo,
      minimumOrderAmount: code.minimumOrderAmount,
      isActive: code.isActive
    };

    this.adminService.updatePromoCode(code.id, updateData).subscribe({
      next: (response) => {
        const index = this.promoCodes.findIndex(c => c.id === response.id);
        if (index !== -1) {
          this.promoCodes[index] = response;
        }
        this.editingPromoCodeId = null;
        this.successMessage = 'Promo code updated successfully.';
      },
      error: (error) => {
        console.error('Error updating promo code:', error);
        this.errorMessage = 'Failed to update promo code. Please try again.';
      }
    });
  }

  deletePromoCode(code: PromoCode) {
    if (confirm('Are you sure you want to delete this promo code?')) {
      this.adminService.deletePromoCode(code.id).subscribe({
        next: () => {
          this.promoCodes = this.promoCodes.filter(c => c.id !== code.id);
          this.successMessage = 'Promo code deleted successfully.';
        },
        error: (error) => {
          console.error('Error deleting promo code:', error);
          this.errorMessage = 'Failed to delete promo code. Please try again.';
        }
      });
    }
  }

  deactivatePromoCode(code: PromoCode) {
    this.adminService.deactivatePromoCode(code.id).subscribe({
      next: (response) => {
        const index = this.promoCodes.findIndex(c => c.id === code.id);
        if (index !== -1) {
          this.promoCodes[index] = { ...this.promoCodes[index], isActive: false };
        }
        this.successMessage = 'Promo code deactivated successfully.';
      },
      error: (error) => {
        console.error('Error deactivating promo code:', error);
        this.errorMessage = 'Failed to deactivate promo code. Please try again.';
      }
    });
  }

  activatePromoCode(code: PromoCode) {
    this.adminService.activatePromoCode(code.id).subscribe({
      next: (response) => {
        const index = this.promoCodes.findIndex(c => c.id === code.id);
        if (index !== -1) {
          this.promoCodes[index] = { ...this.promoCodes[index], isActive: true };
        }
        this.successMessage = 'Promo code activated successfully.';
      },
      error: (error) => {
        console.error('Error activating promo code:', error);
        this.errorMessage = 'Failed to activate promo code. Please try again.';
      }
    });
  }
}
