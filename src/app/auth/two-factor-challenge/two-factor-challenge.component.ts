import { Component, OnInit, Inject, PLATFORM_ID, HostListener } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TwoFactorService, TwoFactorChallenge } from '../../services/two-factor.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-two-factor-challenge',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './two-factor-challenge.component.html',
  styleUrls: ['./two-factor-challenge.component.scss']
})
export class TwoFactorChallengeComponent implements OnInit {
  // Pulled from localStorage so a page refresh on this screen survives. If missing
  // the user is bounced back to /auth (they need to log in again).
  challenge: TwoFactorChallenge | null = null;

  // Two-step state machine: 'email' (enter 6-digit code) → 'pin' (enter PIN).
  step: 'email' | 'pin' = 'email';

  code = '';
  pin = '';
  rememberDevice = true;

  // UX state
  isVerifying = false;
  isResending = false;
  resendCooldownSec = 0;
  private resendTimer: any = null;

  error = '';
  notice = '';

  private isBrowser: boolean;

  constructor(
    private twoFactor: TwoFactorService,
    private auth: AuthService,
    private router: Router,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    if (!this.isBrowser) return;
    try {
      const raw = localStorage.getItem('tf_pending_challenge');
      if (raw) this.challenge = JSON.parse(raw);
    } catch { /* ignore */ }

    if (!this.challenge?.challengeId) {
      // No active challenge — send back to login.
      this.router.navigate(['/auth']);
    }
  }

  // ───── Step 1: email code ────────────────────────────────────────────────

  verifyCode(): void {
    if (!this.challenge || this.isVerifying) return;
    const trimmed = (this.code || '').trim();
    if (trimmed.length < 4) {
      this.error = 'Enter the code from your email.';
      return;
    }

    this.error = '';
    this.isVerifying = true;

    this.twoFactor.verifyEmailCode(this.challenge.challengeId, trimmed).subscribe({
      next: () => {
        this.isVerifying = false;
        this.notice = 'Email verified. Now enter your PIN.';
        this.step = 'pin';
        // Clear the code so it doesn't linger in the DOM after step transition.
        this.code = '';
      },
      error: (err) => {
        this.isVerifying = false;
        this.error = err.error?.message || 'Verification failed. Try again.';
        // If the backend killed the session (too many attempts), bounce out.
        if (typeof this.error === 'string' && this.error.toLowerCase().includes('restart')) {
          this.bounceToLogin();
        }
      }
    });
  }

  resendCode(): void {
    if (!this.challenge || this.isResending || this.resendCooldownSec > 0) return;

    this.error = '';
    this.notice = '';
    this.isResending = true;

    this.twoFactor.resendEmailCode(this.challenge.challengeId).subscribe({
      next: () => {
        this.isResending = false;
        this.notice = 'A new code is on the way.';
        this.startResendCooldown(60);
      },
      error: (err) => {
        this.isResending = false;
        this.error = err.error?.message || 'Could not resend code.';
        if (typeof this.error === 'string' && this.error.toLowerCase().includes('restart')) {
          this.bounceToLogin();
        }
      }
    });
  }

  private startResendCooldown(seconds: number): void {
    this.resendCooldownSec = seconds;
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.resendTimer = setInterval(() => {
      this.resendCooldownSec--;
      if (this.resendCooldownSec <= 0) {
        clearInterval(this.resendTimer);
        this.resendTimer = null;
      }
    }, 1000);
  }

  // ───── Step 2: PIN ───────────────────────────────────────────────────────

  verifyPin(): void {
    if (!this.challenge || this.isVerifying) return;
    const trimmed = (this.pin || '').trim();
    if (trimmed.length < 4 || trimmed.length > 12) {
      this.error = 'PIN must be 4–12 digits.';
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      this.error = 'PIN must contain digits only.';
      return;
    }

    this.error = '';
    this.isVerifying = true;

    this.twoFactor.verifyPin(this.challenge.challengeId, trimmed, this.rememberDevice).subscribe({
      next: (response) => {
        this.isVerifying = false;
        // Hand the final auth payload to AuthService so storage + currentUser mirror a normal login.
        this.auth.applyTwoFactorSuccess({
          user: response.user,
          token: response.token,
          refreshToken: response.refreshToken,
          deviceToken: response.deviceToken
        });
        this.router.navigateByUrl('/');
      },
      error: (err) => {
        this.isVerifying = false;
        this.error = err.error?.message || 'PIN verification failed.';
      }
    });
  }

  cancelChallenge(): void {
    if (this.isBrowser) {
      localStorage.removeItem('tf_pending_challenge');
    }
    this.router.navigate(['/auth']);
  }

  // ───── Helpers ───────────────────────────────────────────────────────────

  // Only allow digits in the code/pin inputs.
  onDigitInput(field: 'code' | 'pin', event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/\D/g, '');
    if (cleaned !== input.value) {
      input.value = cleaned;
    }
    this[field] = cleaned;
  }

  @HostListener('document:keydown.enter')
  onEnter(): void {
    if (this.step === 'email') this.verifyCode();
    else this.verifyPin();
  }

  private bounceToLogin(): void {
    if (this.isBrowser) {
      localStorage.removeItem('tf_pending_challenge');
    }
    setTimeout(() => this.router.navigate(['/auth']), 1500);
  }
}
