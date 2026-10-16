import { describe, expect, it } from 'vitest';
import {
  BRIDGE_SOURCE,
  envelope,
  openEnvelope,
  parseToIsolated,
  parseToMain,
  parseVideoInfo,
} from '@/src/captions/bridge';
import { parsePanelToTab } from '@/src/messaging/panel';
import { DEFAULT_SETTINGS, parseSettingsPatch, settingsFromRows } from '@/src/settings';

const VIDEO = {
  videoId: 'iH31BMKBEdU',
  title: 'ฝรั่งคิดยังไงกับภาษาไทย?',
  channel: 'c',
  durationSec: 1008,
  isLive: false,
  tracks: [{ vssId: 'a.th', languageCode: 'th', kind: 'asr', name: 'Thai', isTranslatable: true }],
};

describe('bridge envelopes', () => {
  it('opens only envelopes addressed to the given side', () => {
    const data = envelope('isolated', 'n1', { type: 'video', video: null });
    expect(openEnvelope(data, 'isolated')).toEqual({
      nonce: 'n1',
      message: { type: 'video', video: null },
    });
    expect(openEnvelope(data, 'main')).toBeNull();
    expect(openEnvelope({ source: 'other', to: 'main', nonce: 'n' }, 'main')).toBeNull();
    expect(openEnvelope({ source: BRIDGE_SOURCE, to: 'main', nonce: '' }, 'main')).toBeNull();
    expect(openEnvelope('hello', 'main')).toBeNull();
  });
});

describe('message validation', () => {
  it('accepts well-formed messages to the isolated world', () => {
    expect(parseToIsolated({ type: 'video', video: VIDEO })).toEqual({
      type: 'video',
      video: VIDEO,
    });
    expect(
      parseToIsolated({
        type: 'fetched',
        requestId: 1,
        videoId: VIDEO.videoId,
        results: [
          { ref: { vssId: 'a.th' }, ok: true, body: '{}' },
          { ref: { vssId: 'a.th', tlang: 'en' }, ok: false, error: 'empty' },
        ],
      }),
    ).toMatchObject({ type: 'fetched', requestId: 1 });
  });

  it('rejects anything malformed or unknown', () => {
    expect(parseToIsolated({ type: 'video', video: { ...VIDEO, videoId: '<script>' } })).toBeNull();
    expect(
      parseToIsolated({
        type: 'fetched',
        requestId: 1,
        videoId: VIDEO.videoId,
        results: [{ ref: { vssId: 'a.th' }, ok: false, error: 'pwned' }],
      }),
    ).toBeNull();
    expect(parseToIsolated({ type: 'eval', code: '1' })).toBeNull();
    expect(
      parseToMain({ type: 'fetch', requestId: 'x', videoId: VIDEO.videoId, refs: [] }),
    ).toBeNull();
    expect(
      parseToMain({ type: 'fetch', requestId: 1, videoId: VIDEO.videoId, refs: [{}] }),
    ).toBeNull();
    expect(parseToMain({ type: 'hello', extra: true })).toEqual({ type: 'hello' });
  });

  it('drops invalid tracks and clamps odd values in video info', () => {
    const info = parseVideoInfo({
      ...VIDEO,
      durationSec: -5,
      tracks: [
        ...VIDEO.tracks,
        { vssId: '.xx' },
        null,
        { vssId: '.de', languageCode: 'de', kind: 'manual' },
      ],
    });
    expect(info?.durationSec).toBe(0);
    expect(info?.tracks.map((track) => track.vssId)).toEqual(['a.th', '.de']);
  });
});

describe('panel channel', () => {
  it('validates panel messages', () => {
    expect(parsePanelToTab({ type: 'seek', index: 3 })).toEqual({ type: 'seek', index: 3 });
    expect(parsePanelToTab({ type: 'seek', index: 1.5 })).toBeNull();
    expect(parsePanelToTab({ type: 'retry' })).toEqual({ type: 'retry' });
    expect(parsePanelToTab({ type: 'settings', settings: { autoPause: true } })).toEqual({
      type: 'settings',
      settings: { autoPause: true },
    });
    expect(parsePanelToTab({ type: 'settings', settings: { autoPause: 1 } })).toBeNull();
  });
});

describe('settings', () => {
  it('parses patches strictly and reads rows leniently', () => {
    expect(parseSettingsPatch({ showTranslation: false })).toEqual({ showTranslation: false });
    expect(parseSettingsPatch({ showTranslation: 'no' })).toBeNull();
    expect(parseSettingsPatch([])).toBeNull();
    expect(
      settingsFromRows([
        { key: 'autoPause', value: true },
        { key: 'showTranslation', value: 'broken' },
        { key: 'legacy', value: 1 },
      ]),
    ).toEqual({ ...DEFAULT_SETTINGS, autoPause: true });
  });
});
