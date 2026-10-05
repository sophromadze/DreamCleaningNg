import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CardImageDirective, cardImageSizes } from './card-image.directive';
import { RESPONSIVE_IMAGES } from './responsive-images.manifest';

@Component({
  standalone: true,
  imports: [CardImageDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <img id="known" src="/images/heavy-codition-cleaning-service-in-nyc.webp" cardImage="offerCard" alt="" loading="lazy">
    <img id="unknown" src="/images/not-in-the-manifest.webp" cardImage="offerCard" alt="" loading="lazy">
  `
})
class HostComponent {}

/** The width a `sizes` value resolves to at a viewport width (the subset of CSS this file emits). */
function resolveSizes(sizes: string, viewport: number): number {
  for (const entry of sizes.split(/,\s*(?![^()]*\))/)) {
    const m = entry.match(/^\(max-width: (\d+)px\) (.+)$/);
    if (m && viewport > +m[1]) continue;
    const value = m ? m[2] : entry;
    const px = value.match(/^(\d+)px$/);
    if (px) return +px[1];
    const calc = value.match(/^calc\(([\d.]+)vw ([+-]) (\d+)px\)$/)!;
    return viewport * +calc[1] / 100 + (calc[2] === '+' ? 1 : -1) * +calc[3];
  }
  throw new Error('no entry matched');
}

describe('CardImageDirective', () => {
  it('adds the generated srcset and the layout sizes, and leaves src as written', () => {
    const fixture = TestBed.configureTestingModule({ imports: [HostComponent] }).createComponent(HostComponent);
    fixture.detectChanges();
    const img: HTMLImageElement = fixture.nativeElement.querySelector('#known');
    const variants = RESPONSIVE_IMAGES['/images/heavy-codition-cleaning-service-in-nyc.webp'];
    expect(img.getAttribute('src')).toBe('/images/heavy-codition-cleaning-service-in-nyc.webp');
    expect(img.getAttribute('srcset')).toBe(variants.map(v => `${v.url} ${v.width}w`).join(', '));
    expect(img.getAttribute('sizes')).toBe(cardImageSizes('offerCard', 2));
  });

  it('leaves an image with no generated variants exactly as written', () => {
    const fixture = TestBed.configureTestingModule({ imports: [HostComponent] }).createComponent(HostComponent);
    fixture.detectChanges();
    const img: HTMLImageElement = fixture.nativeElement.querySelector('#unknown');
    expect(img.hasAttribute('srcset')).toBeFalse();
    expect(img.hasAttribute('sizes')).toBeFalse();
  });
});

describe('cardImageSizes', () => {
  // Drawn widths measured in the browser (object-fit: cover), CSS px. `sizes` may be larger, never smaller.
  const measured: [Parameters<typeof cardImageSizes>[0], number, number, number][] = [
    // layout, photo ratio, viewport, drawn width
    ['offerCard', 2, 412, 378 * 1.25],          // 2:1 photo in a 16:10 box is drawn 1.25x the box
    ['offerCard', 2, 1366, 366],
    ['offerCard', 1.7767, 1024, 349],
    ['offerCard', 1.4967, 1366, 293],           // narrower than the box: drawn at the box width
    ['servicePageCard', 2, 412, 300],           // 250x150 box
    ['servicePageCard', 0.6664, 1366, 250],
    ['boroughCard', 2, 1366, 400],              // 200px tall box
    ['boroughCard', 1.4967, 360, 320],
    ['boroughCard', 0.6664, 520, 480],
    ['contentImage', 1.5, 1366, 390],           // 300x260 box
    ['serviceCategory', 2, 1366, 400],          // 200x200 box
    ['serviceCategory', 2, 412, 360],           // 180px tall on phones
    ['residentialImage', 1.4967, 412, 300]
  ];
  for (const [layout, ratio, viewport, drawn] of measured) {
    it(`${layout}: a ${ratio} photo at ${viewport}px is never under its drawn width (${drawn}px)`, () => {
      const w = resolveSizes(cardImageSizes(layout, ratio), viewport);
      expect(w).toBeGreaterThanOrEqual(drawn);
      expect(w).toBeLessThan(drawn + 24);
    });
  }
});
