# 0006. License: AGPL-3.0-or-later for all code

- Status: Accepted
- Date: 2026-10-16
- Supersedes: "code under MIT" in docs/plan.md §6 and §12 (phase 7)

## Context

The plan assumed MIT. The owner may later monetize Phasa with a hosted sync server while keeping all
code public. Under MIT (or plain GPL) anyone could run a modified sync service, or ship a closed fork
of the extension, without publishing their changes.

## Decision

- All code in this repository — the extension and any future server — is licensed
  **AGPL-3.0-or-later** (SPDX `AGPL-3.0-or-later`). `LICENSE` holds the verbatim license text from
  gnu.org (sha256 `0d96a4ff…abcb0`); the copyright notice is in `README.md`.
- "or later" follows the FSF default: it keeps the code combinable with future AGPL versions.
- Data keeps its own licenses: `data/build/` under CC BY-SA 4.0 (ADR 0004), bundled fonts under
  OFL 1.1 with `OFL.txt` next to them (phase 2).
- Contributions are accepted under the same license (inbound = outbound) with a
  **Developer Certificate of Origin** sign-off (`git commit -s`), no CLA — see `CONTRIBUTING.md`.

## Consequences

- Monetization model: sell hosting/convenience (sync, backups), not the code. Anyone may self-host or
  fork, but must publish their changes, including for a network service (AGPL §13).
- Without a CLA the project cannot later be relicensed (closed edition, App Store builds) without every
  contributor's consent. If that becomes a goal, introduce a CLA **before** accepting outside code.
- Compatible dependencies today: everything bundled is MIT or Apache-2.0 (react, react-dom, scheduler,
  dexie, wxt runtime, @webext-core/\*). New runtime dependencies must be AGPLv3-compatible — no
  GPL-2.0-only, SSPL, "non-commercial" or proprietary licenses.
- Follow-ups:
  - phase 6: an "About" section in options (license name, no-warranty notice, link to the source) —
    AGPL §0/§5 "Appropriate Legal Notices";
  - phase 7: ship third-party license notices (incl. Dexie's Apache-2.0 notice) in the zip;
  - before monetizing: a trademark policy for the name "Phasa" (forks welcome under another name) and
    OpenAI's Sign in with ChatGPT interest form for paid/hosted products;
  - the future sync server must show users a link to its exact source (AGPL §13).
