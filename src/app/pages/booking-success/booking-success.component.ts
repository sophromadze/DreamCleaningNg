import { Component, OnInit, OnDestroy, PLATFORM_ID, ChangeDetectionStrategy, NgZone, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { OrderService, Order } from '../../services/order.service';
import { AuthService } from '../../services/auth.service';
import { BubbleRewardsService } from '../../services/bubble-rewards.service';
import { AnalyticsService, AnalyticsUserData } from '../../services/analytics.service';
import {
  buildSupplyChecklistItems,
  hasCleaningSuppliesExtra,
  resolveSupplyChecklistFacts
} from '../../shared/booking/supply-checklist.utils';
import { IconComponent } from '../../shared/icons/icon.component';
import { faCircleCheck } from '../../shared/icons/glyphs/faCircleCheck';
import { faEnvelopeOpenText } from '../../shared/icons/glyphs/faEnvelopeOpenText';
import { setIntervalOutsideZone } from '../../shared/zone-free-timers';

@Component({
  selector: 'app-booking-success',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, IconComponent],
  templateUrl: './booking-success.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./booking-success.component.scss']
})
export class BookingSuccessComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private orderService = inject(OrderService);
  private authService = inject(AuthService);
  private bubbleRewardsService = inject(BubbleRewardsService);
  private analytics = inject(AnalyticsService);
  private platformId = inject<Object>(PLATFORM_ID);

  private readonly zone = inject(NgZone);
  protected readonly icons = { faCircleCheck, faEnvelopeOpenText };

  orderId: string = '';
  order: Order | null = null;

  /** True only when this page was reached by the navigation that follows a payment. */
  private arrivedFromPayment = false;

  readonly hasCleaningSupplies = signal(false);
  readonly isCustomServiceType = signal(false);
  readonly suppliesLoaded = signal(false);
  /**
   * The customer's "please provide" list, straight from the shared checklist builder so this
   * page, the confirmation email and the SMS cannot name different products. Empty means the
   * customer bought their way out of every item — rendered as "nothing to prepare", never as
   * an empty bulleted box.
   */
  readonly supplyChecklistItems = signal<string[]>([]);

  // Bubble points earn preview
  readonly bubblePointsEnabled = signal(false);
  readonly estimatedPoints = signal(0);

  // OTP verification step
  readonly step = signal<'success' | 'verify-otp'>('success');
  readonly otpCode = signal('');
  readonly otpError = signal('');
  readonly otpLoading = signal(false);
  readonly sendingOtp = signal(false);
  readonly resendCooldown = signal(0);
  private resendTimer: any;
  readonly loginEmail = signal('');

  ngOnInit() {
    this.orderId = this.route.snapshot.paramMap.get('orderId') ?? '';

    if (isPlatformBrowser(this.platformId)) {
      const state = (history.state as any) ?? {};
      this.loginEmail.set(state.contactEmail
        ?? this.authService.currentUserValue?.email
        ?? '');

      // The purchase conversion belongs to the payment that just happened, not to somebody
      // re-opening their receipt. The sessionStorage guard below de-duplicates within a tab; a
      // NEW tab has none, so the page is only allowed to report a purchase when it was actually
      // reached by the post-payment navigation (2026-09).
      this.arrivedFromPayment = state.paymentSuccess === true;

      const id = Number(this.orderId);
      if (!Number.isNaN(id)) {
        this.orderService.getOrderById(id).subscribe({
          next: (order) => {
            this.order = order;
            const extras = order.extraServices ?? [];

            this.hasCleaningSupplies.set(hasCleaningSuppliesExtra(extras));
            this.isCustomServiceType.set(this.isCustomServiceTypeOrder(order));
            this.supplyChecklistItems.set(buildSupplyChecklistItems(
              resolveSupplyChecklistFacts(extras, this.isCustomServiceType())
            ));
            this.suppliesLoaded.set(true);
            this.loadEstimatedPoints(order);
            this.trackPurchaseConversion(order);
          },
          error: () => {
            this.suppliesLoaded.set(true); // fall back to default checklist
          }
        });
      } else {
        this.suppliesLoaded.set(true);
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
    if (!this.loginEmail() && user) {
      this.loginEmail.set(user.email);
    }
    this.sendOtp();
  }

  private sendOtp() {
    if (!this.loginEmail()) return;
    this.sendingOtp.set(true);
    this.otpError.set('');

    this.authService.sendLoginOtp(this.loginEmail()).subscribe({
      next: () => {
        this.sendingOtp.set(false);
        this.step.set('verify-otp');
        this.startResendCooldown();
      },
      error: (err) => {
        this.sendingOtp.set(false);
        this.otpError.set(err.error?.message || 'Failed to send verification code. Please try again.');
      }
    });
  }

  resendOtp() {
    if (this.resendCooldown() > 0) return;
    this.otpCode.set('');
    this.otpError.set('');
    this.sendOtp();
  }

  submitOtp() {
    if (!this.otpCode() || this.otpCode().length !== 6) return;
    this.otpLoading.set(true);
    this.otpError.set('');

    this.authService.verifyLoginOtp(this.loginEmail(), this.otpCode()).subscribe({
      next: () => {
        this.otpLoading.set(false);
        // Store the order URL so set-password can redirect back after completion
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem('postSetPasswordUrl', `/order/${this.orderId}`);
        }
        this.router.navigate(['/set-password']);
      },
      error: (err) => {
        this.otpLoading.set(false);
        this.otpError.set(err.error?.message || 'Invalid code. Please try again.');
      }
    });
  }

  private startResendCooldown(seconds = 60) {
    this.resendCooldown.set(seconds);
    this.resendTimer = setIntervalOutsideZone(this.zone, () => {
      this.resendCooldown.update(v => v - 1);
      if (this.resendCooldown() <= 0) {
        clearInterval(this.resendTimer);
        this.resendCooldown.set(0);
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
          this.bubblePointsEnabled.set(true);
          this.estimatedPoints.set(points);
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
    // Re-opening a receipt is not a purchase. The sessionStorage key below de-duplicates within
    // one tab; a new tab has none, so the payment navigation itself is what authorises reporting.
    if (!this.arrivedFromPayment) return;

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
