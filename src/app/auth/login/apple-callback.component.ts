import { Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

declare const AppleID: any;

@Component({
  selector: 'app-apple-callback',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="isBrowser" class="callback-container">
      <div class="loading-spinner" *ngIf="isProcessing">
        <div class="spinner"></div>
        <p>Completing sign in...</p>
      </div>
      <div class="error-message" *ngIf="errorMessage">
        <p>{{ errorMessage }}</p>
        <button (click)="goToLogin()">Return to Login</button>
      </div>
    </div>
  `,
  styles: [`
    .callback-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      flex-direction: column;
    }
    .loading-spinner {
      text-align: center;
    }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #000;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .error-message {
      text-align: center;
      padding: 20px;
    }
    .error-message button {
      margin-top: 15px;
      padding: 10px 20px;
      background: #000;
      color: #fff;
      border: none;
      border-radius: 5px;
      cursor: pointer;
    }
  `]
})
export class AppleCallbackComponent implements OnInit {
  isBrowser = false;
  isProcessing = true;
  errorMessage: string | null = null;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  async ngOnInit() {
    if (!this.isBrowser) {
      return;
    }

    try {
      // Check for error in query params (from backend redirect)
      const urlParams = new URLSearchParams(window.location.search);
      const error = urlParams.get('error');
      const errorDescription = urlParams.get('error_description');
      
      if (error) {
        this.isProcessing = false;
        this.errorMessage = errorDescription || error || 'Apple sign in failed. Please try again.';
        return;
      }

      // Get token data from URL query parameters (backend redirects here with the data)
      const idToken = urlParams.get('id_token');
      const code = urlParams.get('code');
      const userParam = urlParams.get('user');
      
      if (idToken) {
        // Parse user data if provided
        let userData = null;
        if (userParam) {
          try {
            userData = JSON.parse(decodeURIComponent(userParam));
          } catch (e) {
            console.warn('Failed to parse user data:', e);
          }
        }

        // Construct response object from query parameters
        const responseFromUrl = {
          authorization: {
            id_token: idToken,
            code: code || ''
          },
          user: userData
        };

        // Process the Apple sign-in
        try {
          await this.authService.handleAppleUser(responseFromUrl);
          // Navigation will be handled by handleAuthResponse in auth service
        } catch (error: any) {
          throw new Error(error.message || 'Failed to process Apple sign-in');
        }
      } else {
        // Fallback: Try using Apple SDK if no query params (shouldn't happen in redirect flow)
        await this.loadAppleScript();
        
        AppleID.auth.init({
          clientId: environment.appleClientId,
          scope: 'name email',
          redirectURI: environment.appleRedirectUri,
          usePopup: false
        });

        const response = await AppleID.auth.signIn();
        
        if (response && response.authorization && response.authorization.id_token) {
          await this.authService.handleAppleUser(response);
        } else {
          throw new Error('Invalid response from Apple: missing authorization data');
        }
      }
    } catch (error: any) {
      console.error('Apple callback error:', error);
      this.isProcessing = false;
      this.errorMessage = error?.error?.message || error?.message || 'Apple sign in failed. Please try again.';
    }
  }

  private loadAppleScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src*="appleid.auth.js"]')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Apple Sign-In script'));
      document.head.appendChild(script);
    });
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }
}
