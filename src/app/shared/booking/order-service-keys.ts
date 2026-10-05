/**
 * Recognising an ORDER's service line (Bedrooms, Cleaners, Hours) by Service.serviceKey, which every
 * order line carries (OrderServiceDto.ServiceKey). Same rule as extra-service-keys.ts: a keyed line
 * is judged by its key only; a line with NO key (an unkeyed catalogue row, or an older payload)
 * falls back to the name rule its call site always used. Audit snapshots spell the fields in
 * PascalCase, so both spellings are read.
 */

export const ORDER_SERVICE_KEYS = {
  bedrooms: 'bedrooms',
  cleaners: 'cleaners',
  hours: 'hours'
} as const;

export interface KeyedOrderService {
  serviceKey?: string | null;
  serviceName?: string | null;
  name?: string | null;
  ServiceKey?: string | null;
  ServiceName?: string | null;
}

/** The line's key, trimmed; '' when it has none. */
export function orderServiceKeyOf(line: KeyedOrderService | null | undefined): string {
  return (line?.serviceKey ?? line?.ServiceKey ?? '').trim();
}

/**
 * Key first: a keyed line is `key` exactly when its key is. An unkeyed one is judged by
 * `legacyNameMatch`, given its name lowercased (and as stored).
 */
export function orderServiceIs(
  line: KeyedOrderService | null | undefined,
  key: string,
  legacyNameMatch: (lowerName: string, name: string) => boolean
): boolean {
  if (!line) return false;
  const own = orderServiceKeyOf(line);
  if (own) return own === key;
  const name = line.serviceName ?? line.ServiceName ?? line.name ?? '';
  return legacyNameMatch(name.toLowerCase(), name);
}

/** Bedrooms: key "bedrooms"; unkeyed, "bedroom" in the name. */
export function isBedroomsLine(line: KeyedOrderService | null | undefined): boolean {
  return orderServiceIs(line, ORDER_SERVICE_KEYS.bedrooms, n => n.includes('bedroom'));
}

/** Cleaners: key "cleaners"; unkeyed, "cleaner" in the name. */
export function isCleanersLine(line: KeyedOrderService | null | undefined): boolean {
  return orderServiceIs(line, ORDER_SERVICE_KEYS.cleaners, n => n.includes('cleaner'));
}

/** Hours: key "hours"; unkeyed, "hour" in the name. */
export function isHoursLine(line: KeyedOrderService | null | undefined): boolean {
  return orderServiceIs(line, ORDER_SERVICE_KEYS.hours, n => n.includes('hour'));
}
