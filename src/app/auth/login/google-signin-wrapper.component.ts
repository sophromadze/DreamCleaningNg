import {
  Component,
  Inject,
  PLATFORM_ID,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { SocialAuthService } from '@abacritt/angularx-social-login';
import { GoogleSigninButtonModule } from '@abacritt/angularx-social-login';
import { ThemeService } from '../../services/theme.service';

/**
 * Custom-styled "Sign in with Google" button. Renders the real Google button
 * off-screen and programmatically triggers it on our button click so it works
 * in modals and on iOS (library does not support programmatic signIn() for Google).
 */
@Component({
  selector: 'app-google-signin-wrapper',
  standalone: true,
  imports: [CommonModule, GoogleSigninButtonModule],
  template: `
    <div *ngIf="isBrowser" class="google-signin-inner">
      <button
        type="button"
        class="custom-google-btn"
        [disabled]="!googleReady"
        (click)="onGoogleClick()"
        aria-label="Sign in with Google">
        <span class="google-icon">
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        </span>
        <span>{{ !googleReady ? 'Loading...' : 'Sign in with Google' }}</span>
      </button>
      <!-- Real Google button, off-screen; we trigger it programmatically on our button click -->
      <div #googleBtnContainer class="google-btn-hidden">
        <asl-google-signin-button
          *ngIf="showGoogleButton"
          type="standard"
          size="large"
          text="signin_with"
          shape="rectangular"
          [theme]="googleButtonTheme"
          logo_alignment="center"
          [width]="400">
        </asl-google-signin-button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-height: 52px;
      border: none;
      position: relative;
      z-index: 1;
    }
    .google-signin-inner {
      position: relative;
      width: 100%;
      height: 52px;
      min-height: 52px;
    }
    .custom-google-btn {
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
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .custom-google-btn:hover:not(:disabled) {
      background: #f8f8f8;
      border-color: #c0c0c0;
    }
    .custom-google-btn:active:not(:disabled) {
      background: #eee;
    }
    .custom-google-btn:disabled {
      cursor: not-allowed;
      opacity: 0.8;
    }
    :host-context([data-theme="dark"]) .custom-google-btn {
      background: #202124;
      color: #fff;
      border-color: rgba(255, 255, 255, 0.15);
    }
    :host-context([data-theme="dark"]) .custom-google-btn:hover:not(:disabled) {
      background: #303134;
      border-color: rgba(255, 255, 255, 0.25);
    }
    :host-context([data-theme="dark"]) .custom-google-btn:active:not(:disabled) {
      background: #3c4043;
    }
    .google-icon {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .google-icon svg {
      width: 24px;
      height: 24px;
    }
    .google-btn-hidden {
      position: absolute;
      left: -10000px;
      top: 0;
      width: 400px;
      height: 52px;
      overflow: hidden;
    }
  `]
})
export class GoogleSigninWrapperComponent implements OnInit, AfterViewInit, OnDestroy {
  @Output() googleSignInError = new EventEmitter<string>();
  @ViewChild('googleBtnContainer') googleBtnContainerRef!: ElementRef<HTMLElement>;

  isBrowser = false;
  googleReady = false;
  showGoogleButton = false;
  googleButtonTheme: 'outline' | 'filled_black' = 'outline';
  private initSub: Subscription | null = null;
  private themeSub: Subscription | null = null;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private socialAuthService: SocialAuthService,
    private themeService: ThemeService
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    if (this.isBrowser && this.socialAuthService) {
      this.googleButtonTheme = this.themeService.theme === 'dark' ? 'filled_black' : 'outline';
      this.themeSub = this.themeService.theme$.subscribe(theme => {
        this.googleButtonTheme = theme === 'dark' ? 'filled_black' : 'outline';
      });
      this.initSub = this.socialAuthService.initState
        .pipe(
          filter((ready) => ready === true),
          take(1)
        )
        .subscribe(() => {
          this.googleReady = true;
          this.showGoogleButton = true;
        });
      setTimeout(() => {
        if (!this.googleReady) {
          this.googleReady = true;
          this.showGoogleButton = true;
        }
      }, 4000);
    } else {
      this.googleReady = true;
      this.showGoogleButton = true;
    }
  }

  ngAfterViewInit() {}

  ngOnDestroy() {
    this.initSub?.unsubscribe();
    this.themeSub?.unsubscribe();
    this.initSub = null;
    this.themeSub = null;
  }

  onGoogleClick() {
    if (!this.isBrowser || !this.googleReady) return;
    this.googleSignInError.emit('');
    const container = this.googleBtnContainerRef?.nativeElement;
    if (!container) {
      this.googleSignInError.emit('Sign-in is not ready. Please try again in a moment.');
      return;
    }
    const host = container.querySelector('asl-google-signin-button') as HTMLElement | null;
    const realButton = host?.querySelector('div[role="button"]') as HTMLElement | null;
    const clickTarget = realButton ?? host?.querySelector('iframe')?.parentElement;
    if (clickTarget) {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      clickTarget.dispatchEvent(ev);
    } else {
      this.googleSignInError.emit('Sign-in is not ready. Please try again in a moment.');
    }
  }
}
