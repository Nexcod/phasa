/**
 * Tones from romanization (docs/plan.md §5.5). Paiboon+ marks tones with
 * diacritics on the vowel: à low, á high, â falling, ǎ rising, none for mid.
 */
import type { Tone } from './types';

export const TONES: readonly Tone[] = ['mid', 'low', 'falling', 'high', 'rising'];

const COMBINING_TONE: Readonly<Record<string, Tone>> = {
  '\u0300': 'low',
  '\u0301': 'high',
  '\u0302': 'falling',
  '\u030C': 'rising',
};

/** Tone of one Paiboon syllable, e.g. `sǎa` → rising. */
export function paiboonTone(syllable: string): Tone {
  for (const char of syllable.normalize('NFD')) {
    const tone = COMBINING_TONE[char];
    if (tone) return tone;
  }
  return 'mid';
}

/** `paa-sǎa tai` → `['paa', 'sǎa', 'tai']`. */
export function splitRomanSyllables(roman: string): string[] {
  return roman.split(/[\s\-‐–·.]+/u).filter((part) => part !== '');
}

const TONE_MARK: Readonly<Record<Tone, string>> = {
  mid: '',
  low: '\u0300',
  high: '\u0301',
  falling: '\u0302',
  rising: '\u030C',
};

const VOWEL = /[aeiouəɛɔʉ]/u;

/**
 * Puts the tone diacritic of `tone` on the first vowel of a toneless Paiboon
 * syllable: `saa` + rising → `sǎa`.
 */
export function withPaiboonTone(syllable: string, tone: Tone): string {
  const mark = TONE_MARK[tone];
  if (mark === '') return syllable;
  const bare = syllable.normalize('NFD').replace(/[\u0300\u0301\u0302\u030C]/gu, '');
  const index = bare.search(VOWEL);
  if (index < 0) return syllable;
  return `${bare.slice(0, index + 1)}${mark}${bare.slice(index + 1)}`.normalize('NFC');
}
