import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, CreateSubscription, UpdateSubscription, UserPermissions } from '../../../services/admin.service';
import { Subscription } from '../../../services/booking.service';

@Component({
  selector: 'app-subscriptions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './subscriptions.component.html',
  styleUrls: ['./subscriptions.component.scss']
})
export class SubscriptionsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('tableWrapper', { static: false }) tableWrapper!: ElementRef<HTMLDivElement>;
  @ViewChild('tableHeader', { static: false }) tableHeader!: ElementRef<HTMLTableSectionElement>;
  
  subscriptions: Subscription[] = [];
  isAddingSubscription = false;
  editingSubscriptionId: number | null = null;
  newSubscription: CreateSubscription = {
    name: '',
    description: '',
    discountPercentage: 0,
    subscriptionDays: 30,
    displayOrder: 0
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
    this.loadSubscriptions();
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
      },
      error: (error) => {
        console.error('Error loading permissions:', error);
        this.errorMessage = 'Failed to load permissions. Please try again.';
      }
    });
  }

  loadSubscriptions() {
    this.adminService.getSubscriptions().subscribe({
      next: (subscriptions) => {
        // Sort by displayOrder
        this.subscriptions = subscriptions.sort((a, b) => 
          (a.displayOrder || 0) - (b.displayOrder || 0)
        );
        setTimeout(() => {
          if (!this.stickyHeaderInitialized) {
            this.initializeStickyHeader();
          } else {
            this.updateStickyHeader();
          }
        }, 150);
      },
      error: (error) => {
        console.error('Error loading subscriptions:', error);
        this.errorMessage = 'Failed to load subscriptions. Please try again.';
      }
    });
  }

  startAddingSubscription() {
    this.isAddingSubscription = true;
    this.editingSubscriptionId = null;
    this.newSubscription = {
      name: '',
      description: '',
      discountPercentage: 0,
      subscriptionDays: 30,
      displayOrder: 0
    };
  }

  cancelAddSubscription() {
    this.isAddingSubscription = false;
    this.newSubscription = {
      name: '',
      description: '',
      discountPercentage: 0,
      subscriptionDays: 30,
      displayOrder: 0
    };
  }

  addSubscription() {
    this.adminService.createSubscription(this.newSubscription).subscribe({
      next: (response) => {
        this.loadSubscriptions(); // Change from push to reload
        this.isAddingSubscription = false;
        this.newSubscription = {
          name: '',
          description: '',
          discountPercentage: 0,
          subscriptionDays: 30,
          displayOrder: 0
        };
        this.successMessage = 'Subscription added successfully.';
      },
      error: (error) => {
        console.error('Error creating subscription:', error);
        this.errorMessage = 'Failed to create subscription. Please try again.';
      }
    });
  }

  editSubscription(subscription: Subscription) {
    this.editingSubscriptionId = subscription.id;
  }

  cancelEditSubscription() {
    this.editingSubscriptionId = null;
  }

  saveSubscription(subscription: Subscription) {
    const updateData: UpdateSubscription = {
      name: subscription.name,
      description: subscription.description,
      discountPercentage: subscription.discountPercentage,
      subscriptionDays: subscription.subscriptionDays,
      displayOrder: subscription.displayOrder || 0 
    };
  
    this.adminService.updateSubscription(subscription.id, updateData).subscribe({
      next: (response) => {
        this.loadSubscriptions(); // Add this line to reload and re-sort
        this.editingSubscriptionId = null;
        this.successMessage = 'Subscription updated successfully.';
      },
      error: (error) => {
        console.error('Error updating subscription:', error);
        this.errorMessage = 'Failed to update subscription. Please try again.';
      }
    });
  }

  deleteSubscription(subscription: Subscription) {
    if (confirm('Are you sure you want to delete this subscription?')) {
      this.adminService.deleteSubscription(subscription.id).subscribe({
        next: () => {
          this.subscriptions = this.subscriptions.filter(s => s.id !== subscription.id);
          this.successMessage = 'Subscription deleted successfully.';
        },
        error: (error) => {
          console.error('Error deleting subscription:', error);
          this.errorMessage = 'Failed to delete subscription. Please try again.';
        }
      });
    }
  }

  deactivateSubscription(subscription: Subscription) {
    this.adminService.deactivateSubscription(subscription.id).subscribe({
      next: (response) => {
        const index = this.subscriptions.findIndex(s => s.id === subscription.id);
        if (index !== -1) {
          this.subscriptions[index] = { ...this.subscriptions[index], isActive: false };
        }
        this.successMessage = 'Subscription deactivated successfully.';
      },
      error: (error) => {
        console.error('Error deactivating subscription:', error);
        this.errorMessage = 'Failed to deactivate subscription. Please try again.';
      }
    });
  }

  activateSubscription(subscription: Subscription) {
    this.adminService.activateSubscription(subscription.id).subscribe({
      next: (response) => {
        const index = this.subscriptions.findIndex(s => s.id === subscription.id);
        if (index !== -1) {
          this.subscriptions[index] = { ...this.subscriptions[index], isActive: true };
        }
        this.successMessage = 'Subscription activated successfully.';
      },
      error: (error) => {
        console.error('Error activating subscription:', error);
        this.errorMessage = 'Failed to activate subscription. Please try again.';
      }
    });
  }
}
