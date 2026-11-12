/**
 * Writing a backup (docs/plan.md §9: a full dump with the schema version). Reads only the tables
 * of {@link BACKUP_TABLES}, in one read transaction; credentials are never read here (ADR 0014).
 * Service worker only.
 */
import { isCachedAnswer } from '../ai/cache';
import type { PhasaDb } from '../db/db';
import { SCHEMA_VERSION } from '../db/schema';
import type { ContextRow, PhraseRow, WordRow } from '../db/types';
import { settingsFromRows } from '../settings';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type Backup,
  type BackupContext,
  type BackupUnit,
  type BackupVideo,
} from './format';

function toBackupContext(row: ContextRow): BackupContext {
  const context: BackupContext = {
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

function toBackupUnit(row: WordRow | PhraseRow, contexts: ContextRow[] | undefined): BackupUnit {
  const unit: BackupUnit = {
    thai: row.thai,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contexts: (contexts ?? []).sort((a, b) => b.createdAt - a.createdAt).map(toBackupContext),
  };
  if (row.note !== undefined) unit.note = row.note;
  if (row.srs !== undefined) unit.srs = row.srs;
  if ('nextReviewAt' in row && row.nextReviewAt !== undefined) unit.nextReviewAt = row.nextReviewAt;
  return unit;
}

function groupBy(
  rows: readonly ContextRow[],
  key: 'wordId' | 'phraseId',
): Map<number, ContextRow[]> {
  const groups = new Map<number, ContextRow[]>();
  for (const row of rows) {
    const id = row[key];
    if (id === undefined) continue;
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

export async function exportBackup(
  db: PhasaDb,
  options: { now: number; appVersion: string },
): Promise<Backup> {
  const tables = [
    db.words,
    db.phrases,
    db.contexts,
    db.segRules,
    db.settings,
    db.videos,
    db.aiCache,
  ];
  const [words, phrases, contexts, segRules, settings, videos, answers] = await db.transaction(
    'r',
    tables,
    () =>
      Promise.all([
        db.words.toArray(),
        db.phrases.toArray(),
        db.contexts.toArray(),
        db.segRules.toArray(),
        db.settings.toArray(),
        db.videos.toArray(),
        db.aiCache.toArray(),
      ]),
  );
  const wordContexts = groupBy(contexts, 'wordId');
  const phraseContexts = groupBy(contexts, 'phraseId');
  const byCreation = (a: { createdAt: number }, b: { createdAt: number }) =>
    a.createdAt - b.createdAt;

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(options.now).toISOString(),
    app: { version: options.appVersion },
    words: words.sort(byCreation).map((row) => toBackupUnit(row, wordContexts.get(row.id))),
    phrases: phrases.sort(byCreation).map((row) => toBackupUnit(row, phraseContexts.get(row.id))),
    segRules: segRules
      .sort(byCreation)
      .map((rule) => ({ kind: rule.kind, parts: rule.parts, createdAt: rule.createdAt })),
    // The effective settings, defaults included, so a restore reproduces them exactly.
    settings: { ...settingsFromRows(settings) },
    videos: videos.map((row) => {
      const video: BackupVideo = {
        videoId: row.videoId,
        title: row.title,
        trackKind: row.trackKind,
      };
      if (row.channel !== undefined) video.channel = row.channel;
      if (row.durationSec !== undefined) video.durationSec = row.durationSec;
      if (row.stats !== undefined && row.analyzedAt !== undefined) {
        video.stats = row.stats;
        video.analyzedAt = row.analyzedAt;
      }
      return video;
    }),
    aiAnswers: answers
      .sort(byCreation)
      .flatMap((row) =>
        isCachedAnswer(row.value)
          ? [{ key: row.key, createdAt: row.createdAt, answer: row.value }]
          : [],
      ),
  };
}
