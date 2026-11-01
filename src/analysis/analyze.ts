/**
 * Coverage, difficulty and "top new words" of a Thai track (docs/plan.md §7).
 *
 * Split in two so a status change is cheap (plan §7.4: recomputed in real
 * time): {@link buildProfile} does the work that depends only on the video
 * (tokens, ranks, syllables, the level) and is cached by the service worker;
 * {@link analyzeProfile} applies the learner's statuses to it.
 */
import type { Token } from '../thai/types';
import type { WordStatus } from '../vocab/types';
import { comprehensionOf, estimateLevel } from './levels';
import {
  FREQ_BUCKETS,
  TOP_NEW_WORDS,
  type Level,
  type TopWord,
  type VideoAnalysis,
  type VideoFeatures,
} from './types';

/** What the analysis needs to know about one word. */
export interface WordFacts {
  /** Corpus frequency rank (data/freq.json), 1 = most frequent. */
  rank?: number;
  inDictionary: boolean;
  /** Names don't count (plan §5.4). */
  isProperNoun: boolean;
  /** Thai syllables, for the speech rate; at least 1. */
  syllables: number;
  gloss?: string;
  romanization?: string;
}

/** Size of the frequency list: the score of a word without a rank treats it as twice as rare. */
export const RANKED_WORDS = 30_000;

/**
 * Priority of a new word (plan §7.4): occurrences in the video × general frequency, the latter as
 * `ln(1 + N / rank)` so it stays positive and falls off slowly (rank 1: 10.3, 1000: 3.4,
 * 30 000: 0.7). The plan's `log(1 / rank)` is ≤ 0 for every rank and would rank backwards.
 */
export function wordScore(count: number, rank: number | undefined): number {
  return count * Math.log(1 + RANKED_WORDS / (rank ?? 2 * RANKED_WORDS));
}

export interface UnitProfile extends TopWord {
  /** First cue it occurs in. */
  firstCue: number;
  score: number;
  /** In the dictionary or the frequency list: a real word, worth suggesting. */
  suggestible: boolean;
}

export interface TrackProfile {
  features: VideoFeatures;
  level: Level | null;
  /** Counted words, in order of first appearance. */
  units: UnitProfile[];
  /** Per cue: indices into `units` of the counted words in it. */
  cueUnits: number[][];
}

export interface ProfileInput {
  cues: readonly { startMs: number; endMs: number }[];
  /** Tokens of each cue (src/thai/tokenizer.ts). */
  tokens: readonly (readonly Token[])[];
  facts: (word: string) => WordFacts;
}

/** Total length of the union of the intervals. */
function unionMs(intervals: { startMs: number; endMs: number }[]): number {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let start = -Infinity;
  let end = -Infinity;
  for (const interval of sorted) {
    if (interval.startMs > end) {
      if (end > start) total += end - start;
      start = interval.startMs;
      end = interval.endMs;
    } else {
      end = Math.max(end, interval.endMs);
    }
  }
  if (end > start) total += end - start;
  return total;
}

/**
 * What counts (plan §5.4): Thai word tokens, as their normalized form, except names. `ๆ` repeats
 * the word before it — one unit for statistics — but its syllables are spoken.
 */
