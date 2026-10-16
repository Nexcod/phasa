# Phasa — conventions

- Thai-only language-learning Chrome extension (MV3, WXT, TypeScript strict, React, Dexie).
- Read docs/plan.md (this plan) and docs/decisions/ before changing architecture.
- IndexedDB is accessed ONLY from extension-origin contexts (service worker, side panel, options). Content scripts talk to the SW via typed Port messages in src/messaging.
- OpenAI tokens never leave the service worker. Never log tokens.
- Responses API calls (ChatGPT plan usage): always store:false + stream:true; never send temperature/top_p/max_output_tokens/metadata/user; no role:"system" items; success only on response.completed.
- Thai text: never split inside a grapheme cluster; use Intl.Segmenter for graphemes/words; keep offset maps from normalization.
- @font-face must be injected into document.head, not inside shadow roots.
- Every Thai NLP change must keep tests/fixtures/segmentation.tsv F1 >= 0.90.
- UI copy is English; use i18n keys from day one.
- Work phase by phase from the plan; finish each phase's acceptance criteria before moving on.
