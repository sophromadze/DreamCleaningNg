import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformServer } from '@angular/common';

export const serverUrlInterceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);

  if (isPlatformServer(platformId)) {
    const rewrittenUrl = req.url.replace(
      'https://dreamcleaningnearme.com/api',
      'http://localhost:5000/api'
    );

    if (rewrittenUrl !== req.url) {
      return next(req.clone({ url: rewrittenUrl }));
    }
  }

  return next(req);
};
