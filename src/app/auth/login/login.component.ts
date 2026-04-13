import { Component, Inject, PLATFORM_ID, OnInit } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import { passwordValidator } from '../../utils/password-validator';
import { GoogleSigninWrapperComponent } from './google-signin-wrapper.component';
import { AppleSigninButtonComponent } from './apple-signin-button.component';

type LoginStep = 'email' | 'password' | 'otp';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule, HttpClientModule, GoogleSigninWrapperComponent, AppleSigninButtonComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnInit {
  isLoginMode = true;
  loginStep: LoginStep = 'email';

  emailForm: FormGroup;
  passwordForm: FormGroup;
  otpForm: FormGroup;
  registerForm: FormGroup;

  isLoading = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;
  returnUrl: string;
  showResendOption = false;
  resendEmail = '';
  showPassword = false;
  showConfirmPassword = false;
  referralValid: boolean | null = null;
  private isBrowser: boolean;

  /** Email entered in step 1, passed forward to step 2 */
  checkedEmail = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';

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
      password: ['', [Validators.required, passwordValidator()]],
      confirmPassword: ['', [Validators.required]],
      referralCode: ['']
    });

    this.registerForm.get('confirmPassword')?.setValidators([
      Validators.required,
      this.passwordMatchValidator.bind(this)
    ]);
  }

  passwordMatchValidator(control: any) {
    const password = this.registerForm?.get('password')?.value;
    const confirmPassword = control.value;
    if (password !== confirmPassword) {
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

  ngOnInit() {
    if (this.isBrowser && this.returnUrl && this.returnUrl !== '/') {
      localStorage.setItem('returnUrl', this.returnUrl);
    }

    // Pre-fill referral code from localStorage if available
    if (this.isBrowser) {
      const savedCode = localStorage.getItem('dreamcleaning_referral');
      if (savedCode) {
        this.registerForm.patchValue({ referralCode: savedCode.toUpperCase() });
      }
    }

    if (this.isBrowser && this.authService.socialAuthService) {
      this.authService.socialAuthService.authState.subscribe((user) => {
        if (user && user.provider === 'GOOGLE') {
          this.handleGoogleSignIn(user);
        }
      });
    }
  }

  private async handleGoogleSignIn(user: any) {
    this.isLoading = true;
    this.errorMessage = null;
    try {
      await this.authService.handleGoogleUser(user);
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
    } catch (error: any) {
      this.isLoading = false;
      this.errorMessage = error?.error?.message || error?.message || 'Apple login failed. Please try again.';
    }
  }

  handleAppleError(error: any) {
    this.isLoading = false;
    this.errorMessage = error?.error?.message || error?.message || 'Apple login failed. Please try again.';
  }

  onForgotPassword() {
    this.router.navigate(['/auth/forgot-password']);
  }

  toggleMode() {
    this.isLoginMode = !this.isLoginMode;
    this.loginStep = 'email';
    this.errorMessage = null;
    this.successMessage = null;
    this.checkedEmail = '';
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
          // Send OTP immediately
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
        const storedReturnUrl = this.isBrowser ? localStorage.getItem('returnUrl') : null;
        const finalReturnUrl = storedReturnUrl || this.returnUrl || '/';
        if (this.isBrowser && storedReturnUrl) {
          localStorage.removeItem('returnUrl');
        }
        this.router.navigateByUrl(finalReturnUrl);
      },
      error: (error) => {
        this.isLoading = false;
        if (error.status === 400 && error.error?.message) {
          this.errorMessage = error.error.message;
          if (error.error.message.toLowerCase().includes('verify your email')) {
            this.router.navigate(['/auth/verify-email-notice']);
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
      next: (response) => {
        this.isLoading = false;
        if (response.requiresPasswordSetup) {
          this.router.navigate(['/set-password']);
        } else {
          const storedReturnUrl = this.isBrowser ? localStorage.getItem('returnUrl') : null;
          const finalReturnUrl = storedReturnUrl || this.returnUrl || '/';
          if (this.isBrowser && storedReturnUrl) {
            localStorage.removeItem('returnUrl');
          }
          this.router.navigateByUrl(finalReturnUrl);
        }
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

    if (!this.isLoginMode) {
      if (this.registerForm.valid) {
        const firstName = this.registerForm.get('firstName')?.value;
        const lastName = this.registerForm.get('lastName')?.value;
        if (firstName) this.registerForm.get('firstName')?.setValue(this.capitalizeName(firstName));
        if (lastName) this.registerForm.get('lastName')?.setValue(this.capitalizeName(lastName));

        // Uppercase referral code before sending
        const formValue = { ...this.registerForm.value };
        if (formValue.referralCode) {
          formValue.referralCode = formValue.referralCode.toUpperCase().trim();
        }

        this.authService.register(formValue).subscribe({
          next: (response) => {
            this.isLoading = false;
            // Keep dreamcleaning_referral in localStorage — it will be cleared after booking
            if (response.requiresEmailVerification) {
              this.router.navigate(['/auth/verify-email-notice']);
            } else {
              this.router.navigateByUrl(this.returnUrl);
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
        Object.keys(this.registerForm.controls).forEach(key => {
          this.registerForm.get(key)?.markAsTouched();
        });
      }
    }
  }
}
