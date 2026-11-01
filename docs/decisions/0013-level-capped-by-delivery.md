# 0013. The level is capped by the delivery

- Status: Accepted
- Date: 2026-11-01
- Evidence: owner's check on "สัตว์น่ารู้ 40 ชนิด" (animal names, English–Thai);
  `tests/unit/analysis.test.ts` ("levels")

## Context

ADR 0011's level is a weighted mean of five feature scores, vocabulary 65 % of the weight. A kids'
word-list video — one animal name per line, long pauses: 0.5 syllables a second, 1.8 words a line —
came out **B2**. Its words are basic for a learner but rare in written Thai, where the TNC ranks
come from: `หมี` "bear" 3 914, `สิงโต` "lion" 5 630, `ยีราฟ` 5 196, `แรด` 7 491; 41 % of its words
fall outside the top 3 000. The vocabulary scores hit the top (0.65 × 5 = 3.25) and the slow,
short delivery could only fail to add to them. Re-weighting during calibration would not fix
this: a mean can't say "a slow word list is for beginners, whatever its nouns".

## Decision

The level score is `min(weighted mean of all five features, delivery score + 1)`, where the
delivery score is the weighted mean of speech rate and words per line alone
(src/analysis/levels.ts). That video: delivery A1, so at most **A2**. Ordinary speech is not
affected: a talk at 5.5 syllables a second and 9 words a line has a delivery near B1, cap B2–C1,
above what its vocabulary gives.

## Consequences

- Slow, clearly segmented content (lessons, word lists, songs for children) can't be rated above
  one level over its delivery, whatever its vocabulary.
- Speech rate comes from cue timing; auto-generated cues that span long pauses lower it, and with it
  the cap. Calibration (after phase 7, `tests/fixtures/levels.csv`) should include such videos.
- The frequency source stays TNC (written Thai). A spoken-Thai list (subtitle corpora) is a
  candidate for the calibration work, subject to its license (ADR 0004).
