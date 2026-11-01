import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoAnalysis } from '../analysis/types';
import type { Client } from '../messaging/client';
import type { Params } from '../messaging/protocol';

/** Events that arrive together (a bulk change, then the change signal) cost one reload. */
const RELOAD_DELAY_MS = 30;

export interface AnalysisTrack {
  videoId: string;
  trackKey: string;
  englishKey?: string;
}

export type AnalysisState =
  | { status: 'loading' }
  | { status: 'ready'; analysis: VideoAnalysis }
  | { status: 'unavailable' }
  | { status: 'error' };

export type MarkNew = (
  params: Omit<Params<'analysis/mark-new'>, 'videoId' | 'trackKey' | 'englishKey'>,
) => Promise<number>;

const LOADING: AnalysisState = { status: 'loading' };

/**
 * The analysis of a track from the SW (plan §7.4), recomputed whenever statuses or word boundaries
 * change or the SW restarts. The previous result stays on screen while the next one loads.
 */
export function useVideoAnalysis(
  client: Client,
  track: AnalysisTrack | null,
): { state: AnalysisState; markNew: MarkNew; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const videoId = track?.videoId;
  const trackKey = track?.trackKey;
  const key = videoId && trackKey ? `${videoId}/${trackKey}/${attempt}` : null;
  // A result belongs to the track (and attempt) it was loaded for; another one is still loading.
  const [result, setResult] = useState<{ key: string; state: AnalysisState } | null>(null);
  const englishRef = useRef(track?.englishKey);
  useEffect(() => {
    englishRef.current = track?.englishKey;
  });

  useEffect(() => {
    if (!key || !videoId || !trackKey) return;
    let active = true;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const run = ++sequence;
      // The first analysis after an install waits for the dictionary to load.
      client.request('analysis/video', { videoId, trackKey }, { timeoutMs: 60_000 }).then(
        ({ analysis }) => {
          if (!active || run !== sequence) return;
          setResult({
            key,
            state: analysis ? { status: 'ready', analysis } : { status: 'unavailable' },
          });
        },
        () => {
          if (active && run === sequence) setResult({ key, state: { status: 'error' } });
        },
      );
    };
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(load, RELOAD_DELAY_MS);
    };
    const unsubscribe = client.onEvent((event) => {
      if (
        event.type === 'vocab/changed' ||
        event.type === 'segmentation/changed' ||
        event.type === 'sw/hello'
      ) {
        reload();
      }
    });
    load();
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [client, key, videoId, trackKey]);

  const markNew = useCallback<MarkNew>(
    async (params) => {
      if (!videoId || !trackKey) return 0;
      const english = englishRef.current;
      const { changed } = await client.request('analysis/mark-new', {
        videoId,
        trackKey,
        ...(english ? { englishKey: english } : {}),
        ...params,
      });
      return changed;
    },
    [client, videoId, trackKey],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const state = result?.key === key ? result.state : LOADING;
  return { state, markNew, retry };
}
