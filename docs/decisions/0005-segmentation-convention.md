# 0005. Word unit = dictionary headword; tokenizer pipeline on top of ICU

- Status: Accepted
- Date: 2026-10-16
- Evidence: docs/spikes.md §3

## Context

Raw `Intl.Segmenter('th')` scores F1 0.93 on our subtitle-style seed set but 0.89 on wisesight-1000.
Most of the gap is the **annotation convention**, not the algorithm: wisesight splits compounds
(`จัด|การ`, `รู้|สึก`), our seed keeps dictionary words whole. For a learner the unit that matters is the
one that has a dictionary entry, a status, and a frequency rank.

## Decision

1. **The unit of segmentation and statistics is the dictionary headword** of our built dictionary
   (Wiktionary + Volubilis). Rules for the gold set are in `tests/fixtures/README.md`.
2. Tokenizer pipeline (phase 3):
   1. `Intl.Segmenter('th', { granularity: 'word' })`;
   2. `ๆ` → separate `repeat` token (attached to the previous word for statistics);
   3. greedy merge of ≤ 4 adjacent tokens when the concatenation is a dictionary entry or a user phrase;
   4. split an ICU token that is not a dictionary entry but is a concatenation of dictionary entries;
   5. user merge/split rules (global, stored in `segRules`);
   6. runs of the same punctuation stay one `punct` token.

   Every merge/split operates on grapheme boundaries only.

3. `tests/fixtures/segmentation.tsv` is the gate (F1 ≥ 0.90, Thai–Thai boundaries). It currently holds
   50 assistant-written seed lines; phase 3 extends it to ≥ 200 real cues (manual and asr) and the
   seed rows get native-speaker review.

## Consequences

- Segmentation quality depends on dictionary coverage; loanwords/brands need user rules or AI.
- Changing the dictionary can change segmentation → the F1 test runs against the built dictionary.
