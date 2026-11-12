/**
 * The backup file (docs/plan.md §2.1 "Данные", §9): every saved word and phrase with the lines it
 * was met in, word-boundary fixes, settings, analyzed videos and saved AI answers, as one JSON
 * document with the schema version. Caches that refill themselves (captions, the dictionary) and
 * secrets (OpenAI credentials, ADR 0014) are never part of it.
 *
 * Rows refer to each other by Thai text, not by database ids, so a backup merges into any
 * database: an import adds what is missing and keeps the more advanced status (src/backup/import.ts).
 */
import type { VideoStats } from '../analysis/types';
import type { CachedAnswer } from '../ai/cache';
import type { TrackKind } from '../captions/types';
import type { SegRuleKind, WordStatus } from '../vocab/types';

export const BACKUP_FORMAT = 'phasa-backup';
/** Bump when the file's structure changes; an older app refuses newer files. */
export const BACKUP_VERSION = 1;

/** Tables a backup carries (docs/decisions/0016-data-settings-and-polish.md). */
export const BACKUP_TABLES = [
  'words',
  'phrases',
  'contexts',
  'segRules',
  'settings',
  'videos',
  'aiCache',
] as const;

/** Tables a backup leaves out, and why. Every table is in exactly one of the two lists. */
export const NOT_BACKED_UP: Readonly<Record<string, string>> = {
  captions: 'cache of YouTube subtitles, fetched again when the video is watched',
  dict: 'the packaged dictionary, loaded from the extension',
  meta: 'internal bookkeeping (dictionary version, default AI model)',
  credentials: 'OpenAI tokens and the API key never leave the browser (ADR 0014)',
};

export interface BackupContext {
  videoId: string;
  videoTitle: string;
  channel?: string;
  sentence: string;
  sentenceTranslation?: string;
  cueStartMs: number;
  cueEndMs: number;
  createdAt: number;
}

/** A saved word or phrase. */
export interface BackupUnit {
  thai: string;
  status: WordStatus;
  createdAt: number;
  updatedAt: number;
  note?: string;
  /** Spaced-repetition state (after v1), carried over as is. */
  srs?: unknown;
  nextReviewAt?: number;
  /** Newest first. */
  contexts: BackupContext[];
}

export interface BackupSegRule {
  kind: SegRuleKind;
  parts: string[];
  createdAt: number;
}

export interface BackupVideo {
  videoId: string;
  title: string;
  channel?: string;
  trackKind: TrackKind;
  durationSec?: number;
  stats?: VideoStats;
  analyzedAt?: number;
}

export interface BackupAiAnswer {
  /** The cache key: sha256 of function, prompt version, model and input (src/ai/cache.ts). */
  key: string;
  createdAt: number;
  answer: CachedAnswer;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** IndexedDB schema version of the app that wrote it (src/db/schema.ts). */
  schemaVersion: number;
  /** ISO 8601. */
  exportedAt: string;
  app: { version: string };
  words: BackupUnit[];
  phrases: BackupUnit[];
  segRules: BackupSegRule[];
  settings: Record<string, unknown>;
  videos: BackupVideo[];
  aiAnswers: BackupAiAnswer[];
}

/** At most this many rows per `data/import` request. */
export const MAX_IMPORT_ROWS = 1000;

/** Parts of a backup that are imported one request at a time. */
export const BACKUP_SECTIONS = [
  'words',
  'phrases',
  'segRules',
  'settings',
  'videos',
  'aiAnswers',
] as const;
export type BackupSection = (typeof BACKUP_SECTIONS)[number];

/** What an import did with one section. */
export interface SectionSummary {
  added: number;
  /** Merged into an existing row: a more advanced status, new lines, a newer analysis. */
  updated: number;
  unchanged: number;
  /** Invalid entries, left out. */
  skipped: number;
}

export function emptySummary(): SectionSummary {
  return { added: 0, updated: 0, unchanged: 0, skipped: 0 };
}

export function addSummaries(a: SectionSummary, b: SectionSummary): SectionSummary {
  return {
    added: a.added + b.added,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    skipped: a.skipped + b.skipped,
  };
}

/** A backup file as read, before its rows are validated (the service worker does that). */
export interface BackupFile {
  version: number;
  schemaVersion: number;
  exportedAt: string | null;
  appVersion: string | null;
  /** Raw rows of each array section; `settings` is one object. */
  rows: Record<Exclude<BackupSection, 'settings'>, unknown[]>;
  settings: Record<string, unknown> | null;
  /** Lines saved with the words and phrases. */
  contexts: number;
}

export type BackupReadError = 'not-json' | 'not-backup' | 'newer-version';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Checks the header and splits the sections; rows are validated when they are imported. */
export function readBackup(
  text: string,
): { ok: true; file: BackupFile } | { ok: false; error: BackupReadError } {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/u, ''));
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (!isRecord(json) || json.format !== BACKUP_FORMAT || !Number.isInteger(json.version)) {
    return { ok: false, error: 'not-backup' };
  }
  const version = json.version as number;
  if (version > BACKUP_VERSION) return { ok: false, error: 'newer-version' };
  const words = array(json.words);
  const phrases = array(json.phrases);
  const contexts = [...words, ...phrases].reduce<number>(
    (sum, unit) => sum + (isRecord(unit) ? array(unit.contexts).length : 0),
    0,
  );
  return {
    ok: true,
    file: {
      version,
      schemaVersion: Number.isInteger(json.schemaVersion) ? (json.schemaVersion as number) : 0,
      exportedAt: typeof json.exportedAt === 'string' ? json.exportedAt : null,
      appVersion:
        isRecord(json.app) && typeof json.app.version === 'string' ? json.app.version : null,
      rows: {
        words,
        phrases,
        segRules: array(json.segRules),
        videos: array(json.videos),
        aiAnswers: array(json.aiAnswers),
      },
      settings: isRecord(json.settings) ? json.settings : null,
      contexts,
    },
  };
}

export type ImportRequest =
  | { section: Exclude<BackupSection, 'settings'>; rows: unknown[] }
  | { section: 'settings'; settings: Record<string, unknown> };

/**
 * The `data/import` requests for a backup, in an order where every row's dependencies come first
 * (boundary fixes before phrases, so the tokenizer is rebuilt once with both). Each request has at
 * most `maxRows` rows and, past its first row, about `maxChars` of JSON: a port message stays small
 * whatever the file holds.
 */
export function importRequests(
  file: BackupFile,
  options: { settings: boolean; maxRows: number; maxChars: number },
): ImportRequest[] {
  const requests: ImportRequest[] = [];
  if (options.settings && file.settings) {
    requests.push({ section: 'settings', settings: file.settings });
  }
  const order = ['segRules', 'words', 'phrases', 'videos', 'aiAnswers'] as const;
  for (const section of order) {
    let rows: unknown[] = [];
    let chars = 0;
    for (const row of file.rows[section]) {
      const size = JSON.stringify(row).length;
      if (rows.length > 0 && (rows.length >= options.maxRows || chars + size > options.maxChars)) {
        requests.push({ section, rows });
        rows = [];
        chars = 0;
      }
      rows.push(row);
      chars += size;
    }
    if (rows.length > 0) requests.push({ section, rows });
  }
  return requests;
}

/** `phasa-backup-2026-11-12.json`, in local time. */
export function datedFileName(prefix: string, extension: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${prefix}-${day}.${extension}`;
}
