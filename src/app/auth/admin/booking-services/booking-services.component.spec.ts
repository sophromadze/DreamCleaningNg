import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { BookingServicesComponent } from './booking-services.component';
import { AdminService } from '../../../services/admin.service';
import { ExtraService, ServiceType } from '../../../services/booking.service';

import { testProviders } from '../../../../testing/test-providers';

describe('BookingServicesComponent', () => {
  let component: BookingServicesComponent;
  let fixture: ComponentFixture<BookingServicesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [...testProviders],
      imports: [BookingServicesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BookingServicesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('extra service key', () => {
    let admin: AdminService;
    const extra = (o: Partial<ExtraService>): ExtraService => ({
      id: 1, name: 'Vacuum Cleaner', price: 150, duration: 0, hasQuantity: false, hasHours: false,
      isDeepCleaning: false, isSuperDeepCleaning: false, isSameDayService: false, priceMultiplier: 1,
      isAvailableForAll: true, isActive: true, displayOrder: 1, extraServiceKey: 'vacuum-cleaner', ...o
    });

    beforeEach(() => {
      admin = TestBed.inject(AdminService);
      component.userPermissions.permissions.canUpdate = true;
      component.userPermissions.permissions.canCreate = true;
      component.selectedServiceType = { id: 1, name: 'Residential', extraServices: [] } as unknown as ServiceType;
      spyOn(component, 'loadServiceTypes').and.stub();
    });

    it('sends the key with every save, blank meaning "no key"', () => {
      const update = spyOn(admin, 'updateExtraService').and.returnValue(of(extra({})));
      component.saveExtraService(extra({ name: 'We Bring a Hoover' }));
      expect(update.calls.mostRecent().args[1].extraServiceKey).toBe('vacuum-cleaner');

      component.saveExtraService(extra({ extraServiceKey: null }));
      expect(update.calls.mostRecent().args[1].extraServiceKey).toBeNull();
    });

    it('shows the server\'s reason when a key is refused', () => {
      spyOn(admin, 'updateExtraService').and.returnValue(throwError(() => new HttpErrorResponse({
        status: 400, error: { message: 'Extra service key must be lowercase (for example "move-in-out").' }
      })));
      spyOn(console, 'error');
      component.saveExtraService(extra({ extraServiceKey: 'Vacuum' }));
      expect(component.extraServiceMessage.error).toContain('must be lowercase');
    });

    it('sends the key when creating', () => {
      const create = spyOn(admin, 'createExtraService').and.returnValue(of(extra({ id: 9 })));
      component.newExtraService.name = 'Oven';
      component.newExtraService.extraServiceKey = 'oven';
      component.addExtraService();
      expect(create.calls.mostRecent().args[0].extraServiceKey).toBe('oven');
    });

    it('offers a copy only of extras the type does not already have, by key first', () => {
      component.selectedServiceType!.extraServices = [extra({ id: 15, name: 'Extra Cleaners', extraServiceKey: 'extra-cleaners' })];
      component.allExtraServices = [
        extra({ id: 34, name: 'Additional Cleaners', extraServiceKey: 'extra-cleaners' }), // same extra, renamed copy
        extra({ id: 36, name: 'Pets', extraServiceKey: 'pets' })
      ];
      expect(component.getAvailableExtraServicesForCopy().map(e => e.id)).toEqual([36]);
    });
  });
});
