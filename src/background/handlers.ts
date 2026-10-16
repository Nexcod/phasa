import type { PhasaDb } from '../db/db';
import { SCHEMA_VERSION } from '../db/schema';
import type { Handlers } from '../messaging/server';

export interface HandlerDeps {
  db: () => PhasaDb;
  swStartedAt: number;
}

export function createHandlers({ db, swStartedAt }: HandlerDeps): Handlers {
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
  };
}
