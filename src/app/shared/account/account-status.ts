import { makeStateKey } from '@angular/core';
import type { HeaderSummary } from '../../services/bubble-rewards.service';

/**
 * What the header (and its points badge) shows about the signed-in account: the unpaid-order dot,
 * the My Contracts / My Invoices entries, the points badge and the staff indicators. Loaded ONCE
 * per page load and shared (AccountStatusService); on /booking the server's session lookup already
 * has it and ships it here in TransferState.
 */
export interface AccountStatusSnapshot {
  userId: number;
  hasUnpaidOrders: boolean;
  hasContracts: boolean;
  hasInvoices: boolean;
  /** GET api/bubble-points/header-summary; null when it failed (the badge then steps aside). */
  headerSummary: HeaderSummary | null;
  /** Staff only (Admin/SuperAdmin): personal tasks pending / done-but-unchecked. */
  hasPendingPersonalTasks: boolean;
  hasUncheckedDoneTasks: boolean;
  /** Internal users only (Admin/SuperAdmin/Moderator): AI blog drafts awaiting review. */
  pendingBlogDrafts: number;
}

export const ACCOUNT_STATUS_KEY = makeStateKey<AccountStatusSnapshot>('account-status');

/** The order fields the unpaid rule reads (OrderList has them all). */
export interface UnpaidOrderFields {
  status?: string | null;
  isPaid?: boolean | null;
  paymentMethod?: string | null;
  pendingUpdateAmount?: number | null;
}

/**
 * The header dot means "something here can be paid on the website". Cash / Zelle / Check / Other /
 * Invoice orders keep isPaid=false by backend design but are never paid here (create-payment-intent
 * refuses them), so only a Stripe ('Normal') order can owe its booking payment. A top-up
 * (pendingUpdateAmount) is only ever set on an isPaid order.
 */
export function hasUnpaidOrder(orders: readonly UnpaidOrderFields[] | null | undefined): boolean {
  return (orders ?? []).some(order =>
    order.status !== 'Cancelled' &&
    order.status !== 'Refunded' &&
    (
      (!order.isPaid && (!order.paymentMethod || order.paymentMethod === 'Normal')) ||
      ((order.pendingUpdateAmount ?? 0) > 0.01)
    ));
}

export const isStaffRole = (role: string | null | undefined) => role === 'Admin' || role === 'SuperAdmin';
export const isInternalRole = (role: string | null | undefined) => isStaffRole(role) || role === 'Moderator';
