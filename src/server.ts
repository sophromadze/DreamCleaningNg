import 'zone.js/node';
import { APP_BASE_HREF } from '@angular/common';
import { renderApplication } from '@angular/platform-server';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { SSR_RESPONSE_CONTEXT, SsrResponseContext } from './app/shared/ssr/ssr-response.token';

// Same loopback convention as server-url.interceptor.ts: SSR-side calls to the
// backend go through localhost, never the public domain (Cloudflare loopback trap).
const BACKEND_URL = 'http://localhost:5000';


// The Express app is exported so that it can be used by serverless Functions.
export function app(): express.Express {
  const server = express();
  const serverDistFolder = dirname(fileURLToPath(import.meta.url));
  const browserDistFolder = resolve(serverDistFolder, '../browser');
  const indexHtml = join(browserDistFolder, 'index.html');
  const indexHtmlContent = readFileSync(indexHtml, 'utf-8').toString();

  server.set('view engine', 'html');
  server.set('views', browserDistFolder);

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
    maxAge: '1y'
  }));

  // All regular routes use Angular Universal
  server.get('*', (req, res, next) => {
    const { protocol, originalUrl, baseUrl, headers } = req;

    // Fresh per-request context; a component (e.g. blog post with an unknown
    // slug) can set statusCode and the SSR response uses it instead of 200.
    const responseContext: SsrResponseContext = { statusCode: null };

    renderApplication(
      () => import('./main.server').then(m => m.default()),
      {
        document: indexHtmlContent,
        url: `${protocol}://${headers.host}${originalUrl}`,
        platformProviders: [
          { provide: APP_BASE_HREF, useValue: baseUrl },
          { provide: SSR_RESPONSE_CONTEXT, useValue: responseContext },
        ],
      }
    )
    .then((html: string) => {
      if (responseContext.statusCode) {
        res.status(responseContext.statusCode);
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
  const server = app();
  server.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

// Only run the server when this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}

export default app;