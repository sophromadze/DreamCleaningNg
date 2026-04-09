import { Component, Inject, PLATFORM_ID, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService, AccountExistsResponse, MergeResultResponse } from '../../services/auth.service';
const RELAY_DOMAIN = '@privaterelay.appleid.com';

type Step = 'email' | 'code' | 'account-found' | 'merge-email' | 'merge-success';

@Component({
  selector: 'app-real-email-verify',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './real-email-verify.component.html',
  styleUrls: ['./real-email-verify.component.scss']
})
export class RealEmailVerifyComponent implements OnInit {
  step: Step = 'email';
  emailForm: FormGroup;
  codeForm: FormGroup;
  mergeCodeForm: FormGroup;
  submittedEmail = '';
  isLoading = false;
  errorMessage = '';
  resendCooldown = 0;
  mergeResendCooldown = 0;
  private cooldownInterval: ReturnType<typeof setInterval> | null = null;
  private mergeCooldownInterval: ReturnType<typeof setInterval> | null = null;

  /** Set when verify-email-code returns ACCOUNT_EXISTS */
  existingAccountEmail = '';
  existingAccountName = '';

  /** Set after successful merge */
  mergeResult: MergeResultResponse | null = null;

  isBrowser = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
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
        this.mergeResult = result;
        this.step = 'merge-success';
      } catch (e) {
        this.errorMessage = 'Merge completed but there was an issue loading your session. Please sign in again.';
      }
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    } else if (mergeError) {
      this.step = 'account-found';
      this.errorMessage = decodeURIComponent(mergeError).replace(/\+/g, ' ');
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  sendCode() {
    this.errorMessage = '';
    const email = (this.emailForm.get('email')?.value ?? '').trim().toLowerCase();
    if (!email) return;
    if (email.endsWith(RELAY_DOMAIN)) {
      this.errorMessage = 'Please enter your real email, not an Apple relay address.';
      return;
    }
    if (this.emailForm.invalid) return;

    this.isLoading = true;
    this.authService.requestRealEmailVerification(email).subscribe({
      next: () => {
        this.submittedEmail = email;
        this.step = 'code';
        this.codeForm.reset();
        this.startResendCooldown();
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Something went wrong. Please try again.';
        this.isLoading = false;
      }
    });
  }

  verifyCode() {
    this.errorMessage = '';
    if (this.codeForm.invalid) return;

    this.isLoading = true;
    const code = this.codeForm.get('code')?.value?.trim() ?? '';
    this.authService.verifyRealEmailCode(this.submittedEmail, code).subscribe({
      next: (response) => {
        if ('status' in response && response.status === 'ACCOUNT_EXISTS') {
          const acc = response as AccountExistsResponse;
          this.existingAccountEmail = acc.existingAccountEmail;
          this.existingAccountName = acc.existingAccountName;
          this.step = 'account-found';
          this.isLoading = false;
          return;
        }
        this.authService.applyRealEmailVerifiedResponse(response as any);
        this.isLoading = false;
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Invalid or expired code. Please try again.';
        this.isLoading = false;
      }
    });
  }

  backToEmail() {
    this.step = 'email';
    this.errorMessage = '';
    this.codeForm.reset();
    this.existingAccountEmail = '';
    this.existingAccountName = '';
  }

  goToMergeWithEmail() {
    this.step = 'merge-email';
    this.errorMessage = '';
    this.mergeCodeForm.reset();
  }

  verifyMergeCode() {
    this.errorMessage = '';
    if (this.mergeCodeForm.invalid) return;
    this.isLoading = true;
    const code = this.mergeCodeForm.get('code')?.value?.trim() ?? '';
    this.authService.confirmAccountMerge(code).subscribe({
      next: (result) => {
        this.authService.applyMergeResultResponse(result);
        this.mergeResult = result;
        this.step = 'merge-success';
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Invalid code. Please try again.';
        this.isLoading = false;
      }
    });
  }

  continueAfterMerge() {
    this.router.navigate(['/']);
  }

  resendCode() {
    if (this.resendCooldown > 0) return;
    this.errorMessage = '';
    this.isLoading = true;
    this.authService.requestRealEmailVerification(this.submittedEmail).subscribe({
      next: () => {
        this.startResendCooldown();
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to resend code.';
        this.isLoading = false;
      }
    });
  }

  backFromMergeEmail() {
    this.step = 'account-found';
    this.errorMessage = '';
    this.mergeCodeForm.reset();
  }

  resendMergeCode() {
    if (this.mergeResendCooldown > 0) return;
    this.errorMessage = '';
    this.isLoading = true;
    this.authService.resendMergeCode().subscribe({
      next: () => {
        this.mergeResendCooldown = 60;
        if (this.mergeCooldownInterval) clearInterval(this.mergeCooldownInterval);
        this.mergeCooldownInterval = setInterval(() => {
          this.mergeResendCooldown--;
          if (this.mergeResendCooldown <= 0 && this.mergeCooldownInterval) {
            clearInterval(this.mergeCooldownInterval);
            this.mergeCooldownInterval = null;
          }
        }, 1000);
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = err.error?.message || 'Failed to resend code.';
        this.isLoading = false;
      }
    });
  }

  private startResendCooldown() {
    this.resendCooldown = 60;
    if (this.cooldownInterval) clearInterval(this.cooldownInterval);
    this.cooldownInterval = setInterval(() => {
      this.resendCooldown--;
      if (this.resendCooldown <= 0 && this.cooldownInterval) {
        clearInterval(this.cooldownInterval);
        this.cooldownInterval = null;
      }
    }, 1000);
  }
}
