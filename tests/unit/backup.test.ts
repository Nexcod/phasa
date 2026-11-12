import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { EXPLAIN_WORD } from '@/src/ai/prompts/explain-word';
import { createHandlers } from '@/src/background/handlers';
import {
  BACKUP_TABLES,
  NOT_BACKED_UP,
  addSummaries,
  emptySummary,
  importRequests,
  readBackup,
  type Backup,
  type SectionSummary,
} from '@/src/backup/format';
import { ankiText, csvText, type ExportEntry } from '@/src/backup/word-export';
import { PhasaDb } from '@/src/db';
import { SECRET_TABLES } from '@/src/db/schema';
import type { DictionarySource } from '@/src/dictionary/store';
import type { DictEntry, DictFile } from '@/src/dictionary/types';
import type { WordExplanation } from '@/src/messaging/ai';
import type { ServerEvent } from '@/src/messaging/protocol';
import type { RequestContext } from '@/src/messaging/server';
import { DEFAULT_SETTINGS } from '@/src/settings';
import type { ContextInput } from '@/src/vocab/types';

const PAGE: RequestContext = { origin: 'extension-page', tabId: undefined };
const opened: PhasaDb[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.delete()));
});

const entry = (thai: string, paiboon: string, gloss: string, extra: Partial<DictEntry> = {}) =>
  ({
    thai,
    senses: [{ pos: 'noun', glosses: [gloss] }],
    source: ['wiktionary'],
    romanization: { paiboon, rtgs: paiboon.replace(/[^\w-]/gu, '') },
    syllables: paiboon.split('-').map((roman) => ({ roman, tone: 'mid' as const })),
    ...extra,
  }) satisfies DictEntry;

const DICT: DictFile = {
  meta: { version: 'v1', builtAt: '2026-11-01', entries: 4, sources: [] },
  entries: [
    entry('ภาษา', 'paa-sǎa', 'language', { freqRank: 500 }),
    entry('ไทย', 'tai', 'Thai', { freqRank: 300 }),
    entry('เรียน', 'rian', 'to study'),
    entry('ผม', 'pǒm', 'I (male speaker)'),
  ],
};

