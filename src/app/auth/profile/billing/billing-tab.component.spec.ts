import type { MockedObject } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { BillingTabComponent } from './billing-tab.component';
import { AutoPayOverview, BillingService, SavedCard } from '../../../services/billing.service';
import { StripeService } from '../../../services/stripe.service';
import { testProviders } from '../../../../testing/test-providers';

function card(id: number, extra: Partial<SavedCard> = {}): SavedCard {
  return {
    id, paymentMethodId: 'pm_' + id, brand: 'visa', last4: String(4000 + id), expMonth: 12, expYear: 2030, wallet: null,
    isPrimary: false, isBackup: false, isExpired: false, status: 'active', statusMessage: null, isUsable: true,
    createdAt: '2026-09-01', ...extra
  };
}

function overview(extra: Partial<AutoPayOverview> = {}): AutoPayOverview {
  return {
    featureEnabled: true, autoPayEnabled: false, autoPayEnabledAt: null, primaryCard: null, backupCard: null,
    arrangements: [{
      scope: 'office', recurringSeriesId: null, contractClientId: null, title: 'Orders our office books for you',
      description: 'd', timing: 't', isAuthorized: false, isEffective: false, pausedReason: null,
      allowBackupFallback: false, authorizationId: null, authorizedAt: null, termsVersion: null
    }],
    ...extra
  };
}

describe('BillingTabComponent', () => {
  let fixture: ComponentFixture<BillingTabComponent>;
  let component: BillingTabComponent;
  let billing: MockedObject<BillingService>;

  function setup(cards: SavedCard[], autoPay = overview()) {
    billing.getCards.mockReturnValue(of(cards));
    billing.getAutoPay.mockReturnValue(of(autoPay));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    billing = {
      config: vi.fn().mockName('BillingService.config'),
      getCards: vi.fn().mockName('BillingService.getCards'),
      getAutoPay: vi.fn().mockName('BillingService.getAutoPay'),
      getNotifications: vi.fn().mockName('BillingService.getNotifications'),
      getOutstanding: vi.fn().mockName('BillingService.getOutstanding'),
      getHistory: vi.fn().mockName('BillingService.getHistory'),
      setPrimary: vi.fn().mockName('BillingService.setPrimary'),
      setBackup: vi.fn().mockName('BillingService.setBackup'),
      removeCard: vi.fn().mockName('BillingService.removeCard'),
      getTerms: vi.fn().mockName('BillingService.getTerms'),
      enableAutoPay: vi.fn().mockName('BillingService.enableAutoPay'),
      authorize: vi.fn().mockName('BillingService.authorize'),
      disableAutoPay: vi.fn().mockName('BillingService.disableAutoPay')
    } as any;
    billing.config.mockReturnValue(of({ savedCardsEnabled: true, autoPayEnabled: true }));
    billing.getNotifications.mockReturnValue(of([]));
    billing.getOutstanding.mockReturnValue(of([]));
    billing.getHistory.mockReturnValue(of({ items: [], page: 1, pageSize: 10, totalCount: 0 }));

    await TestBed.configureTestingModule({
      imports: [BillingTabComponent],
      providers: [...testProviders, { provide: BillingService, useValue: billing },
        { provide: StripeService, useValue: { destroyCardElement: vi.fn().mockName('StripeService.destroyCardElement') } }]
    }).compileComponents();

    fixture = TestBed.createComponent(BillingTabComponent);
    component = fixture.componentInstance;
  });

  it('shows helpful empty states with no cards and no history', () => {
    setup([]);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('You have no saved cards');
    expect(text).toContain('never turns on automatic payments');
    expect(text).toContain('No payments yet');
  });

  it('badges the Primary and Backup cards and marks an expired one', () => {
    setup([card(1, { isPrimary: true }), card(2, { isBackup: true }), card(3, { isExpired: true, isUsable: false })]);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Primary');
    expect(text).toContain('Backup');
    expect(text).toContain('Expired');
  });

  it('never offers the Primary card as a Backup', () => {
    setup([card(1, { isPrimary: true }), card(2)]);
    const rows: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.saved-card'));
    expect(rows[0].textContent).not.toContain('Set as Backup');
    expect(rows[1].textContent).toContain('Set as Backup');
  });

  it('asks for a successor before removing the Primary card, preferring the Backup', () => {
    setup([card(1, { isPrimary: true }), card(2), card(3, { isBackup: true })]);
    component.openRemove(component.cards[0]);
    expect(component.removeDialog!.newPrimaryId).toBe(3);
    expect(component.removeConsequence()).toContain('Choose the card that should replace it');

    billing.removeCard.mockReturnValue(of({ message: 'ok', cards: [], autoPayEnabled: false }));
    component.removeDialog!.newPrimaryId = null;
    component.confirmRemove();
    expect(billing.removeCard).not.toHaveBeenCalled();
    expect(component.removeDialog!.error).toContain('Choose which card');
  });

  it('warns that removing the only card turns Automatic Payments off', () => {
    setup([card(1, { isPrimary: true })], overview({ autoPayEnabled: true }));
    component.openRemove(component.cards[0]);
    expect(component.removeConsequence()).toContain('turns Automatic Payments off');
  });

  it('cannot turn Automatic Payments on without a usable Primary card', () => {
    setup([]);
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.switch');
    expect(toggle.disabled).toBe(true);
  });

  it('requires all three booking consents before authorising office-booked charges', () => {
    setup([card(1, { isPrimary: true })]);
    billing.getTerms.mockReturnValue(of({ scope: 'office', version: 'v1', text: 'terms' }));
    component.openTerms('arrangement', component.autoPay!.arrangements[0]);

    component.terms!.accepted = true;
    expect(component.termsCanSubmit).toBe(false);
    component.terms!.smsConsent = true;
    component.terms!.cancellationFeeConsent = true;
    expect(component.termsCanSubmit).toBe(false);
    component.terms!.termsOfServiceConsent = true;
    expect(component.termsCanSubmit).toBe(true);
  });

  it('sends the version of the terms the customer actually read', () => {
    setup([card(1, { isPrimary: true })]);
    billing.getTerms.mockReturnValue(of({ scope: 'general', version: '2026-09.1', text: 'general terms' }));
    billing.enableAutoPay.mockReturnValue(of(overview({ autoPayEnabled: true })));
    component.openTerms('general', null);
    component.terms!.accepted = true;
    component.submitTerms();
    expect(billing.enableAutoPay).toHaveBeenCalledWith('2026-09.1');
    expect(component.autoPay!.autoPayEnabled).toBe(true);
  });
});
