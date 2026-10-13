import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { testProviders } from '../../testing/test-providers';
import { OrdersComponent } from '../auth/admin/orders/orders.component';

describe('Recurring order list refresh', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [...testProviders] }));

  it('keeps the newest list and statistics when an older GET completes after generation', () => {
    const c: any = TestBed.createComponent(OrdersComponent).componentInstance;
    const oldRead = new Subject<any[]>(), freshRead = new Subject<any[]>();
    c.ordersLoadVersion = 0; c.userRole.set('SuperAdmin'); c.isSuperAdmin.set(true); c.loadingStates.set({});
    c.assignedCleanersCache.set(new Map()); c.cleanersLoadedSet.set(new Set());
    c.adminService = { getAllOrders: vi.fn().mockReturnValueOnce(oldRead).mockReturnValueOnce(freshRead) };
    c.orderReminderService = { initialize: vi.fn() };
    for (const name of ['clearMessages', 'preloadAssignedCleaners', 'preloadStaffingWarnings',
      'loadPendingOrderEdits', 'calculateStatistics', 'initializeStickyHeader', 'updateStickyHeader']) c[name] = vi.fn().mockName(name);
    c.loadOrders(); c.onRecurringOrdersGenerated();
    freshRead.next([{ id: 1, total: 100 }, { id: 2, total: 200 }]);
    oldRead.next([{ id: 1, total: 100 }]); oldRead.complete();
    expect(c.orders().map((o: any) => o.id)).toEqual([1, 2]);
    expect(c.orders().reduce((sum: number, o: any) => sum + o.total, 0)).toBe(300);
    expect(c.calculateStatistics).toHaveBeenCalledTimes(1);
    expect(c.loadingStates().orders).toBe(true);
    freshRead.complete(); expect(c.loadingStates().orders).toBe(false);
  });
});
