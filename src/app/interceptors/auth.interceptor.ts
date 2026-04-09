import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse, HttpHandlerFn } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

// Functional interceptor approach for Angular 17+
export function authInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> {
  const useCookieAuth = environment.useCookieAuth || false;
  const isBrowser = typeof window !== 'undefined';
  
  // Skip auth checks for auth endpoints (don't attach Bearer token to login/register requests)
  const isAuthEndpoint = req.url.includes('/auth/login') || 
                        req.url.includes('/auth/register') || 
                        req.url.includes('/auth/refresh-token') ||
                        req.url.includes('/auth/google') ||
                        req.url.includes('/auth/apple-login');

  // Skip for SignalR endpoints
  const isSignalREndpoint = req.url.includes('/userManagementHub') || 
                           req.url.includes('/negotiate') ||
                           (req.url.includes('?id=') && req.url.includes('access_token='));

  // Handle based on auth method
  if (useCookieAuth) {
    // For cookie auth, always include credentials
    req = req.clone({
      withCredentials: true
    });
  } else {
    // For localStorage auth, add bearer token
    let token: string | null = null;
    
    if (isBrowser) {
      try {
        token = localStorage.getItem('token');
      } catch (error) {
        console.warn('Error accessing localStorage:', error);
        token = null;
      }
    }

    // Clone the request and add the authorization header
    if (token && !isAuthEndpoint && !isSignalREndpoint) {
      req = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`
        }
      });
    }
  }

  return next(req);
}

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isBrowser: boolean;
  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<any> = new BehaviorSubject<any>(null);
  private useCookieAuth = environment.useCookieAuth || false;

  constructor(
    @Inject(PLATFORM_ID) platformId: Object,
    private authService: AuthService,
    private router: Router
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Skip auth checks for auth endpoints (don't attach Bearer token to login/register requests)
    const isAuthEndpoint = request.url.includes('/auth/login') || 
                          request.url.includes('/auth/register') || 
                          request.url.includes('/auth/refresh-token') ||
                          request.url.includes('/auth/google') ||
                          request.url.includes('/auth/apple-login');

    // Skip for SignalR endpoints
    const isSignalREndpoint = request.url.includes('/userManagementHub') || 
                             request.url.includes('/negotiate') ||
                             (request.url.includes('?id=') && request.url.includes('access_token='));

    if (!isAuthEndpoint && !isSignalREndpoint) {
      // Check if user has been inactive for 7 days (only for non-auth/non-SignalR endpoints)
      if (this.isBrowser && !this.useCookieAuth && this.checkInactivity()) {
        this.authService.logout();
        return throwError(() => new Error('Session expired due to inactivity'));
      }

      // Update last activity time
      if (this.isBrowser && !this.useCookieAuth) {
        localStorage.setItem('lastActivity', Date.now().toString());
      }
    }

    // Handle based on auth method
    if (this.useCookieAuth) {
      // For cookie auth, always include credentials
      request = request.clone({
        withCredentials: true
      });
    } else {
      // For localStorage auth, add bearer token
      let token: string | null = null;
      
      if (this.isBrowser) {
        try {
          token = localStorage.getItem('token');
        } catch (error) {
          // Handle any localStorage access errors
          console.warn('Error accessing localStorage:', error);
          token = null;
        }
      }

      // Add token to request headers if available
      if (token && !isAuthEndpoint && !isSignalREndpoint) {
        request = this.addToken(request, token);
      }
    }

    return next.handle(request).pipe(
      catchError(error => {
        // Don't handle 401 for SignalR endpoints
        if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthEndpoint && !isSignalREndpoint) {
          return this.handle401Error(request, next);
        }
        return throwError(() => error);
      })
    );
  }

  private checkInactivity(): boolean {
    try {
      // Only check inactivity if user is logged in
      const token = localStorage.getItem('token');
      if (!token) {
        // No token means not logged in, so no inactivity check needed
        return false;
      }

      const lastActivity = localStorage.getItem('lastActivity');
      if (!lastActivity) {
        // User is logged in but no activity recorded yet, set it now
        localStorage.setItem('lastActivity', Date.now().toString());
        return false;
      }
      
      const lastActivityTime = parseInt(lastActivity);
      const currentTime = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
      
      return (currentTime - lastActivityTime) > sevenDays;
    } catch (error) {
      console.warn('Error checking inactivity:', error);
      return false;
    }
  }

  private addToken(request: HttpRequest<any>, token: string): HttpRequest<any> {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  private handle401Error(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Don't try to refresh for auth endpoints
    if (request.url.includes('/auth/')) {
      this.authService.logout();
      return throwError(() => new Error('Authentication failed'));
    }

    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      return this.authService.refreshToken().pipe(
        switchMap((response: any) => {
          this.isRefreshing = false;
          
          if (this.useCookieAuth) {
            // For cookie auth, just retry the request
            return next.handle(request);
          } else {
            // For localStorage auth, add new token
            this.refreshTokenSubject.next(response.token);
            return next.handle(this.addToken(request, response.token));
          }
        }),
        catchError((err) => {
          this.isRefreshing = false;
          console.error('Token refresh failed:', err);
          
          // Check if it's a refresh token validation error
          if (err.error && err.error.message && 
              (err.error.message.includes('Invalid refresh token') || 
               err.error.message.includes('Refresh token expired'))) {
            
            // The auth service should have already attempted recovery
            // If we get here, recovery failed, so logout
            this.authService.logout();
          } else {
            // Other types of errors, also logout
            this.authService.logout();
          }
          
          return throwError(() => err);
        })
      );
    } else {
      // If already refreshing, wait for the new token
      return this.refreshTokenSubject.pipe(
        filter(token => token != null),
        take(1),
        switchMap(token => {
          if (this.useCookieAuth) {
            // For cookie auth, just retry
            return next.handle(request);
          } else {
            // For localStorage auth, add token
            return next.handle(this.addToken(request, token));
          }
        })
      );
    }
  }
}