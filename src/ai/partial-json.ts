/**
 * The value of a JSON text that may stop anywhere: what has arrived so far of a structured
 * answer, so the UI can show its first fields while the rest streams in. Unfinished strings
 * keep their text; an unfinished key, literal or number-less tail is left out.
 */

const MISSING = Symbol('missing');

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

export function parsePartialJson(text: string): unknown {
  let i = 0;

  const skipSpace = () => {
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
  };

  const readString = (): { value: string; complete: boolean } => {
    i++; // opening quote
    let value = '';
    while (i < text.length) {
      const char = text.charAt(i);
      if (char === '"') {
        i++;
        return { value, complete: true };
      }
      if (char === '\\') {
        const escape = text.charAt(i + 1);
        if (escape === '') break;
        if (escape === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (hex.length < 4) break;
          value += String.fromCharCode(Number.parseInt(hex, 16));
          i += 6;
          continue;
        }
        value += ESCAPES[escape] ?? escape;
        i += 2;
        continue;
      }
      value += char;
      i++;
    }
    i = text.length;
    return { value, complete: false };
  };

  const readValue = (): unknown => {
    skipSpace();
    if (i >= text.length) return MISSING;
    const char = text.charAt(i);
    if (char === '{') return readObject();
    if (char === '[') return readArray();
    if (char === '"') return readString().value;
    const literal = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!literal) {
      i = text.length;
      return MISSING;
    }
    i += literal[0].length;
    return JSON.parse(literal[0]) as unknown;
  };

  const readObject = (): Record<string, unknown> => {
    i++;
    const object: Record<string, unknown> = {};
    for (;;) {
      skipSpace();
      const char = text.charAt(i);
      if (char === '') return object;
      if (char === '}') {
        i++;
        return object;
      }
      if (char === ',') {
        i++;
        continue;
      }
      if (char !== '"') {
        i = text.length;
        return object;
      }
      const key = readString();
      if (!key.complete) return object;
      skipSpace();
      if (text.charAt(i) !== ':') {
        i = text.length;
        return object;
      }
      i++;
      const value = readValue();
      if (value === MISSING) return object;
      object[key.value] = value;
    }
  };

  const readArray = (): unknown[] => {
    i++;
    const array: unknown[] = [];
    for (;;) {
      skipSpace();
      const char = text.charAt(i);
      if (char === '') return array;
      if (char === ']') {
        i++;
        return array;
      }
      if (char === ',') {
        i++;
        continue;
      }
      const value = readValue();
      if (value === MISSING) return array;
      array.push(value);
    }
  };

  const value = readValue();
  return value === MISSING ? undefined : value;
}
