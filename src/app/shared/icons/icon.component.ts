import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { IconDefinition } from './icon-definition';

/**
 * Inline SVG icon — the public pages' replacement for the Font Awesome webfont.
 *
 *   <i [appIcon]="icons.faCircleCheck" class="success-icon" aria-hidden="true"></i>
 *
 * It stays an `<i>` so every existing `.something i { font-size; color; ... }` rule keeps
 * applying: the glyph is 1em tall and painted in `currentColor`, exactly like the font glyph it
 * replaces. The box metrics that make it a drop-in (line box, baseline, width) live with the
 * `.app-icon` rules in styles.scss.
 *
 * Icons are generated constants, one module each in ./glyphs/; a component imports the ones it
 * renders from their own modules (`import { faCheck } from '.../icons/glyphs/faCheck';`) and
 * exposes them to its template (`protected readonly icons = { faCheck, faXmark };`). To add an
 * icon, list it in scripts/icons.config.json and run `npm run icons`.
 */
@Component({
  selector: 'i[appIcon]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'app-icon' },
  template: `@if (appIcon; as icon) {<svg class="app-icon__svg" xmlns="http://www.w3.org/2000/svg" [attr.viewBox]="'0 0 ' + icon.width + ' ' + icon.height" [style.width.em]="icon.width / icon.height" aria-hidden="true" focusable="false"><path fill="currentColor" [attr.d]="icon.path"/></svg>}`
})
export class IconComponent {
  @Input({ required: true }) appIcon: IconDefinition | null | undefined;
}
