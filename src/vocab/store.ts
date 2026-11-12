/**
 * Saved words, phrases, their contexts and segmentation rules in IndexedDB
 * (docs/plan.md §9). Service worker only; inputs come from content scripts
 * and are validated here.
 */
import type { PhasaDb } from '../db/db';
import type { ContextRow, PhraseRow, SegRuleRow, WordRow } from '../db/types';
import type { DictEntry } from '../dictionary/types';
import { RpcFailure } from '../messaging/protocol';
import { normalizeThai } from '../thai/normalize';
import {
  isWordStatus,
  segRuleKey,
  type BulkMode,
  type ContextInput,
  type SavedContext,
  type SavedUnit,
  type SegRule,
  type SegRuleKind,
  type UnitKind,
  type VocabChange,
  type VocabCounts,
  type WordStatus,
} from './types';

export const MAX_UNIT_CHARS = 120;
const MAX_SENTENCE_CHARS = 1000;
const THAI = /[\u0E01-\u0E5B]/u;

function badRequest(message: string): never {
  throw new RpcFailure('bad_request', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseKind(value: unknown): UnitKind {
  if (value !== 'word' && value !== 'phrase') badRequest('Invalid kind');
  return value;
}

/** The stored form of a word or phrase: normalized, Thai, bounded. */
export function unitKey(value: unknown): string {
  if (typeof value !== 'string') badRequest('Invalid thai');
  const text = normalizeThai(value).text;
  if (text === '' || text.length > MAX_UNIT_CHARS || !THAI.test(text)) badRequest('Invalid thai');
  return text;
}

export function parseStatus(value: unknown): WordStatus {
  if (!isWordStatus(value)) badRequest('Invalid status');
  return value;
}

const text = (value: unknown, max: number, field: string): string => {
  if (typeof value !== 'string') badRequest(`Invalid ${field}`);
  return value.slice(0, max);
};

const time = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    badRequest(`Invalid ${field}`);
  return Math.round(value);
};

export function parseContext(value: unknown): ContextInput {
  if (!isRecord(value)) badRequest('Invalid context');
  if (typeof value.videoId !== 'string' || !/^[\w-]{6,20}$/u.test(value.videoId)) {
    badRequest('Invalid videoId');
  }
  const context: ContextInput = {
    videoId: value.videoId,
    videoTitle: text(value.videoTitle, 500, 'videoTitle'),
    sentence: text(value.sentence, MAX_SENTENCE_CHARS, 'sentence'),
    cueStartMs: time(value.cueStartMs, 'cueStartMs'),
    cueEndMs: time(value.cueEndMs, 'cueEndMs'),
  };
  if (value.channel !== undefined) context.channel = text(value.channel, 300, 'channel');
  if (value.sentenceTranslation !== undefined) {
    context.sentenceTranslation = text(
      value.sentenceTranslation,
      MAX_SENTENCE_CHARS,
      'translation',
    );
  }
  return context;
}

function tableOf(db: PhasaDb, kind: UnitKind) {
  return kind === 'word' ? db.words : db.phrases;
}

function toSavedContext(row: ContextRow): SavedContext {
  const context: SavedContext = {
    videoId: row.videoId,
    videoTitle: row.videoTitle,
    sentence: row.sentence,
    cueStartMs: row.cueStartMs,
    cueEndMs: row.cueEndMs,
    createdAt: row.createdAt,
  };
  if (row.channel !== undefined) context.channel = row.channel;
  if (row.sentenceTranslation !== undefined) context.sentenceTranslation = row.sentenceTranslation;
  return context;
}

async function contextsOf(db: PhasaDb, kind: UnitKind, id: number): Promise<ContextRow[]> {
  const rows = await db.contexts
    .where(kind === 'word' ? 'wordId' : 'phraseId')
    .equals(id)
    .toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

function summary(entry: DictEntry | undefined): Pick<SavedUnit, 'gloss' | 'romanization'> {
  const out: Pick<SavedUnit, 'gloss' | 'romanization'> = {};
  const gloss = entry?.senses[0]?.glosses[0];
  if (gloss) out.gloss = gloss;
  if (entry?.romanization?.paiboon) out.romanization = entry.romanization.paiboon;
  return out;
}

function toSavedUnit(
  kind: UnitKind,
  row: WordRow | PhraseRow,
  contexts: ContextRow[],
  entry?: DictEntry,
): SavedUnit {
  return {
    kind,
    thai: row.thai,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...summary(entry),
    contexts: contexts.map(toSavedContext),
  };
}

export interface SetInput {
  kind: UnitKind;
  thai: string;
  status: WordStatus;
  context?: ContextInput;
}

/** Creates or updates a unit; a context from the same cue replaces the earlier one. */
export async function setUnit(db: PhasaDb, input: SetInput, now: number): Promise<SavedUnit> {
  const table = tableOf(db, input.kind);
  return db.transaction('rw', table, db.contexts, async () => {
    const existing = await table.where('thai').equals(input.thai).first();
    let id: number;
    if (existing) {
      id = existing.id;
      await table.update(id, { status: input.status, updatedAt: now });
    } else {
      id = await table.add({
        thai: input.thai,
        status: input.status,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (input.context) {
      const owner = input.kind === 'word' ? { wordId: id } : { phraseId: id };
      const same = (await contextsOf(db, input.kind, id)).find(
        (row) =>
          row.videoId === input.context?.videoId && row.cueStartMs === input.context.cueStartMs,
      );
      if (same) await db.contexts.delete(same.id);
      await db.contexts.add({ ...input.context, ...owner, createdAt: now });
    }
    const row = await table.get(id);
    if (!row) throw new Error('Saved row vanished');
    return toSavedUnit(input.kind, row, await contextsOf(db, input.kind, id));
  });
}

export async function deleteUnit(db: PhasaDb, kind: UnitKind, thai: string): Promise<boolean> {
  const table = tableOf(db, kind);
  return db.transaction('rw', table, db.contexts, async () => {
    const row = await table.where('thai').equals(thai).first();
    if (!row) return false;
    await db.contexts
      .where(kind === 'word' ? 'wordId' : 'phraseId')
      .equals(row.id)
      .delete();
    await table.delete(row.id);
    return true;
  });
}

const PROGRESS: Readonly<Record<string, number>> = {
  new: 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  known: 5,
};

export function bulkReplaces(
  current: WordStatus | undefined,
  target: WordStatus,
  mode: BulkMode,
): boolean {
  if (current === undefined || current === 'new') return target !== 'new';
  if (mode === 'new-only' || current === 'ignored' || target === 'ignored') return false;
  return (PROGRESS[String(target)] ?? 0) > (PROGRESS[String(current)] ?? 0);
}

/** Sets the status of many words at once, without contexts. Returns what changed. */
export async function bulkSetWords(
  db: PhasaDb,
  words: readonly string[],
  status: WordStatus,
  mode: BulkMode,
  now: number,
): Promise<VocabChange[]> {
  const unique = [...new Set(words)];
  return db.transaction('rw', db.words, async () => {
    const existing = new Map(
      (await db.words.where('thai').anyOf(unique).toArray()).map((row) => [row.thai, row]),
    );
    const added: Omit<WordRow, 'id'>[] = [];
    const updated: { key: number; changes: Partial<WordRow> }[] = [];
    const changes: VocabChange[] = [];
    for (const thai of unique) {
      const row = existing.get(thai);
      if (!bulkReplaces(row?.status, status, mode)) continue;
      if (row) updated.push({ key: row.id, changes: { status, updatedAt: now } });
      else added.push({ thai, status, createdAt: now, updatedAt: now });
      changes.push({ kind: 'word', thai, status });
    }
    if (added.length > 0) await db.words.bulkAdd(added);
    if (updated.length > 0) await db.words.bulkUpdate(updated);
    return changes;
  });
}

/** Saved words by status, and saved phrases. */
export async function vocabCounts(db: PhasaDb): Promise<VocabCounts> {
  const [known, learning, ignored, phrases] = await Promise.all([
    db.words.where('status').equals('known').count(),
    db.words.where('status').anyOf([1, 2, 3, 4]).count(),
    db.words.where('status').equals('ignored').count(),
    db.phrases.count(),
  ]);
  return { known, learning, ignored, phrases };
}

/** Statuses of saved words and phrases among `words`; unsaved ones are new and left out. */
export async function statusesOf(
  db: PhasaDb,
  words: readonly string[],
): Promise<Record<string, WordStatus>> {
  const unique = [...new Set(words)];
  const [wordRows, phraseRows] = await Promise.all([
    db.words.where('thai').anyOf(unique).toArray(),
    db.phrases.where('thai').anyOf(unique).toArray(),
  ]);
  const statuses: Record<string, WordStatus> = {};
  for (const row of [...phraseRows, ...wordRows]) {
    if (row.status !== 'new') statuses[row.thai] = row.status;
  }
  return statuses;
}

export interface ListQuery {
  kind?: UnitKind;
  videoId?: string;
  query?: string;
  limit: number;
  offset: number;
}

export async function listUnits(
  db: PhasaDb,
  query: ListQuery,
  lookup: (words: string[]) => Promise<Map<string, DictEntry>>,
): Promise<{ units: SavedUnit[]; total: number }> {
  const kinds: UnitKind[] = query.kind ? [query.kind] : ['word', 'phrase'];
  let rows: { kind: UnitKind; row: WordRow | PhraseRow }[] = [];
  let total: number | undefined;
  if (!query.query && !query.videoId) {
    // The usual list: only the page's rows, from the `updatedAt` index. Onboarding and imports
    // save thousands of known words, and every status change reloads the list.
    const take = query.offset + query.limit;
    total = 0;
    for (const kind of kinds) {
      const table = tableOf(db, kind);
      total += await table.count();
      for (const row of await table.orderBy('updatedAt').reverse().limit(take).toArray()) {
        rows.push({ kind, row });
      }
    }
  } else {
    for (const kind of kinds) {
      for (const row of await tableOf(db, kind).toArray()) rows.push({ kind, row });
    }
  }
  if (query.query) rows = rows.filter(({ row }) => row.thai.includes(query.query ?? ''));
  if (query.videoId) {
    const inVideo = await db.contexts.where('videoId').equals(query.videoId).toArray();
    const wordIds = new Set(inVideo.flatMap((c) => (c.wordId === undefined ? [] : [c.wordId])));
    const phraseIds = new Set(
      inVideo.flatMap((c) => (c.phraseId === undefined ? [] : [c.phraseId])),
    );
    rows = rows.filter(({ kind, row }) => (kind === 'word' ? wordIds : phraseIds).has(row.id));
  }
  rows.sort((a, b) => b.row.updatedAt - a.row.updatedAt);
  const page = rows.slice(query.offset, query.offset + query.limit);
  const entries = await lookup(page.map(({ row }) => row.thai));
  const units = await Promise.all(
    page.map(async ({ kind, row }) =>
      toSavedUnit(kind, row, await contextsOf(db, kind, row.id), entries.get(row.thai)),
    ),
  );
  return { units, total: total ?? rows.length };
}

/** Saved phrases written without spaces: the tokenizer keeps them as one unit (ADR 0005). */
export async function phraseUnits(db: PhasaDb): Promise<string[]> {
  return (await db.phrases.toArray()).map((row) => row.thai).filter((thai) => !thai.includes(' '));
}

function toSegRule(row: SegRuleRow): SegRule {
  return { key: row.key, kind: row.kind, parts: row.parts, createdAt: row.createdAt };
}

export function parseSegRule(
  kind: unknown,
  parts: unknown,
): { kind: SegRuleKind; parts: string[] } {
  if (kind !== 'merge' && kind !== 'split') badRequest('Invalid rule kind');
  if (!Array.isArray(parts) || parts.length < 2 || parts.length > 8) badRequest('Invalid parts');
  const clean = (parts as unknown[]).map((part) => unitKey(part));
  if (clean.some((part) => part.includes(' '))) badRequest('Parts must be single words');
  return { kind, parts: clean };
}

export async function listSegRules(db: PhasaDb): Promise<SegRule[]> {
  return (await db.segRules.toArray()).map(toSegRule);
}

/** Adds a rule; the opposite rule for the same word is removed. */
export async function addSegRule(
  db: PhasaDb,
  rule: { kind: SegRuleKind; parts: string[] },
  now: number,
): Promise<SegRule> {
  const key = segRuleKey(rule.kind, rule.parts);
  const opposite = segRuleKey(rule.kind === 'merge' ? 'split' : 'merge', rule.parts);
  return db.transaction('rw', db.segRules, async () => {
    await db.segRules.where('key').equals(opposite).delete();
    const existing = await db.segRules.where('key').equals(key).first();
    if (existing) return toSegRule(existing);
    const row = { key, kind: rule.kind, parts: rule.parts, createdAt: now };
    const id = await db.segRules.add(row);
    return toSegRule({ ...row, id });
  });
}

export async function deleteSegRule(db: PhasaDb, key: string): Promise<boolean> {
  return (await db.segRules.where('key').equals(key).delete()) > 0;
}
