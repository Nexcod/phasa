import type { PortLike, SenderLike } from '@/src/messaging/port';

type Listener<T extends unknown[]> = (...args: T) => void;

class FakePort implements PortLike {
  peer!: FakePort;
  connected = true;
  readonly posted: unknown[] = [];
  private readonly messageListeners: Listener<[unknown]>[] = [];
  private readonly disconnectListeners: Listener<[]>[] = [];

  constructor(
    readonly name: string,
    readonly sender?: SenderLike,
  ) {}

  onMessage = { addListener: (cb: Listener<[unknown]>) => void this.messageListeners.push(cb) };
  onDisconnect = { addListener: (cb: Listener<[]>) => void this.disconnectListeners.push(cb) };

  postMessage(message: unknown): void {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    this.posted.push(message);
    // Structured clone + async delivery, like chrome.runtime ports.
    const copy = structuredClone(message);
    queueMicrotask(() => {
      if (this.peer.connected) for (const cb of this.peer.messageListeners) cb(copy);
    });
  }

  /** Like Chrome: onDisconnect fires asynchronously, on the other end only. */
  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    queueMicrotask(() => {
      if (!this.peer.connected) return;
      this.peer.connected = false;
      for (const cb of this.peer.disconnectListeners) cb();
    });
  }
}

/** Returns [clientEnd, serverEnd]; the server end carries `sender` like chrome's onConnect port. */
export function createPortPair(name: string, sender: SenderLike): [FakePort, FakePort] {
  const client = new FakePort(name);
  const server = new FakePort(name, sender);
  client.peer = server;
  server.peer = client;
  return [client, server];
}

export type { FakePort };
