import 'zone.js/node';
import { APP_BASE_HREF } from '@angular/common';
import { renderApplication } from '@angular/platform-server';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';


// The Express app is exported so that it can be used by serverless Functions.
export function app(): express.Express {
  const server = express();
  const serverDistFolder = dirname(fileURLToPath(import.meta.url));
  const browserDistFolder = resolve(serverDistFolder, '../browser');
  const indexHtml = join(browserDistFolder, 'index.html');
  const indexHtmlContent = readFileSync(indexHtml, 'utf-8').toString();

  server.set('view engine', 'html');
  server.set('views', browserDistFolder);

  // Serve static files from /browser
  server.get('*.*', express.static(browserDistFolder, {
    maxAge: '1y'
  }));

  // All regular routes use Angular Universal
  server.get('*', (req, res, next) => {
    const { protocol, originalUrl, baseUrl, headers } = req;

    renderApplication(
      () => import('./main.server').then(m => m.default()),
      {
        document: indexHtmlContent,
        url: `${protocol}://${headers.host}${originalUrl}`,
        platformProviders: [
          { provide: APP_BASE_HREF, useValue: baseUrl },
        ],
      }
    )
    .then((html: string) => res.send(html))
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