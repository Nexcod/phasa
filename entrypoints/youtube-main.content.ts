import { defineContentScript } from '#imports';
import { startMainWorld } from '@/src/captions/main';

/**
 * MAIN-world script: shares `window` with the YouTube player so it can observe
 * the player's own /api/timedtext requests (they carry the PoToken) and call
 * the player API. It must stay minimal: no user data, no extension APIs.
 * Results go to the isolated content script via window.postMessage
 * (src/captions/bridge.ts, docs/decisions/0002-captions-source.md).
 */
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    startMainWorld(window);
  },
});
