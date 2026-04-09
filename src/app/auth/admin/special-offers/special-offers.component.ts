// src/app/auth/admin/special-offers/special-offers.component.ts

import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SpecialOfferService, SpecialOffer, CreateSpecialOffer, UpdateSpecialOffer, OfferType } from '../../../services/special-offer.service';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-special-offers',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './special-offers.component.html',
  styleUrls: ['./special-offers.component.scss']
})
export class SpecialOffersComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tableWrapper', { static: false }) tableWrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('tableHeader', { static: false }) tableHeader!: ElementRef<HTMLTableSectionElement>;
  
  specialOffers: SpecialOffer[] = [];
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  
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
  
  showCreateForm = false;
  editingOfferId: number | null = null;
  specialOfferForm!: FormGroup;

  editingOfferType: { [key: number]: number } = {};
  
  offerTypes = [
    { value: OfferType.FirstTime, label: 'New Registered Users' },
    { value: OfferType.Seasonal, label: 'Seasonal' },
    { value: OfferType.Holiday, label: 'Holiday' },
    { value: OfferType.Custom, label: 'Custom' }
  ];

  // Permissions
  userRole: string = '';
  canCreate = false;
  canUpdate = false;
  canDelete = false;

  constructor(
    private specialOfferService: SpecialOfferService,
    private authService: AuthService,
    private fb: FormBuilder
  ) {
    this.initializeForm();
  }

  ngOnInit() {
    this.setUserPermissions();
    this.loadSpecialOffers();
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
      header.style.display = '';
      header.style.tableLayout = '';
      header.style.overflow = '';
      header.style.maxWidth = '';
      
      const headerRow = header.querySelector('tr') as HTMLTableRowElement;
      if (headerRow) {
        headerRow.style.overflow = '';
        headerRow.style.maxWidth = '';
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

  initializeForm() {
    this.specialOfferForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      description: ['', [Validators.maxLength(500)]],
      isPercentage: [true, Validators.required],
      discountValue: [20, [Validators.required, Validators.min(0.01)]],
      type: [OfferType.Custom, Validators.required],
      validFrom: [null],
      validTo: [null],
      minimumOrderAmount: [null, Validators.min(0)],
      requiresFirstTimeCustomer: [false],
      icon: [''],
      badgeColor: ['#28a745']
    });

    // Add validator for percentage discount
    this.specialOfferForm.get('discountValue')?.valueChanges.subscribe(() => {
      this.validateDiscountValue();
    });
    
    this.specialOfferForm.get('isPercentage')?.valueChanges.subscribe(() => {
      this.validateDiscountValue();
    });
  }

  validateDiscountValue() {
    const isPercentage = this.specialOfferForm.get('isPercentage')?.value;
    const discountValue = this.specialOfferForm.get('discountValue')?.value;
    
    if (isPercentage && discountValue > 100) {
      this.specialOfferForm.get('discountValue')?.setErrors({ max: true });
    }
  }

  setUserPermissions() {
    const currentUser = this.authService.currentUserValue;
    this.userRole = currentUser?.role || '';
    
    // Only Admin and SuperAdmin can manage special offers
    this.canCreate = this.userRole === 'Admin' || this.userRole === 'SuperAdmin';
    this.canUpdate = this.userRole === 'Admin' || this.userRole === 'SuperAdmin';
    this.canDelete = this.userRole === 'SuperAdmin'; // Only SuperAdmin can delete
  }

  loadSpecialOffers() {
    this.isLoading = true;
    this.specialOfferService.getAllSpecialOffers().subscribe({
      next: (offers) => {
        this.specialOffers = offers;
        this.isLoading = false;
        setTimeout(() => {
          if (!this.stickyHeaderInitialized) {
            this.initializeStickyHeader();
          } else {
            this.updateStickyHeader();
          }
        }, 150);
        this.clearMessages();
      },
      error: (error) => {
        console.error('Error loading special offers:', error);
        this.errorMessage = error.error?.message || 'Failed to load special offers';
        this.isLoading = false;
      }
    });
  }

  clearMessages() {
    setTimeout(() => {
      this.successMessage = '';
      this.errorMessage = '';
    }, 5000);
  }

  // Add this method to properly display offer types
  getOfferTypeString(type: number): string {
    switch(type) {
      case 0: return 'FirstTime';
      case 1: return 'Seasonal';
      case 2: return 'Holiday';
      case 3: return 'Custom';
      default: return 'Custom';
    }
  }

  showCreateOfferForm() {
    this.showCreateForm = true;
    this.editingOfferId = null;
    this.specialOfferForm.reset({
      isPercentage: true,
      discountValue: 20,
      type: OfferType.Custom,
      requiresFirstTimeCustomer: false,
      badgeColor: '#28a745'
    });
    
    // Ensure type field is enabled for new offers
    this.specialOfferForm.get('type')?.enable();
  }

  editOffer(offer: SpecialOffer) {
    this.editingOfferId = offer.id;
    this.showCreateForm = false;
    // Store the numeric type value
    this.editingOfferType[offer.id] = this.getOfferTypeValue(offer.type);
    
    // Ensure badge color has a valid value
    if (!offer.badgeColor || offer.badgeColor === '') {
      offer.badgeColor = '#28a745';
    }
    
    // Update the form state based on whether it's a first-time offer
    this.updateTypeFieldState();
  }
  

  getOfferTypeValue(typeString: string): number {
    switch(typeString) {
      case 'FirstTime': return OfferType.FirstTime;
      case 'Seasonal': return OfferType.Seasonal;
      case 'Holiday': return OfferType.Holiday;
      case 'Custom': return OfferType.Custom;
      default: return OfferType.Custom;
    }
  }

  // Method to handle type field disabled state
  updateTypeFieldState() {
    const typeControl = this.specialOfferForm.get('type');
    if (this.isEditingFirstTimeOffer()) {
      typeControl?.disable();
    } else {
      typeControl?.enable();
    }
  }

  saveOffer() {
    if (this.editingOfferId) {
      // Save inline edited offer
      const offer = this.specialOffers.find(o => o.id === this.editingOfferId);
      if (offer) {
        this.isLoading = true;
        
        const updateData: UpdateSpecialOffer = {
          name: offer.name,
          description: offer.description,
          isPercentage: offer.isPercentage,
          discountValue: offer.discountValue,
          type: this.editingOfferType[offer.id],
          validFrom: offer.validFrom ? new Date(offer.validFrom) : undefined,
          validTo: offer.validTo ? new Date(offer.validTo) : undefined,
          icon: offer.icon || '',
          badgeColor: offer.badgeColor || '#28a745',
          isActive: offer.isActive
        };

        this.specialOfferService.updateSpecialOffer(offer.id, updateData).subscribe({
          next: () => {
            this.successMessage = 'Special offer updated successfully';
            this.editingOfferId = null;
            this.loadSpecialOffers();
            this.isLoading = false;
          },
          error: (error) => {
            this.errorMessage = error.error?.message || 'Failed to update special offer';
            this.isLoading = false;
          }
        });
      }
    } else {
      // Save new offer (existing logic)
      if (!this.specialOfferForm.valid) {
        this.markFormGroupTouched(this.specialOfferForm);
        return;
      }

      this.isLoading = true;
      const formValue = this.specialOfferForm.value;

      // Create new offer
      const createData: CreateSpecialOffer = {
        ...formValue,
        type: formValue.type
      };

      this.specialOfferService.createSpecialOffer(createData).subscribe({
        next: () => {
          this.successMessage = 'Special offer created successfully';
          this.showCreateForm = false;
          this.loadSpecialOffers();
          this.isLoading = false;
        },
        error: (error) => {
          this.errorMessage = error.error?.message || 'Failed to create special offer';
          this.isLoading = false;
        }
      });
    }
  }

  cancelEdit() {
    this.showCreateForm = false;
    this.editingOfferId = null;
    this.specialOfferForm.reset();
    this.specialOfferForm.get('type')?.enable();
  }

  deleteOffer(offer: SpecialOffer) {
    if (offer.type === 'FirstTime') {
      this.errorMessage = 'Cannot delete the first-time customer discount';
      return;
    }

    if (!confirm(`Are you sure you want to delete "${offer.name}"?`)) {
      return;
    }

    this.specialOfferService.deleteSpecialOffer(offer.id).subscribe({
      next: () => {
        this.successMessage = 'Special offer deleted successfully';
        this.loadSpecialOffers();
      },
      error: (error) => {
        this.errorMessage = error.error?.message || 'Failed to delete special offer';
      }
    });
  }

  toggleOfferStatus(offer: SpecialOffer, enable: boolean) {
    const action = enable ? 'enable' : 'disable';
    if (!confirm(`Are you sure you want to ${action} "${offer.name}"?`)) {
      return;
    }
  
    const serviceCall = enable ? 
      this.specialOfferService.enableSpecialOffer(offer.id) : 
      this.specialOfferService.disableSpecialOffer(offer.id);
  
    serviceCall.subscribe({
      next: (response) => {
        this.successMessage = response.message;
        this.loadSpecialOffers();
      },
      error: (error) => {
        this.errorMessage = error.error?.message || `Failed to ${action} special offer`;
      }
    });
  }

  getOfferTypeLabel(type: string): string {
    return this.offerTypes.find(t => t.value === this.getOfferTypeValue(type))?.label || type;
  }

  isFirstTimeOffer(offer: SpecialOffer): boolean {
    return offer.type === 'FirstTime';
  }

  isEditingFirstTimeOffer(): boolean {
    if (!this.editingOfferId) return false;
    const offer = this.specialOffers.find(o => o.id === this.editingOfferId);
    return offer ? this.isFirstTimeOffer(offer) : false;
  }

  markFormGroupTouched(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      control?.markAsTouched({ onlySelf: true });
    });
  }
}