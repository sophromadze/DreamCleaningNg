import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { GiftCardsComponent } from './gift-cards.component';
import { GIFT_CARD_DEFAULT_BACKGROUND } from '../shared/gift-card-background';

import { testProviders } from '../../testing/test-providers';

describe('GiftCardsComponent', () => {
  let component: GiftCardsComponent;
  let fixture: ComponentFixture<GiftCardsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [GiftCardsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GiftCardsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

// ===== Gift card background (2026-10) =====

describe('GiftCardsComponent background', () => {
  let fixture: ComponentFixture<GiftCardsComponent>;
  let http: HttpTestingController;
  const RealImage = window.Image;
  /** URLs the fake Image treats as missing (404). */
  let broken: Set<string>;

  beforeEach(async () => {
    localStorage.removeItem('giftCardBackground');
    broken = new Set();
    // Resolve image loads synchronously by URL instead of hitting the network.
    (window as any).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) { (broken.has(value) ? this.onerror : this.onload)?.(); }
    };

    await TestBed.configureTestingModule({ providers: [...testProviders], imports: [GiftCardsComponent] }).compileComponents();
    fixture = TestBed.createComponent(GiftCardsComponent);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    (window as any).Image = RealImage;
    localStorage.removeItem('giftCardBackground');
  });

  const answerConfig = (body: object) => {
    fixture.detectChanges();
    http.match(r => r.url.endsWith('/api/admin/gift-card-config')).forEach(r => r.flush(body));
  };

  it('shows the background the server says is in effect, with no preload link and no cache-buster', () => {
    answerConfig({ backgroundImagePath: '/uploads/gift-cards/gift-card-bg-abc.webp' });

    expect(fixture.componentInstance.giftCardBackgroundPath).toBe('/uploads/gift-cards/gift-card-bg-abc.webp');
    expect(document.querySelector('link[rel="preload"][data-gift-card]')).toBeNull();
  });

  it('falls back to the default when the configured image cannot load', () => {
    broken.add('/uploads/gift-cards/gone.webp');
    answerConfig({ backgroundImagePath: '/uploads/gift-cards/gone.webp' });

    expect(fixture.componentInstance.giftCardBackgroundPath).toBe(GIFT_CARD_DEFAULT_BACKGROUND);
    expect(fixture.componentInstance.isLoadingBackground).toBeFalse();
  });

  it('never paints a cached background that no longer loads', () => {
    localStorage.setItem('giftCardBackground', '/images/gift-card-bg-20260227215142.webp');
    broken.add('/images/gift-card-bg-20260227215142.webp');
    const painted: string[] = [];
    const component = fixture.componentInstance;
    let current = '';
    Object.defineProperty(component, 'giftCardBackgroundPath', {
      get: () => current,
      set: (v: string) => { current = v; painted.push(v); },
      configurable: true,
    });

    answerConfig({ backgroundImagePath: '/uploads/gift-cards/gift-card-bg-new.webp' });

    expect(painted).not.toContain('/images/gift-card-bg-20260227215142.webp');
    expect(current).toBe('/uploads/gift-cards/gift-card-bg-new.webp');
    expect(localStorage.getItem('giftCardBackground')).toBe('/uploads/gift-cards/gift-card-bg-new.webp');
  });

  it('uses the default when the config request fails', () => {
    fixture.detectChanges();
    http.match(r => r.url.endsWith('/api/admin/gift-card-config'))
      .forEach(r => r.flush('nope', { status: 500, statusText: 'Server Error' }));

    expect(fixture.componentInstance.giftCardBackgroundPath).toBe(GIFT_CARD_DEFAULT_BACKGROUND);
  });
});
