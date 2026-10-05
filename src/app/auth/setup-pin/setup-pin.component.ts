import { Component, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TwoFactorService } from '../../services/two-factor.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { faCircleCheck } from '../../shared/icons/glyphs/faCircleCheck';
import { faCircleExclamation } from '../../shared/icons/glyphs/faCircleExclamation';
import { faCircleInfo } from '../../shared/icons/glyphs/faCircleInfo';
import { faEye } from '../../shared/icons/glyphs/faEye';
import { faEyeSlash } from '../../shared/icons/glyphs/faEyeSlash';
import { faLock } from '../../shared/icons/glyphs/faLock';
import { faShieldHalved } from '../../shared/icons/glyphs/faShieldHalved';
import { faSpinner } from '../../shared/icons/glyphs/faSpinner';

@Component({
  selector: 'app-setup-pin',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './setup-pin.component.html',
  styleUrls: ['./setup-pin.component.scss']
})
export class SetupPinComponent {
  protected readonly icons = { faCircleCheck, faCircleExclamation, faCircleInfo, faEye, faEyeSlash, faLock, faShieldHalved, faSpinner };

  // Backend rule: 4–12 digits, digits-only.
  pin = '';
  confirmPin = '';
  isSaving = false;
  error = '';
  notice = '';

  // Toggle visibility on each field so the user can sanity-check their typing.
  showPin = false;
  showConfirm = false;

  private isBrowser: boolean;

  constructor(
    private twoFactor: TwoFactorService,
    private auth: AuthService,
    private router: Router,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  // Strip non-digits live so paste/typing always lands in a valid shape.
  onDigitInput(field: 'pin' | 'confirmPin', event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/\D/g, '');
    if (cleaned !== input.value) input.value = cleaned;
    this[field] = cleaned;
  }

  // Tiny strength meter: 4 weak, 5 ok, 6+ strong. Purely advisory.
  strengthLabel(): string {
    if (!this.pin) return '';
    if (this.pin.length < 4) return 'Too short';
    if (this.pin.length === 4) return 'Weak';
    if (this.pin.length === 5) return 'OK';
    return 'Strong';
  }

  strengthClass(): string {
    if (!this.pin) return '';
    if (this.pin.length < 4) return 'weak';
    if (this.pin.length === 4) return 'weak';
    if (this.pin.length === 5) return 'ok';
    return 'strong';
  }

  save(): void {
    if (this.isSaving) return;
    if (!this.pin || this.pin.length < 4 || this.pin.length > 12) {
      this.error = 'PIN must be 4–12 digits.';
      return;
    }
    if (this.pin !== this.confirmPin) {
      this.error = 'PINs don\'t match.';
      return;
    }

    this.error = '';
    this.isSaving = true;

    this.twoFactor.setPin(this.pin, this.confirmPin).subscribe({
      next: () => {
        this.isSaving = false;
        this.notice = 'PIN set. Redirecting…';
        // setPin() already cleared `tf_requires_pin_setup` and stored the new device token.
        setTimeout(() => this.router.navigateByUrl('/'), 800);
      },
      error: (err) => {
        this.isSaving = false;
        this.error = err.error?.message || 'Could not set PIN.';
      }
    });
  }

  signOut(): void {
    // Escape hatch if the user navigated here by mistake or wants to bail.
    this.auth.logout();
  }
}
