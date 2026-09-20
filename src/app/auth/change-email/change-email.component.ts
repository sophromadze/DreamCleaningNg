import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { describeEmailProblem } from '../../utils/email.utils';
import { extractApiErrorMessage } from '../../utils/http-error.utils';

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
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './change-email.component.html',
  styleUrls: ['../account-form.scss', './change-email.component.scss']
})
export class ChangeEmailComponent implements OnInit {
  // Form step
  newEmail: string = '';
  currentPassword: string = '';
  errorMessage: string = '';
  successMessage: string = '';
  isSubmitting: boolean = false;
  currentUser: any = null;
  showPassword = false;

  // Verification step
  currentStep: 'form' | 'verification' = 'form';
  isVerifying = false;
  isSuccess = false;
  isError = false;
  verificationErrorMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.currentUser = this.authService.currentUserValue;
  }

  ngOnInit() {
    // Arriving from the mailed link.
    const token = this.route.snapshot.queryParams['token'];

    if (token) {
      this.currentStep = 'verification';
      this.confirmEmailChange(token);
    }
  }

  /**
   * The same check the server runs (`Helpers/EmailAddressValidator`), so a typo is named here
   * before a request is made rather than coming back as a round trip. Null when it looks usable.
   */
  get emailProblem(): string | null {
    if (!this.newEmail) return null;      // "required" is handled by the disabled submit button
    return describeEmailProblem(this.newEmail);
  }

  get canSubmit(): boolean {
    return !this.isSubmitting
      && !!this.newEmail.trim()
      && !!this.currentPassword
      && this.emailProblem === null;
  }

  onSubmit() {
    if (!this.canSubmit) return;

    this.isSubmitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.authService.initiateEmailChange(this.newEmail.trim(), this.currentPassword)
      // `finalize`, not `complete`: RxJS never calls `complete` on an HTTP error, so a failed
      // attempt would leave the button stuck on "Sending…".
      .pipe(finalize(() => this.isSubmitting = false))
      .subscribe({
        next: (response) => {
          this.successMessage = response?.message
            ?? 'Check your new inbox for the verification link.';
          // Clear the password but KEEP the address on screen: the next thing the customer does
          // is go and look for mail at it, and they may well want to check they typed it right.
          this.currentPassword = '';
        },
        error: (error) => {
          this.errorMessage = extractApiErrorMessage(
            error, 'Failed to start the email change. Please try again.');
        }
      });
  }

  confirmEmailChange(token: string) {
    this.isVerifying = true;
    this.isSuccess = false;
    this.isError = false;

    this.authService.confirmEmailChange(token).subscribe({
      next: () => {
        this.isVerifying = false;
        this.isSuccess = true;

        // The address the account signs in with has changed, so this session is deliberately
        // ended — the customer signs in again with the new one.
        this.authService.logout();
      },
      error: (error) => {
        this.isVerifying = false;
        this.isError = true;
        this.verificationErrorMessage = extractApiErrorMessage(
          error, 'We could not verify that link.');
      }
    });
  }

  resetForm() {
    this.currentStep = 'form';
    this.newEmail = '';
    this.currentPassword = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.isSubmitting = false;
    this.isVerifying = false;
    this.isSuccess = false;
    this.isError = false;
    this.verificationErrorMessage = '';

    this.router.navigate(['/change-email']);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

  goBack() {
    this.router.navigate(['/profile'], { queryParams: { tab: 'security' } });
  }
}
