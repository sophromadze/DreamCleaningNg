import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { OrderService, Order } from '../../services/order.service';
import { AuthService } from '../../services/auth.service';

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
}
