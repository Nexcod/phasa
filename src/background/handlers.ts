import { SCHEMA_VERSION } from '../db/schema';
import type { PhasaDb } from '../db/db';
import { createDictionaryStore, type DictionarySource } from '../dictionary/store';
import type { DictEntry } from '../dictionary/types';
import {
  MAX_LOOKUP_WORDS,
  MAX_STATUS_WORDS,
  MAX_TOKENIZE_TEXTS,
  RpcFailure,
  type ServerEvent,
} from '../messaging/protocol';
import type { Handlers } from '../messaging/server';
import { parseSettingsPatch, settingsFromRows, type Settings } from '../settings';
import {
  MAX_UNIT_CHARS,
  addSegRule,
  deleteSegRule,
  deleteUnit,
  listSegRules,
  listUnits,
  parseContext,
  parseKind,
  parseSegRule,
  parseStatus,
  setUnit,
  statusesOf,
  unitKey,
} from '../vocab/store';
import { getCachedTracks, processAndStore, validateProcessParams } from './captions';
import { createLanguageService, type TokenizeInput } from './language';

export interface HandlerDeps {
  db: () => PhasaDb;
  swStartedAt: number;
  /** The packaged dictionary (data/dict.json); lookups and tokenizing fail without one. */
  dictionarySource?: DictionarySource;
  /** Push an event to every connected context. */
  broadcast?: (event: ServerEvent) => void;
  now?: () => number;
}

const MAX_TOKENIZE_CHARS = 2000;

async function readSettings(db: PhasaDb): Promise<Settings> {
  return settingsFromRows(await db.settings.toArray());
}

function badRequest(message: string): never {
  throw new RpcFailure('bad_request', message);
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) badRequest('Invalid word list');
  return (value as unknown[]).map((word) => {
    if (typeof word !== 'string' || word.length === 0 || word.length > MAX_UNIT_CHARS) {
      badRequest('Invalid word');
    }
    return word;
  });
}

function tokenizeInputs(value: unknown): TokenizeInput[] {
  if (!Array.isArray(value) || value.length > MAX_TOKENIZE_TEXTS) badRequest('Invalid texts');
  return (value as unknown[]).map((item) => {
    const { text, hints } = (item ?? {}) as { text?: unknown; hints?: unknown };
    if (typeof text !== 'string' || text.length > MAX_TOKENIZE_CHARS) badRequest('Invalid text');
    if (hints === undefined) return { text };
    if (
      !Array.isArray(hints) ||
      !hints.every((hint) => Number.isInteger(hint) && hint > 0 && hint < text.length)
    ) {
      badRequest('Invalid hints');
    }
    return { text, hints: hints as number[] };
  });
}

const missingDictionary: DictionarySource = {
  meta: () => Promise.reject(new Error('No dictionary source')),
  file: () => Promise.reject(new Error('No dictionary source')),
};

export function createHandlers({
  db,
  swStartedAt,
  dictionarySource = missingDictionary,
  broadcast = () => undefined,
  now = Date.now,
}: HandlerDeps): Handlers {
  const dictionary = createDictionaryStore(db, dictionarySource, now);
  const language = createLanguageService(db, dictionary);
  const segmentationChanged = () => {
    language.invalidate();
    broadcast({ type: 'segmentation/changed' });
  };

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

    'thai/tokenize': async ({ texts }) => ({
      tokens: await language.tokenize(tokenizeInputs(texts)),
    }),

    'dict/lookup': async ({ words }) => ({
      results: await language.lookup(stringList(words, MAX_LOOKUP_WORDS)),
    }),

    'vocab/statuses': async ({ words }) => ({
      statuses: await statusesOf(db(), stringList(words, MAX_STATUS_WORDS)),
    }),

    'vocab/set': async (params) => {
      const kind = parseKind(params.kind);
      const input = {
        kind,
        thai: unitKey(params.thai),
        status: parseStatus(params.status),
        ...(params.context === undefined ? {} : { context: parseContext(params.context) }),
      };
      const database = db();
      const isNewPhrase =
        kind === 'phrase' && !(await database.phrases.where('thai').equals(input.thai).first());
      const unit = await setUnit(database, input, now());
      const entries = await dictionary
        .entries([unit.thai])
        .catch(() => new Map<string, DictEntry>());
      const entry = entries.get(unit.thai);
      if (entry?.senses[0]?.glosses[0]) unit.gloss = entry.senses[0].glosses[0];
      if (entry?.romanization?.paiboon) unit.romanization = entry.romanization.paiboon;
      broadcast({
        type: 'vocab/changed',
        changes: [{ kind, thai: unit.thai, status: unit.status }],
      });
      // A new phrase without spaces becomes one token (ADR 0005).
      if (isNewPhrase && !unit.thai.includes(' ')) segmentationChanged();
      return { unit };
    },

    'vocab/delete': async (params) => {
      const kind = parseKind(params.kind);
      const thai = unitKey(params.thai);
      const deleted = await deleteUnit(db(), kind, thai);
      if (deleted) {
        broadcast({ type: 'vocab/changed', changes: [{ kind, thai, status: null }] });
        if (kind === 'phrase' && !thai.includes(' ')) segmentationChanged();
      }
      return { deleted };
    },

    'vocab/list': async (params) => {
      const limit = params.limit ?? 50;
      const offset = params.offset ?? 0;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) badRequest('Invalid limit');
      if (!Number.isInteger(offset) || offset < 0) badRequest('Invalid offset');
      if (params.videoId !== undefined && typeof params.videoId !== 'string')
        badRequest('Invalid videoId');
      if (params.query !== undefined && typeof params.query !== 'string')
        badRequest('Invalid query');
      return listUnits(
        db(),
        {
          ...(params.kind === undefined ? {} : { kind: parseKind(params.kind) }),
          ...(params.videoId === undefined ? {} : { videoId: params.videoId }),
          ...(params.query ? { query: params.query.slice(0, MAX_UNIT_CHARS) } : {}),
          limit,
          offset,
        },
        (words) => dictionary.entries(words).catch(() => new Map<string, DictEntry>()),
      );
    },

    'segrules/list': async () => ({ rules: await listSegRules(db()) }),

    'segrules/add': async ({ kind, parts }) => {
      const rule = await addSegRule(db(), parseSegRule(kind, parts), now());
      segmentationChanged();
      return { rule };
    },

    'segrules/delete': async ({ key }) => {
      if (typeof key !== 'string' || key.length > 2000) badRequest('Invalid key');
      const deleted = await deleteSegRule(db(), key);
      if (deleted) segmentationChanged();
      return { deleted };
    },
  };
}
