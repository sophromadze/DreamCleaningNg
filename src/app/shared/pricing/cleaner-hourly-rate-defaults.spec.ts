import { getDefaultCleanerHourlyRate } from './order-pricing.calculator';

/**
 * Frontend mirror of CleanerHourlyRateDefaultsTests.cs. Every case below exists there too —
 * the assign-cleaners modal seeds its rate from this function while the booking flow stamps the
 * backend's, so the two disagreeing means an order is created at one rate and offered at another.
 *
 * Owner's rates (2026-08): regular 20, deep 21, move in/out 21, office 20, custom 20,
 * post construction 25, heavy 25, filthy 28.
 */
describe('default cleaner hourly rate', () => {
  const NO_DEEP = 0;
  const DEEP = 50;

  it('pays the base rate for regular, office and an unrecognised custom label', () => {
    for (const name of ['Residential Cleaning', 'Office Cleaning', 'Regular', 'Custom', '', null]) {
      expect(getDefaultCleanerHourlyRate(NO_DEEP, name)).toBe(20);
    }
  });

  it('pays the mid rate for residential deep cleaning', () => {
    expect(getDefaultCleanerHourlyRate(DEEP, 'Residential Cleaning')).toBe(21);
  });

  /**
   * A Custom ("Pre-Arranged") order labelled "Deep" carries NO deep-cleaning extra — that extra
   * is deliberately filtered out of the custom extras grid — so the fee is 0 and the rate has to
   * come off the label. It used to fall through to $20 and then warn the owner that his own
   * correct $21 order was wrong.
   */
  it('pays the mid rate off the NAME when there is no deep extra to read', () => {
    expect(getDefaultCleanerHourlyRate(NO_DEEP, 'Deep')).toBe(21);
    expect(getDefaultCleanerHourlyRate(NO_DEEP, 'Deep Cleaning')).toBe(21);
    expect(getDefaultCleanerHourlyRate(NO_DEEP, 'Super Deep Cleaning')).toBe(21);
  });

  it('pays the mid rate for move in/out even without the deep extra', () => {
    for (const name of ['Move In/Out Cleaning', 'move-in-out cleaning', 'Move Out Cleaning']) {
      expect(getDefaultCleanerHourlyRate(NO_DEEP, name)).toBe(21);
    }
  });

  it('pays the top rate for heavy condition and post construction', () => {
    for (const name of ['Heavy Condition Cleaning', 'Heavy Conditional Cleaning',
                        'Post Construction Cleaning', 'post-construction cleaning']) {
      expect(getDefaultCleanerHourlyRate(NO_DEEP, name)).toBe(25);
    }
  });

  it('pays the highest rate for a filthy job', () => {
    expect(getDefaultCleanerHourlyRate(NO_DEEP, 'Filthy Cleaning')).toBe(28);
    expect(getDefaultCleanerHourlyRate(NO_DEEP, 'filthy')).toBe(28);
  });

  // Keyword order is part of the contract: filthy is tested before heavy.
  it('lets filthy outrank heavy when a label names both', () => {
    expect(getDefaultCleanerHourlyRate(NO_DEEP, 'Heavy / Filthy Cleaning')).toBe(28);
  });

  it('lets a name-matched rate outrank the deep-cleaning extra', () => {
    expect(getDefaultCleanerHourlyRate(DEEP, 'Heavy Condition Cleaning')).toBe(25);
    expect(getDefaultCleanerHourlyRate(DEEP, 'Filthy Cleaning')).toBe(28);
  });
});
