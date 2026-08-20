import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CustomerStatsComponent } from './customer-stats.component';
import { CustomerStatistics } from '../../../../services/customer-stats.service';
import { testProviders } from '../../../../../testing/test-providers';

/**
 * The Customers tab renders the same payload three ways — Simple, Full and the comparison table —
 * and the two rules below are the ones that make that safe. Both are easy to break by adding a
 * metric and forgetting a list, which is exactly why they are asserted rather than trusted:
 *
 *  1. Simple's comparison table is a CURATED nine-row subset, not "the first nine metrics".
 *  2. A rate on a denominator under 10 is never printed as a number, in ANY view — nor is its
 *     delta, nor may it win the comparison table's "best" chip.
 */
describe('CustomerStatsComponent', () => {
  let component: CustomerStatsComponent;
  let fixture: ComponentFixture<CustomerStatsComponent>;

  /** A complete payload; every test overrides only the handful of fields it cares about. */
  function makeStats(overrides: Partial<CustomerStatistics> = {}): CustomerStatistics {
    return {
      from: '2026-08-01', to: '2026-08-31',
      activeCustomers: 40, newCustomers: 30, returningCustomers: 10, repeatCustomers: 4,
      reactivatedCustomers: 0,
      recentlyActiveCustomers: 8, recentlyActiveRate: 20,
      medianDaysBetweenBookings: 22, medianGapSampleSize: 30,
      medianWindowFrom: '2025-08-31', medianWindowTo: '2026-08-31',
      previousActiveCustomers: 35, retainedCustomers: 5, lapsedCustomers: 30,
      returningRate: 25, newRate: 75, repeatRate: 10, retentionRate: 14.3, churnRate: 85.7,
      repeatOrderShare: 20,
      totalOrders: 45, newCustomerOrders: 33, returningCustomerOrders: 12, ordersPerCustomer: 1.13,
      totalSpend: 9000, newCustomerSpend: 6000, returningCustomerSpend: 3000,
      averageOrderValue: 200, spendPerCustomer: 225, newCustomerAov: 181.8, returningCustomerAov: 250,
      signups: 20, signupsWhoBooked: 12, activationRate: 60,
      recurringPlanCustomers: 0, recurringPlanRate: 0,
      followUpsLogged: 14, leadsFollowedUp: 9, followedUpCustomers: 5,
      returningAfterFollowUp: 3, returningWithoutFollowUp: 7,
      followUpAssistedRate: 30, followUpAssistedSpend: 1200,
      frequency: [], topCustomers: [],
      ...overrides
    };
  }

  /** Loads a window (and optionally the period before it) without touching the HTTP layer. */
  function load(current: CustomerStatistics, previous: CustomerStatistics | null = null): void {
    component.stats = current;
    component.prevStats = previous;
    component['buildCards']();
  }

  function compareOn(periods: CustomerStatistics[]): void {
    component.compareResults = periods.map((stats, i) => ({
      label: `P${i}`, rangeLabel: '', from: '2026-08-01', to: '2026-08-31', stats
    }));
    component['buildCompareView']();
  }

  beforeEach(async () => {
    // The view preference is persisted, and the component reads it in its CONSTRUCTOR — so a test
    // that flips to Full would otherwise decide the default for whichever test ran next.
    localStorage.clear();

    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [CustomerStatsComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CustomerStatsComponent);
    component = fixture.componentInstance;
    // Deliberately no detectChanges(): ngOnInit would fire the HTTP loads and the chart build.
    // Every test here drives the pure state-building methods directly.
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults to the Simple view', () => {
    expect(component.viewMode).toBe('simple');
  });

  // ── The Simple row subset used by Compare ────────────────────────────────

  describe('Simple comparison row subset', () => {
    it('renders exactly the nine curated rows, in Simple order', () => {
      component.viewMode = 'simple';
      compareOn([makeStats(), makeStats()]);

      expect(component.compareRows.map(r => r.def.key)).toEqual([
        'activeCustomers', 'newCustomers', 'returningCustomers', 'returningRate',
        'totalSpend', 'returningCustomerSpend',
        'returningAfterFollowUp', 'leadsFollowedUp', 'followUpsLogged'
      ]);
    });

    it('covers every Simple card and subline, so no card is missing from the comparison', () => {
      const cardKeys = component.simpleCardDefs.flatMap(
        c => [c.key, ...(c.sublineKey ? [c.sublineKey] : [])]);
      cardKeys.forEach(key => expect(component.simpleCompareKeys).toContain(key));
    });

    it('prints no group headers in Simple — nine curated rows need no sections', () => {
      component.viewMode = 'simple';
      compareOn([makeStats(), makeStats()]);
      expect(component.compareRows.every(r => !r.groupStart)).toBe(true);
    });

    it('falls back to every metric in Full, with its group headers', () => {
      component.viewMode = 'full';
      compareOn([makeStats(), makeStats()]);

      expect(component.compareRows.length).toBeGreaterThan(component.simpleCompareKeys.length);
      expect(component.compareRows.some(r => r.groupStart)).toBe(true);
      expect(component.compareRows.map(r => r.def.key)).toContain('retentionRate');
    });

    it('switching view rebuilds the comparison without refetching', () => {
      component.viewMode = 'simple';
      compareOn([makeStats(), makeStats()]);
      component.compareMode = true;

      component.setViewMode('full');

      expect(component.compareRows.length).toBeGreaterThan(9);
      // The loaded periods are untouched — the toggle is a rendering choice, not a reload.
      expect(component.compareResults.length).toBe(2);
    });
  });

  // ── Small-sample suppression ─────────────────────────────────────────────

  describe('small-sample suppression', () => {
    function rateCard(stats: CustomerStatistics, key = 'returningRate') {
      load(stats);
      return component.groupedCards
        .flatMap(g => g.cards)
        .find(c => c.def.key === key)!;
    }

    it('suppresses a rate whose denominator is below 10', () => {
      const card = rateCard(makeStats({ activeCustomers: 9, returningRate: 44.4 }));
      expect(card.suppressed).toBe(true);
      expect(card.sample).toBe(9);
    });

    it('prints a rate at exactly 10 — the threshold is inclusive', () => {
      const card = rateCard(makeStats({ activeCustomers: 10, returningRate: 30 }));
      expect(card.suppressed).toBe(false);
    });

    it('never suppresses a count, however small', () => {
      const card = rateCard(makeStats({ activeCustomers: 2, returningCustomers: 1 }),
        'returningCustomers');
      expect(card.suppressed).toBe(false);
    });

    it('uses each rate its OWN denominator, not the customer count', () => {
      // 40 customers served, but only 3 sign-ups and 4 returning customers. The rates hanging off
      // those thin denominators must go, while the ones hanging off 40 stay.
      load(makeStats({ activeCustomers: 40, signups: 3, returningCustomers: 4 }));
      const byKey = (k: string) =>
        component.groupedCards.flatMap(g => g.cards).find(c => c.def.key === k)!;

      expect(byKey('returningRate').suppressed).toBe(false);
      expect(byKey('activationRate').suppressed).toBe(true);
      expect(byKey('followUpAssistedRate').suppressed).toBe(true);
    });

    it('suppresses the delta when EITHER period is too small', () => {
      // A green arrow beside a dash is worse than either alone.
      load(makeStats({ activeCustomers: 40, returningRate: 30 }),
        makeStats({ activeCustomers: 4, returningRate: 50 }));
      const card = component.groupedCards.flatMap(g => g.cards)
        .find(c => c.def.key === 'returningRate')!;

      expect(card.suppressed).toBe(false);
      expect(card.delta).toBeNull();
      expect(component.hasDelta(card)).toBe(false);
    });

    it('drops a suppressed subline from a Simple card rather than printing a dash under it', () => {
      component.viewMode = 'simple';
      load(makeStats({ activeCustomers: 5, returningCustomers: 2, returningRate: 40 }));
      const card = component.simpleCards.find(c => c.card.def.key === 'returningCustomers')!;

      expect(card.card.value).toBe(2);
      expect(card.subline).toBeNull();
    });

    it('greys the split bars on the same threshold and denominator as a suppressed rate', () => {
      // A bar IS a percentage, drawn instead of printed. It must not look confident on a sample
      // that would render as a dash two inches away — this card sits in Simple, the one screen
      // the page was built for.
      load(makeStats({ activeCustomers: 9 }));
      expect(component.splitSampleTooThin).toBe(true);

      load(makeStats({ activeCustomers: 10 }));
      expect(component.splitSampleTooThin).toBe(false);
    });

    it('suppresses the split legend percentages on the same rule that greys the bars', () => {
      // The legend percentages are not metric rows, so nothing but this keeps them honest.
      load(makeStats({ activeCustomers: 9, returningRate: 44.4, newRate: 55.6 }));
      expect(component.splitLegend!.returning.suppressed).toBe(true);
      expect(component.splitLegend!.first.suppressed).toBe(true);
      expect(component.splitSampleTooThin).toBe(true);

      load(makeStats({ activeCustomers: 10, returningRate: 30, newRate: 70 }));
      expect(component.splitLegend!.returning.suppressed).toBe(false);
      expect(component.splitLegend!.first.suppressed).toBe(false);
      expect(component.splitSampleTooThin).toBe(false);
      expect(component.splitLegend!.returning.value).toBe(30);
    });

    it('gives the legend tooltip ids that cannot collide with a metric row', () => {
      load(makeStats());
      const metricIds = component.metrics.map(m => component.tooltipId(m));

      expect(metricIds).not.toContain(component.splitLegend!.returning.tooltipId);
      expect(metricIds).not.toContain(component.splitLegend!.first.tooltipId);
      expect(component.splitLegend!.returning.tooltipId)
        .not.toBe(component.splitLegend!.first.tooltipId);
    });

    it('greys the SPEND split on the customer count, not on the money', () => {
      // Three customers spending $40,000 is still three customers; the ratio is no more reliable
      // for being large.
      load(makeStats({ activeCustomers: 3, totalSpend: 40000, returningCustomerSpend: 30000 }));
      expect(component.splitSampleTooThin).toBe(true);
    });

    it('never awards "best" to a suppressed cell', () => {
      component.viewMode = 'simple';
      // A three-customer month showing 66.7% must not beat a forty-customer month showing 25%.
      compareOn([
        makeStats({ activeCustomers: 3, returningRate: 66.7 }),
        makeStats({ activeCustomers: 40, returningRate: 25 })
      ]);
      const row = component.compareRows.find(r => r.def.key === 'returningRate')!;

      expect(row.cells[0].suppressed).toBe(true);
      expect(row.bestValue).toBe(25);
      expect(component.isBest(row, 0)).toBe(false);
      expect(component.isBest(row, 1)).toBe(true);
    });

    it('marks no winner when every compared period is too small', () => {
      component.viewMode = 'simple';
      compareOn([
        makeStats({ activeCustomers: 3, returningRate: 66.7 }),
        makeStats({ activeCustomers: 5, returningRate: 20 })
      ]);
      const row = component.compareRows.find(r => r.def.key === 'returningRate')!;
      expect(row.bestValue).toBeNull();
    });
  });

  // ── Rows that hide while they are legitimately zero ──────────────────────

  describe('hideWhenAllZero', () => {
    it('hides "Won back" while it is zero in both the window and the one before', () => {
      load(makeStats({ reactivatedCustomers: 0 }), makeStats({ reactivatedCustomers: 0 }));
      const keys = component.groupedCards.flatMap(g => g.cards).map(c => c.def.key);
      expect(keys).not.toContain('reactivatedCustomers');
    });

    it('shows it again as soon as EITHER period has something to report', () => {
      load(makeStats({ reactivatedCustomers: 0 }), makeStats({ reactivatedCustomers: 2 }));
      const keys = component.groupedCards.flatMap(g => g.cards).map(c => c.def.key);
      expect(keys).toContain('reactivatedCustomers');
    });

    it('keeps a hidden row out of Compare only when every column is zero', () => {
      component.viewMode = 'full';
      compareOn([makeStats({ recurringPlanCustomers: 0 }), makeStats({ recurringPlanCustomers: 0 })]);
      expect(component.compareRows.map(r => r.def.key)).not.toContain('recurringPlanCustomers');

      compareOn([makeStats({ recurringPlanCustomers: 0 }), makeStats({ recurringPlanCustomers: 1 })]);
      expect(component.compareRows.map(r => r.def.key)).toContain('recurringPlanCustomers');
    });
  });

  // ── The plain-English summary ────────────────────────────────────────────

  describe('summary sentence', () => {
    function summaryFor(
      filter: 'today' | 'week' | 'month' | 'lastMonth' | 'year' | 'lastYear' | 'all',
      current: CustomerStatistics, previous: CustomerStatistics | null): string {
      component.activeQuickFilter = filter;
      component.stats = current;
      component.prevStats = previous;
      component['buildSummary']();
      return component.summary;
    }

    it('says a running month is running, and names the comparison honestly', () => {
      const s = summaryFor('month', makeStats({ activeCustomers: 38, totalOrders: 42, returningCustomers: 8 }),
        makeStats({ returningCustomers: 5 }));

      expect(s).toContain('So far in');
      expect(s).toContain('38 customers booked 42 cleanings');
      expect(s).toContain('8 of them had booked with us before');
      expect(s).toContain('up from 5 over the same days in');
    });

    it('drops the comparison clause entirely when there is no prior period', () => {
      const s = summaryFor('all', makeStats({ activeCustomers: 500, totalOrders: 900 }), null);
      expect(s).toContain('All time');
      expect(s).not.toContain('up from');
      expect(s).not.toContain('down from');
      expect(s.endsWith('before.')).toBe(true);
    });

    it('reads as a sentence when nobody booked, not as two zeroes', () => {
      const s = summaryFor('month', makeStats({ activeCustomers: 0, totalOrders: 0, returningCustomers: 0 }), null);
      expect(s).toContain('Nobody has booked a cleaning');
      expect(s).not.toContain('0 customers');
    });

    it('reads naturally when the count held steady, in every period shape', () => {
      // The comparison phrase owns its preposition so "up from 5 in June" works, which means the
      // no-change form has to carry the count too — "the same as 6 in June", never
      // "unchanged from in June".
      expect(summaryFor('lastMonth', makeStats({ returningCustomers: 6 }),
        makeStats({ returningCustomers: 6 }))).toContain('the same as 6 in ');

      expect(summaryFor('today', makeStats({ returningCustomers: 6 }),
        makeStats({ returningCustomers: 6 }))).toContain('the same as 6 yesterday');
    });

    it('singularises a one-customer, one-cleaning period', () => {
      const s = summaryFor('today', makeStats({ activeCustomers: 1, totalOrders: 1, returningCustomers: 0 }), null);
      expect(s).toContain('1 customer booked 1 cleaning.');
      expect(s).toContain('None of them had booked with us before');
    });
  });
});
