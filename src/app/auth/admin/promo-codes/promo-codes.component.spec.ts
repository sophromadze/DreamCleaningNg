import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PromoCodesComponent } from './promo-codes.component';

import { testProviders } from '../../../../testing/test-providers';

describe('PromoCodesComponent', () => {
  let component: PromoCodesComponent;
  let fixture: ComponentFixture<PromoCodesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [PromoCodesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PromoCodesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
