/**
 * Saves text as a file from an extension page: a Blob link with `download`, so no `downloads`
 * permission is needed (ADR 0001: permissions only when a feature needs them).
 */
export function saveTextFile(doc: Document, text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  // The download has started by then; the URL only holds the Blob in memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
