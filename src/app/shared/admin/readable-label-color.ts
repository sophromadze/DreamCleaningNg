/**
 * Label colour for a badge whose BACKGROUND is chosen by an admin and stored in the database
 * (special-offer badge colours). The stored colour is shown exactly as chosen; only the text on it
 * adapts, so any colour an admin picks keeps the label readable (WCAG AA, 2026-10).
 *
 * Returns white or black, whichever contrasts more with the background. Pure black (not the site's
 * slate-900) on purpose: with white and black, EVERY background reaches at least 4.58:1, whereas
 * slate-900 left saturated reds such as #fa0000 at 4.3:1. A colour that cannot be parsed falls back
 * to white, which is what every badge used before.
 */
export const LABEL_ON_DARK = '#ffffff';
export const LABEL_ON_LIGHT = '#000000';

export function readableLabelColor(background: string | null | undefined): string {
  const rgb = parseHexColor(background);
  if (!rgb) return LABEL_ON_DARK;
  const bg = relativeLuminance(rgb);
  const onWhite = (1.05) / (bg + 0.05);
  const onDark = (bg + 0.05) / (relativeLuminance(parseHexColor(LABEL_ON_LIGHT)!) + 0.05);
  return onWhite >= onDark ? LABEL_ON_DARK : LABEL_ON_LIGHT;
}

function parseHexColor(value: string | null | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((value || '').trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
