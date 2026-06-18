import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderList } from '../../services/order.service';
import { formatTime12h } from '../../shared/booking/extra-service-display.utils';

/**
 * "Reorder from Previous Orders" button + dropdown modal (extracted from the
 * booking page). Purely presentational: the booking page owns the orders list
 * and applies the selected reorder to the form.
 */
@Component({
  selector: 'app-reorder-section',
  standalone: true,
  imports: [CommonModule],
  // The host carries the .reorder-section class so the booking page's existing
  // layout rules (.reorder-section, .booking-form-top .reorder-section) keep applying.
  host: { class: 'reorder-section' },
  templateUrl: './reorder-section.component.html',
  styleUrls: ['./reorder-section.component.scss']
})
export class ReorderSectionComponent {
  @Input() orders: OrderList[] = [];
  @Input() isLoading = false;
  @Input() reorderingOrderId: number | null = null;
  /** Fires when the modal opens — the booking page lazy-loads orders if needed. */
  @Output() opened = new EventEmitter<void>();
  @Output() orderSelected = new EventEmitter<number>();

  showModal = false;

  toggleModal(): void {
    this.showModal = !this.showModal;
    if (this.showModal) {
      this.opened.emit();
    }
  }

  selectOrder(orderId: number): void {
    this.showModal = false;
    this.orderSelected.emit(orderId);
  }

  formatOrderDate(date: any): string {
    return new Date(date).toLocaleDateString();
  }

  formatTime(time: string): string {
    return formatTime12h(time);
  }
}
