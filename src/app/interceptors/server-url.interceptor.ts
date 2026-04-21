import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { of } from 'rxjs';

// API calls that SSR should skip (return empty) - browser will load these
const SSR_SKIP_PATTERNS = [
  '/api/special-offers',
  '/api/admin/',
  '/api/profile/',
  '/api/order',
  '/api/notifications',
  '/api/loyalty',
  '/api/reviews',
];

export const serverUrlInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);

  if (isPlatformServer(platformId)) {
    // Block non-critical calls during SSR
    const shouldSkip = SSR_SKIP_PATTERNS.some((pattern) => req.url.includes(pattern));
    if (shouldSkip) {
      return of(new HttpResponse({ status: 200, body: null }));
    }

    let url = req.url;

    // Absolute URL (http or https)
    if (/https?:\/\/dreamcleaningnearme\.com\/api/.test(url)) {
      url = url.replace(/https?:\/\/dreamcleaningnearme\.com\/api/, 'http://localhost:5000/api');
    }
    // Relative URL
    else if (url.startsWith('/api')) {
      url = `http://localhost:5000${url}`;
    }

    if (url !== req.url) {
      return next(req.clone({ url }));
    }
  }

  return next(req);
};
