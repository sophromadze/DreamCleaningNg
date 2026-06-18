import { Pipe, PipeTransform } from '@angular/core';

/**
 * Display helpers for backend UTC timestamps (CreatedAt, OrderDate, SentAt, ...).
 *
 * The API stores audit-style timestamps in UTC but usually serializes them
 * WITHOUT a timezone suffix ("2026-06-13T10:36:00"), so `new Date(...)` would
 * misread them as browser-local time. These helpers parse such values as UTC
 * and format them as New York wall-clock time, so every viewer sees business
 * (NY) time regardless of their own timezone.
 *
 * Do NOT use these for `serviceDate` / `serviceTime` (and other date-only,
 * admin-entered values like task due dates): those are already stored as NY
 * wall-clock values and must be displayed without any conversion.
 */
export const NY_TIME_ZONE = 'America/New_York';

/** True when the string already carries timezone info ("Z" or a ±hh:mm offset). */
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Parses a backend UTC timestamp; offset-less strings are treated as UTC. */
export function parseUtcDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  let str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) str += 'T00:00:00';
  const d = new Date(HAS_OFFSET.test(str) ? str : str + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

/** Formats a UTC timestamp as NY wall-clock time with the given Intl options. */
export function formatNy(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  const d = parseUtcDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: NY_TIME_ZONE, ...options }).format(d);
}

/** "6/13/2026" */
export function formatNyDate(value: string | Date | null | undefined): string {
  return formatNy(value, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/** "Jun 13, 2026" */
export function formatNyMediumDate(value: string | Date | null | undefined): string {
  return formatNy(value, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "Jun 13, 26" (compact admin tables) */
export function formatNyShortDate(value: string | Date | null | undefined): string {
  return formatNy(value, { year: '2-digit', month: 'short', day: 'numeric' });
}

/** "Jun 13, 2026, 6:36 AM" */
export function formatNyDateTime(value: string | Date | null | undefined): string {
  return formatNy(value, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

/**
 * Template pipe for UTC timestamps: {{ value | nyDate }} or {{ value | nyDate:'datetime' }}.
 * Presets: 'date' → "Jun 13, 2026" (default), 'datetime' → "Jun 13, 2026, 6:36 AM".
 */
@Pipe({ name: 'nyDate', standalone: true })
export class NyDatePipe implements PipeTransform {
  transform(value: string | Date | null | undefined, preset: 'date' | 'datetime' = 'date'): string {
    return preset === 'datetime' ? formatNyDateTime(value) : formatNyMediumDate(value);
  }
}
