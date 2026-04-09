import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CleanerCalendarComponent } from './cleaner-calendar.component';

describe('CleanerCalendarComponent', () => {
  let component: CleanerCalendarComponent;
  let fixture: ComponentFixture<CleanerCalendarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CleanerCalendarComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CleanerCalendarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
