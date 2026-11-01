/**
 * Converts wiktextract (kaikki.org) Thai entries into compact {@link DictEntry}
 * records (docs/plan.md §6, ADR 0004). Pure functions; the download, file I/O
 * and frequency ranks live in scripts/build-dictionary.ts.
 */
import { normalizeThai } from '../thai/normalize';
import { paiboonTone, splitRomanSyllables } from '../thai/tones';
import type { DictEntry, DictSense, DictSyllable, PartOfSpeech, SenseTag } from './types';

export interface KaikkiSound {
  tags?: string[];
  raw_tags?: string[];
  roman?: string;
  other?: string;
  ipa?: string;
}

export interface KaikkiSense {
  glosses?: string[];
  tags?: string[];
  alt_of?: { word?: string }[];
  form_of?: { word?: string }[];
}

export interface KaikkiEntry {
  word: string;
  lang_code?: string;
  pos: string;
  sounds?: KaikkiSound[];
  forms?: { form?: string; tags?: string[] }[];
  senses?: KaikkiSense[];
}

const POS: Readonly<Record<string, PartOfSpeech>> = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adj',
  adv: 'adv',
  name: 'name',
  pron: 'pron',
  intj: 'intj',
  classifier: 'classifier',
  num: 'num',
  prep: 'prep',
  prep_phrase: 'phrase',
  conj: 'conj',
  particle: 'particle',
  det: 'det',
  phrase: 'phrase',
  proverb: 'proverb',
  prefix: 'prefix',
  suffix: 'suffix',
};

const TAGS: Readonly<Record<string, SenseTag>> = {
  formal: 'formal',
  informal: 'informal',
  colloquial: 'colloquial',
  slang: 'slang',
  archaic: 'archaic',
  obsolete: 'obsolete',
  dated: 'dated',
  literary: 'literary',
  poetic: 'poetic',
  vulgar: 'vulgar',
  offensive: 'offensive',
  derogatory: 'derogatory',
  humorous: 'humorous',
  rare: 'rare',
  dialectal: 'dialectal',
  Internet: 'internet',
  idiomatic: 'idiomatic',
  figuratively: 'figurative',
  abbreviation: 'abbreviation',
  initialism: 'abbreviation',
  clipping: 'abbreviation',
  misspelling: 'misspelling',
  royal: 'royal',
};

/** Thai letters, vowels, marks and digits; no spaces, \u0E46, \u0E2F or punctuation. */
const THAI_ONLY = /^[\u0E01-\u0E59]+$/u;
/** Thai block, but never inside a headword: \u0E2F, unassigned, \u0E3F, \u0E46, \u0E4F. */
const NOT_IN_WORDS = /[\u0E2F\u0E3B-\u0E3F\u0E46\u0E4F]/u;

export const MAX_SENSES = 10;
export const MAX_GLOSS_CHARS = 240;

