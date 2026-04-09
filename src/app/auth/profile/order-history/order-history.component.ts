import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { OrderService, OrderList, Order } from '../../../services/order.service';
import { FormPersistenceService } from '../../../services/form-persistence.service';


@Component({
  selector: 'app-order-history',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './order-history.component.html',
  styleUrls: ['./order-history.component.scss']
})
export class OrderHistoryComponent implements OnInit {
  orders: OrderList[] = [];
  isLoading = true;
  errorMessage = '';
  reorderingOrderId: number | null = null;

  constructor(
    private orderService: OrderService,
    private formPersistenceService: FormPersistenceService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.isLoading = true;
    this.orderService.getUserOrders().subscribe({
      next: (orders) => {
        this.orders = orders;
        this.isLoading = false;
      },
      error: (error) => {
        this.errorMessage = 'Failed to load orders';
        this.isLoading = false;
      }
    });
  }

  getStatusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'active':
        return 'status-active';
      case 'done':
        return 'status-done';
      case 'cancelled':
        return 'status-cancelled';
      case 'pending':
        return 'status-pending';
      default:
        return 'status-pending';
    }
  }

  formatDate(date: any): string {
    return new Date(date).toLocaleDateString();
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  }

  /** Additional amount to pay. Backend sends the correct difference (current − tips) − (original − tips). Show it as-is; do not add tips. */
  getEffectivePendingUpdateAmount(order: OrderList): number {
    const pending = order.pendingUpdateAmount ?? 0;
    if (pending <= 0.01) return 0;
    const hasInitial = (order.initialTotal ?? 0) > 0;
    if (hasInitial) {
      const currentWithoutTips = (order.total ?? 0) - (order.tips ?? 0) - (order.companyDevelopmentTips ?? 0);
      const originalWithoutTips = (order.initialTotal ?? 0) - (order.initialTips ?? 0) - (order.initialCompanyDevelopmentTips ?? 0);
      return Math.max(0, Math.round((currentWithoutTips - originalWithoutTips) * 100) / 100);
    }
    return Math.round(pending * 100) / 100;
  }

  canEditOrder(order: OrderList): boolean {
    // Check if service type is custom
    if (order.isCustomServiceType) {
      return false;
    }
    
    // Check if order status is not Active
    if (order.status !== 'Active') return false;
    
    // Check if it's more than 48 hours before service date
    const serviceDate = new Date(order.serviceDate);
    const now = new Date();
    const hoursUntilService = (serviceDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntilService > 48;
  }

  reorder(orderId: number) {
    this.reorderingOrderId = orderId;
    this.errorMessage = '';

    this.orderService.getOrderById(orderId).subscribe({
      next: (order: Order) => {
        // Map order data to booking form format
        const formData = {
          selectedServiceTypeId: order.serviceTypeId.toString(),
          selectedServices: order.services.map(service => ({
            serviceId: service.serviceId.toString(),
            quantity: service.quantity
          })),
          selectedExtraServices: order.extraServices.map(extraService => ({
            extraServiceId: extraService.extraServiceId.toString(),
            quantity: extraService.quantity,
            hours: extraService.hours
          })),
          cleaningType: this.getCleaningTypeFromOrder(order),
          contactFirstName: order.contactFirstName || '',
          contactLastName: order.contactLastName || '',
          contactEmail: order.contactEmail || '',
          contactPhone: order.contactPhone || '',
          serviceAddress: order.serviceAddress || '',
          aptSuite: order.aptSuite || '',
          apartmentName: '',
          city: order.city || '',
          state: order.state || '',
          zipCode: order.zipCode || '',
          entryMethod: order.entryMethod || '',
          specialInstructions: order.specialInstructions || '',
          tips: order.tips || 0,
          companyDevelopmentTips: order.companyDevelopmentTips || 0,
          promoCode: order.promoCode || '',
          hasStartedBooking: true,
          bookingProgress: 'started' as const
        };

        // Save form data
        this.formPersistenceService.saveFormData(formData);
        this.formPersistenceService.markBookingStarted();

        // Navigate to booking page
        this.router.navigate(['/booking']);
      },
      error: (error) => {
        console.error('Error loading order details:', error);
        this.errorMessage = 'Failed to load order details. Please try again.';
        this.reorderingOrderId = null;
      }
    });
  }

  private getCleaningTypeFromOrder(order: Order): string {
    // Check if we can determine cleaning type from order data
    // If not available, default to 'normal'
    // You may need to adjust this based on your order structure
    // For now, we'll check if there's any indication in the order
    // Since cleaning type might not be stored in order, default to 'normal'
    return 'normal';
  }

  isReordering(orderId: number): boolean {
    return this.reorderingOrderId === orderId;
  }

  payOrder(orderId: number) {
    // Navigate to payment page for this order
    this.router.navigate(['/order', orderId, 'pay']);
  }

  // Cancel modal properties
  showCancelModal = false;
  cancelModalOrderId: number | null = null;
  cancelReason = '';

  canCancelOrder(order: OrderList): boolean {
    return order.status === 'Active' && !!order.isPaid;
  }

  isLateCancellation(order: OrderList): boolean {
    if (!order.isPaid) return false;
    const serviceDate = new Date(order.serviceDate);
    const now = new Date();
    const hoursUntilService = (serviceDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursUntilService <= 48;
  }

  openCancelModal(orderId: number) {
    this.cancelModalOrderId = orderId;
    this.showCancelModal = true;
    this.cancelReason = '';
  }

  closeCancelModal() {
    this.showCancelModal = false;
    this.cancelModalOrderId = null;
    this.cancelReason = '';
  }

  getCancelModalOrder(): OrderList | undefined {
    return this.orders.find(o => o.id === this.cancelModalOrderId);
  }

  confirmCancelOrder() {
    if (!this.cancelModalOrderId || !this.cancelReason.trim()) return;

    this.cancellingOrderId = this.cancelModalOrderId;
    this.errorMessage = '';

    this.orderService.cancelOrder(this.cancelModalOrderId, { reason: this.cancelReason }).subscribe({
      next: (response: any) => {
        this.cancellingOrderId = null;
        this.closeCancelModal();
        this.loadOrders();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('ordersUpdated'));
        }
      },
      error: (error) => {
        this.cancellingOrderId = null;
        this.errorMessage = error.error?.message || error.message || 'Failed to cancel order. Please try again.';
      }
    });
  }

  cancellingOrderId: number | null = null;

  cancelUnpaidOrder(orderId: number) {
    if (!confirm('Are you sure you want to cancel this unpaid order? This action cannot be undone.')) {
      return;
    }

    this.cancellingOrderId = orderId;
    this.errorMessage = '';

    this.orderService.cancelOrder(orderId, { reason: 'Customer cancelled unpaid order' }).subscribe({
      next: (response: any) => {
        this.cancellingOrderId = null;
        this.loadOrders();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('ordersUpdated'));
        }
      },
      error: (error) => {
        this.cancellingOrderId = null;
        this.errorMessage = error.error?.message || error.message || 'Failed to cancel order. Please try again.';
      }
    });
  }

  isCancellingOrder(orderId: number): boolean {
    return this.cancellingOrderId === orderId;
  }
}