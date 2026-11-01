/**
 * Scores the tokenizer (src/thai/tokenizer.ts) with the built dictionary
 * against tests/fixtures/segmentation.tsv and prints the mismatches.
 *
 *   npm run seg:eval
 *
 * The unit test `tests/unit/tokenizer.test.ts` enforces F1 >= 0.90 (AGENTS.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLexicon, snapshotFromEntries } from '../src/dictionary/lexicon';
import type { DictFile } from '../src/dictionary/types';
import { evaluate, isRealCue, parseGoldTsv, type GoldRow } from '../src/thai/gold';
import { createTokenizer } from '../src/thai/tokenizer';

const root = join(import.meta.dirname, '..');
const dict = JSON.parse(readFileSync(join(root, 'data/build/dict.json'), 'utf8')) as DictFile;
const rows = parseGoldTsv(readFileSync(join(root, 'tests/fixtures/segmentation.tsv'), 'utf8'));
const tokenizer = createTokenizer(createLexicon(snapshotFromEntries(dict.entries)));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const line = (name: string, subset: GoldRow[]) => {
  const result = evaluate(tokenizer, subset);
  const { precision, recall, f1 } = result.thai;
  return `| ${name} | ${subset.length} | ${pct(precision)} | ${pct(recall)} | **${f1.toFixed(3)}** | ${pct(result.exact / Math.max(1, subset.length))} |`;
};

const all = evaluate(tokenizer, rows);
console.log(`## Tokenizer vs tests/fixtures/segmentation.tsv

Node ${process.versions.node}, ICU ${process.versions.icu}; dictionary ${dict.meta.version} (${dict.meta.entries} headwords).
Boundaries inside grapheme clusters: ${all.graphemeViolations}.

| Rows | n | P thai | R thai | F1 thai | exact |
|---|---:|---:|---:|---:|---:|
${line('all', rows)}
${line('real cues', rows.filter(isRealCue))}
${line(
  'seed',
  rows.filter((row) => !isRealCue(row)),
)}

### Mismatches (${all.mismatches.length})
`);
for (const mismatch of all.mismatches) {
  console.log(
    `- ${mismatch.id}\n  - gold \`${mismatch.gold}\`\n  - got  \`${mismatch.predicted}\``,
  );
}
