/**
 * Level calibration data (plan §7.3, ADR 0011): tests/fixtures/levels.csv holds
 * the features of videos rated by hand. A development build's side panel copies
 * a video's row; the rating goes into the `level` column.
 */
import { LEVELS, type Level, type VideoFeatures } from './types';

export const CALIBRATION_COLUMNS = [
  'videoId',
  'title',
  'level',
  'tokens',
  'outside1000',
  'outside3000',
  'outside5000',
  'outside10000',
  'speechRate',
  'avgCueLength',
  'note',
] as const;

export interface CalibrationRow {
  videoId: string;
  title: string;
  /** The rating by hand. */
  level: Level;
  features: VideoFeatures;
  note: string;
}

function csvField(value: string): string {
  return /[",\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** A CSV line for the file, with the `level` and `note` columns left empty. */
export function calibrationRow(input: {
  videoId: string;
  title: string;
  features: VideoFeatures;
}): string {
  const { features } = input;
  const share = (value: number) => value.toFixed(4);
  return [
    input.videoId,
    csvField(input.title),
    '',
    String(features.tokens),
    share(features.outside1000),
    share(features.outside3000),
    share(features.outside5000),
    share(features.outside10000),
    features.speechRate.toFixed(2),
    features.avgCueLength.toFixed(2),
    '',
  ].join(',');
}

/** Splits one CSV line (RFC 4180 quotes, no line breaks inside fields). */
function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line.charAt(i);
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value);
}

/** Rows of the file; throws on a malformed line so a bad paste fails the test loudly. */
export function parseCalibration(text: string): CalibrationRow[] {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim() !== '' && !line.startsWith('#'));
  const [header, ...rows] = lines;
  if (header !== CALIBRATION_COLUMNS.join(',')) throw new Error('levels.csv: unexpected header');
  return rows.map((line, index) => {
    const fields = splitCsv(line);
    if (fields.length !== CALIBRATION_COLUMNS.length) {
      throw new Error(`levels.csv row ${index + 1}: expected ${CALIBRATION_COLUMNS.length} fields`);
    }
    const [videoId = '', title = '', level = '', ...rest] = fields;
    const numbers = rest.slice(0, 7).map(Number);
    if (!isLevel(level) || numbers.some((value) => !Number.isFinite(value))) {
      throw new Error(`levels.csv row ${index + 1} (${videoId}): bad level or number`);
    }
    const [tokens = 0, o1 = 0, o3 = 0, o5 = 0, o10 = 0, rate = 0, cue = 0] = numbers;
    return {
      videoId,
      title,
      level,
      features: {
        tokens,
        unique: 0,
        outside1000: o1,
        outside3000: o3,
        outside5000: o5,
        outside10000: o10,
        speechRate: rate,
        avgCueLength: cue,
      },
      note: rest[7] ?? '',
    };
  });
}
