import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandlers } from '@/src/background/handlers';
import { PhasaDb } from '@/src/db';
import type { DictionarySource } from '@/src/dictionary/store';
import type { DictEntry, DictFile } from '@/src/dictionary/types';
import { MAX_EVENT_CHANGES, type ServerEvent } from '@/src/messaging/protocol';
import type { RequestContext } from '@/src/messaging/server';
import { COMMON_PARTICLES } from '@/src/vocab/particles';

const CTX: RequestContext = { origin: 'extension-page', tabId: undefined };
const VIDEO = 'iH31BMKBEdU';
const opened: PhasaDb[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.delete()));
});

const entry = (thai: string, gloss: string, extra: Partial<DictEntry> = {}): DictEntry => ({
  thai,
  senses: [{ glosses: [gloss] }],
  source: ['wiktionary'],
  ...extra,
});

/** Ranks come from the frequency list below, as in the build. */
const FREQ = ['ที่', 'ผม', 'ไทย', 'ไม่', 'มี', 'ไม่มี', 'ครับ', 'เรียน', 'ภาษา', 'กิน', 'ข้าว'];
const rankOf = (thai: string) => FREQ.indexOf(thai) + 1;

const DICT: DictFile = {
  meta: { version: 'v1', builtAt: '2026-11-01', entries: 0, sources: [] },
  entries: [
    entry('ที่', 'that', { freqRank: rankOf('ที่') }),
    entry('ผม', 'I (male)', { freqRank: rankOf('ผม') }),
    entry('ไทย', 'Thai', { freqRank: rankOf('ไทย') }),
    entry('ไม่', 'not', { freqRank: rankOf('ไม่') }),
    entry('มี', 'to have', { freqRank: rankOf('มี') }),
    entry('ไม่มี', 'to not have', { freqRank: rankOf('ไม่มี'), parts: ['ไม่', 'มี'] }),
    entry('ครับ', 'polite particle', { freqRank: rankOf('ครับ') }),
    entry('เรียน', 'to study', {
      freqRank: rankOf('เรียน'),
      romanization: { paiboon: 'rian' },
      syllables: [{ roman: 'rian', tone: 'mid' }],
    }),
    entry('ภาษา', 'language', { freqRank: rankOf('ภาษา') }),
    entry('กิน', 'to eat', { freqRank: rankOf('กิน') }),
    entry('ข้าว', 'rice', { freqRank: rankOf('ข้าว') }),
    entry('เชียงใหม่', 'Chiang Mai', { isProperNoun: true }),
  ],
};

/** json3 like the player's: one event per cue. */
function json3(cues: { startMs: number; endMs: number; text: string }[]): string {
  return JSON.stringify({
    events: cues.map((cue) => ({
      tStartMs: cue.startMs,
      dDurationMs: cue.endMs - cue.startMs,
      segs: [{ utf8: cue.text }],
    })),
  });
}

const THAI_CUES = [
  { startMs: 0, endMs: 3000, text: 'ผม เรียน ภาษา ไทย ครับ' },
  { startMs: 3000, endMs: 6000, text: 'ผม กิน ข้าว ที่ เชียงใหม่ ครับ' },
  { startMs: 6000, endMs: 9000, text: 'ไม่มี ข้าว ครับ' },
];
const ENGLISH_CUES = [
  { startMs: 0, endMs: 3000, text: 'I study Thai.' },
  { startMs: 3000, endMs: 6000, text: 'I eat rice in Chiang Mai.' },
  { startMs: 6000, endMs: 9000, text: 'There is no rice.' },
];

