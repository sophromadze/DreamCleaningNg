/**
 * "Does moving this order to Done need a reviewer?" (2026-10).
 *
 * Every move INTO Done except from Active is gated: Pending → Done, and Cancelled / Refunded →
 * Done through the order editor. Who may make a gated move themselves — and who approves the
 * requests — is exactly who may apply order edits directly (`canSaveOrderEditsDirectly`:
 * SuperAdmins, and Admins granted "edit orders without approval"). Everybody else sends a Done
 * request instead, so the panel offers them "Request Done".
 *
 * This file only decides what the panel SAYS. The server enforces the rule on every path that can
 * set Done (status endpoint, order editor, creating an order straight at Done) — mirrors the
 * backend `Helpers/OrderDoneApprovalPolicy.cs`; keep both in step.
 */

/** A move into Done from anything but Active (or Done itself). */
export function isGatedDoneMove(fromStatus: string | null | undefined, toStatus: string | null | undefined): boolean {
  if ((toStatus ?? '').toLowerCase() !== 'done') return false;
  const from = (fromStatus ?? '').toLowerCase();
  return from !== 'done' && from !== 'active';
}

/** True when this caller must REQUEST the move rather than make it. */
export function doneMoveNeedsRequest(
  canSaveOrderEditsDirectly: boolean,
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined = 'Done'
): boolean {
  return !canSaveOrderEditsDirectly && isGatedDoneMove(fromStatus, toStatus);
}
