import { DOCUMENT, PLATFORM_ID, Service, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, finalize, of, shareReplay, tap } from 'rxjs';
import { BlockedTimeSlot, BookingService, ServiceType, Subscription } from './booking.service';

interface StoredPart<T> { value: T; at: number; }
type Parts = {
  serviceTypes: ServiceType[];
  subscriptions: Subscription[];
  blockedTimeSlots: BlockedTimeSlot[];
};
export type BookingCataloguePart = keyof Parts;

/**
 * How long a copy fetched in this tab counts as FRESH server data. Within it /booking draws from
 * the copy and asks for nothing; past it the copy is still drawn at once (instead of empty
 * placeholders) but the page fetches again, the fresh answer wins, and Book Now waits for it.
 */
export const BOOKING_COPY_FRESH_MS = 10_000;

/**
 * The booking page's public data, held for this browser tab (2026-10): the catalogue, the plans
 * and the blocked time slots. Filled from the server render (TransferState), from the booking
 * page's own requests, and by prefetch() - which runs when a visitor starts using the home hero
 * form or points at / focuses a link to /booking - so an in-app navigation to /booking can draw
 * step 1 at once.
 *
 * Browser memory only, never storage: a reload gets the data from the server render instead.
 * On the server this service exists per request and is never used.
 */
@Service()
export class BookingCatalogueStore {
  private readonly bookingService = inject(BookingService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly document = inject(DOCUMENT);
  private readonly parts: { [K in BookingCataloguePart]?: StoredPart<Parts[K]> } = {};
  private readonly pending: { [K in BookingCataloguePart]?: Observable<Parts[K]> } = {};
  private watching = false;

  /** The stored copy, whatever its age, or null. */
  peek<K extends BookingCataloguePart>(part: K): Parts[K] | null {
    return (this.parts[part]?.value as Parts[K] | undefined) ?? null;
  }

  /** True when the stored copy was fetched less than BOOKING_COPY_FRESH_MS ago. */
  isFresh(part: BookingCataloguePart): boolean {
    const stored = this.parts[part];
    return !!stored && Date.now() - stored.at < BOOKING_COPY_FRESH_MS;
  }

  /** Records data that just came from the server (render or request). */
  remember<K extends BookingCataloguePart>(part: K, value: Parts[K]): void {
    if (!this.isBrowser) return;
    (this.parts as Record<string, StoredPart<unknown>>)[part] = { value, at: Date.now() };
  }

  /**
   * Fresh server data: the stored copy while it is fresh, else the request already on the wire,
   * else a new one. Never two requests for the same part at once.
   */
  load<K extends BookingCataloguePart>(part: K): Observable<Parts[K]> {
    if (this.isFresh(part)) return of(this.peek(part)!);
    const inFlight = this.pending[part] as Observable<Parts[K]> | undefined;
    if (inFlight) return inFlight;
    const request = (part === 'serviceTypes'
      ? this.bookingService.getServiceTypes()
      : part === 'subscriptions'
        ? this.bookingService.getSubscriptions()
        : this.bookingService.getBlockedTimeSlots()) as unknown as Observable<Parts[K]>;
    const shared = request.pipe(
      tap(value => this.remember(part, value)),
      finalize(() => { delete this.pending[part]; }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    (this.pending as Record<string, Observable<unknown>>)[part] = shared;
    return shared;
  }

  /** Browser only: fetches whatever is not fresh, and the booking page's code, in the background. */
  prefetch(): void {
    if (!this.isBrowser) return;
    for (const part of ['serviceTypes', 'subscriptions', 'blockedTimeSlots'] as const) {
      if (!this.isFresh(part) && !this.pending[part]) this.load(part).subscribe({ error: () => {} });
    }
    void import('../booking/booking.component').catch(() => {});
  }

  /**
   * Browser only, once: prefetch when a pointer moves onto, or focus lands on, a link to /booking
   * (a touch start counts too - phones have no hover). One listener on the document; cheap enough
   * to ignore every other element.
   */
  watchBookLinks(): void {
    if (!this.isBrowser || this.watching) return;
    this.watching = true;
    const onIntent = (event: Event) => {
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      let path: string;
      try { path = new URL(link.href, this.document.baseURI).pathname; } catch { return; }
      if (path === '/booking') this.prefetch();
    };
    this.document.addEventListener('pointerover', onIntent, { passive: true });
    this.document.addEventListener('focusin', onIntent, { passive: true });
    this.document.addEventListener('touchstart', onIntent, { passive: true });
  }
}
