import { useEffect, useState } from 'react';
import type { Client } from '../messaging/client';

export type BackgroundStatus =
  | { state: 'connecting' }
  | { state: 'connected'; schemaVersion: number }
  | { state: 'error'; message: string };

/** Asks the SW for DB info; re-asks whenever the SW (re)starts and says hello. */
export function useBackgroundStatus(client: Client): BackgroundStatus {
  const [status, setStatus] = useState<BackgroundStatus>({ state: 'connecting' });

  useEffect(() => {
    let active = true;
    const refresh = () => {
      client.request('db/info', {}).then(
        (info) => {
          if (active) setStatus({ state: 'connected', schemaVersion: info.schemaVersion });
        },
        (error: unknown) => {
          if (active)
            setStatus({
              state: 'error',
              message: error instanceof Error ? error.message : String(error),
            });
        },
      );
    };
    // sw/hello is the only server event so far; filter by type once there are more.
    const unsubscribe = client.onEvent(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  return status;
}
