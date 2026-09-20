import {
  AfterViewChecked, Component, ElementRef, EventEmitter, Input, Output, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * "Save your card for faster checkout?" — asked BETWEEN the Pay click and the charge (2026-09).
 *
 * ══ WHY IT SITS HERE AND NOT ON THE SUCCESS PAGE ══
 *
 * Stripe cannot attach a card to a customer retroactively, so the old post-payment prompt had to
 * ask for the card details a second time — most people never did. Asked before the charge, the
 * customer's answer is applied to the SAME PaymentIntent (setup_future_usage at confirmation), so
 * saving costs them nothing extra and creates no second payment.
 *
 * ══ WHAT THIS COMPONENT DOES AND DOES NOT DO ══
 *
 * It answers ONE question and owns no payment logic: it emits `choose(true|false)` and the host
 * performs exactly one payment. Dismissing (✕, Escape, backdrop) emits `dismissed` and starts
 * NOTHING — the customer is back on their payment form with everything they typed, free to press
 * Pay again. Both buttons say they pay, because both of them do.
 */
@Component({
  selector: 'app-save-card-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './save-card-modal.component.html',
  styleUrls: ['./save-card-modal.component.scss']
})
export class SaveCardModalComponent implements AfterViewChecked {
  /** The host opens it on the Pay click; it never opens itself. */
  @Input() open = false;

  /** The host is paying (or preparing to). Both buttons lock — one click, one payment. */
  @Input() busy = false;

  /** What is about to be charged, for the button label. Optional. */
  @Input() amountLabel: string | null = null;

  /** true = "Save Card & Pay", false = "Pay Without Saving". Emitted at most once per opening. */
  @Output() choose = new EventEmitter<boolean>();

  /** Closed without choosing. Nothing has been prepared, charged or saved. */
  @Output() dismissed = new EventEmitter<void>();

  @ViewChild('primaryBtn') private primaryBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('dialog') private dialog?: ElementRef<HTMLElement>;

  /** Guards the double-click: the host's own `busy` arrives one tick later. */
  private answered = false;
  private focused = false;

  ngAfterViewChecked(): void {
    if (this.open && !this.focused && this.primaryBtn) {
      this.primaryBtn.nativeElement.focus();
      this.focused = true;
    }
    if (!this.open) {
      this.focused = false;
      this.answered = false;
    }
  }

  decide(save: boolean): void {
    if (this.answered || this.busy) return;
    this.answered = true;
    this.choose.emit(save);
  }

  dismiss(): void {
    if (this.busy) return;   // a payment is already under way: closing must not abandon it
    this.answered = false;
    this.dismissed.emit();
  }

  /** Escape closes; Tab is kept inside the dialog while it is open. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.dismiss();
      return;
    }
    if (event.key !== 'Tab' || !this.dialog) return;

    const focusable = Array.from(
      this.dialog.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled])')
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
