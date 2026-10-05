import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { testProviders } from '../../testing/test-providers';
import { environment } from '../../environments/environment';
import { UpcomingRecurringOrdersComponent } from './components/upcoming-recurring-orders/upcoming-recurring-orders.component';
import { OrderDetailsComponent } from '../auth/profile/order-details/order-details.component';
import { UpcomingRecurringOrders } from '../services/recurring-order.service';
import { Order } from '../services/order.service';

/**
 * A weekly-flat-fee contract's operational cleanings are $0 records (2026-10). Wherever a price
 * would be shown, the customer reads "Billed weekly by contract DCC-…" — never "$0.00", which
 * would look like a free cleaning.
 */
describe('Billed weekly by contract label', () => {
  const LABEL = 'Billed weekly by contract DCC-2026-12918497';

  beforeEach(() => TestBed.configureTestingModule({ providers: [...testProviders] }));

  it('the upcoming recurring list shows the label instead of $0.00, and ordinary cleanings keep their price', () => {
    const fixture = TestBed.createComponent(UpcomingRecurringOrdersComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const data: UpcomingRecurringOrders = {
      orders: [
        { orderId: 1, serviceDate: '2026-10-04T00:00:00', serviceTime: '09:00:00', serviceTypeName: 'Commercial',
          status: 'Pending', total: 0, amountDue: 0, isPaid: false, isPayable: false, queuePosition: 0,
          blockedReason: null, paymentMethod: 'Invoice', billedByContractLabel: LABEL },
        { orderId: 2, serviceDate: '2026-10-05T00:00:00', serviceTime: '09:00:00', serviceTypeName: 'Regular Cleaning',
          status: 'Pending', total: 150, amountDue: 150, isPaid: false, isPayable: true, queuePosition: 1,
          blockedReason: null, paymentMethod: 'Normal' }
      ],
      payAllTotal: 150, payAllCount: 1, canPayAll: false
    };
    http.expectOne(`${environment.apiUrl}/my-recurring-orders`).flush(data);
    fixture.detectChanges();

    const items = Array.from(fixture.nativeElement.querySelectorAll('.uro-item') as NodeListOf<HTMLElement>);
    expect(items[0].textContent).toContain(LABEL);
    expect(items[0].textContent).not.toContain('$0.00');
    expect(items[1].textContent).toContain('$150.00');
    expect(items[1].textContent).not.toContain('Billed weekly');
  });

  function details(order: Partial<Order>): string {
    const fixture = TestBed.createComponent(OrderDetailsComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit starts its own load; the order is supplied after it
    component.order = {
      id: 9, status: 'Pending', serviceDate: '2026-10-04T00:00:00', serviceTime: '09:00:00',
      serviceTypeName: 'Commercial', services: [], extraServices: [], subTotal: 0, tax: 0, tips: 0,
      total: 0, discountAmount: 0, companyDevelopmentTips: 0, paymentMethod: 'Invoice',
      ...order
    } as unknown as Order;
    component.isLoading = false;
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  }

  it('order details show a Billing section with the label instead of a $0.00 breakdown', () => {
    const text = details({ billedByContractLabel: LABEL });
    expect(text).toContain(LABEL);
    expect(text).not.toContain('Price Breakdown');
    expect(text).not.toContain('$0.00');
  });

  it('an ordinary order keeps its price breakdown', () => {
    const text = details({ subTotal: 100, tax: 8.88, total: 108.88, paymentMethod: 'Normal' });
    expect(text).toContain('Price Breakdown');
    expect(text).toContain('$108.88');
    expect(text).not.toContain('Billed weekly');
  });
});
