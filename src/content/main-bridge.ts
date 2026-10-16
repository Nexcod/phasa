/**
 * Isolated-world end of the MAIN-world bridge (src/captions/bridge.ts).
 */
import {
  envelope,
  openEnvelope,
  parseToIsolated,
  type FetchResult,
  type ToMainMessage,
} from '../captions/bridge';
import type { TrackRef, VideoInfo } from '../captions/types';

export interface MainBridge {
  /** Called with the player's current video (null: none) after the handshake and on every change. */
  onVideo(listener: (video: VideoInfo | null) => void): () => void;
  fetchTracks(videoId: string, refs: TrackRef[], signal?: AbortSignal): Promise<FetchResult[]>;
  dispose(): void;
}

/** Forced loads wait for ads and retries; past this the request is abandoned. */
const FETCH_TIMEOUT_MS = 30_000;
const HELLO_RETRY_MS = 500;
const HELLO_ATTEMPTS = 20;

export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

export function connectMainBridge(win: Window): MainBridge {
  const nonce = crypto.randomUUID();
  const videoListeners = new Set<(video: VideoInfo | null) => void>();
  const pending = new Map<number, (results: FetchResult[]) => void>();
  let nextRequestId = 1;
  let greeted = false;

  const post = (message: ToMainMessage) => {
    win.postMessage(envelope('main', nonce, message), win.location.origin);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== win) return;
    const opened = openEnvelope(event.data, 'isolated');
    if (opened?.nonce !== nonce) return;
    const message = parseToIsolated(opened.message);
    if (!message) return;
    if (message.type === 'video') {
      greeted = true;
      for (const listener of [...videoListeners]) listener(message.video);
    } else {
      pending.get(message.requestId)?.(message.results);
    }
  };
  win.addEventListener('message', onMessage);

  // The MAIN script runs at document_start and is normally ready; retry in case it is not yet.
  let attempts = 0;
  const hello = () => {
    if (greeted || attempts++ >= HELLO_ATTEMPTS) return;
    post({ type: 'hello' });
    helloTimer = setTimeout(hello, HELLO_RETRY_MS);
  };
  let helloTimer: ReturnType<typeof setTimeout> | undefined;
  hello();

  return {
    onVideo(listener) {
      videoListeners.add(listener);
      return () => videoListeners.delete(listener);
    },

    fetchTracks(videoId, refs, signal) {
      const requestId = nextRequestId++;
      return new Promise<FetchResult[]>((resolve, reject) => {
        const finish = () => {
          pending.delete(requestId);
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
          finish();
          reject(new BridgeError('aborted'));
        };
        const timer = setTimeout(() => {
          finish();
          reject(new BridgeError('Timed out waiting for captions from the player'));
        }, FETCH_TIMEOUT_MS);
        pending.set(requestId, (results) => {
          finish();
          resolve(results);
        });
        signal?.addEventListener('abort', onAbort, { once: true });
        post({ type: 'fetch', requestId, videoId, refs });
      });
    },

    dispose() {
      clearTimeout(helloTimer);
      win.removeEventListener('message', onMessage);
      videoListeners.clear();
      pending.clear();
    },
  };
}
