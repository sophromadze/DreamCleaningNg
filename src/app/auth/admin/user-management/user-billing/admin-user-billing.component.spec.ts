import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { of } from 'rxjs';

import { AdminUserBillingComponent } from './admin-user-billing.component';
import { AdminUserBilling, BillingService } from '../../../../services/billing.service';
import { testProviders } from '../../../../../testing/test-providers';

describe('AdminUserBillingComponent', () => {
  let fixture: ComponentFixture<AdminUserBillingComponent>;
  let billing: jasmine.SpyObj<BillingService>;

  const data: AdminUserBilling = {
    featureEnabled: true,
    cards: [{
      id: 1, paymentMethodId: null, brand: 'visa', last4: '4242', expMonth: 1, expYear: 2029, wallet: null,
      isPrimary: true, isBackup: false, isExpired: false, status: 'active', statusMessage: null, isUsable: true, createdAt: ''
    }],
    autoPay: {
      featureEnabled: true, autoPayEnabled: true, autoPayEnabledAt: '2026-09-01', primaryCard: null, backupCard: null,
      arrangements: [
        { scope: 'series', recurringSeriesId: 5, contractClientId: null, title: 'Recurring cleaning — every 2 weeks',
          description: '', timing: '', isAuthorized: true, isEffective: true, pausedReason: null, allowBackupFallback: true,
          authorizationId: 9, authorizedAt: '2026-09-02', termsVersion: '2026-09.1' },
        { scope: 'office', recurringSeriesId: null, contractClientId: null, title: 'Orders our office books for you',
          description: '', timing: '', isAuthorized: false, isEffective: false, pausedReason: null, allowBackupFallback: false,
          authorizationId: null, authorizedAt: null, termsVersion: null }
      ]
    },
    outstanding: [], recentAttempts: [], recentHistory: [], openIssues: []
  };

  beforeEach(async () => {
    billing = jasmine.createSpyObj('BillingService', ['getAdminUserBilling']);
    billing.getAdminUserBilling.and.returnValue(of(data));
    await TestBed.configureTestingModule({
      imports: [AdminUserBillingComponent],
      providers: [...testProviders, { provide: BillingService, useValue: billing }]
    }).compileComponents();

    fixture = TestBed.createComponent(AdminUserBillingComponent);
    fixture.componentInstance.userId = 77;
    fixture.componentInstance.ngOnChanges({ userId: new SimpleChange(undefined, 77, true) });
    fixture.detectChanges();
  });

  it('loads this customer only', () => {
    expect(billing.getAdminUserBilling).toHaveBeenCalledOnceWith(77);
  });

  it('shows each arrangement separately, never one blanket ON/OFF', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Recurring cleaning — every 2 weeks');
    expect(text).toContain('Active');
    expect(text).toContain('Not authorized');
    expect(text).toContain('Visa ending 4242');
  });

  it('is read-only: it offers no control that could change a card, a consent or charge anything', () => {
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    expect(buttons.length).toBe(0);
  });
});
