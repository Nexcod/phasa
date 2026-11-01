/**
 * Downloads of dictionary and corpus sources into data/raw/ (git-ignored,
 * ADR 0004). A file that is already there is reused unless `--refresh` is
 * passed, so rebuilding is offline and reproducible from the same inputs.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const RAW_DIR = join(import.meta.dirname, '../../data/raw');
export const BUILD_DIR = join(import.meta.dirname, '../../data/build');

export interface RawSource {
  name: string;
  url: string;
  path: string;
  retrievedAt: string;
  sha256: string;
}

export const REFRESH = process.argv.includes('--refresh');

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function ensureRaw(name: string, url: string, file: string): Promise<RawSource> {
  mkdirSync(RAW_DIR, { recursive: true });
  const path = join(RAW_DIR, file);
  if (REFRESH || !existsSync(path)) {
    console.error(`GET ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  return {
    name,
    url,
    path,
    retrievedAt: statSync(path).mtime.toISOString().slice(0, 10),
    sha256: await sha256Of(path),
  };
}

export function sourceMeta(source: RawSource): Omit<RawSource, 'path'> {
  const { name, url, retrievedAt, sha256 } = source;
  return { name, url, retrievedAt, sha256 };
}

/** A short content hash: the data version the service worker compares against. */
export function contentVersion(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
