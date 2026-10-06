import { Component, ChangeDetectionStrategy, output, input } from '@angular/core';
import { ShimmerDirective } from '../../directives/shimmer.directive';
import { IconComponent } from '../../icons/icon.component';
import { faReceipt } from '../../icons/glyphs/faReceipt';
import { faTag } from '../../icons/glyphs/faTag';

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
  imports: [ShimmerDirective, IconComponent],
  templateUrl: './order-summary-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./order-summary-card.component.scss']
})
export class OrderSummaryCardComponent {
  protected readonly icons = { faReceipt, faTag };

  /** Card heading; empty string renders no h3 (booking's mobile card). */
  readonly title = input('');
  /** 'mobile' renders booking's .summary-card-mobile look (no toggle). */
  readonly variant = input<'desktop' | 'mobile'>('desktop');
  readonly collapsed = input(false);
  readonly showToggle = input(true);
  readonly showSavingsBanner = input(false);
  readonly details = input<SummaryLine[]>([]);
  readonly priceLines = input<SummaryLine[]>([]);
  readonly totalLabel = input('Total:');
  readonly totalValue = input('');
  readonly totalShimmer = input(false);
  /** Bubble-points earn preview; hidden when null. */
  readonly estimatedPoints = input<string | null>(null);

  readonly toggleCollapsed = output<void>();

  /** Tapping anywhere on the total section toggles the summary (mobile). The
   * toggle button stops propagation so it doesn't double-fire. No-op when the
   * card isn't collapsible (e.g. the always-expanded mobile inline variant). */
  onTotalSectionClick(): void {
    if (this.showToggle()) {
      this.toggleCollapsed.emit();
    }
  }
}
