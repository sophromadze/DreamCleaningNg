/**
 * Removes the build's `<noscript>` stylesheet fallback from the index template (2026-10).
 *
 * The critical-CSS step (beasties, `noscriptFallback: true`, not configurable in Angular) loads
 * the full stylesheet as `media="print"` and adds `<noscript><link rel="stylesheet" ...></noscript>`
 * for visitors without JavaScript. Since @angular/platform-server's fix for CVE-2026-50556 /
 * CVE-2026-69149, a `<noscript>` in <head> is serialized as escaped TEXT, so the fallback reached
 * the browser as `&lt;link ...&gt;` and did nothing anyway. It is dropped from the template once,
 * at startup, rather than "un-escaped" after rendering - Angular's escaping stays untouched.
 *
 * Only the exact element beasties writes is removed; any other <noscript> (Google Tag Manager's
 * in <body>) is left alone.
 */
const BEASTIES_NOSCRIPT_STYLESHEET = /<noscript><link rel="stylesheet" href="[^"<>]+\.css"><\/noscript>/g;

export function removeNoscriptStylesheet(indexHtml: string): string {
  return indexHtml.replace(BEASTIES_NOSCRIPT_STYLESHEET, '');
}
