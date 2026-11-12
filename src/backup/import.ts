/**
 * Restoring a backup (docs/plan.md §9): rows are validated like any other input from outside, then
 * merged by Thai text. A word or phrase keeps the more advanced status (`bulkReplaces` in
 * `advance` mode: new < learning 1–4 < known; ignored is never overridden and never overrides),
 * lines are added unless the same cue is already saved, nothing is deleted. Service worker only.
 */
import { isCachedAnswer } from '../ai/cache';
import { PROMPTS } from '../ai/prompts';
import { LEVELS, type VideoFeatures, type VideoStats } from '../analysis/types';
import { isVideoId } from '../captions/bridge';
import type { PhasaDb } from '../db/db';
import type { ContextRow, PhraseRow, VideoRow, WordRow } from '../db/types';
import { pickValidSettings, type Settings } from '../settings';
import { bulkReplaces, parseContext, parseSegRule, parseStatus, unitKey } from '../vocab/store';
import { segRuleKey, type UnitKind, type VocabChange } from '../vocab/types';
import {
  emptySummary,
  type BackupAiAnswer,
  type BackupContext,
  type BackupSegRule,
  type BackupUnit,
  type BackupVideo,
  type SectionSummary,
} from './format';

export const MAX_CONTEXTS_PER_UNIT = 500;
const MAX_NOTE_CHARS = 5000;
const MAX_SRS_CHARS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function timestamp(value: unknown, fallback: number): number {
  return isCount(value) ? Math.round(value) : fallback;
}

/** Same cue of the same video: one saved line (as in src/vocab/store.ts `setUnit`). */
const contextKey = (context: { videoId: string; cueStartMs: number }) =>
  `${context.videoId}@${context.cueStartMs}`;

/** A word or phrase of a backup, validated; null if its Thai text or status is invalid. */
export function parseBackupUnit(value: unknown, now: number): BackupUnit | null {
  if (!isRecord(value)) return null;
  let thai: string;
  let status: BackupUnit['status'];
  try {
    thai = unitKey(value.thai);
    status = parseStatus(value.status);
  } catch {
    return null;
  }
  const createdAt = timestamp(value.createdAt, now);
  const unit: BackupUnit = {
    thai,
    status,
    createdAt,
    updatedAt: timestamp(value.updatedAt, createdAt),
    contexts: [],
  };
  if (typeof value.note === 'string' && value.note !== '') {
    unit.note = value.note.slice(0, MAX_NOTE_CHARS);
  }
  if (value.srs !== undefined && value.srs !== null) {
    try {
      if (JSON.stringify(value.srs).length <= MAX_SRS_CHARS) unit.srs = value.srs;
    } catch {
      // Not JSON: left out.
    }
  }
  if (isCount(value.nextReviewAt)) unit.nextReviewAt = Math.round(value.nextReviewAt);
  const seen = new Set<string>();
  const contexts = Array.isArray(value.contexts) ? (value.contexts as unknown[]) : [];
  for (const raw of contexts.slice(0, MAX_CONTEXTS_PER_UNIT)) {
    let context: BackupContext;
    try {
      context = { ...parseContext(raw), createdAt: unit.createdAt };
    } catch {
      continue;
    }
    if (isRecord(raw)) context.createdAt = timestamp(raw.createdAt, unit.createdAt);
    const key = contextKey(context);
    if (seen.has(key)) continue;
    seen.add(key);
    unit.contexts.push(context);
  }
  return unit;
}

