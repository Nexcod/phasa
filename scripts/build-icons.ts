/**
 * Draws Phasa's icons and Chrome Web Store promo tiles (ADR 0017):
 *
 *   public/icon/{16,32,48,128}.png   manifest icons (WXT picks them up from public/icon/)
 *   docs/store/promo-small.png       440×280 small promo tile
 *   docs/store/promo-marquee.png     1400×560 marquee promo tile
 *
 *   npm run icons
 *
 * The mark is the letter ภ (the first letter of ภาษา, "language") in the bundled Noto Sans Thai
 * Looped, white on the accent gradient, over a strip of the five tone colors from 48 px up. The
 * 128 px icon follows the store's rule: 96 px of artwork inside 16 px of transparent padding.
 * Drawn on a canvas in Playwright's Chromium, so the glyph is measured and centred exactly. The
 * PNGs are committed; re-run after changing the design and look at them in light and dark.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..');
const FONT = readFileSync(join(ROOT, 'public/fonts/NotoSansThaiLooped-thai.woff2'));

/** What the page draws; `artwork` is the icon's square without padding. */
interface IconSpec {
  kind: 'icon';
  file: string;
  size: number;
  artwork: number;
}
interface TileSpec {
  kind: 'tile';
  file: string;
  width: number;
  height: number;
}
type Spec = IconSpec | TileSpec;

const SPECS: Spec[] = [
  { kind: 'icon', file: 'public/icon/16.png', size: 16, artwork: 16 },
  { kind: 'icon', file: 'public/icon/32.png', size: 32, artwork: 32 },
  { kind: 'icon', file: 'public/icon/48.png', size: 48, artwork: 48 },
  { kind: 'icon', file: 'public/icon/128.png', size: 128, artwork: 96 },
  { kind: 'tile', file: 'docs/store/promo-small.png', width: 440, height: 280 },
  { kind: 'tile', file: 'docs/store/promo-marquee.png', width: 1400, height: 560 },
];

/** Runs in the page: returns a PNG data URL per spec. Keep it self-contained (serialized). */
async function draw({
  specs,
  fontBase64,
}: {
  specs: Spec[];
  fontBase64: string;
}): Promise<string[]> {
  const GRADIENT = ['#3b82f6', '#4338ca'];
  // Tone colors of the dark theme (src/ui/theme.css): readable on the blue.
  const TONES = ['#9ca3af', '#60a5fa', '#f87171', '#4ade80', '#c084fc'];
  const face = new FontFace('PhasaMark', `url(data:font/woff2;base64,${fontBase64})`, {
    weight: '100 900',
  });
  await face.load();
  document.fonts.add(face);

  const fill = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const gradient = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
    gradient.addColorStop(0, GRADIENT[0] ?? '');
    gradient.addColorStop(1, GRADIENT[1] ?? '');
    return gradient;
  };

  /** Draws `text` so its ink box is centred on (cx, cy) with the given ink height. */
  const glyph = (
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    cy: number,
    inkHeight: number,
  ) => {
    ctx.font = '600 100px PhasaMark';
    const probe = ctx.measureText(text);
    const scale = inkHeight / (probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent);
    ctx.font = `600 ${100 * scale}px PhasaMark`;
    const m = ctx.measureText(text);
    const inkWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const x = cx - inkWidth / 2 + m.actualBoundingBoxLeft;
    const y = cy - (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y + m.actualBoundingBoxAscent);
  };

  const toneBar = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const gap = h * 0.45;
    const segment = (w - gap * (TONES.length - 1)) / TONES.length;
    TONES.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x + i * (segment + gap), y, segment, h, h / 2);
      ctx.fill();
    });
  };

  return specs.map((spec) => {
    const canvas = document.createElement('canvas');
    const width = spec.kind === 'icon' ? spec.size : spec.width;
    const height = spec.kind === 'icon' ? spec.size : spec.height;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');

    if (spec.kind === 'icon') {
      const a = spec.artwork;
      const o = (spec.size - a) / 2;
      ctx.fillStyle = fill(ctx, o, o, a, a);
      ctx.beginPath();
      ctx.roundRect(o, o, a, a, a * 0.22);
      ctx.fill();
      if (a >= 48) {
        glyph(ctx, 'ภ', o + a / 2, o + a * 0.43, a * 0.5);
        toneBar(ctx, o + a * 0.22, o + a * 0.76, a * 0.56, a * 0.07);
      } else {
        // No strip at toolbar sizes: it would be a blur. The letter takes the room.
        glyph(ctx, 'ภ', o + a / 2, o + a / 2, a * 0.64);
      }
    } else {
      // Promo tiles: no text but the brand word ภาษา (store guidelines: avoid text, focus on
      // the brand), the tone strip under it, full bleed.
      ctx.fillStyle = fill(ctx, 0, 0, width, height);
      ctx.fillRect(0, 0, width, height);
      const ink = height * 0.3;
      glyph(ctx, 'ภาษา', width / 2, height * 0.44, ink);
      const barWidth = ink * 2.4;
      toneBar(ctx, (width - barWidth) / 2, height * 0.68, barWidth, height * 0.035);
    }
    return canvas.toDataURL('image/png');
  });
}

const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  // tsx (esbuild keepNames) wraps nested functions in __name(), which the page doesn't have.
  await page.addInitScript('globalThis.__name = (fn) => fn');
  await page.goto('about:blank');
  const urls = await page.evaluate(draw, { specs: SPECS, fontBase64: FONT.toString('base64') });
  SPECS.forEach((spec, i) => {
    const file = join(ROOT, spec.file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      Buffer.from((urls[i] ?? '').replace(/^data:image\/png;base64,/, ''), 'base64'),
    );
    console.log(spec.file);
  });
} finally {
  await browser.close();
}
