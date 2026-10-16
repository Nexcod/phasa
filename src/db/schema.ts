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
];

export const SCHEMA_VERSION = SCHEMA_STEPS.reduce((max, step) => Math.max(max, step.version), 0);