async function setup() {
  const db = new PhasaDb(`phasa-test-${crypto.randomUUID()}`);
  opened.push(db);
  const events: ServerEvent[] = [];
  const source: DictionarySource = {
    meta: () => Promise.resolve(DICT.meta),
    file: () => Promise.resolve(DICT),
  };
  let clock = 1000;
  const handlers = createHandlers({
    db: () => db,
    swStartedAt: 0,
    dictionarySource: source,
    frequencySource: () => Promise.resolve({ meta: { version: 'f1' }, words: FREQ }),
    broadcast: (event) => events.push(event),
    now: () => clock++,
  });
  await handlers['captions/process'](
    {
      video: { videoId: VIDEO, title: 'A video', channel: 'A channel', durationSec: 9 },
      items: [
        { ref: { vssId: 'a.th' }, languageCode: 'th', kind: 'asr', body: json3(THAI_CUES) },
        {
          ref: { vssId: 'a.th', tlang: 'en' },
          languageCode: 'en',
          kind: 'asr',
          body: json3(ENGLISH_CUES),
        },
      ],
    },
    CTX,
  );
  const analyze = async () => {
    const { analysis } = await handlers['analysis/video'](
      { videoId: VIDEO, trackKey: 'a.th' },
      CTX,
    );
    if (!analysis) throw new Error('no analysis');
    return analysis;
  };
  return { db, handlers, events, analyze };
}

describe('analysis/video', () => {
  it('analyzes the cached Thai track and stores a snapshot', async () => {
    const { db, analyze } = await setup();
    const analysis = await analyze();
    // ผม เรียน ภาษา ไทย ครับ | ผม กิน ข้าว ที่ (เชียงใหม่: a name) ครับ | ไม่ มี ข้าว ครับ
    expect(analysis.features.tokens).toBe(14);
    expect(analysis.features.unique).toBe(10);
    expect(analysis.coverage).toBe(0);
    expect(analysis.unique.new).toBe(10);
    expect(analysis.newTokens).toBe(14);
    expect(analysis.newCues).toEqual([0, 1, 2]);
    // ครับ ×3 (rank 7) and ผม ×2 (rank 2) come first; the compositional ไม่มี is two words.
    expect(analysis.topNew.slice(0, 2).map((word) => word.thai)).toEqual(['ครับ', 'ผม']);
    expect(analysis.topNew.map((word) => word.thai)).toContain('ไม่');
    expect(analysis.topNew.map((word) => word.thai)).not.toContain('ไม่มี');
    expect(analysis.topNew.find((word) => word.thai === 'เรียน')).toMatchObject({
      gloss: 'to study',
      romanization: 'rian',
      rank: rankOf('เรียน'),
    });
    expect(analysis.analysisMs).toBeGreaterThanOrEqual(0);

    const video = await db.videos.get(VIDEO);
    expect(video?.stats).toMatchObject({ trackKey: 'a.th', coverage: 0, newTokens: 14 });
    expect(video?.analyzedAt).toBeGreaterThan(0);
  });

  it('follows status changes at once', async () => {
    const { handlers, analyze } = await setup();
    await analyze();
    await handlers['vocab/set']({ kind: 'word', thai: 'ครับ', status: 'known' }, CTX);
    await handlers['vocab/set']({ kind: 'word', thai: 'ผม', status: 'ignored' }, CTX);
    await handlers['vocab/set']({ kind: 'word', thai: 'เรียน', status: 2 }, CTX);
    const analysis = await analyze();
    expect(analysis.knownTokens).toBe(5);
    expect(analysis.coverage).toBeCloseTo(5 / 14);
    expect(analysis.unique).toEqual({ known: 1, ignored: 1, learning: 1, new: 7 });
  });

  it('is null for a track that is not cached', async () => {
    const { handlers } = await setup();
    const result = await handlers['analysis/video'](
      { videoId: 'aaaaaaaaaaa', trackKey: '.th' },
      CTX,
    );
    expect(result.analysis).toBeNull();
    const english = await handlers['analysis/video']({ videoId: VIDEO, trackKey: 'a.th>en' }, CTX);
    expect(english.analysis).toBeNull();
  });

  it('rebuilds the profile when word boundaries change', async () => {
    const { handlers, analyze } = await setup();
    expect((await analyze()).topNew.map((word) => word.thai)).toContain('ไม่');
    // A user rule keeps ไม่มี whole: the cached profile must not survive it.
    await handlers['segrules/add']({ kind: 'merge', parts: ['ไม่', 'มี'] }, CTX);
    const analysis = await analyze();
    expect(analysis.topNew.map((word) => word.thai)).toContain('ไม่มี');
    expect(analysis.features.tokens).toBe(13);
  });

  it('validates its parameters', async () => {
    const { handlers } = await setup();
    await expect(
      handlers['analysis/video']({ videoId: 'x', trackKey: 'a.th' }, CTX),
    ).rejects.toThrow(/videoId/);
    await expect(handlers['analysis/video']({ videoId: VIDEO, trackKey: '' }, CTX)).rejects.toThrow(
      /trackKey/,
    );
  });
});

