import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Observable, of } from 'rxjs';
import { TrustedDevicesComponent } from './trusted-devices.component';
import { AuthService } from '../../services/auth.service';
import { TwoFactorService } from '../../services/two-factor.service';
import { testProviders } from '../../../testing/test-providers';

/**
 * REMOVING A TRUSTED DEVICE MUST SIGN IT OUT (2026-09).
 *
 * "Remove" used to withdraw only the device's 2FA skip. A device that was already signed in
 * stayed signed in for the rest of its 30-day token — an admin removed a relative's login from
 * their profile and the relative was still in the admin panel afterwards. The server now ends
 * every other session and re-issues this one; these specs cover the browser's half of that:
 * keeping the re-issued session, and never logging out the tab that asked.
 */
describe('TrustedDevicesComponent — removing a device signs it out', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [TrustedDevicesComponent],
      providers: [...testProviders]
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());

  function create(): TrustedDevicesComponent {
    const fixture = TestBed.createComponent(TrustedDevicesComponent);
    return fixture.componentInstance;
  }

  it('stores the re-issued tokens, or this browser is refused on its next request too', () => {
    const component = create();
    component.devices = [{ id: 4, deviceName: 'Chrome on Windows', createdAt: '', lastUsedAt: '', isCurrentDevice: false }];
    component.askRevoke(4);
    component.confirmRevoke();

    http.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/auth/2fa/trusted-devices/4')).flush({
      sessionsEnded: true,
      user: { id: 1, firstName: 'A', lastName: 'B', email: 'a@b.c', role: 'SuperAdmin', firstTimeOrder: false },
      token: 'new-access',
      refreshToken: 'new-refresh'
    });

    expect(localStorage.getItem('token')).toBe('new-access');
    expect(localStorage.getItem('refreshToken')).toBe('new-refresh');
    expect(component.notice).toContain('signed out');
  });

  it('removing the device you are ON ends nobody else\'s session and replaces no tokens', () => {
    localStorage.setItem('token', 'mine');
    const component = create();
    component.devices = [{ id: 4, deviceName: 'This one', createdAt: '', lastUsedAt: '', isCurrentDevice: true }];
    component.askRevoke(4);
    component.confirmRevoke();

    http.expectOne(r => r.method === 'DELETE').flush({ sessionsEnded: false });

    expect(localStorage.getItem('token')).toBe('mine');
    expect(component.notice).toContain('2FA');
  });

  it('"Sign out all other devices" reaches the server and keeps this session', () => {
    const component = create();
    component.askSignOutOthers();
    component.confirmSignOutOthers();

    http.expectOne(r => r.method === 'POST' && r.url.endsWith('/auth/sign-out-other-sessions')).flush({
      sessionsEnded: true,
      token: 'fresh',
      refreshToken: 'fresh-refresh'
    });

    expect(localStorage.getItem('token')).toBe('fresh');
    expect(component.confirmingSignOutOthers).toBeFalse();
    expect(component.signingOutOthers).toBeFalse();
  });

  it('the tab that asked — and its sibling tabs — skip the SessionsEnded probe while the request is in flight', () => {
    const twoFactor = TestBed.inject(TwoFactorService);
    let complete!: () => void;
    spyOn(twoFactor, 'signOutOtherSessions').and.returnValue(new Observable<any>(sub => {
      complete = () => { sub.next({ sessionsEnded: true }); sub.complete(); };
    }));

    expect(auth.isSessionReissuePending()).toBeFalse();

    const component = create();
    component.confirmSignOutOthers();

    // In flight: the in-memory counter covers this tab, the localStorage stamp covers siblings.
    expect(auth.isSessionReissuePending()).toBeTrue();
    expect(Number(localStorage.getItem('auth_session_reissue_at'))).toBeGreaterThan(0);

    complete();

    // Still inside the stamp's window, so a notice arriving just after the response is ignored.
    expect(auth.isSessionReissuePending()).toBeTrue();
  });

  it('a browser that never asked (the one being signed out) is not covered by the guard', () => {
    localStorage.setItem('auth_session_reissue_at', String(Date.now() - 60_000));
    expect(auth.isSessionReissuePending()).toBeFalse();
  });

  it('an answer without sessionsEnded never touches the stored session', () => {
    localStorage.setItem('token', 'keep');
    auth.trackSessionReissue(of({ token: 'ignored', refreshToken: 'ignored' })).subscribe();
    expect(localStorage.getItem('token')).toBe('keep');
  });
});
