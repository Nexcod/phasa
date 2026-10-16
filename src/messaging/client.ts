import type { PortLike } from './port';
import {
  RpcFailure,
  isServerMessage,
  type Method,
  type Params,
  type RequestEnvelope,
  type Result,
  type ServerEvent,
  type ServerMessage,
} from './protocol';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface RequestOptions {
  /** 0 disables the timeout. */
  timeoutMs?: number;
}

export interface Client {
  request<M extends Method>(
    method: M,
    params: Params<M>,
    options?: RequestOptions,
  ): Promise<Result<M>>;
  onEvent(listener: (event: ServerEvent) => void): () => void;
  /** Rejects pending requests and drops the port. A later request reconnects. */
  close(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: RpcFailure) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * RPC client over a lazily opened port. The MV3 service worker can be
 * terminated at any time; its ports then disconnect, pending requests fail with
 * `disconnected`, and the next request opens a fresh port (waking the SW).
 */
export function createClient(connect: () => PortLike): Client {
  let port: PortLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const eventListeners = new Set<(event: ServerEvent) => void>();

  function settle(id: number): Pending | undefined {
    const entry = pending.get(id);
    if (!entry) return undefined;
    pending.delete(id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    return entry;
  }

  function failAll(reason: RpcFailure): void {
    for (const id of [...pending.keys()]) settle(id)?.reject(reason);
  }

  function handle(message: ServerMessage): void {
    if (message.kind === 'event') {
      for (const listener of eventListeners) listener(message.event);
      return;
    }
    const entry = settle(message.id);
    if (!entry) return;
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new RpcFailure(message.error.code, message.error.message));
  }

  function ensurePort(): PortLike {
    if (port) return port;
    const opened = connect();
    opened.onMessage.addListener((message) => {
      if (port === opened && isServerMessage(message)) handle(message);
    });
    opened.onDisconnect.addListener(() => {
      if (port !== opened) return;
      port = null;
      failAll(new RpcFailure('disconnected', 'Connection to the background was lost'));
    });
    port = opened;
    return opened;
  }

  return {
    request(method, params, options = {}) {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer =
          timeoutMs > 0
            ? setTimeout(() => {
                settle(id)?.reject(
                  new RpcFailure('timeout', `${method} timed out after ${timeoutMs} ms`),
                );
              }, timeoutMs)
            : undefined;
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        try {
          const envelope = { kind: 'request', id, method, params } as RequestEnvelope;
          ensurePort().postMessage(envelope);
        } catch (error) {
          // e.g. "Extension context invalidated" after the extension was reloaded.
          port = null;
          settle(id)?.reject(
            new RpcFailure('disconnected', error instanceof Error ? error.message : String(error)),
          );
        }
      });
    },

    onEvent(listener) {
      eventListeners.add(listener);
      ensurePort();
      return () => eventListeners.delete(listener);
    },

    close() {
      const current = port;
      port = null;
      failAll(new RpcFailure('disconnected', 'Client closed'));
      current?.disconnect();
    },
  };
}
