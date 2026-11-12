/**
 * Appearance settings as CSS (docs/plan.md §5.1, §10): the Thai font, the subtitle size and the
 * tone colors become custom properties on a root element; the theme of extension pages becomes
 * `data-theme` on <html>. UI on youtube.com follows YouTube's own theme instead.
 */
import type { CSSProperties } from 'react';
import type { Settings, ThaiFontSetting, ThemeSetting } from '../settings';
import { TONES } from '../thai/tones';
import type { Tone } from '../thai/types';

/** Fallbacks after the bundled fonts, for text outside their `thai` subset range. */
const SYSTEM_THAI = `'Noto Sans Thai', 'Thonburi', 'Leelawadee UI', sans-serif`;

export function thaiFontStack(font: ThaiFontSetting): string {
  return font === 'loopless'
    ? `'Phasa Noto Sans Thai', 'Phasa Noto Sans Thai Looped', ${SYSTEM_THAI}`
    : `'Phasa Noto Sans Thai Looped', 'Phasa Noto Sans Thai', ${SYSTEM_THAI}`;
}

/** The built-in tone colors of light pages (src/ui/theme.css), where a color picker starts. */
export const DEFAULT_TONE_COLORS: Readonly<Record<Tone, string>> = {
  mid: '#6b7280',
  low: '#2563eb',
  falling: '#dc2626',
  high: '#16a34a',
  rising: '#9333ea',
};

/** The built-in tone colors on the dark subtitle background (entrypoints/youtube.content/style.css). */
export const DARK_TONE_COLORS: Readonly<Record<Tone, string>> = {
  mid: '#d1d5db',
  low: '#93c5fd',
  falling: '#fca5a5',
  high: '#86efac',
  rising: '#d8b4fe',
};

export const toneVar = (tone: Tone) => `--phasa-tone-${tone}`;

/** Custom properties for the appearance settings; built-in values come from the stylesheets. */
export function appearanceVars(
  settings: Pick<Settings, 'thaiFont' | 'subtitleSize' | 'toneColors'>,
): Record<string, string> {
  const vars: Record<string, string> = {
    '--phasa-font-thai': thaiFontStack(settings.thaiFont),
    '--phasa-subs-scale': String(settings.subtitleSize / 100),
  };
  for (const tone of TONES) {
    const color = settings.toneColors?.[tone];
    if (color) vars[toneVar(tone)] = color;
  }
  return vars;
}

/** The same, as a React `style` for a root element (the overlay, the title badge). */
export function appearanceStyle(
  settings: Pick<Settings, 'thaiFont' | 'subtitleSize' | 'toneColors'>,
): CSSProperties {
  return appearanceVars(settings);
}

const THEME_KEY = 'phasa-theme';

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** `data-theme` on <html>: none follows the system (`prefers-color-scheme`). */
export function applyTheme(doc: Document, theme: ThemeSetting): void {
  if (theme === 'system') delete doc.documentElement.dataset.theme;
  else doc.documentElement.dataset.theme = theme;
}

/**
 * Before the first render: the theme last seen, so a page doesn't flash in the system's theme
 * while the settings load from the service worker. localStorage is shared by extension pages.
 */
export function applyCachedTheme(doc: Document): void {
  const cached = storage()?.getItem(THEME_KEY);
  if (cached === 'light' || cached === 'dark') applyTheme(doc, cached);
}

/** Applies the appearance settings to an extension page and remembers its theme. */
export function applyPageAppearance(doc: Document, settings: Settings): void {
  applyTheme(doc, settings.theme);
  try {
    storage()?.setItem(THEME_KEY, settings.theme);
  } catch {
    // Storage full or blocked: only the first paint is affected.
  }
  const style = doc.documentElement.style;
  for (const tone of TONES) style.removeProperty(toneVar(tone));
  for (const [name, value] of Object.entries(appearanceVars(settings))) {
    style.setProperty(name, value);
  }
}
