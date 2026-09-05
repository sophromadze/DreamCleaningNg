import {
  buildSupplyChecklistItems,
  CLEANING_ESSENTIALS_ITEMS,
  extraServiceNamesOf,
  hasCleaningEssentialsExtra,
  hasCleaningSuppliesExtra,
  hasVacuumExtra,
  isCleaningEssentialsExtra,
  requiresOvenCleaner,
  resolveSupplyChecklistFacts,
  zepLiquidsText
} from './supply-checklist.utils';

/** The list the customer is shown, for a plain (non-custom) booking with these extras. */
function checklistFor(extraNames: string[]): string[] {
  return buildSupplyChecklistItems(resolveSupplyChecklistFacts(extraNames, false));
}

describe('supply-checklist.utils', () => {
  it('reads names from both booking (name) and order (extraServiceName) shapes', () => {
    expect(extraServiceNamesOf([{ name: 'Oven Cleaning' }, { extraServiceName: 'Cleaning Supplies' }]))
      .toEqual(['oven cleaning', 'cleaning supplies']);
  });

  it('detects the cleaning supplies extra', () => {
    expect(hasCleaningSuppliesExtra(['cleaning supplies'])).toBe(true);
    expect(hasCleaningSuppliesExtra(['oven cleaning'])).toBe(false);
  });

  // The bug this file exists for: oven cleaning without deep cleaning still needs oven cleaner.
  it('requires oven cleaner for the oven extra even without deep cleaning', () => {
    expect(requiresOvenCleaner(['oven cleaning'])).toBe(true);
  });

  it('requires oven cleaner for deep and super deep cleaning', () => {
    expect(requiresOvenCleaner(['deep cleaning'])).toBe(true);
    expect(requiresOvenCleaner(['super deep cleaning'])).toBe(true);
  });

  it('does not require oven cleaner for a plain booking', () => {
    expect(requiresOvenCleaner([])).toBe(false);
    expect(requiresOvenCleaner(['cleaning supplies', 'laundry service'])).toBe(false);
  });

  it('phrases the Zep line the same way the email and SMS do', () => {
    expect(zepLiquidsText(true)).toBe('Green, Floor (or similar), Oven Cleaner (or similar)');
    expect(zepLiquidsText(false)).toBe('Green, Floor (or similar)');
  });

  // Cleaning Essentials and Cleaning Supplies are separate purchases that can be held together,
  // and each removes a DIFFERENT part of the list. Conflating them is the bug to watch for.
  describe('Cleaning Essentials', () => {
    it('is not matched by the cleaning-supplies check, and vice versa', () => {
      expect(hasCleaningSuppliesExtra(['cleaning essentials'])).toBe(false);
      expect(hasCleaningEssentialsExtra(['cleaning supplies'])).toBe(false);
      expect(hasCleaningEssentialsExtra(['cleaning essentials'])).toBe(true);
      expect(isCleaningEssentialsExtra('Cleaning Essentials')).toBe(true);
      expect(isCleaningEssentialsExtra('Cleaning Supplies')).toBe(false);
    });

    it('nothing bought: the customer provides everything (unchanged)', () => {
      expect(checklistFor([])).toEqual([
        'Paper towels',
        'Garbage bags',
        'Broom or vacuum cleaner',
        'Toilet brush',
        'Zep liquids: Green, Floor (or similar)',
        'Windex liquid (or similar)',
        'Cleaning cloths, Sponge and Mop'
      ]);
    });

    it('Cleaning Supplies only: the old four items (unchanged)', () => {
      expect(checklistFor(['cleaning supplies'])).toEqual([
        'Paper towels',
        'Garbage bags',
        'Broom or vacuum cleaner',
        'Toilet brush'
      ]);
    });

    // The broom joined the extra in 2026-09, so the whole group comes off at once and only the
    // products Cleaning Supplies would have brought are left.
    it('Cleaning Essentials only: just the products we would have brought', () => {
      expect(checklistFor(['cleaning essentials'])).toEqual([
        'Zep liquids: Green, Floor (or similar)',
        'Windex liquid (or similar)',
        'Cleaning cloths, Sponge and Mop'
      ]);
    });

    it('Supplies + Essentials: nothing at all', () => {
      expect(checklistFor(['cleaning supplies', 'cleaning essentials'])).toEqual([]);
    });

    it('covers the broom, so it is never also asked for', () => {
      expect(CLEANING_ESSENTIALS_ITEMS).toEqual(
        ['Paper towels', 'Garbage bags', 'Toilet brush', 'Broom']
      );
      expect(checklistFor(['cleaning essentials'])).not.toContain('Broom or vacuum cleaner');
    });

    it('keeps the oven-cleaner rule when only Essentials was bought', () => {
      expect(checklistFor(['cleaning essentials', 'oven cleaning'])).toContain(
        'Zep liquids: Green, Floor (or similar), Oven Cleaner (or similar)'
      );
    });
  });

  describe('Vacuum Cleaner extra', () => {
    it('is detected by name', () => {
      expect(hasVacuumExtra(['vacuum cleaner'])).toBe(true);
      expect(hasVacuumExtra(['cleaning supplies'])).toBe(false);
    });

    it('removes the broom-or-vacuum line, and only that line', () => {
      expect(checklistFor(['vacuum cleaner'])).toEqual([
        'Paper towels',
        'Garbage bags',
        'Toilet brush',
        'Zep liquids: Green, Floor (or similar)',
        'Windex liquid (or similar)',
        'Cleaning cloths, Sponge and Mop'
      ]);
    });

    // An empty checklist must render as "nothing to prepare" rather than as an empty bulleted
    // box under a "please provide" heading. It now takes only Supplies + Essentials to reach.
    it('all three extras leave an empty checklist', () => {
      expect(checklistFor(['cleaning supplies', 'cleaning essentials', 'vacuum cleaner'])).toEqual([]);
    });
  });

  it('a custom service type never gets the products block', () => {
    expect(buildSupplyChecklistItems(resolveSupplyChecklistFacts([], true)))
      .toEqual(['Paper towels', 'Garbage bags', 'Broom or vacuum cleaner', 'Toilet brush']);
  });
});
