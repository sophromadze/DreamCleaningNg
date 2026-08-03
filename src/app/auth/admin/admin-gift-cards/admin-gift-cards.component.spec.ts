import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminGiftCardsComponent } from './admin-gift-cards.component';

import { testProviders } from '../../../../testing/test-providers';

describe('AdminGiftCardsComponent', () => {
  let component: AdminGiftCardsComponent;
  let fixture: ComponentFixture<AdminGiftCardsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [AdminGiftCardsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AdminGiftCardsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