/** Two entries for the same text in one file: one entry, as if imported one after the other. */
function mergeUnits(a: BackupUnit, b: BackupUnit): BackupUnit {
  const merged: BackupUnit = {
    ...a,
    status: bulkReplaces(a.status, b.status, 'advance') ? b.status : a.status,
    createdAt: Math.min(a.createdAt, b.createdAt),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
  const keys = new Set(a.contexts.map(contextKey));
  merged.contexts = [
    ...a.contexts,
    ...b.contexts.filter((context) => !keys.has(contextKey(context))),
  ];
  if (merged.note === undefined && b.note !== undefined) merged.note = b.note;
  if (merged.srs === undefined && b.srs !== undefined) merged.srs = b.srs;
  if (merged.nextReviewAt === undefined && b.nextReviewAt !== undefined) {
    merged.nextReviewAt = b.nextReviewAt;
  }
  return merged;
}

type UnitRow = WordRow | PhraseRow;

/** What changes in a saved row when a backup's entry for the same text is merged into it. */
export function unitPatch(row: UnitRow, unit: BackupUnit, kind: UnitKind): Partial<WordRow> | null {
  const patch: Partial<WordRow> = {};
  const replaced = row.status !== unit.status && bulkReplaces(row.status, unit.status, 'advance');
  if (replaced) {
    patch.status = unit.status;
    patch.updatedAt = Math.max(row.updatedAt, unit.updatedAt);
  }
  if (unit.createdAt < row.createdAt) patch.createdAt = unit.createdAt;
  if (row.note === undefined && unit.note !== undefined) patch.note = unit.note;
  if (unit.srs !== undefined && (row.srs === undefined || replaced)) patch.srs = unit.srs;
  if (
    kind === 'word' &&
    unit.nextReviewAt !== undefined &&
    ((row as WordRow).nextReviewAt === undefined || replaced)
  ) {
    patch.nextReviewAt = unit.nextReviewAt;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function newRow(unit: BackupUnit, kind: UnitKind): Omit<WordRow, 'id'> {
  const row: Omit<WordRow, 'id'> = {
    thai: unit.thai,
    status: unit.status,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  };
  if (unit.note !== undefined) row.note = unit.note;
  if (unit.srs !== undefined) row.srs = unit.srs;
  if (kind === 'word' && unit.nextReviewAt !== undefined) row.nextReviewAt = unit.nextReviewAt;
  return row;
}

function contextRow(context: BackupContext, kind: UnitKind, id: number): Omit<ContextRow, 'id'> {
  return { ...context, ...(kind === 'word' ? { wordId: id } : { phraseId: id }) };
}

export interface UnitImport {
  summary: SectionSummary;
  /** Statuses that changed, for `vocab/changed`. */
  changes: VocabChange[];
  /** A phrase without spaces was added: word boundaries change (ADR 0005). */
  segmentation: boolean;
}

export async function importUnits(
  db: PhasaDb,
  kind: UnitKind,
  rows: readonly unknown[],
  now: number,
): Promise<UnitImport> {
  const summary = emptySummary();
  const byThai = new Map<string, BackupUnit>();
  for (const raw of rows) {
    const unit = parseBackupUnit(raw, now);
    if (!unit) {
      summary.skipped++;
      continue;
    }
    const earlier = byThai.get(unit.thai);
    byThai.set(unit.thai, earlier ? mergeUnits(earlier, unit) : unit);
  }
  const units = [...byThai.values()];
  const table = kind === 'word' ? db.words : db.phrases;
  const owner = kind === 'word' ? 'wordId' : 'phraseId';

  return db.transaction('rw', table, db.contexts, async () => {
    const existing = new Map<string, UnitRow>(
      (
        await table
          .where('thai')
          .anyOf(units.map((unit) => unit.thai))
          .toArray()
      ).map((row) => [row.thai, row]),
    );
    const saved = new Map<number, Set<string>>();
    const ids = [...existing.values()].map((row) => row.id);
    for (const row of await db.contexts.where(owner).anyOf(ids).toArray()) {
      const id = row[owner];
      if (id === undefined) continue;
      let keys = saved.get(id);
      if (!keys) saved.set(id, (keys = new Set()));
      keys.add(contextKey(row));
    }

    const added: BackupUnit[] = [];
    const updates: { key: number; changes: Partial<WordRow> }[] = [];
    const contexts: Omit<ContextRow, 'id'>[] = [];
    const changes: VocabChange[] = [];
    for (const unit of units) {
      const row = existing.get(unit.thai);
      if (!row) {
        added.push(unit);
        summary.added++;
        if (unit.status !== 'new') changes.push({ kind, thai: unit.thai, status: unit.status });
        continue;
      }
      const patch = unitPatch(row, unit, kind);
      const known = saved.get(row.id);
      const fresh = unit.contexts.filter((context) => !known?.has(contextKey(context)));
      for (const context of fresh) contexts.push(contextRow(context, kind, row.id));
      if (patch) updates.push({ key: row.id, changes: patch });
      if (patch || fresh.length > 0) summary.updated++;
      else summary.unchanged++;
      if (patch?.status !== undefined) {
        changes.push({ kind, thai: unit.thai, status: patch.status });
      }
    }

    if (added.length > 0) {
      const newRows = added.map((unit) => newRow(unit, kind));
      // Separate calls: overloads don't resolve on the union of both tables.
      const newIds =
        kind === 'word'
          ? await db.words.bulkAdd(newRows, { allKeys: true })
          : await db.phrases.bulkAdd(newRows, { allKeys: true });
      added.forEach((unit, index) => {
        const id = newIds[index];
        if (id === undefined) return;
        for (const context of unit.contexts) contexts.push(contextRow(context, kind, id));
      });
    }
    if (updates.length > 0) await table.bulkUpdate(updates);
    if (contexts.length > 0) await db.contexts.bulkAdd(contexts);
    return {
      summary,
      changes,
      segmentation: kind === 'phrase' && added.some((unit) => !unit.thai.includes(' ')),
    };
  });
}

export function parseBackupSegRule(value: unknown, now: number): BackupSegRule | null {
  if (!isRecord(value)) return null;
  try {
    const rule = parseSegRule(value.kind, value.parts);
    return { ...rule, createdAt: timestamp(value.createdAt, now) };
  } catch {
    return null;
  }
}

/**
 * Merge and split rules. A rule for the opposite fix of the same text (merge vs split) replaces
 * the saved one only if it is newer, as if both had been made in this browser in that order.
 */
export async function importSegRules(
  db: PhasaDb,
  rows: readonly unknown[],
  now: number,
): Promise<{ summary: SectionSummary; changed: boolean }> {
  const summary = emptySummary();
  const rules = new Map<string, BackupSegRule>();
  for (const raw of rows) {
    const rule = parseBackupSegRule(raw, now);
    if (rule) rules.set(segRuleKey(rule.kind, rule.parts), rule);
    else summary.skipped++;
  }
  await db.transaction('rw', db.segRules, async () => {
    for (const [key, rule] of rules) {
      if (await db.segRules.where('key').equals(key).first()) {
        summary.unchanged++;
        continue;
      }
      const oppositeKey = segRuleKey(rule.kind === 'merge' ? 'split' : 'merge', rule.parts);
      const opposite = await db.segRules.where('key').equals(oppositeKey).first();
      if (opposite && opposite.createdAt >= rule.createdAt) {
        summary.unchanged++;
        continue;
      }
      if (opposite) await db.segRules.delete(opposite.id);
      await db.segRules.add({ key, kind: rule.kind, parts: rule.parts, createdAt: rule.createdAt });
      if (opposite) summary.updated++;
      else summary.added++;
    }
  });
  return { summary, changed: summary.added + summary.updated > 0 };
}

/** The settings of a backup replace the current ones, key by key; invalid ones are skipped. */
export async function importSettings(
  db: PhasaDb,
  value: unknown,
): Promise<{ summary: SectionSummary; patch: Partial<Settings> }> {
  const summary = emptySummary();
  const { settings, skipped } = pickValidSettings(value);
  summary.skipped = skipped;
  const current = new Map((await db.settings.toArray()).map((row) => [row.key, row.value]));
  const patch: Partial<Record<keyof Settings, unknown>> = {};
  for (const [key, field] of Object.entries(settings) as [keyof Settings, unknown][]) {
    if (JSON.stringify(current.get(key)) === JSON.stringify(field)) summary.unchanged++;
    else {
      patch[key] = field;
      if (current.has(key)) summary.updated++;
      else summary.added++;
    }
  }
  const entries = Object.entries(patch);
  if (entries.length > 0)
    await db.settings.bulkPut(entries.map(([key, field]) => ({ key, value: field })));
  return { summary, patch: patch as Partial<Settings> };
}

const FEATURE_KEYS: readonly (keyof VideoFeatures)[] = [
  'tokens',
  'unique',
  'outside1000',
  'outside3000',
  'outside5000',
  'outside10000',
  'speechRate',
  'avgCueLength',
];
const COMPREHENSIONS = new Set(['comfortable', 'challenging', 'hard', 'too-hard']);

/** A stats snapshot with exactly the fields of {@link VideoStats}, or undefined. */
export function parseVideoStats(value: unknown): VideoStats | undefined {
  if (!isRecord(value) || !isRecord(value.features) || !isRecord(value.unique)) return undefined;
  const { features, unique } = value;
  if (typeof value.trackKey !== 'string' || value.trackKey.length > 40) return undefined;
  if (!FEATURE_KEYS.every((key) => isCount(features[key]))) return undefined;
  if (!['known', 'ignored', 'learning', 'new'].every((key) => isCount(unique[key]))) {
    return undefined;
  }
  const level = value.level;
  if (level !== null && !LEVELS.includes(level as (typeof LEVELS)[number])) return undefined;
  const comprehension = value.comprehension;
  if (comprehension !== null && !COMPREHENSIONS.has(comprehension as string)) return undefined;
  const counts = ['coverage', 'knownTokens', 'newTokens', 'newHighFreq', 'newRare'] as const;
  if (!counts.every((key) => isCount(value[key]))) return undefined;
  return {
    trackKey: value.trackKey,
    features: Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, features[key]]),
    ) as unknown as VideoFeatures,
    level: level as VideoStats['level'],
    coverage: value.coverage as number,
    comprehension: comprehension as VideoStats['comprehension'],
    knownTokens: value.knownTokens as number,
    newTokens: value.newTokens as number,
    unique: {
      known: unique.known as number,
      ignored: unique.ignored as number,
      learning: unique.learning as number,
      new: unique.new as number,
    },
    newHighFreq: value.newHighFreq as number,
    newRare: value.newRare as number,
  };
}

