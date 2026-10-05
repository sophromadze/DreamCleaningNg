import {
  isCancelledOrRefundedStatus,
  isPartiallyRefundedOrder,
  orderStatusBadgeClass,
  orderStatusBadgeLabel,
  orderStatusBadgeTitle,
} from './order-status-badge';

/**
 * The status pill shared by the admin Orders table and the Users panel's History tab. The Orders
 * component's own specs pin the same rules through its delegating methods; these pin the helper
 * so the History tab can't quietly diverge.
 */
describe('order status badge', () => {
  it('maps each stored status to its pill', () => {
    expect(orderStatusBadgeClass({ status: 'Pending' })).toBe('status-pending');
    expect(orderStatusBadgeClass({ status: 'Active' })).toBe('status-active');
    expect(orderStatusBadgeClass({ status: 'Done' })).toBe('status-done');
    expect(orderStatusBadgeClass({ status: 'Cancelled' })).toBe('status-cancelled');
    expect(orderStatusBadgeClass({ status: 'Refunded', totalRefundedAmount: 50 }))
      .toBe('status-cancelled status-refunded');
  });

  it('labels with the Orders tab vocabulary', () => {
    expect(orderStatusBadgeLabel({ status: 'Cancelled' })).toBe('Cancel');
    expect(orderStatusBadgeLabel({ status: 'Refunded' })).toBe('Refund');
    expect(orderStatusBadgeLabel({ status: 'Done', paymentMethod: 'Cash' })).toBe('DoneM');
    expect(orderStatusBadgeLabel({ status: 'Done', paymentMethod: 'Normal' })).toBe('Done');
    expect(orderStatusBadgeLabel({ status: 'Weird' })).toBe('Weird');
  });

  it('turns a partial refund into RefundH and names the real status in the tooltip', () => {
    const o = { status: 'Cancelled', totalRefundedAmount: 250.91 };
    expect(isPartiallyRefundedOrder(o)).toBeTrue();
    expect(orderStatusBadgeClass(o)).toBe('status-refund-partial');
    expect(orderStatusBadgeLabel(o)).toBe('RefundH');
    expect(orderStatusBadgeTitle(o)).toBe(
      'Partially refunded — $250.91 returned to the customer. Order status: Cancelled.');
    expect(orderStatusBadgeTitle({ status: 'Done' })).toBe('');
  });

  it('treats only Cancelled and Refunded as no-money statuses', () => {
    expect(isCancelledOrRefundedStatus('cancelled')).toBeTrue();
    expect(isCancelledOrRefundedStatus('Refunded')).toBeTrue();
    expect(isCancelledOrRefundedStatus('Done')).toBeFalse();
    expect(isCancelledOrRefundedStatus(null)).toBeFalse();
  });
});
