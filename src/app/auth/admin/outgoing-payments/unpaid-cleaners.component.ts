import {
  ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, effect, inject, input, output, signal, untracked
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs/operators';

import {
  OutgoingPaymentService, PayCleanersResult, UnpaidCleaner, UnpaidCleanerLine, UnpaidCleanersList
} from '../../../services/outgoing-payment.service';
import {
  CleanerPaymentMethod, CLEANER_PAYMENT_METHOD_INDEX, normalizeCleanerPaymentMethod
} from '../../../services/cleaner-management.service';
import { resolveServiceTypeShortLabel } from '../../../shared/admin/service-type-short-label';
import { DurationUtils } from '../../../utils/duration.utils';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

/** Today in New York as YYYY-MM-DD — the day a payment is recorded against. */
export function todayInNewYork(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

/**
 * Outgoing Payments → Unpaid cleaners (2026-10).
 *
 * Every cleaner owed money right now, with the amount and the lines behind it. The page's month bar
 * narrows it to the jobs serviced that month (`from`/`to`); "All months" sends neither, because
 * money owed for a March job is still owed in October. A name box filters the list as you type.
 * Several or all can be selected and paid in one action; the grand total follows the selection live.
 *
 * Every figure comes from the server (the payroll calculator); this component sums nothing it
 * then sends. The pay request carries the lines AND the amounts the confirmation showed, and the
 * server refuses the whole request if any of them moved in the meantime — a second admin, or an
 * hours edit — so a stale screen can never pay a line twice.
 */
@Component({
  selector: 'app-unpaid-cleaners',
  imports: [FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './unpaid-cleaners.component.html',
  styleUrl: './cleaner-payouts.shared.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UnpaidCleanersComponent {
  private service = inject(OutgoingPaymentService);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);

  /** The period on screen, as yyyy-MM-dd service dates. Both null = every finished order. */
  readonly from = input<string | null>(null);
  readonly to = input<string | null>(null);

  /** Emitted after money is recorded, so the Orders view and the badges reload. */
  readonly paid = output<PayCleanersResult>();

  readonly data = signal<UnpaidCleanersList | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  /** "Irma Xar" — every word must appear in the cleaner's first or last name. */
  readonly nameFilter = signal('');

  /** The cleaner whose payment details were just copied, so the button can confirm it. */
  readonly copiedCleanerId = signal<number | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly selected = signal<ReadonlySet<number>>(new Set());
  readonly expanded = signal<ReadonlySet<number>>(new Set());

  // The confirmation
  readonly confirming = signal(false);
  readonly paidOn = signal(todayInNewYork());
  readonly paidVia = signal<CleanerPaymentMethod | ''>('');
  readonly reference = signal('');
  readonly note = signal('');
  readonly paying = signal(false);
  private idempotencyKey = '';

  readonly maxPaidOn = todayInNewYork();

  readonly methodOptions: { value: CleanerPaymentMethod | ''; label: string }[] = [
    { value: '', label: "Cleaner's saved method" },
    { value: 'Zelle', label: 'Zelle' },
    { value: 'Cash', label: 'Cash' },
    { value: 'Check', label: 'Check' },
    { value: 'Other', label: 'Other' }
  ];

  /** Everyone owed in the period, before the name filter. */
  readonly allCleaners = computed(() => this.data()?.cleaners ?? []);

  /** The cleaners on screen. Select all, the totals and the payment act on these only. */
  readonly cleaners = computed(() => {
    const words = this.nameFilter().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.allCleaners();
    return this.allCleaners().filter(c => {
      const name = `${c.firstName} ${c.lastName}`.toLowerCase();
      return words.every(w => name.includes(w));
    });
  });

  /** A cleaner ticked and then filtered out of sight is not paid — nobody can see them. */
  readonly selectedCleaners = computed(() =>
    this.cleaners().filter(c => this.selected().has(c.cleanerId)));

  /** What the cleaners on screen are owed — the whole period's total when nothing is filtered. */
  readonly visibleTotal = computed(() =>
    Math.round(this.cleaners().reduce((sum, c) => sum + Math.round(c.totalOutstanding * 100), 0)) / 100);

  /** The grand total of the selection, in whole cents so it cannot drift. */
  readonly selectedTotal = computed(() =>
    Math.round(this.selectedCleaners().reduce((sum, c) => sum + Math.round(c.totalOutstanding * 100), 0)) / 100);

  readonly allSelected = computed(() =>
    this.cleaners().length > 0 && this.selectedCleaners().length === this.cleaners().length);

  readonly someSelected = computed(() => this.selectedCleaners().length > 0 && !this.allSelected());

  constructor() {
    // Loads on entry and again whenever the month bar moves.
    effect(() => {
      this.from();
      this.to();
      untracked(() => this.load());
    });
    this.destroyRef.onDestroy(() => {
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
    });
  }

  /** keepMessage: a reload after a refused payment must not wipe the reason it was refused. */
  load(keepMessage = false): void {
    this.loading.set(true);
    if (!keepMessage) this.error.set('');
    this.service.getUnpaidCleaners(this.from(), this.to())
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => {
          this.data.set(data);
          // A cleaner paid elsewhere in the meantime drops out of the selection with the list.
          const present = new Set(data.cleaners.map(c => c.cleanerId));
          this.selected.set(new Set([...this.selected()].filter(id => present.has(id))));
        },
        error: err => this.error.set(extractApiErrorMessage(err, 'Could not load the cleaners who are owed.'))
      });
  }

  // ── Selection ──

  isSelected(cleaner: UnpaidCleaner): boolean {
    return this.selected().has(cleaner.cleanerId);
  }

  toggle(cleaner: UnpaidCleaner, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) next.add(cleaner.cleanerId);
    else next.delete(cleaner.cleanerId);
    this.selected.set(next);
  }

  /** Ticks or clears the cleaners on screen; anyone hidden by the name filter keeps their tick. */
  toggleAll(checked: boolean): void {
    const next = new Set(this.selected());
    for (const c of this.cleaners()) {
      if (checked) next.add(c.cleanerId);
      else next.delete(c.cleanerId);
    }
    this.selected.set(next);
  }

  isExpanded(cleaner: UnpaidCleaner): boolean {
    return this.expanded().has(cleaner.cleanerId);
  }

  toggleExpanded(cleaner: UnpaidCleaner): void {
    const next = new Set(this.expanded());
    if (next.has(cleaner.cleanerId)) next.delete(cleaner.cleanerId);
    else next.add(cleaner.cleanerId);
    this.expanded.set(next);
  }

  // ── Paying ──

  openConfirm(): void {
    if (!this.selectedCleaners().length) return;
    this.paidOn.set(todayInNewYork());
    this.paidVia.set('');
    this.reference.set('');
    this.note.set('');
    // One key per confirmation: a double click or a retried request records the money once.
    this.idempotencyKey = newIdempotencyKey();
    this.success.set('');
    this.error.set('');
    this.confirming.set(true);
  }

  cancelConfirm(): void {
    this.confirming.set(false);
  }

  confirmPay(): void {
    const cleaners = this.selectedCleaners();
    if (!cleaners.length || this.paying()) return;

    this.paying.set(true);
    this.error.set('');

    const via = this.paidVia();
    this.service.payCleaners({
      cleaners: cleaners.map(c => ({
        cleanerId: c.cleanerId,
        lines: c.lines.map(l => ({ orderCleanerId: l.orderCleanerId, amount: l.outstanding }))
      })),
      paidOn: this.paidOn() || null,
      paidVia: via ? CLEANER_PAYMENT_METHOD_INDEX[via] : null,
      reference: this.reference().trim() || null,
      note: this.note().trim() || null,
      idempotencyKey: this.idempotencyKey
    })
      .pipe(finalize(() => this.paying.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.confirming.set(false);
          this.selected.set(new Set());
          this.success.set(result.alreadyRecorded
            ? 'This payment had already been recorded — nothing was paid twice.'
            : `Recorded ${this.formatMoney(result.totalPaid)} paid to ${result.cleanerCount} `
              + `cleaner${result.cleanerCount === 1 ? '' : 's'}. It is under Paid cleaners.`);
          this.paid.emit(result);
          this.load(true);
        },
        error: (err: HttpErrorResponse) => {
          // 409: something moved since the list was read. Nothing was paid; show the fresh list.
          this.error.set(extractApiErrorMessage(err, 'Could not record the payment.'));
          if (err.status === 409) {
            this.confirming.set(false);
            this.load(true);
          }
        }
      });
  }

  // ── Display ──

  cleanerName(cleaner: UnpaidCleaner): string {
    return `${cleaner.firstName} ${cleaner.lastName}`.trim();
  }

  methodLabel(cleaner: UnpaidCleaner): string {
    return normalizeCleanerPaymentMethod(cleaner.paymentMethod) ?? '';
  }

  paymentDetails(cleaner: UnpaidCleaner): string {
    return cleaner.paymentDetails?.trim() ?? '';
  }

  isCopied(cleaner: UnpaidCleaner): boolean {
    return this.copiedCleanerId() === cleaner.cleanerId;
  }

  /**
   * Copies the payment details ALONE — "Zelle · " in front of a phone number would make the paste
   * useless in a banking app. Same mechanism as the Orders view's panel: the clipboard API, with
   * the execCommand fallback for a non-secure context.
   */
  copyPaymentDetails(cleaner: UnpaidCleaner): void {
    const text = this.paymentDetails(cleaner);
    if (!text || !isPlatformBrowser(this.platformId)) return;

    const confirmCopied = () => {
      this.copiedCleanerId.set(cleaner.cleanerId);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copiedCleanerId.set(null), 1800);
    };
    const fallback = () => {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        if (ok) confirmCopied();
        else this.error.set('Could not copy that — select it and copy by hand.');
      } catch {
        this.error.set('Could not copy that — select it and copy by hand.');
      }
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(confirmCopied, fallback);
    } else {
      fallback();
    }
  }

  paymentSummary(cleaner: UnpaidCleaner): string {
    const method = normalizeCleanerPaymentMethod(cleaner.paymentMethod);
    const details = cleaner.paymentDetails?.trim();
    if (!method && !details) return 'No payment method on file';
    return [method, details].filter(Boolean).join(' · ');
  }

  serviceTypeShort(line: UnpaidCleanerLine): string {
    return resolveServiceTypeShortLabel({
      serviceTypeName: line.rawServiceTypeName,
      isCustomServiceType: line.isCustomServiceType,
      customServiceDisplayName: line.customServiceDisplayName,
      isDeepCleaning: line.isDeepCleaning
    });
  }

  hours(line: UnpaidCleanerLine): string {
    return DurationUtils.formatMinutes(line.billableMinutes);
  }

  private formatMoney(value: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  }
}

/** A one-time key for a confirmation. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