export function parseBackupVideo(value: unknown): BackupVideo | null {
  if (!isRecord(value) || !isVideoId(value.videoId)) return null;
  if (value.trackKind !== 'manual' && value.trackKind !== 'asr') return null;
  const video: BackupVideo = {
    videoId: value.videoId,
    title: typeof value.title === 'string' ? value.title.slice(0, 1000) : '',
    trackKind: value.trackKind,
  };
  if (typeof value.channel === 'string') video.channel = value.channel.slice(0, 500);
  if (isCount(value.durationSec)) video.durationSec = value.durationSec;
  const stats = parseVideoStats(value.stats);
  if (stats && isCount(value.analyzedAt)) {
    video.stats = stats;
    video.analyzedAt = Math.round(value.analyzedAt);
  }
  return video;
}

/** Analyzed videos: missing ones are added; a newer analysis replaces an older one. */
export async function importVideos(db: PhasaDb, rows: readonly unknown[]): Promise<SectionSummary> {
  const summary = emptySummary();
  const videos = new Map<string, BackupVideo>();
  for (const raw of rows) {
    const video = parseBackupVideo(raw);
    if (video) videos.set(video.videoId, video);
    else summary.skipped++;
  }
  await db.transaction('rw', db.videos, async () => {
    const keys = [...videos.keys()];
    const existing = await db.videos.bulkGet(keys);
    const puts: VideoRow[] = [];
    keys.forEach((videoId, index) => {
      const video = videos.get(videoId);
      if (!video) return;
      const row = existing[index];
      if (!row) {
        puts.push(video);
        summary.added++;
        return;
      }
      const next: VideoRow = { ...row };
      if (video.stats && (video.analyzedAt ?? 0) > (row.analyzedAt ?? 0)) {
        next.stats = video.stats;
        next.analyzedAt = video.analyzedAt ?? 0;
      }
      if (!row.title && video.title) next.title = video.title;
      if (row.channel === undefined && video.channel !== undefined) next.channel = video.channel;
      if (row.durationSec === undefined && video.durationSec !== undefined) {
        next.durationSec = video.durationSec;
      }
      if (JSON.stringify(next) === JSON.stringify(row)) {
        summary.unchanged++;
      } else {
        puts.push(next);
        summary.updated++;
      }
    });
    if (puts.length > 0) await db.videos.bulkPut(puts);
  });
  return summary;
}

