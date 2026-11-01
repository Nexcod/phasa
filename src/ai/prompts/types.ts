import type { AiLineContext } from '../../messaging/ai';
import type { JsonSchema } from '../schema';

/**
 * One AI function (docs/plan.md §8.6). Bump `version` whenever the instructions, the schema or
 * the input format change: it is part of the cache key.
 */
export interface Prompt<P, T> {
  name: string;
  version: number;
  instructions: string;
  /** `text.format.name`. */
  schemaName: string;
  schema: JsonSchema;
  /** What the answer depends on: hashed into the cache key. */
  cacheInput(params: P): unknown;
  /** The user message. */
  input(params: P): string;
  /** A validated answer in the app's shape. */
  fromJson(json: unknown): T;
  /** Whatever fields of an unfinished answer are already usable. */
  partial(json: unknown): Partial<T>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** Subtitle text in a prompt: one line, no control characters, bounded. */
export function clean(text: string, max = 400): string {
  return text.replace(CONTROL, ' ').trim().slice(0, max);
}

/** The context block both prompts share. */
export function contextBlock(context: AiLineContext): string {
  const lines: string[] = [];
  if (context.videoTitle) lines.push(`Video title: ${clean(context.videoTitle, 200)}`);
  if (context.before.length > 0) {
    lines.push('Previous lines:', ...context.before.map((line) => `- ${clean(line)}`));
  }
  lines.push(`Line: ${clean(context.line.text)}`);
  if (context.line.translation) {
    lines.push(`English subtitle (may be machine-translated): ${clean(context.line.translation)}`);
  }
  if (context.after.length > 0) {
    lines.push('Next lines:', ...context.after.map((line) => `- ${clean(line)}`));
  }
  return lines.join('\n');
}

export function contextKey(context: AiLineContext): unknown {
  return {
    title: context.videoTitle,
    before: context.before,
    line: context.line.text,
    translation: context.line.translation ?? null,
    after: context.after,
  };
}

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
