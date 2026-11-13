/**
 * The watch page behind the store screenshots: the e2e fake player (tests/e2e/fake-youtube.ts) in
 * a plain dark video-site layout — no third-party branding, a calm abstract frame instead of a
 * video. Everything Phasa hooks into (#movie_player, ytd-watch-metadata #title, html[dark]) is
 * where YouTube has it.
 */
import { playerScript } from '../e2e/fake-youtube';

const SCENE = [
  'radial-gradient(ellipse 38% 46% at 24% 34%, rgba(251, 191, 36, 0.32), transparent 70%)',
  'radial-gradient(ellipse 30% 40% at 72% 30%, rgba(45, 212, 191, 0.26), transparent 70%)',
  'radial-gradient(ellipse 50% 40% at 60% 88%, rgba(59, 130, 246, 0.30), transparent 70%)',
  'linear-gradient(165deg, #1f3b57 0%, #12253a 55%, #0b1626 100%)',
].join(', ');

/** Gray stand-ins for a recommendations column. */
function upNext(count: number): string {
  const hues = [28, 190, 140, 260, 340, 210];
  return Array.from(
    { length: count },
    (_, i) => `
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div style="flex:0 0 168px;height:94px;border-radius:8px;background:linear-gradient(150deg, hsl(${hues[i % hues.length]} 35% 32%), hsl(${hues[i % hues.length]} 30% 16%))"></div>
      <div style="flex:1;padding-top:2px">
        <div style="height:12px;border-radius:6px;background:#3a3a3a;margin-bottom:8px"></div>
        <div style="height:12px;width:70%;border-radius:6px;background:#3a3a3a;margin-bottom:12px"></div>
        <div style="height:10px;width:45%;border-radius:5px;background:#2a2a2a"></div>
      </div>
    </div>`,
  ).join('');
}

export function showcaseWatchPage(title: string, channel: string): string {
  return `<!doctype html>
<html dark lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { margin: 0; background: #0f0f0f; color: #f1f1f1; font-family: Roboto, Arial, sans-serif; }
  header { height: 56px; display: flex; align-items: center; gap: 20px; padding: 0 24px; }
  .burger { width: 18px; height: 12px; border-top: 2px solid #f1f1f1; border-bottom: 2px solid #f1f1f1; position: relative; }
  .burger::after { content: ''; position: absolute; left: 0; right: 0; top: 5px; border-top: 2px solid #f1f1f1; }
  .search { flex: 0 1 520px; margin: 0 auto; height: 38px; border: 1px solid #303030; border-radius: 20px; background: #121212; }
  .me { width: 32px; height: 32px; border-radius: 50%; background: #3b82f6; }
  main { display: flex; gap: 24px; padding: 0 24px; }
  .primary { flex: 1; min-width: 0; max-width: 872px; }
  #player-container { width: 100%; aspect-ratio: 16 / 9; }
  #movie_player { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: 12px; background: ${SCENE}; }
  #movie_player video { opacity: 0; }
  #title h1 { margin: 12px 0 0; font-size: 20px; line-height: 28px; font-weight: 700;
    font-family: Roboto, Arial, 'Phasa Noto Sans Thai', sans-serif; }
  #top-row { display: flex; align-items: center; gap: 12px; margin-top: 12px; font-weight: 500; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(150deg, #f59e0b, #b45309); }
  aside { flex: 0 0 360px; }
  @media (max-width: 1100px) { aside { display: none; } }
  .hidden { display: none; }
</style></head>
<body>
  <header><div class="burger"></div><div class="search"></div><div class="me"></div></header>
  <main>
    <div class="primary">
      <div id="player-container">
        <div id="movie_player" class="html5-video-player ytp-autohide">
          <div class="html5-video-container"><video class="html5-main-video" muted playsinline style="width:100%;height:100%"></video></div>
          <div class="ytp-caption-window-container"></div>
        </div>
      </div>
      <ytd-watch-metadata>
        <div id="above-the-fold">
          <div id="title"><h1>${title}</h1></div>
          <div id="top-row"><div class="avatar"></div><div>${channel}</div></div>
        </div>
      </ytd-watch-metadata>
    </div>
    <aside>${upNext(6)}</aside>
  </main>
  <button id="fullscreen" class="hidden">fullscreen</button>
  <script>${playerScript(false)}</script>
</body></html>`;
}
