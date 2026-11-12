import { isVideoId } from '../captions/bridge';
import { SCHEMA_VERSION } from '../db/schema';
import type { PhasaDb } from '../db/db';
import { createFrequencyStore, type FrequencySource } from '../dictionary/frequency';
import { createDictionaryStore, type DictionarySource } from '../dictionary/store';
import type { DictEntry, PartOfSpeech } from '../dictionary/types';
import {
  MAX_EVENT_CHANGES,
  MAX_LOOKUP_WORDS,
  MAX_STATUS_WORDS,
  MAX_TOKENIZE_TEXTS,
  RpcFailure,
  type ServerEvent,
} from '../messaging/protocol';
import type { Handlers } from '../messaging/server';
import { AI_SETTING_KEYS, parseSettingsPatch, settingsFromRows, type Settings } from '../settings';
import { normalizeThai } from '../thai/normalize';
import {
  MAX_UNIT_CHARS,
  addSegRule,
  bulkSetWords,
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
  vocabCounts,
} from '../vocab/store';
import { FREQUENT_COUNTS, type BulkMode, type VocabChange, type WordStatus } from '../vocab/types';
import { disabledAiHandlers, type AiHandlers } from './ai';
import { createAnalysisService } from './analysis';
import { getCachedTracks, processAndStore, validateProcessParams } from './captions';
import { createDataHandlers } from './data';
import { createLanguageService, type TokenizeInput } from './language';
import { frequentWords } from './onboarding';

export interface HandlerDeps {
  db: () => PhasaDb;
  swStartedAt: number;
  /** The packaged dictionary (data/dict.json); lookups and tokenizing fail without one. */
  dictionarySource?: DictionarySource;
  /** The packaged frequency list (data/freq.json); analysis and onboarding fail without one. */
  frequencySource?: FrequencySource;
  /** Push an event to every connected context. */
  broadcast?: (event: ServerEvent) => void;
  /** The `ai/*` and `account/*` methods (src/background/ai.ts); disabled without them. */
  ai?: AiHandlers;
  /** An AI setting changed: readiness may differ now. */
  aiChanged?: () => void;
  /** The extension's version, written into backups. */
  appVersion?: string;
  /** Part of speech as the learner reads it, for word-list exports (src/ui/labels.ts). */
  posLabel?: (pos: PartOfSpeech) => string;
  now?: () => number;
}

const MAX_TOKENIZE_CHARS = 2000;

async function readSettings(db: PhasaDb): Promise<Settings> {
  return settingsFromRows(await db.settings.toArray());
}

function badRequest(message: string): never {
  throw new RpcFailure('bad_request', message);
}

