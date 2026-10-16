/**
 * The subset of `chrome.runtime.Port` the messaging layer relies on.
 * Kept structural so tests can use an in-memory pair.
 */
export interface PortLike {
  readonly name: string;
  readonly sender?: SenderLike;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(callback: (message: unknown) => void): void };
  onDisconnect: { addListener(callback: () => void): void };
}

export interface SenderLike {
  url?: string;
  tab?: { id?: number };
}
