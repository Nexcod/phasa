import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@/src/messaging/client';
import {
  PORT_NAME,
  PROTOCOL_VERSION,
  RpcFailure,
  parseRequest,
  type ServerEvent,
} from '@/src/messaging/protocol';
import { classifySender, createServer, type Handlers } from '@/src/messaging/server';
import { DEFAULT_SETTINGS } from '@/src/settings';
import { createPortPair, type FakePort } from '../helpers/fake-port';

const EXT = 'chrome-extension://abcdefghijklmnop';
const PAGE_SENDER = { url: `${EXT}/sidepanel.html` };
const CONTENT_SENDER = { url: 'https://www.youtube.com/watch?v=abc', tab: { id: 7 } };

function setup(
  handlers: Partial<Handlers> = {},
  sender: { url?: string; tab?: { id?: number } } = PAGE_SENDER,
) {
  const all: Handlers = {
    ping: ({ sentAt }, ctx) => ({ sentAt, swStartedAt: ctx.tabId ?? 1 }),
    'db/info': () => ({ schemaVersion: 1, counts: {} }),
    'captions/get': () => ({ tracks: [] }),
    'captions/process': () => ({ tracks: [], failed: [] }),
    'settings/get': () => ({ ...DEFAULT_SETTINGS }),
    'settings/set': ({ patch }) => ({ ...DEFAULT_SETTINGS, ...patch }),
    ...handlers,
  };
  const server = createServer(all, { extensionOrigin: EXT, swStartedAt: 1 });
  const ports: FakePort[] = [];
  const client = createClient(() => {
    const [clientEnd, serverEnd] = createPortPair(PORT_NAME, sender);
    ports.push(serverEnd);
    server.attach(serverEnd);
    return clientEnd;
  });
  return { client, ports, server };
}

describe('classifySender', () => {
  it('trusts only the extension origin as an extension page', () => {
    expect(classifySender(PAGE_SENDER, EXT)).toBe('extension-page');
    expect(classifySender(CONTENT_SENDER, EXT)).toBe('content-script');
    expect(classifySender({ url: 'https://www.youtube.com/' }, EXT)).toBeNull();
    expect(classifySender(undefined, EXT)).toBeNull();
  });
});

describe('parseRequest', () => {
  it('rejects malformed envelopes and unknown methods', () => {
    expect(parseRequest(null)).toMatchObject({ ok: false, id: null });
    expect(parseRequest({ kind: 'request', id: 1, method: 'nope', params: {} })).toMatchObject({
      ok: false,
      id: 1,
      error: { code: 'unknown_method' },
    });
    expect(parseRequest({ kind: 'request', id: 2, method: 'ping', params: 5 })).toMatchObject({
      ok: false,
      error: { code: 'bad_request' },
    });
    expect(parseRequest({ kind: 'request', id: 3, method: 'ping', params: { sentAt: 1 } }).ok).toBe(
      true,
    );
  });
});

describe('client ↔ server', () => {
  it('round-trips a typed request with the sender context', async () => {
    const { client } = setup({}, CONTENT_SENDER);
    await expect(client.request('ping', { sentAt: 42 })).resolves.toEqual({
      sentAt: 42,
      swStartedAt: 7,
    });
  });

  it('delivers the hello event on connect', async () => {
    const { client } = setup();
    const events: ServerEvent[] = [];
    client.onEvent((event) => events.push(event));
    await client.request('ping', { sentAt: 0 });
    expect(events).toEqual([{ type: 'sw/hello', protocol: PROTOCOL_VERSION, swStartedAt: 1 }]);
  });

  it('broadcasts events to every connected context until it disconnects', async () => {
    const { client, ports, server } = setup();
    const events: ServerEvent[] = [];
    client.onEvent((event) => events.push(event));
    await client.request('ping', { sentAt: 0 });
    const settings = { ...DEFAULT_SETTINGS, autoPause: true };
    server.broadcast({ type: 'settings/changed', settings });
    await Promise.resolve();
    expect(events.at(-1)).toEqual({ type: 'settings/changed', settings });

    ports[0]!.disconnect();
    await Promise.resolve();
    expect(() => server.broadcast({ type: 'settings/changed', settings })).not.toThrow();
  });

  it('propagates handler errors as RpcFailure without stack traces', async () => {
    const { client } = setup({
      'db/info': () => {
        throw new Error('boom');
      },
    });
    const error = await client.request('db/info', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcFailure);
    expect(error).toMatchObject({ code: 'internal', message: 'boom' });
  });

  it('keeps RpcFailure codes from handlers', async () => {
    const { client } = setup({
      'db/info': () => {
        throw new RpcFailure('bad_request', 'nope');
      },
    });
    await expect(client.request('db/info', {})).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('refuses ports from unknown senders', async () => {
    const { client } = setup({}, { url: 'https://evil.example/' });
    await expect(client.request('ping', { sentAt: 0 })).rejects.toMatchObject({
      code: 'disconnected',
    });
  });

  it('fails pending requests when the SW goes away and reconnects on the next request', async () => {
    let release: (() => void) | undefined;
    const { client, ports } = setup({
      ping: ({ sentAt }) =>
        new Promise((resolve) => {
          release = () => resolve({ sentAt, swStartedAt: 1 });
        }),
    });
    const pending = client.request('ping', { sentAt: 1 });
    await Promise.resolve();
    ports[0]!.disconnect(); // SW terminated
    await expect(pending).rejects.toMatchObject({ code: 'disconnected' });
    release?.(); // late result on a dead port must not throw

    await expect(client.request('db/info', {})).resolves.toMatchObject({ schemaVersion: 1 });
    expect(ports).toHaveLength(2);
  });

  it('times out', async () => {
    vi.useFakeTimers();
    try {
      const { client } = setup({ ping: () => new Promise(() => undefined) });
      const pending = client.request('ping', { sentAt: 1 }, { timeoutMs: 50 });
      vi.advanceTimersByTime(51);
      await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});
