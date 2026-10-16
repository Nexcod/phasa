import { useCallback, useEffect, useState } from 'react';
import type { Client } from '../messaging/client';
import { DEFAULT_SETTINGS, type Settings } from '../settings';

/** Settings from the SW, kept current through `settings/changed`; updates are optimistic. */
export function useSettings(client: Client): {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
} {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let active = true;
    const load = () => {
      client.request('settings/get', {}).then(
        (next) => {
          if (active) setSettings(next);
        },
        () => undefined,
      );
    };
    const unsubscribe = client.onEvent((event) => {
      if (event.type === 'settings/changed') setSettings(event.settings);
      else load();
    });
    load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((current) => ({ ...current, ...patch }));
      client.request('settings/set', { patch }).then(setSettings, () => undefined);
    },
    [client],
  );

  return { settings, update };
}
