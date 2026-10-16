import type { ProcessedCue, TrackKind } from '../captions/types';
import type { DictEntry } from '../dictionary/types';

export type LearningLevel = 1 | 2 | 3 | 4;
export type WordStatus = 'new' | LearningLevel | 'known' | 'ignored';

export interface WordRow {
  id: number;
  /** Normalized form; the unit of statistics (docs/plan.md §5.4). */
  thai: string;
  status: WordStatus;
  note?: string;
  /** FSRS card state, phase 2 of the product (ts-fsrs). */
  srs?: unknown;
  nextReviewAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** Multi-word units saved from a selection; same lifecycle as words. */
export type PhraseRow = Omit<WordRow, 'nextReviewAt'>;

export interface ContextRow {
  id: number;
  wordId: number;
  videoId: string;
  sentence: string;
  sentenceTranslation?: string;
  cueStartMs: number;
  cueEndMs: number;
  videoTitle: string;
  channel?: string;
  createdAt: number;
}

export interface VideoRow {
  videoId: string;
  title: string;
  channel?: string;
  trackKind: TrackKind;
  durationSec?: number;
  /** Analysis snapshot; shape is defined by src/analysis in phase 4. */
  stats?: unknown;
  analyzedAt?: number;
}

/** A processed caption track, cached per video (docs/plan.md §4.1 step 9). */
export interface CaptionTrackRow {
  videoId: string;
  /** Track key: the player's `vssId` (`.th`, `a.th`), or `<vssId>>en` for YouTube's machine translation. */
  vssId: string;
  /** Language of the text. */
  languageCode: string;
  /** Kind of the source track. */
  trackKind: TrackKind;
  /** Source `vssId` of a machine translation. */
  translatedFrom?: string;
  cues: ProcessedCue[];
  fetchedAt: number;
  /** Rows from an older captions pipeline are ignored and refetched. */
  processingVersion: number;
}

export interface SegRuleRow {
  id: number;
  /** Canonical rule key, e.g. `merge:โรง|เรียน`; unique so a rule is stored once. */
  key: string;
  kind: 'merge' | 'split';
  parts: string[];
  createdAt: number;
}

export interface AiCacheRow {
  /** sha256(function + prompt version + model + input). */
  key: string;
  value: unknown;
  createdAt: number;
}

export type DictRow = DictEntry;

export interface SettingRow {
  key: string;
  value: unknown;
}
