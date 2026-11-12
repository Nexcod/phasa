/**
 * Import and export in the service worker (docs/plan.md §2.1 "Данные", §9): the JSON backup and
 * the word lists for Anki and spreadsheets. Extension pages only (METHOD_ACCESS).
 */
import { exportBackup } from '../backup/export';
import { BACKUP_SECTIONS, MAX_IMPORT_ROWS, type BackupSection } from '../backup/format';
import {
  importAiAnswers,
  importSegRules,
  importSettings,
  importUnits,
  importVideos,
} from '../backup/import';
import {
  WORD_EXPORT_FORMATS,
  WORD_EXPORT_SCOPES,
  ankiText,
  csvText,
  scopeStatuses,
  type ExportEntry,
  type ExportMeaning,
  type WordExportScope,
} from '../backup/word-export';
import type { PhasaDb } from '../db/db';
import type { ContextRow, PhraseRow, WordRow } from '../db/types';
import { romanizationText } from '../dictionary/pronunciation';
import type { DictEntry, PartOfSpeech, WordInfo } from '../dictionary/types';
import { MAX_LOOKUP_WORDS, RpcFailure } from '../messaging/protocol';
import type { Handlers } from '../messaging/server';
import { settingsFromRows, type RomanizationSystem, type Settings } from '../settings';
import type { UnitKind, VocabChange } from '../vocab/types';
import type { LanguageService } from './language';

export interface DataDeps {
  db: () => PhasaDb;
  language: Pick<LanguageService, 'lookup'>;
  now: () => number;
  appVersion: string;
  /** Part of speech as shown to the learner (src/ui/labels.ts). */
  posLabel: (pos: PartOfSpeech) => string;
  vocabChanged: (changes: VocabChange[]) => void;
  segmentationChanged: () => void;
  /** Imported settings were written: broadcast them. */
  settingsChanged: (patch: Partial<Settings>) => Promise<unknown>;
}

export type DataHandlers = Pick<Handlers, 'data/export' | 'data/import' | 'data/export-words'>;

function badRequest(message: string): never {
  throw new RpcFailure('bad_request', message);
}

function isSection(value: unknown): value is BackupSection {
  return BACKUP_SECTIONS.includes(value as BackupSection);
}

function meaningsOf(info: WordInfo | undefined, posLabel: DataDeps['posLabel']): ExportMeaning[] {
  const senses = [...(info?.entry?.senses ?? []), ...(info?.main?.senses ?? [])];
  return senses
    .filter((sense) => sense.glosses.length > 0 && !sense.altOf)
    .map((sense) =>
      sense.pos ? { pos: posLabel(sense.pos), glosses: sense.glosses } : { glosses: sense.glosses },
    );
}

const firstGloss = (entry: DictEntry | undefined) =>
  entry?.senses.find((s) => !s.altOf)?.glosses[0];

