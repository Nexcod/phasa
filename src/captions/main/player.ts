/**
 * MAIN world: typed, defensive access to YouTube's player element
 * (`#movie_player`) and its player response. Everything here is undocumented
 * YouTube internals; read it as untrusted, possibly-missing data.
 */
import type { TrackInfo, VideoInfo } from '../types';

export interface PlayerApi {
  getPlayerResponse?: () => unknown;
  loadModule?: (name: string) => void;
  setOption?: (module: string, option: string, value: unknown) => void;
  getOption?: (module: string, option: string) => unknown;
}

export function getPlayer(doc: Document): PlayerApi | null {
  return (doc.getElementById('movie_player') as PlayerApi | null) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) {
    return (value.runs as unknown[])
      .map((run) => (isRecord(run) && typeof run.text === 'string' ? run.text : ''))
      .join('');
  }
  return '';
}

interface RawTrack {
  info: TrackInfo;
  baseUrl: string;
}

function captionTracks(response: Record<string, unknown>): RawTrack[] {
  const captions = response.captions;
  const renderer = isRecord(captions) ? captions.playerCaptionsTracklistRenderer : undefined;
  const list =
    isRecord(renderer) && Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
  const tracks: RawTrack[] = [];
  for (const track of list as unknown[]) {
    if (!isRecord(track)) continue;
    const { baseUrl, languageCode, vssId } = track;
    if (
      typeof baseUrl !== 'string' ||
      typeof languageCode !== 'string' ||
      typeof vssId !== 'string'
    ) {
      continue;
    }
    tracks.push({
      baseUrl,
      info: {
        vssId,
        languageCode,
        kind: track.kind === 'asr' ? 'asr' : 'manual',
        name: text(track.name),
        isTranslatable: track.isTranslatable === true,
      },
    });
  }
  return tracks;
}

export function videoIdOf(response: unknown): string | null {
  if (!isRecord(response) || !isRecord(response.videoDetails)) return null;
  const id = response.videoDetails.videoId;
  return typeof id === 'string' ? id : null;
}

export function readVideoInfo(response: unknown): VideoInfo | null {
  const videoId = videoIdOf(response);
  if (!videoId || !isRecord(response) || !isRecord(response.videoDetails)) return null;
  const details = response.videoDetails;
  const duration = Number(details.lengthSeconds);
  return {
    videoId,
    title: typeof details.title === 'string' ? details.title : '',
    channel: typeof details.author === 'string' ? details.author : '',
    durationSec: Number.isFinite(duration) ? duration : 0,
    isLive: details.isLive === true,
    tracks: captionTracks(response).map((track) => track.info),
  };
}

/** `baseUrl` of each track by `vssId`. */
export function trackBaseUrls(response: unknown): Map<string, string> {
  if (!isRecord(response)) return new Map();
  return new Map(captionTracks(response).map((track) => [track.info.vssId, track.baseUrl]));
}
