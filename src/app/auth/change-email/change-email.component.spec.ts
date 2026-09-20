import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ChangeEmailComponent } from './change-email.component';
import { AuthService } from '../../services/auth.service';

import { testProviders } from '../../../testing/test-providers';

describe('ChangeEmailComponent', () => {
  let component: ChangeEmailComponent;
  let fixture: ComponentFixture<ChangeEmailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [ChangeEmailComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ChangeEmailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ══ Naming the mistake ═══════════════════════════════════════════════════════════════
  //
  // The page can only ever show the { message } body, so a typo has to be described rather
  // than merely rejected. Mirrors Helpers/EmailAddressValidator on the server.

  describe('the address is checked before anything is sent', () => {
    it('says nothing at all about an empty box', () => {
      // "Required" is carried by the disabled submit button, not by an error under a field
      // nobody has typed in yet.
      component.newEmail = '';
      expect(component.emailProblem).toBeNull();
      expect(component.canSubmit).toBeFalse();
    });

    it('names a missing @ rather than calling it invalid', () => {
      component.newEmail = 'nope';
      expect(component.emailProblem).toContain('missing the "@" symbol');
    });

    it('names a domain with no ending', () => {
      component.newEmail = 'a@b';
      expect(component.emailProblem).toContain('missing its ending');
    });

    it('names a space', () => {
      component.newEmail = 'a b@example.com';
      expect(component.emailProblem).toContain('cannot contain spaces');
    });

    it('passes a usable address', () => {
      component.newEmail = 'new@example.com';
      expect(component.emailProblem).toBeNull();
    });

    it('will not submit while the address is malformed', () => {
      component.newEmail = 'nope';
      component.currentPassword = 'Correct1horse';
      expect(component.canSubmit).toBeFalse();
    });

    it('will not submit without the current password', () => {
      component.newEmail = 'new@example.com';
      component.currentPassword = '';
      expect(component.canSubmit).toBeFalse();
    });

    it('submits once both are filled in', () => {
      component.newEmail = 'new@example.com';
      component.currentPassword = 'Correct1horse';
      expect(component.canSubmit).toBeTrue();
    });
  });

  // ══ The submit ═══════════════════════════════════════════════════════════════════════

  describe('sending the verification link', () => {
    it('trims the address on the way out', () => {
      const auth = TestBed.inject(AuthService);
      const spy = spyOn(auth, 'initiateEmailChange').and.returnValue(of({ message: 'Sent.' }));
      component.newEmail = '  new@example.com  ';
      component.currentPassword = 'Correct1horse';
      component.onSubmit();
      expect(spy).toHaveBeenCalledWith('new@example.com', 'Correct1horse');
    });

    it('clears the password but KEEPS the address on screen', () => {
      // The next thing the customer does is go looking for mail at that address; blanking it
      // takes away the only way to check they typed it correctly.
      const auth = TestBed.inject(AuthService);
      spyOn(auth, 'initiateEmailChange').and.returnValue(of({ message: 'Sent.' }));
      component.newEmail = 'new@example.com';
      component.currentPassword = 'Correct1horse';
      component.onSubmit();
      expect(component.successMessage).toBe('Sent.');
      expect(component.newEmail).toBe('new@example.com');
      expect(component.currentPassword).toBe('');
    });

    it('releases the button when the request fails', () => {
      // `finalize`, not the `complete` callback — RxJS never calls `complete` on an HTTP error,
      // which is how a form ends up stuck on "Sending...".
      const auth = TestBed.inject(AuthService);
      spyOn(auth, 'initiateEmailChange').and.returnValue(
        throwError(() => ({ error: { message: 'Current password is incorrect' } })));
      component.newEmail = 'new@example.com';
      component.currentPassword = 'wrong';
      component.onSubmit();
      expect(component.isSubmitting).toBeFalse();
      expect(component.errorMessage).toBe('Current password is incorrect');
    });

    it('reads a ValidationProblemDetails body instead of showing transport noise', () => {
      const auth = TestBed.inject(AuthService);
      spyOn(auth, 'initiateEmailChange').and.returnValue(throwError(() => ({
        status: 400,
        message: 'Http failure response for /api/auth/initiate-email-change: 400 Bad Request',
        error: { title: 'One or more validation errors occurred.', errors: { NewEmail: ['The NewEmail field is not a valid e-mail address.'] } }
      })));
      component.newEmail = 'new@example.com';
      component.currentPassword = 'Correct1horse';
      component.onSubmit();
      expect(component.errorMessage).not.toContain('Http failure response');
      expect(component.errorMessage).toContain('valid e-mail address');
    });

    it('does nothing at all when the form is not submittable', () => {
      const auth = TestBed.inject(AuthService);
      const spy = spyOn(auth, 'initiateEmailChange');
      component.newEmail = 'nope';
      component.currentPassword = 'Correct1horse';
      component.onSubmit();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ══ The fields behave like fields ════════════════════════════════════════════════════
  //
  // The page used to fight autofill with `readonly` removed on click plus a focus handler that
  // blanked the model. Both did more damage than autofill: the form was unusable from a
  // keyboard, and clicking back into a field to fix a typo erased what was there.

  describe('the anti-autofill hacks are gone', () => {
    it('leaves both inputs editable from the keyboard', () => {
      const email: HTMLInputElement = fixture.nativeElement.querySelector('#newEmailField');
      const password: HTMLInputElement = fixture.nativeElement.querySelector('#currentPasswordField');
      expect(email.hasAttribute('readonly')).toBeFalse();
      expect(password.hasAttribute('readonly')).toBeFalse();
    });

    it('has no focus handler that could blank what was typed', () => {
      expect((component as any).onFieldFocus).toBeUndefined();
      expect((component as any).makeEditable).toBeUndefined();
      expect((component as any).preventAutofill).toBeUndefined();
    });
  });

  // ══ Arriving from the mailed link ════════════════════════════════════════════════════

  describe('the verification screen', () => {
    it('explains a refused token rather than showing a blank success', () => {
      const auth = TestBed.inject(AuthService);
      spyOn(auth, 'confirmEmailChange').and.returnValue(
        throwError(() => ({ error: { message: 'Invalid or expired email change token' } })));
      component.confirmEmailChange('stale-token');
      expect(component.isError).toBeTrue();
      expect(component.isSuccess).toBeFalse();
      expect(component.verificationErrorMessage).toBe('Invalid or expired email change token');
    });

    it('ends the session on success, because the sign-in address has changed', () => {
      const auth = TestBed.inject(AuthService);
      spyOn(auth, 'confirmEmailChange').and.returnValue(of({ message: 'Email changed' }));
      const logout = spyOn(auth, 'logout');
      component.confirmEmailChange('good-token');
      expect(component.isSuccess).toBeTrue();
      expect(logout).toHaveBeenCalled();
    });
  });
});
