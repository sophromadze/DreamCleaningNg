import { InjectionToken } from '@angular/core';

/**
 * Per-request SSR response context. server.ts provides a fresh instance for every
 * render via platformProviders and reads statusCode back after the render completes,
 * so a component can turn the SSR response into a real HTTP 404 (e.g. unknown blog
 * slug). In the browser the token is simply absent — always inject with
 * { optional: true } and null-check.
 */
export interface SsrResponseContext {
  statusCode: number | null;
}

export const SSR_RESPONSE_CONTEXT = new InjectionToken<SsrResponseContext>('SSR_RESPONSE_CONTEXT');
