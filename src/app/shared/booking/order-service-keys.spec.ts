import { isBedroomsLine, isCleanersLine, isHoursLine, orderServiceIs } from './order-service-keys';

/** Order lines as OrderServiceDto sends them; keys from GET api/booking/service-types (production). */
const line = (serviceName: string, serviceKey: string | null) => ({ serviceName, serviceKey });

describe('order service keys', () => {
  it('recognises the production lines by key', () => {
    expect(isBedroomsLine(line('Bedrooms', 'bedrooms'))).toBeTrue();
    expect(isCleanersLine(line('Cleaners', 'cleaners'))).toBeTrue();
    expect(isHoursLine(line('Hours', 'hours'))).toBeTrue();
  });

  it('keeps recognising them after a rename', () => {
    expect(isBedroomsLine(line('Rooms to sleep in', 'bedrooms'))).toBeTrue();
    expect(isCleanersLine(line('Team Size', 'cleaners'))).toBeTrue();
    expect(isHoursLine(line('Time On Site', 'hours'))).toBeTrue();
  });

  it('never reads the name of a keyed line', () => {
    expect(isBedroomsLine(line('Bedrooms', 'bathrooms'))).toBeFalse();
    expect(isCleanersLine(line('Cleaners', 'sqft'))).toBeFalse();
    // "Hours" would have matched "cleaner hours" by name; the key says otherwise.
    expect(isHoursLine(line('Cleaner hours', 'cleaners'))).toBeFalse();
  });

  it('falls back to the old name rule for an unkeyed line', () => {
    expect(isBedroomsLine(line('Bedrooms', null))).toBeTrue();
    expect(isCleanersLine(line('Cleaners', ''))).toBeTrue();
    expect(isHoursLine({ name: 'Hours' })).toBeTrue();
  });

  it('reads PascalCase audit snapshots', () => {
    expect(orderServiceIs({ ServiceName: 'Bedrooms' }, 'bedrooms', (_, n) => n === 'Bedrooms')).toBeTrue();
    expect(orderServiceIs({ ServiceName: 'Sleeping rooms', ServiceKey: 'bedrooms' }, 'bedrooms', (_, n) => n === 'Bedrooms')).toBeTrue();
  });
});
