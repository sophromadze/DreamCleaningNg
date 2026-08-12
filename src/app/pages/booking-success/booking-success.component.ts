import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { OrderService, Order } from '../../services/order.service';
import { AuthService } from '../../services/auth.service';
import { BubbleRewardsService } from '../../services/bubble-rewards.service';
import { AnalyticsService, AnalyticsUserData } from '../../services/analytics.service';

@Component({
  selector: 'app-booking-success',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './booking-success.component.html',
  styleUrls: ['./booking-success.component.scss']
})
export class BookingSuccessComponent implements OnInit, OnDestroy {
  orderId: string = '';
  order: Order | null = null;
  hasCleaningSupplies = false;
  isDeepCleaning = false;
  isCustomServiceType = false;
  suppliesLoaded = false;

  // Bubble points earn preview
  bubblePointsEnabled = false;
  estimatedPoints = 0;

  // OTP verification step
  step: 'success' | 'verify-otp' = 'success';
  otpCode = '';
  otpError = '';
  otpLoading = false;
  sendingOtp = false;
  resendCooldown = 0;
  private resendTimer: any;
  loginEmail = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private orderService: OrderService,
    private authService: AuthService,
    private bubbleRewardsService: BubbleRewardsService,
    private analytics: AnalyticsService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit() {
    this.orderId = this.route.snapshot.paramMap.get('orderId') ?? '';

    if (isPlatformBrowser(this.platformId)) {
      const state = (history.state as any) ?? {};
      this.loginEmail = state.contactEmail
        ?? this.authService.currentUserValue?.email
        ?? '';

      const id = Number(this.orderId);
      if (!Number.isNaN(id)) {
        this.orderService.getOrderById(id).subscribe({
          next: (order) => {
            this.order = order;
            const extras = order.extraServices ?? [];

            this.hasCleaningSupplies = extras.some(es =>
              (es.extraServiceName ?? '').toLowerCase().includes('cleaning supplies')
            );

            const deepCleaning = extras.find(s =>
              (s.extraServiceName ?? '').toLowerCase().includes('deep cleaning') &&
              !(s.extraServiceName ?? '').toLowerCase().includes('super')
            );
            const superDeepCleaning = extras.find(s =>
              (s.extraServiceName ?? '').toLowerCase().includes('super deep cleaning')
            );
            this.isDeepCleaning = !!deepCleaning || !!superDeepCleaning;
            this.isCustomServiceType = this.isCustomServiceTypeOrder(order);
            this.suppliesLoaded = true;
            this.loadEstimatedPoints(order);
            this.trackPurchaseConversion(order);
          },
          error: () => {
            this.suppliesLoaded = true; // fall back to default checklist
          }
        });
      } else {
        this.suppliesLoaded = true;
      }
    }
  }

  ngOnDestroy() {
    if (this.resendTimer) clearInterval(this.resendTimer);
  }

  viewOrderNow() {
    const user = this.authService.currentUserValue;
    if (user) {
      const isSocialUser = user.authProvider === 'Google' || user.authProvider === 'Apple';
      const isVerified = user.isEmailVerified === true;
      if (user.hasPassword || isSocialUser || isVerified) {
        // Established or social user: go straight to the order
        this.router.navigate(['/order', this.orderId]);
        return;
      }
    }
    // Auto-registered guest (no password, no social, unverified): verify email then set password
    if (!this.loginEmail && user) {
      this.loginEmail = user.email;
    }
    this.sendOtp();
  }

  private sendOtp() {
    if (!this.loginEmail) return;
    this.sendingOtp = true;
    this.otpError = '';

    this.authService.sendLoginOtp(this.loginEmail).subscribe({
      next: () => {
        this.sendingOtp = false;
        this.step = 'verify-otp';
        this.startResendCooldown();
      },
      error: (err) => {
        this.sendingOtp = false;
        this.otpError = err.error?.message || 'Failed to send verification code. Please try again.';
      }
    });
  }

  resendOtp() {
    if (this.resendCooldown > 0) return;
    this.otpCode = '';
    this.otpError = '';
    this.sendOtp();
  }

