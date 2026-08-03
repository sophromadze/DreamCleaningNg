import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PaymentComponent } from './payment.component';

import { testProviders } from '../../../testing/test-providers';

describe('PaymentComponent', () => {
  let component: PaymentComponent;
  let fixture: ComponentFixture<PaymentComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [PaymentComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PaymentComponent);
    component = fixture.componentInstance;

    // `amount` and `clientSecret` are required @Inputs (declared with `!`), always
    // supplied by the parent in real use. The template calls `amount.toFixed(2)`,
    // so they have to be set before the first detectChanges().
    component.amount = 0;
    component.clientSecret = 'pi_test_secret';

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
