import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BookingConfirmationComponent } from './booking-confirmation.component';
import { BookingDataService } from '../../services/booking-data.service';

import { testProviders } from '../../../testing/test-providers';

describe('BookingConfirmationComponent', () => {
  let component: BookingConfirmationComponent;
  let fixture: ComponentFixture<BookingConfirmationComponent>;
  let bookingDataService: BookingDataService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [BookingConfirmationComponent]
    })
    .compileComponents();

    bookingDataService = TestBed.inject(BookingDataService);
    fixture = TestBed.createComponent(BookingConfirmationComponent);
    component = fixture.componentInstance;
    // NOTE: detectChanges() is deliberately left to each test — the whole point of
    // the regression case below is what the FIRST change-detection pass does.
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // Regression guard. BookingDataService keeps booking data in an in-memory
  // BehaviorSubject seeded with null (no sessionStorage), so a refresh or deep-link
  // onto /booking-confirmation arrives with bookingData === null. ngOnInit redirects
  // away, but router.navigate is async — the template still renders once in the same
  // change-detection pass. It used to deref bookingData.serviceDate unguarded and
  // throw "Cannot read properties of null (reading 'serviceDate')".
  it('should not throw during first render when bookingData is null', () => {
    expect(bookingDataService.getBookingData()).toBeNull();

    expect(() => fixture.detectChanges()).not.toThrow();

    expect(component.bookingData).toBeNull();
    // Withheld entirely rather than rendered half-built.
    expect(fixture.nativeElement.querySelector('.confirmation-content')).toBeNull();
  });

  // Guards the fix's additivity: adding `&& bookingData` must not suppress the
  // block in the normal case (data present, payment not yet completed).
  it('should still render the confirmation content when bookingData is present', () => {
    bookingDataService.setBookingData({
      serviceDate: '2026-08-20',
      serviceTime: '10:00',
      total: 250
    });

    fixture.detectChanges();

    expect(component.paymentCompleted).toBeFalse();
    expect(component.bookingData).toBeTruthy();

    const content: HTMLElement | null =
      fixture.nativeElement.querySelector('.confirmation-content');
    expect(content).not.toBeNull();
    expect(content!.textContent).toContain('Booking Summary');
  });
});
