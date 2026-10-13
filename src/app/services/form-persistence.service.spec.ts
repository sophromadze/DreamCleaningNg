import { TestBed } from '@angular/core/testing';

import { FormPersistenceService } from './form-persistence.service';
import { BOOKING_CHOICE_COOKIE, LEGACY_HERO_CHOICE_COOKIE, writeBookingChoiceCookie } from '../shared/booking/booking-choice-cookie';
import { readCookie } from '../shared/ssr/read-cookie';

describe('FormPersistenceService', () => {
  let service: FormPersistenceService;
  const choiceCookie = () => readCookie(document.cookie, BOOKING_CHOICE_COOKIE);

  beforeEach(() => {
    sessionStorage.removeItem('booking_form_data');
    writeBookingChoiceCookie(document, null);
    TestBed.configureTestingModule({});
    service = TestBed.inject(FormPersistenceService);
  });

  afterEach(() => {
    sessionStorage.removeItem('booking_form_data');
    writeBookingChoiceCookie(document, null);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /**
   * Every save mirrors the non-personal part of the draft into the booking-choice cookie, by KEY
   * (so the server can draw the hero and step 1 of /booking), and clearing the draft deletes it.
   * The booking page and the hero both save through here, so the cookie never drifts from storage.
   */
  describe('booking choice cookie', () => {
    const form = {
      selectedServiceTypeId: '4',
      selectedServiceTypeKey: 'residential',
      selectedServices: [{ serviceId: '6', serviceKey: 'bedrooms', quantity: 2 }, { serviceId: '7', serviceKey: 'bathrooms', quantity: 1 }],
      selectedExtraServices: [{ extraServiceId: '9', extraServiceKey: 'oven', quantity: 1, hours: 0 }],
      selectedSubscriptionId: '3',
      selectedSubscriptionDays: 14,
      cleaningType: 'deep',
      propertyType: 'House',
      serviceDate: '2026-10-20',
      serviceTime: '09:30',
      contactFirstName: 'Ana',
      contactEmail: 'ana@example.com',
      contactPhone: '5551234567',
      serviceAddress: '1 Main St',
      promoCode: 'SECRET10'
    };

    it('is written on save from the keys, never the contact details, address or promo code', () => {
      service.saveFormData(form);

      expect(choiceCookie()).toBe('2.residential.d.h..bedrooms~2_bathrooms~1.oven~1~0.14.20261020.0930..');
      expect(choiceCookie()).not.toMatch(/Ana|example|555|Main|SECRET|~6|~7/);
    });

    it('follows updates made by the booking page', () => {
      service.saveFormData(form);
      service.updateFormData({ selectedServices: [{ serviceId: '6', serviceKey: 'bedrooms', quantity: 3 }], cleaningType: 'normal' });

      expect(choiceCookie()).toBe('2.residential.n.h..bedrooms~3.oven~1~0.14.20261020.0930..');
    });

    it('is deleted when the saved form is cleared (booking completed, discarded, or clear-all)', () => {
      service.saveFormData(form);
      service.clearFormData();

      expect(choiceCookie()).toBeNull();
    });

    it('is not written for a form with no keyed service type, nor for an Admin Mode draft', () => {
      service.saveFormData({ contactFirstName: 'Ana', selectedServiceTypeId: '4' });
      expect(choiceCookie()).toBeNull();

      service.saveFormData({ ...form, wasAdminMode: true });
      expect(choiceCookie()).toBeNull();
    });

    it('retires the old ID-based hero cookie on the next save', () => {
      document.cookie = `${LEGACY_HERO_CHOICE_COOKIE}=1.4.n.-.6-2; Path=/`;
      service.saveFormData(form);

      expect(readCookie(document.cookie, LEGACY_HERO_CHOICE_COOKIE)).toBeNull();
    });
  });
});
