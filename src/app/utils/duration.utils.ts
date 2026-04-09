export class DurationUtils {
  /**
   * Rounds duration to nearest 15 minutes for display purposes
   * @param totalMinutes The actual duration in minutes
   * @returns Rounded duration in minutes
   */
  static roundToNearestQuarterHour(totalMinutes: number): number {
    // Round to nearest 15 minutes
    return Math.round(totalMinutes / 15) * 15;
  }

  /**
   * Formats duration for display with rounding
   * @param totalMinutes The actual duration in minutes
   * @returns Formatted string like "2h 15m" or "45m"
   */
  static formatDurationRounded(totalMinutes: number): string {
    const roundedMinutes = this.roundToNearestQuarterHour(totalMinutes);
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
