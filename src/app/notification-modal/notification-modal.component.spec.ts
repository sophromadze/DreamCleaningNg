import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NotificationModalComponent } from './notification-modal.component';

import { testProviders } from '../../testing/test-providers';

describe('NotificationModalComponent', () => {
  let component: NotificationModalComponent;
  let fixture: ComponentFixture<NotificationModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [NotificationModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NotificationModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
