import { t, type MessageKey } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import { StatusLine } from '@/src/ui/StatusLine';
import { useBackgroundStatus } from '@/src/ui/useBackgroundStatus';

const SECTIONS: readonly MessageKey[] = [
  'optionsSectionOnboarding',
  'optionsSectionData',
  'optionsSectionAccount',
];

export function App({ client }: { client: Client }) {
  const status = useBackgroundStatus(client);

  return (
    <main className="page page--options">
      <header className="page__header">
        <h1>{t('optionsTitle')}</h1>
        <StatusLine status={status} className="page__status" />
      </header>
      {SECTIONS.map((key) => (
        <section key={key} className="page__section">
          <h2>{t(key)}</h2>
          <p className="page__empty">{t('comingSoon')}</p>
        </section>
      ))}
    </main>
  );
}
