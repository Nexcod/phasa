import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '@/public/_locales/en/messages.json';

interface Message {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string }>;
}
const entries = Object.entries(messages as Record<string, Message>);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|html)$/.test(name) ? [path] : [];
  });
}

describe('en messages', () => {
  it('uses Chrome-valid keys and documents every message', () => {
    for (const [key, value] of entries) {
      expect(key).toMatch(/^[A-Za-z0-9_]+$/);
      expect(value.message.length, key).toBeGreaterThan(0);
      expect(value.description, key).toBeTruthy();
    }
  });

  it('declares every $PLACEHOLDER$ it uses', () => {
    for (const [key, value] of entries) {
      const used = [...value.message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) =>
        m[1]!.toLowerCase(),
      );
      const declared = Object.keys(value.placeholders ?? {}).map((name) => name.toLowerCase());
      expect(used.sort(), key).toEqual(declared.sort());
    }
  });

  it('has every __MSG_*__ referenced by the manifest config', () => {
    const config = readFileSync('wxt.config.ts', 'utf8');
    for (const [, key] of config.matchAll(/__MSG_(\w+)__/g)) {
      expect(messages, key).toHaveProperty(key!);
    }
  });

  it('keeps the trademark out of the extension name (Chrome Web Store policy)', () => {
    expect(messages.extName.message).not.toMatch(/youtube|tube/i);
  });

  it('has no unused messages', () => {
    const sources = [...sourceFiles('entrypoints'), ...sourceFiles('src'), 'wxt.config.ts']
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const unused = entries
      .map(([key]) => key)
      .filter((key) => !sources.includes(`'${key}'`) && !sources.includes(`__MSG_${key}__`));
    expect(unused).toEqual([]);
  });
});
