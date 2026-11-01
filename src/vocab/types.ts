/**
 * The learner's vocabulary as other contexts see it (docs/plan.md §2.1, §9):
 * saved words and phrases with a status and the contexts they were met in.
 * Shared by the service worker, content script and extension pages.
 */

export type LearningLevel = 1 | 2 | 3 | 4;
export type WordStatus = 'new' | LearningLevel | 'known' | 'ignored';

export const WORD_STATUSES: readonly WordStatus[] = ['new', 1, 2, 3, 4, 'known', 'ignored'];

export function isWordStatus(value: unknown): value is WordStatus {
  return WORD_STATUSES.includes(value as WordStatus);
}

/** A single dictionary-style word, or a multi-word phrase saved from a selection. */
export type UnitKind = 'word' | 'phrase';

/** Where a word was met: the cue, its translation and the video. */
export interface ContextInput {
  videoId: string;
  videoTitle: string;
  channel?: string;
  sentence: string;
  sentenceTranslation?: string;
  cueStartMs: number;
  cueEndMs: number;
}

export interface SavedContext extends ContextInput {
  createdAt: number;
}

export interface SavedUnit {
  kind: UnitKind;
  thai: string;
  status: WordStatus;
  createdAt: number;
  updatedAt: number;
  /** First dictionary gloss, for lists. */
  gloss?: string;
  /** Paiboon romanization, for lists. */
  romanization?: string;
  /** Newest first. */
  contexts: SavedContext[];
}

/**
 * How a bulk change treats words that already have a status: `new-only` leaves every saved word
 * alone (top-N known, "mark all as known" for the rest of a video); `advance` also moves a word
 * forward, learning → known (importing a known-word list, plan §9: the more advanced status wins).
 * Ignored words are never touched.
 */
export type BulkMode = 'new-only' | 'advance';

/** Saved words by status, and saved phrases. */
export interface VocabCounts {
  known: number;
  learning: number;
  ignored: number;
  phrases: number;
}

/** Onboarding offers to mark this many of the most frequent words as known (plan §2.1). */
export const FREQUENT_COUNTS = [100, 500, 1000, 2000, 5000] as const;

/** A word of the frequency list offered in onboarding (plan §2.1). */
export interface FrequentWord {
  thai: string;
  /** Corpus frequency rank, 1 = most frequent. */
  rank: number;
  gloss?: string;
  romanization?: string;
  /** Saved status, when the word is saved and not new. */
  status?: WordStatus;
}

/** `status: null` = deleted. */
export interface VocabChange {
  kind: UnitKind;
  thai: string;
  status: WordStatus | null;
}

export type SegRuleKind = 'merge' | 'split';

/** A user correction of word boundaries, applied everywhere (docs/plan.md §5.3). */
export interface SegRule {
  key: string;
  kind: SegRuleKind;
  /** merge: these parts form one word; split: the word `parts.join('')` splits into them. */
  parts: string[];
  createdAt: number;
}

export function segRuleKey(kind: SegRuleKind, parts: readonly string[]): string {
  return `${kind}:${parts.join('|')}`;
}
