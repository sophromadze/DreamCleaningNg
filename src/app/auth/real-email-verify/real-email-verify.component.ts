import { Component, PLATFORM_ID, OnInit, ChangeDetectionStrategy, NgZone, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService, AccountExistsResponse, MergeResultResponse } from '../../services/auth.service';
import { setIntervalOutsideZone } from '../../shared/zone-free-timers';
const RELAY_DOMAIN = '@privaterelay.appleid.com';

type Step = 'email' | 'code' | 'account-found' | 'merge-email' | 'merge-success';

@Component({
  selector: 'app-real-email-verify',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './real-email-verify.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./real-email-verify.component.scss']
})
export class RealEmailVerifyComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  private readonly zone = inject(NgZone);
  readonly step = signal<Step>('email');
  emailForm: FormGroup;
  codeForm: FormGroup;
  mergeCodeForm: FormGroup;
  readonly submittedEmail = signal('');
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  readonly resendCooldown = signal(0);
  readonly mergeResendCooldown = signal(0);
  private cooldownInterval: ReturnType<typeof setInterval> | null = null;
  private mergeCooldownInterval: ReturnType<typeof setInterval> | null = null;

  /** Set when verify-email-code returns ACCOUNT_EXISTS */
  readonly existingAccountEmail = signal('');
  readonly existingAccountName = signal('');

  /** Set after successful merge */
  readonly mergeResult = signal<MergeResultResponse | null>(null);

  isBrowser = false;

  constructor() {
    const platformId = inject<Object>(PLATFORM_ID);

    this.isBrowser = isPlatformBrowser(platformId);
    this.emailForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
    this.codeForm = this.fb.group({
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6), Validators.pattern(/^\d{6}$/)]]
    });
    this.mergeCodeForm = this.fb.group({
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6), Validators.pattern(/^\d{6}$/)]]
    });
  }

  get isRelayEmail(): boolean {
    const email = (this.emailForm.get('email')?.value ?? '').trim().toLowerCase();
    return email.endsWith(RELAY_DOMAIN);
  }

  ngOnInit() {
    if (!this.isBrowser) return;
    const params = this.route.snapshot.queryParams;
    const merge = params['merge'];
    const mergeError = params['merge_error'];
    if (merge === 'success') {
      const token = params['token'];
      const refresh = params['refresh'];
      const userStr = params['user'];
      const mergedStr = params['merged'];
      try {
        let user = userStr ? JSON.parse(decodeURIComponent(userStr)) : this.authService.currentUserValue ?? undefined;
        let mergedData: MergeResultResponse['mergedData'] = mergedStr
          ? JSON.parse(decodeURIComponent(mergedStr))
          : { ordersTransferred: 0, addressesTransferred: 0, subscriptionTransferred: false };
        const result: MergeResultResponse = {
          status: 'merged',
          message: 'Accounts merged successfully',
          mergedData,
          newToken: token || '',
          refreshToken: refresh,
          user
        };
        this.authService.applyMergeResultResponse(result);
        this.mergeResult.set(result);
        this.step.set('merge-success');
      } catch (e) {
        this.errorMessage.set('Merge completed but there was an issue loading your session. Please sign in again.');
      }
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    } else if (mergeError) {
      this.step.set('account-found');
      this.errorMessage.set(decodeURIComponent(mergeError).replace(/\+/g, ' '));
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  sendCode() {
    this.errorMessage.set('');
    const email = (this.emailForm.get('email')?.value ?? '').trim().toLowerCase();
    if (!email) return;
    if (email.endsWith(RELAY_DOMAIN)) {
      this.errorMessage.set('Please enter your real email, not an Apple relay address.');
      return;
    }
    if (this.emailForm.invalid) return;

    this.isLoading.set(true);
    this.authService.requestRealEmailVerification(email).subscribe({
      next: () => {
        this.submittedEmail.set(email);
        this.step.set('code');
        this.codeForm.reset();
        this.startResendCooldown();
        this.isLoading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Something went wrong. Please try again.');
        this.isLoading.set(false);
      }
    });
  }

  verifyCode() {
    this.errorMessage.set('');
    if (this.codeForm.invalid) return;

    this.isLoading.set(true);
    const code = this.codeForm.get('code')?.value?.trim() ?? '';
    this.authService.verifyRealEmailCode(this.submittedEmail(), code).subscribe({
      next: (response) => {
        if ('status' in response && response.status === 'ACCOUNT_EXISTS') {
          const acc = response as AccountExistsResponse;
          this.existingAccountEmail.set(acc.existingAccountEmail);
          this.existingAccountName.set(acc.existingAccountName);
          this.step.set('account-found');
          this.isLoading.set(false);
          return;
        }
        this.authService.applyRealEmailVerifiedResponse(response as any);
        this.isLoading.set(false);
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Invalid or expired code. Please try again.');
        this.isLoading.set(false);
      }
    });
  }

  backToEmail() {
    this.step.set('email');
    this.errorMessage.set('');
    this.codeForm.reset();
    this.existingAccountEmail.set('');
    this.existingAccountName.set('');
  }

  goToMergeWithEmail() {
    this.step.set('merge-email');
    this.errorMessage.set('');
    this.mergeCodeForm.reset();
  }

  verifyMergeCode() {
    this.errorMessage.set('');
    if (this.mergeCodeForm.invalid) return;
    this.isLoading.set(true);
    const code = this.mergeCodeForm.get('code')?.value?.trim() ?? '';
    this.authService.confirmAccountMerge(code).subscribe({
      next: (result) => {
        this.authService.applyMergeResultResponse(result);
        this.mergeResult.set(result);
        this.step.set('merge-success');
        this.isLoading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Invalid code. Please try again.');
        this.isLoading.set(false);
      }
    });
  }

  continueAfterMerge() {
    this.router.navigate(['/']);
  }

  resendCode() {
    if (this.resendCooldown() > 0) return;
    this.errorMessage.set('');
    this.isLoading.set(true);
    this.authService.requestRealEmailVerification(this.submittedEmail()).subscribe({
      next: () => {
        this.startResendCooldown();
        this.isLoading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to resend code.');
        this.isLoading.set(false);
      }
    });
  }

  backFromMergeEmail() {
    this.step.set('account-found');
    this.errorMessage.set('');
    this.mergeCodeForm.reset();
  }

  resendMergeCode() {
    if (this.mergeResendCooldown() > 0) return;
    this.errorMessage.set('');
    this.isLoading.set(true);
    this.authService.resendMergeCode().subscribe({
      next: () => {
        this.mergeResendCooldown.set(60);
        if (this.mergeCooldownInterval) clearInterval(this.mergeCooldownInterval);
        this.mergeCooldownInterval = setIntervalOutsideZone(this.zone, () => {
          this.mergeResendCooldown.update(v => v - 1);
          if (this.mergeResendCooldown() <= 0 && this.mergeCooldownInterval) {
            clearInterval(this.mergeCooldownInterval);
            this.mergeCooldownInterval = null;
          }
        }, 1000);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to resend code.');
        this.isLoading.set(false);
      }
    });
  }

  private startResendCooldown() {
    this.resendCooldown.set(60);
    if (this.cooldownInterval) clearInterval(this.cooldownInterval);
    this.cooldownInterval = setIntervalOutsideZone(this.zone, () => {
      this.resendCooldown.update(v => v - 1);
      if (this.resendCooldown() <= 0 && this.cooldownInterval) {
        clearInterval(this.cooldownInterval);
        this.cooldownInterval = null;
      }
    }, 1000);
  }
}
