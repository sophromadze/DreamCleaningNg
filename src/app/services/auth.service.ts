import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError, timeout, from } from 'rxjs';
import { map, tap, catchError, switchMap, filter, take, first } from 'rxjs/operators'; 
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';
import { 
  SocialAuthService, 
  SocialUser 
} from '@abacritt/angularx-social-login';

export interface UserDto {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  firstTimeOrder: boolean;
  subscriptionId?: number;
  authProvider?: string;
  role: string;
  profilePictureUrl?: string;
  requiresRealEmail?: boolean;
  /** When false, show "Set password" in profile instead of "Change password". */
  hasPassword?: boolean;
  isEmailVerified?: boolean;
}

interface AuthResponse {
  user: UserDto;
  token: string;
  refreshToken: string;
  requiresEmailVerification?: boolean;
  requiresRealEmail?: boolean;
  requiresPasswordSetup?: boolean;
}

/** When verify-email-code finds an existing account (merge flow). */
export interface AccountExistsResponse {
  status: 'ACCOUNT_EXISTS';
  message: string;
  existingAccountId: string;
  existingAccountEmail: string;
  existingAccountName: string;
}

/** Result of confirm-account-merge. */
export interface MergeResultResponse {
  status: string;
  message: string;
  mergedData: { ordersTransferred: number; addressesTransferred: number; subscriptionTransferred: boolean };
  newToken: string;
  refreshToken?: string;
  user?: UserDto;
}

interface LoginData {
  email: string;
  password: string;
}

interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword: string;
  referralCode?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = environment.apiUrl;
  private useCookieAuth = environment.useCookieAuth || false; // Add this to environment
  private currentUserSubject: BehaviorSubject<UserDto | null>;
  public currentUser: Observable<UserDto | null>;
  private isBrowser: boolean;
  private isInitializedSubject = new BehaviorSubject<boolean>(false);
  public isInitialized$ = this.isInitializedSubject.asObservable();
  private isSocialLogin = false;

  get isSocialLoginSession(): boolean {
    return this.isBrowser ? localStorage.getItem('isSocialLogin') === 'true' : this.isSocialLogin;
  }
  private profilePictureCache = new Map<string, string>();

  constructor(
    private http: HttpClient,
    private router: Router,
    @Inject(PLATFORM_ID) platformId: Object,
    public socialAuthService: SocialAuthService
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    // Initialize stored user
    let storedUser = null;
    if (this.isBrowser && !this.useCookieAuth) {
      try {
        const userStr = localStorage.getItem('currentUser');
        const token = localStorage.getItem('token');
        // If we don't have a token, treat the cached user as logged out.
        storedUser = (userStr && token) ? JSON.parse(userStr) : null;
        // Check if it was a social login
        this.isSocialLogin = localStorage.getItem('isSocialLogin') === 'true';
      } catch (e) {
        console.error('Error parsing stored user:', e);
      }
    }

    // For cookie auth, check if we have cached user data first
    let initialUser = storedUser;
    if (this.isBrowser && this.useCookieAuth) {
      try {
        const cachedData = localStorage.getItem('headerUserCache');
        if (cachedData) {
          const cached = JSON.parse(cachedData);
          const cacheAge = Date.now() - cached.timestamp;
          if (cacheAge < 24 * 60 * 60 * 1000) {
            initialUser = cached.user;
          }
        }
        // Also restore social login flag for cookie auth
        this.isSocialLogin = localStorage.getItem('isSocialLogin') === 'true';
      } catch (e) {
        console.warn('Error parsing cached user data:', e);
      }
    }
    
    this.currentUserSubject = new BehaviorSubject<UserDto | null>(initialUser);
    this.currentUser = this.currentUserSubject.asObservable();

    // Handle initialization based on platform
    if (this.isBrowser) {
      if (this.useCookieAuth) {
        // For cookie auth, don't initialize until we get response from server
        // This prevents UI flickering by ensuring we have definitive user state
        this.initializeWithCookies();
      } else {
        // Existing localStorage logic
        const token = localStorage.getItem('token');
        const userStr = localStorage.getItem('currentUser');
        const isSocialLogin = localStorage.getItem('isSocialLogin') === 'true';
        
        // IMMEDIATE initialization if we have user data and token
        if (token && userStr && storedUser) {
          // User is already logged in - initialize immediately
          this.isInitializedSubject.next(true);
          
          // If it's a social login, still subscribe to social auth state
          // but don't block initialization
          if (isSocialLogin) {
            this.socialAuthService.initState.subscribe((isReady) => {
              // Social auth is ready, but we're already initialized
            });
          }
        } else if (isSocialLogin && !token) {
          // Only wait for social auth if it's a social login without token
          this.socialAuthService.initState.subscribe((isReady) => {
            if (isReady) {
              this.isInitializedSubject.next(true);
            }
          });

          // Fallback: If social auth doesn't initialize within 2 seconds, 
          // mark as initialized anyway
          setTimeout(() => {
            if (!this.isInitializedSubject.value) {
              this.isInitializedSubject.next(true);
            }
          }, 2000);
        } else {
          // No user logged in - initialize immediately
          this.isInitializedSubject.next(true);
        }
      }
    } else {
      // On server-side, mark as initialized immediately
      this.isInitializedSubject.next(true);
    }
  }

  private initializeWithCookies(): void {
    // Skip the API call if we have no hint of an active session,
    // to avoid a 401 console error for unauthenticated users.
    if (this.isBrowser && !localStorage.getItem('sessionExists')) {
      this.currentUserSubject.next(null);
      this.isInitializedSubject.next(true);
      return;
    }

    // For cookie auth, check current user from server
    this.http.get<UserDto>(`${this.apiUrl}/auth/current-user`, { withCredentials: true })
      .pipe(
        // Add timeout to prevent hanging
        timeout(5000)
      )
      .subscribe({
        next: (user) => {
          // Set user data and mark as initialized
          this.currentUserSubject.next(user);
          this.isInitializedSubject.next(true);
          // If user landed on app after Google OAuth redirect (e.g. from booking), send them back
          this.navigateToStoredReturnUrlIfOnLanding();
        },
        error: (error: any) => {
          // Set as initialized even if no user (user is not logged in)
          this.currentUserSubject.next(null);
          this.isInitializedSubject.next(true);

          // Clear cache if it's an authentication error
          if (error.status === 401 || error.status === 403) {
            if (this.isBrowser) {
              localStorage.removeItem('sessionExists');
            }
            this.clearHeaderCache();
          }
        }
      });
  }

  /** When auth restores session (e.g. after Google OAuth redirect), redirect to returnUrl if we're on main/login. */
  private navigateToStoredReturnUrlIfOnLanding(): void {
    if (!this.isBrowser) return;
    const returnUrl = localStorage.getItem('returnUrl');
    if (!returnUrl || returnUrl === '/') return;
    const path = this.router.url.split('?')[0];
    if (path !== '/' && path !== '/login') return;
    localStorage.removeItem('returnUrl');
    this.router.navigateByUrl(returnUrl);
  }

  public get currentUserValue(): UserDto | null {
    return this.currentUserSubject.value;
  }

  login(loginData: LoginData): Observable<AuthResponse> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/login`, loginData, options)
      .pipe(map(response => {
        // Store user details and token based on auth method
        if (!this.useCookieAuth && this.isBrowser) {
          localStorage.setItem('currentUser', JSON.stringify(response.user));
          localStorage.setItem('token', response.token);
          localStorage.setItem('refreshToken', response.refreshToken);
          localStorage.setItem('lastActivity', Date.now().toString());
          // Preserve returnUrl if it exists for redirect after login
          const returnUrl = localStorage.getItem('returnUrl');
          if (returnUrl) {
            // Keep it for handleAuthResponse or login component to use
          }
        }
        if (this.useCookieAuth && this.isBrowser) {
          localStorage.setItem('sessionExists', '1');
        }
        this.currentUserSubject.next(response.user);
        return response;
      }));
  }

  applyGuestAuth(token: string, refreshToken: string, user: any): void {
    if (this.isBrowser) {
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('token', token);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('lastActivity', Date.now().toString());
      localStorage.setItem('sessionExists', '1');
    }
    this.currentUserSubject.next(user);
  }

  register(registerData: RegisterData): Observable<AuthResponse> {
    // Clean up the data before sending
    const dataToSend: any = { ...registerData };

    // Remove phone if it's empty
    if (!dataToSend.phone || dataToSend.phone.trim() === '') {
      delete dataToSend.phone;
    }

    // Always pick up referral code from localStorage if not already in the form
    if (!dataToSend.referralCode && this.isBrowser) {
      const saved = localStorage.getItem('dreamcleaning_referral');
      if (saved) dataToSend.referralCode = saved;
    }
    
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/register`, dataToSend, options)
      .pipe(map(response => {
        if (response.token && response.refreshToken && !this.useCookieAuth) {
          if (this.isBrowser) {
            localStorage.setItem('currentUser', JSON.stringify(response.user));
            localStorage.setItem('token', response.token);
            localStorage.setItem('refreshToken', response.refreshToken);
            localStorage.setItem('lastActivity', Date.now().toString());
            // Referral was processed at registration — clear it
            localStorage.removeItem('dreamcleaning_referral');
          }
          this.currentUserSubject.next(response.user);
        }
        return response;
      }));
  }

  // Email verification methods
  verifyEmail(token: string): Observable<any> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post(`${this.apiUrl}/auth/verify-email`, { token }, options);
  }

  resendVerification(email: string): Observable<any> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post(`${this.apiUrl}/auth/resend-verification`, { email }, options);
  }

  requestRealEmailVerification(email: string): Observable<{ message: string }> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/request-email-verification`, { email }, options);
  }

  verifyRealEmailCode(email: string, code: string): Observable<AuthResponse | AccountExistsResponse> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post<AuthResponse | AccountExistsResponse>(`${this.apiUrl}/auth/verify-email-code`, { email, code }, options);
  }

  confirmAccountMerge(code: string): Observable<MergeResultResponse> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post<MergeResultResponse>(`${this.apiUrl}/auth/confirm-account-merge`, { verificationMethod: 'email', verificationToken: code }, options);
  }

  resendMergeCode(): Observable<{ message: string }> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/resend-merge-code`, {}, options);
  }

  applyMergeResultResponse(response: MergeResultResponse): void {
    if (response.user) this.currentUserSubject.next(response.user);
    if (!this.useCookieAuth && this.isBrowser && response.newToken) {
      localStorage.setItem('token', response.newToken);
      if (response.refreshToken) localStorage.setItem('refreshToken', response.refreshToken);
      if (response.user) localStorage.setItem('currentUser', JSON.stringify(response.user));
    }
  }

  // Password recovery methods
  forgotPassword(email: string): Observable<any> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post(`${this.apiUrl}/auth/forgot-password`, { email }, options);
  }

  getResetPasswordInfo(token: string): Observable<{ email: string; isSetPassword?: boolean }> {
    return this.http.get<{ email: string; isSetPassword?: boolean }>(`${this.apiUrl}/auth/reset-password-info`, {
      params: { token }
    });
  }

  resetPassword(token: string, newPassword: string): Observable<any> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post(`${this.apiUrl}/auth/reset-password`, { token, newPassword }, options);
  }

  checkEmailStatus(email: string): Observable<{ exists: boolean; hasPassword: boolean }> {
    return this.http.post<{ exists: boolean; hasPassword: boolean }>(`${this.apiUrl}/auth/check-email-status`, { email });
  }

  sendEmailVerificationOtp(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/send-email-verification-otp`, { email });
  }

  sendLoginOtp(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/send-login-otp`, { email });
  }

  verifyLoginOtp(email: string, code: string): Observable<AuthResponse> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/verify-login-otp`, { email, code }, options)
      .pipe(map(response => {
        if (!this.useCookieAuth && this.isBrowser) {
          localStorage.setItem('currentUser', JSON.stringify(response.user));
          localStorage.setItem('token', response.token);
          localStorage.setItem('refreshToken', response.refreshToken);
          localStorage.setItem('lastActivity', Date.now().toString());
        }
        if (this.useCookieAuth && this.isBrowser) {
          localStorage.setItem('sessionExists', '1');
        }
        this.currentUserSubject.next(response.user);
        return response;
      }));
  }

  async handleGoogleUser(user: SocialUser): Promise<void> {  
    if (!user || !user.idToken) {
      throw new Error('No ID token received from Google');
    }
    
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    
    return new Promise((resolve, reject) => {
      const referralCode = this.isBrowser ? (localStorage.getItem('dreamcleaning_referral') || undefined) : undefined;
      this.http.post<AuthResponse>(`${this.apiUrl}/auth/google-login`, {
        idToken: user.idToken,
        referralCode
      }, options).subscribe({
        next: (response) => {
          this.isSocialLogin = true;
          if (this.isBrowser) {
            // Store social login flag for both cookie and localStorage auth
            localStorage.setItem('isSocialLogin', 'true');
          }
          this.handleAuthResponse(response);
          resolve();
        },
        error: (error) => {
          console.error('Backend error:', error);
          reject(error);
        }
      });
    });
  }

  async handleAppleUser(appleResponse: any): Promise<void> {
    if (!appleResponse || !appleResponse.authorization) {
      throw new Error('Invalid Apple response: missing authorization data');
    }

    if (!appleResponse.authorization.id_token) {
      throw new Error('Invalid Apple response: missing identity token');
    }

    const options = this.useCookieAuth ? { withCredentials: true } : {};
    
    return new Promise((resolve, reject) => {
      const referralCode = this.isBrowser ? (localStorage.getItem('dreamcleaning_referral') || undefined) : undefined;
      this.http.post<AuthResponse>(`${this.apiUrl}/auth/apple-login`, {
        identityToken: appleResponse.authorization.id_token,
        authorizationCode: appleResponse.authorization.code || '',
        user: appleResponse.user || null,
        referralCode
      }, options).subscribe({
        next: (response) => {
          this.isSocialLogin = true;
          if (this.isBrowser) {
            // Store social login flag for both cookie and localStorage auth
            localStorage.setItem('isSocialLogin', 'true');
          }
          this.handleAuthResponse(response);
          resolve();
        },
        error: (error) => {
          console.error('Apple login error:', error);
          const errorMessage = error?.error?.message || error?.message || 'Apple login failed. Please try again.';
          reject(new Error(errorMessage));
        }
      });
    });
  }

  getCachedProfilePicture(url: string): string {
    if (this.profilePictureCache.has(url)) {
      return this.profilePictureCache.get(url)!;
    }
    this.profilePictureCache.set(url, url);
    return url;
  }  

  // Social logout
  async socialSignOut(): Promise<void> {
    // Only sign out from social providers if it was a social login
    if (this.isSocialLogin && this.socialAuthService && this.isBrowser) {
      try {
        await this.socialAuthService.signOut();
      } catch (error) {
        console.error('Social sign out error:', error);
        // Continue with logout even if social signout fails
      }
    }
  }

  private handleAuthResponse(response: AuthResponse): void {
    if (response.requiresEmailVerification) {
      this.router.navigate(['/auth/verify-email-notice']);
      return;
    }
    if (response.requiresRealEmail) {
      const userWithFlag = { ...response.user, requiresRealEmail: true };
      if (!this.useCookieAuth && this.isBrowser) {
        localStorage.setItem('currentUser', JSON.stringify(userWithFlag));
        localStorage.setItem('token', response.token);
        localStorage.setItem('refreshToken', response.refreshToken);
        localStorage.setItem('lastActivity', Date.now().toString());
      }
      this.currentUserSubject.next(userWithFlag);
      this.router.navigate(['/verify-email']);
      return;
    }
    // Normal login flow
    if (!this.useCookieAuth && this.isBrowser) {
      localStorage.setItem('currentUser', JSON.stringify(response.user));
      localStorage.setItem('token', response.token);
      localStorage.setItem('refreshToken', response.refreshToken);
      localStorage.setItem('lastActivity', Date.now().toString());
      // Referral was processed on account creation — clear it so it isn't reused on next login
      localStorage.removeItem('dreamcleaning_referral');
    }
    if (this.useCookieAuth && this.isBrowser) {
      localStorage.setItem('sessionExists', '1');
      localStorage.removeItem('dreamcleaning_referral');
    }
    this.currentUserSubject.next(response.user);
    // Use stored returnUrl when set (e.g. booking step 3) so we don't redirect to main when user came from booking
    const returnUrl = this.isBrowser
      ? (localStorage.getItem('returnUrl') || '/')
      : '/';
    if (this.isBrowser) {
      localStorage.removeItem('returnUrl');
    }
    this.router.navigateByUrl(returnUrl);
  }

  // Safe navigation to login page
  private navigateToLogin(): void {
    // Try router navigation first - use the correct login route
    this.router.navigate(['/login']).then(() => {
    }).catch(error => {
      console.error('Error redirecting to login page:', error);
      
      // Try alternative routes
      this.router.navigate(['/auth/login']).then(() => {
      }).catch(() => {
        // If all router navigation fails, use window.location
        window.location.href = '/login';
      });
    });
  }

  logout(): void {
    
    // Prevent multiple logout calls - but allow logout even if currentUserValue is null
    // This is important for Google login users who might have state issues
    const wasLoggedIn = !!this.currentUserValue;
    
    // Sign out from Google if it was a social login
    // Do this first before clearing state, so Google sign-out can complete
    if (this.isSocialLogin && this.isBrowser) {
      this.socialSignOut().catch(error => {
        console.error('Social sign out error during logout:', error);
        // Continue with logout even if social signout fails
      });
    }
    
    // Clear user data
    this.currentUserSubject.next(null);
    
    if (this.isBrowser) {
      // Always clear social login flag from localStorage for both auth types
      localStorage.removeItem('isSocialLogin');
      localStorage.removeItem('sessionExists');

      if (!this.useCookieAuth) {
        // Clear localStorage data
        localStorage.removeItem('currentUser');
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('lastActivity');
      } else {
        // Clear header cache for cookie auth
        this.clearHeaderCache();
        
        // For cookie auth, also call server logout to clear cookies
        this.serverLogout().subscribe({
          next: () => {
          },
          error: (error) => {
            console.error('Server logout failed:', error);
          }
        });
      }
    }
    
    // Clear social login flag
    this.isSocialLogin = false;

    // Use safe navigation - only if user was actually logged in
    if (wasLoggedIn) {
      this.navigateToLogin();
    }
  }

  private completeLogout(): void {
    this.socialSignOut();
    // Remove user from local storage
    if (this.isBrowser && !this.useCookieAuth) {
      localStorage.removeItem('currentUser');
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('isSocialLogin');
    }
    if (this.isBrowser) {
      localStorage.removeItem('sessionExists');
    }
    // Always clear header cache on logout
    this.clearHeaderCache();
    this.isSocialLogin = false;
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  checkEmailExists(email: string): Observable<{ exists: boolean }> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.get<{ exists: boolean }>(`${this.apiUrl}/auth/check-email/${email}`, options);
  }

  isLoggedIn(): boolean {
    // Cookie auth: server session determines login state (current user is fetched via /auth/current-user).
    if (this.useCookieAuth) {
      return !!this.currentUserValue;
    }

    // LocalStorage auth: require BOTH user + token.
    return !!this.currentUserValue && !!this.getToken();
  }

  /** True when user signed in with Apple "Hide My Email" and must verify a real email before using the platform. */
  requiresRealEmail(): boolean {
    return this.currentUserValue?.requiresRealEmail === true;
  }

  /** Apply successful real-email verification: update user and store tokens (or rely on cookies). */
  applyRealEmailVerifiedResponse(response: AuthResponse): void {
    this.currentUserSubject.next(response.user);
    if (!this.useCookieAuth && this.isBrowser) {
      localStorage.setItem('currentUser', JSON.stringify(response.user));
      if (response.token) localStorage.setItem('token', response.token);
      if (response.refreshToken) localStorage.setItem('refreshToken', response.refreshToken);
    }
  }

  getToken(): string | null {
    if (this.useCookieAuth) {
      // Tokens are in httpOnly cookies, not accessible via JS
      return null;
    }
    if (this.isBrowser) {
      return localStorage.getItem('token');
    }
    return null;
  }

  // Automatic recovery mechanism for refresh token failures
  private async attemptTokenRecovery(): Promise<boolean> {
    
    if (this.useCookieAuth) {
      // For cookie auth, try to validate current session
      try {
        const user = await this.http.get<UserDto>(`${this.apiUrl}/auth/current-user`, { withCredentials: true })
          .toPromise();
        
        if (user) {
          this.currentUserSubject.next(user);
          return true;
        }
      } catch (error) {
      }
      
      return false;
    }
    
    try {
      // First, try to get fresh tokens using the current user session
      const response = await this.http.post<AuthResponse>(`${this.apiUrl}/auth/refresh-user-token`, {}, {})
        .toPromise();
      
      if (response) {
        if (this.isBrowser) {
          localStorage.setItem('currentUser', JSON.stringify(response.user));
          localStorage.setItem('token', response.token);
          localStorage.setItem('refreshToken', response.refreshToken);
        }
        this.currentUserSubject.next(response.user);
        return true;
      }
    } catch (error) {
    }
    
    // If that fails, try to validate current user session
    try {
      const user = await this.http.get<UserDto>(`${this.apiUrl}/auth/current-user`, {}).toPromise();
      
      if (user) {
        // Try to get fresh tokens again
        const tokenResponse = await this.http.post<AuthResponse>(`${this.apiUrl}/auth/refresh-user-token`, {}, {})
          .toPromise();
        
        if (tokenResponse) {
          if (this.isBrowser) {
            localStorage.setItem('currentUser', JSON.stringify(tokenResponse.user));
            localStorage.setItem('token', tokenResponse.token);
            localStorage.setItem('refreshToken', tokenResponse.refreshToken);
          }
          this.currentUserSubject.next(tokenResponse.user);
          return true;
        }
      }
    } catch (error) {
    }
    
    return false;
  }

  // Enhanced refresh token method with automatic recovery
  refreshToken(): Observable<AuthResponse> {
    if (this.useCookieAuth) {
      return this.http.post<AuthResponse>(`${this.apiUrl}/auth/refresh-token`, {}, { withCredentials: true })
        .pipe(
          map(response => {
            this.currentUserSubject.next(response.user);
            return response;
          }),
          catchError(error => {
            console.error('Token refresh failed (cookie auth):', error);
            throw error;
          })
        );
    }
    
    const token = this.getToken();
    const refreshToken = this.isBrowser ? localStorage.getItem('refreshToken') : null;
    
    if (!token || !refreshToken) {
      console.error('No tokens available for refresh');
      throw new Error('No tokens available');
    }
    
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/refresh-token`, {
      Token: token,
      RefreshToken: refreshToken
    }).pipe(
      map(response => {
        if (this.isBrowser) {
          localStorage.setItem('currentUser', JSON.stringify(response.user));
          localStorage.setItem('token', response.token);
          localStorage.setItem('refreshToken', response.refreshToken);
        }
        this.currentUserSubject.next(response.user);
        return response;
      }),
      catchError((error) => {
        console.error('Token refresh failed (localStorage auth):', error);
        
        // Check if it's a refresh token validation error
        if (error.error && error.error.message && 
            (error.error.message.includes('Invalid refresh token') || 
             error.error.message.includes('Refresh token expired'))) {
          
          // Attempt automatic recovery using switchMap to handle async operation
          return from(this.attemptTokenRecovery()).pipe(
            switchMap(recoverySuccess => {
              if (recoverySuccess) {
                // Recovery successful, return a success response
                const currentUser = this.currentUserValue;
                if (currentUser) {
                  const recoveredResponse: AuthResponse = {
                    user: currentUser,
                    token: this.getToken() || '',
                    refreshToken: this.isBrowser ? localStorage.getItem('refreshToken') || '' : ''
                  };
                  return of(recoveredResponse);
                }
              } else {
                // Recovery failed, clear auth data and logout
                this.clearAllAuthData();
                this.router.navigate(['/login']);
              }
              return throwError(() => error);
            })
          );
        }
        
        if (error.error && error.error.message) {
          console.error('Backend error message:', error.error.message);
        }
        return throwError(() => error);
      })
    );
  }
  
  changePassword(currentPassword: string, newPassword: string): Observable<any> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post(`${this.apiUrl}/auth/change-password`, {
      currentPassword,
      newPassword
    }, options);
  }

  setPassword(newPassword: string): Observable<any> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post(`${this.apiUrl}/auth/set-password`, { newPassword }, options);
  }

  // Update the current user in memory and localStorage
  updateCurrentUser(user: UserDto): void {
    if (this.isBrowser && !this.useCookieAuth) {
      localStorage.setItem('currentUser', JSON.stringify(user));
    }
    this.currentUserSubject.next(user);
  }

  // Refresh user data from the profile endpoint
  refreshUserProfile(): Observable<any> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.get<any>(`${this.apiUrl}/profile`, options).pipe(
      tap(profile => {
        if (profile && this.currentUserValue) {
          // Update the current user with the profile data
          const updatedUser: UserDto = {
            ...this.currentUserValue,
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
            phone: profile.phone,
            firstTimeOrder: profile.firstTimeOrder
          };
          this.updateCurrentUser(updatedUser);
        }
      }),
      catchError(error => {
        console.error('Failed to refresh user profile:', error);
        return of(null);
      })
    );
  }

  refreshUserDataAndToken(): Observable<any> {
    const currentUser = this.currentUserValue;
    if (!currentUser) {
      return new Observable(observer => observer.error('No current user'));
    }
  
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    // Get fresh user data from the profile endpoint
    return this.http.get<any>(`${this.apiUrl}/profile`, options).pipe(
      switchMap(profile => {
        // Update the current user with fresh data
        const updatedUser: UserDto = {
          ...currentUser,
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          phone: profile.phone,
          role: profile.role, // This is the key - get fresh role from server
          firstTimeOrder: profile.firstTimeOrder
        };
  
        // Update local storage and subject
        if (this.isBrowser && !this.useCookieAuth) {
          localStorage.setItem('currentUser', JSON.stringify(updatedUser));
        }
        this.currentUserSubject.next(updatedUser);
  
        return of(updatedUser);
      }),
      catchError(error => {
        console.error('Failed to refresh user data:', error);
        return throwError(() => error);
      })
    );
  }

  refreshUserToken(): Observable<AuthResponse> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/refresh-user-token`, {}, options)
      .pipe(map(response => {
        // Store new token and user details
        if (!this.useCookieAuth && this.isBrowser) {
          localStorage.setItem('currentUser', JSON.stringify(response.user));
          localStorage.setItem('token', response.token);
          localStorage.setItem('refreshToken', response.refreshToken);
        }
        this.currentUserSubject.next(response.user);
        return response;
      }));
  }

  initiateEmailChange(newEmail: string, currentPassword: string): Observable<any> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post(`${this.apiUrl}/auth/initiate-email-change`, {
      newEmail,
      currentPassword
    }, options);
  }
  
  confirmEmailChange(token: string): Observable<any> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.post(`${this.apiUrl}/auth/confirm-email-change`, { token }, options);
  }

  // Method to clear header cache (can be called from other components)
  // This is used to clear cached user data when the session becomes invalid
  clearHeaderCache(): void {
    if (this.isBrowser) {
      try {
        localStorage.removeItem('headerUserCache');
      } catch (error) {
        console.warn('Failed to clear header cache:', error);
      }
    }
  }

  // Method to check if we have cached user data
  hasCachedUserData(): boolean {
    if (!this.isBrowser || !this.useCookieAuth) {
      return false;
    }
    
    try {
      const cachedData = localStorage.getItem('headerUserCache');
      if (cachedData) {
        const cached = JSON.parse(cachedData);
        const cacheAge = Date.now() - cached.timestamp;
        return cacheAge < 24 * 60 * 60 * 1000; // 24 hours
      }
    } catch (error) {
      console.warn('Error checking cached user data:', error);
    }
    
    return false;
  }

  // Check if current user session is still valid
  checkCurrentUserSession(): Observable<UserDto | null> {
    const options = this.useCookieAuth ? { withCredentials: true } : {};
    return this.http.get<UserDto>(`${this.apiUrl}/auth/current-user`, options).pipe(
      map(user => {
        this.currentUserSubject.next(user);
        return user;
      }),
      catchError(error => {
        // Don't log 401 errors as they're expected when user is not logged in
        if (error.status !== 401) {
          console.error('Current user session check failed:', error);
        }
        // If the session is invalid, clear the user data
        this.currentUserSubject.next(null);
        if (this.isBrowser && !this.useCookieAuth) {
          localStorage.removeItem('currentUser');
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
        }
        return of(null);
      })
    );
  }

  // Server logout for cookie authentication
  serverLogout(): Observable<any> {
    if (this.useCookieAuth) {
      return this.http.post(`${this.apiUrl}/auth/logout`, {}, { withCredentials: true });
    }
    return of(null);
  }

  // Force refresh refresh token by clearing and re-logging
  forceRefreshToken(): Observable<AuthResponse> {
    
    if (this.useCookieAuth) {
      // For cookie auth, just try to refresh normally
      return this.http.post<AuthResponse>(`${this.apiUrl}/auth/refresh-token`, {}, { withCredentials: true })
        .pipe(
          map(response => {
            this.currentUserSubject.next(response.user);
            return response;
          }),
          catchError(error => {
            console.error('Force refresh failed (cookie auth):', error);
            // For cookie auth, if refresh fails, user needs to log in again
            this.logout();
            throw error;
          })
        );
    }
    
    // Clear current tokens for localStorage auth
    if (this.isBrowser) {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
    }
    
    // Get current user data
    const currentUser = this.currentUserValue;
    if (!currentUser) {
      return throwError(() => new Error('No current user'));
    }
    
    // Try to get fresh tokens using the current user session
    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/refresh-user-token`, {}, {})
      .pipe(
        map(response => {
          if (this.isBrowser) {
            localStorage.setItem('currentUser', JSON.stringify(response.user));
            localStorage.setItem('token', response.token);
            localStorage.setItem('refreshToken', response.refreshToken);
          }
          this.currentUserSubject.next(response.user);
          return response;
        }),
        catchError(error => {
          console.error('Force refresh failed (localStorage auth):', error);
          // If force refresh fails, user needs to log in again
          this.logout();
          throw error;
        })
      );
  }

  // Clear all authentication data and force fresh login
  clearAllAuthData(): void {
    
    // Clear user data
    this.currentUserSubject.next(null);
    
    if (this.isBrowser) {
      if (!this.useCookieAuth) {
        // Clear localStorage data
        localStorage.removeItem('currentUser');
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('lastActivity');
      } else {
        // Clear header cache for cookie auth
        this.clearHeaderCache();
      }
    }
    
  }
}