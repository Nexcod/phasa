import type { PortLike, SenderLike } from './port';
import {
  METHOD_ACCESS,
  PROTOCOL_VERSION,
  RpcFailure,
  parseRequest,
  type EventEnvelope,
  type Method,
  type Origin,
  type Params,
  type ResponseEnvelope,
  type Result,
  type RpcError,
  type ServerEvent,
} from './protocol';

export interface RequestContext {
  origin: Origin;
  tabId: number | undefined;
}

export type Handlers = {
  [M in Method]: (params: Params<M>, context: RequestContext) => Result<M> | Promise<Result<M>>;
};

export interface ServerOptions {
  /** e.g. `chrome-extension://<id>` — pages on this origin are trusted extension pages. */
  extensionOrigin: string;
  swStartedAt: number;
  onHandlerError?: (method: Method, error: unknown) => void;
}

export function classifySender(
  sender: SenderLike | undefined,
  extensionOrigin: string,
): Origin | null {
  if (!sender?.url) return null;
  // Prefix check rather than URL#origin: non-browser runtimes report "null" for chrome-extension: URLs.
  if (sender.url.startsWith(`${extensionOrigin}/`)) return 'extension-page';
  // Content scripts always run inside a tab; anything else is unexpected.
  return sender.tab ? 'content-script' : null;
}

function toRpcError(error: unknown): RpcError {
  if (error instanceof RpcFailure) return { code: error.code, message: error.message };
  return { code: 'internal', message: error instanceof Error ? error.message : 'Internal error' };
}

export interface Server {
  /** Serve one connected port until it disconnects. */
  attach(port: PortLike): void;
  /** Push an event to every connected context. */
  broadcast(event: ServerEvent): void;
}

export function createServer(handlers: Handlers, options: ServerOptions): Server {
  const connections = new Set<(message: EventEnvelope) => void>();

  return {
    broadcast(event) {
      for (const send of connections) send({ kind: 'event', event });
    },

    attach(port) {
      const origin = classifySender(port.sender, options.extensionOrigin);
      if (!origin) {
        port.disconnect();
        return;
      }
      const context: RequestContext = { origin, tabId: port.sender?.tab?.id };
      let connected = true;
      port.onDisconnect.addListener(() => {
        connected = false;
        connections.delete(send);
      });

      const send = (message: ResponseEnvelope | EventEnvelope) => {
        if (!connected) return;
        try {
          port.postMessage(message);
        } catch {
          connected = false; // the client went away while a handler was running
        }
      };

      port.onMessage.addListener((raw) => {
        const parsed = parseRequest(raw);
        if (!parsed.ok) {
          if (parsed.id !== null)
            send({ kind: 'response', id: parsed.id, ok: false, error: parsed.error });
          return;
        }
        const { id, method, params } = parsed.request;
        if (!METHOD_ACCESS[method].includes(origin)) {
          send({
            kind: 'response',
            id,
            ok: false,
            error: { code: 'forbidden', message: `${method} is not available to ${origin}` },
          });
          return;
        }
        const handler = handlers[method] as (p: typeof params, c: RequestContext) => unknown;
        Promise.resolve()
          .then(() => handler(params, context))
          .then(
            (result) => send({ kind: 'response', id, ok: true, result }),
            (error: unknown) => {
              options.onHandlerError?.(method, error);
              send({ kind: 'response', id, ok: false, error: toRpcError(error) });
            },
          );
      });

      connections.add(send);
      send({
        kind: 'event',
        event: { type: 'sw/hello', protocol: PROTOCOL_VERSION, swStartedAt: options.swStartedAt },
      });
    },
  };
}
