import { useCallback, useEffect, useState } from 'react';
import type { Client } from '../messaging/client';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { applyPageAppearance } from './appearance';

/** Settings from the SW, kept current through `settings/changed`; updates are optimistic. */
export function useSettings(client: Client): {
  settings: Settings;
  /** False until the SW answered: `settings` are the defaults until then. */
  loaded: boolean;
  update: (patch: Partial<Settings>) => void;
} {
  const [state, setState] = useState<{ settings: Settings; loaded: boolean }>({
    settings: DEFAULT_SETTINGS,
    loaded: false,
  });

  useEffect(() => {
    let active = true;
    const load = () => {
      client.request('settings/get', {}).then(
        (settings) => {
          if (active) setState({ settings, loaded: true });
        },
        () => undefined,
      );
    };
    const unsubscribe = client.onEvent((event) => {
      if (event.type === 'settings/changed') setState({ settings: event.settings, loaded: true });
      else if (event.type === 'sw/hello') load();
    });
    load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setState((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
      client.request('settings/set', { patch }).then(
        (settings) => setState({ settings, loaded: true }),
        () => undefined,
      );
    },
    [client],
  );

  return { settings: state.settings, loaded: state.loaded, update };
}

/** Extension pages: theme, Thai font and tone colors from the settings (src/ui/appearance.ts). */
export function usePageAppearance(settings: Settings, loaded: boolean): void {
  useEffect(() => {
    if (loaded) applyPageAppearance(document, settings);
  }, [settings, loaded]);
}