function stringList(value: unknown, max: number, maxChars = MAX_UNIT_CHARS): string[] {
  if (!Array.isArray(value) || value.length > max) badRequest('Invalid word list');
  return (value as unknown[]).map((word) => {
    if (typeof word !== 'string' || word.length === 0 || word.length > maxChars) {
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

const missingFrequency: FrequencySource = () => Promise.reject(new Error('No frequency source'));

/** A caption track key as the player names it: `.th`, `a.th`, `.en`, `a.th>en`. */
function trackKeyParam(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40)
    badRequest(`Invalid ${field}`);
  return value;
}

function videoIdParam(value: unknown): string {
  if (!isVideoId(value)) badRequest('Invalid videoId');
  return value;
}

function savedStatus(value: unknown): WordStatus {
  const status = parseStatus(value);
  if (status === 'new') badRequest('Invalid status');
  return status;
}

function bulkMode(value: unknown): BulkMode {
  if (value !== 'advance' && value !== 'new-only') badRequest('Invalid mode');
  return value;
}

function optionalCount(value: unknown, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max)
    badRequest('Invalid count');
  return value as number;
}

export function createHandlers({
  db,
  swStartedAt,
  dictionarySource = missingDictionary,
  frequencySource = missingFrequency,
  broadcast = () => undefined,
  ai = disabledAiHandlers(),
  aiChanged = () => undefined,
  appVersion = '0.0.0',
  posLabel = (pos) => pos,
  now = Date.now,
}: HandlerDeps): Handlers {
  const dictionary = createDictionaryStore(db, dictionarySource, now);
  const frequency = createFrequencyStore(frequencySource);
  const language = createLanguageService(db, dictionary);
  const analysis = createAnalysisService({ db, language, dictionary, frequency, now });
  const segmentationChanged = () => {
    language.invalidate();
    analysis.invalidate();
    broadcast({ type: 'segmentation/changed' });
  };
  /** Broadcasts what changed, or a reload request when that is too much to list. */
  const vocabChanged = (changes: VocabChange[]) => {
    if (changes.length === 0) return;
    broadcast(
      changes.length > MAX_EVENT_CHANGES
        ? { type: 'vocab/changed', changes: [], reload: true }
        : { type: 'vocab/changed', changes },
    );
  };

  /** Settings were written: tell every context, and AI readiness may differ. */
  const settingsChanged = async (patch: Partial<Settings>): Promise<Settings> => {
    const settings = await readSettings(db());
    broadcast({ type: 'settings/changed', settings });
    if (AI_SETTING_KEYS.some((key) => Object.hasOwn(patch, key))) aiChanged();
    return settings;
  };

  return {
    ...ai,

    ...createDataHandlers({
      db,
      language,
      now,
      appVersion,
      posLabel,
      vocabChanged,
      segmentationChanged,
      settingsChanged,
    }),

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

    'captions/get': async ({ videoId }) => ({
      tracks: await getCachedTracks(db(), videoId, now()),
    }),

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
      return settingsChanged(valid);
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
      vocabChanged([{ kind, thai: unit.thai, status: unit.status }]);
      // A new phrase without spaces becomes one token (ADR 0005).
      if (isNewPhrase && !unit.thai.includes(' ')) segmentationChanged();
      return { unit };
    },

    'vocab/delete': async (params) => {
      const kind = parseKind(params.kind);
      const thai = unitKey(params.thai);
      const deleted = await deleteUnit(db(), kind, thai);
      if (deleted) {
        vocabChanged([{ kind, thai, status: null }]);
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

    'vocab/counts': () => vocabCounts(db()),

    'vocab/bulk-set': async (params) => {
      const status = savedStatus(params.status);
      const mode = bulkMode(params.mode);
      // Entries of an imported list may be whole sentences (an Anki card); they are split below.
      const entries = stringList(
        params.words,
        MAX_STATUS_WORDS,
        params.split ? MAX_TOKENIZE_CHARS : MAX_UNIT_CHARS,
      );
      let words: string[];
      if (params.split) {
        // A word list from elsewhere: whatever the tokenizer makes of each entry is what counts.
        const texts = entries.map((entry) => ({ text: normalizeThai(entry).text }));
        const tokens = await language.tokenize(texts);
        words = tokens.flatMap((cue) =>
          cue.flatMap((token) => (token.kind === 'thai' ? [token.text] : [])),
        );
      } else {
        words = entries.flatMap((entry) => {
          try {
            return [unitKey(entry)];
          } catch {
            return [];
          }
        });
      }
      const changes = await bulkSetWords(db(), words, status, mode, now());
      vocabChanged(changes);
      return { changed: changes.length, words: new Set(words).size };
    },

    'vocab/frequent': async ({ count }) => {
      if (!FREQUENT_COUNTS.includes(count as (typeof FREQUENT_COUNTS)[number]))
        badRequest('Invalid count');
      return { words: await frequentWords(count, { db, language, dictionary, frequency }) };
    },

    'analysis/video': async (params) => ({
      analysis: await analysis.analyze(
        videoIdParam(params.videoId),
        trackKeyParam(params.trackKey, 'trackKey'),
      ),
    }),

    'analysis/mark-new': async (params) => {
      const top = optionalCount(params.top, 100);
      const words =
        params.words === undefined ? undefined : stringList(params.words, MAX_STATUS_WORDS);
      const changes = await analysis.markNew({
        videoId: videoIdParam(params.videoId),
        trackKey: trackKeyParam(params.trackKey, 'trackKey'),
        ...(params.englishKey === undefined
          ? {}
          : { englishKey: trackKeyParam(params.englishKey, 'englishKey') }),
        status: savedStatus(params.status),
        ...(top === undefined ? {} : { top }),
        ...(words === undefined ? {} : { words }),
      });
      if (!changes) throw new RpcFailure('bad_request', 'No cached captions for this track');
      vocabChanged(changes);
      return { changed: changes.length };
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