  submitOtp() {
    if (!this.otpCode || this.otpCode.length !== 6) return;
    this.otpLoading = true;
    this.otpError = '';

    this.authService.verifyLoginOtp(this.loginEmail, this.otpCode).subscribe({
      next: () => {
        this.otpLoading = false;
        // Store the order URL so set-password can redirect back after completion
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem('postSetPasswordUrl', `/order/${this.orderId}`);
        }
        this.router.navigate(['/set-password']);
      },
      error: (err) => {
        this.otpLoading = false;
        this.otpError = err.error?.message || 'Invalid code. Please try again.';
      }
    });
  }

  private startResendCooldown(seconds = 60) {
    this.resendCooldown = seconds;
    this.resendTimer = setInterval(() => {
      this.resendCooldown--;
      if (this.resendCooldown <= 0) {
        clearInterval(this.resendTimer);
        this.resendCooldown = 0;
      }
    }, 1000);
  }

  private loadEstimatedPoints(order: Order): void {
    this.bubbleRewardsService.getSummary().subscribe({
      next: (summary) => {
        if (!summary?.pointsSystemEnabled) return;
        const pointsPerDollar = summary.guide?.pointsPerDollar ?? 0;
        if (pointsPerDollar <= 0) return;
        const base = (order.total ?? 0) - (order.tax ?? 0) - (order.tips ?? 0) - (order.companyDevelopmentTips ?? 0);
        const points = Math.floor(Math.max(0, base) * pointsPerDollar);
        if (points > 0) {
          this.bubblePointsEnabled = true;
          this.estimatedPoints = points;
        }
      },
      error: () => {}
    });
  }

  private isCustomServiceTypeOrder(order: Order): boolean {
    const services = order.services ?? [];
    const hasCustomServiceMarker = services.some(s => Number(s?.serviceId) === 0);
    const hasNoRegularServices = services.length === 0 || (services.length === 1 && Number(services[0]?.serviceId) === 0);
    return hasCustomServiceMarker || hasNoRegularServices;
  }

  /**
   * Push the GA4 / Google Ads purchase conversion to the GTM dataLayer, including Enhanced
   * Conversions user data. The GTM tags own the actual send.
   *
   * `transaction_id` lets Google drop a duplicate if the same order is somehow reported
   * twice; the sessionStorage guard below stops us reporting it twice in the first place.
   */
  private trackPurchaseConversion(order: Order): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!order || !order.id) return;

    const dedupeKey = `booking_conversion_fired_${order.id}`;
    if (sessionStorage.getItem(dedupeKey)) return;

    try {
      const userData = this.buildEnhancedConversionsUserData(order);

      this.analytics.pushEvent('purchase', {
        transaction_id: String(order.id),
        value: Number(order.total) || 0,
        currency: 'USD',
        event_category: 'ecommerce',
        event_label: 'booking_completed',
        user_data: Object.keys(userData).length > 0 ? userData : undefined
      });

      sessionStorage.setItem(dedupeKey, '1');
    } catch {
      // Silent fail — never break UI over tracking
    }
  }

  /**
   * Identity signals for Enhanced Conversions, in Google's `user_data` shape.
   *
   * PLAIN TEXT by design — Google's tag hashes these client-side before transmission, so do
   * NOT hash them here. Any field the order doesn't carry is omitted rather than sent empty,
   * because an empty string is a value Google would try (and fail) to match on.
   *
   * Notes on the mapping: `street` is `serviceAddress` only — `aptSuite` is deliberately left
   * out. `country` is the constant 'US' rather than an order field (the business serves NYC
   * only) and is attached only when there is at least one other address field to match on.
   */
  private buildEnhancedConversionsUserData(order: Order): AnalyticsUserData {
    const clean = (value: string | null | undefined) => String(value ?? '').trim();

    const userData: AnalyticsUserData = {};

    const email = clean(order.contactEmail).toLowerCase();
    if (email) userData.email_address = email;

    const phone = this.toE164(order.contactPhone);
    if (phone) userData.phone_number = phone;

    const address: NonNullable<AnalyticsUserData['address']> = {};

    const firstName = clean(order.contactFirstName).toLowerCase();
    if (firstName) address.first_name = firstName;

    const lastName = clean(order.contactLastName).toLowerCase();
    if (lastName) address.last_name = lastName;

    const street = clean(order.serviceAddress);
    if (street) address.street = street;

    const city = clean(order.city);
    if (city) address.city = city;

    const region = clean(order.state);
    if (region) address.region = region;

    const postalCode = clean(order.zipCode);
    if (postalCode) address.postal_code = postalCode;

    if (Object.keys(address).length > 0) {
      address.country = 'US';
      userData.address = address;
    }

    return userData;
  }

  /** US phone number to E.164 (+1XXXXXXXXXX). Returns null when the digits don't fit. */
  private toE164(raw: string | null | undefined): string | null {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return null;
  }
}
