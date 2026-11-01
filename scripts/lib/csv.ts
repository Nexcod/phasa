/** Minimal RFC 4180 CSV for review spreadsheets (scripts/seg-review.ts). */

export function csvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** `,` unless the header line uses `;` (Excel in many locales saves that way). */
function delimiterOf(input: string): string {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of input) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') commas++;
    else if (!quoted && char === ';') semicolons++;
    else if (!quoted && (char === '\n' || char === '\r')) break;
  }
  return semicolons > commas ? ';' : ',';
}

/** Rows of a CSV text; tolerates a BOM, CRLF and quoted newlines, skips empty rows. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/u, '');
  const delimiter = delimiterOf(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i] ?? '';
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      endRow();
    } else {
      field += char;
    }
  }
  endRow();
  return rows;
}
