import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { OrdersComponent, AdminOrderList } from './orders.component';
import { AdminService } from '../../../services/admin.service';
import { testProviders } from '../../../../testing/test-providers';

/**
 * The Orders tab's Regular / Commercial sub-tabs and the "Request Done" flow (2026-10).
 */
describe('OrdersComponent — sub-tabs and Done requests', () => {
  let fixture: ComponentFixture<OrdersComponent>;
  let component: OrdersComponent;
  let admin: AdminService;
  let router: Router;

  function row(id: number, overrides: Partial<AdminOrderList> = {}): AdminOrderList {
    return {
      id, userId: 1, contactEmail: `c${id}@example.invalid`, contactFirstName: 'C', contactLastName: 'L',
      contactPhone: '2125550100', serviceTypeName: 'Residential Cleaning', serviceDate: '2026-10-10T00:00:00',
      serviceTime: '10:00:00', status: 'Pending', total: 200, tips: 0, companyDevelopmentTips: 0,
      totalDuration: 120, orderDate: '2026-10-01T00:00:00', isPaid: false, city: 'Brooklyn',
      isCommercial: false,
      ...overrides
    } as AdminOrderList;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [OrdersComponent]
    }).compileComponents();

    router = TestBed.inject(Router);
    admin = TestBed.inject(AdminService);
    fixture = TestBed.createComponent(OrdersComponent);
    component = fixture.componentInstance;
    component.orders.set([
      row(1), row(2), row(3, { isCommercial: true }), row(4, { isCommercial: true, contactEmail: 'office@example.invalid' })
    ]);
  });

  const visibleIds = () => component.filteredOrders.map(o => o.id);

  describe('Regular / Commercial', () => {
    it('lists each order under exactly one sub-tab, with counts per tab', () => {
      expect(visibleIds().sort()).toEqual([1, 2]);
      expect(component.regularOrderCount()).toBe(2);
      expect(component.commercialOrderCount()).toBe(2);

      vi.spyOn(router, 'navigate').mockResolvedValue(true);
      component.selectOrdersSubTab('commercial');
      expect(visibleIds().sort()).toEqual([3, 4]);
    });

    it('writes the sub-tab into the URL as a new history entry and clears the shell deep-link params', () => {
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      component.selectOrdersSubTab('commercial');

      const [, extras] = navigate.mock.calls[0] as any[];
      expect(extras.queryParams.ordersTab).toBe('commercial');
      expect(extras.queryParams.orderId).toBeNull();
      expect(extras.queryParams.tab).toBeNull();
      expect(extras.queryParamsHandling).toBe('merge');
      expect(extras.replaceUrl).toBeFalsy();
    });

    it('keeps search, filters, sort and page per sub-tab', () => {
      vi.spyOn(router, 'navigate').mockResolvedValue(true);
      component.searchTerm.set('c1@');
      component.statusFilter.set('pending');

      component.selectOrdersSubTab('commercial');
      expect(component.searchTerm()).toBe('');            // a fresh tab starts from defaults
      expect(component.statusFilter()).toBe('all');
      component.searchTerm.set('office');
      expect(visibleIds()).toEqual([4]);

      component.selectOrdersSubTab('regular');
      expect(component.searchTerm()).toBe('c1@');
      expect(component.statusFilter()).toBe('pending');
      expect(visibleIds()).toEqual([1]);

      component.selectOrdersSubTab('commercial');
      expect(component.searchTerm()).toBe('office');
    });

    it('follows Back / Forward: the query string alone switches the sub-tab', async () => {
      fixture.detectChanges();   // ngOnInit subscribes to the query string
      await router.navigateByUrl('/?ordersTab=commercial');
      expect(component.ordersSubTab()).toBe('commercial');
      await router.navigateByUrl('/');
      expect(component.ordersSubTab()).toBe('regular');
    });

    it('moves an order to the other sub-tab', () => {
      vi.spyOn(component as any, 'clearMessagesAfterDelay').mockReturnValue(undefined);
      component.userPermissions.set({ role: 'Admin', permissions: { canView: true, canCreate: true, canUpdate: true, canDelete: false, canActivate: true, canDeactivate: true } });
      const move = vi.spyOn(admin, 'updateOrderType').mockReturnValue(of({ message: 'Order #1 moved to Commercial.', isCommercial: true }));

      component.moveOrderType(1, true);

      expect(move).toHaveBeenCalledWith(1, true);
      expect(visibleIds()).toEqual([2]);
      expect(component.commercialOrderCount()).toBe(3);
    });
  });

  describe('Request Done', () => {
    beforeEach(() => {
      vi.spyOn(component as any, 'clearMessagesAfterDelay').mockReturnValue(undefined);
      vi.spyOn(admin, 'getPendingOrderEdits').mockReturnValue(of([]));
    });

    it('labels the Done action a request only for a Pending order and only without the grant', () => {
      component.canSaveOrderEditsDirectly.set(false);
      expect(component.doneNeedsRequest({ status: 'Pending' })).toBe(true);
      expect(component.doneNeedsRequest({ status: 'Active' })).toBe(false);

      component.canSaveOrderEditsDirectly.set(true);
      expect(component.doneNeedsRequest({ status: 'Pending' })).toBe(false);
    });

    it('a request leaves the status alone and marks the row "Done requested"', () => {
      component.canSaveOrderEditsDirectly.set(false);
      const update = vi.spyOn(admin, 'updateOrderStatus').mockReturnValue(of({
        message: 'Done request for order #1 sent for approval.', doneRequested: true, requestId: 9
      }));
      const review = vi.spyOn(admin, 'sendReviewRequest');
      const order = component.orders().find(o => o.id === 1)!;

      component.markOrderAsDone(order);
      component.doneRequestReason.set('paid cash');
      component.confirmDone(true);

      // The review-link choice rides on the request; nothing is sent before approval.
      expect(update).toHaveBeenCalledWith(1, 'Done', 'Normal', null, null, { sendReviewRequest: true, reason: 'paid cash' });
      expect(review).not.toHaveBeenCalled();
      expect(order.status).toBe('Pending');
      expect(order.hasPendingDoneRequest).toBe(true);
      expect(component.successMessage()).toContain('sent for approval');
    });

    it('a 409 for a request already waiting shows that state instead of a failure', () => {
      component.canSaveOrderEditsDirectly.set(false);
      vi.spyOn(admin, 'updateOrderStatus').mockReturnValue(throwError(() => ({
        status: 409, error: { message: 'A Done request for order #1 is already waiting for approval.', doneRequested: true }
      })));
      const order = component.orders().find(o => o.id === 1)!;

      component.updateOrderStatus(order, 'Done');

      expect(order.hasPendingDoneRequest).toBe(true);
      expect(order.status).toBe('Pending');
      expect(component.errorMessage()).toContain('already waiting');
    });

    it('a direct Done still changes the status and sends the review link itself', () => {
      component.canSaveOrderEditsDirectly.set(true);
      vi.spyOn(admin, 'updateOrderStatus').mockReturnValue(of({ message: 'Order status updated to Done' }));
      const review = vi.spyOn(admin, 'sendReviewRequest').mockReturnValue(of({}));
      const order = component.orders().find(o => o.id === 1)!;

      component.markOrderAsDone(order);
      component.confirmDone(true);

      expect(order.status).toBe('Done');
      expect(review).toHaveBeenCalledWith(1);
    });

    it('lists the waiting request first and keeps the row pill in step with the server', () => {
      component.userRole.set('Admin');
      component.viewingOrderId.set(1);
      vi.spyOn(admin, 'getOrderChangeRequests').mockReturnValue(of([
        { id: 1, orderId: 1, kind: 'Edit', status: 'Rejected', requestedByUserId: 3, requestedByName: 'A', requestedAt: '2026-10-01T00:00:00', isMine: true, rejectReason: 'no' },
        { id: 2, orderId: 1, kind: 'Done', status: 'Pending', requestedByUserId: 3, requestedByName: 'A', requestedAt: '2026-10-02T00:00:00', isMine: true },
      ] as any));

      component.loadOrderChangeRequests(1);

      expect(component.visibleOrderChangeRequests().map(r => r.id)).toEqual([2, 1]);
      expect(component.orders().find(o => o.id === 1)!.hasPendingDoneRequest).toBe(true);
      expect(component.changeRequestStatusLabel(component.visibleOrderChangeRequests()[0])).toBe('Waiting for approval');
    });

    it('a Moderator never asks for change requests (the endpoint is Admin + SuperAdmin)', () => {
      component.userRole.set('Moderator');
      const read = vi.spyOn(admin, 'getOrderChangeRequests');

      component.loadOrderChangeRequests(1);

      expect(read).not.toHaveBeenCalled();
    });
  });
});
