// Parses a raw translation document (plain text) into an ordered list of
// paragraphs, used by the "Translation Docs" feature to pair user-provided
// reference translations with pages.
export function parseTranslationDocText(fileText: string): string[] {
  return fileText
    .split(/\r?\n\s*\r?\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}
