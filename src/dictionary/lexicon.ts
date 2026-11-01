/**
 * The tokenizer's view of the dictionary and the user's own units
 * (src/thai/tokenizer.ts): which strings are whole words and which must split.
 */
import type { TokenizerLexicon } from '../thai/tokenizer';

/** What the service worker keeps in memory: headwords plus the compositional ones' parts. */
export interface LexiconSnapshot {
  /** Every dictionary headword, compositional ones included. */
  words: string[];
  /** Compositional headwords (src/thai/convention.ts) → parts. */
  parts: Record<string, string[]>;
  /** Headword → corpus frequency rank, for those that have one. */
  ranks: Record<string, number>;
}

export function snapshotFromEntries(
  entries: Iterable<{ thai: string; parts?: string[]; freqRank?: number }>,
): LexiconSnapshot {
  const words: string[] = [];
  const parts: Record<string, string[]> = {};
  const ranks: Record<string, number> = {};
  for (const entry of entries) {
    words.push(entry.thai);
    if (entry.parts) parts[entry.thai] = entry.parts;
    if (entry.freqRank !== undefined) ranks[entry.thai] = entry.freqRank;
  }
  return { words, parts, ranks };
}

export interface UserUnits {
  /** Saved phrases and merge rules: always whole. */
  merges: Iterable<string>;
  /** Split rules: word → parts. */
  splits: Iterable<readonly [string, readonly string[]]>;
}

export function createLexicon(
  snapshot: LexiconSnapshot,
  user: UserUnits = { merges: [], splits: [] },
): TokenizerLexicon {
  const dictionary = new Set(snapshot.words);
  const merges = new Set(user.merges);
  const splits = new Map<string, readonly string[]>(user.splits);
  return {
    isWord: (word) =>
      merges.has(word) ||
      (!splits.has(word) && dictionary.has(word) && !Object.hasOwn(snapshot.parts, word)),
    isUserUnit: (word) => merges.has(word),
    partsOf: (word) => {
      if (merges.has(word)) return undefined;
      return (
        splits.get(word) ?? (Object.hasOwn(snapshot.parts, word) ? snapshot.parts[word] : undefined)
      );
    },
    frequencyRank: (word) =>
      Object.hasOwn(snapshot.ranks, word) ? snapshot.ranks[word] : undefined,
  };
}