export function buildProfile({ cues, tokens, facts }: ProfileInput): TrackProfile {
  const units: UnitProfile[] = [];
  const unitIndex = new Map<string, number>();
  const cueUnits: number[][] = [];
  const outside = FREQ_BUCKETS.map(() => 0);
  const spoken: { startMs: number; endMs: number }[] = [];
  let counted = 0;
  let syllables = 0;
  let thaiWords = 0;
  let linesWithWords = 0;

  cues.forEach((cue, cueIndex) => {
    const inCue = new Set<number>();
    let words = 0;
    let previousSyllables = 0;
    for (const token of tokens[cueIndex] ?? []) {
      if (token.kind === 'repeat') {
        syllables += previousSyllables;
        continue;
      }
      if (token.kind !== 'thai') continue;
      const fact = facts(token.text);
      words++;
      syllables += fact.syllables;
      previousSyllables = fact.syllables;
      if (fact.isProperNoun) continue;

      counted++;
      FREQ_BUCKETS.forEach((bucket, i) => {
        if ((fact.rank ?? Infinity) > bucket) outside[i] = (outside[i] ?? 0) + 1;
      });
      let index = unitIndex.get(token.text);
      if (index === undefined) {
        index = units.length;
        unitIndex.set(token.text, index);
        const unit: UnitProfile = {
          thai: token.text,
          count: 0,
          firstCue: cueIndex,
          score: 0,
          suggestible: fact.inDictionary || fact.rank !== undefined,
        };
        if (fact.rank !== undefined) unit.rank = fact.rank;
        if (fact.gloss) unit.gloss = fact.gloss;
        if (fact.romanization) unit.romanization = fact.romanization;
        units.push(unit);
      }
      const unit = units[index];
      if (unit) unit.count++;
      inCue.add(index);
    }
    cueUnits.push([...inCue]);
    if (words > 0) {
      thaiWords += words;
      linesWithWords++;
      spoken.push(cue);
    }
  });

  for (const unit of units) unit.score = wordScore(unit.count, unit.rank);
  const speechSeconds = unionMs(spoken) / 1000;
  const share = (i: number) => (counted === 0 ? 0 : (outside[i] ?? 0) / counted);
  const features: VideoFeatures = {
    tokens: counted,
    unique: units.length,
    outside1000: share(0),
    outside3000: share(1),
    outside5000: share(2),
    outside10000: share(3),
    speechRate: speechSeconds > 0 ? syllables / speechSeconds : 0,
    avgCueLength: linesWithWords > 0 ? thaiWords / linesWithWords : 0,
  };
  return { features, level: estimateLevel(features), units, cueUnits };
}

export function statusOf(statuses: Readonly<Record<string, WordStatus>>, thai: string): WordStatus {
  return Object.hasOwn(statuses, thai) ? (statuses[thai] ?? 'new') : 'new';
}

const byPriority = (a: UnitProfile, b: UnitProfile) => b.score - a.score || a.firstCue - b.firstCue;

/** New words of the profile, best to learn first; only real words unless `all`. */
export function newUnits(
  profile: TrackProfile,
  statuses: Readonly<Record<string, WordStatus>>,
  options: { all?: boolean } = {},
): UnitProfile[] {
  return profile.units
    .filter(
      (unit) =>
        statusOf(statuses, unit.thai) === 'new' && (options.all === true || unit.suggestible),
    )
    .sort(byPriority);
}

function toTopWord(unit: UnitProfile): TopWord {
  const word: TopWord = { thai: unit.thai, count: unit.count };
  if (unit.rank !== undefined) word.rank = unit.rank;
  if (unit.gloss) word.gloss = unit.gloss;
  if (unit.romanization) word.romanization = unit.romanization;
  return word;
}

/** The analysis for the learner's current statuses (plan §7.2–§7.4). */
export function analyzeProfile(
  profile: TrackProfile,
  statuses: Readonly<Record<string, WordStatus>>,
  track: { videoId: string; trackKey: string },
): Omit<VideoAnalysis, 'analysisMs'> {
  const unique = { known: 0, ignored: 0, learning: 0, new: 0 };
  let knownTokens = 0;
  let newTokens = 0;
  let newHighFreq = 0;
  const isNew = profile.units.map((unit) => {
    const status = statusOf(statuses, unit.thai);
    if (status === 'known' || status === 'ignored') {
      knownTokens += unit.count;
      unique[status]++;
      return false;
    }
    if (status !== 'new') {
      unique.learning++;
      return false;
    }
    unique.new++;
    newTokens += unit.count;
    if ((unit.rank ?? Infinity) <= 3000) newHighFreq++;
    return true;
  });

  const tokens = profile.features.tokens;
  const coverage = tokens === 0 ? 0 : knownTokens / tokens;
  const newCues: number[] = [];
  profile.cueUnits.forEach((indices, cueIndex) => {
    if (indices.some((index) => isNew[index])) newCues.push(cueIndex);
  });

  return {
    videoId: track.videoId,
    trackKey: track.trackKey,
    features: profile.features,
    level: profile.level,
    knownTokens,
    coverage,
    comprehension: tokens === 0 ? null : comprehensionOf(coverage),
    newTokens,
    unique,
    newHighFreq,
    newRare: unique.new - newHighFreq,
    topNew: newUnits(profile, statuses).slice(0, TOP_NEW_WORDS).map(toTopWord),
    newCues,
  };
}
