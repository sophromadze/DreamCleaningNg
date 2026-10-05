import 'zone.js/node';
import { APP_BASE_HREF } from '@angular/common';
import { renderApplication } from '@angular/platform-server';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { SSR_RESPONSE_CONTEXT, SsrResponseContext } from './app/shared/ssr/ssr-response.token';
import { SSR_CATALOGUE, SsrCatalogue } from './app/shared/ssr/ssr-catalogue.token';
import type { ServiceType } from './app/services/booking.service';
import type { PublicSpecialOffer } from './app/services/special-offer.service';
import { renderLlmsTxt } from './llms-txt';
import { CATALOGUE_TTL_MS, createCatalogueCache, createPublicOffersCache } from './catalogue-cache';
import { ALLOWED_HOSTS, rejectedHeader } from './host-guard';

// Same loopback convention as server-url.interceptor.ts: SSR-side calls to the
// backend go through localhost, never the public domain (Cloudflare loopback trap).
const BACKEND_URL = 'http://localhost:5000';

// How long a render waits for the catalogue when there is no usable copy at all (cold start).
// Same cap the home hero used for its own SSR request; afterwards renders never wait.
const SSR_CATALOGUE_WAIT_MS = 1000;


// The Express app is exported so that it can be used by serverless Functions.
export function app(): express.Express {
  const server = express();
  const serverDistFolder = dirname(fileURLToPath(import.meta.url));
  const browserDistFolder = resolve(serverDistFolder, '../browser');
  const indexHtml = join(browserDistFolder, 'index.html');
  const indexHtmlContent = readFileSync(indexHtml, 'utf-8').toString();

  server.set('view engine', 'html');
  server.set('views', browserDistFolder);

  // Apache (same box, loopback) is the only proxy: req.protocol follows its X-Forwarded-Proto.
  // A forwarded header from anywhere else is ignored.
  server.set('trust proxy', 'loopback');

  // Unknown or malformed Host / X-Forwarded-* -> 400 before any route. See host-guard.ts.
  server.use((req, res, next) => {
    const header = (name: string) => req.headers[name] as string | undefined;
    if (rejectedHeader({
      host: req.headers.host,
      forwardedHost: header('x-forwarded-host'),
      forwardedProto: header('x-forwarded-proto'),
      forwardedPort: header('x-forwarded-port')
    })) {
      res.status(400).type('text/plain').set('Cache-Control', 'no-store').send('Bad Request');
      return;
    }
    next();
  });

  // The public service catalogue, held in memory for the whole process and shared by every
  // render (home hero form, marketing prices, route meta, JSON-LD) and /llms.txt, so an admin
  // price change reaches all of them within CATALOGUE_TTL_MS. See catalogue-cache.ts.
  const catalogue = createCatalogueCache(`${BACKEND_URL}/api/booking/service-types`);
  // The public special offers, held the same way, so the home hero's welcome coupon is in the
  // server render instead of popping in after hydration. Same TTL as the catalogue.
  const publicOffers = createPublicOffersCache(`${BACKEND_URL}/api/special-offers/public`);

  // /llms.txt is generated, not a file: its prices are the same MarketingPrices the pages show.
  // Registered before the *.* static handler and the 404 guard below. Any backend failure
  // (including a 401 from a gated backend) serves the same document without the price lines -
  // never an error, never HTML. Browser/Cloudflare caching matches the catalogue TTL (.txt is
  // on Cloudflare's default cached-extension list, so a longer max-age would outlive it).
  server.get('/llms.txt', async (_req, res) => {
    const { prices } = await catalogue.get(3000);
    res.type('text/plain; charset=utf-8')
       .set('Cache-Control', `public, max-age=${CATALOGUE_TTL_MS / 1000}`)
       .send(renderLlmsTxt(prices));
  });

  // Dynamic blog sitemap — proxied to the backend BEFORE the *.* static handler
  // (there is no such file on disk; the backend generates and caches it).
  // Referenced by the sitemap index at /sitemap.xml.
  server.get('/sitemap-blog.xml', async (req, res) => {
    try {
      const upstream = await fetch(`${BACKEND_URL}/sitemap-blog.xml`);
      if (!upstream.ok) {
        res.status(upstream.status).send('');
        return;
      }
      const xml = await upstream.text();
      res.set('Content-Type', 'application/xml; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(xml);
    } catch {
      res.status(502).send('');
    }
  });

  // Serve static files from /browser
  server.get('*.*', express.static(browserDistFolder, {
    maxAge: '1y',
    // Unhashed, hand-edited files (robots.txt, sitemaps, the web manifest): edits must reach
    // Cloudflare and browsers within the hour. Hashed JS/CSS keep the year. fontawesome.css is
    // the on-demand admin/profile icon bundle (angular.json, `inject: false`), which Angular
    // emits without a content hash, so a Font Awesome upgrade must not sit cached for a year.
    // /fonts/*.woff2 keep the year: their names carry the font version.
    // /images/* (public/images: unhashed, hand-maintained site images) get ONE DAY plus the
    // ETag/Last-Modified express.static already sends (2026-10). Apache used to alias /images to
    // the uploads folder; with that gone, an image edited in place must reach browsers within a
    // day, and a revalidation after that costs a 304. /img/responsive/* names carry a content
    // hash, so they keep the year.
    setHeaders: (res, filePath) => {
      if (/.(txt|xml|webmanifest)$/i.test(filePath) || /[\\/]fontawesome\.css$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      } else if (/^images[\\/]/.test(relative(browserDistFolder, filePath))) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    }
  }));

  // Static-file and /.well-known/* requests that express.static could not satisfy get a real
  // 404 here. Without this they fall through to the Angular render below, which answers 200
  // with the home page - Lighthouse then parses HTML as llms.txt / ai-catalog.json, and a
  // stale chunk URL gets HTML back. Scoped to known file extensions so no page route (none
  // contains a dot) and no token URL can match.
  const STATIC_FILE_EXT = /.(txt|md|xml|json|webmanifest|ico|png|jpe?g|gif|webp|avif|svg|css|js|mjs|map|woff2?|ttf|otf|eot|pdf|mp4|webm)$/i;
  server.get('*', (req, res, next) => {
    if (req.path.startsWith('/.well-known/') || STATIC_FILE_EXT.test(req.path)) {
      res.status(404).type('text/plain').set('Cache-Control', 'public, max-age=300').send('Not Found');
      return;
    }
    next();
  });

  // Real 301s for retired or commonly guessed public URLs, answered before the Angular render.
  // Angular's redirectTo routes for the same paths stay in app.routes.ts as the fallback for
  // in-app navigation, but on a full request they would answer 200 with the target page.
  // Keys are lowercase without a trailing slash (Express matching is case-insensitive and
  // ignores one trailing slash). The query string is carried over unchanged. One hour of
  // caching rather than the browser default (indefinite), so a mistaken entry can be undone.
  const PERMANENT_REDIRECTS: Record<string, string> = {
    '/services': '/service-page',
    '/commercial-cleaning': '/services/commercial-cleaning',
  };
  server.get(Object.keys(PERMANENT_REDIRECTS), (req, res, next) => {
    const target = PERMANENT_REDIRECTS[req.path.toLowerCase().replace(/\/$/, '')];
    if (!target) {
      next();
      return;
    }
    const queryStart = req.originalUrl.indexOf('?');
    const query = queryStart === -1 ? '' : req.originalUrl.slice(queryStart);
    res.set('Cache-Control', 'public, max-age=3600').redirect(301, target + query);
  });

  // All regular routes use Angular Universal
  server.get('*', async (req, res, next) => {
    const { protocol, originalUrl, baseUrl, headers } = req;

    // Fresh per-request context; a component (e.g. blog post with an unknown
    // slug) can set statusCode and the SSR response uses it instead of 200.
    const responseContext: SsrResponseContext = { statusCode: null, requestCookies: headers.cookie ?? null };

    // Normally answered from memory; waits (briefly) only on a cold cache.
    const [snapshot, offers] = await Promise.all([
      catalogue.get(SSR_CATALOGUE_WAIT_MS),
      publicOffers.get(SSR_CATALOGUE_WAIT_MS)
    ]);
    const ssrCatalogue: SsrCatalogue = {
      serviceTypes: snapshot.serviceTypes as ServiceType[] | null,
      prices: snapshot.prices,
      publicOffers: offers as PublicSpecialOffer[] | null
    };

    renderApplication(
      // renderApplication hands the bootstrap a per-request BootstrapContext (its own platform);
      // main.server must receive it, or every render would share one platform.
      (context) => import('./main.server').then(m => m.default(context)),
      {
        document: indexHtmlContent,
        url: `${protocol}://${headers.host}${originalUrl}`,
        // Already enforced by the guard above; renderApplication checks again (and throws).
        allowedHosts: [...ALLOWED_HOSTS],
        platformProviders: [
          { provide: APP_BASE_HREF, useValue: baseUrl },
          { provide: SSR_RESPONSE_CONTEXT, useValue: responseContext },
          { provide: SSR_CATALOGUE, useValue: ssrCatalogue },
        ],
      }
    )
    .then((html: string) => {
      if (responseContext.statusCode) {
        res.status(responseContext.statusCode);
      }
      // A 404 page (unknown route, unknown blog slug) must never be held by Cloudflare or a
      // browser: the URL may become valid minutes later (a newly published post).
      if (responseContext.statusCode === 404) {
        res.set('Cache-Control', 'no-store');
        res.set('X-Robots-Tag', 'noindex');
      } else if (responseContext.renderedFromCookie) {
        // This HTML carries one visitor's saved hero choice (dc_hero_choice) or their signed-in
        // layout (dc_ui: header pill/badge, welcome coupon): a shared cache (Cloudflare, which
        // today does not cache HTML at all) must never store it for anyone else. no-cache rather
        // than no-store keeps the page eligible for the back/forward cache.
        res.set('Cache-Control', 'private, no-cache');
        res.set('Vary', 'Cookie');
      }
      res.send(html);
    })
    .catch((err: Error) => next(err));
  });

  return server;
}

function run(): void {
  const port = process.env['PORT'] || 4000;

  // Start up the Node server
  // Loopback only: Apache on the same box is the one client (ProxyPass http://127.0.0.1:4000/),
  // so nobody can reach Node directly and hand it their own X-Forwarded-* headers.
  const server = app();
  server.listen(Number(port), '127.0.0.1', () => {
    console.log(`Node Express server listening on http://127.0.0.1:${port}`);
  });
}

// Only run the server when this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}

export default app;