/** Saved units of `scope` with dictionary data and their newest line, oldest first. */
export async function exportEntries(
  deps: Pick<DataDeps, 'db' | 'language' | 'posLabel'>,
  scope: WordExportScope,
  system: RomanizationSystem,
): Promise<ExportEntry[]> {
  const database = deps.db();
  const statuses = scopeStatuses(scope);
  const [words, phrases] = await Promise.all([
    database.words.where('status').anyOf(statuses).toArray(),
    database.phrases.where('status').anyOf(statuses).toArray(),
  ]);
  const newest = async (kind: UnitKind, rows: (WordRow | PhraseRow)[]) => {
    const field = kind === 'word' ? 'wordId' : 'phraseId';
    const contexts = await database.contexts
      .where(field)
      .anyOf(rows.map((row) => row.id))
      .toArray();
    const byOwner = new Map<number, ContextRow>();
    for (const context of contexts) {
      const id = context[field];
      if (id === undefined) continue;
      const current = byOwner.get(id);
      if (!current || context.createdAt > current.createdAt) byOwner.set(id, context);
    }
    return byOwner;
  };
  const [wordContexts, phraseContexts] = await Promise.all([
    newest('word', words),
    newest('phrase', phrases),
  ]);

  // Phrases written with spaces are looked up word by word.
  const pieces = (thai: string) => thai.split(' ').filter((piece) => piece !== '');
  const lookups = new Set<string>();
  for (const row of words) lookups.add(row.thai);
  for (const row of phrases) {
    lookups.add(row.thai);
    if (row.thai.includes(' ')) for (const piece of pieces(row.thai)) lookups.add(piece);
  }
  const infos = new Map<string, WordInfo>();
  const list = [...lookups];
  for (let i = 0; i < list.length; i += MAX_LOOKUP_WORDS) {
    for (const info of await deps.language.lookup(list.slice(i, i + MAX_LOOKUP_WORDS))) {
      infos.set(info.thai, info);
    }
  }

  const entry = (kind: UnitKind, row: WordRow | PhraseRow, context: ContextRow | undefined) => {
    const info = infos.get(row.thai);
    let romanization = info?.pronunciation ? romanizationText(info.pronunciation, system) : '';
    let parts = (info?.parts ?? []).map((part) => {
      const gloss = firstGloss(part.entry);
      return gloss ? { thai: part.thai, gloss } : { thai: part.thai };
    });
    if (row.thai.includes(' ')) {
      const words = pieces(row.thai).map((piece) => infos.get(piece));
      romanization = words
        .map((word) => (word?.pronunciation ? romanizationText(word.pronunciation, system) : ''))
        .filter((text) => text !== '')
        .join(' ');
      parts = pieces(row.thai).map((piece) => {
        const gloss = firstGloss(infos.get(piece)?.entry);
        return gloss ? { thai: piece, gloss } : { thai: piece };
      });
    }
    const out: ExportEntry = {
      kind,
      thai: row.thai,
      status: row.status,
      createdAt: row.createdAt,
      romanization,
      meanings: meaningsOf(info, deps.posLabel),
      parts,
    };
    if (context) {
      out.context = {
        sentence: context.sentence,
        videoId: context.videoId,
        videoTitle: context.videoTitle,
        cueStartMs: context.cueStartMs,
      };
      if (context.sentenceTranslation) out.context.translation = context.sentenceTranslation;
    }
    return out;
  };

  return [
    ...words.map((row) => entry('word', row, wordContexts.get(row.id))),
    ...phrases.map((row) => entry('phrase', row, phraseContexts.get(row.id))),
  ].sort((a, b) => a.createdAt - b.createdAt);
}

export function createDataHandlers(deps: DataDeps): DataHandlers {
  const { db, now } = deps;
  return {
    'data/export': async () => ({
      backup: await exportBackup(db(), { now: now(), appVersion: deps.appVersion }),
    }),

    'data/import': async (params) => {
      const { section } = params;
      if (!isSection(section)) badRequest('Invalid section');
      const database = db();
      if (section === 'settings') {
        const { summary, patch } = await importSettings(database, params.settings);
        if (Object.keys(patch).length > 0) await deps.settingsChanged(patch);
        return { summary };
      }
      const rows = params.rows;
      if (!Array.isArray(rows) || rows.length > MAX_IMPORT_ROWS) badRequest('Invalid rows');
      switch (section) {
        case 'words':
        case 'phrases': {
          const kind = section === 'words' ? 'word' : 'phrase';
          const result = await importUnits(database, kind, rows, now());
          deps.vocabChanged(result.changes);
          if (result.segmentation) deps.segmentationChanged();
          return { summary: result.summary };
        }
        case 'segRules': {
          const result = await importSegRules(database, rows, now());
          if (result.changed) deps.segmentationChanged();
          return { summary: result.summary };
        }
        case 'videos':
          return { summary: await importVideos(database, rows) };
        case 'aiAnswers':
          return { summary: await importAiAnswers(database, rows, now()) };
      }
    },

    'data/export-words': async (params) => {
      if (!WORD_EXPORT_FORMATS.includes(params.format)) {
        badRequest('Invalid format');
      }
      if (!WORD_EXPORT_SCOPES.includes(params.scope)) badRequest('Invalid scope');
      const settings = settingsFromRows(await db().settings.toArray());
      const entries = await exportEntries(deps, params.scope, settings.romanizationSystem);
      return {
        text: params.format === 'anki' ? ankiText(entries) : csvText(entries),
        count: entries.length,
      };
    },
  };
}
