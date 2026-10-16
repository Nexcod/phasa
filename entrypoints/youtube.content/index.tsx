import { createShadowRootUi, defineContentScript } from '#imports';
import ReactDOM from 'react-dom/client';
import { getBackgroundClient } from '@/src/messaging/browser';
import { Overlay } from './Overlay';
import { createVideoIdStore } from './videoId';
import './style.css';

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const client = getBackgroundClient();
    const videoId = createVideoIdStore(ctx);
    ctx.onInvalidated(() => client.close());

    const ui = await createShadowRootUi(ctx, {
      name: 'phasa-overlay',
      position: 'inline',
      anchor: '#movie_player',
      append: 'last',
      onMount(container) {
        const root = ReactDOM.createRoot(container);
        root.render(<Overlay client={client} videoId={videoId} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    // #movie_player appears after YouTube's SPA boots and survives navigations.
    ui.autoMount();
  },
});
