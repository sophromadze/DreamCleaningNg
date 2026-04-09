import { Component, Inject, PLATFORM_ID, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';

declare const AppleID: any;

@Component({
  selector: 'app-apple-signin-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button *ngIf="isBrowser" 
            class="apple-signin-btn" 
            (click)="signInWithApple()"
            [disabled]="isLoading">
      <svg class="apple-icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
      </svg>
      <span>Sign in with Apple</span>
    </button>
  `,
  styles: [`
    :host {
      display: block;
      border: none;
    }
    .apple-signin-btn {
      width: 100%;
      height: 52px;
      min-height: 52px;
      padding: 0 16px;
      background: #fff;
      color: #1f1f1f;
      border: 1px solid #dadce0;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
    }
    .apple-signin-btn:hover:not(:disabled) {
      background: #f8f8f8;
      border-color: #c0c0c0;
    }
    .apple-signin-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .apple-icon {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .apple-icon svg {
      width: 24px;
      height: 24px;
    }
    :host-context([data-theme="dark"]) .apple-signin-btn {
      background: #202124;
      color: #fff;
      border-color: rgba(255, 255, 255, 0.15);
    }
    :host-context([data-theme="dark"]) .apple-signin-btn:hover:not(:disabled) {
      background: #303134;
      border-color: rgba(255, 255, 255, 0.25);
      color: #fff;
    }
    :host-context([data-theme="dark"]) .apple-icon {
      color: #fff;
    }
  `]
})
export class AppleSigninButtonComponent implements OnInit {
  isBrowser = false;
  isLoading = false;
  
  @Output() appleSignIn = new EventEmitter<any>();
  @Output() appleError = new EventEmitter<any>();

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    if (this.isBrowser) {
      this.loadAppleScript();
    }
  }

  private loadAppleScript(): Promise<void> {
    return new Promise((resolve) => {
      if (document.querySelector('script[src*="appleid.auth.js"]')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
      script.async = true;
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }

  async signInWithApple() {
    this.isLoading = true;
    try {
      await this.loadAppleScript();
      
      // Check if we're on mobile (iOS/Safari) - use popup for mobile, redirect for desktop
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const usePopup = isMobile;
      
      // Initialize Apple Sign-In
      AppleID.auth.init({
        clientId: environment.appleClientId,
        scope: 'name email',
        redirectURI: environment.appleRedirectUri,
        usePopup: usePopup
      });
      
      if (usePopup) {
        // Mobile: Use popup flow
        const response = await AppleID.auth.signIn();
        if (response && response.authorization) {
          this.appleSignIn.emit(response);
        } else {
          throw new Error('Invalid response from Apple');
        }
      } else {
        // Desktop: Use redirect flow - will redirect to callback page
        await AppleID.auth.signIn();
        // Don't set isLoading to false here as page will redirect
      }
    } catch (error: any) {
      this.isLoading = false;
      // Don't emit error for popup closed by user
      if (error?.error !== 'popup_closed_by_user' && error?.error !== 'user_cancelled') {
        console.error('Apple Sign-In error:', error);
        this.appleError.emit(error);
      } else {
        this.isLoading = false;
      }
    }
  }
}
