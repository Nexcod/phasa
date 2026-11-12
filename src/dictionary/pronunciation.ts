/**
 * Romanization and tones of a word from the best available source
 * (docs/plan.md §5.5): the dictionary entry, else the entries of its parts for
 * a compound the dictionary lacks, else spelling rules (approximate). AI
 * pronunciations (source 3) arrive with phase 5.
 */
import type { RomanizationSystem } from '../settings';
import { romanizeByRules } from '../thai/romanize';
import type { Tone } from '../thai/types';
import type { DictEntry } from './types';

export type PronunciationSource = 'dictionary' | 'compound' | 'rules';

export interface PronouncedSyllable {
  /** Thai: the phonemic respelling from the dictionary, or the written syllable for rules. */
  text?: string;
  paiboon: string;
  tone: Tone;
}

export interface Pronunciation {
  syllables: PronouncedSyllable[];
  /** Paiboon+ with tone diacritics, syllables joined by `-`. */
  paiboon: string;
  /** Royal Thai General System, when known. */
  rtgs?: string;
  source: PronunciationSource;
}

export function fromEntry(entry: DictEntry): Pronunciation | undefined {
  const syllables = entry.syllables;
  if (!syllables || syllables.length === 0) return undefined;
  const pronunciation: Pronunciation = {
    syllables: syllables.map((syllable) => {
      const out: PronouncedSyllable = { paiboon: syllable.roman, tone: syllable.tone };
      if (syllable.text) out.text = syllable.text;
      return out;
    }),
    paiboon: entry.romanization?.paiboon ?? syllables.map((syllable) => syllable.roman).join('-'),
    source: 'dictionary',
  };
  const rtgs = entry.romanization?.rtgs;
  if (rtgs) pronunciation.rtgs = rtgs;
  return pronunciation;
}

function joinParts(parts: readonly Pronunciation[]): Pronunciation {
  const pronunciation: Pronunciation = {
    syllables: parts.flatMap((part) => part.syllables),
    paiboon: parts.map((part) => part.paiboon).join(' '),
    source: 'compound',
  };
  if (parts.every((part) => part.rtgs)) {
    pronunciation.rtgs = parts.map((part) => part.rtgs).join(' ');
  }
  return pronunciation;
}

export function fromRules(word: string): Pronunciation | undefined {
  const syllables = romanizeByRules(word);
  if (!syllables) return undefined;
  return {
    syllables: syllables.map(({ text, paiboon, tone }) => ({ text, paiboon, tone })),
    paiboon: syllables.map((syllable) => syllable.paiboon).join('-'),
    rtgs: syllables.map((syllable) => syllable.rtgs).join(''),
    source: 'rules',
  };
}

/**
 * Pronunciation of `word`. `parts` is its split into dictionary words when it
 * isn't one itself; `entries` holds the entries of the word and of its parts.
 */
export function pronounce(
  word: string,
  entries: ReadonlyMap<string, DictEntry>,
  parts: readonly string[] | null,
): Pronunciation | undefined {
  const own = entries.get(word);
  const direct = own && fromEntry(own);
  if (direct) return direct;
  if (parts && parts.length > 1) {
    const pieces = parts.map((part) => {
      const entry = entries.get(part);
      return (entry && fromEntry(entry)) ?? fromRules(part);
    });
    if (pieces.every((piece) => piece !== undefined)) {
      const joined = joinParts(pieces);
      if (pieces.some((piece) => piece.source === 'rules')) joined.source = 'rules';
      return joined;
    }
  }
  return fromRules(word);
}

/** Plain-text romanization in the chosen system, for labels, lists and exports. */
export function romanizationText(pronunciation: Pronunciation, system: RomanizationSystem): string {
  if (system === 'rtgs' && pronunciation.rtgs) return pronunciation.rtgs;
  return pronunciation.syllables.map((syllable) => syllable.paiboon).join('-');
}
