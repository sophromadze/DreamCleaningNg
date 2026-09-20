import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ChangePasswordComponent } from './change-password.component';
import { AuthService } from '../../services/auth.service';

import { testProviders } from '../../../testing/test-providers';

describe('ChangePasswordComponent', () => {
  let component: ChangePasswordComponent;
  let fixture: ComponentFixture<ChangePasswordComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [ChangePasswordComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ChangePasswordComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ══ Validation ═══════════════════════════════════════════════════════════════════════

  describe('the form gates on the password policy', () => {
    const fill = (current: string, next: string, confirm: string) => {
      component.currentPassword = current;
      component.newPassword = next;
      component.confirmPassword = confirm;
    };

    it('needs the current password', () => {
      fill('', 'Newpass1234A', 'Newpass1234A');
      expect(component.isFormValid()).toBeFalse();
    });

    it('needs the confirmation to match', () => {
      fill('Old1234A', 'Newpass1234A', 'Newpass1234B');
      expect(component.isFormValid()).toBeFalse();
    });

    it('applies the shared policy to the new password', () => {
      fill('Old1234A', 'short', 'short');
      expect(component.isFormValid()).toBeFalse();
      component.validateNewPassword();
      expect(component.passwordErrors.length).toBeGreaterThan(0);
    });

    it('accepts a policy-compliant pair', () => {
      fill('Old1234A', 'Newpass1234A', 'Newpass1234A');
      expect(component.isFormValid()).toBeTrue();
    });
  });

  // ══ Where it goes afterwards ═════════════════════════════════════════════════════════

  it('returns to the profile, not to a route that does not exist', fakeAsync(() => {
    // It used to navigate to '/cabinet', which is not a route in this application: a SUCCESSFUL
    // password change dropped the customer on the wildcard not-found page.
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'changePassword').and.returnValue(of({ message: 'Password changed successfully' }));
    const nav = spyOn(router, 'navigate');

    component.currentPassword = 'Old1234A';
    component.newPassword = 'Newpass1234A';
    component.confirmPassword = 'Newpass1234A';
    component.onSubmit();
    tick(2000);

    expect(nav).toHaveBeenCalledWith(['/profile'], { queryParams: { tab: 'security' } });
    expect(nav).not.toHaveBeenCalledWith(['/cabinet']);
  }));

  it('tells the customer their other devices were signed out', fakeAsync(() => {
    // The server ends every OTHER session and untrusts every device on a password change. A
    // phone that silently logs itself out an hour later reads as a fault unless we say so.
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'changePassword').and.returnValue(of({ message: 'ok' }));
    spyOn(router, 'navigate');

    component.currentPassword = 'Old1234A';
    component.newPassword = 'Newpass1234A';
    component.confirmPassword = 'Newpass1234A';
    component.onSubmit();

    expect(component.successMessage).toContain('other devices have been signed out');
    tick(2000);
  }));

  it('clears the typed passwords once the change has gone through', fakeAsync(() => {
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'changePassword').and.returnValue(of({ message: 'ok' }));
    spyOn(router, 'navigate');

    component.currentPassword = 'Old1234A';
    component.newPassword = 'Newpass1234A';
    component.confirmPassword = 'Newpass1234A';
    component.onSubmit();

    expect(component.currentPassword).toBe('');
    expect(component.newPassword).toBe('');
    tick(2000);
  }));

  // ══ Failures ═════════════════════════════════════════════════════════════════════════

  it('releases the button and names the refusal', () => {
    const auth = TestBed.inject(AuthService);
    spyOn(auth, 'changePassword').and.returnValue(
      throwError(() => ({ error: { message: 'Current password is incorrect' } })));

    component.currentPassword = 'Wrong1234A';
    component.newPassword = 'Newpass1234A';
    component.confirmPassword = 'Newpass1234A';
    component.onSubmit();

    expect(component.errorMessage).toBe('Current password is incorrect');
    // `finalize`, not `complete`: RxJS never calls `complete` on an HTTP error.
    expect(component.isSubmitting).toBeFalse();
  });

  it('does not fire a second request while one is in flight', () => {
    const auth = TestBed.inject(AuthService);
    const spy = spyOn(auth, 'changePassword').and.returnValue(of({ message: 'ok' }));
    spyOn(router, 'navigate');

    component.currentPassword = 'Old1234A';
    component.newPassword = 'Newpass1234A';
    component.confirmPassword = 'Newpass1234A';
    component.isSubmitting = true;
    component.onSubmit();

    expect(spy).not.toHaveBeenCalled();
  });

  it('sends nothing when the form is invalid', () => {
    const auth = TestBed.inject(AuthService);
    const spy = spyOn(auth, 'changePassword');
    component.currentPassword = 'Old1234A';
    component.newPassword = 'short';
    component.confirmPassword = 'short';
    component.onSubmit();
    expect(spy).not.toHaveBeenCalled();
  });
});
