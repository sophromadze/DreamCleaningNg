import {
  HERO_CHOICE_COOKIE, decodeHeroChoice, encodeHeroChoice, readCookie, validateHeroChoice, writeHeroChoiceCookie
} from './hero-choice-cookie';

describe('hero choice cookie', () => {
  const bedrooms = { id: 1, serviceKey: 'bedrooms', isActive: true, minValue: 1, maxValue: 6 } as any;
  const bathrooms = { id: 2, serviceKey: 'bathrooms', isActive: true, minValue: 1, maxValue: 6 } as any;
  const sqft = { id: 3, serviceKey: 'sqft', isActive: true, minValue: 400, maxValue: 5000 } as any;
  const retired = { id: 9, serviceKey: 'old', isActive: false, minValue: 0, maxValue: 9 } as any;
  const residential = { id: 1, name: 'Residential Cleaning', services: [bedrooms, bathrooms, sqft, retired] } as any;
  const office = { id: 2, name: 'Office Cleaning', services: [{ id: 5, serviceKey: 'hours', isActive: true, minValue: 2, maxValue: 8 }] } as any;
  const TYPES = [residential, office];

  describe('encode / decode', () => {
    it('round-trips the hero fields in a compact, URL-safe value', () => {
      const value = encodeHeroChoice({
        selectedServiceTypeId: '1', cleaningType: 'deep', propertyType: 'Apartment',
        selectedServices: [{ serviceId: '1', quantity: 3 }, { serviceId: '2', quantity: 2 }, { serviceId: '3', quantity: 1500 }]
      });

      expect(value).toBe('1.1.d.a.1-3_2-2_3-1500');
      expect(decodeHeroChoice(value)).toEqual({
        selectedServiceTypeId: '1', cleaningType: 'deep', propertyType: 'Apartment',
        selectedServices: [{ serviceId: '1', quantity: 3 }, { serviceId: '2', quantity: 2 }, { serviceId: '3', quantity: 1500 }]
      });
    });

    it('never carries contact details, and stays far under 1 KB at its largest', () => {
      const services = Array.from({ length: 40 }, (_, i) => ({ serviceId: String(100000000 + i), quantity: 9999999 }));
      const value = encodeHeroChoice({
        selectedServiceTypeId: '999999999', selectedServices: services, cleaningType: 'normal',
        contactFirstName: 'Ana', contactEmail: 'ana@example.com', contactPhone: '5551234567'
      })!;

      expect(value).not.toMatch(/Ana|example|555/);
      expect(`${HERO_CHOICE_COOKIE}=${value}`.length).toBeLessThan(300);
      expect(decodeHeroChoice(value)?.selectedServices.length).toBe(12);
    });

    it('has nothing to write without a numeric service type', () => {
      expect(encodeHeroChoice(null)).toBeNull();
      expect(encodeHeroChoice({ contactFirstName: 'Ana' })).toBeNull();
      expect(encodeHeroChoice({ selectedServiceTypeId: 'x1' })).toBeNull();
    });

    it('reads anything off-format as no choice', () => {
      for (const bad of ['', 'garbage', '2.1.n.-.', '1.1.x.-.', '1.1.n.z.', '1.1.n.-.1-', '1.1.n.-.a-1', '1.1.n.-.1-1;x', '1.-1.n.-.']) {
        expect(decodeHeroChoice(bad), bad).toBeNull();
      }
    });
  });

  describe('validate against the catalogue', () => {
    it('drops a choice whose service type is no longer offered', () => {
      expect(validateHeroChoice(decodeHeroChoice('1.7.n.-.1-3'), TYPES)).toBeNull();
    });

    it('keeps in-range quantities of the chosen type and drops the rest', () => {
      // 2-9: bathrooms above max; 5-4: another type's service; 9-1: retired service.
      const choice = validateHeroChoice(decodeHeroChoice('1.1.n.-.1-0_2-9_3-1200_5-4_9-1'), TYPES);

      // Bedrooms may be 0 (Studio) whatever minValue says, exactly as the hero's stepper allows.
      expect(choice?.selectedServices).toEqual([{ serviceId: '1', quantity: 0 }, { serviceId: '3', quantity: 1200 }]);
    });
  });

  it('reads one cookie out of a Cookie header', () => {
    expect(readCookie('a=1; dc_hero_choice=1.2.n.-.5-4; b=2', 'dc_hero_choice')).toBe('1.2.n.-.5-4');
    expect(readCookie('x_dc_hero_choice=1', 'dc_hero_choice')).toBeNull();
    expect(readCookie(null, 'dc_hero_choice')).toBeNull();
  });

  it('writes and deletes the cookie', () => {
    writeHeroChoiceCookie(document, { selectedServiceTypeId: '2', selectedServices: [{ serviceId: '5', quantity: 4 }] });
    expect(readCookie(document.cookie, HERO_CHOICE_COOKIE)).toBe('1.2.n.-.5-4');

    writeHeroChoiceCookie(document, null);
    expect(readCookie(document.cookie, HERO_CHOICE_COOKIE)).toBeNull();
  });
});
