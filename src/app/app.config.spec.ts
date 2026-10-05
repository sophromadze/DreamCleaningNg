import { TestBed } from '@angular/core/testing';
import { SOCIAL_AUTH_CONFIG, SocialAuthService } from '@abacritt/angularx-social-login';
import { appConfig } from './app.config';

/**
 * THE APP'S OWN PROVIDERS MUST GIVE SocialAuthService ITS CONFIG (2026-10, Angular 22 upgrade).
 *
 * angularx-social-login 2.5+ injects the SOCIAL_AUTH_CONFIG token. app.config.ts provided the old
 * 'SocialAuthServiceConfig' string, which nothing reads any more, so the service could not be
 * created: the server render dropped the whole social-login block (NG0201) and the Google button
 * would have had no service in the browser. Every other spec supplies its own config double, so
 * only a spec built from appConfig itself can catch this.
 */
describe('appConfig — social login', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: appConfig.providers }));

  it('provides the config under the token the library injects', () => {
    expect(TestBed.inject(SOCIAL_AUTH_CONFIG, null)).not.toBeNull();
  });

  it('can create SocialAuthService', () => {
    expect(TestBed.inject(SocialAuthService)).toBeTruthy();
  });
});
