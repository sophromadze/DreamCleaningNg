import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminGiftCardsComponent } from './admin-gift-cards.component';

describe('AdminGiftCardsComponent', () => {
  let component: AdminGiftCardsComponent;
  let fixture: ComponentFixture<AdminGiftCardsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
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
