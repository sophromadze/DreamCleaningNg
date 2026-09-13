import { TestBed } from '@angular/core/testing';
import { testProviders } from '../../../testing/test-providers';
import { AuditHistoryComponent } from '../../auth/admin/audit-history/audit-history.component';
import { auditSummaryFields, meaningfulAuditChanges, normalizeAuditValues, auditCollectionChanges } from './audit-presentation';
import { formatAuditValue, shouldShowAuditField } from './audit-field-display';

describe('Audit content and privacy regression', () => {
  const order = { Id: 7, UserId: 'Ada Client (#4)', User: null, ApartmentId: 2, Apartment: null,
    ServiceTypeId: 'Deep Cleaning (#3)', ServiceDate: '2026-10-04', ServiceTime: '09:00:00',
    ServiceAddress: 'Test address', Total: 125.55, PaymentMethod: 0, Status: 'Pending', BookedByAdminUserId: 'Admin One (#5)',
    PaymentAccessToken: 'secret-sentinel', OrderServices: [], OrderExtraServices: [], OrderCleaners: [],
    CompanyDevelopmentTips: 0, InitialCompanyDevelopmentTips: 0, LoyaltyDiscountAmount: 0, ContactFirstName: 'Ada', ContactLastName: 'Client' };

  beforeEach(() => TestBed.configureTestingModule({ providers: [...testProviders], imports: [AuditHistoryComponent] }));

  function render(action: string, values: any, entityType = 'Order') {
    spyOn(AuditHistoryComponent.prototype, 'ngOnInit').and.stub();
    const fixture = TestBed.createComponent(AuditHistoryComponent);
    const c = fixture.componentInstance;
    c.auditLogs = c.processAuditLogs([{ id: 1, entityId: 7, entityType, action, createdAt: new Date().toISOString(),
      oldValues: action === 'Delete' ? JSON.stringify(values) : null,
      newValues: action === 'Delete' ? null : JSON.stringify(values), changedFields: Object.keys(values) }]);
    c.viewingLogId = 1; fixture.detectChanges(); return fixture;
  }

  it('renders Order Create once with useful business details and no default dump', () => {
    const fixture = render('Create', order);
    const text = fixture.nativeElement.textContent;
    expect(fixture.nativeElement.querySelectorAll('.created-values').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.changed-fields').length).toBe(0);
    for (const value of ['Ada Client (#4)', 'Deep Cleaning (#3)', 'Test address', '$125.55', 'Pending', 'Admin One (#5)']) expect(text).toContain(value);
    for (const value of ['secret-sentinel', 'Payment Access Token', 'Company Development', '0 items', 'None', 'Loyalty Discount Amount']) expect(text).not.toContain(value);
    expect(text.match(/Ada Client/g)?.length).toBe(1);
  });

  it('renders Delete as a concise business summary', () => {
    const fixture = render('Delete', order);
    expect(fixture.nativeElement.querySelectorAll('.deleted-values').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.changed-fields').length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('$125.55');
    expect(fixture.nativeElement.textContent).not.toContain('secret-sentinel');
  });

  it('renders Customer Create without account security or default bookkeeping', () => {
    const fixture = render('Create', { FirstName: 'Ada', LastName: 'Client', Email: 'test@example.invalid', Phone: '2125550100',
      Role: 0, IsActive: true, CreatedByAdminId: 'Admin (#5)', PasswordResetToken: 'secret-sentinel', LoginOtpCode: 'secret-sentinel',
      TwoFactorPinHash: 'secret-sentinel', LastOrderDate: null, BubblePoints: 0, FirstTimeOrder: true }, 'User');
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('test@example.invalid'); expect(text).toContain('Admin (#5)');
    expect(text).not.toContain('secret-sentinel'); expect(text).not.toContain('Bubble Points'); expect(text).not.toContain('First Time Order');
  });

  it('deduplicates Customer Note and CRM Activity relationships, preserving deleted-admin names', () => {
    const note = normalizeAuditValues({ UserId: 'Ada (#4)', User: null, Content: 'Call first', CreatedByAdminId: 5,
      CreatedByAdmin: null, CreatedByAdminName: 'Former admin' });
    expect(note.CreatedByAdminId).toBe('Former admin (#5)'); expect(note.User).toBeUndefined();
    expect(auditSummaryFields({ entityType: 'UserNote' }, note)).toEqual(['UserId', 'Content', 'CreatedByAdminId']);
    const activity = normalizeAuditValues({ LeadId: 8, Lead: null, AdminId: 5, Admin: null, AdminName: 'Former admin', Content: 'Called' });
    expect(auditSummaryFields({ entityType: 'LeadActivity' }, activity)).toEqual(['LeadId', 'Content', 'AdminId']);
  });

  it('omits unset CRM lead fields while retaining explicit business values', () => {
    expect(auditSummaryFields({ entityType: 'Lead' }, { FirstName: 'Ada', Stage: 'New', AssignedToAdminId: null,
      NextFollowUpDate: null, ConvertedOrderId: 0, IsArchived: false, EstimatedValue: null })).toEqual(['FirstName', 'Stage']);
  });

  it('suppresses null/empty changes and retains meaningful zero/false changes', () => {
    const log = { action: 'Update', oldValues: { Phone: null, Total: 10, IsActive: true, Activities: null },
      newValues: { Phone: '', Total: 0, IsActive: false, Activities: [] } };
    expect(meaningfulAuditChanges(log)).toEqual(['Total', 'IsActive']);
    expect(meaningfulAuditChanges({ ...log, action: 'Create' })).toEqual([]);
  });

  it('retains named service changes and existing payroll context', () => {
    const values = normalizeAuditValues({ Services: [{ ServiceId: 3, ServiceName: 'Oven', Quantity: 1 }], Cleaner: 'Ana Reyes', PaidAmount: 10.5 });
    expect(values.Services[0].ServiceName).toBe('Oven'); expect(values.Cleaner).toBe('Ana Reyes');
    expect(formatAuditValue([{ CleanerName: 'Ana Reyes' }], 'AssignedCleaners')).toBe('Ana Reyes');
  });

  it('shows assignment additions/removals by name without empty counts or unchanged members', () => {
    const keep = { CleanerId: 1, CleanerName: 'Retained' };
    const log = { action: 'Update', oldValues: { OrderCleaners: [keep, { CleanerId: 2, CleanerName: 'John Doe' }] },
      newValues: { OrderCleaners: [{ CleanerId: 3, CleanerName: 'Nika Sophromadze' }, keep] } };
    expect(auditCollectionChanges(log)).toEqual({ added: ['Nika Sophromadze (#3)'], removed: ['John Doe (#2)'] });
    expect(auditCollectionChanges({ action: 'Update', oldValues: { OrderCleaners: null }, newValues: { OrderCleaners: [] } }))
      .toEqual({ added: [], removed: [] });
  });

  for (const field of ['PaymentAccessToken', 'PasswordHash', 'PasswordSalt', 'PasswordResetToken', 'LastEmailVerificationTokenHash',
    'EmailVerificationTokenExpiry', 'EmailChangeToken', 'LoginOtpCode', 'TwoFactorPinHash', 'EmailCodeHash', 'RefreshSession',
    'RefreshTokenExpiryTime', 'ApiKey', 'ClientSecret', 'WebhookSecret', 'PrivateKeyPem']) {
    it(`never displays populated ${field}`, () => {
      expect(shouldShowAuditField(field)).toBeFalse();
      expect(formatAuditValue('secret-sentinel', field)).toBe('Hidden');
      expect(JSON.stringify(normalizeAuditValues({ [field]: 'secret-sentinel', Nested: { [field]: 'secret-sentinel' }, Total: 10 }))).not.toContain('secret-sentinel');
    });
  }
});
