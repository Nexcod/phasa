/**
 * Thai text normalization (docs/plan.md §5.2) with an offset map back to the
 * source string, so highlights and saved contexts line up with the original.
 */

export interface Normalized {
  /** NFC, zero-width characters removed, typing errors fixed, whitespace collapsed and trimmed. */
  text: string;
  /**
   * `toSource[i]` is the source offset of `text[i]`; `toSource[text.length]` is
   * the source length. A range `[a, b)` of `text` comes from
   * `[toSource[a], toSource[b])` of the source.
   */
  toSource: number[];
  /**
   * Offsets in `text` where the source had a zero-width character between two
   * non-space characters. Subtitle authors use them as invisible word
   * boundaries; the tokenizer treats them as hints (§5.2).
   */
  boundaryHints: number[];
}

interface Mapped {
  text: string;
  map: number[];
}

/**
 * Replaces every match of a global regex. Unchanged characters keep their own
 * source offsets; every character of a replacement maps to the start of the
 * match, which stays inside one grapheme cluster or merges whole clusters.
 */
function replaceMapped(
  input: Mapped,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => string,
  onMatch?: (outputOffset: number) => void,
): Mapped {
  let text = '';
  const map: number[] = [];
  let last = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(input.text); match; match = pattern.exec(input.text)) {
    text += input.text.slice(last, match.index);
    map.push(...input.map.slice(last, match.index));
    onMatch?.(text.length);
    const replacement = replace(match);
    map.push(...repeat(input.map[match.index] ?? 0, replacement.length));
    text += replacement;
    last = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex++;
  }
  text += input.text.slice(last);
  map.push(...input.map.slice(last, input.text.length));
  map.push(input.map[input.text.length] ?? 0);
  return { text, map };
}

function repeat(value: number, count: number): number[] {
  return new Array<number>(count).fill(value);
}

const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });

/** NFC per grapheme cluster, so the offset map stays exact between clusters. */
function nfc(input: Mapped): Mapped {
  if (input.text === input.text.normalize('NFC')) return input;
  let text = '';
  const map: number[] = [];
  for (const { segment, index } of graphemes.segment(input.text)) {
    const composed = segment.normalize('NFC');
    map.push(...repeat(input.map[index] ?? 0, composed.length));
    text += composed;
  }
  map.push(input.map[input.text.length] ?? 0);
  return { text, map };
}

const NIKHAHIT = '\u0E4D';
const SARA_AA = '\u0E32';
const SARA_AM = '\u0E33';
const TONE_MARKS = '\u0E48-\u0E4B';
/** Above and below vowels that must precede a tone mark in storage order. */
const UPPER_LOWER_VOWELS = '\u0E31\u0E34-\u0E39';
/** Marks that are never legitimately doubled. */
const COMBINING = '\u0E31\u0E34-\u0E3A\u0E47-\u0E4E';

const TYPO_FIXES: readonly [RegExp, (m: RegExpExecArray) => string][] = [
  // ◌ํ + ◌่ + า → ◌่ + ำ (nikhahit typed before the tone mark).
  [new RegExp(`${NIKHAHIT}([${TONE_MARKS}])${SARA_AA}`, 'gu'), (m) => `${m[1] ?? ''}${SARA_AM}`],
  // ◌ํ + า → ำ
  [new RegExp(`${NIKHAHIT}${SARA_AA}`, 'gu'), () => SARA_AM],
  // เ + เ → แ
  [/\u0E40\u0E40/gu, () => '\u0E41'],
  // Tone mark typed before an above/below vowel: ก่ี → กี่ (renders the same, compares differently).
  [
    new RegExp(`([${TONE_MARKS}])([${UPPER_LOWER_VOWELS}])`, 'gu'),
    (m) => `${m[2] ?? ''}${m[1] ?? ''}`,
  ],
  // Doubled tone marks and vowel signs: ก่่ → ก่
  [new RegExp(`([${COMBINING}])\\1+`, 'gu'), (m) => m[1] ?? ''],
];

/** Whitespace, excluding U+FEFF which `\s` would match but is a zero-width character here. */
const WHITESPACE_RUN = /[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/gu;
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]+/gu;

export function normalizeThai(source: string): Normalized {
  const identity: Mapped = {
    text: source,
    map: Array.from({ length: source.length + 1 }, (_, i) => i),
  };
  let current = nfc(identity);
  for (const [pattern, replace] of TYPO_FIXES) current = replaceMapped(current, pattern, replace);
  current = replaceMapped(current, WHITESPACE_RUN, () => ' ');

  const rawHints: number[] = [];
  current = replaceMapped(
    current,
    ZERO_WIDTH,
    () => '',
    (offset) => rawHints.push(offset),
  );

  // Trim, shifting hints with the text.
  const lead = current.text.length - current.text.trimStart().length;
  const text = current.text.trim();
  const toSource = current.map.slice(lead, lead + text.length + 1);

  const boundaryHints: number[] = [];
  for (const hint of rawHints) {
    const offset = hint - lead;
    if (offset <= 0 || offset >= text.length) continue;
    if (text[offset - 1] === ' ' || text[offset] === ' ') continue;
    if (boundaryHints.at(-1) !== offset) boundaryHints.push(offset);
  }
  return { text, toSource, boundaryHints };
}

const THAI_DIGIT_ZERO = 0x0e50;

/** ๐–๙ → 0–9. Same length, so offsets are preserved. For search keys, not display. */
export function toArabicDigits(text: string): string {
  return text.replace(/[\u0E50-\u0E59]/gu, (digit) =>
    String.fromCharCode(48 + digit.charCodeAt(0) - THAI_DIGIT_ZERO),
  );
}

/** 0–9 → ๐–๙. */
export function toThaiDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) =>
    String.fromCharCode(THAI_DIGIT_ZERO + digit.charCodeAt(0) - 48),
  );
}

/** Key for exact lookups: normalized text with Arabic digits. */
export function searchKey(text: string): string {
  return toArabicDigits(normalizeThai(text).text);
}
