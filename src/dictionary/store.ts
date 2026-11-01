/**
 * The dictionary in the service worker (docs/plan.md §6): the packaged
 * data/dict.json is loaded into the IndexedDB `dict` table once per dictionary
 * version; the tokenizer's lexicon snapshot is kept beside it in `meta`, so a
 * restarted service worker reads one row instead of 17 000.
 */
import type { PhasaDb } from '../db/db';
import { snapshotFromEntries, type LexiconSnapshot } from './lexicon';
import type { DictEntry, DictFile, DictMeta } from './types';

const META_KEY = 'dictionary';

interface StoredDictionary {
  version: string;
  loadedAt: number;
  snapshot: LexiconSnapshot;
}

export interface DictionarySource {
  /** Header of the packaged dictionary (small). */
  meta(): Promise<DictMeta>;
  /** The whole packaged dictionary. */
  file(): Promise<DictFile>;
}

/** Reads data/dict.meta.json and data/dict.json from the extension package. */
export function packagedSource(resolve: (path: string) => string): DictionarySource {
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(resolve(path));
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  return {
    meta: () => get<DictMeta>('data/dict.meta.json'),
    file: () => get<DictFile>('data/dict.json'),
  };
}

export interface DictionaryStore {
  /** Loads the packaged dictionary if its version changed; resolves with the tokenizer lexicon. */
  lexicon(): Promise<LexiconSnapshot>;
  /** Dictionary entries of the given headwords that exist. */
  entries(words: Iterable<string>): Promise<Map<string, DictEntry>>;
}

export function createDictionaryStore(
  db: () => PhasaDb,
  source: DictionarySource,
  now: () => number = Date.now,
): DictionaryStore {
  let loading: Promise<LexiconSnapshot> | null = null;

  async function load(): Promise<LexiconSnapshot> {
    const database = db();
    const [stored, packaged] = await Promise.all([database.meta.get(META_KEY), source.meta()]);
    const current = stored?.value as StoredDictionary | undefined;
    if (current?.version === packaged.version) return current.snapshot;

    const file = await source.file();
    const snapshot = snapshotFromEntries(file.entries);
    const value: StoredDictionary = { version: file.meta.version, loadedAt: now(), snapshot };
    // Packaged entries only for now; AI-sourced entries (phase 5) will need to survive this.
    await database.transaction('rw', database.dict, database.meta, async () => {
      await database.dict.clear();
      await database.dict.bulkPut(file.entries);
      await database.meta.put({ key: META_KEY, value });
    });
    return snapshot;
  }

  const store: DictionaryStore = {
    lexicon() {
      loading ??= load().catch((error: unknown) => {
        loading = null; // let the next call retry
        throw error;
      });
      return loading;
    },
    async entries(words) {
      await store.lexicon();
      const keys = [...new Set(words)];
      const rows = await db().dict.bulkGet(keys);
      const found = new Map<string, DictEntry>();
      rows.forEach((row, index) => {
        const key = keys[index];
        if (row && key !== undefined) found.set(key, row);
      });
      return found;
    },
  };
  return store;
}
