import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PollSuccessComponent } from './poll-success.component';

import { testProviders } from '../../../testing/test-providers';

describe('PollSuccessComponent', () => {
  let component: PollSuccessComponent;
  let fixture: ComponentFixture<PollSuccessComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [PollSuccessComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PollSuccessComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
