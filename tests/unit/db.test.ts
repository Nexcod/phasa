import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dexie } from 'dexie';
import { evictCaptions } from '@/src/background/captions';
import { createHandlers } from '@/src/background/handlers';
import { PhasaDb, SCHEMA_STEPS, SCHEMA_VERSION, assertExtensionOrigin } from '@/src/db';

const opened: PhasaDb[] = [];

function freshDb(): PhasaDb {
  const db = new PhasaDb(`phasa-test-${crypto.randomUUID()}`);
  opened.push(db);
  return db;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(opened.splice(0).map((db) => db.delete()));
});

describe('schema', () => {
  it('has strictly increasing versions', () => {
    const versions = SCHEMA_STEPS.map((step) => step.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(SCHEMA_VERSION).toBe(versions.at(-1));
  });

  it('opens with every table from docs/plan.md §9', async () => {
    const db = freshDb();
    await db.open();
    expect(db.tables.map((table) => table.name).sort()).toEqual(
      [
        'aiCache',
        'captions',
        'contexts',
        'credentials',
        'dict',
        'meta',
        'phrases',
        'segRules',
        'settings',
        'videos',
        'words',
      ].sort(),
    );
    expect(db.verno).toBe(SCHEMA_VERSION);
  });

  it('enforces unique words by normalized thai', async () => {
    const db = freshDb();
    const now = Date.now();
    await db.words.add({ thai: 'น้ำ', status: 1, createdAt: now, updatedAt: now });
    await expect(
      db.words.add({ thai: 'น้ำ', status: 'known', createdAt: now, updatedAt: now }),
    ).rejects.toThrow();
  });

  it('keys caption tracks by [videoId+vssId]', async () => {
    const db = freshDb();
    const row = {
      videoId: 'v1',
      languageCode: 'th',
      trackKind: 'asr' as const,
      cues: [],
      fetchedAt: 0,
      usedAt: 0,
      processingVersion: 1,
    };
    await db.captions.put({ ...row, vssId: 'a.th' });
    await db.captions.put({ ...row, vssId: '.th' });
    await db.captions.put({ ...row, vssId: 'a.th', fetchedAt: 1 });
    expect(await db.captions.where('videoId').equals('v1').count()).toBe(2);
    expect((await db.captions.get(['v1', 'a.th']))?.fetchedAt).toBe(1);
  });
});

describe('captions cache', () => {
  const track = (videoId: string, vssId: string, usedAt: number) => ({
    videoId,
    vssId,
    languageCode: 'th',
    trackKind: 'manual' as const,
    cues: [],
    fetchedAt: usedAt,
    usedAt,
    processingVersion: 1,
  });

  it('migrates v3 rows: last used = fetched', async () => {
    const name = `phasa-test-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    for (const step of SCHEMA_STEPS.filter((s) => s.version <= 3)) {
      old.version(step.version).stores(step.stores);
    }
    await old.table('captions').put({ ...track('v1', '.th', 0), fetchedAt: 42, usedAt: undefined });
    old.close();
    const db = new PhasaDb(name);
    opened.push(db);
    expect((await db.captions.get(['v1', '.th']))?.usedAt).toBe(42);
  });

  it('keeps the most recently used videos', async () => {
    const db = freshDb();
    await db.captions.bulkPut([
      track('oldVideo', '.th', 1),
      track('oldVideo', '.th>en', 1),
      track('midVideo', '.th', 2),
      track('newVideo', 'a.th', 3),
      track('newVideo', 'a.th>en', 3),
    ]);
    expect(await evictCaptions(db, 2)).toBe(1);
    expect((await db.captions.toArray()).map((row) => row.videoId).sort()).toEqual([
      'midVideo',
      'newVideo',
      'newVideo',
    ]);
    // Watching a video again moves it to the front.
    const handlers = createHandlers({ db: () => db, swStartedAt: 0, now: () => 10 });
    await handlers['captions/get']({ videoId: 'midVideo' }, { origin: 'content-script', tabId: 1 });
    expect(await evictCaptions(db, 1)).toBe(1);
    expect((await db.captions.toArray()).map((row) => row.videoId)).toEqual(['midVideo']);
  });
});

describe('assertExtensionOrigin', () => {
  it('refuses to open the database from a web origin (content script)', () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    expect(() => assertExtensionOrigin()).toThrow(/extension-origin/);
  });

  it('allows extension pages and the service worker', () => {
    vi.stubGlobal('location', { protocol: 'chrome-extension:' });
    expect(() => assertExtensionOrigin()).not.toThrow();
  });
});

describe('db/info handler', () => {
  it('reports the schema version and per-table counts', async () => {
    const db = freshDb();
    const handlers = createHandlers({ db: () => db, swStartedAt: 0 });
    await db.settings.put({ key: 'romanization', value: 'paiboon' });
    const info = await handlers['db/info']({}, { origin: 'extension-page', tabId: undefined });
    expect(info.schemaVersion).toBe(SCHEMA_VERSION);
    expect(info.counts).toMatchObject({ settings: 1, words: 0 });
  });
});
