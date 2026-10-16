/**
 * Fonts test page (docs/plan.md §5.1), dev and test builds only: renders the
 * hardest Thai stacks in the bundled fonts at the line-height the overlay
 * uses, and checks from font metrics that no glyph ink leaves the line box —
 * the overlay's backgrounds and any overflow:hidden container would cut it.
 * Results: the table on the page and `window.phasaFontsReport` (e2e test).
 */
import { t } from '@/src/i18n';
import { extensionUrl } from '@/src/ui/extension-url';
import { THAI_FONTS, injectFontFaces } from '@/src/ui/fonts';
import './style.css';

export const STACKS = 'น้ำ ที่ ปู่ ฟ้า ญี่ปุ่น ฎีกา ฐาน ฤดู ฦ ๆ ฯ ๑๒๓';
const SENTENCE = 'ผู้ใหญ่ลี้ตีกลองประชุม เด็กๆ ไม่ค่อยรู้เรื่อง น้ำท่วมทุ่ง ผักบุ้งโหรงเหรง';
const SIZES = [16, 24, 40];

interface Check {
  family: string;
  size: number;
  text: string;
  lineHeightPx: number;
  /** Space between the line box top and the highest ink; negative = clipped. */
  roomAbovePx: number;
  /** Space between the lowest ink and the line box bottom; negative = clipped. */
  roomBelowPx: number;
  ok: boolean;
}

interface Report {
  lineHeight: number;
  loaded: Record<string, boolean>;
  checks: Check[];
  ok: boolean;
}

declare global {
  interface Window {
    phasaFontsReport?: Report;
  }
}

function lineHeightFactor(): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    '--phasa-line-height-thai',
  );
  return Number.parseFloat(value) || 1.8;
}

/**
 * CSS line box model: the content area (font ascent + descent) is centred in
 * the line box, so the baseline sits at half-leading + ascent from the top.
 */
function check(family: string, size: number, text: string, factor: number): Check {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('2d canvas unavailable');
  context.font = `${size}px "${family}"`;
  const metrics = context.measureText(text);
  const lineHeightPx = factor * size;
  const content = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
  const baseline = (lineHeightPx - content) / 2 + metrics.fontBoundingBoxAscent;
  const roomAbovePx = baseline - metrics.actualBoundingBoxAscent;
  const roomBelowPx = lineHeightPx - (baseline + metrics.actualBoundingBoxDescent);
  return {
    family,
    size,
    text,
    lineHeightPx,
    roomAbovePx,
    roomBelowPx,
    ok: roomAbovePx >= -0.5 && roomBelowPx >= -0.5,
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function main(): Promise<void> {
  document.title = t('fontsTestTitle');
  injectFontFaces(document, extensionUrl);
  const root = document.getElementById('root');
  if (!root) return;

  const loaded: Record<string, boolean> = {};
  for (const font of THAI_FONTS) {
    await document.fonts.load(`16px "${font.family}"`, STACKS);
    loaded[font.family] = document.fonts.check(`16px "${font.family}"`, STACKS);
  }

  const factor = lineHeightFactor();
  const checks = THAI_FONTS.flatMap((font) =>
    SIZES.flatMap((size) =>
      [STACKS, SENTENCE].map((text) => check(font.family, size, text, factor)),
    ),
  );
  const report: Report = { lineHeight: factor, loaded, checks, ok: checks.every((c) => c.ok) };

  const page = element('main', { className: 'fonts-test' }, [
    element('h1', {}, [t('fontsTestTitle')]),
  ]);
  page.append(
    element('p', { className: 'page__status' }, [
      `line-height ${factor} · ${report.ok ? 'all checks passed' : 'CLIPPING DETECTED'}`,
    ]),
  );
  for (const font of THAI_FONTS) {
    page.append(
      element('h2', {}, [`${font.family} — ${loaded[font.family] ? 'loaded' : 'NOT LOADED'}`]),
    );
    for (const size of SIZES) {
      for (const text of [STACKS, SENTENCE]) {
        const sample = element('p', { className: 'sample', lang: 'th' }, [text]);
        sample.style.fontFamily = `"${font.family}"`;
        sample.style.fontSize = `${size}px`;
        page.append(sample);
      }
    }
    const overlay = element('p', { className: 'sample sample--overlay', lang: 'th' }, [STACKS]);
    overlay.style.fontFamily = `"${font.family}"`;
    overlay.style.fontSize = '32px';
    page.append(overlay);
  }

  const rows = checks.map((c) => {
    const row = element('tr', {}, [
      element('td', {}, [c.family]),
      element('td', {}, [`${c.size}px`]),
      element('td', { lang: 'th' }, [c.text.slice(0, 12)]),
      element('td', {}, [c.roomAbovePx.toFixed(1)]),
      element('td', {}, [c.roomBelowPx.toFixed(1)]),
      element('td', {}, [c.ok ? 'ok' : 'clipped']),
    ]);
    row.dataset.ok = String(c.ok);
    return row;
  });
  const header = element(
    'tr',
    {},
    ['font', 'size', 'text', 'room above', 'room below', ''].map((h) => element('th', {}, [h])),
  );
  page.append(
    element('h2', {}, ['Line box checks']),
    element('table', { className: 'checks' }, [header, ...rows]),
  );
  root.append(page);

  window.phasaFontsReport = report;
  document.body.dataset.fontsReady = 'true';
}

void main();
