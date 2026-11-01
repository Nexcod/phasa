# Responses API streams

Server-sent event streams of `POST /v1/responses` (`stream: true`), read by
`tests/unit/ai.test.ts` through the same parser the service worker uses.

- `completed.sse` — a structured (`text.format: json_schema`) answer ending in
  `response.completed`, with the event types the phase-0 spike saw, `response.metadata`
  included (docs/spikes.md §2). The spike logged event types and counts, not raw bodies, so the
  payloads are reconstructed from OpenAI's Responses API event shapes. Replace it with a real
  recording when one is available: copy the response body from DevTools (service worker →
  Network → `responses`) and remove nothing but the text, which holds no credentials.
- `usage-limit.sse` — `response.failed` with `subscription_sharing_usage_limit_exceeded` after
  some text, as OpenAI's "Errors and recovery" page says it may arrive mid-stream.
