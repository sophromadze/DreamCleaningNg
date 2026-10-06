import { Component, PLATFORM_ID, ChangeDetectionStrategy, inject, signal } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./setup-pin.component.scss']
})
export class SetupPinComponent {
  private twoFactor = inject(TwoFactorService);
  private auth = inject(AuthService);
  private router = inject(Router);

  protected readonly icons = { faCircleCheck, faCircleExclamation, faCircleInfo, faEye, faEyeSlash, faLock, faShieldHalved, faSpinner };

  // Backend rule: 4–12 digits, digits-only.
  readonly pin = signal('');
  readonly confirmPin = signal('');
  readonly isSaving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  // Toggle visibility on each field so the user can sanity-check their typing.
  readonly showPin = signal(false);
  readonly showConfirm = signal(false);

  private isBrowser: boolean;

  constructor() {
    const platformId = inject<Object>(PLATFORM_ID);

    this.isBrowser = isPlatformBrowser(platformId);
  }

  // Strip non-digits live so paste/typing always lands in a valid shape.
  onDigitInput(field: 'pin' | 'confirmPin', event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/\D/g, '');
    if (cleaned !== input.value) input.value = cleaned;
    this[field].set(cleaned);
  }

  // Tiny strength meter: 4 weak, 5 ok, 6+ strong. Purely advisory.
  strengthLabel(): string {
    if (!this.pin()) return '';
    if (this.pin().length < 4) return 'Too short';
    if (this.pin().length === 4) return 'Weak';
    if (this.pin().length === 5) return 'OK';
    return 'Strong';
  }

  strengthClass(): string {
    if (!this.pin()) return '';
    if (this.pin().length < 4) return 'weak';
    if (this.pin().length === 4) return 'weak';
    if (this.pin().length === 5) return 'ok';
    return 'strong';
  }

  save(): void {
    if (this.isSaving()) return;
    if (!this.pin() || this.pin().length < 4 || this.pin().length > 12) {
      this.error.set('PIN must be 4–12 digits.');
      return;
    }
    if (this.pin() !== this.confirmPin()) {
      this.error.set('PINs don\'t match.');
      return;
    }

    this.error.set('');
    this.isSaving.set(true);

    this.twoFactor.setPin(this.pin(), this.confirmPin()).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.notice.set('PIN set. Redirecting…');
        // setPin() already cleared `tf_requires_pin_setup` and stored the new device token.
        setTimeout(() => this.router.navigateByUrl('/'), 800);
      },
      error: (err) => {
        this.isSaving.set(false);
        this.error.set(err.error?.message || 'Could not set PIN.');
      }
    });
  }

  signOut(): void {
    // Escape hatch if the user navigated here by mistake or wants to bail.
    this.auth.logout();
  }
}
