import { TestBed } from '@angular/core/testing';

import { FormPersistenceService } from './form-persistence.service';
import { HERO_CHOICE_COOKIE, readCookie, writeHeroChoiceCookie } from '../shared/booking/hero-choice-cookie';

describe('FormPersistenceService', () => {
  let service: FormPersistenceService;
  const heroCookie = () => readCookie(document.cookie, HERO_CHOICE_COOKIE);

  beforeEach(() => {
    sessionStorage.removeItem('booking_form_data');
    writeHeroChoiceCookie(document, null);
    TestBed.configureTestingModule({});
    service = TestBed.inject(FormPersistenceService);
  });

  afterEach(() => {
    sessionStorage.removeItem('booking_form_data');
    writeHeroChoiceCookie(document, null);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /**
   * Every save mirrors the hero's part of the form into the hero cookie (so the server can draw a
   * returning visitor's form), and clearing the form deletes it. The booking page and the hero
   * both save through here, so the cookie can never drift from browser storage.
   */
  describe('hero choice cookie', () => {
    const form = {
      selectedServiceTypeId: '4',
      selectedServices: [{ serviceId: '6', quantity: 2 }, { serviceId: '7', quantity: 1 }],
      cleaningType: 'deep',
      propertyType: 'House',
      contactFirstName: 'Ana',
      contactEmail: 'ana@example.com',
      contactPhone: '5551234567',
      serviceAddress: '1 Main St'
    };

    it('is written on save with only the hero fields', () => {
      service.saveFormData(form);

      expect(heroCookie()).toBe('1.4.d.h.6-2_7-1');
    });

    it('follows updates made by the booking page', () => {
      service.saveFormData(form);
      service.updateFormData({ selectedServices: [{ serviceId: '6', quantity: 3 }], cleaningType: 'normal' });

      expect(heroCookie()).toBe('1.4.n.h.6-3');
    });

    it('is deleted when the saved form is cleared (booking completed or discarded)', () => {
      service.saveFormData(form);
      service.clearFormData();

      expect(heroCookie()).toBeNull();
    });

    it('is not written for a form with no service type yet', () => {
      service.saveFormData({ contactFirstName: 'Ana' });

      expect(heroCookie()).toBeNull();
    });
  });
});
