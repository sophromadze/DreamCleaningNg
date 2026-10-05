import { LABEL_ON_DARK, LABEL_ON_LIGHT, readableLabelColor } from './readable-label-color';

describe('readableLabelColor (admin-chosen badge colours)', () => {
  it('keeps white on dark colours', () => {
    for (const c of ['#000000', '#1d4ed8', '#b91c1c', '#6c757d', '#7e22ce']) {
      expect(readableLabelColor(c), c).toBe(LABEL_ON_DARK);
    }
  });

  it('switches to near-black on light colours that failed with white', () => {
    // The stored offer colours the audit found below AA with white text.
    for (const c of ['#ea8410', '#ff00f7', '#fa0000', '#28a745', '#ffffff', '#fde047']) {
      expect(readableLabelColor(c), c).toBe(LABEL_ON_LIGHT);
    }
  });

  it('reaches AA (4.5:1) on every background, including saturated reds', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(s => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
      const bg = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      expect(ratio(readableLabelColor(bg), bg), bg).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(readableLabelColor('#fa0000'), '#fa0000')).toBeGreaterThanOrEqual(4.5);
  });

  it('accepts 3-digit hex and ignores case and spaces', () => {
    expect(readableLabelColor(' #FFF ')).toBe(LABEL_ON_LIGHT);
    expect(readableLabelColor('#000')).toBe(LABEL_ON_DARK);
  });

  it('falls back to white for a missing or unparsable value', () => {
    expect(readableLabelColor(null)).toBe(LABEL_ON_DARK);
    expect(readableLabelColor(undefined)).toBe(LABEL_ON_DARK);
    expect(readableLabelColor('rgb(1,2,3)')).toBe(LABEL_ON_DARK);
  });
});
