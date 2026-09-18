import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExtraServicesGridComponent } from './extra-services-grid.component';
import { ExtraService } from '../../../services/booking.service';

function extra(overrides: Partial<ExtraService> = {}): ExtraService {
  return {
    id: 1,
    name: 'Oven Cleaning',
    price: 30,
    duration: 30,
    hasQuantity: false,
    hasHours: false,
    isDeepCleaning: false,
    isSuperDeepCleaning: false,
    isSameDayService: false,
    priceMultiplier: 1,
    isAvailableForAll: true,
    isActive: true,
    ...overrides
  };
}

describe('ExtraServicesGridComponent', () => {
  let component: ExtraServicesGridComponent;
  let fixture: ComponentFixture<ExtraServicesGridComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExtraServicesGridComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ExtraServicesGridComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  /**
   * The price line is opt-in so the customer-facing booking page and the customer's
   * order-edit page — neither of which passes the input — keep showing cards with no
   * price on them. Only the admin booking path turns it on.
   */
  describe('the price line is opt-in', () => {
    function renderedPrices(): string[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('.extra-price') as NodeListOf<HTMLElement>
      ).map(el => el.textContent!.trim());
    }

    beforeEach(() => {
      component.extras = [extra()];
      component.selections = [];
    });

    it('renders no price by default', () => {
      fixture.detectChanges();

      expect(component.showPrices).toBeFalse();
      expect(renderedPrices()).toEqual([]);
    });

    it('renders the price once switched on', () => {
      component.showPrices = true;
      fixture.detectChanges();

      expect(renderedPrices()).toEqual(['$30.00']);
    });
  });

  /**
   * A bare "$30" on an hourly or per-unit extra reads as the whole cost of adding it,
   * which is exactly the number an admin would quote down the phone.
   */
  describe('the label says what the price is per', () => {
    it('marks an hourly extra per hour', () => {
      expect(component.priceLabelFor(extra({ price: 25, hasHours: true }))).toBe('$25.00/hr');
    });

    it('marks a quantity extra per unit', () => {
      expect(component.priceLabelFor(extra({ price: 12.5, hasQuantity: true }))).toBe('$12.50 each');
    });

    it('leaves a flat extra unqualified', () => {
      expect(component.priceLabelFor(extra({ price: 40 }))).toBe('$40.00');
    });

    it('always shows cents', () => {
      expect(component.priceLabelFor(extra({ price: 8 }))).toBe('$8.00');
      expect(component.priceLabelFor(extra({ price: 8.5 }))).toBe('$8.50');
    });

    /** Hours wins over quantity, matching the calculator's own branch order. */
    it('prefers the hourly wording when an extra carries both', () => {
      expect(component.priceLabelFor(extra({ price: 20, hasHours: true, hasQuantity: true })))
        .toBe('$20.00/hr');
    });
  });
});
