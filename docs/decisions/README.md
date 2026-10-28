# Architecture decision records

One file per decision: `NNNN-short-title.md`. Status is one of **Proposed** (waiting for evidence,
usually a spike), **Accepted**, **Superseded by NNNN**. Never rewrite an accepted ADR — add a new one.

| ADR                                           | Decision                                                          | Status                                        |
| --------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| [0001](0001-stack-and-scaffold.md)            | Stack, repository layout, permissions policy                      | Accepted (package manager superseded by 0008) |
| [0002](0002-captions-source.md)               | Captions: player's own timedtext request + refetch with its `pot` | Accepted                                      |
| [0003](0003-chatgpt-oauth-redirect.md)        | Capture the loopback OAuth redirect with a DNR rule (A1)          | Accepted                                      |
| [0004](0004-dictionary-and-frequency-data.md) | Dictionary and frequency data sources                             | Accepted (Volubilis pending confirmation)     |
| [0005](0005-segmentation-convention.md)       | Word unit = dictionary headword; tokenizer pipeline on top of ICU | Accepted                                      |
| [0006](0006-license.md)                       | AGPL-3.0-or-later for all code; DCO, no CLA                       | Accepted                                      |
| [0007](0007-captions-runtime.md)              | Captions runtime: fetch, choose, cache, render, sync              | Accepted                                      |
| [0008](0008-npm.md)                           | npm instead of pnpm; install-script and release-age policy        | Accepted                                      |

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
