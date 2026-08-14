import {
  getSquareFeetForBedrooms,
  resolveSquareFeetForBedroomChange,
  clampRestoredSquareFeet
} from './order-pricing.calculator';

/**
 * BEDROOMS → SQ.FT LINKAGE.
 *
 * The original bug: changing the bedroom count reset Sq.ft to the new bedroom's included
 * amount unconditionally, discarding a value the customer had deliberately chosen — 2
 * bedrooms at 2650 sq.ft collapsed to 1000 the instant they picked a third bedroom.
 *
 * The rule separates a CHOSEN value from an INHERITED one: sitting exactly on the previous
 * floor means it was never chosen, so it keeps tracking the floor in both directions;
 * anything above the floor is the customer's and is only ever raised.
 *
 * Restores are deliberately governed by a different rule (clampRestoredSquareFeet) — see
 * the bottom of this file.
 */
describe('bedrooms → sq.ft linkage', () => {
  // Floors resolved through the shared lookup with no catalog loaded, i.e. the shipped
  // seed values: studio 400 / 1bd 650 / 2bd 850 / 3bd 1000 / 4bd 1500 / 5bd 1800 / 6bd 2000.
  const floorFor = (bedrooms: number) => getSquareFeetForBedrooms(bedrooms);

  const change = (currentSqft: number, fromBedrooms: number, toBedrooms: number) =>
    resolveSquareFeetForBedroomChange(currentSqft, floorFor(fromBedrooms), floorFor(toBedrooms));

  describe('a value ABOVE the old floor is the customer’s and survives', () => {
    it('keeps 2650 when 2bd becomes 3bd', () => {
      expect(change(2650, 2, 3)).toBe(2650);
    });

    it('keeps 1200 when 3bd becomes 2bd', () => {
      expect(change(1200, 3, 2)).toBe(1200);
    });

    it('raises it only when the new floor overtakes it', () => {
      // 950 sits above the 2bd floor of 850 but below the 3bd floor of 1000.
      expect(change(950, 2, 3)).toBe(1000);
    });
  });

  describe('a value sitting ON the old floor was never chosen and tracks the new one', () => {
    it('follows the floor upward', () => {
      expect(change(400, 0, 1)).toBe(650);
    });

    it('follows the floor downward too', () => {
      expect(change(1000, 3, 2)).toBe(850);
      expect(change(1500, 4, 3)).toBe(1000);
    });
  });

  it('never returns a value below the new floor, across the whole bedroom grid', () => {
    for (let from = 0; from <= 6; from++) {
      for (let to = 0; to <= 6; to++) {
        for (const sqft of [0, 400, 850, 950, 1000, 1500, 2650, 5000]) {
          expect(change(sqft, from, to)).toBeGreaterThanOrEqual(floorFor(to));
        }
      }
    }
  });

  it('treats a missing or non-numeric current value as zero, i.e. takes the new floor', () => {
    expect(resolveSquareFeetForBedroomChange(NaN, 850, 1000)).toBe(1000);
    expect(resolveSquareFeetForBedroomChange(undefined as any, 850, 1000)).toBe(1000);
  });

  /**
   * A restore has no "previous bedroom count", and the stored figure is by definition an
   * explicit customer choice — so it is floored and NEVER lowered. Applying the
   * bedroom-change rule here instead would silently drop a stored value that happened to
   * equal some other bedroom count's floor.
   */
  describe('restoring a stored value floors it without ever lowering it', () => {
    it('preserves a stored value above the floor', () => {
      expect(clampRestoredSquareFeet(2650, floorFor(3))).toBe(2650);
    });

    it('lifts a stored value that now sits below its allowance', () => {
      // e.g. the Sq.ft allowance was raised after the order was placed.
      expect(clampRestoredSquareFeet(700, floorFor(2))).toBe(850);
    });

    it('leaves a stored value exactly on the floor alone', () => {
      expect(clampRestoredSquareFeet(1000, floorFor(3))).toBe(1000);
    });
  });
});
