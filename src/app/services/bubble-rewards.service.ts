import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface HeaderSummary {
  points: number;
  tier: string;
  tierEmoji: string;
  credits: number;
  pointsSystemEnabled: boolean;
  tierProgressPercent: number;
  nextTierName: string | null;
}

export interface RedemptionOption {
  points: number;
  dollarValue: number;
  available: boolean;
}

export interface RewardsGuide {
  pointsPerDollar: number;
  bubbleMultiplier: number;
  superBubbleMultiplier: number;
  ultraBubbleMultiplier: number;
  tierSuperBubbleMinSpent: number;
  tierUltraBubbleMinSpent: number;
  welcomeBonusEnabled: boolean;
  welcomeBonusPoints: number;
  recurringBonusEnabled: boolean;
  recurringBonusPercent: number;
  nextOrderBoosterEnabled: boolean;
  nextOrderBoosterDays: number;
  nextOrderBoosterPercent: number;
  streakEnabled: boolean;
  streak3Bonus: number;
  streak6Bonus: number;
  reviewBonusEnabled: boolean;
  reviewBonusPoints: number;
  referralEnabled: boolean;
  referralRegistrationBonusEnabled: boolean;
  referralRegistrationBonusPoints: number;
  referralNewUserBonusEnabled: boolean;
  referralNewUserBonusPoints: number;
  referralOrderCreditAmount: number;
}

export interface RewardsSummary {
  currentPoints: number;
  bubbleCredits: number;
  tier: string;
  tierEmoji: string;
  tierProgressPercent: number;
  nextTierName: string | null;
  amountToNextTier: number;
  totalSpentAmount: number;
  availableRedemptions: RedemptionOption[];
  streakCount: number;
  referralCode: string;
  shareUrl: string;
  totalEarned: number;
  totalRedeemed: number;
  pointsSystemEnabled: boolean;
  referralRegistrationBonusEnabled: boolean;
  guide: RewardsGuide;
}

export interface PointsHistory {
  id: number;
  points: number;
  type: string;
  description: string | null;
  orderId: number | null;
  createdAt: string;
}

export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RedemptionResult {
  success: boolean;
  message: string;
  creditApplied: number;
  remainingPoints: number;
}

export interface ReferralCode {
  code: string;
  shareUrl: string;
}

export interface Referral {
  id: number;
  referredUserId: number;
  referredUserName: string;
  referredUserEmail: string;
  status: string;
  registrationBonusGiven: boolean;
  orderBonusGiven: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface EligibleReferral {
  id: number;
  email: string;
  name: string;
}

export interface ReferralValidation {
  valid: boolean;
  referrerName: string | null;
  message: string | null;
}

export interface RewardsSettings {
  id: number;
  settingKey: string;
  settingValue: string;
  description: string | null;
  category: string;
}

export interface RewardsStats {
  totalPointsIssued: number;
  totalPointsRedeemed: number;
  totalCreditsIssued: number;
  activeUsersWithPoints: number;
  bubbleTierCount: number;
  superBubbleTierCount: number;
  ultraBubbleTierCount: number;
  totalReferrals: number;
  completedReferrals: number;
}

@Injectable({
  providedIn: 'root'
})
export class BubbleRewardsService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ─── Client Endpoints ────────────────────────────────────────────────────────

  getHeaderSummary(): Observable<HeaderSummary> {
    return this.http.get<HeaderSummary>(`${this.apiUrl}/bubble-points/header-summary`);
  }

  getSummary(): Observable<RewardsSummary> {
    return this.http.get<RewardsSummary>(`${this.apiUrl}/bubble-points/summary`);
  }

  getHistory(page = 1, pageSize = 20): Observable<PagedResult<PointsHistory>> {
    return this.http.get<PagedResult<PointsHistory>>(
      `${this.apiUrl}/bubble-points/history?page=${page}&pageSize=${pageSize}`
    );
  }

  redeemPoints(points: number, orderId: number): Observable<RedemptionResult> {
    return this.http.post<RedemptionResult>(`${this.apiUrl}/bubble-points/redeem`, { points, orderId });
  }

  // ─── Referral Endpoints ──────────────────────────────────────────────────────

  getMyReferralCode(): Observable<ReferralCode> {
    return this.http.get<ReferralCode>(`${this.apiUrl}/referral/my-code`);
  }

  getMyReferrals(): Observable<Referral[]> {
    return this.http.get<Referral[]>(`${this.apiUrl}/referral/my-referrals`);
  }

  validateReferralCode(code: string): Observable<ReferralValidation> {
    return this.http.post<ReferralValidation>(`${this.apiUrl}/referral/validate`, { code });
  }

  // ─── Admin Endpoints ─────────────────────────────────────────────────────────

  getAdminSettings(): Observable<RewardsSettings[]> {
    return this.http.get<RewardsSettings[]>(`${this.apiUrl}/admin/rewards/settings`);
  }

  updateAdminSetting(key: string, value: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/admin/rewards/settings/${key}`, { value });
  }

  bulkUpdateSettings(updates: { key: string; value: string }[]): Observable<any> {
    return this.http.put(`${this.apiUrl}/admin/rewards/settings/bulk`, updates);
  }

  getAdminUserSummary(userId: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/admin/rewards/users/${userId}/summary`);
  }

  adjustUserPoints(userId: number, points: number, description: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/admin/rewards/users/${userId}/adjust-points`, { points, description });
  }

  grantReviewBonus(userId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/admin/rewards/users/${userId}/grant-review-bonus`, {});
  }

  grantCredit(userId: number, amount: number, description: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/admin/rewards/users/${userId}/grant-credit`, { amount, description });
  }

  searchEligibleReferrals(userId: number, query: string): Observable<EligibleReferral[]> {
    return this.http.get<EligibleReferral[]>(`${this.apiUrl}/admin/rewards/users/${userId}/eligible-referrals?query=${encodeURIComponent(query)}`);
  }

  removeReferredUser(userId: number, referralId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/admin/rewards/users/${userId}/referrals/${referralId}`);
  }

  removeReferredBy(userId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/admin/rewards/users/${userId}/referred-by`);
  }

  addReferredUser(userId: number, email: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/admin/rewards/users/${userId}/referrals`, { email });
  }

  getAdminReferrals(page = 1, pageSize = 50, status?: string): Observable<any> {
    let url = `${this.apiUrl}/admin/rewards/referrals?page=${page}&pageSize=${pageSize}`;
    if (status) url += `&status=${status}`;
    return this.http.get(url);
  }

  getRewardsStats(): Observable<RewardsStats> {
    return this.http.get<RewardsStats>(`${this.apiUrl}/admin/rewards/stats`);
  }

  resetBubblePoints(userId?: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/admin/rewards/reset`, { userId: userId ?? null });
  }
}
