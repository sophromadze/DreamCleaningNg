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
    const roundedMinutes = this.roundToNearestIncrement(totalMinutes);
    const hours = Math.floor(roundedMinutes / 60);
    const mins = roundedMinutes % 60;

    if (hours === 0) {
      return `${mins}m`;
    } else if (mins === 0) {
      return `${hours}h`;
    } else {
      return `${hours}h ${mins}m`;
    }
  }
}
