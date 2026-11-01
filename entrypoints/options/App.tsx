import { useState } from 'react';
import { browser } from 'wxt/browser';
import { t, type MessageKey } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import { watchUrl } from '@/src/ui/labels';
import { SavedWordList, useSavedWords } from '@/src/ui/SavedWords';
import { StatusLine } from '@/src/ui/StatusLine';
import { useBackgroundStatus } from '@/src/ui/useBackgroundStatus';
import { Account } from './Account';
import { KnownWords } from './KnownWords';

const LATER_SECTIONS: readonly MessageKey[] = ['optionsSectionData'];

function MyWords({ client }: { client: Client }) {
  const [query, setQuery] = useState('');
  const { units, total, loaded, more } = useSavedWords(client, { query: query.trim() });
  return (
    <section className="page__section" data-testid="phasa-options-words">
      <h2>{t('optionsSectionWords')}</h2>
      <input
        type="search"
        className="search"
        lang="th"
        placeholder={t('wordsSearch')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <SavedWordList
        client={client}
        units={units}
        total={total}
        loaded={loaded}
        onMore={more}
        onOpen={(context) => {
          void browser.tabs.create({ url: watchUrl(context.videoId, context.cueStartMs) });
        }}
      />
    </section>
  );
}

export function App({ client }: { client: Client }) {
  const status = useBackgroundStatus(client);

  return (
    <main className="page page--options">
      <header className="page__header">
        <h1>{t('optionsTitle')}</h1>
        <StatusLine status={status} className="page__status" />
      </header>
      <KnownWords client={client} />
      <MyWords client={client} />
      <Account client={client} />
      {LATER_SECTIONS.map((key) => (
        <section key={key} className="page__section">
          <h2>{t(key)}</h2>
          <p className="page__empty">{t('comingSoon')}</p>
        </section>
      ))}
    </main>
  );
}
