import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHandlers } from '@/src/background/handlers';
import { PROCESSING_VERSION } from '@/src/captions/types';
import { PhasaDb } from '@/src/db';
import type { RequestContext } from '@/src/messaging/server';
import type { CaptionsProcessParams, ServerEvent } from '@/src/messaging/protocol';
import { DEFAULT_SETTINGS } from '@/src/settings';

const CONTENT: RequestContext = { origin: 'content-script', tabId: 3 };
const opened: PhasaDb[] = [];

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, '../fixtures/captions', name), 'utf8');
}

function setup() {
  const db = new PhasaDb(`phasa-test-${crypto.randomUUID()}`);
  opened.push(db);
  const events: ServerEvent[] = [];
  const handlers = createHandlers({
    db: () => db,
    swStartedAt: 0,
    broadcast: (event) => events.push(event),
    now: () => 1000,
  });
  return { db, handlers, events };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.delete()));
});

const video = { videoId: 'iH31BMKBEdU', title: 'Title', channel: 'Channel', durationSec: 1008 };

function processParams(): CaptionsProcessParams {
  return {
    video,
    items: [
      {
        ref: { vssId: 'a.th' },
        languageCode: 'th',
        kind: 'asr',
        body: fixture('iH31BMKBEdU.a.th.json3.json'),
      },
      {
        ref: { vssId: 'a.th', tlang: 'en' },
        languageCode: 'en',
        kind: 'asr',
        body: fixture('iH31BMKBEdU.a.th.tlang-en.json3.json'),
      },
    ],
  };
}

describe('captions/process and captions/get', () => {
  it('processes, caches by [videoId+vssId] and records the video', async () => {
    const { db, handlers } = setup();
    const result = await handlers['captions/process'](processParams(), CONTENT);
    expect(result.failed).toEqual([]);
    expect(result.tracks.map((track) => track.key)).toEqual(['a.th', 'a.th>en']);

    expect(await db.captions.get(['iH31BMKBEdU', 'a.th>en'])).toMatchObject({
      languageCode: 'en',
      trackKind: 'asr',
      translatedFrom: 'a.th',
      fetchedAt: 1000,
    });
    expect(await db.videos.get('iH31BMKBEdU')).toMatchObject({
      title: 'Title',
      trackKind: 'asr',
      durationSec: 1008,
    });

    const cached = await handlers['captions/get']({ videoId: 'iH31BMKBEdU' }, CONTENT);
    expect(cached.tracks).toEqual(result.tracks);
  });

  it('ignores rows from an older processing version', async () => {
    const { db, handlers } = setup();
    await handlers['captions/process'](processParams(), CONTENT);
    await db.captions.update(['iH31BMKBEdU', 'a.th'], {
      processingVersion: PROCESSING_VERSION - 1,
    });
    const cached = await handlers['captions/get']({ videoId: 'iH31BMKBEdU' }, CONTENT);
    expect(cached.tracks.map((track) => track.key)).toEqual(['a.th>en']);
  });

  it('reports unparsable bodies per track instead of failing the call', async () => {
    const { handlers } = setup();
    const params = processParams();
    params.items[1] = { ...params.items[1]!, body: '<html>blocked</html>' };
    const result = await handlers['captions/process'](params, CONTENT);
    expect(result.tracks.map((track) => track.key)).toEqual(['a.th']);
    expect(result.failed).toEqual([{ key: 'a.th>en', error: 'Unknown caption format' }]);
  });

  it('validates everything a content script sends', async () => {
    const { handlers } = setup();
    const bad: unknown[] = [
      { ...processParams(), video: { ...video, videoId: '../../etc' } },
      { ...processParams(), items: [] },
      {
        ...processParams(),
        items: [{ ref: { vssId: 'a.th' }, languageCode: 'th', kind: 'robot', body: '' }],
      },
      { video },
    ];
    for (const params of bad) {
      await expect(
        handlers['captions/process'](params as CaptionsProcessParams, CONTENT),
      ).rejects.toMatchObject({ code: 'bad_request' });
    }
    await expect(
      handlers['captions/get']({ videoId: 'no spaces allowed' }, CONTENT),
    ).rejects.toMatchObject({
      code: 'bad_request',
    });
  });
});

describe('settings', () => {
  it('returns defaults, stores validated patches and broadcasts the result', async () => {
    const { handlers, events } = setup();
    expect(await handlers['settings/get']({}, CONTENT)).toEqual(DEFAULT_SETTINGS);
    const next = await handlers['settings/set']({ patch: { autoPause: true } }, CONTENT);
    expect(next).toEqual({ ...DEFAULT_SETTINGS, autoPause: true });
    expect(events).toEqual([{ type: 'settings/changed', settings: next }]);
    expect(await handlers['settings/get']({}, CONTENT)).toEqual(next);
  });

  it('rejects unknown keys and wrong types', async () => {
    const { handlers } = setup();
    const spy = vi.fn();
    for (const patch of [{ autoPause: 'yes' }, { volume: 3 }, null]) {
      await Promise.resolve(handlers['settings/set']({ patch } as never, CONTENT)).catch(spy);
    }
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
