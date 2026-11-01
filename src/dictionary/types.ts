import type { Tone } from '../thai/types';
import type { Pronunciation } from './pronunciation';

export type DictSource = 'wiktionary' | 'volubilis' | 'lexitron' | 'ai';

/** Part of speech, as short codes; the UI maps them to i18n labels. */
export type PartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adj'
  | 'adv'
  | 'name'
  | 'pron'
  | 'intj'
  | 'classifier'
  | 'num'
  | 'prep'
  | 'conj'
  | 'particle'
  | 'det'
  | 'phrase'
  | 'proverb'
  | 'prefix'
  | 'suffix';

/** Usage labels worth showing a learner (register, currency). */
export type SenseTag =
  | 'formal'
  | 'informal'
  | 'colloquial'
  | 'slang'
  | 'archaic'
  | 'obsolete'
  | 'dated'
  | 'literary'
  | 'poetic'
  | 'vulgar'
  | 'offensive'
  | 'derogatory'
  | 'humorous'
  | 'rare'
  | 'dialectal'
  | 'internet'
  | 'idiomatic'
  | 'figurative'
  | 'abbreviation'
  | 'misspelling'
  | 'royal';

export interface DictSense {
  pos?: PartOfSpeech;
  glosses: string[];
  classifier?: string;
  tags?: SenseTag[];
  /** "Alternative form of …": the main headword. */
  altOf?: string;
}

export interface DictSyllable {
  /** Thai phonemic respelling of the syllable (`พา` for ภา in ภาษา), when known. */
  text?: string;
  /** Paiboon+ romanization of the syllable. */
  roman: string;
  tone: Tone;
}

export interface DictEntry {
  /** Normalized headword (src/thai/normalize.ts). */
  thai: string;
  romanization?: { paiboon?: string; rtgs?: string; ipa?: string };
  syllables?: DictSyllable[];
  senses: DictSense[];
  /** 1 = most frequent. */
  freqRank?: number;
  isProperNoun?: boolean;
  /**
   * Compositional by the segmentation convention (src/thai/convention.ts):
   * the tokenizer keeps these parts apart, e.g. `ไม่มี` → `['ไม่', 'มี']`.
   */
  parts?: string[];
  source: DictSource[];
}

/** Header of `data/build/dict.json`. */
export interface DictMeta {
  /** Changes whenever the built entries change; the service worker reloads on a new version. */
  version: string;
  builtAt: string;
  entries: number;
  sources: { name: string; url: string; retrievedAt: string; sha256: string }[];
}

export interface DictFile {
  meta: DictMeta;
  entries: DictEntry[];
}

/** What a lookup returns for one word (`dict/lookup`). */
export interface WordInfo {
  thai: string;
  entry?: DictEntry;
  /** For an "alternative form of" entry: the main headword's entry. */
  main?: DictEntry;
  pronunciation?: Pronunciation;
  /** A word missing from the dictionary that splits into dictionary words: those words. */
  parts?: { thai: string; entry?: DictEntry }[];
}
