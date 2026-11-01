/**
 * The corpus frequency list (data/build/freq.json: 30 000 Thai words by TNC
 * count, ADR 0004/0010) in the service worker. The dictionary carries ranks
 * only for its own headwords; the analysis also needs them for words it lacks
 * (plan §7.2 `freqProfile`), and onboarding needs the list itself (plan §2.1:
 * mark the top N as known). Read from the extension package on first use and
 * kept in memory: a local fetch, no IndexedDB copy.
 */

export interface FrequencyFile {
  meta: { version: string };
  /** Most frequent first. */
  words: string[];
}

export interface FrequencyList {
  /** 1 = most frequent; undefined when not in the list. */
  rank(word: string): number | undefined;
  /** Most frequent first. */
  readonly words: readonly string[];
}

export function frequencyList(words: readonly string[]): FrequencyList {
  const ranks = new Map<string, number>();
  words.forEach((word, index) => {
    if (!ranks.has(word)) ranks.set(word, index + 1);
  });
  return { rank: (word) => ranks.get(word), words };
}

export type FrequencySource = () => Promise<FrequencyFile>;

/** Reads data/freq.json from the extension package. */
export function packagedFrequency(resolve: (path: string) => string): FrequencySource {
  return async () => {
    const response = await fetch(resolve('data/freq.json'));
    if (!response.ok) throw new Error(`data/freq.json: HTTP ${response.status}`);
    return (await response.json()) as FrequencyFile;
  };
}

/** Loads the list once; a failed load is retried on the next call. */
export function createFrequencyStore(source: FrequencySource): () => Promise<FrequencyList> {
  let loading: Promise<FrequencyList> | null = null;
  return () =>
    (loading ??= source()
      .then((file) => frequencyList(file.words))
      .catch((error: unknown) => {
        loading = null;
        throw error;
      }));
}
