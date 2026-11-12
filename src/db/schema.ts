import type { Transaction } from 'dexie';

export interface SchemaStep {
  version: number;
  /** Dexie store definitions; `null` deletes a table. Only list tables that change. */
  stores: Record<string, string | null>;
  upgrade?: (tx: Transaction) => Promise<void> | void;
}

/**
 * Append-only list of schema versions. Never edit a released step: add a new
 * one with the changed stores and an `upgrade` that migrates existing rows.
 */
export const SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    version: 1,
    stores: {
      words: '++id, &thai, status, updatedAt, nextReviewAt',
      contexts: '++id, wordId, videoId, [wordId+videoId]',
      phrases: '++id, &thai, status, updatedAt',
      videos: 'videoId, analyzedAt',
      captions: '[videoId+vssId], videoId',
      segRules: '++id, &key',
      aiCache: 'key, createdAt',
      dict: 'thai, freqRank',
      settings: 'key',
    },
  },
  {
    // Phase 3: contexts of saved phrases; `meta` holds the loaded dictionary's version and the
    // tokenizer's lexicon snapshot (src/dictionary/store.ts).
    version: 2,
    stores: {
      contexts: '++id, wordId, phraseId, videoId, [wordId+videoId]',
      meta: 'key',
    },
  },
  {
    // Phase 5: OpenAI credentials (src/auth/credentials.ts). Not in chrome.storage.local, which
    // content scripts can read (ADR 0014). Never part of an export.
    version: 3,
    stores: {
      credentials: 'key',
    },
  },
  {
    // Phase 6: least recently used caption tracks are evicted (src/background/captions.ts).
    version: 4,
    stores: {
      captions: '[videoId+vssId], videoId, usedAt',
    },
    upgrade: async (tx) => {
      await tx
        .table('captions')
        .toCollection()
        .modify((row: { fetchedAt: number; usedAt?: number }) => {
          row.usedAt = row.fetchedAt;
        });
    },
  },
];

/** Tables a backup export must leave out (docs/decisions/0014-ai-and-account.md). */
export const SECRET_TABLES: readonly string[] = ['credentials'];

export const SCHEMA_VERSION = SCHEMA_STEPS.reduce((max, step) => Math.max(max, step.version), 0);
