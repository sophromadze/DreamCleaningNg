import { composeTime24h, formatTime12h, parseTime12h } from './extra-service-display.utils';

/**
 * The admin order editor edits the service time as hour / minute / AM-PM, but storage stays
 * 24-hour "HH:mm". These two functions are that seam - a round trip that loses an hour puts a
 * cleaning crew at a customer's door twelve hours out.
 */
describe('12-hour service time parsing', () => {
  it('reads an afternoon time as PM', () => {
    expect(parseTime12h('14:30')).toEqual({ hour12: 2, minute: 30, meridiem: 'PM' });
  });

  it('reads midnight as 12 AM and noon as 12 PM', () => {
    // The two hours a `% 12` gets wrong if it is not guarded.
    expect(parseTime12h('00:15')).toEqual({ hour12: 12, minute: 15, meridiem: 'AM' });
    expect(parseTime12h('12:00')).toEqual({ hour12: 12, minute: 0, meridiem: 'PM' });
  });

  it('accepts the seconds a stored TimeSpan carries', () => {
    expect(parseTime12h('09:00:00')).toEqual({ hour12: 9, minute: 0, meridiem: 'AM' });
  });

  it('returns null rather than a wrong time for anything unusable', () => {
    expect(parseTime12h(null)).toBeNull();
    expect(parseTime12h('')).toBeNull();
    expect(parseTime12h('not a time')).toBeNull();
    expect(parseTime12h('26:00')).toBeNull();
  });

  it('composes back to the 24-hour string the API stores', () => {
    expect(composeTime24h(12, 0, 'AM')).toBe('00:00');
    expect(composeTime24h(12, 0, 'PM')).toBe('12:00');
    expect(composeTime24h(6, 30, 'PM')).toBe('18:30');
    expect(composeTime24h(8, 5, 'AM')).toBe('08:05');
  });

  it('round-trips every half hour of the day', () => {
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 30]) {
        const stored = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const parts = parseTime12h(stored)!;
        expect(composeTime24h(parts.hour12, parts.minute, parts.meridiem)).toBe(stored);
      }
    }
  });

  it('agrees with the display formatter every other surface uses', () => {
    const parts = parseTime12h('16:45')!;
    expect(`${parts.hour12}:${String(parts.minute).padStart(2, '0')} ${parts.meridiem}`)
      .toBe(formatTime12h('16:45'));
  });
});
