# Data attribution

Data files in this directory are built by `scripts/build-dictionary.ts` and
`scripts/build-frequency.ts` (phase 3) and are licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/)
unless stated otherwise. The source code is licensed under AGPL-3.0-or-later (see `LICENSE`).

Sources (ADR 0004):

- **Wiktionary** — Thai entries of the English Wiktionary, © Wiktionary contributors,
  CC BY-SA 4.0 / GFDL. https://en.wiktionary.org/
  Extracted with wiktextract (Tatu Ylonen, "Wiktextract: Wiktionary as Machine-Readable Structured
  Data", LREC 2022) via https://kaikki.org/dictionary/Thai/
- **Thai National Corpus / Thai Textbook Corpus word frequencies** — via PyThaiNLP, CC0-1.0.
  https://github.com/PyThaiNLP/pythainlp

Volubilis (Francis Bastien) is a planned supplementary source (ADR 0004). It is not used in the
current build: checking its license and value is deferred until after the plan's phases (ADR 0010,
Deferred).

Files:

- `dict.json`, `dict.meta.json` — Thai headwords with glosses, romanization and syllables derived
  from Wiktionary (CC BY-SA 4.0), frequency ranks from the corpora above. Built by
  `npm run data:dict`; sources, retrieval dates and checksums are in `dict.meta.json`.
- `freq.json` — the 30 000 most frequent Thai words of the Thai National Corpus (CC0-1.0). Built by
  `npm run data:freq`.
