import {
  BOOKING_CHOICE_COOKIE, decodeBookingChoice, encodeBookingChoice, fillDraftIdsFromKeys, readBookingChoice,
  resolveBookingChoice, seedDraftFromChoice
} from './booking-choice-cookie';

describe('booking choice cookie', () => {
  const bedrooms = { id: 1, serviceKey: 'bedrooms', isActive: true, minValue: 1, maxValue: 6 } as any;
  const bathrooms = { id: 2, serviceKey: 'bathrooms', isActive: true, minValue: 1, maxValue: 6 } as any;
  const sqft = { id: 3, serviceKey: 'sqft', isActive: true, minValue: 400, maxValue: 5000 } as any;
  const retired = { id: 9, serviceKey: 'old', isActive: false, minValue: 0, maxValue: 9 } as any;
  const oven = { id: 28, name: 'Oven', extraServiceKey: 'oven', isActive: true } as any;
  const cabinet = { id: 27, name: 'Cabinet', extraServiceKey: null, isActive: true } as any;
  const residential = {
    id: 1, serviceKey: 'residential', isActive: true, services: [bedrooms, bathrooms, sqft, retired], extraServices: [oven, cabinet]
  } as any;
  const office = { id: 2, serviceKey: 'office', isActive: true, services: [{ id: 5, serviceKey: 'hours', isActive: true, minValue: 2, maxValue: 8 }], extraServices: [] } as any;
  const preArranged = { id: 7, serviceKey: 'pre-arranged', isActive: true, isCustom: true, services: [], extraServices: [] } as any;
  const TYPES = [residential, office, preArranged];
  const PLANS = [
    { id: 1, name: 'One Time', subscriptionDays: 0 }, { id: 3, name: 'Bi-Weekly', subscriptionDays: 14 }
  ] as any[];

  const draft = {
    selectedServiceTypeId: '1', selectedServiceTypeKey: 'residential',
    selectedServices: [{ serviceId: '1', serviceKey: 'bedrooms', quantity: 3 }, { serviceId: '3', serviceKey: 'sqft', quantity: 1500 }],
    selectedExtraServices: [
      { extraServiceId: '28', extraServiceKey: 'oven', quantity: 1, hours: 1.5 },
      { extraServiceId: '27', extraServiceKey: null, quantity: 1, hours: 0 }
    ],
    selectedSubscriptionId: '3', selectedSubscriptionDays: 14,
    cleaningType: 'deep', propertyType: 'House', levelsQuantity: 2,
    serviceDate: '2026-10-20', serviceTime: '09:30', tips: 12.5, floorTypes: ['hardwood', 'other'], floorTypeOther: 'Cork tiles',
    contactFirstName: 'Ana', contactEmail: 'ana@example.com', contactPhone: '5551234567', serviceAddress: '1 Main St',
    promoCode: 'SECRET10', specialInstructions: 'Key under the mat', pollAnswers: { 4: 'Very dirty' }
  };

  describe('encode / decode', () => {
    it('round-trips the non-personal choice, by key, in a compact cookie-safe value', () => {
      const value = encodeBookingChoice(draft)!;

      expect(value).toBe('2.residential.d.h.2.bedrooms~3_sqft~1500.oven~1~3.14.20261020.0930.1250.hardwood~other');
      expect(value).toMatch(/^[A-Za-z0-9._~-]+$/);
      expect(decodeBookingChoice(value)).toEqual({
        typeKey: 'residential', cleaningType: 'deep', propertyType: 'House', levels: 2,
        services: [{ key: 'bedrooms', quantity: 3 }, { key: 'sqft', quantity: 1500 }],
        extras: [{ key: 'oven', quantity: 1, hours: 1.5 }],
        planDays: 14, date: '2026-10-20', time: '09:30', tips: 12.5, floorTypes: ['hardwood', 'other']
      });
    });

    it('never carries contact details, address, notes, promo code, poll answers, free text or ids', () => {
      const value = encodeBookingChoice(draft)!;

      expect(value).not.toMatch(/Ana|example|555|Main|SECRET|Key under|Very dirty|Cork|~27|~28/);
    });

    it('omits an unkeyed extra rather than naming it', () => {
      expect(encodeBookingChoice(draft)).not.toContain('Cabinet');
      expect(decodeBookingChoice(encodeBookingChoice(draft))!.extras.map(e => e.key)).toEqual(['oven']);
    });

    it('stays far under the browser cookie limit at its largest', () => {
      const key = 'a'.repeat(50);
      const big = {
        ...draft,
        selectedServices: Array.from({ length: 40 }, () => ({ serviceId: '1', serviceKey: key, quantity: 9999999 })),
        selectedExtraServices: Array.from({ length: 60 }, () => ({ extraServiceId: '1', extraServiceKey: key, quantity: 999, hours: 99 })),
        floorTypes: Array.from({ length: 30 }, () => 'natural-stone')
      };
      const value = encodeBookingChoice(big)!;

      expect(`${BOOKING_CHOICE_COOKIE}=${value}`.length).toBeLessThan(2600);
      expect(decodeBookingChoice(value)).not.toBeNull();
    });

    it('has nothing to write without a keyed service type, or for an Admin Mode draft', () => {
      expect(encodeBookingChoice(null)).toBeNull();
      expect(encodeBookingChoice({ selectedServiceTypeId: '1' })).toBeNull();
      expect(encodeBookingChoice({ ...draft, selectedServiceTypeKey: 'Bad Key' })).toBeNull();
      expect(encodeBookingChoice({ ...draft, wasAdminMode: true })).toBeNull();
    });

    it('reads anything off-format as no choice, including the retired v1 hero format', () => {
      for (const bad of ['', 'garbage', '1.1.n.-.1-3', '2.residential.x...', '2.Residential.n...........',
        '2.residential.n.......', '2.residential.n...bedrooms~3;x......', '3.residential.n...........',
        '2.residential.n...bedrooms~3......%20', '2.-residential.n...........']) {
        expect(decodeBookingChoice(bad), bad).toBeNull();
      }
    });

    it('drops an impossible date or time instead of trusting it', () => {
      const choice = decodeBookingChoice('2.residential.n......20261340.2575..')!;

      expect(choice).not.toBeNull();
      expect(choice.date).toBeUndefined();
      expect(choice.time).toBeUndefined();
    });
  });

  describe('resolve against the current catalogue (keys only)', () => {
    it('turns keys back into ids and keeps both', () => {
      const resolved = resolveBookingChoice(decodeBookingChoice(encodeBookingChoice(draft)), TYPES, { subscriptions: PLANS })!;

      expect(resolved.selectedServiceTypeId).toBe('1');
      expect(resolved.selectedServices).toEqual([
        { serviceId: '1', serviceKey: 'bedrooms', quantity: 3 }, { serviceId: '3', serviceKey: 'sqft', quantity: 1500 }
      ]);
      expect(resolved.selectedExtraServices).toEqual([{ extraServiceId: '28', extraServiceKey: 'oven', quantity: 1, hours: 1.5 }]);
      expect(resolved.selectedSubscriptionId).toBe('3');
      expect(resolved.serviceDate).toBe('2026-10-20');
      expect(resolved.contactFirstName).toBeUndefined();
    });

    it('finds the type by key, never by id: a renumbered catalogue still resolves', () => {
      const renumbered = [{ ...residential, id: 41 }];

      expect(resolveBookingChoice(decodeBookingChoice('2.residential.n.........'), renumbered)?.selectedServiceTypeId).toBe('41');
    });

    it('drops the whole choice when its type is gone, unknown, inactive or custom', () => {
      expect(resolveBookingChoice(decodeBookingChoice('2.move-in-out.n.........'), TYPES)).toBeNull();
      expect(resolveBookingChoice(decodeBookingChoice('2.residential.n.........'), [{ ...residential, isActive: false }])).toBeNull();
      expect(resolveBookingChoice(decodeBookingChoice('2.pre-arranged.n.........'), TYPES)).toBeNull();
    });

    it('drops out-of-range quantities, retired services and unknown extras on their own', () => {
      const resolved = resolveBookingChoice(
        decodeBookingChoice('2.residential.n...bedrooms~0_bathrooms~9_sqft~1200_old~1_hours~4.oven~1~0_windows~1~0.99....'),
        TYPES, { subscriptions: PLANS })!;

      // Bedrooms 0 is a studio (allowed below minValue), bathrooms 9 is over the max.
      expect(resolved.selectedServices!.map(s => s.serviceKey)).toEqual(['bedrooms', 'sqft']);
      expect(resolved.selectedExtraServices!.map(e => e.extraServiceKey)).toEqual(['oven']);
      // No plan with a 99-day period: no plan, the page picks its default.
      expect(resolved.selectedSubscriptionId).toBeUndefined();
    });

    it('lets a caller narrow the types it draws (the hero never draws poll or custom types)', () => {
      const choice = decodeBookingChoice('2.office.n...hours~4......');

      expect(resolveBookingChoice(choice, TYPES, { acceptType: t => t.serviceKey !== 'office' })).toBeNull();
    });

    it('reads the cookie out of a whole Cookie header', () => {
      const header = `a=1; ${BOOKING_CHOICE_COOKIE}=2.office.n...hours~4......; b=2`;

      expect(readBookingChoice(header, TYPES)?.selectedServiceTypeId).toBe('2');
      expect(readBookingChoice('a=1', TYPES)).toBeNull();
    });
  });

  describe('a new tab with no draft of its own', () => {
    it('seeds a key-only draft, and the booking page fills the ids from its catalogue', () => {
      const choice = decodeBookingChoice(encodeBookingChoice(draft))!;
      // The hero resolves only its own fields (no extras or plans in its catalogue).
      const heroPart = resolveBookingChoice(choice, [{ ...residential, extraServices: [] }]);
      const seeded = seedDraftFromChoice(choice, heroPart);

      expect(seeded.selectedServiceTypeId).toBe('1');
      expect(seeded.selectedExtraServices).toEqual([{ extraServiceId: '', extraServiceKey: 'oven', quantity: 1, hours: 1.5 }]);
      expect(encodeBookingChoice(seeded)).toBe(encodeBookingChoice(draft));

      const filled = fillDraftIdsFromKeys(seeded, TYPES, PLANS);
      expect(filled.selectedExtraServices).toEqual([{ extraServiceId: '28', extraServiceKey: 'oven', quantity: 1, hours: 1.5 }]);
      expect(filled.selectedSubscriptionId).toBe('3');
    });

    it('leaves entries that already carry ids exactly as they are', () => {
      expect(fillDraftIdsFromKeys(draft, TYPES, PLANS).selectedExtraServices).toEqual(draft.selectedExtraServices);
    });
  });
});
