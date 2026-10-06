import { ComponentFixture, TestBed } from '@angular/core/testing';
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
      component.currentPassword.set(current);
      component.newPassword.set(next);
      component.confirmPassword.set(confirm);
    };

    it('needs the current password', () => {
      fill('', 'Newpass1234A', 'Newpass1234A');
      expect(component.isFormValid()).toBe(false);
    });

    it('needs the confirmation to match', () => {
      fill('Old1234A', 'Newpass1234A', 'Newpass1234B');
      expect(component.isFormValid()).toBe(false);
    });

    it('applies the shared policy to the new password', () => {
      fill('Old1234A', 'short', 'short');
      expect(component.isFormValid()).toBe(false);
      component.validateNewPassword();
      expect(component.passwordErrors().length).toBeGreaterThan(0);
    });

    it('accepts a policy-compliant pair', () => {
      fill('Old1234A', 'Newpass1234A', 'Newpass1234A');
      expect(component.isFormValid()).toBe(true);
    });
  });

  // ══ Where it goes afterwards ═════════════════════════════════════════════════════════

  it('returns to the profile, not to a route that does not exist', async () => {
    vi.useFakeTimers();
    // It used to navigate to '/cabinet', which is not a route in this application: a SUCCESSFUL
    // password change dropped the customer on the wildcard not-found page.
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'changePassword').mockReturnValue(of({ message: 'Password changed successfully' }));
    const nav = vi.spyOn(router, 'navigate').mockReturnValue(undefined as any);

    component.currentPassword.set('Old1234A');
    component.newPassword.set('Newpass1234A');
    component.confirmPassword.set('Newpass1234A');
    component.onSubmit();
    await vi.advanceTimersByTimeAsync(2000);

    expect(nav).toHaveBeenCalledWith(['/profile'], { queryParams: { tab: 'security' } });
    expect(nav).not.toHaveBeenCalledWith(['/cabinet']);
  });

  it('tells the customer their other devices were signed out', async () => {
    vi.useFakeTimers();
    // The server ends every OTHER session and untrusts every device on a password change. A
    // phone that silently logs itself out an hour later reads as a fault unless we say so.
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'changePassword').mockReturnValue(of({ message: 'ok' }));
    vi.spyOn(router, 'navigate').mockReturnValue(undefined as any);

    component.currentPassword.set('Old1234A');
    component.newPassword.set('Newpass1234A');
    component.confirmPassword.set('Newpass1234A');
    component.onSubmit();

    expect(component.successMessage()).toContain('other devices have been signed out');
    await vi.advanceTimersByTimeAsync(2000);
  });

  it('clears the typed passwords once the change has gone through', async () => {
    vi.useFakeTimers();
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'changePassword').mockReturnValue(of({ message: 'ok' }));
    vi.spyOn(router, 'navigate').mockReturnValue(undefined as any);

    component.currentPassword.set('Old1234A');
    component.newPassword.set('Newpass1234A');
    component.confirmPassword.set('Newpass1234A');
    component.onSubmit();

    expect(component.currentPassword()).toBe('');
    expect(component.newPassword()).toBe('');
    await vi.advanceTimersByTimeAsync(2000);
  });

  // ══ Failures ═════════════════════════════════════════════════════════════════════════

  it('releases the button and names the refusal', () => {
    const auth = TestBed.inject(AuthService);
    vi.spyOn(auth, 'changePassword').mockReturnValue(throwError(() => ({ error: { message: 'Current password is incorrect' } })));

    component.currentPassword.set('Wrong1234A');
    component.newPassword.set('Newpass1234A');
    component.confirmPassword.set('Newpass1234A');
    component.onSubmit();

    expect(component.errorMessage()).toBe('Current password is incorrect');
    // `finalize`, not `complete`: RxJS never calls `complete` on an HTTP error.
    expect(component.isSubmitting()).toBe(false);
  });

  it('does not fire a second request while one is in flight', () => {
    const auth = TestBed.inject(AuthService);
    const spy = vi.spyOn(auth, 'changePassword').mockReturnValue(of({ message: 'ok' }));
    vi.spyOn(router, 'navigate').mockReturnValue(undefined as any);

    component.currentPassword.set('Old1234A');
    component.newPassword.set('Newpass1234A');
    component.confirmPassword.set('Newpass1234A');
    component.isSubmitting.set(true);
    component.onSubmit();

    expect(spy).not.toHaveBeenCalled();
  });

  it('sends nothing when the form is invalid', () => {
    const auth = TestBed.inject(AuthService);
    const spy = vi.spyOn(auth, 'changePassword').mockReturnValue(undefined as any);
    component.currentPassword.set('Old1234A');
    component.newPassword.set('short');
    component.confirmPassword.set('short');
    component.onSubmit();
    expect(spy).not.toHaveBeenCalled();
  });
});
