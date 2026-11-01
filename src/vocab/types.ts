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
