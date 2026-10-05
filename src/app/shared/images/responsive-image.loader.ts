import { IMAGE_LOADER, ImageLoaderConfig } from '@angular/common';
import { Provider } from '@angular/core';
import { RESPONSIVE_IMAGES, ResponsiveImageVariant } from './responsive-images.manifest';

/**
 * Resolves an original image URL (`/images/foo.webp`) to one of its pre-generated WebP width
 * variants (`/img/responsive/foo-800.<hash>.webp`). The variants and their content-hashed names
 * come from the manifest written by `npm run images:responsive`; nothing here guesses a URL.
 *
 * - With a width (one `srcset` candidate): the smallest variant at least that wide, else the
 *   largest one - the browser never gets a narrower file than the candidate it asked for.
 * - Without a width (the fallback `src`, and the preload `href`): the largest variant up to
 *   FALLBACK_MAX_WIDTH. Only clients that ignore srcset ever download it.
 * - A URL with no generated variants is returned untouched.
 */
const FALLBACK_MAX_WIDTH = 1200;

export function responsiveImageLoader(config: ImageLoaderConfig): string {
  const variants = RESPONSIVE_IMAGES[config.src];
  if (!variants?.length) return config.src;
  if (!config.width) return fallbackVariant(variants).url;
  return (variants.find(v => v.width >= config.width!) ?? variants[variants.length - 1]).url;
}

/** `ngSrcset` value for NgOptimizedImage: the generated widths, e.g. "480w, 800w, 1200w". */
export function responsiveWidths(src: string): string {
  return (RESPONSIVE_IMAGES[src] ?? []).map(v => `${v.width}w`).join(', ');
}

/** A complete `srcset` for a plain <img> (one that can't use NgOptimizedImage). */
export function responsiveSrcset(src: string): string {
  return (RESPONSIVE_IMAGES[src] ?? []).map(v => `${v.url} ${v.width}w`).join(', ');
}

/** Fallback `src` for a plain <img>, resolved the same way the loader resolves it. */
export function responsiveSrc(src: string): string {
  return responsiveImageLoader({ src });
}

/** Everything a plain lazy <img> needs: bind srcset and sizes before src. */
export interface ResponsiveImage {
  readonly src: string;
  readonly srcset: string;
  readonly sizes: string;
}

/**
 * `sizes` must describe the width the image is DRAWN at, which under object-fit: cover can be
 * wider than its box - measure it per breakpoint and leave the numbers in a comment beside it.
 */
export function responsiveImage(src: string, sizes: string): ResponsiveImage {
  return { src: responsiveSrc(src), srcset: responsiveSrcset(src), sizes };
}

function fallbackVariant(variants: readonly ResponsiveImageVariant[]): ResponsiveImageVariant {
  return [...variants].reverse().find(v => v.width <= FALLBACK_MAX_WIDTH) ?? variants[0];
}

/**
 * Component-level provider. Scoped to the components that render manifest images rather than
 * registered app-wide, so any other NgOptimizedImage keeps Angular's default loader.
 */
export const RESPONSIVE_IMAGE_LOADER_PROVIDER: Provider = {
  provide: IMAGE_LOADER,
  useValue: responsiveImageLoader
};