const AI_PROVIDERS = new Set(['chatgpt-plan', 'openai-api-key']);

/** A saved AI answer whose function exists and whose value still has that function's shape. */
export function parseBackupAiAnswer(value: unknown, now: number): BackupAiAnswer | null {
  if (!isRecord(value) || typeof value.key !== 'string' || !/^[0-9a-f]{64}$/u.test(value.key)) {
    return null;
  }
  const answer = value.answer;
  if (!isCachedAnswer(answer) || !AI_PROVIDERS.has(answer.provider)) return null;
  if (!/^[\w.:/-]{1,100}$/u.test(answer.model)) return null;
  const prompt = Object.hasOwn(PROMPTS, answer.fn) ? PROMPTS[answer.fn] : undefined;
  if (!prompt?.isValue(answer.value)) return null;
  return {
    key: value.key,
    createdAt: timestamp(value.createdAt, now),
    answer: { fn: answer.fn, model: answer.model, provider: answer.provider, value: answer.value },
  };
}

/** Saved AI answers that aren't here yet. An answer already saved is kept. */
export async function importAiAnswers(
  db: PhasaDb,
  rows: readonly unknown[],
  now: number,
): Promise<SectionSummary> {
  const summary = emptySummary();
  const answers = new Map<string, BackupAiAnswer>();
  for (const raw of rows) {
    const answer = parseBackupAiAnswer(raw, now);
    if (answer) answers.set(answer.key, answer);
    else summary.skipped++;
  }
  await db.transaction('rw', db.aiCache, async () => {
    const keys = [...answers.keys()];
    const existing = await db.aiCache.bulkGet(keys);
    const puts = keys.flatMap((key, index) => {
      const answer = answers.get(key);
      if (!answer || existing[index]) {
        summary.unchanged++;
        return [];
      }
      summary.added++;
      return [{ key, value: answer.answer, createdAt: answer.createdAt }];
    });
    if (puts.length > 0) await db.aiCache.bulkPut(puts);
  });
  return summary;
}
