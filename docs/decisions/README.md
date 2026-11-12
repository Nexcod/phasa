# Architecture decision records

One file per decision: `NNNN-short-title.md`. Status is one of **Proposed** (waiting for evidence,
usually a spike), **Accepted**, **Superseded by NNNN**. Never rewrite an accepted ADR — add a new one.

| ADR                                            | Decision                                                                   | Status                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [0001](0001-stack-and-scaffold.md)             | Stack, repository layout, permissions policy                               | Accepted (package manager superseded by 0008, nightly `@network` e2e by 0009, toolbar by 0016) |
| [0002](0002-captions-source.md)                | Captions: player's own timedtext request + refetch with its `pot`          | Accepted                                                                                       |
| [0003](0003-chatgpt-oauth-redirect.md)         | Capture the loopback OAuth redirect with a DNR rule (A1)                   | Accepted (token storage and the rest of the AI stack: 0014)                                    |
| [0004](0004-dictionary-and-frequency-data.md)  | Dictionary and frequency data sources                                      | Accepted (Volubilis deferred until after v1, see 0010)                                         |
| [0005](0005-segmentation-convention.md)        | Word unit = dictionary headword; tokenizer pipeline on top of ICU          | Accepted                                                                                       |
| [0006](0006-license.md)                        | AGPL-3.0-or-later for all code; DCO, no CLA                                | Accepted                                                                                       |
| [0007](0007-captions-runtime.md)               | Captions runtime: fetch, choose, cache, render, sync                       | Accepted (cache eviction: 0016)                                                                |
| [0008](0008-npm.md)                            | npm instead of pnpm; install-script and release-age policy                 | Accepted                                                                                       |
| [0009](0009-network-e2e-runs-locally.md)       | `@network` e2e runs locally before phase acceptance, not nightly in CI     | Accepted                                                                                       |
| [0010](0010-dictionary-build-and-tokenizer.md) | Dictionary build and packaging; convention rules; tokenizer pipeline       | Accepted                                                                                       |
| [0011](0011-video-analysis-and-onboarding.md)  | Video analysis in the SW; top-N / import onboarding; change signal         | Accepted (badge wording, ASR artifacts: 0012; level cap: 0013)                                 |
| [0012](0012-badge-counts-and-asr-artifacts.md) | Badge counts distinct new words; ASR elongations and fragments don't count | Accepted                                                                                       |
| [0013](0013-level-capped-by-delivery.md)       | The level is capped one above the delivery (speech rate, line length)      | Accepted                                                                                       |
| [0014](0014-ai-and-account.md)                 | AI: credentials in the extension's IndexedDB, requests, streaming, cache   | Accepted (default model: 0015; cache hits checked: 0016)                                       |
| [0015](0015-default-plan-model.md)             | GPT-6-Luna is the ChatGPT plan's default model when listed                 | Accepted                                                                                       |
| [0016](0016-data-settings-and-polish.md)       | Backup and restore, word lists, appearance settings, toolbar popup, polish | Accepted                                                                                       |

## Template

```md
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Evidence: docs/spikes.md §N, links

## Context

What forces are at play, what the plan says, what we learned.

## Decision

What we do.

## Consequences

What becomes easier/harder; follow-ups; how we'd know to revisit.
```
