/**
 * Thai word tokenizer (docs/plan.md §5.3, ADR 0005).
 *
 * Pipeline over normalized text (src/thai/normalize.ts):
 *  1. `Intl.Segmenter('th', { granularity: 'word' })` (the browser's ICU dictionary);
 *  2. `ๆ` becomes its own `repeat` token, `ฯลฯ` one token, zero-width hints become boundaries;
 *  3. greedy merge of up to {@link MAX_MERGE_TOKENS} adjacent Thai tokens whose concatenation is a
 *     word of the lexicon (longer for the user's own phrases and merge rules);
 *  4. required splits: compositional headwords (src/thai/convention.ts) and user split rules;
 *  5. a token that is not a word but is a concatenation of words is split into them;
 *  6. stretches where ICU cut through words are re-cut against the lexicon;
 *  7. runs of the same punctuation character stay one token.
 *
 * Every boundary falls on a grapheme-cluster boundary: ICU guarantees it for
 * its own, and every merge or split here works on grapheme boundaries only.
 */
import type { Token, TokenKind, ThaiTokenizer } from './types';

/** Dictionary merges join at most this many ICU tokens (ADR 0005). */
export const MAX_MERGE_TOKENS = 4;
/** The user's own phrases and merge rules may span more. */
export const MAX_USER_MERGE_TOKENS = 8;
/** Longest word, in grapheme clusters, the searches try. */
const MAX_WORD_GRAPHEMES = 24;
/** Longest piece of a re-cut that is not a word, in grapheme clusters. */
const MAX_UNKNOWN_GRAPHEMES = 4;
/**
 * Unigram cost of a word under a Zipf distribution, -log P(rank) = log(rank) +
 * log(H_N): merges must pay for themselves (`ว่า|การ` is not the rare verb
 * `ว่าการ`), and of two overlapping merges the likelier wins (`ก็|ได้รับ`, not
 * `ก็ได้|รับ`). Dictionary words without a rank count as rank 5000.
 */
const UNRANKED = 5000;
const TOKEN_COST = Math.log(Math.log(30_000) + 0.5772);
const UNKNOWN_COST = Math.log(30_000) + TOKEN_COST;

export interface TokenizerLexicon {
  /** A whole unit: a non-compositional dictionary headword, a user phrase or merge rule. */
  isWord(word: string): boolean;
  /** The user's own unit (phrase or merge rule): may merge more ICU tokens than a dictionary word. */
  isUserUnit?(word: string): boolean;
  /** Required split: compositional headword parts or a user split rule. */
  partsOf?(word: string): readonly string[] | undefined;
  /** Corpus frequency rank of a word (1 = most frequent), when known. */
  frequencyRank?(word: string): number | undefined;
}

export interface TokenizeOptions {
  /** Offsets where the source had zero-width characters (normalizeThai's `boundaryHints`). */
  hints?: readonly number[];
}

export interface Tokenizer extends ThaiTokenizer {
  tokenize(text: string, options?: TokenizeOptions): Token[];
}

const words = new Intl.Segmenter('th', { granularity: 'word' });
const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });

const MAI_YAMOK = 'ๆ';
const PAIYANNOI = 'ฯ';
const ETCETERA = 'ฯลฯ';
const THAI_LETTER = /[\u0E01-\u0E2E\u0E30-\u0E3A\u0E40-\u0E45]/u;
const LETTER = /\p{L}/u;
const DIGIT = /[0-9\u0E50-\u0E59]/u;
const WHITESPACE = /^\s+$/u;
/** Vowels written after their consonant but spacing (ะ า ำ ๅ): never the start of a word. */
const FOLLOWING_VOWEL = /^[\u0E30\u0E32\u0E33\u0E45]/u;
/** Vowels written before their consonant (เ แ โ ใ ไ): never the end of a word. */
const LEADING_VOWEL = /[\u0E40-\u0E44]$/u;

