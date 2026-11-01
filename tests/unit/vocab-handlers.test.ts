import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHandlers } from '@/src/background/handlers';
import { PhasaDb } from '@/src/db';
import type { DictionarySource } from '@/src/dictionary/store';
import type { DictEntry, DictFile } from '@/src/dictionary/types';
import type { ServerEvent } from '@/src/messaging/protocol';
import type { RequestContext } from '@/src/messaging/server';
import type { ContextInput } from '@/src/vocab/types';

const CTX: RequestContext = { origin: 'content-script', tabId: 1 };
const opened: PhasaDb[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.delete()));
});

const entry = (thai: string, paiboon: string, gloss: string, extra: Partial<DictEntry> = {}) =>
  ({
    thai,
    senses: [{ pos: 'noun', glosses: [gloss] }],
    source: ['wiktionary'],
    romanization: { paiboon },
    syllables: paiboon.split('-').map((roman) => ({ roman, tone: 'mid' as const })),
    ...extra,
  }) satisfies DictEntry;

const DICT: DictFile = {
  meta: { version: 'v1', builtAt: '2026-11-01', entries: 7, sources: [] },
  entries: [
    entry('ภาษา', 'paa-sǎa', 'language', { freqRank: 500 }),
    entry('ไทย', 'tai', 'Thai', { freqRank: 300 }),
    entry('ไม่', 'mâi', 'not'),
    entry('มี', 'mii', 'to have'),
    entry('ไม่มี', 'mâi-mii', 'to not have', { parts: ['ไม่', 'มี'] }),
    entry('ไหม', 'mǎi', 'question particle'),
    entry('มั้ย', 'mái', 'alternative form of ไหม', {
      senses: [{ pos: 'particle', glosses: ['alternative form of ไหม'], altOf: 'ไหม' }],
    }),
  ],
};

function setup(version = 'v1', db = new PhasaDb(`phasa-test-${crypto.randomUUID()}`)) {
  opened.push(db);
  const events: ServerEvent[] = [];
  const file = vi.fn(() => Promise.resolve({ ...DICT, meta: { ...DICT.meta, version } }));
  const source: DictionarySource = {
    meta: () => Promise.resolve({ ...DICT.meta, version }),
    file,
  };
  let clock = 1000;
  const handlers = createHandlers({
    db: () => db,
    swStartedAt: 0,
    dictionarySource: source,
    broadcast: (event) => events.push(event),
    now: () => clock++,
  });
  return { db, handlers, events, file };
}

const CONTEXT: ContextInput = {
  videoId: 'iH31BMKBEdU',
  videoTitle: 'A video',
  channel: 'A channel',
  sentence: 'ผมเรียนภาษาไทย',
  sentenceTranslation: 'I study Thai',
  cueStartMs: 2080,
  cueEndMs: 4080,
};

describe('dictionary loading', () => {
  it('loads the packaged dictionary once per version', async () => {
    const first = setup('v1');
    await first.handlers['dict/lookup']({ words: ['ภาษา'] }, CTX);
    await first.handlers['dict/lookup']({ words: ['ไทย'] }, CTX);
    expect(first.file).toHaveBeenCalledTimes(1);
    expect(await first.db.dict.count()).toBe(DICT.entries.length);

    // A restarted service worker with the same version reads the snapshot instead.
    const again = setup('v1', first.db);
    await again.handlers['dict/lookup']({ words: ['ภาษา'] }, CTX);
    expect(again.file).not.toHaveBeenCalled();

    const updated = setup('v2', first.db);
    await updated.handlers['dict/lookup']({ words: ['ภาษา'] }, CTX);
    expect(updated.file).toHaveBeenCalledTimes(1);
  });
});

describe('dict/lookup', () => {
  it('returns the entry and its pronunciation', async () => {
    const { handlers } = setup();
    const { results } = await handlers['dict/lookup']({ words: ['ภาษา'] }, CTX);
    expect(results[0]?.entry?.senses[0]?.glosses).toEqual(['language']);
    expect(results[0]?.pronunciation).toMatchObject({ paiboon: 'paa-sǎa', source: 'dictionary' });
  });

  it('splits a compound the dictionary lacks and pronounces it from its parts', async () => {
    const { handlers } = setup();
    const { results } = await handlers['dict/lookup']({ words: ['ภาษาไทย'] }, CTX);
    expect(results[0]?.entry).toBeUndefined();
    expect(results[0]?.parts?.map((part) => part.thai)).toEqual(['ภาษา', 'ไทย']);
    expect(results[0]?.pronunciation).toMatchObject({ paiboon: 'paa-sǎa tai', source: 'compound' });
  });

  it('falls back to spelling rules and includes the main entry of an alternative form', async () => {
    const { handlers } = setup();
    const { results } = await handlers['dict/lookup']({ words: ['กิน', 'มั้ย'] }, CTX);
    expect(results[0]?.pronunciation).toMatchObject({ paiboon: 'gin', source: 'rules' });
    expect(results[1]?.main?.thai).toBe('ไหม');
  });

  it('rejects bad input', async () => {
    const { handlers } = setup();
    await expect(handlers['dict/lookup']({ words: [''] }, CTX)).rejects.toThrow(/Invalid word/);
    await expect(
      handlers['dict/lookup']({ words: 'ภาษา' as unknown as string[] }, CTX),
    ).rejects.toThrow(/Invalid word list/);
  });
});

