import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';

// Header name the backend checks for the trusted-device token.
// Keep this in sync with AuthController.DeviceTokenHeader on the server.
export const DEVICE_TOKEN_HEADER = 'X-Device-Token';
// One browser can be trusted by SEVERAL staff users (admins sharing a machine or
// switching accounts). Tokens are stored as a JSON array and ALL of them are sent
// comma-separated in the header — the backend picks whichever belongs to the user
// logging in. A single shared slot meant each login overwrote the previous user's
// token, forcing the full 2FA challenge on every account switch.
const DEVICE_TOKENS_STORAGE_KEY = 'tf_device_tokens';
// Pre-multi-token key; folded into the array on read and removed on next write.
const LEGACY_DEVICE_TOKEN_KEY = 'tf_device_token';
const MAX_STORED_DEVICE_TOKENS = 10;
const PIN_SETUP_PENDING_KEY = 'tf_requires_pin_setup';

// Standalone helpers (not service methods) so the functional auth interceptor and
// auth.service can share them without injecting TwoFactorService.
export function readStoredDeviceTokens(): string[] {
  try {
    const tokens: string[] = [];
    const raw = localStorage.getItem(DEVICE_TOKENS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          if (typeof t === 'string' && t) tokens.push(t);
        }
      }
    }
    const legacy = localStorage.getItem(LEGACY_DEVICE_TOKEN_KEY);
    if (legacy && !tokens.includes(legacy)) tokens.push(legacy);
    return tokens;
  } catch {
    return [];
  }
}

/** Value for the X-Device-Token header: every stored token, comma-joined. */
export function deviceTokenHeaderValue(): string | null {
  const tokens = readStoredDeviceTokens();
  return tokens.length ? tokens.join(',') : null;
}

export function storeDeviceToken(token: string): void {
  try {
    const tokens = readStoredDeviceTokens().filter(t => t !== token);
    tokens.unshift(token);
    localStorage.setItem(
      DEVICE_TOKENS_STORAGE_KEY,
      JSON.stringify(tokens.slice(0, MAX_STORED_DEVICE_TOKENS))
    );
    localStorage.removeItem(LEGACY_DEVICE_TOKEN_KEY);
  } catch { /* localStorage unavailable — non-fatal */ }
}

export function clearStoredDeviceTokens(): void {
  try {
    localStorage.removeItem(DEVICE_TOKENS_STORAGE_KEY);
    localStorage.removeItem(LEGACY_DEVICE_TOKEN_KEY);
  } catch { /* non-fatal */ }
}

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
  // future logins. Deliberately NOT cleared on logout — trust survives sessions.

  getDeviceToken(): string | null {
    if (!this.isBrowser) return null;
    return deviceTokenHeaderValue();
  }

  setDeviceToken(token: string | null | undefined): void {
    if (!this.isBrowser) return;
    if (token) storeDeviceToken(token);
  }

  clearDeviceToken(): void {
    if (!this.isBrowser) return;
    clearStoredDeviceTokens();
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
