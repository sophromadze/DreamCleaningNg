import { ApplicationConfig, PLATFORM_ID, APP_ID, provideZoneChangeDetection, provideAppInitializer, inject } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptorsFromDi, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay, withIncrementalHydration } from '@angular/platform-browser';
import { authInterceptor } from './interceptors/auth.interceptor';
import { importProvidersFrom } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { 
  SocialLoginModule, 
  SocialAuthServiceConfig,
  GoogleLoginProvider,
  GoogleSigninButtonModule
} from '@abacritt/angularx-social-login';
import { environment } from '../environments/environment';
import { ScrollRestoreService } from './services/scroll-restore.service';

// Auth is no longer awaited in APP_INITIALIZER so that protected routes (profile, admin)
// can show a loading shimmer until auth is ready instead of flashing the login page.

// Environment detection for SSR
const getSocialAuthConfig = (platformId: Object): SocialAuthServiceConfig => {
  if (isPlatformBrowser(platformId)) {
    return {
      autoLogin: false,
      lang: 'en',
      providers: [
        {
          id: GoogleLoginProvider.PROVIDER_ID,
          provider: new GoogleLoginProvider(
            environment.googleClientId,
            {
              oneTapEnabled: false, // Disable One Tap to avoid FedCM issues for now
              prompt: 'select_account'
            }
          )
        }
      ],
      onError: (err) => {
        console.error('Social auth error:', err);
      }
    } as SocialAuthServiceConfig;
  }
  
  // Return empty config for server-side rendering
  return {
    autoLogin: false,
    providers: [],
    onError: (err) => {
      console.error(err);
    }
  } as SocialAuthServiceConfig;
};

export const appConfig: ApplicationConfig = {
  providers: [
    // Add APP_ID for SSR
    { provide: APP_ID, useValue: 'dream-cleaning-app' },
    
    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor])
    ),
    provideZoneChangeDetection({ eventCoalescing: true }),
    
    // Client hydration with event replay, plus incremental hydration: `@defer (hydrate on ...)`
    // blocks (footer, below-the-fold home sections) are server-rendered in full but stay
    // dehydrated - no JS downloaded, no hydration work - until their trigger fires. Developer
    // preview in Angular 19. Those blocks also carry `on immediate`: hydration ignores it, but a
    // CLIENT-side render of the page (navigating to it in the app) needs a regular trigger, or
    // the block would wait for idle and pop in after the rest of the page.
    // FALLBACK to full hydration takes BOTH steps: delete withIncrementalHydration() here AND
    // unwrap every block tagged [incremental-hydration] (keep the content, drop the
    // `@defer (on immediate; hydrate ...) {` line and its closing brace). Removing only this
    // provider is not enough: without it the server renders a @defer block's placeholder instead
    // of its content, which would take those sections out of the SEO HTML.
    provideClientHydration(withEventReplay(), withIncrementalHydration()),
    
    provideRouter(
      routes,
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),
    // Back/Forward restores land without the animated trip from the top - see ScrollRestoreService.
    // Started before the first navigation so its bookkeeping matches the router's.
    provideAppInitializer(() => {
      if (isPlatformBrowser(inject(PLATFORM_ID))) inject(ScrollRestoreService).start();
    }),

    // Social auth configuration with platform check
    {
      provide: 'SocialAuthServiceConfig',
      useFactory: (platformId: Object) => getSocialAuthConfig(platformId),
      deps: [PLATFORM_ID]
    },
    
    importProvidersFrom(SocialLoginModule, GoogleSigninButtonModule)
  ],
};