import { browser } from 'wxt/browser';
import { createClient, type Client } from './client';
import type { PortLike } from './port';
import { CHANGE_SIGNAL_KEY, PORT_NAME } from './protocol';

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

/**
 * One client per JS context (content script, side panel, options page). It reconnects when the SW
 * signals a change through storage while its port is closed (see {@link CHANGE_SIGNAL_KEY}).
 */
export function getBackgroundClient(): Client {
  if (shared) return shared;
  const client = createClient(connectToBackground);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, CHANGE_SIGNAL_KEY)) client.connect();
  });
  return (shared = client);
}
