import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { OrderService, Order } from '../../services/order.service';
import { AuthService } from '../../services/auth.service';

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

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

  private isCustomServiceTypeOrder(order: Order): boolean {
    const services = order.services ?? [];
    const hasCustomServiceMarker = services.some(s => Number(s?.serviceId) === 0);
    const hasNoRegularServices = services.length === 0 || (services.length === 1 && Number(services[0]?.serviceId) === 0);
    return hasCustomServiceMarker || hasNoRegularServices;
  }

  /**
   * Fire Google Ads / GA4 purchase conversion with Enhanced Conversions user data.
   * Enhanced Conversions: gtag hashes email/phone client-side (SHA-256) and sends
   * to Google, enabling attribution for users whose cookies expired or were blocked.
   * Deduplicates via sessionStorage using orderId as key.
   */
  private trackPurchaseConversion(order: Order): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (typeof window.gtag !== 'function') return;
    if (!order || !order.id) return;

    const dedupeKey = `booking_conversion_fired_${order.id}`;
    if (sessionStorage.getItem(dedupeKey)) return;

    try {
      // Enhanced Conversions: provide identity signals for cross-device matching.
      // gtag will hash these client-side before sending.
      const userData: any = {};

      if (order.contactEmail) {
        userData.email = String(order.contactEmail).trim().toLowerCase();
      }

      if (order.contactPhone) {
        // Normalize to E.164 (assume US). Strip all non-digits first.
        const digits = String(order.contactPhone).replace(/\D/g, '');
        if (digits.length === 10) {
          userData.phone_number = `+1${digits}`;
        } else if (digits.length === 11 && digits.startsWith('1')) {
          userData.phone_number = `+${digits}`;
        }
      }

      if (order.contactFirstName || order.contactLastName) {
        userData.address = {
          first_name: String(order.contactFirstName || '').trim().toLowerCase(),
          last_name: String(order.contactLastName || '').trim().toLowerCase()
        };
      }

      if (Object.keys(userData).length > 0) {
        window.gtag('set', 'user_data', userData);
      }

      // Fire the purchase event. transaction_id prevents Google from counting
      // the same order twice if the user refreshes the page (also guarded above).
      window.gtag('event', 'purchase', {
        transaction_id: String(order.id),
        value: Number(order.total) || 0,
        currency: 'USD',
        event_category: 'ecommerce',
        event_label: 'booking_completed'
      });

      sessionStorage.setItem(dedupeKey, '1');
    } catch {
      // Silent fail — never break UI over tracking
    }
  }
}
