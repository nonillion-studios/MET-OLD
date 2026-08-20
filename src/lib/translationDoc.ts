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

export interface DetectedPageMarker {
  pageNumber: number;
  startIndex: number;
  endIndex: number;
  text: string;
}

// Matches common translator page-marker conventions at the start of a line, e.g.
// "pg1", "pg 1", "pg.1", "page 1", "page1", "p1", "p.1", "p 1", "#1" — case-insensitive.
// Anchored to line start (via the 'm' flag + ^) so it never matches a number embedded
// mid-sentence; the captured group is the page number.
const PAGE_MARKER_RE = /^(?:pg\.?\s*|page\s*|p\.?\s*|#)(\d+)\b/gim;

// Scans the document for page-marker lines (see PAGE_MARKER_RE) and slices the text
// between consecutive markers into per-page chunks. Returns [] if no markers are found,
// so callers can fall back to blank-line paragraph splitting or manual paper-view marking.
export function detectPageMarkers(fileText: string): DetectedPageMarker[] {
  const rawMatches: { pageNumber: number; lineStart: number; lineEnd: number }[] = [];

  // Reset lastIndex since PAGE_MARKER_RE is a shared module-level regex with the 'g' flag.
  PAGE_MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PAGE_MARKER_RE.exec(fileText)) !== null) {
    const lineStart = fileText.lastIndexOf('\n', match.index) + 1;
    // Only accept the match if it truly starts the line (allowing leading whitespace).
    if (fileText.slice(lineStart, match.index).trim().length > 0) continue;
    const lineEnd = fileText.indexOf('\n', match.index);
    rawMatches.push({
      pageNumber: parseInt(match[1], 10),
      lineStart,
      lineEnd: lineEnd === -1 ? fileText.length : lineEnd,
    });
  }

  if (rawMatches.length === 0) return [];

  const markers: DetectedPageMarker[] = [];

  // Leading unmarked text before the first marker: treat it as belonging to "page 1"
  // if the first real marker isn't already numbered 1 (a sensible default so nothing
  // gets silently dropped); if the first marker IS page 1, any leading text is just
  // whitespace/noise before it and is discarded.
  const firstMarker = rawMatches[0];
  const leadingText = fileText.slice(0, firstMarker.lineStart).trim();
  if (leadingText.length > 0 && firstMarker.pageNumber !== 1) {
    markers.push({
      pageNumber: Math.max(1, firstMarker.pageNumber - 1),
      startIndex: 0,
      endIndex: firstMarker.lineStart,
      text: leadingText,
    });
  }

  for (let i = 0; i < rawMatches.length; i++) {
    const current = rawMatches[i];
    const next = rawMatches[i + 1];
    // Text for this marker runs from right after its line to right before the next
    // marker's line (or to the end of the document for the last marker).
    const startIndex = current.lineEnd + 1 <= fileText.length ? current.lineEnd + 1 : fileText.length;
    const endIndex = next ? next.lineStart : fileText.length;
    const text = fileText.slice(startIndex, endIndex).trim();
    markers.push({
      pageNumber: current.pageNumber,
      startIndex,
      endIndex,
      text,
    });
  }

  return markers;
}
