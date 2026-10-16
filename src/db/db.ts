import { Dexie, type DexieOptions, type EntityTable, type Table } from 'dexie';
import { SCHEMA_STEPS } from './schema';
import type {
  AiCacheRow,
  CaptionTrackRow,
  ContextRow,
  DictRow,
  PhraseRow,
  SegRuleRow,
  SettingRow,
  VideoRow,
  WordRow,
} from './types';

export const DB_NAME = 'phasa';

export class PhasaDb extends Dexie {
  declare readonly words: EntityTable<WordRow, 'id'>;
  declare readonly contexts: EntityTable<ContextRow, 'id'>;
  declare readonly phrases: EntityTable<PhraseRow, 'id'>;
  declare readonly videos: Table<VideoRow, string>;
  declare readonly captions: Table<CaptionTrackRow, [string, string]>;
  declare readonly segRules: EntityTable<SegRuleRow, 'id'>;
  declare readonly aiCache: Table<AiCacheRow, string>;
  declare readonly dict: Table<DictRow, string>;
  declare readonly settings: Table<SettingRow, string>;

  constructor(name: string = DB_NAME, options?: DexieOptions) {
    super(name, options);
    for (const step of SCHEMA_STEPS) {
      const version = this.version(step.version).stores(step.stores);
      if (step.upgrade) version.upgrade(step.upgrade);
    }
  }
}

/**
 * IndexedDB is per-origin: in a content script it would be youtube.com's
 * database. Only the service worker, side panel and options page may open it
 * (docs/plan.md §3.2 rule 1).
 */
export function assertExtensionOrigin(): void {
  const protocol = (globalThis as { location?: { protocol?: string } }).location?.protocol;
  if (protocol !== undefined && protocol !== 'chrome-extension:') {
    throw new Error(
      `IndexedDB opened from ${protocol} — only extension-origin contexts may use the database`,
    );
  }
}

let instance: PhasaDb | undefined;

export function getDb(): PhasaDb {
  assertExtensionOrigin();
  return (instance ??= new PhasaDb());
}
