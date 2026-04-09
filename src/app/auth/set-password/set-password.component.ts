import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { validatePassword } from '../../utils/password-validator';

@Component({
  selector: 'app-set-password',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="set-password-wrapper">
      <div class="set-password-container">
        <h1>Set Password</h1>
        <p class="intro">You don't have a password yet. Set one to sign in with your email and password.</p>
        <div class="set-password-content">
          <form (ngSubmit)="onSubmit()" #passwordForm="ngForm">
          <div class="form-group">
            <label for="newPassword">New Password</label>
            <div class="password-input-wrap">
              <input
                [type]="showPassword ? 'text' : 'password'"
                id="newPassword"
                name="newPassword"
                [(ngModel)]="newPassword"
                (ngModelChange)="validateNewPassword()"
                required
                minlength="8"
                #newPasswordInput="ngModel"
              />
              <button type="button" class="password-toggle" (click)="showPassword = !showPassword" [attr.aria-label]="showPassword ? 'Hide password' : 'Show password'" title="{{ showPassword ? 'Hide' : 'Show' }}">
                <svg *ngIf="!showPassword" class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg *ngIf="showPassword" class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
            
            <div class="password-requirements">
              <h3 class="requirement-header">Password must contain:</h3>
              <ul class="requirements-list">
                <li [class.met]="hasMinLength()">
                  At least 8 characters
                </li>
                <li [class.met]="hasUppercase()">
                  At least one uppercase letter
                </li>
                <li [class.met]="hasLowercase()">
                  At least one lowercase letter
                </li>
                <li [class.met]="hasNumber()">
                  At least one number
                </li>
                <li [class.met]="hasLatinOnly()">
                  Latin letters, numbers, and common keyboard symbols (e.g. ! &#64; # $ %)
                </li>
              </ul>
            </div>
            
            <div class="error" *ngIf="newPasswordInput.touched && passwordErrors.length > 0">
              <span *ngFor="let error of passwordErrors">{{ error }}<br></span>
            </div>
          </div>

          <div class="form-group">
            <label for="confirmPassword">Confirm Password</label>
            <div class="password-input-wrap">
              <input
                [type]="showConfirmPassword ? 'text' : 'password'"
                id="confirmPassword"
                name="confirmPassword"
                [(ngModel)]="confirmPassword"
                required
                #confirmPasswordInput="ngModel"
              />
              <button type="button" class="password-toggle" (click)="showConfirmPassword = !showConfirmPassword" [attr.aria-label]="showConfirmPassword ? 'Hide password' : 'Show password'" title="{{ showConfirmPassword ? 'Hide' : 'Show' }}">
                <svg *ngIf="!showConfirmPassword" class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg *ngIf="showConfirmPassword" class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
            <div class="error" *ngIf="confirmPasswordInput.invalid && confirmPasswordInput.touched">
              Please confirm your password
            </div>
            <div class="error" *ngIf="confirmPassword !== newPassword && confirmPasswordInput.touched">
              Passwords do not match
            </div>
          </div>

          <div class="success" *ngIf="successMessage">
            {{ successMessage }}
          </div>

          <div class="error" *ngIf="errorMessage">
            {{ errorMessage }}
          </div>

          <button type="submit" [disabled]="!isFormValid() || isSubmitting">
            {{ isSubmitting ? 'Setting Password...' : 'Set Password' }}
          </button>
        </form>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .set-password-wrapper {
      padding: 2rem;
    }

    .set-password-container {
      padding: 2rem;
      max-width: 500px;
      margin: 0 auto;
      background-color: var(--mint-fresh);
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    @media (max-width: 768px) {
      .set-password-wrapper {
        padding: 1rem;
      }
    }

    h1 {
      margin-bottom: 0.5rem;
    }

    .intro {
      margin-bottom: 1.5rem;
      color: var(--text-secondary, #555);
      font-size: 0.9375rem;
    }

    .password-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
      input {
        flex: 1;
        padding-right: 2.75rem;
      }
    }
    .password-toggle {
      position: absolute;
      right: 0.5rem;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      padding: 0.25rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted, #666);
    }
    .password-toggle:hover {
      color: var(--text-primary, #333);
    }
    .icon-eye {
      width: 1.25rem;
      height: 1.25rem;
    }
    .form-group {
      margin-bottom: 1.5rem;
    }

    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }

    input {
      width: 100%;
      padding: 12px 16px;
      padding-right: 2.75rem;
      border: 2px solid var(--border-color, #e1e1e1);
      border-radius: 8px;
      font-size: 1rem;
      transition: border-color 0.2s ease;
    }

    input:focus {
      outline: none;
      border-color: var(--primary-color, #007bff);
    }

    input.ng-invalid.ng-touched {
      border-color: var(--bright-red);
    }

    .error {
      color: var(--bright-red);
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }

    .success {
      color: #4CAF50;
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }

    button[type="submit"] {
      width: 100%;
      padding: 0.75rem;
      background: var(--btn-primary);
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: var(--btn-primary-shadow);
    }

    button[type="submit"]:hover:not(:disabled) {
      background: var(--btn-primary-hover);
      transform: translateY(-2px);
      box-shadow: var(--btn-primary-shadow-hover);
    }

    button[type="submit"]:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .password-requirements {
      margin-top: 0.5rem;
      background-color: var(--soft-yellow);
      padding: 0.75rem;
      border-radius: 4px;
      font-size: 0.875rem;
    }

    .requirement-header {
      color: var(--soft-yellow-text);
      margin: 0 0 0.5rem 0;
      font-size: 1rem;
    }

    .requirements-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .requirements-list li {
      color: var(--soft-yellow-text);
      margin-bottom: 0.25rem;
      padding-left: 1.25rem;
      position: relative;
    }

    .requirements-list li::before {
      content: '○';
      position: absolute;
      left: 0;
      top: 0;
    }

    .requirements-list li.met {
      color: #4CAF50;
    }

    .requirements-list li.met::before {
      content: '✓';
      color: #4CAF50;
    }
  `]
})
export class SetPasswordComponent {
  newPassword = '';
  confirmPassword = '';
  errorMessage = '';
  successMessage = '';
  isSubmitting = false;
  passwordErrors: string[] = [];
  showPassword = false;
  showConfirmPassword = false;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  validateNewPassword() {
    if (this.newPassword) {
      const validation = validatePassword(this.newPassword);
      this.passwordErrors = validation.errors;
    } else {
      this.passwordErrors = [];
    }
  }

  isFormValid(): boolean {
    const validation = validatePassword(this.newPassword);
    return validation.isValid && this.newPassword === this.confirmPassword;
  }

  hasMinLength(): boolean {
    return this.newPassword ? this.newPassword.length >= 8 : false;
  }

  hasUppercase(): boolean {
    return this.newPassword ? /[A-Z]/.test(this.newPassword) : false;
  }

  hasLowercase(): boolean {
    return this.newPassword ? /[a-z]/.test(this.newPassword) : false;
  }

  hasNumber(): boolean {
    return this.newPassword ? /\d/.test(this.newPassword) : false;
  }

  hasLatinOnly(): boolean {
    return this.newPassword ? /^[\x20-\x7E]+$/.test(this.newPassword) : false;
  }

  private navigateAfterPasswordSet() {
    const postUrl = localStorage.getItem('postSetPasswordUrl');
    if (postUrl) {
      localStorage.removeItem('postSetPasswordUrl');
      this.router.navigateByUrl(postUrl);
    } else {
      this.router.navigate(['/profile']);
    }
  }

  onSubmit() {
    if (!this.isFormValid()) {
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.authService.setPassword(this.newPassword).subscribe({
      next: () => {
        this.successMessage = 'Password set successfully!';
        // Refresh user token so hasPassword becomes true in the stored user object
        this.authService.refreshUserToken().subscribe({
          next: () => {
            this.isSubmitting = false;
            setTimeout(() => {
              this.navigateAfterPasswordSet();
            }, 1500);
          },
          error: () => {
            // Token refresh failed but password was set — navigate anyway
            this.isSubmitting = false;
            setTimeout(() => {
              this.navigateAfterPasswordSet();
            }, 1500);
          }
        });
      },
      error: (error) => {
        this.errorMessage = error.error?.message || 'Failed to set password';
        this.isSubmitting = false;
      }
    });
  }
}
