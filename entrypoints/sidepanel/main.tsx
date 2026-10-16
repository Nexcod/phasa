import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { t } from '@/src/i18n';
import { getBackgroundClient } from '@/src/messaging/browser';
import { extensionUrl } from '@/src/ui/extension-url';
import { injectFontFaces } from '@/src/ui/fonts';
import { App } from './App';
import '@/src/ui/page.css';

document.title = t('sidepanelTitle');
injectFontFaces(document, extensionUrl);

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing');

ReactDOM.createRoot(container).render(
  <StrictMode>
    <App client={getBackgroundClient()} />
  </StrictMode>,
);