describe('analysis/mark-new', () => {
  it('adds the top words to learning with the line they first occur in', async () => {
    const { db, handlers, events, analyze } = await setup();
    const { changed } = await handlers['analysis/mark-new'](
      { videoId: VIDEO, trackKey: 'a.th', englishKey: 'a.th>en', status: 1, top: 2 },
      CTX,
    );
    expect(changed).toBe(2);
    expect(events.at(-1)).toEqual({
      type: 'vocab/changed',
      changes: [
        { kind: 'word', thai: 'ครับ', status: 1 },
        { kind: 'word', thai: 'ผม', status: 1 },
      ],
    });
    const word = await db.words.where('thai').equals('ครับ').first();
    const [context] = await db.contexts.where('wordId').equals(word!.id).toArray();
    expect(context).toMatchObject({
      videoId: VIDEO,
      videoTitle: 'A video',
      channel: 'A channel',
      sentence: THAI_CUES[0]!.text,
      sentenceTranslation: 'I study Thai.',
      cueStartMs: 0,
    });
    expect((await analyze()).unique.learning).toBe(2);
  });

  it('marks every remaining new word known, leaving saved ones alone', async () => {
    const { db, handlers, analyze } = await setup();
    await handlers['vocab/set']({ kind: 'word', thai: 'เรียน', status: 3 }, CTX);
    const { changed } = await handlers['analysis/mark-new'](
      { videoId: VIDEO, trackKey: 'a.th', status: 'known' },
      CTX,
    );
    expect(changed).toBe(9);
    expect((await db.words.where('thai').equals('เรียน').first())?.status).toBe(3);
    const analysis = await analyze();
    expect(analysis.unique).toEqual({ known: 9, ignored: 0, learning: 1, new: 0 });
    expect(analysis.coverage).toBeCloseTo(13 / 14);
    expect(analysis.newCues).toEqual([]);
  });

  it('marks given words only if they are new in the video', async () => {
    const { handlers } = await setup();
    const { changed } = await handlers['analysis/mark-new'](
      { videoId: VIDEO, trackKey: 'a.th', status: 'known', words: ['ข้าว', 'อร่อย'] },
      CTX,
    );
    expect(changed).toBe(1);
  });

  it('refuses a status of new and an uncached track', async () => {
    const { handlers } = await setup();
    await expect(
      handlers['analysis/mark-new']({ videoId: VIDEO, trackKey: 'a.th', status: 'new' }, CTX),
    ).rejects.toThrow(/status/);
    await expect(
      handlers['analysis/mark-new'](
        { videoId: 'aaaaaaaaaaa', trackKey: '.th', status: 'known' },
        CTX,
      ),
    ).rejects.toThrow(/cached/);
  });
});

