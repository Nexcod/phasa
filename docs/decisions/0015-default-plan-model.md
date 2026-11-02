# 0015. GPT-6-Luna is the ChatGPT plan's default model

- Status: Accepted
- Date: 2026-11-02
- Evidence: owner's comparison of models in the phase 5 manual check
  ([checklist](../manual-checklist.md), "Default model"; the timings were not recorded);
  `tests/unit/ai-service.test.ts`

## Context

ADR 0014 made the first model of OpenAI's `/v1/models` list the default for the ChatGPT plan,
since the list has no "fast" marker, and asked to revisit that if a later-listed model was clearly
faster at similar quality. The spike's list began with GPT-6.1-Sol; GPT-6-Luna came fourth. In the
phase 5 manual check the owner compared the first model with the Luna ones on live words and chose
GPT-6-Luna.

## Decision

With no model chosen in Options → AI, the plan uses `GPT-6-Luna` when OpenAI lists it for the
account, otherwise the first listed model, as before (`src/ai/models.ts`). The options page's
empty choice names that model ("Default: GPT-6-Luna"). A model the user picked stays theirs. The
API key still has no default.

## Consequences

- One slug is now written into the code. If OpenAI renames or drops it, the default goes back to
  the first listed model without an error. Check the slug when OpenAI's list changes.
- Cache lookups use the remembered default (ADR 0014). Until the first request after this change
  stores `GPT-6-Luna`, opening a word can still show an answer saved under the old default.
- Revisit when OpenAI's list gains a model that is clearly faster at similar quality.
