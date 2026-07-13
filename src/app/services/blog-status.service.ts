import { Injectable } from '@angular/core';
import { Observable, of, catchError, map, shareReplay } from 'rxjs';
import { BlogService } from './blog.service';

/**
 * Shared, replayed blog visibility status. The header and both blog pages consume
 * this, so the whole app makes AT MOST one /api/blog/status call per app instance:
 * - During SSR the call runs server-side and the result rides the HTTP transfer
 *   cache into the browser (provideClientHydration), so hydration re-uses it.
 * - Within the SPA session, shareReplay(1) serves every later subscriber in-memory.
 * - The backend response itself is IMemoryCache'd and version-keyed, so flipping
 *   the admin toggle is reflected for the next page load / new visitor immediately.
 * Errors resolve to hidden (false) — the safe default matches the disabled state.
 */
@Injectable({
  providedIn: 'root'
})
export class BlogStatusService {
  readonly publicVisible$: Observable<boolean>;

  constructor(blogService: BlogService) {
    this.publicVisible$ = blogService.getStatus().pipe(
      map(status => !!status?.publicVisible),
      catchError(() => of(false)),
      shareReplay(1)
    );
  }
}
