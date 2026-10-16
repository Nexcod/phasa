import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { createHandlers } from '@/src/background/handlers';
import { getDb } from '@/src/db';
import { PORT_NAME, type ServerEvent } from '@/src/messaging/protocol';
import { createServer } from '@/src/messaging/server';

export default defineBackground(() => {
  const swStartedAt = Date.now();

  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('[phasa] sidePanel.setPanelBehavior failed', error));

  // Handlers broadcast through the server created right below.
  let broadcast: (event: ServerEvent) => void = () => undefined;
  const server = createServer(
    createHandlers({ db: getDb, swStartedAt, broadcast: (event) => broadcast(event) }),
    {
      extensionOrigin: self.location.origin,
      swStartedAt,
      onHandlerError: (method, error) => console.error(`[phasa] ${method} failed`, error),
    },
  );
  broadcast = (event) => server.broadcast(event);

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PORT_NAME) server.attach(port);
  });
});
