import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BookingServicesComponent } from './booking-services.component';

import { testProviders } from '../../../../testing/test-providers';

describe('BookingServicesComponent', () => {
  let component: BookingServicesComponent;
  let fixture: ComponentFixture<BookingServicesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [BookingServicesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BookingServicesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
