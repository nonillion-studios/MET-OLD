// Parses a raw translation document (plain text) into an ordered list of
// paragraphs, used by the "Translation Docs" feature to pair user-provided
// reference translations with pages.
export function parseTranslationDocText(fileText: string, delimiter?: string): string[] {
  const trimmedDelimiter = delimiter?.trim();
  if (trimmedDelimiter) {
    const lines = fileText.split(/\r?\n/);
    const paragraphs: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (line.trim() === trimmedDelimiter) {
        const joined = current.join('\n').trim();
        if (joined.length > 0) paragraphs.push(joined);
        current = [];
      } else {
        current.push(line);
      }
    }
    const joined = current.join('\n').trim();
    if (joined.length > 0) paragraphs.push(joined);
    return paragraphs;
  }

  return fileText
    .split(/\r?\n\s*\r?\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}
