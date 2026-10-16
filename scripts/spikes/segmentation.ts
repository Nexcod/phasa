/**
 * Phase 0 segmentation spike (docs/spikes.md §3): runs the ICU baseline
 * `Intl.Segmenter('th', { granularity: 'word' })` against a gold file and
 * prints boundary P/R/F1 plus the most frequent error patterns as Markdown.
 *
 *   pnpm spike:seg                                 # tests/fixtures/segmentation.tsv
 *   pnpm spike:seg data/raw/wisesight-1000.label   # after `pnpm spike:seg:fetch`
 *
 * Formats: `.tsv` = `id <TAB> source <TAB> segmented [<TAB> note]` with a header
 * row; anything else = one `|`-segmented sentence per line.
 *
 * Besides raw ICU it scores cheap post-rules, to size what the dictionary
 * correction layer of the real tokenizer (phase 3) has to fix.
 */
import { readFileSync } from 'node:fs';
import {
  boundariesFromSegments,
  boundariesInsideGraphemes,
  countBoundaries,
  isScoredBoundary,
  isThaiBoundary,
  parseGold,
  renderSpan,
  score,
  sumCounts,
  tokenAround,
  type Counts,
} from '../../src/thai/segmentation-eval';

const path = process.argv[2] ?? 'tests/fixtures/segmentation.tsv';
const TOP = Number(process.env.TOP ?? 25);

function readGold(file: string): string[] {
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));
  if (!file.endsWith('.tsv')) return lines;
  const [header, ...rows] = lines;
  const column = header?.split('\t').indexOf('segmented') ?? -1;
  if (column < 0) throw new Error(`${file}: header must contain a "segmented" column`);
  return rows.map((row) => row.split('\t')[column] ?? '');
}

type Variant = (text: string, icu: Set<number>) => Set<number>;

const MAI_YAMOK = 'ๆ';

/** ๆ becomes its own `repeat` token (docs/plan.md §5.3); ICU glues it to the previous word. */
const splitRepeat: Variant = (text, icu) => {
  const out = new Set(icu);
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== MAI_YAMOK) continue;
    if (i > 0) out.add(i);
    if (i + 1 < text.length) out.add(i + 1);
  }
  return out;
};

/** Runs of the same non-Thai symbol ("...", "!!!") stay one punct token. */
const mergePunctRuns: Variant = (text, icu) =>
  new Set(
    [...icu].filter((i) => !(text[i] === text[i - 1] && /[^\p{L}\p{N}\s]/u.test(text[i] ?? ''))),
  );

const VARIANTS: [string, Variant][] = [
  ['ICU', (_, icu) => icu],
  ['ICU + split ๆ', splitRepeat],
  ['ICU + split ๆ + merge punct runs', (text, icu) => mergePunctRuns(text, splitRepeat(text, icu))],
];

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
const goldLines = readGold(path);
const sentences = goldLines.map((line) => {
  const { text, boundaries: gold } = parseGold(line);
  const icu = boundariesFromSegments(segmenter.segment(text), text.length);
  return { text, gold, icu };
});

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rows = VARIANTS.map(([name, variant]) => {
  const all: Counts[] = [];
  const thai: Counts[] = [];
  let perfect = 0;
  for (const { text, gold, icu } of sentences) {
    const predicted = variant(text, icu);
    const counts = countBoundaries(text, gold, predicted);
    all.push(counts);
    thai.push(countBoundaries(text, gold, predicted, isThaiBoundary));
    if (counts.falsePositives === 0 && counts.falseNegatives === 0) perfect++;
  }
  const a = score(sumCounts(all));
  const t = score(sumCounts(thai));
  return `| ${name} | ${a.f1.toFixed(3)} | ${pct(t.precision)} | ${pct(t.recall)} | **${t.f1.toFixed(3)}** | ${pct(perfect / sentences.length)} |`;
});

// Error patterns of the raw baseline, Thai–Thai boundaries only.
const overSegmented = new Map<string, number>(); // gold word that ICU split
const underSegmented = new Map<string, number>(); // ICU token spanning several gold words
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
let clusterViolations = 0;
let goldBoundaries = 0;
for (const { text, gold, icu } of sentences) {
  clusterViolations += boundariesInsideGraphemes(text, icu).length;
  goldBoundaries += [...gold].filter((offset) => isScoredBoundary(text, offset)).length;
  for (const offset of icu) {
    if (isThaiBoundary(text, offset) && !gold.has(offset)) {
      const [start, end] = tokenAround(text, offset, gold);
      bump(overSegmented, renderSpan(text, start, end, icu));
    }
  }
  for (const offset of gold) {
    if (isThaiBoundary(text, offset) && !icu.has(offset)) {
      const [start, end] = tokenAround(text, offset, icu);
      bump(underSegmented, `${text.slice(start, end)} → ${renderSpan(text, start, end, gold)}`);
    }
  }
}

const top = (map: Map<string, number>) =>
  [...map]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([pattern, count]) => `| ${count} | ${pattern.replaceAll('|', '\\|')} |`)
    .join('\n');

console.log(`## Intl.Segmenter('th') vs ${path}

Node ${process.versions.node}, ICU ${process.versions.icu}, Unicode ${process.versions.unicode}.
${sentences.length} sentences, ${goldBoundaries} scored gold boundaries (whitespace-adjacent excluded).
Boundaries inside grapheme clusters (raw ICU): ${clusterViolations}.

| Variant | F1 all | P thai | R thai | F1 thai | sentences exact |
|---|---:|---:|---:|---:|---:|
${rows.join('\n')}

"thai" = only boundaries with Thai script on both sides (no URLs, numbers, emoji, punctuation).

### Over-segmentation: ICU split a gold word (Thai–Thai), top ${TOP}
| count | ICU split |
|---:|---|
${top(overSegmented)}

### Under-segmentation: ICU merged gold words (Thai–Thai), top ${TOP}
| count | ICU token → gold |
|---:|---|
${top(underSegmented)}
`);
