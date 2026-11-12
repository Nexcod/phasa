import { describe, expect, it } from 'vitest';
import { importRequests, readBackup } from '@/src/backup/format';
import { DEFAULT_SETTINGS, parseSettingsPatch, pickValidSettings } from '@/src/settings';
import {
  DARK_TONE_COLORS,
  DEFAULT_TONE_COLORS,
  appearanceVars,
  thaiFontStack,
} from '@/src/ui/appearance';

describe('appearance settings', () => {
  it('validates the theme, font, subtitle size and tone colors', () => {
    expect(parseSettingsPatch({ theme: 'dark', thaiFont: 'loopless' })).toEqual({
      theme: 'dark',
      thaiFont: 'loopless',
    });
    expect(parseSettingsPatch({ theme: 'sepia' })).toBeNull();
    expect(parseSettingsPatch({ subtitleSize: 150 })).toEqual({ subtitleSize: 150 });
    for (const size of [40, 260, 99.5, '120']) {
      expect(parseSettingsPatch({ subtitleSize: size }), String(size)).toBeNull();
    }
    expect(parseSettingsPatch({ toneColors: null })).toEqual({ toneColors: null });
    expect(parseSettingsPatch({ toneColors: DARK_TONE_COLORS })).toEqual({
      toneColors: DARK_TONE_COLORS,
    });
    // Some tones, as #rrggbb, nothing else.
    expect(parseSettingsPatch({ toneColors: { high: '#ff8800' } })).toEqual({
      toneColors: { high: '#ff8800' },
    });
    expect(parseSettingsPatch({ toneColors: {} })).toBeNull();
    expect(parseSettingsPatch({ toneColors: { ...DEFAULT_TONE_COLORS, mid: 'red' } })).toBeNull();
    expect(
      parseSettingsPatch({ toneColors: { ...DEFAULT_TONE_COLORS, extra: '#000000' } }),
    ).toBeNull();
    expect(parseSettingsPatch({ toneColors: [] })).toBeNull();
  });

  it('keeps the valid fields of settings from elsewhere', () => {
    expect(
      pickValidSettings({ autoPause: true, subtitleSize: 1000, theme: 'dark', unknown: 1 }),
    ).toEqual({ settings: { autoPause: true, theme: 'dark' }, skipped: 2 });
    expect(pickValidSettings('nope')).toEqual({ settings: {}, skipped: 0 });
  });

  it('turns them into custom properties', () => {
    expect(appearanceVars(DEFAULT_SETTINGS)).toEqual({
      '--phasa-font-thai': thaiFontStack('looped'),
      '--phasa-subs-scale': '1',
    });
    const vars = appearanceVars({
      thaiFont: 'loopless',
      subtitleSize: 130,
      toneColors: { high: '#00ff00' },
    });
    expect(vars['--phasa-font-thai']?.startsWith("'Phasa Noto Sans Thai', ")).toBe(true);
    expect(vars['--phasa-subs-scale']).toBe('1.3');
    expect(vars['--phasa-tone-high']).toBe('#00ff00');
    // The others keep the built-in color of each background.
    expect(vars['--phasa-tone-mid']).toBeUndefined();
  });
});

describe('import requests', () => {
  const file = (rows: unknown[]) => {
    const read = readBackup(
      JSON.stringify({
        format: 'phasa-backup',
        version: 1,
        words: rows,
        segRules: [{ kind: 'merge', parts: ['ภาษา', 'ไทย'] }],
        settings: { autoPause: true },
      }),
    );
    if (!read.ok) throw new Error(read.error);
    return read.file;
  };

  it('sends settings first, boundary fixes before words, in bounded chunks', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ thai: `ภาษา${i}`, status: 'known' }));
    const requests = importRequests(file(rows), { settings: true, maxRows: 2, maxChars: 1e6 });
    expect(requests.map((request) => request.section)).toEqual([
      'settings',
      'segRules',
      'words',
      'words',
      'words',
    ]);
    expect(requests.slice(2).map((r) => ('rows' in r ? r.rows.length : 0))).toEqual([2, 2, 1]);
  });

  it('splits by size too, but never sends an empty request', () => {
    const big = { thai: 'ภาษา', status: 'known', note: 'x'.repeat(500) };
    const requests = importRequests(file([big, big, big]), {
      settings: false,
      maxRows: 1000,
      maxChars: 600,
    });
    expect(requests.map((request) => request.section)).toEqual([
      'segRules',
      'words',
      'words',
      'words',
    ]);
  });
});