/** The headword key of a raw word, or null if it can't be a single token. */
export function headwordKey(word: string): string | null {
  const key = normalizeThai(word).text;
  return THAI_ONLY.test(key) && !NOT_IN_WORDS.test(key) ? key : null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function hasRawTag(sound: KaikkiSound, tag: string): boolean {
  return sound.raw_tags?.includes(tag) ?? false;
}

/** Bound forms (`náam-`) are how a word sounds inside compounds, not alone. */
function isBound(sound: KaikkiSound): boolean {
  return hasRawTag(sound, 'bound form') || (sound.roman?.endsWith('-') ?? false);
}

function firstRoman(sounds: readonly KaikkiSound[], system: string): string | undefined {
  return sounds.find((sound) => hasRawTag(sound, system) && !isBound(sound) && sound.roman)?.roman;
}

function firstIpa(sounds: readonly KaikkiSound[]): string | undefined {
  return sounds.find((sound) => sound.ipa && !sound.ipa.endsWith('./') && !isBound(sound))?.ipa;
}

function phonemic(sounds: readonly KaikkiSound[]): string | undefined {
  return sounds.find(
    (sound) =>
      (hasRawTag(sound, 'Phonemic') || hasRawTag(sound, 'Orthographic/Phonemic')) &&
      !isBound(sound) &&
      sound.other,
  )?.other;
}

/** Syllables from Paiboon (tones from its diacritics), with the Thai respelling when it aligns. */
export function syllablesOf(paiboon: string, respelling?: string): DictSyllable[] {
  const romans = splitRomanSyllables(paiboon);
  const thai = respelling?.split(/[\s\-–]+/u).filter((part) => part !== '') ?? [];
  const aligned = thai.length === romans.length;
  return romans.map((roman, index) => {
    const syllable: DictSyllable = { roman, tone: paiboonTone(roman) };
    const text = aligned ? thai[index] : undefined;
    if (text) syllable.text = text;
    return syllable;
  });
}

function glossOf(glosses: readonly string[]): string | undefined {
  // Nested senses repeat the parent gloss first: ["to consume:", "to eat; to drink"].
  const gloss = glosses.length > 1 && glosses[0]?.endsWith(':') ? glosses.at(-1) : glosses[0];
  const trimmed = gloss?.trim();
  return trimmed ? truncate(trimmed, MAX_GLOSS_CHARS) : undefined;
}

function senseOf(raw: KaikkiSense, pos: PartOfSpeech, classifier?: string): DictSense | null {
  const gloss = glossOf(raw.glosses ?? []);
  if (!gloss) return null;
  const sense: DictSense = { pos, glosses: [gloss] };
  if (classifier && pos === 'noun') sense.classifier = classifier;
  const tags = [...new Set((raw.tags ?? []).flatMap((tag) => (TAGS[tag] ? [TAGS[tag]] : [])))];
  if (tags.length > 0) sense.tags = tags;
  const target = raw.alt_of?.[0]?.word ?? raw.form_of?.[0]?.word;
  const altOf = target ? headwordKey(target) : null;
  if (altOf) sense.altOf = altOf;
  return sense;
}

/** One wiktextract entry (one word + part of speech), or null if it isn't a usable Thai word. */
export function entryFromKaikki(raw: KaikkiEntry): DictEntry | null {
  if (raw.lang_code !== undefined && raw.lang_code !== 'th') return null;
  const pos = POS[raw.pos];
  const thai = headwordKey(raw.word);
  if (!pos || !thai) return null;

  const classifier = (raw.forms ?? [])
    .filter((form) => form.tags?.includes('classifier') && form.form)
    .map((form) => form.form)
    .join(', ');
  const senses = (raw.senses ?? [])
    .map((sense) => senseOf(sense, pos, classifier))
    .filter((sense): sense is DictSense => sense !== null);
  if (senses.length === 0) return null;

  const entry: DictEntry = { thai, senses, source: ['wiktionary'] };
  const sounds = raw.sounds ?? [];
  const paiboon = firstRoman(sounds, 'Paiboon');
  const rtgs = firstRoman(sounds, 'Royal Institute');
  const ipa = firstIpa(sounds);
  if (paiboon || rtgs || ipa) {
    entry.romanization = {};
    if (paiboon) entry.romanization.paiboon = paiboon;
    if (rtgs) entry.romanization.rtgs = rtgs;
    if (ipa) entry.romanization.ipa = ipa;
  }
  if (paiboon) entry.syllables = syllablesOf(paiboon, phonemic(sounds));
  if (pos === 'name') entry.isProperNoun = true;
  return entry;
}

/** Folds entries of the same headword (several parts of speech or etymologies) into one. */
export function mergeEntries(into: DictEntry, next: DictEntry): DictEntry {
  const merged: DictEntry = {
    ...into,
    senses: [...into.senses, ...next.senses].slice(0, MAX_SENSES),
  };
  if (!merged.romanization && next.romanization) merged.romanization = next.romanization;
  if (!merged.syllables && next.syllables) merged.syllables = next.syllables;
  // A word that is also a common noun or verb is not only a name.
  if (!(into.isProperNoun && next.isProperNoun)) delete merged.isProperNoun;
  return merged;
}
