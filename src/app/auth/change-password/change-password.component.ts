import { Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgModel } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { validatePassword, getPasswordRequirements } from '../../utils/password-validator';
import { extractApiErrorMessage } from '../../utils/http-error.utils';

/**
 * Change password, reached from the profile's Security tab.
 *
 * Two things worth knowing before editing this:
 *
 *  - **The server ends every OTHER session and re-issues this one.** `AuthController`'s
 *    change-password calls `EndOtherSessionsAsync` and revokes every trusted device, because
 *    changing a password is what people do when they think somebody else is in the account.
 *    `AuthService.changePassword` wraps the call in `trackSessionReissue`, which is what stores
 *    the re-issued tokens — without it this browser would be refused on its very next request.
 *    The page says so in words, or the customer's other phone silently signing out reads as a
 *    fault.
 *  - **It returns to /profile.** It used to navigate to `/cabinet`, which is not a route in this
 *    application at all: a successful password change dropped the customer on the wildcard
 *    not-found page.
 */
@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './change-password.component.html',
  styleUrls: ['../account-form.scss']
})
export class ChangePasswordComponent {
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  errorMessage = '';
  successMessage = '';
  isSubmitting = false;
  passwordErrors: string[] = [];
  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;

  readonly requirements = getPasswordRequirements();

  @ViewChild('currentPasswordField') currentPasswordField?: NgModel;
  @ViewChild('newPasswordField') newPasswordField?: NgModel;
  @ViewChild('confirmPasswordField') confirmPasswordField?: NgModel;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  validateNewPassword() {
    const validation = validatePassword(this.newPassword ?? '');
    this.passwordErrors = validation.errors;
  }

  isFormValid(): boolean {
    const validation = validatePassword(this.newPassword);
    return this.currentPassword.length > 0 &&
           validation.isValid &&
           this.newPassword === this.confirmPassword;
  }

  goBack() {
    this.router.navigate(['/profile'], { queryParams: { tab: 'security' } });
  }

  onSubmit() {
    this.currentPasswordField?.control.markAsTouched();
    this.newPasswordField?.control.markAsTouched();
    this.confirmPasswordField?.control.markAsTouched();
    this.validateNewPassword();

    if (!this.isFormValid() || this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.authService.changePassword(this.currentPassword, this.newPassword)
      // `finalize`, not the `complete` callback: RxJS never calls `complete` on an HTTP error,
      // so a failed attempt used to leave the button stuck on "Changing Password...".
      .pipe(finalize(() => this.isSubmitting = false))
      .subscribe({
        next: () => {
          this.successMessage = 'Password changed. Your other devices have been signed out.';
          this.currentPassword = '';
          this.newPassword = '';
          this.confirmPassword = '';
          this.passwordErrors = [];
          setTimeout(() => {
            this.router.navigate(['/profile'], { queryParams: { tab: 'security' } });
          }, 2000);
        },
        error: (error) => {
          this.errorMessage = extractApiErrorMessage(error, 'Failed to change password');
        }
      });
  }
}
