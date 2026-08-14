import {
  extraServiceNamesOf,
  hasCleaningSuppliesExtra,
  requiresOvenCleaner,
  zepLiquidsText
} from './supply-checklist.utils';

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
});
