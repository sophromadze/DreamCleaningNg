import { TestBed } from '@angular/core/testing';

import { FirstTimeOfferPopupComponent } from './first-time-offer-popup.component';
import { testProviders } from '../../testing/test-providers';

/**
 * The route allowlist is the only thing standing between a residential marketing popup and a
 * screen where it would be wrong — a working admin panel, the booking funnel, an auth form, or a
 * commercial agreement somebody is about to put their signature on.
 *
 * Prefix matching is by path SEGMENT, not string: '/booking' must not swallow
 * '/booking-confirmation', which is why those are listed separately in the component.
 */
describe('FirstTimeOfferPopupComponent — where it may appear', () => {
  let component: FirstTimeOfferPopupComponent;

  const hidden = (path: string) => component['isHiddenRoute'](path);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FirstTimeOfferPopupComponent],
      providers: [...testProviders]
    }).compileComponents();

    component = TestBed.createComponent(FirstTimeOfferPopupComponent).componentInstance;
  });

  it('never appears on any commercial-contract surface', () => {
    // All three signing channels, plus the lists they are reached from.
    expect(hidden('/contract/review/abc123')).toBe(true);
    expect(hidden('/contract/sign/abc123')).toBe(true);
    expect(hidden('/profile/contracts')).toBe(true);
    expect(hidden('/profile/contracts/42')).toBe(true);
    expect(hidden('/admin/contracts')).toBe(true);
    expect(hidden('/admin/contracts/42')).toBe(true);
  });

  it('still appears on the public marketing pages it exists for', () => {
    expect(hidden('/')).toBe(false);
    expect(hidden('/services/deep-cleaning')).toBe(false);
    expect(hidden('/reviews')).toBe(false);
  });

  it('matches on path segments, so a shared string prefix is not a match', () => {
    // '/contract' must not take out a page that merely starts with those letters.
    expect(hidden('/contractors-we-love')).toBe(false);
    expect(hidden('/booking-confirmation')).toBe(true);   // listed in its own right
  });
});