describe('thai/tokenize', () => {
  it('splits compositional headwords and follows user rules', async () => {
    const { handlers, events } = setup();
    const before = await handlers['thai/tokenize']({ texts: [{ text: 'ไม่มีภาษาไทย' }] }, CTX);
    expect(before.tokens[0]?.map((token) => token.text)).toEqual(['ไม่', 'มี', 'ภาษา', 'ไทย']);

    await handlers['segrules/add']({ kind: 'merge', parts: ['ภาษา', 'ไทย'] }, CTX);
    expect(events).toContainEqual({ type: 'segmentation/changed' });
    const merged = await handlers['thai/tokenize']({ texts: [{ text: 'ไม่มีภาษาไทย' }] }, CTX);
    expect(merged.tokens[0]?.map((token) => token.text)).toEqual(['ไม่', 'มี', 'ภาษาไทย']);

    // The opposite rule replaces it.
    await handlers['segrules/add']({ kind: 'split', parts: ['ภาษา', 'ไทย'] }, CTX);
    const { rules } = await handlers['segrules/list']({}, CTX);
    expect(rules.map((rule) => rule.key)).toEqual(['split:ภาษา|ไทย']);
  });

  it('keeps a saved phrase as one token', async () => {
    const { handlers } = setup();
    await handlers['vocab/set']({ kind: 'phrase', thai: 'ภาษาไทย', status: 1 }, CTX);
    const { tokens } = await handlers['thai/tokenize']({ texts: [{ text: 'ภาษาไทย' }] }, CTX);
    expect(tokens[0]?.map((token) => token.text)).toEqual(['ภาษาไทย']);
  });

  it('validates hints', async () => {
    const { handlers } = setup();
    await expect(
      handlers['thai/tokenize']({ texts: [{ text: 'ไทย', hints: [9] }] }, CTX),
    ).rejects.toThrow(/Invalid hints/);
  });
});

describe('vocabulary', () => {
  it('saves a word with its context, replaces a context from the same cue, lists it', async () => {
    const { handlers, events } = setup();
    const { unit } = await handlers['vocab/set'](
      { kind: 'word', thai: 'ภาษา', status: 1, context: CONTEXT },
      CTX,
    );
    expect(unit).toMatchObject({
      thai: 'ภาษา',
      status: 1,
      gloss: 'language',
      romanization: 'paa-sǎa',
    });
    expect(unit.contexts).toEqual([{ ...CONTEXT, createdAt: expect.any(Number) as number }]);
    expect(events).toContainEqual({
      type: 'vocab/changed',
      changes: [{ kind: 'word', thai: 'ภาษา', status: 1 }],
    });

    const again = await handlers['vocab/set'](
      { kind: 'word', thai: 'ภาษา', status: 'known', context: { ...CONTEXT, sentence: 'edited' } },
      CTX,
    );
    expect(again.unit.status).toBe('known');
    expect(again.unit.contexts.map((context) => context.sentence)).toEqual(['edited']);

    const listed = await handlers['vocab/list']({ videoId: CONTEXT.videoId }, CTX);
    expect(listed.total).toBe(1);
    expect(listed.units[0]?.contexts[0]?.sentenceTranslation).toBe('I study Thai');
    expect((await handlers['vocab/list']({ videoId: 'other_video' }, CTX)).total).toBe(0);
  });

  it('reports statuses of saved units only and deletes with contexts', async () => {
    const { handlers, db } = setup();
    await handlers['vocab/set'](
      { kind: 'word', thai: 'ไทย', status: 'known', context: CONTEXT },
      CTX,
    );
    await handlers['vocab/set']({ kind: 'phrase', thai: 'ไม่ มี', status: 2 }, CTX);
    const { statuses } = await handlers['vocab/statuses'](
      { words: ['ไทย', 'ภาษา', 'ไม่ มี'] },
      CTX,
    );
    expect(statuses).toEqual({ ไทย: 'known', 'ไม่ มี': 2 });

    expect((await handlers['vocab/delete']({ kind: 'word', thai: 'ไทย' }, CTX)).deleted).toBe(true);
    expect(await db.contexts.count()).toBe(0);
    expect((await handlers['vocab/statuses']({ words: ['ไทย'] }, CTX)).statuses).toEqual({});
  });

  it('normalizes and validates what content scripts send', async () => {
    const { handlers } = setup();
    const { unit } = await handlers['vocab/set'](
      { kind: 'word', thai: ' \u0E01\u0E48\u0E35\u200B ', status: 1 },
      CTX,
    );
    expect(unit.thai).toBe('กี่');
    await expect(
      handlers['vocab/set']({ kind: 'word', thai: 'hello', status: 1 }, CTX),
    ).rejects.toThrow(/Invalid thai/);
    await expect(
      handlers['vocab/set']({ kind: 'word', thai: 'ไทย', status: 9 as unknown as 1 }, CTX),
    ).rejects.toThrow(/Invalid status/);
    await expect(
      handlers['vocab/set'](
        { kind: 'word', thai: 'ไทย', status: 1, context: { ...CONTEXT, videoId: '<script>' } },
        CTX,
      ),
    ).rejects.toThrow(/Invalid videoId/);
  });
});
