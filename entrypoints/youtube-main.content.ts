import { defineContentScript } from '#imports';

/**
 * MAIN-world script: shares `window` with the YouTube player so it can observe
 * the player's own /api/timedtext requests (they carry the PoToken) and call
 * the player API. It must stay minimal: no user data, no extension APIs.
 * Results go to the isolated content script via window.postMessage.
 *
 * Interception lands in phase 2 once the captions spike settles the approach
 * (docs/spikes.md, docs/decisions/0002-captions-source.md).
 */
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    document.documentElement.dataset.phasaMain = 'ready';
  },
});
