/**
 * MAIN world: records the player's own `/api/timedtext` requests (fetch and
 * XHR), which carry the PoToken. Installed at document_start, before the
 * player loads. No extension APIs here (docs/plan.md §3.2 rule 3).
 */
import { describeTimedtextUrl, isTimedtextUrl, type TimedtextRequest } from '../timedtext-url';

export interface ObservedRequest extends TimedtextRequest {
  url: URL;
  settled: boolean;
  /** HTTP status; 0 for an aborted or failed request. */
  status: number;
  body: string;
}

/**
 * Videos whose requests are kept. Bodies are only reused for the current video,
 * and a long auto-generated track is ~0.5 MB, so keep just a few.
 */
const MAX_VIDEOS = 4;

export class TimedtextLog {
  private readonly byVideo = new Map<string, ObservedRequest[]>();
  private readonly waiters = new Set<() => void>();

  constructor(private readonly origin: string) {}

  add(rawUrl: string): ObservedRequest | null {
    let url: URL;
    try {
      url = new URL(rawUrl, this.origin);
    } catch {
      return null;
    }
    const request: ObservedRequest = {
      ...describeTimedtextUrl(url),
      url,
      settled: false,
      status: 0,
      body: '',
    };
    if (!request.videoId) return null;
    const list = this.byVideo.get(request.videoId) ?? [];
    list.push(request);
    this.byVideo.delete(request.videoId);
    this.byVideo.set(request.videoId, list);
    while (this.byVideo.size > MAX_VIDEOS) {
      const oldest = this.byVideo.keys().next().value;
      if (oldest === undefined) break;
      this.byVideo.delete(oldest);
    }
    this.notify();
    return request;
  }

  settle(request: ObservedRequest, status: number, body: string): void {
    request.settled = true;
    request.status = status;
    request.body = body;
    this.notify();
  }

  forVideo(videoId: string): readonly ObservedRequest[] {
    return this.byVideo.get(videoId) ?? [];
  }

  /** Resolves on the next add/settle, or after `timeoutMs`. */
  changed(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, timeoutMs));
      this.waiters.add(done);
    });
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}

/** A request whose body proves the PoToken works. */
export function isUsable(request: ObservedRequest): boolean {
  return request.hasPot && request.settled && request.status === 200 && request.body.trim() !== '';
}

function requestUrl(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return null;
}

function xhrBody(xhr: XMLHttpRequest): string {
  try {
    if (xhr.responseType === '' || xhr.responseType === 'text') return xhr.responseText;
    if (xhr.response instanceof ArrayBuffer) return new TextDecoder().decode(xhr.response);
    if (typeof xhr.response === 'string') return xhr.response;
    return xhr.response == null ? '' : JSON.stringify(xhr.response);
  } catch {
    return '';
  }
}

/**
 * Patches `fetch` and `XMLHttpRequest` to log timedtext traffic. Returns the
 * original `fetch` for our own requests, so they are not logged as the
 * player's.
 */
export function installTimedtextObserver(
  win: Window & typeof globalThis,
  log: TimedtextLog,
): { nativeFetch: typeof fetch } {
  const nativeFetch = win.fetch.bind(win);

  win.fetch = function phasaFetch(input: RequestInfo | URL, init?: RequestInit) {
    const pending = nativeFetch(input, init);
    const url = requestUrl(input);
    if (url && isTimedtextUrl(url)) {
      const request = log.add(url);
      if (request) {
        pending
          .then((response) =>
            response
              .clone()
              .text()
              .then((body) => log.settle(request, response.status, body)),
          )
          .catch(() => log.settle(request, 0, ''));
      }
    }
    return pending;
  };

  const urls = new WeakMap<XMLHttpRequest, string>();
  const proto = win.XMLHttpRequest.prototype;
  // Patching the prototype: the originals are re-applied with the right `this` below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const nativeOpen = proto.open as (this: XMLHttpRequest, ...args: unknown[]) => void;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const nativeSend = proto.send;
  proto.open = function phasaOpen(this: XMLHttpRequest, ...args: unknown[]) {
    urls.set(this, String(args[1]));
    nativeOpen.apply(this, args);
  };
  proto.send = function phasaSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const url = urls.get(this);
    if (url && isTimedtextUrl(url)) {
      const request = log.add(url);
      if (request) {
        this.addEventListener('loadend', () => log.settle(request, this.status, xhrBody(this)));
      }
    }
    nativeSend.call(this, body);
  };

  return { nativeFetch };
}
