import type { Tone } from '../thai/types';

export type DictSource = 'wiktionary' | 'volubilis' | 'lexitron' | 'ai';

export interface DictSense {
  pos?: string;
  glosses: string[];
  classifier?: string;
}

export interface DictEntry {
  thai: string;
  romanization?: { paiboon?: string; rtgs?: string; ipa?: string };
  syllables?: { text: string; tone: Tone }[];
  senses: DictSense[];
  /** 1 = most frequent. */
  freqRank?: number;
  isProperNoun?: boolean;
  source: DictSource[];
}
