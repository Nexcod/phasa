/**
 * AI answers in IndexedDB (`aiCache`, docs/plan.md §8.6): key = sha256(function + prompt
 * version + model + input). Oldest answers go once there are more than {@link MAX_ROWS}.
 */
import type { PhasaDb } from '../db/db';
import type { AiProviderId } from '../messaging/ai';

export const MAX_ROWS = 5000;

export interface CachedAnswer {
  fn: string;
  model: string;
  provider: AiProviderId;
  value: unknown;
}

export interface AiCache {
  get(key: string): Promise<CachedAnswer | undefined>;
  put(key: string, answer: CachedAnswer): Promise<void>;
}

export async function cacheKey(
  fn: string,
  version: number,
  model: string,
  input: unknown,
): Promise<string> {
  const text = JSON.stringify([fn, version, model, input]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The shape of a stored answer; its `value` is checked by the prompt (`Prompt.isValue`). */
export function isCachedAnswer(value: unknown): value is CachedAnswer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CachedAnswer).fn === 'string' &&
    typeof (value as CachedAnswer).model === 'string' &&
    'value' in value
  );
}

export function dbAiCache(db: () => PhasaDb, now: () => number = Date.now): AiCache {
  let writes = 0;
  return {
    async get(key) {
      const row = await db().aiCache.get(key);
      return isCachedAnswer(row?.value) ? row.value : undefined;
    },
    async put(key, answer) {
      const database = db();
      await database.aiCache.put({ key, value: answer, createdAt: now() });
      if (++writes % 50 !== 1) return;
      const excess = (await database.aiCache.count()) - MAX_ROWS;
      if (excess > 0) {
        const oldest = await database.aiCache.orderBy('createdAt').limit(excess).primaryKeys();
        await database.aiCache.bulkDelete(oldest);
      }
    },
  };
}
