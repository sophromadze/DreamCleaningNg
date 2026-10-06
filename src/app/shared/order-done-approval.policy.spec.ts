import { doneMoveNeedsRequest, isGatedDoneMove } from './order-done-approval.policy';

describe('order Done approval policy (mirror of OrderDoneApprovalPolicy.cs)', () => {
  it('gates every move into Done except from Active', () => {
    expect(isGatedDoneMove('Pending', 'Done')).toBe(true);
    expect(isGatedDoneMove('Cancelled', 'Done')).toBe(true);
    expect(isGatedDoneMove('Refunded', 'Done')).toBe(true);
    expect(isGatedDoneMove(null, 'Done')).toBe(true);
    expect(isGatedDoneMove('active', 'done')).toBe(false);
    expect(isGatedDoneMove('Done', 'Done')).toBe(false);
  });

  it('never gates a move that is not into Done', () => {
    for (const to of ['Pending', 'Active', 'Cancelled']) {
      expect(isGatedDoneMove('Pending', to)).toBe(false);
    }
  });

  it('only callers without the direct-save grant must request', () => {
    expect(doneMoveNeedsRequest(false, 'Pending')).toBe(true);
    expect(doneMoveNeedsRequest(true, 'Pending')).toBe(false);
    expect(doneMoveNeedsRequest(false, 'Active')).toBe(false);
  });
});
