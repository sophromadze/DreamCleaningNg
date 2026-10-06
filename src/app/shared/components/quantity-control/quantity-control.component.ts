import { Component, ChangeDetectionStrategy, output, input } from '@angular/core';

/**
 * Shared +/− stepper (extracted from the booking page; also used by order-edit).
 *
 * The parent keeps the original wrapper class on the host element
 * (`class="quantity-control"` or `class="hours-control"`) so the host-level
 * layout rules that remain in booking.component.scss keep applying. Everything
 * inside `.control-buttons` is styled by this component's stylesheet.
 *
 * Two visual variants:
 *  - 'plain' (default): blue pill used for bedrooms/bathrooms/service rows.
 *  - 'extra': green pill used inside the `.extra-controls` panel under a
 *    selected extra-service card.
 */
@Component({
  selector: 'app-quantity-control',
  standalone: true,
  templateUrl: './quantity-control.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./quantity-control.component.scss']
})
export class QuantityControlComponent {
  /** Already-formatted display text (e.g. 'Studio', 2, 1.5). */
  readonly value = input<string | number | null>(null);
  readonly decrementDisabled = input(false);
  readonly incrementDisabled = input(false);
  readonly variant = input<'plain' | 'extra'>('plain');
  /** What the stepper changes (e.g. 'bedrooms'); names the icon-only buttons "Decrease bedrooms" / "Increase bedrooms". */
  readonly label = input('');
  /** Emits the click event so call sites can keep e.g. $event.stopPropagation(). */
  readonly decrement = output<MouseEvent>();
  readonly increment = output<MouseEvent>();
}
