import { Component, OnInit, PLATFORM_ID, HostListener, ChangeDetectionStrategy, NgZone, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TwoFactorService, TwoFactorChallenge } from '../../services/two-factor.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { faArrowRight } from '../../shared/icons/glyphs/faArrowRight';
import { faCheck } from '../../shared/icons/glyphs/faCheck';
import { faCircleExclamation } from '../../shared/icons/glyphs/faCircleExclamation';
import { faCircleInfo } from '../../shared/icons/glyphs/faCircleInfo';
import { faShieldHalved } from '../../shared/icons/glyphs/faShieldHalved';
import { faSpinner } from '../../shared/icons/glyphs/faSpinner';
import { setIntervalOutsideZone } from '../../shared/zone-free-timers';

@Component({
  selector: 'app-two-factor-challenge',
  standalone: true,
  imports: [FormsModule, RouterModule, IconComponent],
  templateUrl: './two-factor-challenge.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./two-factor-challenge.component.scss']
})
export class TwoFactorChallengeComponent implements OnInit {
  private twoFactor = inject(TwoFactorService);
  private auth = inject(AuthService);
  private router = inject(Router);

  private readonly zone = inject(NgZone);
  protected readonly icons = { faArrowRight, faCheck, faCircleExclamation, faCircleInfo, faShieldHalved, faSpinner };

  // Pulled from localStorage so a page refresh on this screen survives. If missing
  // the user is bounced back to /auth (they need to log in again).
  challenge: TwoFactorChallenge | null = null;

  // Two-step state machine: 'email' (enter 6-digit code) → 'pin' (enter PIN).
  readonly step = signal<'email' | 'pin'>('email');

  readonly code = signal('');
  readonly pin = signal('');
  readonly rememberDevice = signal(true);

  // UX state
  readonly isVerifying = signal(false);
  readonly isResending = signal(false);
  readonly resendCooldownSec = signal(0);
  private resendTimer: any = null;

  readonly error = signal('');
  readonly notice = signal('');

  private isBrowser: boolean;

  constructor() {
    const platformId = inject<Object>(PLATFORM_ID);

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
      this.router.navigate(['/login']);
    }
  }

  // ───── Step 1: email code ────────────────────────────────────────────────

  verifyCode(): void {
    if (!this.challenge || this.isVerifying()) return;
    const trimmed = (this.code() || '').trim();
    if (trimmed.length < 4) {
      this.error.set('Enter the code from your email.');
      return;
    }

    this.error.set('');
    this.isVerifying.set(true);

    this.twoFactor.verifyEmailCode(this.challenge.challengeId, trimmed).subscribe({
      next: () => {
        this.isVerifying.set(false);
        this.notice.set('Email verified. Now enter your PIN.');
        this.step.set('pin');
        // Clear the code so it doesn't linger in the DOM after step transition.
        this.code.set('');
      },
      error: (err) => {
        this.isVerifying.set(false);
        this.error.set(err.error?.message || 'Verification failed. Try again.');
        // If the backend killed the session (too many attempts), bounce out.
        if (typeof this.error() === 'string' && this.error().toLowerCase().includes('restart')) {
          this.bounceToLogin();
        }
      }
    });
  }

  resendCode(): void {
    if (!this.challenge || this.isResending() || this.resendCooldownSec() > 0) return;

    this.error.set('');
    this.notice.set('');
    this.isResending.set(true);

    this.twoFactor.resendEmailCode(this.challenge.challengeId).subscribe({
      next: () => {
        this.isResending.set(false);
        this.notice.set('A new code is on the way.');
        this.startResendCooldown(60);
      },
      error: (err) => {
        this.isResending.set(false);
        this.error.set(err.error?.message || 'Could not resend code.');
        if (typeof this.error() === 'string' && this.error().toLowerCase().includes('restart')) {
          this.bounceToLogin();
        }
      }
    });
  }

  private startResendCooldown(seconds: number): void {
    this.resendCooldownSec.set(seconds);
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.resendTimer = setIntervalOutsideZone(this.zone, () => {
      this.resendCooldownSec.update(v => v - 1);
      if (this.resendCooldownSec() <= 0) {
        clearInterval(this.resendTimer);
        this.resendTimer = null;
      }
    }, 1000);
  }

  // ───── Step 2: PIN ───────────────────────────────────────────────────────

  verifyPin(): void {
    if (!this.challenge || this.isVerifying()) return;
    const trimmed = (this.pin() || '').trim();
    if (trimmed.length < 4 || trimmed.length > 12) {
      this.error.set('PIN must be 4–12 digits.');
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      this.error.set('PIN must contain digits only.');
      return;
    }

    this.error.set('');
    this.isVerifying.set(true);

    this.twoFactor.verifyPin(this.challenge.challengeId, trimmed, this.rememberDevice()).subscribe({
      next: (response) => {
        this.isVerifying.set(false);
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
        this.isVerifying.set(false);
        this.error.set(err.error?.message || 'PIN verification failed.');
      }
    });
  }

  cancelChallenge(): void {
    if (this.isBrowser) {
      localStorage.removeItem('tf_pending_challenge');
    }
    this.router.navigate(['/login']);
  }

  // ───── Helpers ───────────────────────────────────────────────────────────

  // Only allow digits in the code/pin inputs.
  onDigitInput(field: 'code' | 'pin', event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/\D/g, '');
    if (cleaned !== input.value) {
      input.value = cleaned;
    }
    this[field].set(cleaned);
  }

  @HostListener('document:keydown.enter')
  onEnter(): void {
    if (this.step() === 'email') this.verifyCode();
    else this.verifyPin();
  }

  private bounceToLogin(): void {
    if (this.isBrowser) {
      localStorage.removeItem('tf_pending_challenge');
    }
    setTimeout(() => this.router.navigate(['/login']), 1500);
  }
}
