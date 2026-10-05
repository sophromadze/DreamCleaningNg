/**
 * The admin order status pill: its CSS classes, its label and its tooltip.
 *
 * Extracted from the Orders tab (2026-10) when the Users panel's History tab started listing
 * cancelled and refunded orders and needed the identical pill. Styles live in
 * `src/styles/_order-status-badge.scss`; one copy of each, so the two tabs can't drift.
 *
 * Labels are DERIVED, never stored. Present-tense verbs are a deliberate display choice; the
 * stored Order.Status values stay "Cancelled"/"Refunded" and MUST NOT be renamed - roughly
 * thirty comparison sites plus OrderStatuses, OrderBookedFilter and the statistics grouping key
 * off the stored spelling. Two labels are derived rather than stored:
 *  - `DoneM`   - Done, paid by a non-Stripe method, so manual payments are scannable.
 *  - `RefundH` - partially refunded. Deriving it is what lets a cancelled-then-part-refunded
 *    order keep "Cancelled" in the database, leaving every reporting predicate that reads Status
 *    exactly as it was. RefundH outranks the underlying status in the pill, so that status is
 *    carried in the tooltip instead.
 */

/** The fields the pill reads. Both the admin list row and the History row carry them. */
export interface OrderStatusBadgeSource {
  status?: string | null;
  paymentMethod?: string | null;
  totalRefundedAmount?: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  active: 'Active',
  done: 'Done',
  cancelled: 'Cancel',
  refunded: 'Refund',
};

/**
 * True when money came back on this order but NOT all of it - the retained-cancellation-fee
 * case (e.g. order #264: $250.91 returned of $320.91 charged, the $70 fee kept).
 *
 * Partial vs full is decided by the STATUS, never by comparing amounts here. The backend flips
 * Status to "Refunded" in exactly one place (OrderRefundService.ApplyRefundTotals) and exactly
 * when the refunded total clears everything actually charged - so "refunded > 0 but status is
 * not Refunded" IS the backend's own definition of partial. Re-deriving it from `total` would
 * be wrong on both sides: tips ride outside the charged amount, and an admin edit can move
 * `total` after the charge settled.
 */
export function isPartiallyRefundedOrder(order: OrderStatusBadgeSource): boolean {
  return (Number(order.totalRefundedAmount) || 0) > 0
    && (order.status || '').toLowerCase() !== 'refunded';
}

export function orderStatusBadgeClass(order: OrderStatusBadgeSource): string {
  // A partial refund keeps its stored status but earns its own pill: the money was neither
  // fully kept nor fully returned, so neither the done/active nor the cancelled colour is
  // honest. Amber is the paired warning token, not a third red.
  if (isPartiallyRefundedOrder(order)) return 'status-refund-partial';

  switch ((order.status || '').toLowerCase()) {
    case 'active':
      return 'status-active';
    case 'pending':
      return 'status-pending';
    case 'done':
      return 'status-done';
    case 'cancelled':
      return 'status-cancelled';
    case 'refunded':
      // Deliberately shares the cancelled treatment: both mean "this order brought in no money".
      return 'status-cancelled status-refunded';
    default:
      return '';
  }
}

export function orderStatusBadgeLabel(order: OrderStatusBadgeSource): string {
  if (isPartiallyRefundedOrder(order)) return 'RefundH';

  const key = (order.status || '').toLowerCase();
  if (key === 'done' && order.paymentMethod && order.paymentMethod !== 'Normal') {
    return 'DoneM';
  }
  return STATUS_LABELS[key] ?? order.status ?? '';
}

/**
 * Hover text for the pill. Only RefundH needs one: it replaces the real status on screen, so the
 * status it replaced - and how much actually came back - has to stay reachable without opening
 * the order. The plain statuses explain themselves and get no tooltip.
 */
export function orderStatusBadgeTitle(order: OrderStatusBadgeSource): string {
  if (isPartiallyRefundedOrder(order)) {
    const refunded = (Number(order.totalRefundedAmount) || 0).toFixed(2);
    return `Partially refunded — $${refunded} returned to the customer. Order status: ${order.status}.`;
  }
  return '';
}

/** True for the two statuses that mean the order brought in no money. */
export function isCancelledOrRefundedStatus(status: string | null | undefined): boolean {
  const key = (status || '').toLowerCase();
  return key === 'cancelled' || key === 'refunded';
}
