import { DURATION_ROUNDING_MINUTES } from '../../utils/duration.utils';
import {
  calculateCleanerTotalSalary,
  calculatePerCleanerBillableMinutes
} from './order-pricing.calculator';

/**
 * CLEANER PAYROLL — RAISING THE CLEANER COUNT MUST NOT RAISE THE PAYOUT.
 *
 * Mirrors RaisingMaidsCount_NeverRaisesCleanerSalary in the backend's
 * PricingNoConfigurationRegressionTests. Both sides must agree exactly — the admin panel
 * previews the figure the backend then persists, so a drift here shows up as a number that
 * changes the moment the admin saves.
 *
 * The original bug: the per-cleaner share was rounded to the NEAREST increment and then
 * multiplied back by the cleaner count, so a 456-minute job paid 450 min (7h30) with one
 * cleaner but 2 x 240 min (2 x 4h) with two — +$10.50 for identical work.
 */
describe('cleaner total salary', () => {
  const RATE = 21;

  it('pays the same work no more for being split across more cleaners', () => {
    expect(calculateCleanerTotalSalary(456, 1, false, RATE)).toBe(157.5);
    expect(calculateCleanerTotalSalary(456, 2, false, RATE)).toBe(147);
  });

  it('drives the per-cleaner label from the same minutes it pays for', () => {
    // "3h 30m per cleaner" in the admin panel is exactly what the $147.00 is 2 x 3.5h of.
    expect(calculatePerCleanerBillableMinutes(456, 2, false)).toBe(210);
    expect(calculateCleanerTotalSalary(456, 2, false, RATE)).toBe(round2((210 / 60) * 2 * RATE));
  });

  it('never pays more at a higher cleaner count, across the whole grid', () => {
    for (let total = 60; total <= 1200; total++) {
      const atOne = calculateCleanerTotalSalary(total, 1, false, RATE);
      for (let maids = 2; maids <= 6; maids++) {
        // Skips the documented exception: a share below one increment is paid one increment
        // rather than $0, which is the only way the payout can go up.
        if (total / maids < DURATION_ROUNDING_MINUTES) continue;

        expect(calculateCleanerTotalSalary(total, maids, false, RATE))
          .withContext(`${total} min across ${maids} cleaners`)
          .toBeLessThanOrEqual(atOne);
      }
    }
  });

  it('pays one increment rather than nothing when the share floors to zero', () => {
    // 6 cleaners on a 1h job is 10 minutes each, which floors away entirely.
    expect(calculatePerCleanerBillableMinutes(60, 6, false)).toBe(DURATION_ROUNDING_MINUTES);
  });

  it('leaves cleaner-hours service types alone', () => {
    // There TotalDuration is already per-cleaner (the customer picked cleaners x hours), so it
    // still rounds to nearest and scales with the count.
    expect(calculateCleanerTotalSalary(180, 2, true, RATE)).toBe(126);
    expect(calculatePerCleanerBillableMinutes(180, 2, true)).toBe(180);
  });

  it('leaves single-cleaner orders on the historical nearest-increment rounding', () => {
    // 75 min -> 90 (halves away from zero), unchanged by this fix.
    expect(calculateCleanerTotalSalary(75, 1, false, 20)).toBe(30);
  });
});

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
