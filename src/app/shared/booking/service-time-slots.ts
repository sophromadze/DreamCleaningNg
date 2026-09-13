/**
 * Service start times — the single source of truth for "which hours may this person book?".
 *
 * There are two audiences and they are NOT the same window:
 *
 * - **Customers** start between 8:00 AM and 6:00 PM, and on Saturday/Sunday no earlier than
 *   9:30 AM. That is what the public booking page has always offered.
 * - **Admins / SuperAdmins** (never Moderators) run to **8:00 PM** and are not held to the
 *   weekend 9:30 floor — they take jobs by phone that the self-service window can't express,
 *   and an evening cleaning the office has already agreed to must be enterable.
 *
 * Both the booking page and the customer order-edit page build their pickers from here, so the
 * two cannot drift; the backend's `booking/available-times` mirrors the same rule. Never write a
 * literal slot list at a call site — an extra half hour added in one place and not the other is
 * a crew arriving when nobody is home.
 */

/** Earliest start on a weekday, and the floor admins get on every day. */
export const EARLIEST_START_TIME = '08:00';

/** Earliest start a customer gets on Saturday or Sunday. */
export const WEEKEND_EARLIEST_START_TIME = '09:30';

/** Latest start a customer may pick, any day. */
export const CUSTOMER_LATEST_START_TIME = '18:00';

/** Latest start an Admin/SuperAdmin may pick, any day. */
export const ADMIN_LATEST_START_TIME = '20:00';

const SLOT_INTERVAL_MINUTES = 30;

function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function toTimeString(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

/** The last start time this audience may pick. */
export function getLatestStartTime(isAdmin: boolean): string {
  return isAdmin ? ADMIN_LATEST_START_TIME : CUSTOMER_LATEST_START_TIME;
}

/**
 * The first start time available on `date`. The weekend 9:30 floor is a customer rule only —
 * an admin booking a Saturday morning job gets 8:00 like any other day.
 */
export function getEarliestStartTimeForDate(date: Date, isAdmin: boolean): string {
  if (isAdmin) return EARLIEST_START_TIME;
  // JS getDay(): 0 = Sunday, 6 = Saturday
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6 ? WEEKEND_EARLIEST_START_TIME : EARLIEST_START_TIME;
}

/**
 * Every 30-minute slot this audience may pick, ignoring the day of the week. Used where a whole
 * day has to be enumerated (e.g. marking a fully blocked date as busy), not for the picker.
 */
export function getAllServiceTimeSlots(isAdmin: boolean): string[] {
  const slots: string[] = [];
  const last = toMinutes(getLatestStartTime(isAdmin));
  for (let minutes = toMinutes(EARLIEST_START_TIME); minutes <= last; minutes += SLOT_INTERVAL_MINUTES) {
    slots.push(toTimeString(minutes));
  }
  return slots;
}

/** The slots offered for a specific date: the audience's window, narrowed by the weekend floor. */
export function buildServiceTimeSlots(date: Date | null, isAdmin: boolean): string[] {
  const earliest = date ? getEarliestStartTimeForDate(date, isAdmin) : EARLIEST_START_TIME;
  return getAllServiceTimeSlots(isAdmin).filter(slot => slot >= earliest);
}
