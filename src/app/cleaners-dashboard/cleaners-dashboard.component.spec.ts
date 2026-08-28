import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { CleanersDashboardComponent } from './cleaners-dashboard.component';
import { testProviders } from '../../testing/test-providers';

/**
 * Cleaners dashboard.
 *
 * The main job of this spec is to COMPILE the template — it is one of the larger ones in the app
 * and had no coverage at all, so a broken binding shipped silently. Beyond that it pins the
 * payment fields, which the Outgoing Payments page sends real money against.
 */
describe('CleanersDashboardComponent', () => {
  let fixture: ComponentFixture<CleanersDashboardComponent>;
  let component: CleanersDashboardComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CleanersDashboardComponent],
      providers: [...testProviders]
    }).compileComponents();

    fixture = TestBed.createComponent(CleanersDashboardComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // The dashboard fires its own loads on init; this spec is not asserting on them.
    httpMock.match(() => true).forEach(r => r.flush([]));
  });

  it('creates and renders', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('the payment fields', () => {
    it('starts blank — a cleaner with no recorded payout method is normal', () => {
      expect(component.formModel.paymentMethod).toBeNull();
      expect(component.formModel.paymentDetails).toBeNull();
    });

    /**
     * "Zelle number or email" and "Check payable to" are different enough that one generic
     * prompt would read as a mistake.
     */
    it('labels the details box after the chosen method', () => {
      expect(component.paymentDetailsLabel).toBe('Payment details');

      component.formModel.paymentMethod = 'Zelle';
      expect(component.paymentDetailsLabel).toBe('Zelle number or email');

      component.formModel.paymentMethod = 'Check';
      expect(component.paymentDetailsLabel).toBe('Check payable to');
    });

    it('summarises method and destination together for the detail panel', () => {
      expect(component.paymentSummary({ paymentMethod: 'Zelle', paymentDetails: '6465550134' }))
        .toBe('Zelle · 6465550134');
      expect(component.paymentSummary({ paymentMethod: 'Cash', paymentDetails: null })).toBe('Cash');
      expect(component.paymentSummary({ paymentMethod: null, paymentDetails: null })).toBe('');
    });

    /** The destination is pasted into a banking app, so the method must not travel with it. */
    it('copies the destination alone, without the method prefix', async () => {
      const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      component.formModel.paymentMethod = 'Zelle';
      component.formModel.paymentDetails = '6465550134';
      component.copyFormPaymentDetails();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith('6465550134');
      expect(component.paymentDetailsCopied).toBe(true);
    });

    it('does nothing when the box is empty', () => {
      const writeText = jasmine.createSpy('writeText');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      component.formModel.paymentDetails = null;
      component.copyFormPaymentDetails();

      expect(writeText).not.toHaveBeenCalled();
      expect(component.paymentDetailsCopied).toBe(false);
    });
  });
});