export function tokenKind(segment: string): TokenKind {
  if (WHITESPACE.test(segment)) return 'space';
  if (segment === MAI_YAMOK) return 'repeat';
  if (segment === ETCETERA || segment === PAIYANNOI) return 'punct';
  if (THAI_LETTER.test(segment)) return 'thai';
  if (LETTER.test(segment)) return 'latin';
  if (DIGIT.test(segment)) return 'number';
  return 'punct';
}

interface Piece {
  start: number;
  end: number;
  kind: TokenKind;
  /** From a required split or a user unit: later steps leave it alone. */
  fixed?: boolean;
}

/** Per-text facts every step needs. */
interface TextContext {
  text: string;
  /** Grapheme-cluster starts, plus text.length. */
  clusters: Set<number>;
  /** Zero-width hint boundaries: never merged across. */
  locked: Set<number>;
  /** ICU's own boundaries, preferred when a re-cut is otherwise a tie. */
  icu: Set<number>;
}

function graphemeStarts(text: string): Set<number> {
  const starts = new Set<number>([text.length]);
  for (const { index } of graphemes.segment(text)) starts.add(index);
  return starts;
}

/** Steps 1–2 as a sorted list of boundaries, including 0 and text.length. */
function initialBoundaries(text: string, hints: readonly number[]) {
  const clusters = graphemeStarts(text);
  const icu = new Set<number>([0, text.length]);
  for (const { index } of words.segment(text)) icu.add(index);
  const boundaries = new Set(icu);
  for (let i = text.indexOf(MAI_YAMOK); i >= 0; i = text.indexOf(MAI_YAMOK, i + 1)) {
    boundaries.add(i);
    boundaries.add(i + 1);
  }
  for (let i = text.indexOf(PAIYANNOI); i >= 0; i = text.indexOf(PAIYANNOI, i + 1)) {
    boundaries.add(i);
    boundaries.add(i + 1);
  }
  const locked = new Set<number>();
  for (const hint of hints) {
    if (hint > 0 && hint < text.length && clusters.has(hint)) {
      boundaries.add(hint);
      locked.add(hint);
    }
  }
  for (let i = text.indexOf(ETCETERA); i >= 0; i = text.indexOf(ETCETERA, i + 1)) {
    boundaries.add(i);
    boundaries.add(i + ETCETERA.length);
    for (let j = i + 1; j < i + ETCETERA.length; j++) boundaries.delete(j);
  }
  const context: TextContext = { text, clusters, locked, icu };
  return { sorted: [...boundaries].sort((a, b) => a - b), context };
}

/** Cluster-boundary offsets from `start` to `end`, both included. */
function cutPoints(ctx: TextContext, start: number, end: number): number[] {
  const cuts = [start];
  for (let i = start + 1; i < end; i++) if (ctx.clusters.has(i)) cuts.push(i);
  cuts.push(end);
  return cuts;
}

function crossesLock(ctx: TextContext, from: number, to: number): boolean {
  for (let i = from + 1; i < to; i++) if (ctx.locked.has(i)) return true;
  return false;
}

function validEdges(text: string, from: number, to: number): boolean {
  const piece = text.slice(from, to);
  return !FOLLOWING_VOWEL.test(piece) && !LEADING_VOWEL.test(piece);
}

/**
 * Split of a non-word into words: fewest pieces, then the longest pieces.
 * Each piece is at least two code units, so a lone consonant never becomes a "word".
 */
function coverWithWords(
  ctx: TextContext,
  start: number,
  end: number,
  isWord: (word: string) => boolean,
): number[] | null {
  const cuts = cutPoints(ctx, start, end);
  const n = cuts.length - 1;
  // best[i]: [pieces, -sum of squared lengths, previous cut index] covering cuts[0..i].
  const best: ([number, number, number] | null)[] = new Array<[number, number, number] | null>(
    n + 1,
  ).fill(null);
  best[0] = [0, 0, -1];
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - MAX_WORD_GRAPHEMES); j < i; j++) {
      const previous = best[j];
      const from = cuts[j] ?? start;
      const to = cuts[i] ?? end;
      if (
        !previous ||
        crossesLock(ctx, from, to) ||
        !(to - from >= 2 && isWord(ctx.text.slice(from, to)))
      )
        continue;
      const candidate: [number, number, number] = [
        previous[0] + 1,
        previous[1] - (to - from) ** 2,
        j,
      ];
      const current = best[i];
      if (
        !current ||
        candidate[0] < current[0] ||
        (candidate[0] === current[0] && candidate[1] < current[1])
      ) {
        best[i] = candidate;
      }
    }
  }
  const last = best[n];
  if (!last || last[0] < 2) return null;
  const out: number[] = [];
  for (let i = n; i > 0; i = best[i]?.[2] ?? 0) out.push(cuts[i] ?? end);
  return out.reverse().slice(0, -1); // inner cuts only
}

