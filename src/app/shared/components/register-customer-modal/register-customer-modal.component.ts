import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { AdminService } from '../../../services/admin.service';
import { normalizePhone10, sanitizePhoneInput } from '../../../utils/phone.utils';
import { describeEmailProblem } from '../../../utils/email.utils';
import { extractApiErrorMessage } from '../../../utils/http-error.utils';

/** What `POST api/admin/users/register` returns. `email` is null for a no-email cash customer. */
export interface RegisteredCustomer {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  role: string;
  authProvider: string;
  isNoEmailUser: boolean;
}

/**
 * "Register Customer" modal — the ONE implementation, used by the admin Users tab and by the
 * booking page's admin header. Extracted from `user-management.component` (2026-08) rather than
 * copied, so the two surfaces cannot drift: the validation rules, the no-email branch and the
 * error wording all live here.
 *
 * The host owns only two things: whether the caller is allowed to open it (both hosts gate on
 * `canCreate` from `GET api/admin/permissions`, which is Admin + SuperAdmin — Moderators have
 * View only, and the endpoint is `[RequirePermission(Permission.Create)]` regardless), and what
 * to do with the customer once created.
 *
 * ## Email errors name the actual mistake
 *
 * `describeEmailProblem` runs before the request, so a missing `@` is reported as a missing `@`.
 * See `utils/email.utils.ts` for the incident this comes from — an admin was shown
 * "Http failure response for .../users/register: 400" and had no way to spot the typo.
 */
@Component({
  selector: 'app-register-customer-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './register-customer-modal.component.html',
  styleUrls: ['./register-customer-modal.component.scss']
})
export class RegisterCustomerModalComponent implements OnChanges {
  /** Host-controlled visibility. Every false→true transition resets the form. */
  @Input() open = false;

  /** Cancel, backdrop click, ✕, or a completed registration. The host clears its own flag. */
  @Output() closed = new EventEmitter<void>();

  /** Emitted once the customer exists on the server. */
  @Output() registered = new EventEmitter<RegisteredCustomer>();

  form = { firstName: '', lastName: '', email: '', phone: '', noEmail: false };
  errorMessage = '';
  isRegistering = false;

  constructor(private adminService: AdminService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && changes['open'].currentValue && !changes['open'].previousValue) {
      this.reset();
    }
  }

  private reset(): void {
    this.form = { firstName: '', lastName: '', email: '', phone: '', noEmail: false };
    this.errorMessage = '';
    this.isRegistering = false;
  }

  close(): void {
    if (this.isRegistering) return;
    this.errorMessage = '';
    this.closed.emit();
  }

  /** Digits-only phone entry, mirroring the Users tab's own input handling. */
  onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = sanitizePhoneInput(input.value);
    if (input.value !== cleaned) input.value = cleaned;
    this.form.phone = cleaned;
  }

  /**
   * Report a malformed address as soon as the admin leaves the field, so the mistake is on screen
   * next to the box that caused it rather than only after pressing Register.
   */
  onEmailBlur(): void {
    if (this.form.noEmail || !this.form.email?.trim()) return;
    const problem = describeEmailProblem(this.form.email);
    if (problem) this.errorMessage = problem;
  }

  /** Any edit clears the standing error — it described the value that just changed. */
  onFieldInput(): void {
    if (this.errorMessage) this.errorMessage = '';
  }

  onNoEmailToggle(): void {
    this.errorMessage = '';
  }

  submit(): void {
    const f = this.form;

    if (!f.firstName?.trim() || !f.lastName?.trim()) {
      this.errorMessage = 'First name and last name are required.';
      return;
    }

    if (!f.noEmail) {
      if (!f.email?.trim()) {
        this.errorMessage = 'Email is required (or mark the customer as having no email).';
        return;
      }
      const problem = describeEmailProblem(f.email);
      if (problem) {
        this.errorMessage = problem;
        return;
      }
    }

    if (f.noEmail && !normalizePhone10(f.phone)) {
      this.errorMessage = 'Phone is required for customers without an email.';
      return;
    }

    this.errorMessage = '';
    this.isRegistering = true;

    this.adminService.registerUser({
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      email: f.noEmail ? undefined : f.email.trim(),
      phone: normalizePhone10(f.phone) || undefined,
      noEmail: f.noEmail
    })
      // `complete` never fires on an HTTP error, so releasing the button there left a failed
      // registration stuck on "Registering…" with the form disabled. finalize covers both paths.
      .pipe(finalize(() => { this.isRegistering = false; }))
      .subscribe({
        next: (res: any) => {
          const customer: RegisteredCustomer = {
            id: res?.id,
            firstName: res?.firstName || f.firstName.trim(),
            lastName: res?.lastName || f.lastName.trim(),
            email: res?.email ?? null,
            phone: res?.phone ?? (normalizePhone10(f.phone) || null),
            role: res?.role || 'Customer',
            authProvider: res?.authProvider || 'Admin',
            isNoEmailUser: !!(res?.isNoEmailUser ?? f.noEmail)
          };
          this.registered.emit(customer);
          this.closed.emit();
        },
        error: (err) => {
          this.errorMessage = err?.status === 409
            ? 'A user with this email already exists.'
            // Never `err.message`: that is the transport text the admin could not act on.
            : extractApiErrorMessage(err, 'Registration failed. Please try again.');
        }
      });
  }
}
