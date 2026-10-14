import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { HeaderComponent } from './header.component';

import { testProviders } from '../../testing/test-providers';
import { ANONYMOUS_UI_HINT, decodeUiHint, writeUiHintCookie } from '../shared/ssr/ui-hint-cookie';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [HeaderComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

/**
 * THE HEADER DOES NOT MOVE WHILE THE PAGE LOADS (2026-10).
 *
 * Before auth resolves, the header is drawn from the dc_ui layout hint - the same input the
 * server rendered from - so the admin time pill and the points badge slot are already in the
 * first frame, and the phone/quote items are always rendered (CSS decides where they show).
 */
describe('HeaderComponent — stable layout from the first paint', () => {
  const create = async (hint: string | null) => {
    writeUiHintCookie(document, hint ? decodeUiHint(hint) : ANONYMOUS_UI_HINT);
    await TestBed.configureTestingModule({ providers: [...testProviders], imports: [HeaderComponent] }).compileComponents();
    const fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
    return { fixture, header: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  };
  afterEach(() => writeUiHintCookie(document, ANONYMOUS_UI_HINT));

  it('renders an admin\'s time pill and the WHOLE points badge before auth has resolved', async () => {
    const { header, el } = await create('ua');
    expect(header.showAuthUI()).toBe(false);
    expect(el.querySelector('.ny-time-clock')?.textContent?.trim()).toMatch(/^\d{1,2}:\d{2}$/);
    // Drawn, not just reserved (2026-10): frame, bubbles and "POINTS" are there; only the number
    // slot is empty until the summary loads.
    const badge = el.querySelector('app-bubble-badge .bubble-badge') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.classList).not.toContain('bubble-badge--reserved');
    expect(badge.getAttribute('aria-hidden')).toBeNull();
    expect(badge.querySelector('.bb-cluster')).not.toBeNull();
    expect(badge.querySelector('.bubble-badge__tier')?.textContent?.trim()).toBe('Points');
    expect(badge.querySelector('.bubble-badge__points')?.textContent?.trim()).toBe('');
  });

  it('draws the badge for a signed-in customer too, including on a first login with no badge history', async () => {
    const { el } = await create('u');
    expect(el.querySelector('app-bubble-badge .bubble-badge')).not.toBeNull();
    expect(el.querySelector('.ny-time-clock')).toBeNull();
  });

  it('still draws the badge for a cookie written by the first release ("ufb")', async () => {
    const { el } = await create('ufb');
    expect(el.querySelector('app-bubble-badge .bubble-badge')).not.toBeNull();
  });

  it('draws neither for an anonymous visitor', async () => {
    const { el } = await create(null);
    expect(el.querySelector('.ny-time-clock')).toBeNull();
    expect(el.querySelector('app-bubble-badge')).toBeNull();
  });

  it('keeps no badge slot for a customer whose points system reported off', async () => {
    const { el } = await create('un');
    expect(el.querySelector('app-bubble-badge')).toBeNull();
    expect(el.querySelector('.ny-time-clock')).toBeNull();
  });

  it('always renders the mobile phone and quote items (the stylesheet decides where they show)', async () => {
    const { el } = await create(null);
    expect(el.querySelector('.mobile-phone-icon')).not.toBeNull();
    expect(el.querySelector('.mobile-quote-btn')).not.toBeNull();
  });

  it('switches to the real state once auth has resolved', async () => {
    const { fixture, header, el } = await create('ua');
    header.showAuthUI.set(true);   // auth resolved: nobody is signed in after all
    header.currentUser.set(null);
    fixture.detectChanges();
    expect(el.querySelector('app-bubble-badge')).toBeNull();
    expect(header.clockVisible).toBe(false);
  });

  it('drops the badge slot when the points system turns out to be off', async () => {
    const { fixture, header, el } = await create('ua');
    header.showAuthUI.set(true);
    header.currentUser.set({ role: 'Admin', firstName: 'A', lastName: 'B' });
    header.onPointsBadgeAvailability(false);
    fixture.detectChanges();
    expect(el.querySelector('app-bubble-badge')).toBeNull();
  });
});

/**
 * MOBILE MENU: the section labels open their section, they do not navigate (2026-10).
 *
 * "Cleaning Services" and "About" used to carry routerLink, and RouterLink navigates on its own
 * click listener whatever the handler does with preventDefault — so a tap meant to open the
 * accordion went to the page instead. The overview page is the "All Services" link inside.
 */
describe('HeaderComponent — mobile menu section toggles', () => {
  let fixture: ComponentFixture<HeaderComponent>;
  let header: HeaderComponent;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ providers: [...testProviders], imports: [HeaderComponent] }).compileComponents();
    fixture = TestBed.createComponent(HeaderComponent);
    header = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  const click = (init: MouseEventInit = {}) => new MouseEvent('click', { cancelable: true, ...init });

  it('carries no routerLink on the section labels, only a crawlable href', () => {
    const el = fixture.nativeElement as HTMLElement;
    const services = el.querySelector('.services-dropdown > a')!;
    const about = el.querySelector('.about-dropdown > a')!;
    expect(services.getAttribute('href')).toBe('/service-page');
    expect(about.getAttribute('href')).toBe('/about');
    expect(services.hasAttribute('ng-reflect-router-link')).toBe(false);
    expect(el.querySelector('.mobile-all-services a')!.textContent!.trim()).toBe('All Services');
  });

  it('opens and closes Cleaning Services on mobile without navigating', () => {
    header.isMobile.set(true);
    const navigate = vi.spyOn(router, 'navigate');

    const first = click();
    header.onServicesClick(first);
    expect(first.defaultPrevented).toBe(true);
    expect(header.isServicesMenuOpen()).toBe(true);

    header.onServicesClick(click());
    expect(header.isServicesMenuOpen()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens About on mobile without navigating', () => {
    header.isMobile.set(true);
    const navigate = vi.spyOn(router, 'navigate');
    const e = click();
    header.onAboutClick(e);
    expect(e.defaultPrevented).toBe(true);
    expect(header.isAboutMenuOpen()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still goes to the page on desktop, and leaves a ctrl-click to the browser', () => {
    header.isMobile.set(false);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const plain = click();
    header.onServicesClick(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/service-page']);

    navigate.mockClear();
    const newTab = click({ ctrlKey: true });
    header.onServicesClick(newTab);
    expect(newTab.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
