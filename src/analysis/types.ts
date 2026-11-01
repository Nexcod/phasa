/**
 * What the analysis of a video's Thai track tells the learner (docs/plan.md §7).
 * Computed by the service worker (src/background/analysis.ts), shown by the
 * badge under the video title and in the side panel.
 */

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
/** Absolute level of the video, independent of the learner (plan §7.3, estimate 2). */
export type Level = (typeof LEVELS)[number];

/** How much of the video the learner understands, by known-word coverage (plan §7.3, estimate 1). */
export type Comprehension = 'comfortable' | 'challenging' | 'hard' | 'too-hard';

/** Frequency-rank buckets of plan §7.2 `freqProfile`. */
export const FREQ_BUCKETS = [1000, 3000, 5000, 10000] as const;

/** Status-independent measures of a track (plan §7.2); the level is estimated from these. */
export interface VideoFeatures {
  /** Counted word tokens (plan §5.4), with repeats. */
  tokens: number;
  /** Distinct counted words. */
  unique: number;
  /** Share of counted tokens outside the N most frequent words, for each of {@link FREQ_BUCKETS}. */
  outside1000: number;
  outside3000: number;
  outside5000: number;
  outside10000: number;
  /** Thai syllables per second of speech (cue time). */
  speechRate: number;
  /** Thai words per line that has any. */
  avgCueLength: number;
}

/** A new word worth learning first (plan §7.4). */
export interface TopWord {
  thai: string;
  /** Occurrences in the video. */
  count: number;
  /** Corpus frequency rank, 1 = most frequent. */
  rank?: number;
  gloss?: string;
  /** Paiboon romanization. */
  romanization?: string;
}

export interface VideoAnalysis {
  videoId: string;
  /** Thai track analyzed (`vssId`, e.g. `.th`, `a.th`). */
  trackKey: string;
  features: VideoFeatures;
  /** Null for a video too short to judge. */
  level: Level | null;
  /** Counted tokens whose word is known or ignored. */
  knownTokens: number;
  /** `knownTokens / features.tokens`, 0 when there are no tokens: the main comprehension measure. */
  coverage: number;
  /** Null when there are no counted words. */
  comprehension: Comprehension | null;
  /** Counted tokens whose word is new (not saved). */
  newTokens: number;
  /** Distinct words by status. */
  unique: { known: number; ignored: number; learning: number; new: number };
  /** Distinct new words among the 3000 most frequent: worth learning (plan §7.2). */
  newHighFreq: number;
  /** The other distinct new words. */
  newRare: number;
  /** New words, best to learn first; at most {@link TOP_NEW_WORDS}. */
  topNew: TopWord[];
  /** Indices of cues with at least one new word. */
  newCues: number[];
  /** Time the service worker spent on this analysis. */
  analysisMs: number;
}

export const TOP_NEW_WORDS = 15;

/** What the `videos` table keeps of the latest analysis (plan §9 "stats snapshot"). */
export type VideoStats = Pick<
  VideoAnalysis,
  | 'trackKey'
  | 'features'
  | 'level'
  | 'coverage'
  | 'comprehension'
  | 'knownTokens'
  | 'newTokens'
  | 'unique'
  | 'newHighFreq'
  | 'newRare'
>;
