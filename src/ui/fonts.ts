/**
 * Bundled Thai fonts (docs/plan.md §5.1). Files live in public/fonts/ and are
 * fetched by `npm run fonts:fetch`.
 *
 * `@font-face` declared inside a shadow root is ignored by Chrome, so every
 * context injects these rules into `document.head`; shadow roots then use the
 * family names. Families are prefixed with "Phasa" so our rules never change
 * how youtube.com renders its own text.
 */

export interface BundledFont {
  /** Family name used in our CSS (`--phasa-font-thai`). */
  family: string;
  /** Google Fonts family the file comes from. */
  upstreamFamily: string;
  /** File name under public/fonts/. */
  file: string;
}

export const THAI_FONTS: readonly BundledFont[] = [
  {
    family: 'Phasa Noto Sans Thai Looped',
    upstreamFamily: 'Noto Sans Thai Looped',
    file: 'NotoSansThaiLooped-thai.woff2',
  },
  {
    family: 'Phasa Noto Sans Thai',
    upstreamFamily: 'Noto Sans Thai',
    file: 'NotoSansThai-thai.woff2',
  },
];

/** Google Fonts' `thai` subset range: Latin text falls through to the UI font. */
export const THAI_UNICODE_RANGE = 'U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC';

const STYLE_ID = 'phasa-font-faces';

export function fontFaceCss(resolve: (path: string) => string): string {
  return THAI_FONTS.map(
    (font) => `@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('${resolve(`fonts/${font.file}`)}') format('woff2');
  unicode-range: ${THAI_UNICODE_RANGE};
}`,
  ).join('\n');
}

/** Adds the `@font-face` rules to `doc.head` once. */
export function injectFontFaces(doc: Document, resolve: (path: string) => string): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = fontFaceCss(resolve);
  // `head` can still be missing at document_start.
  ((doc.head as HTMLHeadElement | null) ?? doc.documentElement).append(style);
}