function setup() {
  const db = new PhasaDb(`phasa-test-${crypto.randomUUID()}`);
  opened.push(db);
  const events: ServerEvent[] = [];
  const source: DictionarySource = {
    meta: () => Promise.resolve(DICT.meta),
    file: () => Promise.resolve(DICT),
  };
  let clock = 1_000_000;
  const handlers = createHandlers({
    db: () => db,
    swStartedAt: 0,
    dictionarySource: source,
    broadcast: (event) => events.push(event),
    appVersion: '1.2.3',
    now: () => clock++,
  });
  return { db, handlers, events };
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

const EXPLANATION: WordExplanation = {
  meaning: 'language',
  partOfSpeech: 'noun',
  romanization: 'paa-sǎa',
  syllables: [
    { thai: 'ภา', tone: 'mid' },
    { thai: 'ษา', tone: 'rising' },
  ],
  register: 'neutral',
  notes: null,
  exampleTh: 'ภาษาไทย',
  exampleEn: 'the Thai language',
  classifier: null,
};

const KEY = 'a'.repeat(64);

/** A database with something in every backed-up table. */
async function populate({ db, handlers }: ReturnType<typeof setup>) {
  await handlers['vocab/set']({ kind: 'word', thai: 'ภาษา', status: 2, context: CONTEXT }, PAGE);
  await handlers['vocab/set'](
    { kind: 'word', thai: 'ไทย', status: 'known', context: { ...CONTEXT, cueStartMs: 9000 } },
    PAGE,
  );
  await handlers['vocab/set']({ kind: 'word', thai: 'ผม', status: 'ignored' }, PAGE);
  await handlers['vocab/set'](
    { kind: 'phrase', thai: 'เรียนภาษา', status: 1, context: CONTEXT },
    PAGE,
  );
  await handlers['segrules/add']({ kind: 'merge', parts: ['ภาษา', 'ไทย'] }, PAGE);
  await handlers['settings/set']({ patch: { showRomanization: true, subtitleSize: 130 } }, PAGE);
  await db.videos.put({
    videoId: 'iH31BMKBEdU',
    title: 'A video',
    channel: 'A channel',
    trackKind: 'manual',
    durationSec: 120,
    analyzedAt: 5000,
    stats: {
      trackKey: '.th',
      features: {
        tokens: 100,
        unique: 40,
        outside1000: 0.1,
        outside3000: 0.05,
        outside5000: 0.02,
        outside10000: 0.01,
        speechRate: 4.2,
        avgCueLength: 6,
      },
      level: 'B1',
      coverage: 0.5,
      comprehension: 'too-hard',
      knownTokens: 50,
      newTokens: 50,
      unique: { known: 10, ignored: 1, learning: 2, new: 27 },
      newHighFreq: 12,
      newRare: 15,
    },
  });
  await db.aiCache.put({
    key: KEY,
    createdAt: 6000,
    value: {
      fn: EXPLAIN_WORD.name,
      model: 'gpt-6-luna',
      provider: 'chatgpt-plan',
      value: EXPLANATION,
    },
  });
  await db.credentials.put({ key: 'tokens', value: { refreshToken: 'secret-refresh-token' } });
}

/** What the options page does: read the file, send its sections one request at a time. */
async function restore(
  handlers: ReturnType<typeof setup>['handlers'],
  text: string,
  options = { settings: true, maxRows: 1000, maxChars: 4_000_000 },
): Promise<Record<string, SectionSummary>> {
  const read = readBackup(text);
  if (!read.ok) throw new Error(read.error);
  const totals: Record<string, SectionSummary> = {};
  for (const request of importRequests(read.file, options)) {
    const { summary } = await handlers['data/import'](request, PAGE);
    totals[request.section] = addSummaries(totals[request.section] ?? emptySummary(), summary);
  }
  return totals;
}

const withoutTime = (backup: Backup) => ({ ...backup, exportedAt: '' });

describe('backup', () => {
  it('names every table: backed up or left out with a reason', () => {
    const db = new PhasaDb(`phasa-test-${crypto.randomUUID()}`);
    opened.push(db);
    const named = [...BACKUP_TABLES, ...Object.keys(NOT_BACKED_UP)].sort();
    expect(named).toEqual(db.tables.map((table) => table.name).sort());
    // Secrets are never backed up (ADR 0014).
    for (const table of SECRET_TABLES) {
      expect(BACKUP_TABLES as readonly string[]).not.toContain(table);
      expect(NOT_BACKED_UP).toHaveProperty(table);
    }
  });

  it('exports every saved thing and never the credentials', async () => {
    const source = setup();
    await populate(source);
    const { backup } = await source.handlers['data/export']({}, PAGE);
    expect(backup).toMatchObject({ format: 'phasa-backup', version: 1, app: { version: '1.2.3' } });
    expect(backup.schemaVersion).toBeGreaterThanOrEqual(4);
    expect(backup.words.map((word) => [word.thai, word.status])).toEqual([
      ['ภาษา', 2],
      ['ไทย', 'known'],
      ['ผม', 'ignored'],
    ]);
    expect(backup.words[0]?.contexts).toEqual([
      { ...CONTEXT, createdAt: expect.any(Number) as number },
    ]);
    expect(backup.phrases).toHaveLength(1);
    expect(backup.segRules).toEqual([
      { kind: 'merge', parts: ['ภาษา', 'ไทย'], createdAt: expect.any(Number) as number },
    ]);
    expect(backup.settings).toEqual({
      ...DEFAULT_SETTINGS,
      showRomanization: true,
      subtitleSize: 130,
    });
    expect(backup.videos[0]?.stats?.level).toBe('B1');
    expect(backup.aiAnswers).toEqual([
      {
        key: KEY,
        createdAt: 6000,
        answer: expect.objectContaining({ value: EXPLANATION }) as unknown,
      },
    ]);
    const text = JSON.stringify(backup);
    expect(text).not.toContain('secret-refresh-token');
    expect(text).not.toContain('credentials');
  });

  it('restores everything into a fresh install', async () => {
    const source = setup();
    await populate(source);
    const { backup } = await source.handlers['data/export']({}, PAGE);

    const target = setup();
    const summaries = await restore(target.handlers, JSON.stringify(backup, null, 2), {
      settings: true,
      maxRows: 1, // one request per row: chunks merge like one import
      maxChars: 10,
    });
    expect(summaries.words).toEqual({ added: 3, updated: 0, unchanged: 0, skipped: 0 });
    expect(summaries.aiAnswers).toEqual({ added: 1, updated: 0, unchanged: 0, skipped: 0 });

    const { backup: restored } = await target.handlers['data/export']({}, PAGE);
    expect(withoutTime(restored)).toEqual(withoutTime(backup));
    expect(await target.db.credentials.count()).toBe(0);

    // Statuses, the phrase as one token and the boundary fix work again.
    const { statuses } = await target.handlers['vocab/statuses'](
      { words: ['ภาษา', 'ไทย', 'ผม', 'เรียนภาษา'] },
      PAGE,
    );
    expect(statuses).toEqual({ ภาษา: 2, ไทย: 'known', ผม: 'ignored', เรียนภาษา: 1 });
    const { tokens } = await target.handlers['thai/tokenize'](
      { texts: [{ text: 'ผมเรียนภาษาไทย' }] },
      PAGE,
    );
    expect(tokens[0]?.map((token) => token.text)).toEqual(['ผม', 'เรียนภาษา', 'ไทย']);
    expect(target.events).toContainEqual({ type: 'segmentation/changed' });
    expect(target.events).toContainEqual(
      expect.objectContaining({
        type: 'settings/changed',
        settings: expect.objectContaining({ subtitleSize: 130 }) as unknown,
      }),
    );
    expect(target.events.some((event) => event.type === 'vocab/changed')).toBe(true);
  });

  it('merges into existing words: the more advanced status wins, lines are added once', async () => {
    const source = setup();
    await populate(source);
    const { backup } = await source.handlers['data/export']({}, PAGE);

    const target = setup();
    // Known here, learning 2 in the backup: stays known. Learning 1 here, known there: known.
    await target.handlers['vocab/set'](
      { kind: 'word', thai: 'ภาษา', status: 'known', context: { ...CONTEXT, cueStartMs: 1 } },
      PAGE,
    );
    await target.handlers['vocab/set']({ kind: 'word', thai: 'ไทย', status: 1 }, PAGE);
    // Ignored here: an import never changes it.
    await target.handlers['vocab/set']({ kind: 'word', thai: 'เรียน', status: 'ignored' }, PAGE);
    target.events.length = 0;

    const first = await restore(target.handlers, JSON.stringify(backup));
    expect(first.words).toEqual({ added: 1, updated: 2, unchanged: 0, skipped: 0 });
    const { statuses } = await target.handlers['vocab/statuses'](
      { words: ['ภาษา', 'ไทย', 'เรียน', 'ผม'] },
      PAGE,
    );
    expect(statuses).toEqual({ ภาษา: 'known', ไทย: 'known', เรียน: 'ignored', ผม: 'ignored' });
    const { units } = await target.handlers['vocab/list']({ kind: 'word', query: 'ภาษา' }, PAGE);
    expect(units[0]?.contexts.map((context) => context.cueStartMs).sort()).toEqual([1, 2080]);
    expect(target.events).toContainEqual({
      type: 'vocab/changed',
      changes: expect.arrayContaining([
        { kind: 'word', thai: 'ไทย', status: 'known' },
        { kind: 'word', thai: 'ผม', status: 'ignored' },
      ]) as unknown,
    });

    // The same file again changes nothing.
    const again = await restore(target.handlers, JSON.stringify(backup));
    for (const summary of Object.values(again)) {
      expect(summary.added + summary.updated).toBe(0);
    }
  });

  it('leaves the settings alone unless asked to restore them', async () => {
    const source = setup();
    await populate(source);
    const { backup } = await source.handlers['data/export']({}, PAGE);
    const target = setup();
    const summaries = await restore(target.handlers, JSON.stringify(backup), {
      settings: false,
      maxRows: 1000,
      maxChars: 4_000_000,
    });
    expect(summaries.settings).toBeUndefined();
    expect(await target.handlers['settings/get']({}, PAGE)).toEqual(DEFAULT_SETTINGS);
  });

  it('skips invalid entries and keeps the rest', async () => {
    const target = setup();
    const file = JSON.stringify({
      format: 'phasa-backup',
      version: 1,
      words: [
        { thai: 'ภาษา', status: 3, contexts: [CONTEXT, { ...CONTEXT, videoId: 'bad id!' }] },
        { thai: 'hello', status: 'known' },
        { thai: 'ไทย', status: 'mastered' },
        'ภาษา',
      ],
      segRules: [{ kind: 'merge', parts: ['ภาษา'] }],
      settings: { subtitleSize: 1000, autoPause: true, unknownKey: 1 },
      videos: [{ videoId: 'iH31BMKBEdU', trackKind: 'manual', title: 'T', stats: { level: 'Z9' } }],
      aiAnswers: [
        {
          key: KEY,
          answer: { fn: 'explainWord', model: 'm', provider: 'chatgpt-plan', value: {} },
        },
        {
          key: 'b'.repeat(64),
          answer: { fn: 'rm -rf', model: 'm', provider: 'chatgpt-plan', value: {} },
        },
      ],
    });
    const summaries = await restore(target.handlers, file);
    expect(summaries.words).toEqual({ added: 1, updated: 0, unchanged: 0, skipped: 3 });
    expect(summaries.segRules?.skipped).toBe(1);
    expect(summaries.settings).toEqual({ added: 1, updated: 0, unchanged: 0, skipped: 2 });
    expect(summaries.aiAnswers).toEqual({ added: 0, updated: 0, unchanged: 0, skipped: 2 });
    const { units } = await target.handlers['vocab/list']({}, PAGE);
    expect(units.map((unit) => [unit.thai, unit.status, unit.contexts.length])).toEqual([
      ['ภาษา', 3, 1],
    ]);
    const video = await target.db.videos.get('iH31BMKBEdU');
    expect(video).toEqual({ videoId: 'iH31BMKBEdU', title: 'T', trackKind: 'manual' });
    expect((await target.handlers['settings/get']({}, PAGE)).autoPause).toBe(true);
  });

  it('keeps the newer of a merge and a split rule for the same text', async () => {
    const target = setup();
    await target.handlers['segrules/add']({ kind: 'split', parts: ['ภาษา', 'ไทย'] }, PAGE);
    const file = (createdAt: number) =>
      JSON.stringify({
        format: 'phasa-backup',
        version: 1,
        segRules: [{ kind: 'merge', parts: ['ภาษา', 'ไทย'], createdAt }],
      });
    expect((await restore(target.handlers, file(1))).segRules?.unchanged).toBe(1);
    expect(
      (await restore(target.handlers, file(Date.now() + 10_000_000_000))).segRules?.updated,
    ).toBe(1);
    const { rules } = await target.handlers['segrules/list']({}, PAGE);
    expect(rules.map((rule) => rule.key)).toEqual(['merge:ภาษา|ไทย']);
  });

  it('refuses files that are not a backup or from a newer version', () => {
    expect(readBackup('{')).toEqual({ ok: false, error: 'not-json' });
    expect(readBackup('{"words":[]}')).toEqual({ ok: false, error: 'not-backup' });
    expect(readBackup('{"format":"phasa-backup","version":99}')).toEqual({
      ok: false,
      error: 'newer-version',
    });
    const read = readBackup('\uFEFF{"format":"phasa-backup","version":1}');
    expect(read.ok && read.file.rows.words).toEqual([]);
  });

  it('checks the rows of an import request', async () => {
    const { handlers } = setup();
    await expect(
      handlers['data/import']({ section: 'credentials' as 'words', rows: [] }, PAGE),
    ).rejects.toThrow(/Invalid section/);
    await expect(
      handlers['data/import']({ section: 'words', rows: Array.from({ length: 1001 }) }, PAGE),
    ).rejects.toThrow(/Invalid rows/);
  });
});

describe('word lists', () => {
  it('exports the learning words for Anki with their line', async () => {
    const source = setup();
    await populate(source);
    const { text, count } = await source.handlers['data/export-words'](
      { format: 'anki', scope: 'learning' },
      PAGE,
    );
    expect(count).toBe(2);
    const lines = text.trimEnd().split('\n');
    expect(lines.slice(0, 4)).toEqual([
      '#separator:tab',
      '#html:true',
      '#columns:Thai\tRomanization\tMeaning\tSentence\tTranslation\tVideo link\tTags',
      '#tags column:7',
    ]);
    expect(lines[4]?.split('\t')).toEqual([
      'ภาษา',
      'paa-sǎa',
      '<i>noun</i> language',
      'ผมเรียน<b>ภาษา</b>ไทย',
      'I study Thai',
      '<a href="https://www.youtube.com/watch?v=iH31BMKBEdU&amp;t=2s">A video · 0:02</a>',
      'phasa phasa::learning-2',
    ]);
    // A phrase the dictionary lacks: its words with their meanings.
    expect(lines[5]?.split('\t').slice(0, 3)).toEqual([
      'เรียนภาษา',
      'rian-paa-sǎa',
      'เรียน — to study<br>ภาษา — language',
    ]);
    expect(lines[5]).toContain('phasa::phrase');

    const all = await source.handlers['data/export-words']({ format: 'csv', scope: 'all' }, PAGE);
    expect(all.count).toBe(4);
  });

  it('escapes fields for Anki and guards CSV cells', () => {
    const base: ExportEntry = {
      kind: 'word',
      thai: 'ภาษา',
      status: 'known',
      createdAt: Date.UTC(2026, 10, 12),
      romanization: 'paa-sǎa',
      meanings: [{ pos: 'noun', glosses: ['a <b>bold</b>\tclaim', 'x & y'] }],
      parts: [],
      context: {
        sentence: 'ภาษา "quoted"\nline',
        translation: '=HYPERLINK("evil")',
        videoId: 'iH31BMKBEdU',
        videoTitle: '+1, "best" video',
        cueStartMs: 61_000,
      },
    };
    const anki = ankiText([base]).split('\n')[4]?.split('\t') ?? [];
    expect(anki).toHaveLength(7);
    expect(anki[2]).toBe('<i>noun</i> a &lt;b&gt;bold&lt;/b&gt; claim; x &amp; y');
    expect(anki[3]).toBe('<b>ภาษา</b> &quot;quoted&quot; line');

    const csv = csvText([base]);
    expect(csv.startsWith('\uFEFFThai,Romanization,Meaning,Status,Type,')).toBe(true);
    const row = csv.split('\r\n')[1] ?? '';
    expect(row).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(row).toContain(`"'+1, ""best"" video"`);
    expect(row).toContain('"ภาษา ""quoted""\nline"');
    expect(row).toContain(',known,word,');
    expect(row.endsWith(',2026-11-12')).toBe(true);
  });
});
