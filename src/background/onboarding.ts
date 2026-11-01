/**
 * The most frequent words for onboarding (docs/plan.md §2.1: mark the top N
 * as known, review and unmark first). Taken from the corpus frequency list,
 * keeping only words the tokenizer shows as one unit: a compositional
 * headword such as `ไม่มี` never occurs in the subtitles (ADR 0010), so marking
 * it known would change nothing. Names are left out like in the statistics.
 */
import type { PhasaDb } from '../db/db';
import type { FrequencyList } from '../dictionary/frequency';
import type { DictionaryStore } from '../dictionary/store';
import { statusesOf } from '../vocab/store';
import type { FrequentWord } from '../vocab/types';
import type { LanguageService } from './language';

/** Candidates are tokenized this many at a time. */
const CHUNK = 1000;

export async function frequentWords(
  count: number,
  deps: {
    db: () => PhasaDb;
    language: Pick<LanguageService, 'tokenize'>;
    dictionary: DictionaryStore;
    frequency: () => Promise<FrequencyList>;
  },
): Promise<FrequentWord[]> {
  const freq = await deps.frequency();
  const words: FrequentWord[] = [];
  for (let start = 0; start < freq.words.length && words.length < count; start += CHUNK) {
    const chunk = freq.words.slice(start, start + CHUNK);
    const [tokens, entries] = await Promise.all([
      deps.language.tokenize(chunk.map((text) => ({ text }))),
      deps.dictionary.entries(chunk),
    ]);
    chunk.forEach((thai, index) => {
      if (words.length >= count) return;
      const [only, ...rest] = tokens[index] ?? [];
      if (!only || rest.length > 0 || only.kind !== 'thai' || only.text !== thai) return;
      const entry = entries.get(thai);
      if (entry?.isProperNoun) return;
      const word: FrequentWord = { thai, rank: start + index + 1 };
      const gloss = entry?.senses[0]?.glosses[0];
      if (gloss) word.gloss = gloss;
      if (entry?.romanization?.paiboon) word.romanization = entry.romanization.paiboon;
      words.push(word);
    });
  }
  const statuses = await statusesOf(
    deps.db(),
    words.map((word) => word.thai),
  );
  for (const word of words) {
    const status = statuses[word.thai];
    if (status !== undefined) word.status = status;
  }
  return words;
}
