import { isDevMode } from '@angular/core';

/**
 * Debug builds only (2026-10): lets a verification run stop the app's repeating UI timers.
 *
 * The header clock ticks every second and the home sliders, chat polls and admin reminder checks
 * every few seconds. Each tick refreshes the page, which hides a binding that changed without
 * telling Angular - exactly what the exhaustive checkNoChanges pass is there to catch. With
 * `localStorage.dc_debug_pause_timers = '1'` those timers simply do not start.
 *
 * isDevMode() is false in every optimized build, so production never reads the flag.
 */
export function debugTimersPaused(): boolean {
  if (!isDevMode()) return false;
  try {
    return globalThis.localStorage?.getItem('dc_debug_pause_timers') === '1';
  } catch {
    return false;
  }
}
