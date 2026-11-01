# 0012. Badge counts distinct new words; ASR artifacts don't count

- Status: Accepted
- Date: 2026-11-01
- Evidence: owner's manual check of phase 4 on a 20-minute vlog with auto-generated captions;
  `tests/unit/analysis.test.ts` ("artifacts of auto-generated captions")

## Context

On a real vlog (auto-generated Thai captions, "Cape Town") the badge read
`B1 · 88% known · 1354 new (464 unique)` while the details said `Known 794 · New 464`, with a status
bar about 63 % green. All three were right — 88 % of the ~11 300 word occurrences are known,
the 464 distinct new words occur 1 354 times, 794 + 464 distinct words in all — but the plan's
format (§7.4, ADR 0011) put occurrences and distinct words side by side under the same word "new",
and the reader compared numbers that measure different things.

The same video's "Top new words to learn first" opened with `ป ×33` and `ออ ×21`. `ป` is a lone
letter: auto-generated captions cut words at segment ends (the test fixture has `จ`), and TNC's
frequency list ranks `ป` (≈ 3 541, an abbreviation letter), so ADR 0011's rule "in the dictionary
or the frequency list" let it through. `ออ` is a held sound: `คืออออ` tokenizes as `คือ|ออ`, and
`ออ` "to crowd" is a dictionary word. Both also counted as new words in the coverage.

## Decision

**Badge**: `B1 · 88% known · 464 new words` — the share of what you will hear that is known, and the
distinct new words, the same number as "New" in the details. The details add "Occurrences of new
words: 1354 — 12% of what you will hear." and title the status bar and its legend "Distinct words".
This replaces the plan's `142 new (61 unique)`.

**Statistics** (src/analysis/analyze.ts, `buildProfile`) skip two artifacts, besides names and `ๆ`:

- an **elongation**: a token that repeats one letter, written right after a word ending with that
  letter (`คือ|ออ`, `มาก|กก`); it is part of that word, like `ๆ`, and adds no syllables. After a
  space or after another letter (`ที่|ออ`) the same letters still count as a word;
- a **fragment**: a single grapheme cluster that is not in the dictionary (`ป`, `จ`). It is still
  speech for the speech rate. One-cluster words (`ณ`, `ก็`) are in the dictionary and count.

The tokenizer is unchanged: the subtitles still show `ออ` and `ป` as words of their own (F1 gate
untouched); only the analysis treats them as artifacts.

## Consequences

- Coverage rises slightly on auto-generated captions (artifacts no longer count as unknown words),
  and the top new words start with real words.
- A real word written as a repeated letter right after a word ending in that letter (`ยัง|งง`,
  "still confused") is taken for an elongation. Rare; the cost is one missed occurrence.
- If the subtitles should also merge elongations into the word before them, that is a tokenizer
  change and goes through the segmentation gold set.
