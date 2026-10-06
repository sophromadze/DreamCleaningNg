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
import { removeNoscriptStylesheet } from './noscript-stylesheet';
import { isMissingFileRequest, isStaticFileRequest, permanentRedirectLocation, staticCacheControl } from './server-routing';
import { environment } from './environments/environment';

// Same backend as server-url.interceptor.ts (environment.ssrApiOrigin - production:
// http://localhost:5000): SSR-side calls go through localhost, never the public domain
// (Cloudflare loopback trap).
const BACKEND_URL = environment.ssrApiOrigin;

// How long a render waits for the catalogue when there is no usable copy at all (cold start).
// Same cap the home hero used for its own SSR request; afterwards renders never wait.
const SSR_CATALOGUE_WAIT_MS = 1000;


// The Express app is exported so that it can be used by serverless Functions.
export function app(): express.Express {
  const server = express();
  const serverDistFolder = dirname(fileURLToPath(import.meta.url));
  const browserDistFolder = resolve(serverDistFolder, '../browser');
  const indexHtml = join(browserDistFolder, 'index.html');
  const indexHtmlContent = removeNoscriptStylesheet(readFileSync(indexHtml, 'utf-8').toString());

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
  // Registered before the static handler and the 404 guard below. Any backend failure
  // (including a 401 from a gated backend) serves the same document without the price lines -
  // never an error, never HTML. Browser/Cloudflare caching matches the catalogue TTL (.txt is
  // on Cloudflare's default cached-extension list, so a longer max-age would outlive it).
  server.get('/llms.txt', async (_req, res) => {
    const { prices } = await catalogue.get(3000);
    res.type('text/plain; charset=utf-8')
       .set('Cache-Control', `public, max-age=${CATALOGUE_TTL_MS / 1000}`)
       .send(renderLlmsTxt(prices));
  });

  // Dynamic blog sitemap — proxied to the backend BEFORE the static handler
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

  // Every route below is '/{*path}' (Express 5: matches '/' too) and decides from req.path in
  // server-routing.ts. The wildcard also keeps Express 4's 400 for a malformed %-escape.

  // Serve static files from /browser. Cache-Control per file: see staticCacheControl
  // (an hour for unhashed text files and fontawesome.css, a day for /images, else the year).
  const serveBrowserFiles = express.static(browserDistFolder, {
    maxAge: '1y',
    setHeaders: (res, filePath) => {
      const cacheControl = staticCacheControl(relative(browserDistFolder, filePath));
      if (cacheControl) {
        res.setHeader('Cache-Control', cacheControl);
      }
    }
  });
  server.get('/{*path}', (req, res, next) => {
    if (isStaticFileRequest(req.path)) {
      serveBrowserFiles(req, res, next);
      return;
    }
    next();
  });

  // Static-file and /.well-known/* requests that express.static could not satisfy get a real
  // 404 here instead of the Angular render's 200 home page. See isMissingFileRequest.
  server.get('/{*path}', (req, res, next) => {
    if (isMissingFileRequest(req.path)) {
      res.status(404).type('text/plain').set('Cache-Control', 'public, max-age=300').send('Not Found');
      return;
    }
    next();
  });

  // Real 301s for retired or commonly guessed public URLs (PERMANENT_REDIRECTS), answered
  // before the Angular render. One hour of caching rather than the browser default
  // (indefinite), so a mistaken entry can be undone.
  server.get('/{*path}', (req, res, next) => {
    const location = permanentRedirectLocation(req.path, req.originalUrl);
    if (!location) {
      next();
      return;
    }
    res.set('Cache-Control', 'public, max-age=3600').redirect(301, location);
  });

  // All regular routes use Angular Universal
  server.get('/{*path}', async (req, res, next) => {
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
  // Express 5 hands a listen failure (port taken) to this callback instead of throwing it:
  // rethrow, so the process fails loudly (exit 1, EADDRINUSE) instead of logging "listening"
  // and exiting 0 without a socket.
  server.listen(Number(port), '127.0.0.1', (error?: Error) => {
    if (error) {
      throw error;
    }
    console.log(`Node Express server listening on http://127.0.0.1:${port}`);
  });
}

// Only run the server when this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}

export default app;