import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ContentController } from '@/src/content/controller';
import { t } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import { AnalysisCard } from '@/src/ui/AnalysisCard';
import { useVideoAnalysis, type AnalysisTrack } from '@/src/ui/useVideoAnalysis';

type Theme = 'light' | 'dark';

function themeOf(doc: Document): Theme {
  return doc.documentElement.hasAttribute('dark') ? 'dark' : 'light';
}

/** YouTube's theme: its `<html dark>` attribute (docs/plan.md §10). */
function useYouTubeTheme(doc: Document): Theme {
  const [theme, setTheme] = useState(() => themeOf(doc));
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(themeOf(doc)));
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['dark'] });
    return () => observer.disconnect();
  }, [doc]);
  return theme;
}

/**
 * The analysis badge under the video title (docs/plan.md §7.4): level, known share and new words,
 * opening the details. Grey "No Thai subtitles" for videos without a Thai track (plan §4.1).
 */
export function TitleBadge({
  controller,
  client,
}: {
  controller: ContentController;
  client: Client;
}) {
  const state = useSyncExternalStore(controller.store.subscribe, controller.store.get);
  const theme = useYouTubeTheme(document);
  const { session, urlVideoId } = state;
  const current = session.status !== 'idle' && session.video.videoId === urlVideoId;
  let track: AnalysisTrack | null = null;
  if (current && session.status === 'ready') {
    track = { videoId: session.video.videoId, trackKey: session.thai.key };
    if (session.english.status === 'ready') track.englishKey = session.english.track.key;
  }
  const analysis = useVideoAnalysis(client, track);

  if (!current) return null;
  if (session.status === 'no-thai') {
    return (
      <div className="phasa-title-badge" data-theme={theme} data-testid="phasa-title-badge">
        <div className="phasa-analysis" data-state="no-thai">
          <span className="phasa-analysis__badge" data-comprehension="none">
            {t('captionsNoThai')}
          </span>
        </div>
      </div>
    );
  }
  if (!track) return null;
  return (
    <div className="phasa-title-badge" data-theme={theme} data-testid="phasa-title-badge">
      <AnalysisCard
        key={`${track.videoId}/${track.trackKey}`}
        state={analysis.state}
        markNew={analysis.markNew}
        onRetry={analysis.retry}
      />
    </div>
  );
}
