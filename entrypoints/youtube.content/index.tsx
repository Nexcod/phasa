import { createShadowRootUi, defineContentScript } from '#imports';
import ReactDOM from 'react-dom/client';
import { startContentController } from '@/src/content/controller';
import { connectMainBridge } from '@/src/content/main-bridge';
import { servePanel } from '@/src/content/panel-link';
import { getBackgroundClient } from '@/src/messaging/browser';
import { extensionUrl } from '@/src/ui/extension-url';
import { injectFontFaces } from '@/src/ui/fonts';
import { Overlay } from './Overlay';
import { createVideoIdStore } from './videoId';
import './style.css';

const SHIELDED_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
const stop = (event: Event) => event.stopPropagation();

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    // @font-face inside a shadow root is ignored: declare the fonts on the page (docs/plan.md §5.1).
    injectFontFaces(document, extensionUrl);

    const client = getBackgroundClient();
    const bridge = connectMainBridge(window);
    const urlVideoId = createVideoIdStore(ctx);
    const controller = startContentController({
      win: window,
      doc: document,
      client,
      bridge,
      urlVideoId: urlVideoId.get(),
    });
    urlVideoId.subscribe(() => controller.setUrlVideoId(urlVideoId.get()));
    const stopPanel = servePanel(controller);
    ctx.onInvalidated(() => {
      stopPanel();
      controller.dispose();
      bridge.dispose();
      client.close();
    });

    const ui = await createShadowRootUi(ctx, {
      name: 'phasa-overlay',
      position: 'inline',
      anchor: '#movie_player',
      append: 'last',
      onMount(container, _shadow, host) {
        // Clicks on our UI must not reach the player (a click would toggle playback). Stopped at
        // the host, after React's listeners inside the shadow root have seen them.
        for (const type of SHIELDED_EVENTS) host.addEventListener(type, stop);
        const root = ReactDOM.createRoot(container);
        root.render(<Overlay controller={controller} />);
        return { root, host };
      },
      onRemove(mounted) {
        if (!mounted) return;
        for (const type of SHIELDED_EVENTS) mounted.host.removeEventListener(type, stop);
        mounted.root.unmount();
      },
    });
    // #movie_player appears after YouTube's SPA boots and survives navigations.
    ui.autoMount();
  },
});
