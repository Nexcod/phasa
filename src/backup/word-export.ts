/**
 * Saved words as files for other tools (docs/plan.md §2.1 "Данные"): an Anki deck as TSV with the
 * plan's fields Thai, Romanization, Meaning, Sentence, Translation, Video link (plus tags), and a
 * CSV word list. Formatting only; the service worker gathers the entries (src/background/data.ts).
 */
import { formatTime, watchUrl } from '../ui/labels';
import type { UnitKind, WordStatus } from '../vocab/types';

export type WordExportFormat = 'anki' | 'csv';
/** Which saved units: learning ones (1–4), also the known ones, or every saved word and phrase. */
export type WordExportScope = 'learning' | 'learning-known' | 'all';

export const WORD_EXPORT_FORMATS: readonly WordExportFormat[] = ['anki', 'csv'];
export const WORD_EXPORT_SCOPES: readonly WordExportScope[] = ['learning', 'learning-known', 'all'];

export function scopeStatuses(scope: WordExportScope): readonly WordStatus[] {
  switch (scope) {
    case 'learning':
      return [1, 2, 3, 4];
    case 'learning-known':
      return [1, 2, 3, 4, 'known'];
    case 'all':
      return ['new', 1, 2, 3, 4, 'known', 'ignored'];
  }
}

export interface ExportMeaning {
  /** Part of speech as shown to the learner, e.g. "noun". */
  pos?: string;
  glosses: string[];
}

export interface ExportEntry {
  kind: UnitKind;
  thai: string;
  status: WordStatus;
  createdAt: number;
  /** In the system chosen in the settings; empty when unknown. */
  romanization: string;
  meanings: ExportMeaning[];
  /** For words the dictionary lacks, and phrases: their words with a gloss each. */
  parts: { thai: string; gloss?: string }[];
  /** The newest line it was saved with. */
  context?: {
    sentence: string;
    translation?: string;
    videoId: string;
    videoTitle: string;
    cueStartMs: number;
  };
}

/** At most this many senses of a word go into the Meaning field. */
const MAX_SENSES = 4;

export function statusCode(status: WordStatus): string {
  return typeof status === 'number' ? `learning-${status}` : status;
}

// --- Anki ------------------------------------------------------------------------------------

/** Text in an HTML field: escaped, on one line (tabs and newlines would split the record). */
function html(text: string): string {
  return text
    .replace(/[\t\r\n]+/gu, ' ')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function ankiMeaning(entry: ExportEntry): string {
  if (entry.meanings.length > 0) {
    return entry.meanings
      .slice(0, MAX_SENSES)
      .map((sense) => {
        const glosses = html(sense.glosses.join('; '));
        return sense.pos ? `<i>${html(sense.pos)}</i> ${glosses}` : glosses;
      })
      .join('<br>');
  }
  return entry.parts
    .map((part) => (part.gloss ? `${html(part.thai)} — ${html(part.gloss)}` : html(part.thai)))
    .join('<br>');
}

/** The line with the saved word or phrase in bold. */
function ankiSentence(sentence: string, thai: string): string {
  const at = sentence.indexOf(thai);
  if (at < 0) return html(sentence);
  return `${html(sentence.slice(0, at))}<b>${html(thai)}</b>${html(sentence.slice(at + thai.length))}`;
}

function ankiTags(entry: ExportEntry): string {
  const tags = ['phasa', `phasa::${statusCode(entry.status)}`];
  if (entry.kind === 'phrase') tags.push('phasa::phrase');
  return tags.join(' ');
}

const ANKI_COLUMNS = [
  'Thai',
  'Romanization',
  'Meaning',
  'Sentence',
  'Translation',
  'Video link',
  'Tags',
];

/**
 * Anki's text import (File → Import): tab-separated, HTML fields, header lines that set the
 * separator, HTML and the tags column (Anki 2.1.55+; older versions show them as a first note).
 */
export function ankiText(entries: readonly ExportEntry[]): string {
  const lines = [
    '#separator:tab',
    '#html:true',
    `#columns:${ANKI_COLUMNS.join('\t')}`,
    `#tags column:${ANKI_COLUMNS.length}`,
  ];
  for (const entry of entries) {
    const context = entry.context;
    const link = context
      ? `<a href="${html(watchUrl(context.videoId, context.cueStartMs))}">${html(
          context.videoTitle || 'YouTube',
        )} · ${formatTime(context.cueStartMs)}</a>`
      : '';
    lines.push(
      [
        html(entry.thai),
        html(entry.romanization),
        ankiMeaning(entry),
        context ? ankiSentence(context.sentence, entry.thai) : '',
        context?.translation ? html(context.translation) : '',
        link,
        ankiTags(entry),
      ].join('\t'),
    );
  }
  return `${lines.join('\n')}\n`;
}

// --- CSV -------------------------------------------------------------------------------------

/**
 * One RFC 4180 field. Text from elsewhere (video titles, glosses) that starts like a formula gets
 * a leading apostrophe, so a spreadsheet shows it instead of running it.
 */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

function plainMeaning(entry: ExportEntry): string {
  if (entry.meanings.length > 0) {
    return entry.meanings
      .slice(0, MAX_SENSES)
      .map((sense) => (sense.pos ? `${sense.pos}: ` : '') + sense.glosses.join('; '))
      .join(' | ');
  }
  return entry.parts
    .map((part) => (part.gloss ? `${part.thai} (${part.gloss})` : part.thai))
    .join(' · ');
}

const CSV_COLUMNS = [
  'Thai',
  'Romanization',
  'Meaning',
  'Status',
  'Type',
  'Sentence',
  'Translation',
  'Video',
  'Link',
  'Added',
];

/** A spreadsheet-friendly word list: UTF-8 with a BOM (Excel then reads Thai), CRLF lines. */
export function csvText(entries: readonly ExportEntry[]): string {
  const rows = [CSV_COLUMNS];
  for (const entry of entries) {
    const context = entry.context;
    rows.push([
      entry.thai,
      entry.romanization,
      plainMeaning(entry),
      statusCode(entry.status),
      entry.kind,
      context?.sentence ?? '',
      context?.translation ?? '',
      context?.videoTitle ?? '',
      context ? watchUrl(context.videoId, context.cueStartMs) : '',
      new Date(entry.createdAt).toISOString().slice(0, 10),
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}
