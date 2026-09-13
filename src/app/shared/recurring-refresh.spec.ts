import { Subject } from 'rxjs';
import { OrdersComponent } from '../auth/admin/orders/orders.component';

describe('Recurring order list refresh', () => {
  it('keeps the newest list and statistics when an older GET completes after generation', () => {
    const c: any = Object.create(OrdersComponent.prototype);
    const oldRead = new Subject<any[]>(), freshRead = new Subject<any[]>();
    c.ordersLoadVersion = 0; c.userRole = 'SuperAdmin'; c.isSuperAdmin = true; c.loadingStates = {};
    c.assignedCleanersCache = new Map(); c.cleanersLoadedSet = new Set(); c.residentialVariantCache = new Map();
    c.adminService = { getAllOrders: jasmine.createSpy().and.returnValues(oldRead, freshRead) };
    c.orderReminderService = { initialize: jasmine.createSpy() };
    for (const name of ['clearMessages', 'preloadResidentialVariants', 'preloadAssignedCleaners', 'preloadStaffingWarnings',
      'loadPendingOrderEdits', 'calculateStatistics', 'initializeStickyHeader', 'updateStickyHeader']) c[name] = jasmine.createSpy(name);
    c.loadOrders(); c.onRecurringOrdersGenerated();
    freshRead.next([{ id: 1, total: 100 }, { id: 2, total: 200 }]);
    oldRead.next([{ id: 1, total: 100 }]); oldRead.complete();
    expect(c.orders.map((o: any) => o.id)).toEqual([1, 2]);
    expect(c.orders.reduce((sum: number, o: any) => sum + o.total, 0)).toBe(300);
    expect(c.calculateStatistics).toHaveBeenCalledTimes(1);
    expect(c.loadingStates.orders).toBeTrue();
    freshRead.complete(); expect(c.loadingStates.orders).toBeFalse();
  });
});
