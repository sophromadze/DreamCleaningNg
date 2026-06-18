import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExtraService } from '../../../services/booking.service';
import { ShimmerDirective } from '../../directives/shimmer.directive';
import { QuantityControlComponent } from '../quantity-control/quantity-control.component';
import {
  getExtraServiceImage,
  getExtraServiceTooltip,
  MobileTooltipManager
} from '../../booking/extra-service-display.utils';

/** Shape of the parents' selectedExtraServices entries (structurally typed). */
export interface ExtraServiceSelection {
  extraService: ExtraService;
  quantity: number;
  hours: number;
}

/**
 * Shared Extra Services card grid (extracted from the booking page; also used
 * by order-edit). Owns the header + "See all" toggle, the card grid, the
 * loading shimmer row and the per-card quantity/hours steppers.
 *
 * Selection state stays in the parent: `selections` is the parent's live
 * array, `tooltips` the parent's MobileTooltipManager (parents show/clear
 * tooltips from their own toggle logic). Card clicks and stepper changes are
 * emitted; the parents keep all business rules (same-day handling, deep-
 * cleaning exclusivity, totals, persistence).
 */
@Component({
  selector: 'app-extra-services-grid',
  standalone: true,
  imports: [CommonModule, ShimmerDirective, QuantityControlComponent],
  templateUrl: './extra-services-grid.component.html',
  styleUrls: ['./extra-services-grid.component.scss']
})
export class ExtraServicesGridComponent {
  @Input() extras: ExtraService[] = [];
  @Input() selections: ExtraServiceSelection[] = [];
  @Input() tooltips: MobileTooltipManager | null = null;
  /** Booking-only: same-day card is rendered disabled when false. */
  @Input() sameDayServiceAvailable = true;
  /** Booking-only: tooltip text shown on the disabled same-day card. */
  @Input() sameDayDisabledReason = '';
  /** Booking-only: shows the shimmer placeholder row. */
  @Input() loading = false;
  /** Booking-only: responsive max-width computed by the page. */
  @Input() containerMaxWidth: number | null = null;

  @Output() cardClick = new EventEmitter<ExtraService>();
  @Output() quantityChange = new EventEmitter<{ extra: ExtraService; quantity: number }>();
  @Output() hoursChange = new EventEmitter<{ extra: ExtraService; hours: number }>();

  showAll = false;
  readonly shimmerCards = [1, 2, 3, 4, 5];

  get hasMore(): boolean {
    return this.extras.length > 4;
  }

  toggleShowAll(): void {
    this.showAll = !this.showAll;
  }

  isSelected(extra: ExtraService): boolean {
    return this.selections.some(s => s.extraService.id === extra.id);
  }

  getQuantity(extra: ExtraService): number {
    const selected = this.selections.find(s => s.extraService.id === extra.id);
    return selected ? selected.quantity : 1;
  }

  getHours(extra: ExtraService): number {
    const selected = this.selections.find(s => s.extraService.id === extra.id);
    return selected ? selected.hours : 0.5;
  }

  isDisabled(extra: ExtraService): boolean {
    return !!extra.isSameDayService && !this.sameDayServiceAvailable;
  }

  isTooltipVisible(extraServiceId: number): boolean {
    return this.tooltips ? this.tooltips.isVisible(extraServiceId) : false;
  }

  imageFor(extra: ExtraService): string {
    return getExtraServiceImage(extra, this.isSelected(extra));
  }

  tooltipFor(extra: ExtraService): string {
    if (this.isDisabled(extra) && this.sameDayDisabledReason) {
      return this.sameDayDisabledReason;
    }
    return getExtraServiceTooltip(extra);
  }
}
