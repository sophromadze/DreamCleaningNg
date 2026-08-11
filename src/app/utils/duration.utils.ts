/**
 * Scheduling/display granularity for cleaning durations, in minutes.
 * Single source of truth for the frontend — mirrored on the backend by
 * OrderPricingCalculator.DurationRoundingMinutes.
 */
export const DURATION_ROUNDING_MINUTES = 30;

export class DurationUtils {
  /**
   * Rounds duration to the nearest scheduling increment (30 minutes) for display purposes
   * @param totalMinutes The actual duration in minutes
   * @returns Rounded duration in minutes
   */
  static roundToNearestIncrement(totalMinutes: number): number {
    return Math.round(totalMinutes / DURATION_ROUNDING_MINUTES) * DURATION_ROUNDING_MINUTES;
  }

  /**
   * Formats duration for display with rounding
   * @param totalMinutes The actual duration in minutes
   * @returns Formatted string like "2h 30m" or "30m"
   */
  static formatDurationRounded(totalMinutes: number): string {
    return this.formatMinutes(this.roundToNearestIncrement(totalMinutes));
  }

  /**
   * Formats a minute count AS-IS, with no rounding. Use this for values that were already
   * snapped to an increment by someone else — notably the per-cleaner share from
   * calculatePerCleanerBillableMinutes, which rounds DOWN. Re-rounding it to the nearest
   * increment here would put the label back out of step with the salary it explains.
   * @param totalMinutes Minutes to format
   * @returns Formatted string like "2h 30m" or "30m"
   */
  static formatMinutes(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);

    if (hours === 0) {
      return `${mins}m`;
    } else if (mins === 0) {
      return `${hours}h`;
    } else {
      return `${hours}h ${mins}m`;
    }
  }
}
