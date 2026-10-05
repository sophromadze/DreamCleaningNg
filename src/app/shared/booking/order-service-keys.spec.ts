import { isBedroomsLine, isCleanersLine, isHoursLine, orderServiceIs } from './order-service-keys';

/** Order lines as OrderServiceDto sends them; keys from GET api/booking/service-types (production). */
const line = (serviceName: string, serviceKey: string | null) => ({ serviceName, serviceKey });

describe('order service keys', () => {
  it('recognises the production lines by key', () => {
    expect(isBedroomsLine(line('Bedrooms', 'bedrooms'))).toBe(true);
    expect(isCleanersLine(line('Cleaners', 'cleaners'))).toBe(true);
    expect(isHoursLine(line('Hours', 'hours'))).toBe(true);
  });

  it('keeps recognising them after a rename', () => {
    expect(isBedroomsLine(line('Rooms to sleep in', 'bedrooms'))).toBe(true);
    expect(isCleanersLine(line('Team Size', 'cleaners'))).toBe(true);
    expect(isHoursLine(line('Time On Site', 'hours'))).toBe(true);
  });

  it('never reads the name of a keyed line', () => {
    expect(isBedroomsLine(line('Bedrooms', 'bathrooms'))).toBe(false);
    expect(isCleanersLine(line('Cleaners', 'sqft'))).toBe(false);
    // "Hours" would have matched "cleaner hours" by name; the key says otherwise.
    expect(isHoursLine(line('Cleaner hours', 'cleaners'))).toBe(false);
  });

  it('falls back to the old name rule for an unkeyed line', () => {
    expect(isBedroomsLine(line('Bedrooms', null))).toBe(true);
    expect(isCleanersLine(line('Cleaners', ''))).toBe(true);
    expect(isHoursLine({ name: 'Hours' })).toBe(true);
  });

  it('reads PascalCase audit snapshots', () => {
    expect(orderServiceIs({ ServiceName: 'Bedrooms' }, 'bedrooms', (_, n) => n === 'Bedrooms')).toBe(true);
    expect(orderServiceIs({ ServiceName: 'Sleeping rooms', ServiceKey: 'bedrooms' }, 'bedrooms', (_, n) => n === 'Bedrooms')).toBe(true);
  });
});
