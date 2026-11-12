import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { t } from '@/src/i18n';
import { getBackgroundClient } from '@/src/messaging/browser';
import { applyCachedTheme } from '@/src/ui/appearance';
import { extensionUrl } from '@/src/ui/extension-url';
import { injectFontFaces } from '@/src/ui/fonts';
import { App } from './App';
import '@/src/ui/page.css';

document.title = t('optionsTitle');
applyCachedTheme(document);
// Lists show Thai words: the bundled fonts, declared in <head> like everywhere (docs/plan.md §5.1).
injectFontFaces(document, extensionUrl);

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing');

ReactDOM.createRoot(container).render(
  <StrictMode>
    <App client={getBackgroundClient()} />
  </StrictMode>,
);
