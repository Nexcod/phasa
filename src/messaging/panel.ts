/**
 * Side panel ↔ YouTube tab channel (docs/decisions/0007-captions-runtime.md).
 *
 * The side panel connects straight to the content script of the tab it shows
 * (`tabs.connect`, port {@link PANEL_PORT_NAME}): the transcript, the playing
 * cue and seeks are live page state, not database state, and must not depend
 * on the service worker being awake. No database access or credentials cross
 * this channel.
 */
import type { TrackKind } from '../captions/types';
import { parseSettingsPatch, type Settings } from '../settings';

export const PANEL_PORT_NAME = 'phasa-panel';

export interface PanelVideo {
  videoId: string;
  title: string;
  channel: string;
}

export interface PanelCue {
  startMs: number;
  endMs: number;
  text: string;
  /** Aligned English line, if a translation is loaded. */
  translation?: string;
}

export type PanelSession =
  | { status: 'idle' }
  | { status: 'loading'; video: PanelVideo }
  | { status: 'no-thai'; video: PanelVideo }
  | { status: 'error'; video: PanelVideo; error: string }
  | { status: 'ready'; video: PanelVideo; kind: TrackKind; cues: PanelCue[] };

export type TabToPanel =
  | { type: 'session'; session: PanelSession; activeIndex: number }
  | { type: 'active'; index: number };

export type PanelToTab =
  | { type: 'seek'; index: number }
  | { type: 'retry' }
  /** The panel changed settings; the tab may not hear the SW broadcast (its port can be asleep). */
  | { type: 'settings'; settings: Partial<Settings> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePanelToTab(value: unknown): PanelToTab | null {
  if (!isRecord(value)) return null;
  if (value.type === 'seek' && Number.isInteger(value.index)) {
    return { type: 'seek', index: value.index as number };
  }
  if (value.type === 'retry') return { type: 'retry' };
  if (value.type === 'settings') {
    const settings = parseSettingsPatch(value.settings);
    return settings ? { type: 'settings', settings } : null;
  }
  return null;
}
