import { Service } from '@angular/core';

/** Remembered section heights, by section class (or host tag for the testimonial section). */
export interface SectionHeights {
  /** Border-box height - what `min-height` and a same-sized `@defer` placeholder take
   *  (`box-sizing: border-box` site-wide). */
  readonly box: Readonly<Record<string, number>>;
  /** Content-box height - what `contain-intrinsic-size` takes. It sizes the CONTENT box, so the
   *  section's own padding comes on top; feeding it the border-box height made every
   *  content-visibility section start its padding (~66px) too tall on the way back. */
  readonly content: Readonly<Record<string, number>>;
}

const NONE: SectionHeights = { box: {}, content: {} };

/**
 * Heights of the homepage sections when the reader last left the page (same window width only).
 *
 * Coming back with Back, the old scroll offset is restored before the first paint (see
 * ScrollRestoreService), while three kinds of section are not at their final height yet: the
 * before/after gallery, until its carousel has measured itself; the `content-visibility: auto`
 * sections, which a new page instance lays out at their 900px placeholder size until they are
 * drawn; and the `@defer` blocks whose dependencies resolve a moment after the first render.
 * Laying them out at the remembered heights makes the restored offset land on the same content,
 * and nothing moves when they finish.
 *
 * In memory only: a reload starts from the prerendered page, which has no gallery to reserve.
 */
@Service()
export class HomeLayoutMemoryService {
  private width = 0;
  private heights: SectionHeights = NONE;

  save(width: number, heights: SectionHeights): void {
    this.width = width;
    this.heights = heights;
  }

  /** The heights remembered for this window width, or none when the width has changed since. */
  recall(width: number): SectionHeights {
    return width === this.width ? this.heights : NONE;
  }
}
