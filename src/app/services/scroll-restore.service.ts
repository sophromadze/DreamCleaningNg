import { inject, Service } from '@angular/core';
import { NavigationEnd, NavigationStart, Router, Scroll } from '@angular/router';

/**
 * Makes Back/Forward land on the remembered scroll position without the visible trip from the top.
 *
 * The router's own restore (`withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })`) had
 * two problems that together showed the top of the page first and then scrolled down by itself:
 * - it calls `window.scrollTo(x, y)`, which follows `html { scroll-behavior: smooth }` from
 *   styles.scss, so the restore was a ~1s animated scroll from 0;
 * - it fires in a setTimeout after NavigationEnd, so the page has already been painted at the top.
 *
 * This service keeps the same bookkeeping as Angular's RouterScroller (positions keyed by the
 * navigation id, saved on NavigationStart, looked up by `restoredState.navigationId`), so a page can
 * ask for the position in {@link pendingRestore} and apply it before its first paint; the router's
 * later restore then targets the spot the page is already at. Every popstate restore is also applied
 * with `behavior: 'instant'` just ahead of the router's smooth one. Forward navigation is untouched -
 * it carries no position, so the router still takes it to the top as before.
 *
 * Started once in the browser from app.config.ts, before the first navigation.
 */
@Service()
export class ScrollRestoreService {
  private readonly router = inject(Router);
  private readonly store: Record<number, [number, number]> = {};
  private lastId = 0;
  private restoredId = 0;
  private popstate = false;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.router.events.subscribe(e => {
      if (e instanceof NavigationStart) {
        this.store[this.lastId] = [window.scrollX, window.scrollY];
        this.popstate = e.navigationTrigger === 'popstate';
        this.restoredId = e.restoredState ? e.restoredState.navigationId : 0;
      } else if (e instanceof NavigationEnd) {
        this.lastId = e.id;
      } else if (e instanceof Scroll && e.position) {
        scrollInstantly(e.position);
      }
    });
  }

  /** The position Back/Forward is restoring for the navigation in progress, or null. */
  pendingRestore(): [number, number] | null {
    return this.popstate ? this.store[this.restoredId] ?? null : null;
  }
}

/** `window.scrollTo` that ignores the page's `scroll-behavior: smooth`. */
export function scrollInstantly([left, top]: [number, number]): void {
  window.scrollTo({ left, top, behavior: 'instant' });
}
