/**
 * Word-boundary evaluation for Thai segmentation (docs/plan.md §5.3).
 *
 * Gold data marks word boundaries with `|`, e.g. `ไป|โรงเรียน|ครับ`.
 * A boundary is a UTF-16 offset in the text without the bars. Boundaries next to
 * whitespace are excluded from scoring: subtitles already separate phrases with
 * spaces, so every segmenter gets those for free and they would inflate F1.
 */

export const GOLD_SEPARATOR = '|';

export interface GoldSentence {
  text: string;
  /** Internal word boundaries (never 0 or text.length). */
  boundaries: Set<number>;
}

export function parseGold(segmented: string): GoldSentence {
  const tokens = segmented.split(GOLD_SEPARATOR);
  const boundaries = new Set<number>();
  let offset = 0;
  tokens.forEach((token, index) => {
    offset += token.length;
    if (index < tokens.length - 1 && offset > 0) boundaries.add(offset);
  });
  const text = tokens.join('');
  boundaries.delete(text.length);
  return { text, boundaries };
}

export function boundariesFromSegments(
  segments: Iterable<{ index: number }>,
  length: number,
): Set<number> {
  const boundaries = new Set<number>();
  for (const { index } of segments) if (index > 0 && index < length) boundaries.add(index);
  return boundaries;
}

const WHITESPACE = /\s/u;

export function isScoredBoundary(text: string, offset: number): boolean {
  return !WHITESPACE.test(text[offset - 1] ?? '') && !WHITESPACE.test(text[offset] ?? '');
}

export interface Counts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface Scores extends Counts {
  precision: number;
  recall: number;
  f1: number;
}

const THAI_CHAR = /[\u0E00-\u0E7F]/u;

/** Both neighbours are Thai script: ignores URLs, numbers, emoji and punctuation runs. */
export function isThaiBoundary(text: string, offset: number): boolean {
  return THAI_CHAR.test(text[offset - 1] ?? '') && THAI_CHAR.test(text[offset] ?? '');
}

export function countBoundaries(
  text: string,
  gold: Set<number>,
  predicted: Set<number>,
  scored: (text: string, offset: number) => boolean = isScoredBoundary,
): Counts {
  const counts: Counts = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
  for (const offset of predicted) {
    if (!scored(text, offset)) continue;
    if (gold.has(offset)) counts.truePositives++;
    else counts.falsePositives++;
  }
  for (const offset of gold) {
    if (scored(text, offset) && !predicted.has(offset)) counts.falseNegatives++;
  }
  return counts;
}

export function score(counts: Counts): Scores {
  const { truePositives: tp, falsePositives: fp, falseNegatives: fn } = counts;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { ...counts, precision, recall, f1 };
}

export function sumCounts(all: Iterable<Counts>): Counts {
  const total: Counts = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
  for (const counts of all) {
    total.truePositives += counts.truePositives;
    total.falsePositives += counts.falsePositives;
    total.falseNegatives += counts.falseNegatives;
  }
  return total;
}

/** Offsets in `boundaries` that would split a grapheme cluster — must always be empty. */
export function boundariesInsideGraphemes(text: string, boundaries: Set<number>): number[] {
  const graphemeStarts = new Set<number>();
  for (const { index } of new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text)) {
    graphemeStarts.add(index);
  }
  return [...boundaries].filter((offset) => !graphemeStarts.has(offset));
}

/** Renders `text` with `|` at the given boundaries between `start` and `end`. */
export function renderSpan(
  text: string,
  start: number,
  end: number,
  boundaries: Set<number>,
): string {
  let out = '';
  for (let i = start; i < end; i++) {
    if (i > start && boundaries.has(i)) out += GOLD_SEPARATOR;
    out += text[i] ?? '';
  }
  return out;
}

/** The [start, end) of the token in `boundaries` that contains `offset` strictly inside. */
export function tokenAround(
  text: string,
  offset: number,
  boundaries: Set<number>,
): [number, number] {
  let start = offset - 1;
  while (start > 0 && !boundaries.has(start) && !WHITESPACE.test(text[start - 1] ?? '')) start--;
  let end = offset + 1;
  while (end < text.length && !boundaries.has(end) && !WHITESPACE.test(text[end] ?? '')) end++;
  return [start, end];
}
