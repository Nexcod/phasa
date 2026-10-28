/**
 * Keeps the overlay in sync with `video.currentTime` (docs/plan.md §12 phase 2):
 * `requestVideoFrameCallback` while frames are presented (per-frame precision,
 * the < 100 ms cue-switch target), plus media events for seeks, pauses and
 * background tabs where frame callbacks stop.
 */
import { activeIndexAt, lastStartedIndex } from '../captions/tracks';
import type { ProcessedCue } from '../captions/types';

/** Pause this much before the cue ends, so the paused frame still shows the cue. */
export const AUTO_PAUSE_LEAD_MS = 80;
/** Resuming closer than this to the auto-pause point does not pause again. */
const REARM_MARGIN_MS = 250;
/** A navigation seek lands this far inside the target cue. */
const SEEK_INSIDE_MS = 1;
/** Treat a time this close before a cue start as already in that cue (seek rounding). */
const NAVIGATION_SLACK_MS = 50;

const MEDIA_EVENTS = [
  'timeupdate',
  'seeked',
  'seeking',
  'play',
  'playing',
  'pause',
  'ratechange',
  'loadeddata',
  'emptied',
] as const;

export interface PlaybackOptions {
  cues: () => readonly ProcessedCue[];
  autoPause: () => boolean;
  /** Ads play in the same <video>; no cues and no auto-pause then. */
  suspended: () => boolean;
  onActiveIndex: (index: number) => void;
}

export class PlaybackSync {
  private frameHandle: number | null = null;
  private activeIndex = -1;
  /** Cue that started while playing and has not been auto-paused yet. */
  private armedIndex = -1;
  /** Where the last seek landed (ms), until the first frame after it is presented. */
  private seekedMs: number | null = null;
  private stopped = false;

  constructor(
    readonly video: HTMLVideoElement,
    private readonly options: PlaybackOptions,
  ) {
    for (const type of MEDIA_EVENTS) video.addEventListener(type, this.onMediaEvent);
    this.update();
    this.requestFrame();
  }

  get index(): number {
    return this.activeIndex;
  }

  /** Recompute now, e.g. after the cues changed. */
  refresh(): void {
    this.armedIndex = -1;
    this.update();
  }

  stop(): void {
    this.stopped = true;
    for (const type of MEDIA_EVENTS) this.video.removeEventListener(type, this.onMediaEvent);
    if (this.frameHandle !== null) this.video.cancelVideoFrameCallback(this.frameHandle);
    this.frameHandle = null;
  }

  private readonly onMediaEvent = (event: Event) => {
    const mediaMs = this.video.currentTime * 1000;
    if (event.type === 'seeking') this.armedIndex = -1;
    if (event.type === 'seeking' || event.type === 'emptied') this.seekedMs = null;
    if (event.type === 'seeked') this.seekedMs = mediaMs;
    this.update(mediaMs);
    if (event.type === 'play' || event.type === 'playing' || event.type === 'seeked') {
      this.arm(mediaMs);
      this.requestFrame();
    }
  };

  /** Auto-pause the cue on screen at its end, unless playback resumes right at that point. */
  private arm(mediaMs: number): void {
    const cue = this.options.cues()[this.activeIndex];
    if (this.video.paused || !cue) return;
    if (mediaMs < cue.endMs - AUTO_PAUSE_LEAD_MS - REARM_MARGIN_MS)
      this.armedIndex = this.activeIndex;
  }

  private requestFrame(): void {
    if (this.stopped || this.frameHandle !== null) return;
    this.frameHandle = this.video.requestVideoFrameCallback((_now, metadata) => {
      this.frameHandle = null;
      // A frame decoded before a seek must not pull the cue back; `seeked` updates instead.
      if (!this.video.seeking) {
        // The first frame after a seek starts up to a frame before the seek target. Count it as
        // the target, or a seek to a cue start shows the previous cue (until the next frame, or
        // for good while paused).
        const frameMs = metadata.mediaTime * 1000;
        this.update(this.seekedMs === null ? frameMs : Math.max(frameMs, this.seekedMs));
        this.seekedMs = null;
      }
      if (!this.video.paused) this.requestFrame();
    });
  }

  private update(mediaMs = this.video.currentTime * 1000): void {
    if (this.stopped) return;
    const cues = this.options.cues();
    const index = this.options.suspended() ? -1 : activeIndexAt(cues, mediaMs);

    if (index !== this.activeIndex) {
      this.activeIndex = index;
      this.armedIndex = -1;
      this.arm(mediaMs);
      this.options.onActiveIndex(index);
    }

    const armed = cues[this.armedIndex];
    if (
      armed &&
      !this.video.paused &&
      this.options.autoPause() &&
      mediaMs >= armed.endMs - AUTO_PAUSE_LEAD_MS * this.video.playbackRate
    ) {
      this.armedIndex = -1;
      this.video.pause();
    }
  }
}

/** Cue to navigate from: the one playing, or the last one before the current time. */
export function anchorIndex(cues: readonly ProcessedCue[], ms: number): number {
  return lastStartedIndex(cues, ms + NAVIGATION_SLACK_MS);
}

export function seekToCue(video: HTMLVideoElement, cue: ProcessedCue): void {
  video.currentTime = (cue.startMs + SEEK_INSIDE_MS) / 1000;
}
