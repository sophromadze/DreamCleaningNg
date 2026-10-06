import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { OrderSourcesComponent, nyTodayIso, presetRange } from './order-sources.component';
import { AdminService, OrderSourcesReport } from '../../../../services/admin.service';
import { testProviders } from '../../../../../testing/test-providers';

describe('OrderSourcesComponent', () => {
  describe('date ranges', () => {
    it('reads today in New York, not in the browser zone', () => {
      // 02:30 UTC on Oct 6 is still the evening of Oct 5 in New York.
      expect(nyTodayIso(new Date('2026-10-06T02:30:00Z'))).toBe('2026-10-05');
    });

    it('resolves every preset to inclusive service dates', () => {
      expect(presetRange('last30', '2026-10-06')).toEqual({ from: '2026-09-07', to: '2026-10-06' });
      expect(presetRange('thisMonth', '2026-10-06')).toEqual({ from: '2026-10-01', to: '2026-10-06' });
      expect(presetRange('lastMonth', '2026-10-06')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
      expect(presetRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
      expect(presetRange('last90', '2026-10-06')).toEqual({ from: '2026-07-09', to: '2026-10-06' });
      expect(presetRange('thisYear', '2026-10-06')).toEqual({ from: '2026-01-01', to: '2026-10-06' });
    });
  });

  describe('rendering', () => {
    let fixture: ComponentFixture<OrderSourcesComponent>;
    let getOrderSources: ReturnType<typeof vi.fn>;

    const report: OrderSourcesReport = {
      from: '2026-09-07', to: '2026-10-06', granularity: 'week', totalOrders: 5, totalRevenue: 1000,
      sources: [
        { key: 'paid', label: 'Paid ads', orders: 3, revenue: 600, orderShare: 60, revenueShare: 60, averageOrderValue: 200 },
        { key: 'organic', label: 'Organic search', orders: 2, revenue: 400, orderShare: 40, revenueShare: 40, averageOrderValue: 200 },
        { key: 'direct', label: 'Direct', orders: 0, revenue: 0, orderShare: 0, revenueShare: 0, averageOrderValue: 0 },
        { key: 'unknown', label: 'Unknown', orders: 0, revenue: 0, orderShare: 0, revenueShare: 0, averageOrderValue: 0 },
      ],
      periods: [
        { periodStart: '2026-09-07T00:00:00', orders: { paid: 1, organic: 2 }, revenue: { paid: 200, organic: 400 } },
        { periodStart: '2026-09-14T00:00:00', orders: { paid: 2 }, revenue: { paid: 400 } },
      ]
    };

    beforeEach(async () => {
      getOrderSources = vi.fn().mockReturnValue(of(report));
      await TestBed.configureTestingModule({
        providers: [...testProviders, { provide: AdminService, useValue: { getOrderSources } }],
        imports: [OrderSourcesComponent]
      }).compileComponents();
      // jsdom has no canvas; the chart is Chart.js's job, the numbers are this component's.
      vi.spyOn(OrderSourcesComponent.prototype as any, 'buildChart').mockReturnValue(undefined);
      fixture = TestBed.createComponent(OrderSourcesComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('asks for the last 30 days by default, grain chosen by the server', () => {
      const [from, to, grain] = getOrderSources.mock.calls[0];
      expect(from).toBe(presetRange('last30', nyTodayIso()).from);
      expect(to).toBe(nyTodayIso());
      expect(grain).toBe('auto');
    });

    it('shows paid vs organic first and every source in the table, empty ones included', () => {
      const el: HTMLElement = fixture.nativeElement;
      const cards = Array.from(el.querySelectorAll('.os-card')).map(c => c.textContent!.replace(/\s+/g, ' '));
      expect(cards[1]).toContain('Paid ads');
      expect(cards[1]).toContain('3');
      expect(cards[2]).toContain('Organic search');

      const rows = Array.from(el.querySelectorAll('section[aria-labelledby="os-table-title"] tbody tr'));
      expect(rows.length).toBe(4);
      expect(rows[2].textContent).toContain('Direct');
    });

    it('labels weekly buckets by their Monday', () => {
      expect(fixture.componentInstance.periodLabel('2026-09-07T00:00:00')).toBe('Week of Sep 7');
    });

    it('describes the chart for screen readers', () => {
      expect(fixture.componentInstance.chartSummary()).toContain('3 from paid ads and 2 from organic search');
    });

    it('refuses a reversed custom range without asking the server', () => {
      const c = fixture.componentInstance;
      getOrderSources.mockClear();
      c.fromDate.set('2026-10-06');
      c.toDate.set('2026-10-01');
      c.applyCustom();
      expect(getOrderSources).not.toHaveBeenCalled();
      expect(c.errorMessage()).toContain('on or before');
    });
  });
});
