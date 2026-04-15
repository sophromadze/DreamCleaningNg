import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ShimmerDirective } from '../shared/directives/shimmer.directive';
import {
  BubbleRewardsService,
  RewardsSummary,
  PointsHistory,
  PagedResult,
  Referral
} from '../services/bubble-rewards.service';

@Component({
  selector: 'app-rewards',
  standalone: true,
  imports: [CommonModule, RouterModule, ShimmerDirective],
  templateUrl: './rewards.component.html',
  styleUrl: './rewards.component.scss'
})
export class RewardsComponent implements OnInit {
  summary: RewardsSummary | null = null;
  summaryLoading = true;

  history: PointsHistory[] = [];
  historyPage = 1;
  historyTotalPages = 1;
  historyLoading = false;

  referrals: Referral[] = [];
  referralsLoading = false;

  /** Which control just copied: 'link' | 'code' — for button feedback */
  copyFeedback: 'link' | 'code' | null = null;
  isBrowser: boolean;

  constructor(
    private svc: BubbleRewardsService,
    private router: Router,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.loadSummary();
    this.loadHistory();
    this.loadReferrals();
  }

  loadSummary(): void {
    this.summaryLoading = true;
    this.svc.getSummary().subscribe({
      next: s => { this.summary = s; this.summaryLoading = false; },
      error: () => { this.summaryLoading = false; }
    });
  }

  loadHistory(page = 1): void {
    this.historyLoading = true;
    this.svc.getHistory(page, 15).subscribe({
      next: (r: PagedResult<PointsHistory>) => {
        this.history = r.items;
        this.historyPage = r.page;
        this.historyTotalPages = r.totalPages;
        this.historyLoading = false;
      },
      error: () => { this.historyLoading = false; }
    });
  }

  loadReferrals(): void {
    this.referralsLoading = true;
    this.svc.getMyReferrals().subscribe({
      next: r => { this.referrals = r; this.referralsLoading = false; },
      error: () => { this.referralsLoading = false; }
    });
  }

  /** Full invite URL; uses API value when it is absolute, otherwise current origin (fixes local dev). */
  getReferralShareUrl(): string {
    const code = this.summary?.referralCode?.trim();
    if (!code) return '';
    const fromApi = this.summary?.shareUrl?.trim() ?? '';
    if (/^https?:\/\//i.test(fromApi)) {
      return fromApi;
    }
    if (this.isBrowser && typeof window !== 'undefined') {
      return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
    }
    return fromApi;
  }

  copyReferralLink(): void {
    const url = this.getReferralShareUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      this.copyFeedback = 'link';
      setTimeout(() => (this.copyFeedback = null), 2000);
    });
  }

  copyReferralCode(): void {
    const code = this.summary?.referralCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.copyFeedback = 'code';
      setTimeout(() => (this.copyFeedback = null), 2000);
    });
  }

  shareReferralLink(): void {
    if (!this.summary) return;
    const url = this.getReferralShareUrl();
    if (!url) return;
    if (navigator.share) {
      navigator.share({
        title: 'Dream Cleaning — Bubble Rewards',
        text: 'Get a bonus when you book your first cleaning with Dream Cleaning!',
        url
      });
    } else {
      this.copyReferralLink();
    }
  }

  shareReferralCode(): void {
    const code = this.summary?.referralCode;
    if (!code) return;
    if (navigator.share) {
      navigator.share({ text: code });
    } else {
      this.copyReferralCode();
    }
  }

  getTierLabel(tier: string): string {
    if (tier === 'UltraBubble') return 'Ultra Bubble';
    if (tier === 'SuperBubble') return 'Super Bubble';
    return 'Bubble';
  }

  getTierColor(tier: string): string {
    if (tier === 'UltraBubble') return '#ffc107';
    if (tier === 'SuperBubble') return '#9ea8df';
    return '#007bff';
  }

  getHistoryTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      OrderCompletion:            'Order Completed',
      OrderEarned:                'Order Earned',
      WelcomeBonus:               'Welcome Bonus',
      ReferralBonus:              'Referral Bonus',
      ReferralRegistrationBonus:  'Referral Signup',
      ReferralNewUserBonus:       'Referral signup bonus',
      ReferralOrderCompleted:     'Referral Reward',
      RecurringBonus:             'Recurring Bonus',
      NextOrderBooster:           'Loyalty Booster',
      StreakBonus:                'Streak Bonus',
      ReviewBonus:                'Review Bonus',
      AdminAdjustment:            'Admin Adjustment',
      Redemption:                 'Redeemed',
      Redeemed:                   'Redeemed',
    };
    return labels[type] ?? type.replace(/([A-Z])/g, ' $1').trim();
  }

  getReferralDollarValue(item: PointsHistory): number | null {
    if (item.type !== 'ReferralOrderCompleted') return null;
    // Description format: "$20 reward — Name completed their first order!"
    const match = item.description?.match(/\$(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
  }

  getHistoryPointsDisplay(item: PointsHistory): string {
    if (item.type === 'ReferralOrderCompleted') {
      const dollars = this.getReferralDollarValue(item);
      return dollars != null ? `+$${dollars.toFixed(0)}` : '+$0';
    }
    if (item.points === 0) return '—';
    return (item.points > 0 ? '+' : '') + item.points.toLocaleString();
  }

  goToOrder(item: PointsHistory): void {
    if (item.orderId) this.router.navigate(['/order', item.orderId]);
  }

  prevHistoryPage(): void {
    if (this.historyPage > 1) this.loadHistory(this.historyPage - 1);
  }

  nextHistoryPage(): void {
    if (this.historyPage < this.historyTotalPages) this.loadHistory(this.historyPage + 1);
  }
}
