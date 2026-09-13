import {
  ADMIN_LATEST_START_TIME,
  CUSTOMER_LATEST_START_TIME,
  buildServiceTimeSlots,
  getAllServiceTimeSlots,
  getEarliestStartTimeForDate,
  getLatestStartTime
} from './service-time-slots';

/**
 * The booking window, which is not one window but two.
 *
 * A customer books 8:00 AM - 6:00 PM, and no earlier than 9:30 AM at the weekend. An
 * Admin/SuperAdmin books 8:00 AM - 8:00 PM on every day, weekend included, because they enter
 * jobs agreed by phone that the self-service window cannot express.
 *
 * The backend half of this pair is `ServiceTimeSlotsTests` and asserts the same boundaries on
 * purpose — a window that differs between the picker and the API is a crew sent at an hour
 * nobody agreed to.
 */
describe('service time slots', () => {
  // 2026-09-14 is a Monday; 2026-09-19 a Saturday; 2026-09-20 a Sunday. Constructed with the
  // (y, m, d) overload so they stay local dates — a parsed "2026-09-19" is UTC midnight and
  // reads as Friday west of Greenwich, which would silently move the weekend rule.
  const monday = new Date(2026, 8, 14);
  const saturday = new Date(2026, 8, 19);
  const sunday = new Date(2026, 8, 20);

  describe('a customer', () => {
    it('books a weekday from 8:00 AM to 6:00 PM', () => {
      const slots = buildServiceTimeSlots(monday, false);

      expect(slots[0]).toBe('08:00');
      expect(slots[slots.length - 1]).toBe('18:00');
      expect(slots).not.toContain('18:30');
      expect(slots.length).toBe(21); // half-hour steps, 8:00 through 18:00 inclusive
    });

    it('cannot start before 9:30 AM on Saturday or Sunday', () => {
      for (const weekend of [saturday, sunday]) {
        const slots = buildServiceTimeSlots(weekend, false);
        expect(slots[0]).toBe('09:30');
        expect(slots).not.toContain('09:00');
        expect(slots).not.toContain('08:00');
        expect(slots[slots.length - 1]).toBe('18:00');
      }
    });

    it('stops at 6:00 PM', () => {
      expect(getLatestStartTime(false)).toBe(CUSTOMER_LATEST_START_TIME);
      expect(CUSTOMER_LATEST_START_TIME).toBe('18:00');
    });
  });

  describe('an admin', () => {
    it('books the evening through 8:00 PM', () => {
      const slots = buildServiceTimeSlots(monday, true);

      expect(slots[0]).toBe('08:00');
      // The four half-hours a customer never sees.
      expect(slots).toContain('18:30');
      expect(slots).toContain('19:00');
      expect(slots).toContain('19:30');
      expect(slots[slots.length - 1]).toBe('20:00');
      // 8:00 PM is a START time, not a half hour before closing — nothing follows it.
      expect(slots).not.toContain('20:30');
      expect(getLatestStartTime(true)).toBe(ADMIN_LATEST_START_TIME);
    });

    it('is not held to the weekend 9:30 floor', () => {
      // That floor is a customer rule. An admin taking a Saturday morning job by phone must be
      // able to enter the 8:00 AM the customer agreed to.
      for (const weekend of [saturday, sunday]) {
        expect(getEarliestStartTimeForDate(weekend, true)).toBe('08:00');
        expect(buildServiceTimeSlots(weekend, true)[0]).toBe('08:00');
      }
    });
  });

  describe('getAllServiceTimeSlots', () => {
    it('ignores the day of the week but not the audience', () => {
      // Used where a whole day has to be enumerated (marking a fully blocked date busy).
      expect(getAllServiceTimeSlots(false)[0]).toBe('08:00');
      expect(getAllServiceTimeSlots(false).slice(-1)[0]).toBe('18:00');
      expect(getAllServiceTimeSlots(true).slice(-1)[0]).toBe('20:00');
    });

    it('puts every slot on a half hour', () => {
      for (const slot of getAllServiceTimeSlots(true)) {
        expect(slot).toMatch(/^\d{2}:(00|30)$/);
      }
    });
  });

  it('sorts as plain strings, which every caller relies on', () => {
    // The pickers compare slots with >= and sort() rather than parsing them.
    const slots = getAllServiceTimeSlots(true);
    expect([...slots].sort()).toEqual(slots);
  });
});
