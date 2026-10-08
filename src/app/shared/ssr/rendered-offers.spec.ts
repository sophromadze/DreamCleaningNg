import { TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PublicSpecialOffer } from '../../services/special-offer.service';
import { resolveRenderedOffers } from './rendered-offers';

describe('resolveRenderedOffers', () => {
  const key = makeStateKey<PublicSpecialOffer[]>('spec.offers');
  const offer = (id: number, offerKey: string | null): PublicSpecialOffer => ({
    id, name: 'Offer ' + id, description: '', isPercentage: true, discountValue: 10, type: 'Custom',
    requiresFirstTimeCustomer: offerKey === 'first-time', offerKey
  });
  let transferState: TransferState;

  beforeEach(() => { transferState = TestBed.inject(TransferState); });

  it('on the server, reduces the catalogue to the advertised first-time offer and hands it over', () => {
    const offers = [offer(1, null), offer(2, 'first-time')];
    const list = resolveRenderedOffers(key, { isBrowser: false, hydrating: false, transferState, ssrCatalogue: { serviceTypes: null, prices: {} as any, publicOffers: offers } });

    expect(list!.map(o => o.id)).toEqual([2]);
    expect(transferState.get(key, null)!.map(o => o.id)).toEqual([2]);
  });

  it('on the server without a catalogue copy, leaves it to the browser', () => {
    expect(resolveRenderedOffers(key, { isBrowser: false, hydrating: false, transferState, ssrCatalogue: null })).toBeNull();
    expect(transferState.hasKey(key)).toBe(false);
  });

  it('while hydrating, uses exactly what the server rendered from, once', () => {
    transferState.set(key, [offer(2, 'first-time')]);

    const list = resolveRenderedOffers(key, { isBrowser: true, hydrating: true, transferState, ssrCatalogue: null });

    expect(list!.map(o => o.id)).toEqual([2]);
    expect(transferState.hasKey(key)).toBe(false);
  });

  it('after an in-app navigation, asks the caller to fetch', () => {
    transferState.set(key, [offer(2, 'first-time')]);
    expect(resolveRenderedOffers(key, { isBrowser: true, hydrating: false, transferState, ssrCatalogue: null })).toBeNull();
  });
});
