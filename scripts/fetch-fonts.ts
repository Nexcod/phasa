/**
 * Downloads the bundled Thai fonts (docs/plan.md §5.1) into public/fonts/:
 * the Thai subset of Noto Sans Thai Looped and Noto Sans Thai (variable,
 * weights 100–900) from Google Fonts, plus their OFL license text.
 *
 *   pnpm fonts:fetch
 *
 * The files are committed; re-run only to update the fonts, then check the
 * fonts test page (docs/plan.md §5.1) and update public/fonts/README.md.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { THAI_FONTS } from '../src/ui/fonts';

const OUT_DIR = join(import.meta.dirname, '../public/fonts');
// Google Fonts serves woff2 only to browsers it recognises.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function get(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The `thai` subset block of a Google Fonts css2 response. */
function thaiSubsetUrl(css: string, family: string): string {
  const block = css.split('/* thai */')[1]?.split('}')[0] ?? '';
  if (!block.includes(`font-family: '${family}'`)) throw new Error(`No thai subset for ${family}`);
  const url = /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1];
  if (!url) throw new Error(`No woff2 URL for ${family}`);
  return url;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const font of THAI_FONTS) {
  const query = `family=${font.upstreamFamily.replaceAll(' ', '+')}:wght@100..900&display=swap`;
  const css = (await get(`https://fonts.googleapis.com/css2?${query}`)).toString('utf8');
  const woff2 = await get(thaiSubsetUrl(css, font.upstreamFamily));
  writeFileSync(join(OUT_DIR, font.file), woff2);
  const sha256 = createHash('sha256').update(woff2).digest('hex');
  console.log(`${font.file}\t${woff2.length} B\tsha256 ${sha256}`);
}

// Both families are SIL OFL 1.1, Copyright 2022 The Noto Project Authors (notofonts/thai).
const ofl = await get(
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansthailooped/OFL.txt',
);
writeFileSync(join(OUT_DIR, 'OFL.txt'), ofl);
console.log(`OFL.txt\t${ofl.length} B`);
