import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VerifyEmailNoticeComponent } from './verify-email-notice.component';

describe('VerifyEmailNoticeComponent', () => {
  let component: VerifyEmailNoticeComponent;
  let fixture: ComponentFixture<VerifyEmailNoticeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
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
