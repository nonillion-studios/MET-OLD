# MangaAI Studio

A browser-based manga/manhwa translation and typesetting studio: upload raw pages (optionally paired with pre-inpainted/cleaned plates), let AI detect and translate speech bubbles, fine-tune text placement on a canvas editor, and export the finished pages.

## Features

- **Upload + review flow** — import pages via ZIP or individual images, optionally pair them with a cleaned/inpainted set, reorder/fix pages before entering the studio. Long manhwa strips are detected and can be split into pieces along blank space, re-stitched automatically on export.
- **AI translation** — pluggable provider (Gemini or a local/remote Ollama endpoint), with a shared, editable prompt covering bubble/SFX detection, typesetting decisions, and general translation guidance.
- **Canvas editor** — Konva-based editor with select/draw/erase tools, undo/redo, auto-fit text sizing, RTL-aware Arabic rendering, kashida (tatweel) line justification, and flood-fill bubble detection ("Center All Bubbles" with a preview step before applying).
- **Export** — ZIP, PDF, and PSD output.
- **Settings** — user-supplied API key(s) only (no server-side key), custom instructions, optimization toggles, and provider configuration.

## Getting started

```bash
npm install
npm run dev
```

Open the printed local URL, then add your Gemini API key (or configure an Ollama endpoint) from the Settings panel — the app does not read any server-side environment variable for the API key.

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — production build
- `npm run preview` — preview a production build locally
- `npm run lint` — TypeScript typecheck (`tsc --noEmit`)

## Tech stack

React 19, Vite, Tailwind CSS, Konva/react-konva for canvas rendering, JSZip/jsPDF for export, `@google/genai` for the Gemini provider.

## Project structure

- `src/App.tsx` — main application shell: library, upload/review, in-editor toolbar, settings.
- `src/components/` — `ImageEditor` (canvas), upload/review and page-text modals.
- `src/lib/` — AI providers (`gemini.ts`, `ollama.ts`), shared prompt builder (`prompt.ts`), export (`zip.ts`), bubble detection (`bubbleDetect.ts`), page splitting (`pageSplit.ts`).
- `src/utils/` — text-fit/RTL helpers.
