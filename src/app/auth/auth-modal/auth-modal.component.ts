import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID, HostListener } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { AuthModalService } from '../../services/auth-modal.service';
import { passwordValidator } from '../../utils/password-validator';
import { GoogleSigninWrapperComponent } from '../login/google-signin-wrapper.component';
import { AppleSigninButtonComponent } from '../login/apple-signin-button.component';
import { Subscription } from 'rxjs';

type LoginStep = 'email' | 'password' | 'otp';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    HttpClientModule,
    GoogleSigninWrapperComponent,
    AppleSigninButtonComponent
  ],
  templateUrl: './auth-modal.component.html',
  styleUrl: './auth-modal.component.scss'
})
export class AuthModalComponent implements OnInit, OnDestroy {
  isLoginMode = true;
  loginStep: LoginStep = 'email';

  emailForm: FormGroup;
  passwordForm: FormGroup;
  otpForm: FormGroup;
  registerForm: FormGroup;

  isLoading = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;
  showResendOption = false;
  resendEmail = '';
  showModal = false;
  showPassword = false;
  showConfirmPassword = false;
  checkedEmail = '';

  private isBrowser: boolean;
  private subscriptions = new Subscription();

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private authModalService: AuthModalService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);

    this.emailForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });

    this.passwordForm = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(8)]]
    });

    this.otpForm = this.fb.group({
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6), Validators.pattern(/^\d{6}$/)]]
    });

    this.registerForm = this.fb.group({
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    });

    this.registerForm.get('confirmPassword')?.setValidators([
      Validators.required,
      this.passwordMatchValidator.bind(this)
    ]);
  }

  passwordMatchValidator(control: any) {
    const password = this.registerForm?.get('password')?.value;
    if (password !== control.value) {
      return { passwordMismatch: true };
    }
    return null;
  }

  getPasswordErrors(): string[] {
    const passwordControl = this.registerForm.get('password');
    if (passwordControl?.errors?.['passwordRequirements']) {
      return passwordControl.errors['passwordRequirements'].errors;
    }
    return [];
  }

  hasMinLength(): boolean {
    const pw = this.registerForm.get('password')?.value;
    return pw ? pw.length >= 8 : false;
  }

  hasUppercase(): boolean {
    const pw = this.registerForm.get('password')?.value;
    return pw ? /[A-Z]/.test(pw) : false;
  }

  hasLowercase(): boolean {
    const pw = this.registerForm.get('password')?.value;
    return pw ? /[a-z]/.test(pw) : false;
  }

  hasNumber(): boolean {
    const pw = this.registerForm.get('password')?.value;
    return pw ? /\d/.test(pw) : false;
  }

  hasLatinOnly(): boolean {
    const pw = this.registerForm.get('password')?.value;
    return pw ? /^[\x20-\x7E]+$/.test(pw) : false;
  }

  ngOnInit() {
    const modalSub = this.authModalService.isOpen$.subscribe(isOpen => {
      this.showModal = isOpen;
      if (isOpen) {
        this.resetLoginState();
        const initialMode = this.authModalService.getInitialMode();
        this.isLoginMode = initialMode === 'login';
      }
    });

    const modeSub = this.authModalService.initialMode$.subscribe(mode => {
      if (this.showModal) {
        this.isLoginMode = mode === 'login';
        this.resetLoginState();
      }
    });

    this.subscriptions.add(modalSub);
    this.subscriptions.add(modeSub);

    if (this.isBrowser && this.authService.socialAuthService) {
      const googleSub = this.authService.socialAuthService.authState.subscribe((user) => {
        if (user && user.provider === 'GOOGLE' && this.showModal) {
          this.handleGoogleSignIn(user);
        }
      });
      this.subscriptions.add(googleSub);
    }
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  @HostListener('document:keydown.escape', ['$event'])
  handleEscape(event: Event) {
    if (this.showModal) {
      this.closeModal();
    }
  }

  private resetLoginState() {
    this.loginStep = 'email';
    this.checkedEmail = '';
    this.errorMessage = null;
    this.successMessage = null;
    this.showResendOption = false;
    this.emailForm.reset();
    this.passwordForm.reset();
    this.otpForm.reset();
  }

  /** If we're on the login page, go to main after login; otherwise use returnUrl or stay. */
  private navigateAfterLogin(): void {
    const onLoginPage = this.router.url === '/login' || this.router.url.startsWith('/login?');
    const storedReturnUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('returnUrl') : null;
    const returnUrl = (storedReturnUrl && storedReturnUrl !== '/') ? storedReturnUrl : (this.authModalService.getReturnUrl() || null);
    this.closeModal();
    if (onLoginPage) {
      this.router.navigate(['/']);
    } else if (returnUrl) {
      this.router.navigateByUrl(returnUrl);
      try { localStorage.removeItem('returnUrl'); } catch (_) {}
    }
  }

  private async handleGoogleSignIn(user: any) {
    this.isLoading = true;
    this.errorMessage = null;
    try {
      await this.authService.handleGoogleUser(user);
      this.navigateAfterLogin();
    } catch (error: any) {
      this.isLoading = false;
      this.errorMessage = error?.error?.message || 'Google login failed. Please try again.';
    }
  }

  async handleAppleSignIn(response: any) {
    this.isLoading = true;
    this.errorMessage = null;
    try {
      await this.authService.handleAppleUser(response);
      this.navigateAfterLogin();
    } catch (error: any) {
      this.isLoading = false;
      this.errorMessage = error?.error?.message || error?.message || 'Apple login failed. Please try again.';
    }
  }

  handleAppleError(error: any) {
    this.isLoading = false;
    this.errorMessage = error?.error?.message || error?.message || 'Apple login failed. Please try again.';
  }

  closeModal() {
    this.authModalService.close();
    this.resetLoginState();
    this.registerForm.reset();
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.closeModal();
    }
  }

  onForgotPassword() {
    this.closeModal();
    this.router.navigate(['/auth/forgot-password']);
  }

  toggleMode() {
    this.isLoginMode = !this.isLoginMode;
    this.resetLoginState();
  }

  goBackToEmail() {
    this.loginStep = 'email';
    this.errorMessage = null;
    this.successMessage = null;
    this.passwordForm.reset();
    this.otpForm.reset();
  }

  resendOtp() {
    if (!this.checkedEmail) return;
    this.isLoading = true;
    this.errorMessage = null;
    this.authService.sendLoginOtp(this.checkedEmail).subscribe({
      next: () => {
        this.isLoading = false;
        this.successMessage = 'A new code has been sent to your email.';
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.error?.message || 'Failed to resend code.';
      }
    });
  }

  resendVerification() {
    if (!this.resendEmail) return;
    this.authService.resendVerification(this.resendEmail).subscribe({
      next: () => {
        this.errorMessage = 'Verification email sent! Please check your inbox.';
        this.showResendOption = false;
      },
      error: () => {
        this.errorMessage = 'Failed to resend verification email.';
      }
    });
  }

  capitalizeName(name: string): string {
    if (!name) return name;
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  onNameBlur(fieldName: 'firstName' | 'lastName') {
    const control = this.registerForm.get(fieldName);
    if (control && control.value) {
      const capitalized = this.capitalizeName(control.value);
      if (capitalized !== control.value) {
        control.setValue(capitalized);
      }
    }
  }

  /** Step 1: check if email exists and whether it has a password */
  onEmailSubmit() {
    if (!this.emailForm.valid) return;
    this.errorMessage = null;
    this.successMessage = null;
    this.isLoading = true;
    const email: string = this.emailForm.value.email.trim().toLowerCase();

    this.authService.checkEmailStatus(email).subscribe({
      next: (status) => {
        this.isLoading = false;
        if (!status.exists) {
          this.errorMessage = 'No account found with this email address.';
          return;
        }
        this.checkedEmail = email;
        if (status.hasPassword) {
          this.loginStep = 'password';
        } else {
          this.isLoading = true;
          this.authService.sendLoginOtp(email).subscribe({
            next: () => {
              this.isLoading = false;
              this.loginStep = 'otp';
            },
            error: (err) => {
              this.isLoading = false;
              this.errorMessage = err.error?.message || 'Failed to send login code.';
            }
          });
        }
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.error?.message || 'Something went wrong. Please try again.';
      }
    });
  }

  /** Step 2a: submit email + password */
  onPasswordSubmit() {
    if (!this.passwordForm.valid) return;
    this.errorMessage = null;
    this.isLoading = true;

    this.authService.login({ email: this.checkedEmail, password: this.passwordForm.value.password }).subscribe({
      next: () => {
        this.isLoading = false;
        this.navigateAfterLogin();
      },
      error: (error) => {
        this.isLoading = false;
        if (error.status === 400 && error.error?.message) {
          this.errorMessage = error.error.message;
          if (error.error.message.includes('verify your email')) {
            this.showResendOption = true;
            this.resendEmail = this.checkedEmail;
          }
        } else if (error.status === 401) {
          this.errorMessage = 'Invalid password.';
        } else if (error.status === 0 || error.status >= 500) {
          this.errorMessage = 'Unable to connect to server. Please try again.';
        } else {
          this.errorMessage = 'Login failed. Please try again.';
        }
      }
    });
  }

  /** Step 2b: submit OTP code */
  onOtpSubmit() {
    if (!this.otpForm.valid) return;
    this.errorMessage = null;
    this.isLoading = true;

    this.authService.verifyLoginOtp(this.checkedEmail, this.otpForm.value.code).subscribe({
      next: () => {
        this.isLoading = false;
        this.closeModal();
        this.router.navigate(['/set-password']);
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.message || 'Invalid code. Please try again.';
      }
    });
  }

  /** Registration submit */
  onSubmit() {
    this.errorMessage = null;
    this.isLoading = true;

    if (this.registerForm.valid) {
      const firstName = this.registerForm.get('firstName')?.value;
      const lastName = this.registerForm.get('lastName')?.value;
      if (firstName) this.registerForm.get('firstName')?.setValue(this.capitalizeName(firstName));
      if (lastName) this.registerForm.get('lastName')?.setValue(this.capitalizeName(lastName));

      this.authService.register(this.registerForm.value).subscribe({
        next: (response) => {
          this.isLoading = false;
          if (response.requiresEmailVerification) {
            this.closeModal();
            this.router.navigate(['/auth/verify-email-notice'], {
              state: { email: this.registerForm.value.email }
            });
          } else {
            const returnUrl = this.authModalService.getReturnUrl();
            this.closeModal();
            if (returnUrl) {
              this.router.navigateByUrl(returnUrl);
            }
          }
        },
        error: (error) => {
          this.isLoading = false;
          if (error.status === 400 && error.error?.message) {
            this.errorMessage = error.error.message;
          } else if (error.status === 409) {
            this.errorMessage = 'An account with this email already exists.';
          } else if (error.status === 0 || error.status >= 500) {
            this.errorMessage = 'Unable to connect to server. Please check your connection and try again.';
          } else {
            this.errorMessage = 'Registration failed. Please try again.';
          }
        }
      });
    } else {
      this.isLoading = false;
    }
  }
}
