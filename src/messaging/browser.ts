import { browser } from 'wxt/browser';
import { createClient, type Client } from './client';
import type { PortLike } from './port';
import { PORT_NAME } from './protocol';

export function connectToBackground(): PortLike {
  const port = browser.runtime.connect({ name: PORT_NAME });
  port.onDisconnect.addListener(() => {
    // Reading lastError marks it handled; disconnects are expected when the SW restarts.
    const error = browser.runtime.lastError;
    if (error) console.debug('[phasa] background port closed:', error.message);
  });
  return port;
}

let shared: Client | undefined;

/** One client per JS context (content script, side panel, options page). */
export function getBackgroundClient(): Client {
  return (shared ??= createClient(connectToBackground));
}
