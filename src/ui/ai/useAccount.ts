import { useCallback, useEffect, useState } from 'react';
import type { AccountView } from '../../messaging/ai';
import type { Client } from '../../messaging/client';

/** The account screen's view (extension pages only), reloaded when AI or the SW changes. */
export function useAccount(client: Client): { view: AccountView | null; reload: () => void } {
  const [view, setView] = useState<AccountView | null>(null);
  const reload = useCallback(() => {
    client.request('account/get', {}).then(setView, () => undefined);
  }, [client]);
  useEffect(() => {
    const unsubscribe = client.onEvent((event) => {
      if (event.type === 'ai/changed' || event.type === 'sw/hello') reload();
    });
    reload();
    return unsubscribe;
  }, [client, reload]);
  return { view, reload };
}
