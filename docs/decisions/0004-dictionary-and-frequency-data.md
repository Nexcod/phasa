# 0004. Dictionary and frequency data sources

- Status: Accepted (Volubilis: pending confirmation of the license file in the release archive)
- Date: 2026-10-16
- Evidence: docs/spikes.md §4

## Decision

| Role                                                       | Source                                                                         | License                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| Base dictionary (glosses, POS, pronunciation, classifiers) | English Wiktionary Thai entries via kaikki.org / wiktextract                   | CC BY-SA 4.0 + GFDL       |
| Supplementary glosses / romanization                       | Volubilis (F. Bastien)                                                         | CC BY-SA 4.0 (to confirm) |
| Frequency rank                                             | PyThaiNLP `tnc_freq.txt` (Thai National Corpus), tie-break with `ttc_freq.txt` | CC0-1.0                   |
| Segmentation evaluation only (not shipped)                 | wisesight-1000                                                                 | CC0-1.0                   |

**Not used in v1:** LEXiTRON (conflicting/unspecified license statements across NECTEC catalogs),
wordfreq (no Thai).

- Shipped data in `data/build/` is licensed **CC BY-SA 4.0**; `data/build/ATTRIBUTION.md` credits
  Wiktionary contributors (with a link), kaikki.org/wiktextract, Volubilis, PyThaiNLP/TNC/TTC.
- Raw downloads go to `data/raw/` (git-ignored); `scripts/build-dictionary.ts` and
  `scripts/build-frequency.ts` (phase 3) are the only way data enters `data/build/`.
- kaikki's per-language Thai JSONL is marked deprecated; the build script must support filtering the
  raw English-Wiktionary dump by `lang_code == "th"` as the long-term path.

## Consequences

- The extension package mixes AGPL-3.0-or-later code (ADR 0006) and CC BY-SA data — the store listing
  and README must say so.
- User-facing romanization defaults to Paiboon+, which Wiktionary doesn't provide for every entry;
  rule-based fallback (plan §5.5) is required and labelled "approximate".
