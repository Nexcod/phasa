/** `asr` = YouTube auto-generated captions. */
export type TrackKind = 'manual' | 'asr';

/** Formats the timedtext endpoint serves; the player itself asks for json3. */
export type CaptionFormat = 'json3' | 'srv3' | 'srv1' | 'vtt';

/** A cue as parsed from a timedtext body, before normalization. */
export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** A caption track as the player lists it (`captionTracks`), without URLs. */
export interface TrackInfo {
  /** e.g. `.th` (manual), `a.th` (asr), `.en`. Unique per video. */
  vssId: string;
  languageCode: string;
  kind: TrackKind;
  /** Display name in the user's YouTube UI language. */
  name: string;
  isTranslatable: boolean;
}

/** A fetchable caption body: a track, optionally machine-translated by YouTube (`tlang`). */
export interface TrackRef {
  vssId: string;
  tlang?: string;
}

/** What the player knows about the current video. */
export interface VideoInfo {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  isLive: boolean;
  tracks: TrackInfo[];
}

/** A cue after normalization and post-processing (docs/plan.md §4.2, §5.2). */
export interface ProcessedCue {
  startMs: number;
  endMs: number;
  /** Normalized text, shown in the UI. */
  text: string;
  /** Text as received (minus non-speech tags), only when it differs from `text`. */
  raw?: string;
  /** Zero-width word-boundary hints, offsets into `text`. */
  hints?: number[];
}

export interface ProcessedTrack {
  videoId: string;
  /** {@link trackKey} of the source {@link TrackRef}. */
  key: string;
  /** Language of the text: the track's language, or `tlang` for a machine translation. */
  languageCode: string;
  /** Kind of the source track. */
  kind: TrackKind;
  /** Source `vssId` when the text is YouTube's machine translation. */
  translatedFrom?: string;
  cues: ProcessedCue[];
  fetchedAt: number;
  /** {@link PROCESSING_VERSION} at processing time; older rows are refetched. */
  processingVersion: number;
}

/**
 * Bump when parsing, normalization or post-processing changes the stored
 * output, so cached tracks are refetched and reprocessed.
 */
export const PROCESSING_VERSION = 1;

/** Cache and storage key of a track ref: `a.th`, `a.th>en`. */
export function trackKey(ref: TrackRef): string {
  return ref.tlang ? `${ref.vssId}>${ref.tlang}` : ref.vssId;
}
