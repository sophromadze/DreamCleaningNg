import { Component, EventEmitter, Input, Output } from '@angular/core';

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
  styleUrls: ['./quantity-control.component.scss']
})
export class QuantityControlComponent {
  /** Already-formatted display text (e.g. 'Studio', 2, 1.5). */
  @Input() value: string | number | null = null;
  @Input() decrementDisabled = false;
  @Input() incrementDisabled = false;
  @Input() variant: 'plain' | 'extra' = 'plain';
  /** Emits the click event so call sites can keep e.g. $event.stopPropagation(). */
  @Output() decrement = new EventEmitter<MouseEvent>();
  @Output() increment = new EventEmitter<MouseEvent>();
}
