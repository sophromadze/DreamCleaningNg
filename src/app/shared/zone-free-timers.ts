import { NgZone } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

/**
 * Repeating timers that do not keep Angular's zone busy (2026-10).
 *
 * A setInterval/RxJS interval started inside the zone is a pending task forever, so
 * ApplicationRef.isStable never turns true: hydration cannot finish (NG0506 in dev mode after
 * 10s) and anything waiting for a stable app waits indefinitely. The header clock, the home
 * sliders, the admin reminder checks and the token refresh all did that.
 *
 * These helpers create the timer OUTSIDE the zone and run every tick back INSIDE it, so each tick
 * still triggers change detection exactly as before - only the idle wait between ticks no longer
 * counts as pending work. Clear them the usual way (clearInterval / unsubscribe).
 */
export function setIntervalOutsideZone(zone: NgZone, tick: () => void, ms: number): ReturnType<typeof setInterval> {
  return zone.runOutsideAngular(() => setInterval(() => zone.run(tick), ms));
}

/** setTimeout counterpart, for a delay long enough to hold up hydration (retries, cooldowns). */
export function setTimeoutOutsideZone(zone: NgZone, run: () => void, ms: number): ReturnType<typeof setTimeout> {
  return zone.runOutsideAngular(() => setTimeout(() => zone.run(run), ms));
}

/** Subscribes to a timer-driven observable (interval, timer) outside the zone; `next` runs inside. */
export function subscribeOutsideZone<T>(zone: NgZone, source: Observable<T>, next: (value: T) => void): Subscription {
  return zone.runOutsideAngular(() => source.subscribe(value => zone.run(() => next(value))));
}
