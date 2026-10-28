# 0009. Network e2e runs locally, not in CI

- Status: Accepted
- Date: 2026-10-28
- Evidence: CI runs 39013398488 … 40474134122 (nightly, 2026-10-17 – 2026-10-27); local run below

## Context

Plan §13 and ADR 0001 run the `@network` e2e tests (real youtube.com) nightly in CI. Every nightly
run since phase 2 landed failed the same way: both tests timed out with the overlay still `idle`.
The Playwright traces show why: instead of the video, YouTube shows GitHub's runners "Sign in to
confirm you're not a bot". The player never loads the video, so the extension never learns its id.
There are no requests for the video stream or captions in the trace.

The same tests pass locally from a home connection (2 of 2 in about 5 s on 2026-10-28). The phase 1
`@network` test passed in CI on 2026-10-16 only because it needed no video: it checked that the
overlay mounts and reaches the service worker.

## Decision

- CI no longer runs the `@network` tests: no `schedule` trigger, and `workflow_dispatch` runs the
  same jobs as a push.
- `npm run test:e2e:network` runs locally before every phase is accepted
  (`docs/manual-checklist.md` → Every phase), from a home connection.
- Each `@network` test first checks that YouTube will play the video (`playabilityStatus` is `OK`,
  `expectPlayable` in `tests/e2e/fixtures.ts`). A bot wall then fails at once with YouTube's reason,
  not 20 s later with an idle overlay.

Rejected: a self-hosted runner on the owner's machine (GitHub advises against self-hosted runners for
public repositories: a fork's pull request can run code on them), skipping the tests when blocked
(in CI they would always be skipped and check nothing), signed-in cookies or proxies (risk to the
account, against YouTube's terms).

## Consequences

- No automatic daily signal when YouTube changes its player response; a change shows up at the next
  phase acceptance or in daily use. The offline e2e and the recorded fixtures still guard our side.
- Revisit if a runner with a non-datacenter IP and no access for forks becomes available.
