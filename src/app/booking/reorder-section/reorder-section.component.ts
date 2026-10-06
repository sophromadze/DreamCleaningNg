import { Component, ChangeDetectionStrategy, output, input, signal } from '@angular/core';
import { OrderList } from '../../services/order.service';
import { formatTime12h } from '../../shared/booking/extra-service-display.utils';
import { IconComponent } from '../../shared/icons/icon.component';
import { faArrowRotateRight } from '../../shared/icons/glyphs/faArrowRotateRight';
import { faXmark } from '../../shared/icons/glyphs/faXmark';

/**
 * "Reorder from Previous Orders" button + dropdown modal (extracted from the
 * booking page). Purely presentational: the booking page owns the orders list
 * and applies the selected reorder to the form.
 */
@Component({
  selector: 'app-reorder-section',
  standalone: true,
  imports: [IconComponent],
  // The host carries the .reorder-section class so the booking page's existing
  // layout rules (.reorder-section, .booking-form-top .reorder-section) keep applying.
  host: { class: 'reorder-section' },
  templateUrl: './reorder-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./reorder-section.component.scss']
})
export class ReorderSectionComponent {
  protected readonly icons = { faArrowRotateRight, faXmark };

  readonly orders = input<OrderList[]>([]);
  readonly isLoading = input(false);
  readonly reorderingOrderId = input<number | null>(null);
  /** Fires when the modal opens — the booking page lazy-loads orders if needed. */
  readonly opened = output<void>();
  readonly orderSelected = output<number>();

  readonly showModal = signal(false);

  toggleModal(): void {
    this.showModal.set(!this.showModal());
    if (this.showModal()) {
      this.opened.emit();
    }
  }

  selectOrder(orderId: number): void {
    this.showModal.set(false);
    this.orderSelected.emit(orderId);
  }

  formatOrderDate(date: any): string {
    return new Date(date).toLocaleDateString();
  }

  formatTime(time: string): string {
    return formatTime12h(time);
  }
}
