import { get, set } from 'idb-keyval';

// Persists the app's Arabic Google Fonts (the fixed set typesetting draws from - see the
// fontFamily lists in lib/prompt.ts) in IndexedDB after the first successful fetch, mirroring
// localDetector.ts's loadModelBytes pattern for the local YOLO model: the browser's default
// HTTP cache is heuristic and can be evicted under storage pressure with no app-level
// control, so "cached forever" needs an explicit, app-owned store. Once these fonts are in
// IndexedDB, every later load reads them straight from there with zero network requests,
// even offline.
//
// A Google Fonts stylesheet is itself a small text file whose @font-face rules point at
// fonts.gstatic.com woff2 files - and Google serves DIFFERENT file URLs depending on the
// requesting browser's User-Agent (to serve the most efficient format each browser
// supports), so those URLs can't just be hardcoded once. The CSS has to be fetched at
// runtime too, then its `url(...)` references parsed out and each file fetched/cached
// individually, keyed off its own URL.

const FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Aref+Ruqaa:wght@400;700&family=Cairo:wght@200..1000&family=Marhey:wght@300..700&family=Tajawal:wght@200;300;400;500;700;800;900&family=Almarai:wght@300;400;700;800&family=El+Messiri:wght@400..700&family=Amiri:ital,wght@0,400;0,700;1,400;1,700&family=Changa:wght@200..800&family=Harmattan:wght@400;700&family=Katibeh&family=Lalezar&family=Lemonada:wght@300..700&family=Mada:wght@200..900&family=Markazi+Text:wght@400..700&family=Reem+Kufi:wght@400..700&family=Rakkas&display=swap';

// Bump this if the font set above is ever changed (families added/removed/reweighted) -
// changes the IndexedDB keys so a stale cached CSS/font-file set can never shadow the newer
// font list shipped in a later app update.
const FONT_VERSION = 'v1';
const CSS_CACHE_KEY = `google_fonts_css_${FONT_VERSION}`;
const FILE_CACHE_PREFIX = `google_fonts_file_${FONT_VERSION}_`;

const GSTATIC_URL_RE = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;

const STYLE_ID = 'cached-google-fonts';
// The static fallback <link> in index.html (id="google-fonts-link") loads with
// media="print" so it never triggers a real font download on its own - we only flip it to
// "all" ourselves when there's no IndexedDB cache yet, so it can serve as the fast,
// correctly-styled first paint for a brand new visitor while our own fetch-and-cache flow
// runs in the background. On a cached load the link stays inert and this module's own
// blob-backed <style> is the only thing that ever requests these fonts - straight out of
// IndexedDB, no network.
const FALLBACK_LINK_ID = 'google-fonts-link';

function injectStyle(cssText: string): void {
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = cssText;
}

function extractGstaticUrls(cssText: string): string[] {
  return Array.from(new Set(Array.from(cssText.matchAll(GSTATIC_URL_RE), m => m[1])));
}

// Fetches the Google Fonts CSS, downloads every font file it references as a blob, and
// stores both in IndexedDB. Individual file failures (quota exceeded, one URL erroring out)
// are swallowed so a single bad file doesn't stop the rest of the set from being cached -
// rewriteToBlobUrls() below falls back to the real CDN url for anything that didn't make it.
async function fetchAndCache(): Promise<string> {
  const response = await fetch(FONTS_CSS_URL);
  if (!response.ok) throw new Error(`Failed to fetch Google Fonts CSS (HTTP ${response.status})`);
  const cssText = await response.text();

  const urls = extractGstaticUrls(cssText);
  await Promise.all(urls.map(async url => {
    try {
      const fileResponse = await fetch(url);
      if (!fileResponse.ok) return;
      const blob = await fileResponse.blob();
      await set(FILE_CACHE_PREFIX + url, blob);
    } catch (err) {
      console.warn(`Could not cache font file ${url}`, err);
    }
  }));

  await set(CSS_CACHE_KEY, cssText).catch(err => {
    // Storage quota exceeded or IndexedDB unavailable (private browsing in some browsers) -
    // not fatal, just means this session re-fetches next time instead of persisting.
    console.warn('Could not persist Google Fonts CSS to IndexedDB, will re-fetch next time', err);
  });

  return cssText;
}

// Rewrites every fonts.gstatic.com url(...) reference in the CSS to a blob: URL backed by
// the cached file, so the browser reads glyphs straight out of IndexedDB with zero network
// requests. Leaves a url unchanged (still pointing at the real CDN) if that particular file
// somehow isn't cached - degrades to a normal network fetch for just that one file instead
// of breaking the whole @font-face rule.
async function rewriteToBlobUrls(cssText: string): Promise<string> {
  const urls = extractGstaticUrls(cssText);
  const replacements = new Map<string, string>();

  await Promise.all(urls.map(async url => {
    const blob = await get<Blob>(FILE_CACHE_PREFIX + url).catch(() => undefined);
    if (blob) replacements.set(url, URL.createObjectURL(blob));
  }));

  return cssText.replace(GSTATIC_URL_RE, (match, url) => {
    const blobUrl = replacements.get(url);
    return blobUrl ? `url(${blobUrl})` : match;
  });
}

/**
 * Ensures the app's Arabic Google Fonts are cached in IndexedDB and injected into the page
 * from there. Call once, early in the app's lifecycle (main.tsx).
 *
 * - Cache hit (returning visitor): rewrites the cached CSS to blob: URLs and injects it as
 *   a <style> tag - zero network requests, fonts come straight from IndexedDB.
 * - Cache miss (first-ever visit): flips the static <link id="google-fonts-link"> fallback
 *   in index.html from media="print" to media="all" so real fonts load over the network
 *   immediately (fast, correct first paint matters more than saving one round trip on the
 *   very first visit), while fetching the CSS + font files, caching them, and injecting the
 *   blob-backed <style> in the background for next time.
 */
export async function ensureFontsCached(): Promise<void> {
  const cachedCss = await get<string>(CSS_CACHE_KEY).catch(() => undefined);

  if (cachedCss) {
    const rewritten = await rewriteToBlobUrls(cachedCss);
    injectStyle(rewritten);
    return;
  }

  const fallbackLink = document.getElementById(FALLBACK_LINK_ID) as HTMLLinkElement | null;
  if (fallbackLink) fallbackLink.media = 'all';

  try {
    const cssText = await fetchAndCache();
    const rewritten = await rewriteToBlobUrls(cssText);
    injectStyle(rewritten);
  } catch (err) {
    // Network hiccup or all files failed to cache - the <link> fallback (now media="all")
    // is already serving real fonts over the network, so the app still works fine, it just
    // won't be zero-network until a later successful attempt.
    console.warn('Could not cache Google Fonts in IndexedDB, will keep using the network link', err);
  }
}
