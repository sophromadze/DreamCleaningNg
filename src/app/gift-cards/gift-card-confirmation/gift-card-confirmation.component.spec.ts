import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { GiftCardConfirmationComponent } from './gift-card-confirmation.component';

import { testProviders } from '../../../testing/test-providers';

describe('GiftCardConfirmationComponent', () => {
  let component: GiftCardConfirmationComponent;
  let fixture: ComponentFixture<GiftCardConfirmationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Its no-data redirect goes to /gift-cards, which the bare test router lacks.
      providers: [...testProviders, provideRouter([{ path: 'gift-cards', children: [] }])],
      imports: [GiftCardConfirmationComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GiftCardConfirmationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
