import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { StickyMobileCtaComponent } from './sticky-mobile-cta.component';
import { SpecialOfferService, PublicSpecialOffer } from '../services/special-offer.service';

import { testProviders } from '../../testing/test-providers';

describe('StickyMobileCtaComponent', () => {
  let fixture: ComponentFixture<StickyMobileCtaComponent>;
  let offers$: Subject<PublicSpecialOffer[]>;
  let width: number;

  beforeEach(async () => {
    width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    offers$ = new Subject<PublicSpecialOffer[]>();
    await TestBed.configureTestingModule({
      providers: [...testProviders, { provide: SpecialOfferService, useValue: { getPublicSpecialOffers: () => offers$ } }],
      imports: [StickyMobileCtaComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(StickyMobileCtaComponent);
  });

  afterEach(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }));

  const bar = () => (fixture.nativeElement as HTMLElement).querySelector('.sticky-mobile-cta');

  // Drawing the bar before the offer arrived and adding "- 10% Off First Cleaning" afterwards slid
  // "Book Online" sideways - a layout shift on every mobile page load.
  it('appears only once the offer is known, already carrying it', async () => {
    fixture.detectChanges();
    expect(bar()).toBeNull();

    offers$.next([{ id: 1, name: 'First', description: '', isPercentage: true, discountValue: 10, type: 'Custom', requiresFirstTimeCustomer: true, offerKey: 'first-time' }]);
    await fixture.whenStable();

    expect(bar()).not.toBeNull();
    expect(bar()!.textContent).toContain('10% Off First Cleaning');
  });

  it('still appears, without the offer line, when the offers cannot be loaded', async () => {
    fixture.detectChanges();
    offers$.error(new Error('down'));
    await fixture.whenStable();

    expect(bar()).not.toBeNull();
    expect(bar()!.querySelector('.cta-book-offer')).toBeNull();
  });
});