/**
 * Parts of a word that is a concatenation of words, e.g. a compound missing
 * from the dictionary: `ภาษาไทย` → `['ภาษา', 'ไทย']`. Null if there is no such split.
 */
export function splitIntoWords(word: string, isWord: (word: string) => boolean): string[] | null {
  const ctx: TextContext = {
    text: word,
    clusters: graphemeStarts(word),
    locked: new Set(),
    icu: new Set(),
  };
  const cuts = coverWithWords(ctx, 0, word.length, isWord);
  if (!cuts) return null;
  const edges = [0, ...cuts, word.length];
  return edges.slice(1).map((end, i) => word.slice(edges[i] ?? 0, end));
}

export function createTokenizer(lexicon: TokenizerLexicon): Tokenizer {
  const isUserUnit = (word: string) => lexicon.isUserUnit?.(word) ?? false;
  const partsOf = (word: string) => lexicon.partsOf?.(word);
  const isWordPiece = (text: string, from: number, to: number) =>
    to - from >= 2 && lexicon.isWord(text.slice(from, to));

  /** Inner cut offsets that split `[start, end)` per a required split, or null. */
  function requiredCuts(ctx: TextContext, start: number, end: number): number[] | null {
    const word = ctx.text.slice(start, end);
    const parts = partsOf(word);
    if (!parts || parts.length < 2 || parts.join('') !== word) return null;
    const cuts: number[] = [];
    let offset = start;
    for (const part of parts.slice(0, -1)) {
      offset += part.length;
      if (!ctx.clusters.has(offset)) return null; // never split a grapheme cluster
      cuts.push(offset);
    }
    return cuts;
  }

  /** Steps 4–5 for one unit; recurses into the produced parts. */
  function splitUnit(ctx: TextContext, start: number, end: number, depth = 0): Piece[] {
    const required = requiredCuts(ctx, start, end);
    const cuts =
      required ??
      (lexicon.isWord(ctx.text.slice(start, end))
        ? null
        : coverWithWords(ctx, start, end, (word) => lexicon.isWord(word)));
    if (!cuts) return [{ start, end, kind: 'thai' }];
    const edges = [start, ...cuts, end];
    const out: Piece[] = [];
    for (let i = 0; i + 1 < edges.length; i++) {
      const from = edges[i] ?? start;
      const to = edges[i + 1] ?? end;
      const parts = depth < 2 ? splitUnit(ctx, from, to, depth + 1) : [];
      if (parts.length > 0) out.push(...parts);
      else out.push({ start: from, end: to, kind: 'thai' });
    }
    if (required) for (const piece of out) piece.fixed = true;
    return out;
  }

  const wordCost = (word: string) =>
    Math.log(lexicon.frequencyRank?.(word) ?? UNRANKED) + TOKEN_COST;

  /**
   * Step 3: merge ICU pieces into lexicon words, choosing the grouping with the
   * lowest unigram cost. User units always win.
   */
  function mergeRun(ctx: TextContext, run: Piece[]): Piece[] {
    const n = run.length;
    interface Step {
      cost: number;
      from: number;
      user: boolean;
    }
    const best: (Step | null)[] = new Array<Step | null>(n + 1).fill(null);
    best[0] = { cost: 0, from: -1, user: false };
    for (let i = 1; i <= n; i++) {
      for (let k = 1; k <= Math.min(MAX_USER_MERGE_TOKENS, i); k++) {
        const previous = best[i - k];
        const first = run[i - k];
        const last = run[i - 1];
        if (!previous || !first || !last) continue;
        const joined = ctx.text.slice(first.start, last.end);
        let cost: number;
        let user = false;
        if (k === 1) {
          cost = lexicon.isWord(joined) ? wordCost(joined) : UNKNOWN_COST;
        } else if (crossesLock(ctx, first.start, last.end)) {
          continue;
        } else if (isUserUnit(joined)) {
          cost = 0;
          user = true;
        } else if (k <= MAX_MERGE_TOKENS && lexicon.isWord(joined)) {
          cost = wordCost(joined);
        } else {
          continue;
        }
        const total = previous.cost + cost;
        const current = best[i];
        if (!current || total < current.cost) best[i] = { cost: total, from: i - k, user };
      }
    }
    const merged: Piece[] = [];
    for (let i = n; i > 0;) {
      const step = best[i];
      const first = run[step?.from ?? i - 1];
      const last = run[i - 1];
      if (!step || !first || !last) break;
      const piece: Piece = { start: first.start, end: last.end, kind: 'thai' };
      if (step.user && i - step.from > 1) piece.fixed = true;
      merged.unshift(piece);
      i = step.from;
    }
    return merged;
  }

  /**
   * Step 6: ICU's dictionary sometimes cuts through words (`แล้วกล้องมัน` →
   * `แล้วก|ล้อ|งมัน`, `มากอะ` → `มา|กอะ`). A stretch of non-words, with one
   * word of context on each side, is re-cut to cover as many grapheme clusters
   * with words as possible; the re-cut is kept only if it leaves fewer
   * clusters outside words.
   */
  function repairRegions(ctx: TextContext, units: Piece[]): Piece[] {
    const good = units.map(
      (unit) => unit.fixed === true || lexicon.isWord(ctx.text.slice(unit.start, unit.end)),
    );
    const isBad = (index: number) => index < units.length && good[index] === false;
    const out: Piece[] = [];
    for (let i = 0; i < units.length;) {
      const unit = units[i];
      if (!unit) break;
      if (!isBad(i)) {
        out.push(unit);
        i++;
        continue;
      }
      // Non-words, also across a single word between two of them (`แล้วก|ล้อ|งมัน`).
      let last = i;
      while (isBad(last + 1) || (!isBad(last + 1) && isBad(last + 2))) last++;
      let first = i;
      const left = out.at(-1);
      if (left && !left.fixed && !ctx.locked.has(unit.start)) {
        out.pop();
        first = i - 1;
      }
      const right = units[last + 1];
      if (right && !right.fixed && !ctx.locked.has(right.start)) last++;
      const region = units.slice(first, last + 1);
      let before = 0;
      let badUnits = 0;
      for (let k = first; k <= last; k++) {
        const piece = units[k];
        if (!piece || !isBad(k)) continue;
        before += cutPoints(ctx, piece.start, piece.end).length - 1;
        badUnits++;
      }
      const recut = recutRegion(
        ctx,
        region[0]?.start ?? unit.start,
        region.at(-1)?.end ?? unit.end,
      );
      // One non-word ICU kept whole is often a loanword (`ดีเลย์`): re-cut it only if that
      // leaves nothing unknown (`มา|กอะ` → `มาก|อะ`).
      const accept =
        recut !== null && recut.unknown < before && (recut.unknown === 0 || badUnits > 1);
      out.push(...(accept ? recut.pieces : region));
      i = last + 1;
    }
    return out;
  }

  function recutRegion(
    ctx: TextContext,
    start: number,
    end: number,
  ): { pieces: Piece[]; unknown: number } | null {
    const cuts = cutPoints(ctx, start, end);
    const n = cuts.length - 1;
    // Cost: clusters outside words, then tokens, then cuts ICU didn't make.
    interface Step {
      cost: [number, number, number];
      from: number;
      word: boolean;
    }
    const best: (Step | null)[] = new Array<Step | null>(n + 1).fill(null);
    best[0] = { cost: [0, 0, 0], from: -1, word: true };
    const compare = (a: Step['cost'], b: Step['cost']) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    for (let i = 1; i <= n; i++) {
      for (let j = Math.max(0, i - MAX_WORD_GRAPHEMES); j < i; j++) {
        const previous = best[j];
        const from = cuts[j] ?? start;
        const to = cuts[i] ?? end;
        if (!previous || !validEdges(ctx.text, from, to) || crossesLock(ctx, from, to)) continue;
        const word = isWordPiece(ctx.text, from, to);
        if (!word && i - j > MAX_UNKNOWN_GRAPHEMES) continue;
        const cost: Step['cost'] = [
          previous.cost[0] + (word ? 0 : i - j),
          previous.cost[1] + 1,
          previous.cost[2] + (j > 0 && !ctx.icu.has(from) ? 1 : 0),
        ];
        const current = best[i];
        if (!current || compare(cost, current.cost) < 0) best[i] = { cost, from: j, word };
      }
    }
    const last = best[n];
    if (!last) return null;
    const pieces: (Piece & { unknown?: boolean })[] = [];
    for (let i = n; i > 0;) {
      const step = best[i];
      if (!step) return null;
      const from = cuts[step.from] ?? start;
      const to = cuts[i] ?? end;
      const next = pieces[0];
      if (!step.word && next?.unknown && !ctx.locked.has(to)) {
        next.start = from; // adjacent non-word pieces form one unknown token
      } else {
        pieces.unshift({ start: from, end: to, kind: 'thai', unknown: !step.word });
      }
      i = step.from;
    }
    return {
      pieces: pieces.map(({ start: s, end: e, kind }) => ({ start: s, end: e, kind })),
      unknown: last.cost[0],
    };
  }

  /** Steps 3–6 for a run of adjacent Thai pieces. */
  function processThaiRun(ctx: TextContext, run: Piece[]): Piece[] {
    const units = mergeRun(ctx, run).flatMap((piece) =>
      piece.fixed ? [piece] : splitUnit(ctx, piece.start, piece.end),
    );
    return repairRegions(ctx, units);
  }

  function mergePunctRuns(text: string, pieces: Piece[]): Piece[] {
    const out: Piece[] = [];
    for (const piece of pieces) {
      const previous = out.at(-1);
      const char = text.slice(piece.start, piece.end);
      if (
        previous?.kind === 'punct' &&
        piece.kind === 'punct' &&
        previous.end === piece.start &&
        char.length === 1 &&
        text.slice(previous.start, previous.end).replaceAll(char, '') === ''
      ) {
        previous.end = piece.end;
      } else {
        out.push({ ...piece });
      }
    }
    return out;
  }

  return {
    tokenize(text, options = {}) {
      if (text === '') return [];
      const { sorted, context } = initialBoundaries(text, options.hints ?? []);
      const pieces: Piece[] = [];
      for (let i = 0; i + 1 < sorted.length; i++) {
        const start = sorted[i] ?? 0;
        const end = sorted[i + 1] ?? text.length;
        pieces.push({ start, end, kind: tokenKind(text.slice(start, end)) });
      }

      const out: Piece[] = [];
      for (let i = 0; i < pieces.length;) {
        const piece = pieces[i];
        if (piece?.kind !== 'thai') {
          if (piece) out.push(piece);
          i++;
          continue;
        }
        let j = i;
        while (pieces[j]?.kind === 'thai') j++;
        out.push(...processThaiRun(context, pieces.slice(i, j)));
        i = j;
      }
      return mergePunctRuns(text, out).map(({ start, end, kind }) => ({
        text: text.slice(start, end),
        start,
        end,
        kind,
      }));
    },
  };
}

/** Internal boundaries of a tokenization, for evaluation against gold data. */
export function tokenBoundaries(tokens: readonly Token[]): Set<number> {
  const boundaries = new Set<number>();
  for (const token of tokens.slice(1)) boundaries.add(token.start);
  return boundaries;
}
