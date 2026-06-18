import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShimmerDirective } from '../../directives/shimmer.directive';

/** One label/value row of the summary (details or price breakdown). */
export interface SummaryLine {
  label: string;
  value: string;
  /** Extra class on the row, e.g. 'subscription-discount', 'points-discount'. */
  rowClass?: string;
  /** Extra class on the value span, e.g. 'discount'. Defaults to 'summary-value' when unset. */
  valueClass?: string;
  shimmer?: boolean;
}

/**
 * Shared booking/order summary card (extracted from the booking page; also
 * used by order-edit and by booking's mobile summary).
 *
 * Data-driven rows: parents build `details` and `priceLines` from their own
 * state, so all business logic stays in the parents. Page-specific blocks are
 * projected: `[summary-top]` (booking promo input), `[summary-mid]`
 * (order-edit original-total/diff block, rendered after the breakdown) and
 * `[summary-footer]` (booking next-order subscription info, after the total).
 * Projected blocks keep the parent's style scope — their styles stay in the
 * parent stylesheets.
 *
 * The parent owns the collapsed state (it also hides its projected blocks
 * with it); the card renders the toggle button and emits `toggleCollapsed`.
 */
@Component({
  selector: 'app-order-summary-card',
  standalone: true,
  imports: [CommonModule, ShimmerDirective],
  templateUrl: './order-summary-card.component.html',
  styleUrls: ['./order-summary-card.component.scss']
})
export class OrderSummaryCardComponent {
  /** Card heading; empty string renders no h3 (booking's mobile card). */
  @Input() title = '';
  /** 'mobile' renders booking's .summary-card-mobile look (no toggle). */
  @Input() variant: 'desktop' | 'mobile' = 'desktop';
  @Input() collapsed = false;
  @Input() showToggle = true;
  @Input() showSavingsBanner = false;
  @Input() details: SummaryLine[] = [];
  @Input() priceLines: SummaryLine[] = [];
  @Input() totalLabel = 'Total:';
  @Input() totalValue = '';
  @Input() totalShimmer = false;
  /** Bubble-points earn preview; hidden when null. */
  @Input() estimatedPoints: string | null = null;

  @Output() toggleCollapsed = new EventEmitter<void>();
}
