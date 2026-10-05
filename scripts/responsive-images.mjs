#!/usr/bin/env node
/**
 * Generates responsive WebP width variants for the images listed in
 * scripts/responsive-images.config.json, plus the manifest the Angular image loader reads.
 *
 *   npm run images:responsive
 *
 * To add an image: append its file name (relative to `sourceDir`) to `images` in the config and
 * re-run. Then render it with the responsive loader (see
 * src/app/shared/images/responsive-image.loader.ts) instead of a plain `src`.
 *
 * An entry can also be an object, for images that need their own settings:
 *   { "file": "laundry-service-nyc.webp", "widths": [320, 480], "keepOriginal": true }
 *   - widths:       replaces the global `widths` for this image.
 *   - keepOriginal: the untouched original becomes the largest candidate (at its own width, under
 *                   its own /images URL). For small sources that phones already draw at full size:
 *                   wide screens get the smaller variants, nobody gets a worse file than before.
 *
 * RULES THIS SCRIPT ENFORCES
 *   - Aspect ratio is always kept: only the width is given to the resizer, the height follows.
 *     Nothing is cropped - containers that show a different ratio crop with `object-fit`.
 *   - Never upscales: widths larger than the source are skipped. A source narrower than the
 *     smallest configured width gets a single variant at its own width.
 *   - Originals in `sourceDir` are only read, never written.
 *
 * CACHE BUSTING. Node serves /img/** with a one-year cache, so a URL must never be reused for
 * different bytes. Every file name carries a hash of its own content
 * (cabinet-cleaning-in-nyc-800.a1b2c3d4.webp); regenerating a changed image produces new URLs, and
 * the manifest is what tells the app which ones are current. Unchanged sources produce identical
 * bytes and therefore identical names, so a re-run is a no-op for them.
 *
 * `outputDir` belongs to this script: any file in it that the new manifest does not reference is
 * deleted at the end of a run.
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'scripts', 'responsive-images.config.json');

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
const sourceDir = path.join(PROJECT_ROOT, config.sourceDir);
const outputDir = path.join(PROJECT_ROOT, config.outputDir);
const manifestPath = path.join(PROJECT_ROOT, config.manifest);
const widths = [...config.widths].sort((a, b) => a - b);

await mkdir(outputDir, { recursive: true });

const manifest = {};
const ratios = {};
const written = new Set();
const report = [];

for (const entry of config.images) {
  const { file, widths: ownWidths, keepOriginal = false } = typeof entry === 'string' ? { file: entry } : entry;
  const imageWidths = ownWidths ? [...ownWidths].sort((a, b) => a - b) : widths;
  const sourcePath = path.join(sourceDir, file);
  const source = await readFile(sourcePath);
  // rotate() with no argument applies EXIF orientation, so a variant can't come out sideways
  // where the browser would have rotated the original.
  const meta = await sharp(source).rotate().metadata();
  const sourceWidth = meta.autoOrient?.width ?? meta.width;
  const sourceHeight = meta.autoOrient?.height ?? meta.height;

  let targets = imageWidths.filter(w => w <= sourceWidth);
  if (targets.length === 0) targets = [sourceWidth];

  const base = file.replace(/\.[^.]+$/, '');
  const variants = [];
  for (const width of targets) {
    const { data, info } = await sharp(source)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: config.quality, effort: 6 })
      .toBuffer({ resolveWithObject: true });
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 8);
    const name = `${base}-${width}.${hash}.webp`;
    await writeFile(path.join(outputDir, name), data);
    written.add(name);
    variants.push({ width: info.width, url: `${config.outputUrlPrefix}/${name}` });
    report.push({
      file: name,
      size: `${info.width}x${info.height}`,
      kb: (data.length / 1024).toFixed(1)
    });
  }

  const originalUrl = `${config.sourceUrlPrefix}/${file}`;
  if (keepOriginal && sourceWidth > variants[variants.length - 1].width) {
    variants.push({ width: sourceWidth, url: originalUrl });
  }

  manifest[originalUrl] = variants;
  ratios[originalUrl] = Number((sourceWidth / sourceHeight).toFixed(4));
  report.push({
    file: `  (source ${file})${keepOriginal ? ' - kept as the largest candidate' : ''}`,
    size: `${sourceWidth}x${sourceHeight}`,
    kb: (source.length / 1024).toFixed(1)
  });
}

for (const name of await readdir(outputDir)) {
  if (!written.has(name)) {
    await unlink(path.join(outputDir, name));
    console.log(`removed stale ${name}`);
  }
}

const entries = Object.entries(manifest).map(([src, variants]) =>
  `  '${src}': [\n` +
  variants.map(v => `    { width: ${v.width}, url: '${v.url}' }`).join(',\n') +
  `\n  ]`
);
const manifestSource =
  `// AUTO-GENERATED by scripts/responsive-images.mjs - do not edit by hand.\n` +
  `// Re-run \`npm run images:responsive\` after changing scripts/responsive-images.config.json.\n\n` +
  `export interface ResponsiveImageVariant {\n  readonly width: number;\n  readonly url: string;\n}\n\n` +
  `/** Original public URL -> its generated variants, ascending by width. */\n` +
  `export const RESPONSIVE_IMAGES: Readonly<Record<string, readonly ResponsiveImageVariant[]>> = {\n` +
  `${entries.join(',\n')}\n};\n\n` +
  `/** Original public URL -> width / height of the source (what object-fit: cover crops from). */\n` +
  `export const RESPONSIVE_IMAGE_RATIOS: Readonly<Record<string, number>> = {\n` +
  Object.entries(ratios).map(([src, ratio]) => `  '${src}': ${ratio}`).join(',\n') +
  `\n};\n`;
await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, manifestSource);

console.table(report);
console.log(`manifest -> ${config.manifest}`);
