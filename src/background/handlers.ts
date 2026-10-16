import { SCHEMA_VERSION } from '../db/schema';
import type { PhasaDb } from '../db/db';
import { RpcFailure, type ServerEvent } from '../messaging/protocol';
import type { Handlers } from '../messaging/server';
import { parseSettingsPatch, settingsFromRows, type Settings } from '../settings';
import { getCachedTracks, processAndStore, validateProcessParams } from './captions';

export interface HandlerDeps {
  db: () => PhasaDb;
  swStartedAt: number;
  /** Push an event to every connected context. */
  broadcast?: (event: ServerEvent) => void;
  now?: () => number;
}

async function readSettings(db: PhasaDb): Promise<Settings> {
  return settingsFromRows(await db.settings.toArray());
}

export function createHandlers({
  db,
  swStartedAt,
  broadcast = () => undefined,
  now = Date.now,
}: HandlerDeps): Handlers {
  return {
    ping: ({ sentAt }) => ({ sentAt, swStartedAt }),

    'db/info': async () => {
      const database = db();
      const counts: Record<string, number> = {};
      await Promise.all(
        database.tables.map(async (table) => {
          counts[table.name] = await table.count();
        }),
      );
      return { schemaVersion: SCHEMA_VERSION, counts };
    },

    'captions/get': async ({ videoId }) => ({ tracks: await getCachedTracks(db(), videoId) }),

    'captions/process': async (params) =>
      processAndStore(db(), validateProcessParams(params), now()),

    'settings/get': () => readSettings(db()),

    'settings/set': async ({ patch }) => {
      const valid = parseSettingsPatch(patch);
      if (!valid) throw new RpcFailure('bad_request', 'Invalid settings');
      const database = db();
      await database.settings.bulkPut(
        Object.entries(valid).map(([key, value]) => ({ key, value })),
      );
      const settings = await readSettings(database);
      broadcast({ type: 'settings/changed', settings });
      return settings;
    },
  };
}
