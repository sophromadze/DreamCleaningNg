import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GiftCardPaymentComponent } from './gift-card-payment.component';

describe('GiftCardPaymentComponent', () => {
  let component: GiftCardPaymentComponent;
  let fixture: ComponentFixture<GiftCardPaymentComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GiftCardPaymentComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GiftCardPaymentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
