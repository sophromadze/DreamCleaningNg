import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';

// Header name the backend checks for the trusted-device token.
// Keep this in sync with AuthController.DeviceTokenHeader on the server.
export const DEVICE_TOKEN_HEADER = 'X-Device-Token';
const DEVICE_TOKEN_STORAGE_KEY = 'tf_device_token';
const PIN_SETUP_PENDING_KEY = 'tf_requires_pin_setup';

export interface TwoFactorChallenge {
  requiresTwoFactor: true;
  challengeId: string;
  hasPin: boolean;
  maskedEmail: string;
}

export interface TrustedDevice {
  id: number;
  deviceName?: string | null;
  browser?: string | null;
  operatingSystem?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  lastUsedAt: string;
  isCurrentDevice: boolean;
}

@Injectable({ providedIn: 'root' })
export class TwoFactorService {
  private apiUrl = environment.apiUrl;
  private isBrowser: boolean;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  // ───── Device-token storage (browser-only) ────────────────────────────────
  // Persisted in localStorage so the same browser/device passes the 2FA gate on
  // future logins. Cleared on logout (caller's responsibility — auth.service).

  getDeviceToken(): string | null {
    if (!this.isBrowser) return null;
    return localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
  }

  setDeviceToken(token: string | null | undefined): void {
    if (!this.isBrowser) return;
    if (token) localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
  }

  clearDeviceToken(): void {
    if (!this.isBrowser) return;
    localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
  }

  // Flag set by login response when a staff user has no PIN yet. Cleared after
  // /set-pin succeeds. The pinSetupGuard reads this to short-circuit navigation.
  isPinSetupPending(): boolean {
    if (!this.isBrowser) return false;
    return localStorage.getItem(PIN_SETUP_PENDING_KEY) === '1';
  }

  setPinSetupPending(pending: boolean): void {
    if (!this.isBrowser) return;
    if (pending) localStorage.setItem(PIN_SETUP_PENDING_KEY, '1');
    else localStorage.removeItem(PIN_SETUP_PENDING_KEY);
  }

  // ───── 2FA challenge endpoints ────────────────────────────────────────────

  verifyEmailCode(challengeId: string, code: string): Observable<{ verified: boolean }> {
    return this.http.post<{ verified: boolean }>(
      `${this.apiUrl}/auth/2fa/verify-email`,
      { challengeId, code }
    );
  }

  verifyPin(
    challengeId: string,
    pin: string,
    rememberDevice: boolean
  ): Observable<{ user: any; token: string; refreshToken: string; deviceToken?: string }> {
    return this.http
      .post<any>(`${this.apiUrl}/auth/2fa/verify-pin`, { challengeId, pin, rememberDevice })
      .pipe(tap(res => {
        // The backend returns the new device token only when rememberDevice was true.
        if (res?.deviceToken) this.setDeviceToken(res.deviceToken);
      }));
  }

  resendEmailCode(challengeId: string): Observable<{ resent: boolean }> {
    return this.http.post<{ resent: boolean }>(
      `${this.apiUrl}/auth/2fa/resend-email`,
      { challengeId }
    );
  }

  // ───── PIN setup (forced after first staff login) ─────────────────────────

  setPin(pin: string, confirmPin: string): Observable<{ success: boolean; deviceToken?: string }> {
    return this.http
      .post<any>(`${this.apiUrl}/auth/2fa/set-pin`, { pin, confirmPin })
      .pipe(tap(res => {
        // Setup auto-trusts the current device, so we'll get a token back.
        if (res?.deviceToken) this.setDeviceToken(res.deviceToken);
        this.setPinSetupPending(false);
      }));
  }

  // ───── Trusted device management ──────────────────────────────────────────

  listTrustedDevices(): Observable<TrustedDevice[]> {
    return this.http.get<TrustedDevice[]>(`${this.apiUrl}/auth/2fa/trusted-devices`);
  }

  revokeTrustedDevice(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/auth/2fa/trusted-devices/${id}`);
  }
}
