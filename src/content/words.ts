/**
 * Word data for the Thai track on screen: tokens of every cue (from the
 * service worker's tokenizer), statuses of saved words, and dictionary
 * lookups. Lookups for every word of the video are prefetched in the
 * background, so opening a word needs no round trip (popup < 100 ms,
 * docs/plan.md §12 phase 3).
 */
import type { ProcessedCue } from '../captions/types';
import type { WordInfo } from '../dictionary/types';
import type { Client } from '../messaging/client';
import { MAX_LOOKUP_WORDS, MAX_STATUS_WORDS, MAX_TOKENIZE_TEXTS } from '../messaging/protocol';
import type { Token } from '../thai/types';
import type { ContextInput, UnitKind, WordStatus } from '../vocab/types';

export interface WordData {
  /** Track the data belongs to (`videoId/key`), null when there is none. */
  trackId: string | null;
  /** Tokens per Thai cue; null until tokenized. */
  tokens: readonly (readonly Token[])[] | null;
  /** Saved words and phrases of this track that are not new. */
  statuses: Readonly<Record<string, WordStatus>>;
  /** Lookups cached so far: changes as prefetching proceeds, so views re-render. */
  looked: number;
  /** True once every word of the track has been looked up. */
  prefetched: boolean;
}

export const EMPTY_WORD_DATA: WordData = {
  trackId: null,
  tokens: null,
  statuses: {},
  looked: 0,
  prefetched: false,
};

/** Unique Thai words in order of first appearance. */
export function uniqueWords(tokens: readonly (readonly Token[])[]): string[] {
  const seen = new Set<string>();
  for (const cue of tokens)
    for (const token of cue) if (token.kind === 'thai') seen.add(token.text);
  return [...seen];
}

/** `statuses` with `thai` set to `status`; new or deleted words are left out. */
function withStatus(
  statuses: Readonly<Record<string, WordStatus>>,
  thai: string,
  status: WordStatus | null | undefined,
): Record<string, WordStatus> {
  const out = Object.fromEntries(Object.entries(statuses).filter(([word]) => word !== thai));
  if (status !== null && status !== undefined && status !== 'new') out[thai] = status;
  return out;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface WordManager {
  /** The Thai track on screen changed (or went away). */
  setTrack(trackId: string | null, cues: readonly ProcessedCue[]): void;
  /** Lookup from the cache, or from the service worker. */
  lookup(word: string): Promise<WordInfo>;
  /** Cached lookup, if any: lets the popup render in the same frame. */
  cached(word: string): WordInfo | undefined;
  setStatus(
    kind: UnitKind,
    thai: string,
    status: WordStatus,
    context?: ContextInput,
  ): Promise<void>;
  forget(kind: UnitKind, thai: string): Promise<void>;
  dispose(): void;
}

export function createWordManager(
  client: Pick<Client, 'request' | 'onEvent'>,
  emit: (data: WordData) => void,
): WordManager {
  let data: WordData = EMPTY_WORD_DATA;
  let cues: readonly ProcessedCue[] = [];
  let generation = 0;
  const infos = new Map<string, WordInfo>();
  const pending = new Map<string, Promise<WordInfo>>();

  const update = (patch: Partial<WordData>) => {
    data = { ...data, ...patch };
    emit(data);
  };

  async function fetchInfos(words: readonly string[]): Promise<void> {
    for (const batch of chunks(
      words.filter((word) => !infos.has(word)),
      MAX_LOOKUP_WORDS,
    )) {
      const { results } = await client.request(
        'dict/lookup',
        { words: batch },
        { timeoutMs: 60_000 },
      );
      for (const info of results) infos.set(info.thai, info);
      update({ looked: infos.size });
    }
  }

  async function fetchStatuses(words: readonly string[]): Promise<Record<string, WordStatus>> {
    const statuses: Record<string, WordStatus> = {};
    for (const batch of chunks(words, MAX_STATUS_WORDS)) {
      Object.assign(statuses, (await client.request('vocab/statuses', { words: batch })).statuses);
    }
    return statuses;
  }

  /** Tokenizes the track, then statuses, then prefetches lookups. Stale runs stop quietly. */
  async function load(): Promise<void> {
    const run = ++generation;
    const current = () => run === generation;
    if (!data.trackId || cues.length === 0) return;
    try {
      const tokens: Token[][] = [];
      for (const batch of chunks(cues, MAX_TOKENIZE_TEXTS)) {
        const texts = batch.map((cue) =>
          cue.hints ? { text: cue.text, hints: cue.hints } : { text: cue.text },
        );
        // The first call after install also loads the dictionary into IndexedDB.
        const result = await client.request('thai/tokenize', { texts }, { timeoutMs: 60_000 });
        tokens.push(...result.tokens);
      }
      if (!current()) return;
      update({ tokens });
      const words = uniqueWords(tokens);
      const statuses = await fetchStatuses(words);
      if (!current()) return;
      update({ statuses });
      await fetchInfos(words);
      if (current()) update({ prefetched: true });
    } catch (error) {
      if (current()) console.debug('[phasa] word data load failed', error);
    }
  }

  const unsubscribe = client.onEvent((event) => {
    if (event.type === 'vocab/changed') {
      let statuses = data.statuses;
      for (const change of event.changes)
        statuses = withStatus(statuses, change.thai, change.status);
      update({ statuses });
    } else if (event.type === 'segmentation/changed') {
      void load();
    } else if (event.type === 'sw/hello' && data.tokens) {
      // Reconnected: statuses may have changed while the port was down.
      const tokens = data.tokens;
      fetchStatuses(uniqueWords(tokens)).then(
        (statuses) => {
          if (data.tokens === tokens) update({ statuses });
        },
        () => undefined,
      );
    }
  });

  return {
    setTrack(trackId, nextCues) {
      if (trackId === data.trackId) return;
      cues = nextCues;
      generation++;
      update({ ...EMPTY_WORD_DATA, trackId });
      void load();
    },

    cached: (word) => infos.get(word),

    lookup(word) {
      const known = infos.get(word);
      if (known) return Promise.resolve(known);
      let request = pending.get(word);
      if (!request) {
        request = client.request('dict/lookup', { words: [word] }).then(({ results }) => {
          const info = results[0] ?? { thai: word };
          infos.set(word, info);
          return info;
        });
        request.finally(() => pending.delete(word)).catch(() => undefined);
        pending.set(word, request);
      }
      return request;
    },

    async setStatus(kind, thai, status, context) {
      const previous = data.statuses[thai];
      update({ statuses: withStatus(data.statuses, thai, status) }); // optimistic; the broadcast confirms
      try {
        await client.request(
          'vocab/set',
          context ? { kind, thai, status, context } : { kind, thai, status },
        );
      } catch (error) {
        update({ statuses: withStatus(data.statuses, thai, previous) });
        throw error;
      }
    },

    async forget(kind, thai) {
      await client.request('vocab/delete', { kind, thai });
    },

    dispose() {
      generation++;
      unsubscribe();
    },
  };
}
