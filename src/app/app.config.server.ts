import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { provideServerRouting } from '@angular/ssr';
import { HTTP_TRANSFER_CACHE_ORIGIN_MAP, provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { serverUrlInterceptor } from './interceptors/server-url.interceptor';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    provideServerRouting(serverRoutes),
    provideHttpClient(withFetch(), withInterceptors([serverUrlInterceptor])),
    // serverUrlInterceptor sends API calls to the local backend, so responses reach the HTTP
    // transfer cache under http://localhost:5000 while the browser asks for the public origin.
    // Without this map every cached response is shipped in the HTML and then fetched again.
    { provide: HTTP_TRANSFER_CACHE_ORIGIN_MAP, useValue: { 'http://localhost:5000': 'https://dreamcleaningnyc.com' } }
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
