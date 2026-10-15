import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { BookingServicesComponent } from './booking-services.component';
import { AdminService } from '../../../services/admin.service';
import { ExtraService, Service, ServiceThreshold, ServiceType } from '../../../services/booking.service';

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
      component.userPermissions().permissions.canUpdate = true;
      component.userPermissions.set(component.userPermissions());
      component.userPermissions().permissions.canCreate = true;
      component.userPermissions.set(component.userPermissions());
      component.selectedServiceType.set({ id: 1, name: 'Residential', extraServices: [] } as unknown as ServiceType);
      vi.spyOn(component, 'loadServiceTypes').mockImplementation(() => {});
    });

    it('sends the key with every save, blank meaning "no key"', () => {
      const update = vi.spyOn(admin, 'updateExtraService').mockReturnValue(of(extra({})));
      component.saveExtraService(extra({ name: 'We Bring a Hoover' }));
      expect(vi.mocked(update).mock.lastCall![1].extraServiceKey).toBe('vacuum-cleaner');

      component.saveExtraService(extra({ extraServiceKey: null }));
      expect(vi.mocked(update).mock.lastCall![1].extraServiceKey).toBeNull();
    });

    it('shows the server\'s reason when a key is refused', () => {
      vi.spyOn(admin, 'updateExtraService').mockReturnValue(throwError(() => new HttpErrorResponse({
        status: 400, error: { message: 'Extra service key must be lowercase (for example "move-in-out").' }
      })));
      vi.spyOn(console, 'error').mockReturnValue(undefined);
      component.saveExtraService(extra({ extraServiceKey: 'Vacuum' }));
      expect(component.extraServiceMessage().error).toContain('must be lowercase');
    });

    it('sends the key when creating', () => {
      const create = vi.spyOn(admin, 'createExtraService').mockReturnValue(of(extra({ id: 9 })));
      component.newExtraService().name = 'Oven';
      component.newExtraService.set(component.newExtraService());
      component.newExtraService().extraServiceKey = 'oven';
      component.newExtraService.set(component.newExtraService());
      component.addExtraService();
      expect(vi.mocked(create).mock.lastCall![0].extraServiceKey).toBe('oven');
    });

    it('offers a copy only of extras the type does not already have, by key first', () => {
      component.selectedServiceType()!.extraServices = [extra({ id: 15, name: 'Extra Cleaners', extraServiceKey: 'extra-cleaners' })];
      component.selectedServiceType.set(component.selectedServiceType());
      component.allExtraServices.set([
        extra({ id: 34, name: 'Additional Cleaners', extraServiceKey: 'extra-cleaners' }), // same extra, renamed copy
        extra({ id: 36, name: 'Pets', extraServiceKey: 'pets' })
      ]);
      expect(component.getAvailableExtraServicesForCopy().map(e => e.id)).toEqual([36]);
    });
  });

  describe('included amounts based on the service itself', () => {
    const svc = (o: Partial<Service>): Service => ({
      id: 0, name: '', serviceKey: '', cost: 0, timeDuration: 0, serviceTypeId: 1, inputType: 'dropdown',
      isRangeInput: false, isActive: true, thresholds: [], rateTiers: [], ...o
    });
    const levelsRule: ServiceThreshold = {
      id: 7, serviceId: 15, sourceServiceId: 15, sourceServiceKey: 'levels', sourceServiceName: 'Levels',
      sourceQuantity: 1, includedQuantity: 1
    };
    let levels: Service;

    beforeEach(() => {
      levels = svc({ id: 15, name: 'Levels', serviceKey: 'levels', chargeAboveThreshold: true, thresholds: [levelsRule] });
      component.selectedServiceType.set({
        id: 1, name: 'Residential', extraServices: [],
        services: [svc({ id: 1, name: 'Bedrooms', serviceKey: 'bedrooms' }), svc({ id: 2, name: 'Bathrooms', serviceKey: 'bathrooms' }), levels]
      } as unknown as ServiceType);
    });

    it('offers the service itself as a source, labelled as such', () => {
      expect(component.getThresholdSourceCandidates(levels).map(s => s.id)).toEqual([1, 2, 15]);
      expect(component.getThresholdSourceLabel(levels, 15)).toBe('Levels (this service)');
      expect(component.getThresholdSourceLabel(levels, 1)).toBe('Bedrooms');
    });

    it('still defaults a new rule to another service', () => {
      component.startAddingThreshold(levels);
      expect(component.newThreshold().sourceServiceId).toBe(1);
    });

    it('shows the saved self-reference selected when the rule is edited', async () => {
      component.expandedPricingServiceId.set(15);
      component.startEditingThreshold(levelsRule);
      fixture.detectChanges();
      await fixture.whenStable();

      const select: HTMLSelectElement = fixture.nativeElement.querySelector('select[aria-label="Based on"]');
      expect(select).toBeTruthy();
      expect(select.selectedOptions[0]?.textContent?.trim()).toBe('Levels (this service)');
    });

    it('keeps a saved source that is no longer offered visible instead of blank', async () => {
      const foreign: ServiceThreshold = { ...levelsRule, sourceServiceId: 99, sourceServiceName: 'Old Rooms' };
      levels.thresholds = [foreign];
      component.expandedPricingServiceId.set(15);
      component.startEditingThreshold(foreign);
      fixture.detectChanges();
      await fixture.whenStable();

      const select: HTMLSelectElement = fixture.nativeElement.querySelector('select[aria-label="Based on"]');
      expect(select.selectedOptions[0]?.textContent?.trim()).toBe('Old Rooms');
    });

    const hints = (): string[] =>
      Array.from(fixture.nativeElement.querySelectorAll('.pricing-hint') as NodeListOf<HTMLElement>)
        .map(p => p.textContent!.replace(/\s+/g, ' ').trim());

    it('says the included amount only sets what is free, with no minimum line, for a non-sqft service', async () => {
      component.expandedPricingServiceId.set(15);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(hints()[0]).toBe(
        'How much of Levels is included at no charge, based on a service\'s quantity (or its own). ' +
        'Customers can still pick less; this only sets what is free.');
      expect(fixture.nativeElement.querySelector('.sqft-minimum-hint')).toBeNull();
    });

    it('adds the minimum line for the sqft service, found by key rather than by name', async () => {
      const sqft = svc({ id: 3, name: 'Home size', serviceKey: 'sqft', inputType: 'slider', isRangeInput: true, chargeAboveThreshold: true });
      component.selectedServiceType()!.services.push(sqft);
      component.selectedServiceType.set(component.selectedServiceType());
      component.expandedPricingServiceId.set(3);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(hints()[0]).toContain('How much of Home size is included at no charge');
      expect(fixture.nativeElement.querySelector('.sqft-minimum-hint')?.textContent?.trim())
        .toBe('For Sq.ft based on Bedrooms, this is also the lowest value a customer can pick.');
    });
  });

  describe('add / edit side panel (2026-10)', () => {
    let admin: AdminService;
    const extra = (o: Partial<ExtraService>): ExtraService => ({
      id: 5, name: 'Deep Cleaning', price: 90, duration: 120, hasQuantity: false, hasHours: false,
      isDeepCleaning: true, isSuperDeepCleaning: false, isSameDayService: false, priceMultiplier: 1.5,
      timeMultiplier: 1.25, isAvailableForAll: true, isActive: true, displayOrder: 1, extraServiceKey: 'deep-cleaning', ...o
    });
    const svc = (o: Partial<Service>): Service => ({
      id: 3, name: 'Square Feet', serviceKey: 'sqft', cost: 0.05, timeDuration: 0.1, serviceTypeId: 1,
      inputType: 'slider', isRangeInput: true, isActive: true, minValue: 400, maxValue: 5000, stepValue: 100,
      ...o
    } as Service);

    beforeEach(() => {
      admin = TestBed.inject(AdminService);
      component.userPermissions().permissions.canUpdate = true;
      component.userPermissions().permissions.canCreate = true;
      component.userPermissions.set(component.userPermissions());
      component.selectedServiceType.set({ id: 1, name: 'Residential', services: [], extraServices: [] } as unknown as ServiceType);
      vi.spyOn(component, 'loadServiceTypes').mockImplementation(() => {});
      vi.spyOn(component, 'loadAllExtraServices').mockImplementation(() => {});
    });

    it('edits a COPY, so Cancel leaves the table row untouched', () => {
      const row = extra({});
      component.editExtraService(row);
      expect(component.panel()).toEqual({ kind: 'extra', mode: 'edit' });

      component.extraServiceDraft()!.price = 999;
      component.cancelEditExtraService();

      expect(row.price).toBe(90);
      expect(component.panel()).toBeNull();
      expect(component.extraServiceDraft()).toBeNull();
    });

    it('sends the time multiplier with the price multiplier', () => {
      const update = vi.spyOn(admin, 'updateExtraService').mockReturnValue(of(extra({})));
      component.editExtraService(extra({}));
      component.extraServiceDraft()!.timeMultiplier = 1.4;
      component.saveExtraService(component.extraServiceDraft()!);

      const sent = vi.mocked(update).mock.lastCall![1];
      expect(sent.priceMultiplier).toBe(1.5);
      expect(sent.timeMultiplier).toBe(1.4);
      expect(component.panel()).toBeNull();
    });

    it('an extra has exactly one special role and one pricing mode', () => {
      component.editExtraService(extra({}));
      component.setExtraRole('sameDay');
      const draft = component.extraServiceDraft()!;
      expect([draft.isDeepCleaning, draft.isSuperDeepCleaning, draft.isSameDayService]).toEqual([false, false, true]);
      expect(component.isCleaningTypeExtra(draft)).toBe(false);

      component.setExtraPricingMode('quantity');
      component.setExtraPricingMode('hours');
      expect([draft.hasQuantity, draft.hasHours]).toEqual([false, true]);
    });

    it('stores one customer control, and only the sqft service may use the slider', () => {
      component.editService(svc({ inputType: 'dropdown', isRangeInput: true }));
      expect(component.getServiceControl(component.serviceDraft()!)).toBe('slider');

      component.setServiceControl('stepper');
      expect(component.serviceDraft()!.inputType).toBe('dropdown');
      expect(component.serviceDraft()!.isRangeInput).toBe(false);

      expect(component.canUseSlider({ serviceKey: 'sqft' })).toBe(true);
      expect(component.canUseSlider({ serviceKey: 'bedrooms' })).toBe(false);
      // Legacy rows that booking could not draw now read as a stepper.
      expect(component.getServiceControl({ inputType: 'number', isRangeInput: false })).toBe('stepper');
    });

    it('a regular service edits with the "Regular" role selected, not a blank one', () => {
      // The API sends null for a regular service; the model types it as optional.
      component.editService(svc({ serviceRelationType: undefined }));
      expect(component.serviceDraft()!.serviceRelationType).toBe('');
    });

    it('clears the previous message before the next action, and shows a failure in the panel', () => {
      component.serviceMessage.set({ error: 'old failure', success: '' });
      vi.spyOn(admin, 'updateService').mockReturnValue(throwError(() => new HttpErrorResponse({
        status: 400, error: { message: 'Minimum (5) cannot be greater than maximum (2).' }
      })));
      component.editService(svc({}));
      component.saveService(component.serviceDraft()!);

      expect(component.serviceMessage().error).toBe('Minimum (5) cannot be greater than maximum (2).');
      expect(component.panelError()).toBe('Minimum (5) cannot be greater than maximum (2).');
      expect(component.panel()).toEqual({ kind: 'service', mode: 'edit' });
    });

    it('selecting another service type closes an open edit', () => {
      const type = { id: 2, name: 'Office', services: [], extraServices: [], hasPoll: false } as unknown as ServiceType;
      component.editServiceType(type);
      expect(component.panel()).toEqual({ kind: 'serviceType', mode: 'edit' });
      component.serviceTypeDraft()!.name = 'Changed';

      component.selectServiceType({ id: 1, name: 'Residential', services: [], extraServices: [], hasPoll: false } as unknown as ServiceType);
      expect(component.panel()).toBeNull();
      expect(type.name).toBe('Office');
    });
  });
});
