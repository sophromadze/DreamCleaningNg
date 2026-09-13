import { TimeSelectorComponent } from './time-selector.component';
import { buildServiceTimeSlots } from '../../shared/booking/service-time-slots';

/**
 * The hour/minute picker used by the booking page and the customer order-edit page.
 *
 * Everything it offers is derived from the `availableTimeSlots` the host passes in — it used to
 * hard-code "hour 18 has :00 only", which was right for exactly one window and wrong for the two
 * others that exist now: a weekend customer starts at 9:30 (so 9 AM has :30 only) and an admin
 * runs to 8:00 PM (so 6 PM has BOTH halves and 8 PM has :00 only). A picker that offers a
 * half-hour outside the window puts a crew at a door at a time nobody may book.
 */
describe('TimeSelectorComponent', () => {
  const monday = new Date(2026, 8, 14);
  const saturday = new Date(2026, 8, 19);

  function selectorFor(slots: string[], value = slots[0]): TimeSelectorComponent {
    const component = new TimeSelectorComponent();
    component.availableTimeSlots = slots;
    component.value = value;
    component.ngOnInit();
    return component;
  }

  const clickEvent = () => ({ stopPropagation: () => {} }) as unknown as Event;

  it('offers only :00 in the last hour of a customer window', () => {
    const component = selectorFor(buildServiceTimeSlots(monday, false));

    component.selectedHour = 18;
    expect(component.getAvailableMinutes()).toEqual([0]);

    component.selectedHour = 17;
    expect(component.getAvailableMinutes()).toEqual([0, 30]);
  });

  it('offers both halves of 6 PM to an admin, and only :00 at 8 PM', () => {
    const component = selectorFor(buildServiceTimeSlots(monday, true));

    component.selectedHour = 18;
    expect(component.getAvailableMinutes()).toEqual([0, 30]);

    component.selectedHour = 19;
    expect(component.getAvailableMinutes()).toEqual([0, 30]);

    component.selectedHour = 20;
    expect(component.getAvailableMinutes()).toEqual([0]);

    expect(component.hours).toContain(20);
    expect(component.hours).not.toContain(21);
  });

  it('offers only :30 in the first hour of a customer weekend', () => {
    const component = selectorFor(buildServiceTimeSlots(saturday, false), '09:30');

    expect(component.hours[0]).toBe(9);
    component.selectedHour = 9;
    expect(component.getAvailableMinutes()).toEqual([30]);
  });

  it('snaps the minute onto one the newly picked hour actually has', () => {
    // 6:30 PM exists for an admin but not for a customer, so a customer moving 5:30 PM -> 6 PM
    // must land on 6:00, not on a 6:30 the window does not contain.
    const component = selectorFor(buildServiceTimeSlots(monday, false), '17:30');
    const emitted: string[] = [];
    component.valueChange.subscribe(v => emitted.push(v));

    component.selectHour(18, clickEvent());

    expect(component.selectedMinute).toBe(0);
    expect(emitted).toEqual(['18:00']);
  });

  it('keeps a minute the newly picked hour does have', () => {
    const component = selectorFor(buildServiceTimeSlots(monday, true), '17:30');

    component.selectHour(18, clickEvent());

    expect(component.selectedMinute).toBe(30); // 18:30 is a real admin slot
    expect(component.value).toBe('18:30');
  });

  describe('busy hours', () => {
    it('marks an hour busy only when every half-hour it offers is blocked', () => {
      const component = selectorFor(buildServiceTimeSlots(monday, true));
      component.blockedHours = ['10:00', '18:00', '20:00'];

      // 10:00 is blocked but 10:30 is free, so the hour is still selectable.
      expect(component.isHourBlocked(10)).toBe(false);
      // 6 PM has two halves for an admin and only one is blocked.
      expect(component.isHourBlocked(18)).toBe(false);
      // 8 PM offers :00 alone, so blocking it blocks the hour.
      expect(component.isHourBlocked(20)).toBe(true);
    });

    it('treats a customer 6 PM as busy from its single blocked half-hour', () => {
      const component = selectorFor(buildServiceTimeSlots(monday, false));
      component.blockedHours = ['18:00'];

      expect(component.isHourBlocked(18)).toBe(true);
    });
  });
});
