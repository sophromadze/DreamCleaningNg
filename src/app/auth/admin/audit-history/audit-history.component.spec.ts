import { ComponentFixture, TestBed } from '@angular/core/testing';

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
});
