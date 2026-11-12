import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { t } from '@/src/i18n';
import { getBackgroundClient } from '@/src/messaging/browser';
import { applyCachedTheme } from '@/src/ui/appearance';
import { App } from './App';
import '@/src/ui/page.css';

document.title = t('callbackTitle');

// The OAuth query carries a one-time code: read it once and drop it from the address bar and
// history before anything else (docs/decisions/0003-chatgpt-oauth-redirect.md).
const search = location.search;
history.replaceState(null, '', location.pathname);
applyCachedTheme(document);

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing');

ReactDOM.createRoot(container).render(
  <StrictMode>
    <App client={getBackgroundClient()} search={search} />
  </StrictMode>,
);
