/**
 * Word lists to import as known (plan §2.1 onboarding): plain text or CSV with
 * one word per line, or an Anki deck exported as "Notes in Plain Text" (TSV,
 * `#key:value` header lines, HTML in fields). The first field of each line is
 * the word; the service worker normalizes and splits it into words.
 */

/** At most this many entries are read from one file. */
export const MAX_IMPORT_LINES = 50_000;
/** Longer fields are skipped: the service worker tokenizes at most this much text per entry. */
export const MAX_ENTRY_CHARS = 2000;

export interface ParsedWordList {
  /** Distinct first fields that contain Thai, in file order. */
  words: string[];
  /** Non-empty lines without Thai in their first field (headers, other languages), or too long. */
  skipped: number;
}

const THAI = /[\u0E01-\u0E5B]/u;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
};

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/giu, ' ')
    .replace(/<[^>]*>/gu, '')
    .replace(/&(\w+);/gu, (match, name: string) => ENTITIES[name] ?? match);
}

/** First field of a CSV line, with RFC 4180 quotes. */
function firstCsvField(line: string): string {
  if (!line.startsWith('"')) return line.split(',')[0] ?? '';
  let field = '';
  for (let i = 1; i < line.length; i++) {
    const char = line.charAt(i);
    if (char === '"') {
      if (line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        break;
      }
    } else {
      field += char;
    }
  }
  return field;
}

function firstField(line: string): string {
  if (line.includes('\t')) {
    const field = line.split('\t')[0] ?? '';
    // Anki quotes fields that contain the separator or quotes.
    return field.startsWith('"') ? firstCsvField(field) : field;
  }
  return firstCsvField(line);
}

export function parseWordList(text: string): ParsedWordList {
  const words: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const lines = text.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u);
  for (const line of lines.slice(0, MAX_IMPORT_LINES)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const word = stripHtml(firstField(line)).trim();
    if (!THAI.test(word) || word.length > MAX_ENTRY_CHARS) {
      skipped++;
      continue;
    }
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return { words, skipped };
}
