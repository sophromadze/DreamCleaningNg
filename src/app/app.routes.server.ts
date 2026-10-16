import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Client-side only (auth required, no SEO value)
  { path: 'admin', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },
  { path: 'profile', renderMode: RenderMode.Client },
  { path: 'profile/**', renderMode: RenderMode.Client },
  // The booking page is rendered per request (2026-10): step 1 is drawn on the server from the
  // visitor's booking-choice cookie and, when signed in, their own session (server.ts), and the
  // response is always private. Never Client (it would ship an empty shell) and never Prerender
  // (it would freeze one visitor's form). server.ts renders with renderApplication, which renders
  // every route regardless; these entries state the intent for the route extractor.
  { path: 'booking', renderMode: RenderMode.Server },
  { path: 'booking/**', renderMode: RenderMode.Server },
  // The cleaner portal is behind auth and has no SEO value; prerendering it would only ship an
  // empty shell and fire its API calls during the build pass.
  { path: 'cleaner-portal', renderMode: RenderMode.Client },

  // Contract review/signing pages are per-token and private. Prerendering is impossible (the
  // token is only known at request time) and SSR would render one client's agreement into a
  // cacheable response, so these are client-only.
  { path: 'contract/**', renderMode: RenderMode.Client },

  // The public commercial invoice, for exactly the same reasons — plus one more: this page
  // carries the company's bank details and the client's balance, and neither belongs in anything
  // a cache or a prerender pass could hold onto.
  { path: 'invoice/**', renderMode: RenderMode.Client },
  // The regular customer invoice — same reasons: per-token, with a balance and bank details.
  { path: 'pay-invoice/**', renderMode: RenderMode.Client },
  // The Claude connector's consent page: behind sign-in, per-request OAuth query, no SEO value.
  { path: 'connect/**', renderMode: RenderMode.Client },

  // Blog is dynamic content — per-request SSR, never build-time prerender.
  // (Prerender would only know slugs that existed at build time; every post
  // published afterwards would be invisible until the next build.)
  { path: 'blog', renderMode: RenderMode.Server },
  { path: 'blog/:slug', renderMode: RenderMode.Server },

  // SSR for all other public routes (SEO important)
  { path: '**', renderMode: RenderMode.Prerender }
];
