import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VerifyEmailNoticeComponent } from './verify-email-notice.component';

import { testProviders } from '../../../testing/test-providers';

describe('VerifyEmailNoticeComponent', () => {
  let component: VerifyEmailNoticeComponent;
  let fixture: ComponentFixture<VerifyEmailNoticeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [VerifyEmailNoticeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VerifyEmailNoticeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
