import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Client-side only (auth required, no SEO value)
  { path: 'admin', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },
  { path: 'profile', renderMode: RenderMode.Client },
  { path: 'profile/**', renderMode: RenderMode.Client },
  { path: 'booking', renderMode: RenderMode.Client },
  { path: 'booking/**', renderMode: RenderMode.Client },

  // SSR for all other public routes (SEO important)
  { path: '**', renderMode: RenderMode.Prerender }
];
