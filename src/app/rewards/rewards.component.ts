import { Component, OnInit, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
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
  imports: [CommonModule, RouterModule],
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

  copySuccess = false;
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

  copyReferralLink(): void {
    if (!this.summary?.shareUrl) return;
    navigator.clipboard.writeText(this.summary.shareUrl).then(() => {
      this.copySuccess = true;
      setTimeout(() => this.copySuccess = false, 2000);
    });
  }

  shareReferralLink(): void {
    if (!this.summary) return;
    if (navigator.share) {
      navigator.share({
        title: 'Dream Cleaning — Bubble Rewards',
        text: 'Get a bonus when you book your first cleaning with Dream Cleaning!',
        url: this.summary.shareUrl
      });
    } else {
      this.copyReferralLink();
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
