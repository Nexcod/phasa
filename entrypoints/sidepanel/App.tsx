import { t } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import { StatusLine } from '@/src/ui/StatusLine';
import { useBackgroundStatus } from '@/src/ui/useBackgroundStatus';

export function App({ client }: { client: Client }) {
  const status = useBackgroundStatus(client);

  return (
    <main className="page page--panel">
      <header className="page__header">
        <h1>{t('sidepanelTitle')}</h1>
        <StatusLine status={status} className="page__status" />
      </header>
      <p className="page__empty">{t('sidepanelEmpty')}</p>
    </main>
  );
}
