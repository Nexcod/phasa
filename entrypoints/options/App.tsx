import { useState } from 'react';
import { browser } from 'wxt/browser';
import { t, type MessageKey } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import { watchUrl } from '@/src/ui/labels';
import { SavedWordList, useSavedWords } from '@/src/ui/SavedWords';
import { StatusLine } from '@/src/ui/StatusLine';
import { useBackgroundStatus } from '@/src/ui/useBackgroundStatus';
import { usePageAppearance, useSettings } from '@/src/ui/useSettings';
import { About } from './About';
import { Account } from './Account';
import { Data } from './Data';
import { KnownWords } from './KnownWords';
import { Preferences } from './Preferences';

/** Sections in page order, with the anchors other pages link to (`options.html#ai`). */
const SECTIONS: readonly { id: string; label: MessageKey }[] = [
  { id: 'known', label: 'optionsSectionOnboarding' },
  { id: 'settings', label: 'optionsSectionSettings' },
  { id: 'ai', label: 'optionsSectionAccount' },
  { id: 'data', label: 'optionsSectionData' },
  { id: 'words', label: 'optionsSectionWords' },
  { id: 'about', label: 'optionsSectionAbout' },
];

function MyWords({ client }: { client: Client }) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const { units, total, loaded, more } = useSavedWords(client, { query: trimmed });
  return (
    <section id="words" className="page__section" data-testid="phasa-options-words">
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
        emptyText={trimmed ? t('wordsNoMatch', trimmed) : undefined}
        onOpen={(context) => {
          void browser.tabs.create({ url: watchUrl(context.videoId, context.cueStartMs) });
        }}
      />
    </section>
  );
}

export function App({ client }: { client: Client }) {
  const status = useBackgroundStatus(client);
  const { settings, loaded, update } = useSettings(client);
  usePageAppearance(settings, loaded);

  return (
    <main className="page page--options">
      <header className="page__header">
        <h1>{t('optionsTitle')}</h1>
        <StatusLine status={status} className="page__status" />
      </header>
      <nav className="page__nav" aria-label={t('optionsNavLabel')}>
        {SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {t(section.label)}
          </a>
        ))}
      </nav>
      <KnownWords client={client} />
      <Preferences settings={settings} update={update} />
      <Account client={client} />
      <Data client={client} />
      <MyWords client={client} />
      <About />
    </main>
  );
}
