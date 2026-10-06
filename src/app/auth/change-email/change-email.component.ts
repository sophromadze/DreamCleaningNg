import { Component, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { describeEmailProblem } from '../../utils/email.utils';
import { extractApiErrorMessage } from '../../utils/http-error.utils';
import { IconComponent } from '../../shared/icons/icon.component';
import { faArrowLeft } from '../../shared/icons/glyphs/faArrowLeft';
import { faCircleExclamation } from '../../shared/icons/glyphs/faCircleExclamation';
import { faPaperPlane } from '../../shared/icons/glyphs/faPaperPlane';

/**
 * Change email, reached from the profile's Security tab, and also the landing page for the
 * verification link (`/change-email?token=...`).
 *
 * ══ THE FLOW, AND WHERE THE GATE IS ══
 *
 * Submitting the form does NOT change the address. It stores a pending address plus a one-hour
 * token on the account and mails a link to the NEW address; `confirm-email-change` is what moves
 * `User.Email`, and it only accepts that token. So being signed in is not enough to change the
 * address — the person has to be able to read mail at the new one.
 *
 * ══ WHAT WAS REMOVED, AND WHY ══
 *
 * This page used to fight browser autofill with `readonly` attributes removed on click, plus a
 * `(focus)` handler that blanked the model. Both did more harm than autofill ever did:
 *
 *  - `readonly` until CLICK meant a keyboard or screen-reader user could tab into the fields and
 *    type nothing at all, on the one form that exists to secure an account.
 *  - blanking the model on every focus meant clicking BACK into the email field to fix a typo
 *    silently erased what had been typed.
 *
 * `autocomplete="off"` on the form plus a one-time-code hint on the password box is the whole
 * defence now, and the fields behave like fields.
 */
@Component({
  selector: 'app-change-email',
  standalone: true,
  imports: [FormsModule, RouterModule, IconComponent],
  templateUrl: './change-email.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../account-form.scss', './change-email.component.scss']
})
export class ChangeEmailComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected readonly icons = { faArrowLeft, faCircleExclamation, faPaperPlane };

  // Form step
  readonly newEmail = signal<string>('');
  readonly currentPassword = signal<string>('');
  readonly errorMessage = signal<string>('');
  readonly successMessage = signal<string>('');
  readonly isSubmitting = signal<boolean>(false);
  currentUser: any = null;
  readonly showPassword = signal(false);

  // Verification step
  readonly currentStep = signal<'form' | 'verification'>('form');
  readonly isVerifying = signal(false);
  readonly isSuccess = signal(false);
  readonly isError = signal(false);
  readonly verificationErrorMessage = signal('');

  constructor() {
    this.currentUser = this.authService.currentUserValue;
  }

  ngOnInit() {
    // Arriving from the mailed link.
    const token = this.route.snapshot.queryParams['token'];

    if (token) {
      this.currentStep.set('verification');
      this.confirmEmailChange(token);
    }
  }

  /**
   * The same check the server runs (`Helpers/EmailAddressValidator`), so a typo is named here
   * before a request is made rather than coming back as a round trip. Null when it looks usable.
   */
  get emailProblem(): string | null {
    if (!this.newEmail()) return null;      // "required" is handled by the disabled submit button
    return describeEmailProblem(this.newEmail());
  }

  get canSubmit(): boolean {
    return !this.isSubmitting()
      && !!this.newEmail().trim()
      && !!this.currentPassword()
      && this.emailProblem === null;
  }

  onSubmit() {
    if (!this.canSubmit) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.authService.initiateEmailChange(this.newEmail().trim(), this.currentPassword())
      // `finalize`, not `complete`: RxJS never calls `complete` on an HTTP error, so a failed
      // attempt would leave the button stuck on "Sending…".
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (response) => {
          this.successMessage.set(response?.message
            ?? 'Check your new inbox for the verification link.');
          // Clear the password but KEEP the address on screen: the next thing the customer does
          // is go and look for mail at it, and they may well want to check they typed it right.
          this.currentPassword.set('');
        },
        error: (error) => {
          this.errorMessage.set(extractApiErrorMessage(
            error, 'Failed to start the email change. Please try again.'));
        }
      });
  }

  confirmEmailChange(token: string) {
    this.isVerifying.set(true);
    this.isSuccess.set(false);
    this.isError.set(false);

    this.authService.confirmEmailChange(token).subscribe({
      next: () => {
        this.isVerifying.set(false);
        this.isSuccess.set(true);

        // The address the account signs in with has changed, so this session is deliberately
        // ended — the customer signs in again with the new one.
        this.authService.logout();
      },
      error: (error) => {
        this.isVerifying.set(false);
        this.isError.set(true);
        this.verificationErrorMessage.set(extractApiErrorMessage(
          error, 'We could not verify that link.'));
      }
    });
  }

  resetForm() {
    this.currentStep.set('form');
    this.newEmail.set('');
    this.currentPassword.set('');
    this.errorMessage.set('');
    this.successMessage.set('');
    this.isSubmitting.set(false);
    this.isVerifying.set(false);
    this.isSuccess.set(false);
    this.isError.set(false);
    this.verificationErrorMessage.set('');

    this.router.navigate(['/change-email']);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

  goBack() {
    this.router.navigate(['/profile'], { queryParams: { tab: 'security' } });
  }
}
