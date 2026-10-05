import { Directive, HostAttributeToken, computed, inject, input } from '@angular/core';
import { responsiveSrcset } from './responsive-image.loader';
import { RESPONSIVE_IMAGE_RATIOS } from './responsive-images.manifest';

/**
 * One breakpoint range of a card layout: the photo's BOX there. Its width is `vw * viewport + px`
 * (vw = 0 for a fixed width); its height is either fixed (`height`) or follows the width
 * (`ratio` = box width / box height, an aspect-ratio box).
 */
interface CardBox {
  /** Last viewport width (CSS px) this range covers; the final range has none. */
  readonly maxWidth?: number;
  readonly vw: number;
  readonly px: number;
  readonly height?: number;
  readonly ratio?: number;
}

/**
 * Photo boxes per card layout, measured at 320-1920px viewports. Widths are rounded so the formula
 * is never narrower than the real box; where a page's own CSS gives the same layout different
 * heights, the tallest is used. Re-measure if a grid, a card padding or a photo height changes.
 */
const CARD_LAYOUTS = {
  /** Home "What we offer" grid: 16:10 photo boxes; 1 column <= 520px, 2 <= 820px, 3 <= 1100px, then 4. */
  offerCard: [
    { maxWidth: 520, vw: 1, px: -34, ratio: 1.6 },
    { maxWidth: 820, vw: 0.5, px: -21, ratio: 1.6 },
    { maxWidth: 1100, vw: 1 / 3, px: -28, ratio: 1.6 },
    { maxWidth: 1279, vw: 0.25, px: -26, ratio: 1.6 },
    { vw: 0, px: 293, ratio: 1.6 }
  ],
  /** /service-page grid: fixed 250x150 boxes at every width. */
  servicePageCard: [
    { vw: 0, px: 250, height: 150 }
  ],
  /** Brooklyn / Manhattan / Queens grids: 200px tall; 1 column <= 520px, 2 <= 820px, then 3, 4 and 5. */
  boroughCard: [
    { maxWidth: 520, vw: 1, px: -40, height: 200 },
    { maxWidth: 820, vw: 0.5, px: -30, height: 200 },
    { maxWidth: 1099, vw: 1 / 3, px: -26, height: 200 },
    { maxWidth: 1439, vw: 0.25, px: -25, height: 200 },
    { vw: 0, px: 256, height: 200 }
  ],
  /** House / condo / airbnb content grids: full width up to 420px x 220 on phones, 300x260 beside the text. */
  contentImage: [
    { maxWidth: 460, vw: 1, px: -40, height: 220 },
    { maxWidth: 768, vw: 0, px: 420, height: 220 },
    { vw: 0, px: 300, height: 260 }
  ],
  /** Service-category rows (deep, filthy, heavy condition, move-in/out, custom, post-construction/renovation). */
  serviceCategory: [
    { maxWidth: 768, vw: 1, px: -72, height: 180 },
    { vw: 0, px: 200, height: 200 }
  ],
  /** /services/residential-cleaning list. */
  residentialImage: [
    { maxWidth: 768, vw: 0, px: 250, height: 200 },
    { vw: 0, px: 200, height: 200 }
  ]
} satisfies Record<string, readonly CardBox[]>;

export type CardImageLayout = keyof typeof CARD_LAYOUTS;

/** Rounding up to whole px plus this margin keeps `sizes` from ever falling below the drawn width. */
const SAFETY_PX = 2;

/**
 * `sizes` for a photo with aspect ratio `photoRatio` (width / height) in a layout. It must describe
 * the width the photo is DRAWN at: object-fit: cover draws a photo wider than its box when the photo
 * is wider in proportion, so the drawn width is max(box width, box height x photo ratio). A `sizes`
 * that is too small makes the browser stretch a smaller file; one that is too large only costs bytes.
 */
export function cardImageSizes(layout: CardImageLayout, photoRatio: number): string {
  const entries: string[] = [];
  let from = 0;
  for (const box of CARD_LAYOUTS[layout] as readonly CardBox[]) {
    const to = box.maxWidth ?? Infinity;
    let vw = box.vw, px = box.px;
    if (box.ratio !== undefined) {
      // aspect-ratio box: the drawn width is a fixed multiple of the box width
      const k = Math.max(1, photoRatio / box.ratio);
      vw *= k; px *= k;
    } else if (box.height !== undefined) {
      const coverWidth = box.height * photoRatio;
      if (vw === 0) {
        px = Math.max(px, coverWidth);
      } else {
        // the box outgrows the cover width at this viewport width; below it the cover width rules
        const crossing = (coverWidth - px) / vw;
        if (crossing >= to) {
          vw = 0; px = coverWidth;
        } else if (crossing > from) {
          entries.push(`(max-width: ${Math.floor(crossing)}px) ${length(0, coverWidth)}`);
        }
      }
    }
    entries.push(to === Infinity ? length(vw, px) : `(max-width: ${to}px) ${length(vw, px)}`);
    from = to;
  }
  return entries.join(', ');
}

function length(vw: number, px: number): string {
  const fixed = Math.ceil(px) + SAFETY_PX;
  if (vw === 0) return `${fixed}px`;
  const percent = Math.ceil(vw * 10000) / 100;
  return fixed < 0 ? `calc(${percent}vw - ${-fixed}px)` : `calc(${percent}vw + ${fixed}px)`;
}

/**
 * `<img src="/images/foo.webp" cardImage="offerCard" loading="lazy">` - adds the `srcset` of the
 * image's generated variants (see responsive-image.loader.ts) and the `sizes` of its layout. The
 * plain `src` stays as written and is only used by clients without srcset support. An image with
 * no generated variants is left exactly as written.
 *
 * Only for `loading="lazy"` images: the attributes are set during the first change detection,
 * after `src`, which a lazy image has not started fetching yet.
 */
@Directive({
  selector: 'img[cardImage]',
  standalone: true,
  host: {
    '[attr.srcset]': 'srcset || null',
    '[attr.sizes]': 'srcset ? sizes() : null'
  }
})
export class CardImageDirective {
  readonly layout = input.required<CardImageLayout>({ alias: 'cardImage' });

  private readonly src = inject(new HostAttributeToken('src'));
  protected readonly srcset = responsiveSrcset(this.src);
  protected readonly sizes = computed(() => cardImageSizes(this.layout(), RESPONSIVE_IMAGE_RATIOS[this.src] ?? 1));
}
