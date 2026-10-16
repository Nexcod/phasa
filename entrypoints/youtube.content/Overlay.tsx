import { useSyncExternalStore } from 'react';
import { t } from '@/src/i18n';
import type { Client } from '@/src/messaging/client';
import { StatusLine } from '@/src/ui/StatusLine';
import { useBackgroundStatus } from '@/src/ui/useBackgroundStatus';
import type { VideoIdStore } from './videoId';

/**
 * Phase 1: an empty layer over the player with a small status chip, proving the
 * shadow-root UI and the Port to the SW work. Subtitles render here in phase 2.
 */
export function Overlay({ client, videoId }: { client: Client; videoId: VideoIdStore }) {
  const id = useSyncExternalStore(videoId.subscribe, videoId.get);
  const status = useBackgroundStatus(client);

  if (!id) return null;

  return (
    <div className="phasa-overlay" data-testid="phasa-overlay" data-video-id={id}>
      <div className="phasa-chip">
        <strong>{t('overlayBadge')}</strong>
        <StatusLine status={status} className="phasa-chip__status" />
      </div>
    </div>
  );
}
