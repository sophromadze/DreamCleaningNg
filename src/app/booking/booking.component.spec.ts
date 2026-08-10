import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BookingComponent } from './booking.component';

import { testProviders } from '../../testing/test-providers';

describe('BookingComponent', () => {
  let component: BookingComponent;
  let fixture: ComponentFixture<BookingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [BookingComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BookingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('discounts are dropped when the order owner changes', () => {
    /** Put the page in "every kind of discount is applied" state. */
    function applyEveryDiscount() {
      component.selectedSpecialOffer = {
        id: 11,
        specialOfferId: 3,
        name: 'First Time Customer',
        description: '10% off',
        isPercentage: true,
        discountValue: 10,
        isUsed: false
      } as any;
      component.specialOfferApplied = true;
      component.firstTimeDiscountApplied = true;
      component.promoCodeApplied = true;
      component.promoDiscount = 25;
      component.giftCardApplied = true;
      component.isGiftCard = true;
      component.giftCardBalance = 100;
      component.giftCardAmountToUse = 40;
      component.selectedPointsToRedeem = 500;
      component.pointsDiscountAmount = 5;
      component.useCredits = true;
      component.promoCode.setValue('SAVE25');
    }

    function expectNoDiscountsApplied() {
      expect(component.selectedSpecialOffer).toBeNull();
      expect(component.specialOfferApplied).toBeFalse();
      expect(component.firstTimeDiscountApplied).toBeFalse();
      expect(component.promoCodeApplied).toBeFalse();
      expect(component.promoDiscount).toBe(0);
      expect(component.giftCardApplied).toBeFalse();
      expect(component.isGiftCard).toBeFalse();
      expect(component.giftCardAmountToUse).toBe(0);
      expect(component.selectedPointsToRedeem).toBe(0);
      expect(component.pointsDiscountAmount).toBe(0);
      expect(component.useCredits).toBeFalse();
      expect(component.promoCode.value).toBe('');
      // The promo input is disabled while a special offer is applied — it must come back.
      expect(component.promoCode.disabled).toBeFalse();
    }

    it('clears them when admin mode is toggled on', () => {
      applyEveryDiscount();

      component.toggleAdminMode();

      expect(component.isAdminMode).toBeTrue();
      expectNoDiscountsApplied();
      expect(component.discountsClearedForAccountSwitch).toBeTrue();
    });

    it('clears them when a target user is picked in admin mode', () => {
      component.isAdminMode = true;
      applyEveryDiscount();

      component.selectUser({ id: 42, firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' } as any);

      expect(component.selectedTargetUser?.id).toBe(42);
      expectNoDiscountsApplied();
      expect(component.discountsClearedForAccountSwitch).toBeTrue();
    });

    it('clears them when the target user selection is cleared', () => {
      component.isAdminMode = true;
      component.selectedTargetUser = { id: 42, firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com' } as any;
      applyEveryDiscount();

      component.clearSelectedUser();

      expect(component.selectedTargetUser).toBeNull();
      expectNoDiscountsApplied();
      expect(component.discountsClearedForAccountSwitch).toBeTrue();
    });

    it('does not show the re-apply notice when nothing was applied', () => {
      component.toggleAdminMode();

      expect(component.discountsClearedForAccountSwitch).toBeFalse();
    });
  });
});
