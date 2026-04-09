import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CleanerCabinetComponent } from './cleaner-cabinet.component';

describe('CleanerCabinetComponent', () => {
  let component: CleanerCabinetComponent;
  let fixture: ComponentFixture<CleanerCabinetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CleanerCabinetComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CleanerCabinetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
