import { Component, PLATFORM_ID, ChangeDetectionStrategy, effect, inject, output, signal, untracked } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import type { HeaderSummary } from '../../services/bubble-rewards.service';
import { AccountStatusService } from '../../services/account-status.service';

@Component({
  selector: 'app-bubble-badge',
  imports: [CommonModule, RouterModule],
  templateUrl: './bubble-badge.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bubble-badge.component.scss'
})
export class BubbleBadgeComponent {
  /** The header summary is loaded once per page load and shared (AccountStatusService). */
  private accountStatus = inject(AccountStatusService);
  private router = inject(Router);
  private platformId = inject<Object>(PLATFORM_ID);

  readonly summary = this.accountStatus.headerSummary;
  /**
   * Whether the points system is on for this account, reported after each load so the header can
   * drop the slot (and remember the answer for the next server render) when it is off.
   */
  readonly availability = output<boolean>();
  /**
   * Stands in for the summary until it loads (and on the server): the badge is drawn from it in
   * full - visible - with an empty number slot, so the balance arriving fills reserved space
   * instead of pushing the nav. Never user data: the server renders it for any signed-in hint.
   * A five-digit balance still fits the pill's 120px minimum width.
   */
  readonly placeholder: HeaderSummary = {
    points: 0, tier: 'Bubble', tierEmoji: '', credits: 0, pointsSystemEnabled: true,
    tierProgressPercent: 0, nextTierName: null
  };
  readonly showTooltip = signal(false);
  isBrowser: boolean;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    // Tell the header, once per answer, whether the points system is on for this account (a
    // failed load counts as off: the reserved slot is given back rather than left as a gap).
    effect(() => {
      const state = this.accountStatus.headerSummaryState();
      if (state === 'unknown') return;
      const data = this.accountStatus.headerSummary();
      untracked(() => this.availability.emit(state === 'ok' && !!data?.pointsSystemEnabled));
    });
  }

  goToRewards(): void {
    this.router.navigate(['/rewards']);
  }
}
