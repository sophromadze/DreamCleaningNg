import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { AuditHistoryComponent } from './audit-history.component';

import { testProviders } from '../../../../testing/test-providers';

describe('AuditHistoryComponent', () => {
  let component: AuditHistoryComponent;
  let fixture: ComponentFixture<AuditHistoryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [AuditHistoryComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AuditHistoryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * Rows written under a CUSTOM action verb (2026-09).
   *
   * Every payroll and payout row expanded to "This entry recorded no visible field changes",
   * because the diff was gated on `action === 'Update'` and these carry verbs of their own —
   * PayrollOverrideSet, PayoutRecorded, PayoutToppedUp. The rows always held the whole story;
   * nothing was ever going to render it.
   */
  describe('rows with a custom action verb', () => {
    const overrideRow = (over: any = {}) => ({
      id: 2593,
      entityType: 'CleanerPayrollOverride',
      entityId: 324,
      action: 'PayrollOverrideSet',
      changedFields: ['BillableMinutes', 'CleanerTotalSalary'],
      oldValues: {
        Cleaner: 'Ana Reyes', AppliedTo: 'Every cleaner on this order',
        HourlyRate: null, BillableMinutes: 240, CleanerTotalSalary: 252
      },
      newValues: {
        Cleaner: 'Ana Reyes', AppliedTo: 'Every cleaner on this order',
        HourlyRate: null, BillableMinutes: 255, CleanerTotalSalary: 267.75
      },
      ...over
    }) as any;

    const payoutRow = () => ({
      id: 2594,
      entityType: 'CleanerPayout',
      entityId: 324,
      action: 'PayoutToppedUp',
      changedFields: ['Cleaner', 'PaidAmount', 'TotalPaidForLine'],
      oldValues: null,
      newValues: { Cleaner: 'Ana Reyes', PaidAmount: 10.5, TotalPaidForLine: 84, PaidVia: 'Zelle' }
    }) as any;

    it('renders the before/after table for a payroll override', () => {
      const log = overrideRow();
      expect(component.showChangedFields(log)).toBe(true);
      expect(component.hasAnyRenderableDetail(log)).toBe(true);
    });

    it('renders a one-sided payout as what was recorded', () => {
      // There is no "before" for money leaving the company, so there is nothing to diff — but the
      // payload says who, how much and by what method, and it used to show none of it.
      const log = payoutRow();
      expect(component.showRecordedValues(log)).toBe(true);
      expect(component.hasAnyRenderableDetail(log)).toBe(true);
      expect(component.recordedValues(log)['Cleaner']).toBe('Ana Reyes');
    });

    it('names the cleaner the change was about, even though the name did not change', () => {
      // Cleaner and AppliedTo are equal on both sides, so they are absent from the diff. Without
      // the context block the expansion says a figure moved without ever saying whose.
      const fields = component.contextFields(overrideRow());

      expect(fields).toContain('Cleaner');
      expect(fields).toContain('AppliedTo');
      expect(fields).not.toContain('BillableMinutes'); // that one DID change
    });

    it('does not print unchanged context on an ordinary entity update', () => {
      // A full-entity Update carries fifty columns that did not move; printing those is exactly
      // what made this tab unreadable before the field-display sweep.
      const fields = component.contextFields({
        entityType: 'Order',
        action: 'Update',
        changedFields: ['Status'],
        oldValues: { Status: 'Active', ContactEmail: 'a@b.com', City: 'Brooklyn' },
        newValues: { Status: 'Done', ContactEmail: 'a@b.com', City: 'Brooklyn' }
      } as any);

      expect(fields).toEqual([]);
    });

    it('still leaves a genuinely empty row saying so', () => {
      // The "nothing to show" message is right when there IS nothing — it was only ever wrong as
      // a description of a row full of detail.
      expect(component.hasAnyRenderableDetail({
        entityType: 'Order', action: 'Update', changedFields: [], oldValues: null, newValues: null
      } as any)).toBe(false);
    });
  });

  /**
   * Revert (2026-10). The Services catalogue, plans and expenses are reverted through a server
   * PREVIEW and a single-use token, never by the old Undo; a legacy row undone before then keeps
   * its Redo and is marked as such.
   */
  describe('revert', () => {
    let http: HttpTestingController;

    const priceRow = (over: any = {}) => ({
      id: 501, entityType: 'ExtraService', entityId: 7, action: 'Update', captured: true,
      source: 'mcp', batchId: 'b-1', batchSize: 3, changedFields: ['Price'],
      oldValues: { Price: 40 }, newValues: { Price: 45 }, undoneAt: null, ...over
    }) as any;

    const preview = (over: any = {}) => ({
      kind: 'revert', canApply: true, token: 'chg_abc', batchId: 'new-batch', summary: '1 change(s) to 1 record(s): 1 revert.',
      changes: [{ entityType: 'ExtraService', entityId: 7, action: 'Revert', fields: [{ field: 'Price', old: 45, new: 40 }] }],
      warnings: [], report: { items: [{ entityType: 'ExtraService', entityId: 7, action: 'update', status: 'ok', entryIds: [501] }] },
      ...over
    });

    beforeEach(() => {
      http = TestBed.inject(HttpTestingController);
      http.match(() => true); // the page's own start-up requests
      component.userRole.set('SuperAdmin');
    });

    afterEach(() => http.match(() => true));

    it('offers Revert instead of Undo on a change-history row, and Redo only on a legacy undone one', () => {
      expect(component.usesRevert(priceRow())).toBe(true);
      expect(component.isLegacyUndone(priceRow())).toBe(false);

      const legacy = priceRow({ undoneAt: new Date('2026-09-01') });
      expect(component.usesRevert(legacy)).toBe(false);
      expect(component.isLegacyUndone(legacy)).toBe(true);

      expect(component.usesRevert({ ...priceRow(), captured: false, entityType: 'Order' })).toBe(false);
    });

    it('previews first and applies only the previewed token, with the note', () => {
      component.openRevert(priceRow(), false);
      const req = http.expectOne(r => r.url.endsWith('/audit-logs/revert/preview'));
      expect(req.request.body).toEqual({ entryId: 501, batchId: undefined, overrideConflicts: false, useDeactivateAlternative: false });
      req.flush(preview());
      expect(component.revertPreview()?.canApply).toBe(true);

      component.revertNote.set('wrong price');
      component.confirmRevert();
      const apply = http.expectOne(r => r.url.endsWith('/audit-logs/revert/apply'));
      expect(apply.request.body).toEqual({ token: 'chg_abc', note: 'wrong price' });
      apply.flush({ applied: true, batchId: 'new-batch', changesWritten: 1, historyIds: [900], message: 'Applied 1 change(s) as previewed.' });

      expect(component.revertTarget()).toBeNull();
      expect(component.successMessage()).toContain('Applied');
    });

    it('reverts a whole change by its batch id', () => {
      component.openRevert(priceRow(), true);
      const req = http.expectOne(r => r.url.endsWith('/audit-logs/revert/preview'));
      expect(req.request.body.batchId).toBe('b-1');
      expect(req.request.body.entryId).toBeUndefined();
    });

    it('shows conflicts, cannot confirm them, and previews again when the admin chooses to overwrite', () => {
      component.openRevert(priceRow(), false);
      http.expectOne(r => r.url.endsWith('/audit-logs/revert/preview')).flush(preview({
        canApply: false, token: null, blockedReason: '1 record(s) changed after this entry',
        changes: [],
        report: { items: [{ entityType: 'ExtraService', entityId: 7, action: 'update', status: 'conflict', reason: 'changed after this entry',
          conflicts: [{ field: 'Price', expected: 45, current: 55, restore: 40 }], entryIds: [501] }] }
      }));
      expect(component.revertConflicts().length).toBe(1);
      component.confirmRevert();
      http.expectNone(r => r.url.endsWith('/audit-logs/revert/apply'));

      component.setRevertOverride(true);
      const again = http.expectOne(r => r.url.endsWith('/audit-logs/revert/preview'));
      expect(again.request.body.overrideConflicts).toBe(true);
    });

    it('offers deactivating a record orders still use, as a new preview', () => {
      component.openRevert(priceRow({ action: 'Create', oldValues: null }), false);
      http.expectOne(r => r.url.endsWith('/audit-logs/revert/preview')).flush(preview({
        canApply: false, token: null, blockedReason: 'in use',
        report: { items: [{ entityType: 'ExtraService', entityId: 7, action: 'delete', status: 'blocked', reason: '2 order(s) use this extra service', alternative: 'deactivate', entryIds: [501] }] }
      }));
      expect(component.revertOffersDeactivate()).toBe(true);

      component.setRevertDeactivate(true);
      const again = http.expectOne(r => r.url.endsWith('/audit-logs/revert/preview'));
      expect(again.request.body.useDeactivateAlternative).toBe(true);
    });

    it('keeps the dialog open with the reason when the apply is refused, and drops the used token', () => {
      component.openRevert(priceRow(), false);
      http.expectOne(r => r.url.endsWith('/audit-logs/revert/preview')).flush(preview());
      component.confirmRevert();
      http.expectOne(r => r.url.endsWith('/audit-logs/revert/apply'))
        .flush({ message: 'Not applied: ExtraService #7 changed after the preview. This token is now used up — run the preview again.' },
          { status: 400, statusText: 'Bad Request' });

      expect(component.revertTarget()).not.toBeNull();
      expect(component.revertPreview()).toBeNull();
      expect(component.revertError()).toContain('used up');
    });

    it('filters to one change from its batch link', () => {
      component.showBatch(priceRow());
      const req = http.match(r => r.url.endsWith('/audit-logs'));
      expect(req.length).toBeGreaterThan(0);
      expect(req[req.length - 1].request.params.get('batchId')).toBe('b-1');
      expect(component.hasActiveFilters()).toBe(true);
    });
  });
});
