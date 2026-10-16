/**
 * Downloads the wisesight-1000 word-segmentation sample (CC0-1.0, PyThaiNLP)
 * into data/raw/ for the segmentation spike. Social-media Thai, hand-segmented.
 * Note its convention splits many compounds (จัด|การ, รู้|สึก) — see docs/spikes.md §3.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const URL =
  'https://raw.githubusercontent.com/PyThaiNLP/wisesight-sentiment/master/word-tokenization/wisesight-1000-samples-tokenised.label';
const OUT = 'data/raw/wisesight-1000.label';

const response = await fetch(URL);
if (!response.ok) throw new Error(`GET ${URL} → ${response.status}`);
const text = await response.text();
mkdirSync('data/raw', { recursive: true });
writeFileSync(OUT, text);
console.log(`Saved ${text.split('\n').filter(Boolean).length} lines to ${OUT}`);
