/** One glyph from the generated icon set (./glyphs/). `path` is drawn in a `0 0 width height` box. */
export interface IconDefinition {
  readonly width: number;
  readonly height: number;
  readonly path: string;
}
