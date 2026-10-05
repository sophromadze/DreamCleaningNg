
import { inject, DOCUMENT } from '@angular/core';
import { CanActivateFn } from '@angular/router';

const LINK_ID = 'font-awesome-css';

/**
 * Font Awesome is no longer part of the global stylesheet. Public pages draw their icons as
 * inline SVG (shared/icons/icon.component.ts); only the staff and account areas — admin, CRM,
 * cleaner portal, cleaners dashboard and the customer profile — still use `<i class="fas …">`.
 *
 * angular.json builds the full Font Awesome CSS as a separate, non-injected bundle
 * (`fontawesome.css`), and this guard adds it to <head> the first time one of those routes
 * activates. It never blocks navigation, and once added the stylesheet stays for the rest of the
 * session. Put it on any route whose components render Font Awesome classes.
 */
export const fontAwesomeGuard: CanActivateFn = () => {
  const document = inject(DOCUMENT);
  if (!document.getElementById(LINK_ID)) {
    const link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    link.href = '/fontawesome.css';
    document.head.appendChild(link);
  }
  return true;
};
