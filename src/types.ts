import { DetectorDetection } from './lib/detector';

export type AIProvider = 'gemini' | 'ollama' | 'openai_compatible';

export interface Region {
  id: string;
  type: "bubble" | "sfx";
  // The AI's finer-grained classification of this region (drives its font/stroke/size
  // choices per the typesetting prompt rules) - optional since older saved projects and
  // providers/prompts that predate this field won't have it.
  textType?: "dialogue" | "shout" | "whisper" | "thought" | "narration" | "sfx";
  originalText: string;
  translatedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  bgColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  lineHeight: number;
  letterSpacing?: number;
  opacity?: number;
  autoFitText?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  bubbleContour?: number[];
  // True for Ultra Mode's numbered-marker regions, whose x/y/width/height come straight
  // from the YOLO detector (not the AI) and are meant to be authoritative - the AI never
  // gets a say in a locked region's position/size. Auto-fit rendering should shrink the
  // font to stay inside this box rather than growing the box past it, unlike a normal
  // (non-Ultra) or "extra" region where the box is just the AI's own best guess and
  // growing it to avoid clipping text is the right tradeoff.
  lockGeometry?: boolean;
}

export interface PaintStroke {
  tool: "erase" | "draw" | "fill_poly" | "bg_erase" | "smart_sfx" | "gen_erase" | "scribble_bubble";
  points: number[];
  color: string;
  size: number;
  imageBase64?: string;
  rect?: {x: number, y: number, w: number, h: number};
}

export interface ProcessedImage {
  id: string;
  filename: string;
  dataUrl: string;
  originalDataUrl?: string;
  mimeType: string;
  regions: Region[];
  paintStrokes: PaintStroke[];
  history?: { regions: Region[], paintStrokes: PaintStroke[] }[];
  redoHistory?: { regions: Region[], paintStrokes: PaintStroke[] }[];
  status: "idle" | "processing" | "done" | "error";
  width: number;
  height: number;
  error?: string;
  splitGroupId?: string;
  splitIndex?: number;
  userTranslationHint?: string;
  detectorResult?: DetectorDetection[];
}

export type Tool = 'select' | 'draw' | 'erase';

export interface CropSelection {
  id: string;
  sourceImageId: string;
  imageName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cropUrl: string;
}

export interface Chapter {
  id: string;
  name: string;
  images: ProcessedImage[];
}

export interface Volume {
  id: string;
  name: string;
  chapters: Chapter[];
}

export interface MangaSeries {
  id: string;
  title: string;
  type: "manga" | "manhwa";
  coverUrl: string;
  description: string;
  volumes: Volume[];
}

