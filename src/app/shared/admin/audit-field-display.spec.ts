import {
  formatAuditValue,
  formatAuditTimestamp,
  getAuditActionClass,
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditFieldLabel,
  humanizeFieldName,
  shouldShowAuditField,
} from './audit-field-display';

/**
 * The Audits tab must not show an admin a raw property name or a raw JSON value.
 *
 * The specific complaint this module answers: `CleanerTotalSalary` rendered as
 * `CleanerTotalSalary`, because the old local map knew 18 field names and returned the identifier
 * for everything else. The fix is a map PLUS a humanized fallback, so a field nobody has named
 * still reads as English — which is what makes the map safe to leave incomplete.
 */
describe('audit field display', () => {
  describe('field labels', () => {
    it('names the payroll field that used to render as its own identifier', () => {
      expect(getAuditFieldLabel('CleanerTotalSalary')).toBe('Cleaners Total Salary');
    });

    it('falls back to a humanized name for anything unmapped', () => {
      // Never seen by the map, and must still not reach the admin as an identifier.
      expect(getAuditFieldLabel('SomeBrandNewColumn')).toBe('Some Brand New Column');
    });

    it('drops a trailing Id, because the row is about the thing and not about a number', () => {
      expect(humanizeFieldName('AssignedAdminId')).toBe('Assigned Admin');
    });

    it('keeps an acronym together rather than shattering it into single letters', () => {
      expect(humanizeFieldName('PaymentConsentIPAddress')).toBe('Payment Consent IP Address');
    });

    it('hides secrets and plumbing', () => {
      expect(shouldShowAuditField('PasswordHash')).toBe(false);
      expect(shouldShowAuditField('RefreshToken')).toBe(false);
      expect(shouldShowAuditField('UpdatedAt')).toBe(false);
      expect(shouldShowAuditField('Id')).toBe(false);
      expect(shouldShowAuditField('CleanerHourlyRate')).toBe(true);
    });

    it('hides the order-line fields, which have their own dedicated renderer', () => {
      // A generic table cannot absorb OrderServicesUpdate's nested arrays, and rendering them
      // here as opaque values would duplicate that table and disagree with it.
      expect(shouldShowAuditField('Services')).toBe(false);
      expect(shouldShowAuditField('ExtraServices')).toBe(false);
    });
  });

  describe('values', () => {
    it('formats money with a currency sign and two decimals', () => {
      expect(formatAuditValue(289.5, 'SubTotal')).toBe('$289.50');
      expect(formatAuditValue(21, 'CleanerHourlyRate')).toBe('$21.00');
    });

    it('formats a negative money value without losing the sign', () => {
      expect(formatAuditValue(-40, 'AmountRefunded')).toBe('-$40.00');
    });

    it('renders booleans as Yes / No', () => {
      expect(formatAuditValue(true, 'IsPaid')).toBe('Yes');
      expect(formatAuditValue(false, 'IsHidden')).toBe('No');
    });

    it('renders null as None rather than as the word null', () => {
      expect(formatAuditValue(null, 'PaymentNote')).toBe('None');
    });

    it('renders minutes as hours and minutes', () => {
      expect(formatAuditValue(330, 'TotalDuration')).toBe('5h 30m');
      expect(formatAuditValue(360, 'BillableMinutes')).toBe('6h');
      expect(formatAuditValue(45, 'TotalDuration')).toBe('45m');
    });

    it('renders a percentage field with a percent sign', () => {
      expect(formatAuditValue(15, 'LoyaltyDiscountPercentage')).toBe('15%');
    });

    describe('enums', () => {
      it('resolves a role by its declared value', () => {
        expect(formatAuditValue(1, 'Role')).toBe('SuperAdmin');
        expect(formatAuditValue(2, 'Role')).toBe('Admin');
      });

      it('resolves a CLEANER payment method from its own 1-based enum', () => {
        // CleanerPaymentMethod starts at 1. A positional list would label every cleaner payout
        // with the wrong method — a claim about where somebody's money went.
        expect(formatAuditValue(1, 'PaidVia')).toBe('Zelle');
        expect(formatAuditValue(2, 'PaidVia')).toBe('Cash');
      });

      it('resolves a CUSTOMER payment method from the other enum', () => {
        // Same numbers, different meaning: PaymentMethod 1 is Cash, PaidVia 1 is Zelle. Resolving
        // both through one list is the mistake this pins.
        expect(formatAuditValue(0, 'PaymentMethod')).toBe('Card (Stripe)');
        expect(formatAuditValue(1, 'PaymentMethod')).toBe('Cash');
      });

      it('shows an unknown enum value as a number rather than guessing', () => {
        expect(formatAuditValue(99, 'Role')).toBe('#99');
      });
    });

    describe('user ids', () => {
      it('resolves an id to a name when we know the person', () => {
        expect(formatAuditValue(7, 'PaidByUserId', () => 'Ana Reyes')).toBe('Ana Reyes (#7)');
      });

      it('shows an unknown id as #n, so it cannot be read as a quantity', () => {
        expect(formatAuditValue(7, 'PaidByUserId', () => null)).toBe('#7');
      });

      it('never renders a user id as money', () => {
        expect(formatAuditValue(42, 'HiddenByUserId')).toBe('#42');
      });
    });

    it('never returns raw JSON for an object value', () => {
      const rendered = formatAuditValue({ nested: 'thing' }, 'Something');
      expect(rendered).not.toContain('{');
      expect(rendered).toBe('(details)');
    });

    it('does not mistake ordinary text for a date', () => {
      // The old implementation tested dates by handing the value to Date.parse and accepting
      // anything that was not NaN, so "5" and "Deep Clean 2" rendered as dates.
      expect(formatAuditValue('5', 'Notes')).toBe('5');
      expect(formatAuditValue('Deep Clean 2', 'CustomServiceDisplayName')).toBe('Deep Clean 2');
    });

    it('renders an empty string as (empty) rather than as nothing at all', () => {
      expect(formatAuditValue('', 'CancellationReason')).toBe('(empty)');
    });
  });

  describe('timestamps', () => {
    it('shows the CLR default as "Not set"', () => {
      expect(formatAuditTimestamp('0001-01-01T00:00:00Z')).toBe('Not set');
    });

    it('renders a date-only field on its own date, not shifted into the previous evening', () => {
      // ServiceDate is NY wall-clock, not an instant. Converting it to NY would move a midnight
      // UTC value back a day and show yesterday.
      const rendered = formatAuditTimestamp('2026-08-14T00:00:00Z');
      expect(rendered).toBe(new Date('2026-08-14T00:00:00').toLocaleDateString());
    });
  });

  describe('entity types and actions', () => {
    it('names a pseudo-entity from the coverage sweep', () => {
      expect(getAuditEntityLabel('CleanerPayout')).toBe('Cleaner Payout');
      expect(getAuditEntityLabel('OrderEditRequest')).toBe('Change Request');
    });

    it('humanizes an entity type nobody has mapped yet', () => {
      // A stream added by a newly audited action must appear readable with no frontend change.
      expect(getAuditEntityLabel('SomeFutureThing')).toBe('Some Future Thing');
    });

    it('leaves the classic action labels alone', () => {
      expect(getAuditActionLabel('Create')).toBe('Create');
      expect(getAuditActionLabel('Update')).toBe('Update');
      expect(getAuditActionLabel('Delete')).toBe('Delete');
    });

    it('humanizes a coined action verb', () => {
      expect(getAuditActionLabel('PayoutRecorded')).toBe('Payout Recorded');
      expect(getAuditActionLabel('ChangeRejected')).toBe('Change Rejected');
    });

    it('keeps translating the loyalty vocabulary', () => {
      expect(getAuditActionLabel('LoyaltyManualSet')).toBe('Manually set');
    });

    it('gives a coined action a badge colour by shape instead of leaving it unstyled', () => {
      expect(getAuditActionClass('PayoutRecorded')).toBe('action-create');
      expect(getAuditActionClass('PayoutReversed')).toBe('action-delete');
      expect(getAuditActionClass('Create')).toBe('action-create');
      // Anything genuinely neutral still lands on a real class, never on ''.
      expect(getAuditActionClass('SomethingNeutral')).toBe('action-update');
    });
  });
});
