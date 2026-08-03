import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpecialOffersComponent } from './special-offers.component';

import { testProviders } from '../../../../testing/test-providers';

describe('SpecialOffersComponent', () => {
  let component: SpecialOffersComponent;
  let fixture: ComponentFixture<SpecialOffersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [SpecialOffersComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SpecialOffersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
