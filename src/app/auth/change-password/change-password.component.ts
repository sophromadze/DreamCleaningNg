import { Component, ChangeDetectionStrategy, inject, viewChild, signal } from '@angular/core';
import { FormsModule, NgModel } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { validatePassword, getPasswordRequirements } from '../../utils/password-validator';
import { extractApiErrorMessage } from '../../utils/http-error.utils';
import { IconComponent } from '../../shared/icons/icon.component';
import { faArrowLeft } from '../../shared/icons/glyphs/faArrowLeft';
import { faCircleCheck } from '../../shared/icons/glyphs/faCircleCheck';
import { faCircleExclamation } from '../../shared/icons/glyphs/faCircleExclamation';

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
  imports: [FormsModule, RouterModule, IconComponent],
  templateUrl: './change-password.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../account-form.scss']
})
export class ChangePasswordComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  protected readonly icons = { faArrowLeft, faCircleCheck, faCircleExclamation };

  readonly currentPassword = signal('');
  readonly newPassword = signal('');
  readonly confirmPassword = signal('');
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly isSubmitting = signal(false);
  readonly passwordErrors = signal<string[]>([]);
  readonly showCurrentPassword = signal(false);
  readonly showNewPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  readonly requirements = getPasswordRequirements();

  readonly currentPasswordField = viewChild<NgModel>('currentPasswordField');
  readonly newPasswordField = viewChild<NgModel>('newPasswordField');
  readonly confirmPasswordField = viewChild<NgModel>('confirmPasswordField');

  validateNewPassword() {
    const validation = validatePassword(this.newPassword() ?? '');
    this.passwordErrors.set(validation.errors);
  }

  isFormValid(): boolean {
    const validation = validatePassword(this.newPassword());
    return this.currentPassword().length > 0 &&
           validation.isValid &&
           this.newPassword() === this.confirmPassword();
  }

  goBack() {
    this.router.navigate(['/profile'], { queryParams: { tab: 'security' } });
  }

  onSubmit() {
    this.currentPasswordField()?.control.markAsTouched();
    this.newPasswordField()?.control.markAsTouched();
    this.confirmPasswordField()?.control.markAsTouched();
    this.validateNewPassword();

    if (!this.isFormValid() || this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.authService.changePassword(this.currentPassword(), this.newPassword())
      // `finalize`, not the `complete` callback: RxJS never calls `complete` on an HTTP error,
      // so a failed attempt used to leave the button stuck on "Changing Password...".
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.successMessage.set('Password changed. Your other devices have been signed out.');
          this.currentPassword.set('');
          this.newPassword.set('');
          this.confirmPassword.set('');
          this.passwordErrors.set([]);
          setTimeout(() => {
            this.router.navigate(['/profile'], { queryParams: { tab: 'security' } });
          }, 2000);
        },
        error: (error) => {
          this.errorMessage.set(extractApiErrorMessage(error, 'Failed to change password'));
        }
      });
  }
}