describe('vocab/bulk-set', () => {
  it('new-only leaves saved words alone; advance moves learning words to known', async () => {
    const { db, handlers } = await setup();
    await handlers['vocab/set']({ kind: 'word', thai: 'กิน', status: 2 }, CTX);
    await handlers['vocab/set']({ kind: 'word', thai: 'ข้าว', status: 'ignored' }, CTX);

    const onlyNew = await handlers['vocab/bulk-set'](
      { words: ['กิน', 'ข้าว', 'ผม'], status: 'known', mode: 'new-only' },
      CTX,
    );
    expect(onlyNew).toEqual({ changed: 1, words: 3 });
    expect((await db.words.where('thai').equals('กิน').first())?.status).toBe(2);

    const advance = await handlers['vocab/bulk-set'](
      { words: ['กิน', 'ข้าว', 'ผม'], status: 'known', mode: 'advance' },
      CTX,
    );
    // กิน moves forward; ข้าว stays ignored; ผม is known already.
    expect(advance.changed).toBe(1);
    expect((await db.words.where('thai').equals('กิน').first())?.status).toBe('known');
    expect((await db.words.where('thai').equals('ข้าว').first())?.status).toBe('ignored');
  });

  it('splits list entries into words with split', async () => {
    const { db, handlers } = await setup();
    const result = await handlers['vocab/bulk-set'](
      {
        words: ['ไม่มี', 'ผม เรียน', 'hello', '  ภาษา​'],
        status: 'known',
        mode: 'advance',
        split: true,
      },
      CTX,
    );
    expect(result).toEqual({ changed: 5, words: 5 });
    expect((await db.words.toArray()).map((row) => row.thai).sort()).toEqual(
      ['ผม', 'ภาษา', 'มี', 'เรียน', 'ไม่'].sort(),
    );
  });

  it('accepts whole sentences when splitting', async () => {
    const { handlers } = await setup();
    const sentence = `${'ผม กิน ข้าว '.repeat(20)}ครับ`;
    expect(sentence.length).toBeGreaterThan(120);
    const result = await handlers['vocab/bulk-set'](
      { words: [sentence], status: 'known', mode: 'advance', split: true },
      CTX,
    );
    expect(result).toEqual({ changed: 4, words: 4 });
    await expect(
      handlers['vocab/bulk-set']({ words: [sentence], status: 'known', mode: 'advance' }, CTX),
    ).rejects.toThrow(/word/);
  });

  it('skips invalid entries without split', async () => {
    const { handlers } = await setup();
    const result = await handlers['vocab/bulk-set'](
      { words: ['hello', 'ผม'], status: 'known', mode: 'new-only' },
      CTX,
    );
    expect(result).toEqual({ changed: 1, words: 1 });
  });

  it('asks to reload instead of listing too many changes', async () => {
    const { handlers, events } = await setup();
    const words = Array.from(
      { length: MAX_EVENT_CHANGES + 1 },
      (_, i) =>
        `ก${'า'.repeat(1)}${String.fromCharCode(0x0e01 + (i % 40))}${String.fromCharCode(0x0e01 + Math.floor(i / 40))}`,
    );
    const { changed } = await handlers['vocab/bulk-set'](
      { words, status: 'known', mode: 'new-only' },
      CTX,
    );
    expect(changed).toBe(MAX_EVENT_CHANGES + 1);
    expect(events.at(-1)).toEqual({ type: 'vocab/changed', changes: [], reload: true });
  });

  it('validates status and mode', async () => {
    const { handlers } = await setup();
    await expect(
      handlers['vocab/bulk-set']({ words: ['ผม'], status: 'new', mode: 'new-only' }, CTX),
    ).rejects.toThrow(/status/);
    await expect(
      handlers['vocab/bulk-set'](
        { words: ['ผม'], status: 'known', mode: 'everything' as 'advance' },
        CTX,
      ),
    ).rejects.toThrow(/mode/);
  });
});

describe('onboarding', () => {
  it('offers the most frequent words that are one unit in the subtitles', async () => {
    const { handlers } = await setup();
    await handlers['vocab/set']({ kind: 'word', thai: 'ไทย', status: 'known' }, CTX);
    const { words } = await handlers['vocab/frequent']({ count: 100 }, CTX);
    // ไม่มี is compositional: it never occurs as a word, so it is left out.
    expect(words.map((word) => word.thai)).toEqual(FREQ.filter((word) => word !== 'ไม่มี'));
    expect(words[0]).toEqual({ thai: 'ที่', rank: 1, gloss: 'that' });
    expect(words.find((word) => word.thai === 'ไทย')?.status).toBe('known');
    expect(words.find((word) => word.thai === 'ครับ')?.rank).toBe(rankOf('ครับ'));
    await expect(handlers['vocab/frequent']({ count: 7 }, CTX)).rejects.toThrow(/count/);
  });

  it('counts saved words by status', async () => {
    const { handlers } = await setup();
    await handlers['vocab/bulk-set'](
      { words: [...COMMON_PARTICLES], status: 'known', mode: 'new-only' },
      CTX,
    );
    await handlers['vocab/set']({ kind: 'word', thai: 'กิน', status: 2 }, CTX);
    await handlers['vocab/set']({ kind: 'phrase', thai: 'กินข้าว', status: 1 }, CTX);
    expect(await handlers['vocab/counts']({}, CTX)).toEqual({
      known: COMMON_PARTICLES.length,
      learning: 1,
      ignored: 0,
      phrases: 1,
    });
  });
});
