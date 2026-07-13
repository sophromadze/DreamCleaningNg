import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Client-side only (auth required, no SEO value)
  { path: 'admin', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },
  { path: 'profile', renderMode: RenderMode.Client },
  { path: 'profile/**', renderMode: RenderMode.Client },
  { path: 'booking', renderMode: RenderMode.Client },
  { path: 'booking/**', renderMode: RenderMode.Client },

  // Blog is dynamic content — per-request SSR, never build-time prerender.
  // (Prerender would only know slugs that existed at build time; every post
  // published afterwards would be invisible until the next build.)
  { path: 'blog', renderMode: RenderMode.Server },
  { path: 'blog/:slug', renderMode: RenderMode.Server },

  // SSR for all other public routes (SEO important)
  { path: '**', renderMode: RenderMode.Prerender }
];
