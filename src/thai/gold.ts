/**
 * Reading tests/fixtures/segmentation.tsv and scoring a tokenizer against it
 * (ADR 0005). Shared by the unit test gate and `npm run seg:eval`.
 */
import {
  GOLD_SEPARATOR,
  boundariesInsideGraphemes,
  countBoundaries,
  isThaiBoundary,
  parseGold,
  score,
  sumCounts,
  type Counts,
  type Scores,
} from './segmentation-eval';
import { tokenBoundaries, type Tokenizer } from './tokenizer';

export interface GoldRow {
  id: string;
  source: string;
  segmented: string;
  note: string;
}

export function parseGoldTsv(tsv: string): GoldRow[] {
  const lines = tsv
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));
  const header = lines.shift()?.split('\t') ?? [];
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`segmentation.tsv: missing "${name}" column`);
    return index;
  };
  const [id, source, segmented] = [column('id'), column('source'), column('segmented')];
  const note = header.indexOf('note');
  return lines.map((line) => {
    const cells = line.split('\t');
    return {
      id: cells[id] ?? '',
      source: cells[source] ?? '',
      segmented: cells[segmented] ?? '',
      note: note >= 0 ? (cells[note] ?? '') : '',
    };
  });
}

export function isRealCue(row: GoldRow): boolean {
  return row.source.startsWith('youtube:');
}

export interface Mismatch {
  id: string;
  gold: string;
  predicted: string;
}

export interface Evaluation {
  /** Thai–Thai boundaries only (the gate). */
  thai: Scores;
  sentences: number;
  exact: number;
  mismatches: Mismatch[];
  /** Predicted boundaries that split a grapheme cluster: must be 0. */
  graphemeViolations: number;
}

export function evaluate(tokenizer: Tokenizer, rows: readonly GoldRow[]): Evaluation {
  const counts: Counts[] = [];
  const mismatches: Mismatch[] = [];
  let exact = 0;
  let graphemeViolations = 0;
  for (const row of rows) {
    const { text, boundaries } = parseGold(row.segmented);
    const tokens = tokenizer.tokenize(text);
    const predicted = tokenBoundaries(tokens);
    graphemeViolations += boundariesInsideGraphemes(text, predicted).length;
    const rowCounts = countBoundaries(text, boundaries, predicted, isThaiBoundary);
    counts.push(rowCounts);
    if (rowCounts.falsePositives === 0 && rowCounts.falseNegatives === 0) exact++;
    else {
      mismatches.push({
        id: row.id,
        gold: row.segmented,
        predicted: tokens.map((token) => token.text).join('|'),
      });
    }
  }
  return {
    thai: score(sumCounts(counts)),
    sentences: rows.length,
    exact,
    mismatches,
    graphemeViolations,
  };
}

/**
 * Native-speaker review (tests/fixtures/README.md): a spreadsheet shows each
 * segmentation with ` | ` between words and `␣` for a space; the reviewer's
 * corrections come back in the same notation.
 */
export const REVIEW_SPACE = '␣';

export function toReviewNotation(segmented: string): string {
  return segmented
    .split(GOLD_SEPARATOR)
    .map((token) => (token === ' ' ? REVIEW_SPACE : token))
    .join(' | ');
}

/**
 * The gold notation of a reviewer's correction, or an error. Typed spaces are
 * ignored (words never contain one); `␣` stands for the text's own spaces and
 * is always a token of its own. The text itself must stay exactly as it was.
 */
export function fromReviewNotation(
  review: string,
  original: string,
): { ok: true; segmented: string } | { ok: false; error: string } {
  const tokens = review
    .replace(/[ \t\u00A0]+/gu, '')
    .replaceAll(REVIEW_SPACE, `${GOLD_SEPARATOR}${REVIEW_SPACE}${GOLD_SEPARATOR}`)
    .split(GOLD_SEPARATOR)
    .filter((token) => token !== '')
    .map((token) => (token === REVIEW_SPACE ? ' ' : token));
  if (tokens.join('') !== parseGold(original).text) {
    return { ok: false, error: 'the text changed: only move, add or remove | bars' };
  }
  return { ok: true, segmented: tokens.join(GOLD_SEPARATOR) };
}
