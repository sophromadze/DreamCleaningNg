import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GiftCardConfirmationComponent } from './gift-card-confirmation.component';

import { testProviders } from '../../../testing/test-providers';

describe('GiftCardConfirmationComponent', () => {
  let component: GiftCardConfirmationComponent;
  let fixture: ComponentFixture<GiftCardConfirmationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
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
