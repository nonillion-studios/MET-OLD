import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import Konva from 'konva';
import { Upload, Download, Play, Loader2, Image as ImageIcon, Type as TypeIcon, MousePointer2, Brush, Eraser, ZoomIn, ZoomOut, Plus, Pipette, Trash2, ChevronUp, ChevronDown, ImagePlus, Sparkles, Undo, Redo, Wand2, Scissors, Settings, Search, X } from 'lucide-react';
import { extractImagesFromZip, downloadProcessedZip, downloadPdf, downloadSingleImage } from './lib/zip';
import { processMangaPages, RawRegion } from './lib/gemini';
import { floodFillBubble, floodFillBubbleDetailed } from './lib/bubbleDetect';
import { ProcessedImage, Region, PaintStroke, MangaSeries, Volume, Chapter, Tool } from './types';
import { mapRawRegionToPixels } from './utils/textUtils';
import { UploadReviewModal } from './components/UploadReviewModal';
import { PageTextsModal } from './components/PageTextsModal';
import { get, set } from 'idb-keyval';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const ImageEditor = React.lazy(() => import('./components/ImageEditor').then(m => ({ default: m.ImageEditor })));

export default function App() {
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [bubbleFillPreview, setBubbleFillPreview] = useState<{ imgId: string, regions: Region[] } | null>(null);
  const [isGeneratingBubbleFillPreview, setIsGeneratingBubbleFillPreview] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [selectedForProcess, setSelectedForProcess] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manga Hierarchical Library state
  const [mangas, setMangas] = useState<MangaSeries[]>([]);
  const [activeMangaId, setActiveMangaId] = useState<string | null>(null);
  const [activeVolumeId, setActiveVolumeId] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  // Series Creator Modal state
  const [showCreateSeriesModal, setShowCreateSeriesModal] = useState(false);
  const [newSeriesTitle, setNewSeriesTitle] = useState('');
  const [newSeriesType, setNewSeriesType] = useState<'manga' | 'manhwa'>('manga');
  const [newSeriesDesc, setNewSeriesDesc] = useState('');
  const [newSeriesCoverUrl, setNewSeriesCoverUrl] = useState('');
  const coverFileInputRef = useRef<HTMLInputElement>(null);

  // Load hierarchical projects on mount
  useEffect(() => {
    get('mangas_library').then((saved) => {
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setMangas(saved);
      }
    }).catch(console.error);
  }, []);

  // Save changes to mangas_library when state updates
  useEffect(() => {
    if (mangas.length > 0) {
      const timeout = setTimeout(() => {
        set('mangas_library', mangas).catch(console.error);
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [mangas]);

  // Sync editor modifications back into the active Chapter
  useEffect(() => {
    if (activeMangaId && activeVolumeId && activeChapterId) {
      setMangas(prev => prev.map(manga => {
        if (manga.id !== activeMangaId) return manga;
        return {
          ...manga,
          volumes: manga.volumes.map(vol => {
            if (vol.id !== activeVolumeId) return vol;
            return {
              ...vol,
              chapters: vol.chapters.map(chap => {
                if (chap.id !== activeChapterId) return chap;
                return { ...chap, images: images };
              })
            };
          })
        };
      }));
    }
  }, [images, activeMangaId, activeVolumeId, activeChapterId]);
  
  // Settings State
  const [customApiKey, setCustomApiKey] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [translateJapanese, setTranslateJapanese] = useState(true);
  const [translateSfx, setTranslateSfx] = useState(true);
  const [zipMatchMode, setZipMatchMode] = useState<'filename' | 'index'>('filename');

  const [autoFitAndCenter, setAutoFitAndCenter] = useState<boolean>(() => {
    return localStorage.getItem('manga_auto_fit_and_center') !== 'false';
  });
  const [compressBeforeProcessing, setCompressBeforeProcessing] = useState<boolean>(() => {
    return localStorage.getItem('manga_compress_before_processing') !== 'false';
  });
  
  const [customFonts, setCustomFonts] = useState<string[]>([]);
  const [showExternalAIModal, setShowExternalAIModal] = useState(false);
  const [externalAIPasteData, setExternalAIPasteData] = useState('');
  const fontInputRef = useRef<HTMLInputElement>(null);

  const [appInitializing, setAppInitializing] = useState(true);
  const [activeNavigationTab] = useState<'library'>('library');
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [showManagePages, setShowManagePages] = useState(false);
  const [showPageTextsModal, setShowPageTextsModal] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const filteredMangas = librarySearchQuery.trim()
    ? mangas.filter(m => m.title.toLowerCase().includes(librarySearchQuery.trim().toLowerCase()))
    : mangas;

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppInitializing(false);
    }, 2200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const savedKey = localStorage.getItem('manga_gemini_key');
    if (savedKey) setCustomApiKey(savedKey);
    const savedInst = localStorage.getItem('manga_custom_instructions');
    if (savedInst) setCustomInstructions(savedInst);
    const savedTransJp = localStorage.getItem('manga_translate_jp');
    if (savedTransJp !== null) setTranslateJapanese(savedTransJp === 'true');
    const savedTransSfx = localStorage.getItem('manga_translate_sfx');
    if (savedTransSfx !== null) setTranslateSfx(savedTransSfx === 'true');
    const savedMatchMode = localStorage.getItem('manga_zip_match_mode');
    if (savedMatchMode) setZipMatchMode(savedMatchMode as any);
    
    const savedAutoFit = localStorage.getItem('manga_auto_fit_and_center');
    if (savedAutoFit !== null) setAutoFitAndCenter(savedAutoFit === 'true');
    const savedCompress = localStorage.getItem('manga_compress_before_processing');
    if (savedCompress !== null) setCompressBeforeProcessing(savedCompress === 'true');
    
    // Preload Arabic fonts
    const fontsToLoad = [
      "Cairo", "Tajawal", "Marhey", "Aref Ruqaa", "El Messiri", "Amiri", 
      "Changa", "Harmattan", "Katibeh", "Lalezar", "Lemonada", "Mada", 
      "Markazi Text", "Reem Kufi", "Rakkas", "Almarai"
    ];
    if ('fonts' in document) {
      Promise.all(fontsToLoad.map(font => (document as any).fonts.load(`12px "${font}"`)))
        .catch(console.error);
    }
  }, []);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const val = e.target.value;
    setCustomApiKey(val);
    localStorage.setItem('manga_gemini_key', val);
  };

  const handleCustomInstructionsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setCustomInstructions(val);
    localStorage.setItem('manga_custom_instructions', val);
  };

  const handleSetTranslateJapanese = (val: boolean) => {
    setTranslateJapanese(val);
    localStorage.setItem('manga_translate_jp', String(val));
  };

  const handleSetTranslateSfx = (val: boolean) => {
    setTranslateSfx(val);
    localStorage.setItem('manga_translate_sfx', String(val));
  };
  
  const handleSetZipMatchMode = (val: 'filename' | 'index') => {
    setZipMatchMode(val);
    localStorage.setItem('manga_zip_match_mode', val);
  };
  
  const handleSetAutoFitAndCenter = (val: boolean) => {
    setAutoFitAndCenter(val);
    localStorage.setItem('manga_auto_fit_and_center', String(val));
  };

  const handleSetCompressBeforeProcessing = (val: boolean) => {
    setCompressBeforeProcessing(val);
    localStorage.setItem('manga_compress_before_processing', String(val));
  };

  const compressImageBase64 = async (base64: string, maxDim: number = 1600, quality: number = 0.85): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = base64;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width <= maxDim && height <= maxDim) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', quality));
            return;
          }
        }
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(base64);
        }
      };
      img.onerror = () => resolve(base64);
    });
  };
  
  // Editor State
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [brushSize, setBrushSize] = useState(20);
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [zoom, setZoom] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);

  const selectedImage = images.find(img => img.id === selectedImageId);
  const selectedRegion = selectedImage?.regions.find(r => r.id === selectedRegionId);

  useEffect(() => {
    if (selectedRegionId) setShowRightPanel(true);
  }, [selectedRegionId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedImageId && selectedRegionId) {
          saveHistory(selectedImageId);
          setImages(prev => prev.map(img => {
            if (img.id === selectedImageId) {
              return { ...img, regions: img.regions.filter(r => r.id !== selectedRegionId) };
            }
            return img;
          }));
          setSelectedRegionId(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        if (selectedImageId) {
          redo(selectedImageId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        if (selectedImageId) {
          redo(selectedImageId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (selectedImageId) {
          undo(selectedImageId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
         // Maybe add action to select all? Though we don't have multiple select regions right now.
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImageId, selectedRegionId, images]);

  const handleApplyExternalAICocktail = () => {
    if (!selectedImageId) {
      Swal.fire({
        icon: 'warning',
        title: 'Notice',
        text: 'Please open a single page and select it in the studio first to apply the translation.',
        background: '#090615',
        color: '#ffffff',
        confirmButtonColor: '#2563eb'
      });
      return;
    }
    const img = images.find(i => i.id === selectedImageId);
    if (!img) return;

    try {
      const cleanData = externalAIPasteData.trim();
      if (!cleanData) {
        Swal.fire({
          icon: 'error',
          title: 'Empty Field',
          text: 'Please paste the code (JSON array) retrieved from the AI first.',
          background: '#090615',
          color: '#ffffff',
          confirmButtonColor: '#2563eb'
        });
        return;
      }

      const jsonStart = cleanData.indexOf('[');
      const jsonEnd = cleanData.lastIndexOf(']');
      
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error("Invalid format: JSON list of regions brackets '[ ... ]' not found.");
      }
      
      const jsonText = cleanData.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonText) as any[];

      saveHistory(img.id);

      const newRegions: Region[] = parsed.map(raw => {
        const isNormalized = (raw.xmax <= 1000 && raw.ymax <= 1000 && raw.xmax > 1);
        const { x, y, width, height } = isNormalized
          ? mapRawRegionToPixels(raw, img.width, img.height)
          : {
              x: raw.x ?? raw.xmin ?? 50,
              y: raw.y ?? raw.ymin ?? 50,
              width: raw.w ?? raw.width ?? (raw.xmax - raw.xmin) ?? 150,
              height: raw.h ?? raw.height ?? (raw.ymax - raw.ymin) ?? 80
            };

        return {
          id: 'region-' + Math.random().toString(36).substr(2, 9),
          type: raw.type || 'bubble',
          originalText: raw.originalText || '',
          translatedText: raw.translatedText || '',
          x,
          y,
          width,
          height,
          angle: 0,
          textColor: '#000000',
          strokeColor: 'transparent',
          strokeWidth: 0,
          bgColor: '#ffffff',
          fontFamily: 'Cairo',
          fontSize: Math.max(16, Math.floor(height / 4)),
          fontWeight: 'bold',
          fontStyle: 'normal',
          textAlign: 'center',
          lineHeight: 1.3,
          autoFitText: true
        };
      });

      const updatedImages = images.map(item => {
        if (item.id !== img.id) return item;
        return {
          ...item,
          regions: [...item.regions, ...newRegions]
        };
      });

      setImages(updatedImages);
      setExternalAIPasteData('');
      setShowExternalAIModal(false);

      Swal.fire({
        icon: 'success',
        title: 'External translation merged successfully!',
        text: `Recognized and recovered ${newRegions.length} dialogue bubbles and applied them intelligently with centered text.`,
        confirmButtonColor: '#2563eb',
        background: '#090615',
        color: '#ffffff'
      });
    } catch (err: any) {
      console.error(err);
      Swal.fire({
        icon: 'error',
        title: 'Invalid Format',
        text: 'Failed to parse the pasted text as a valid list of translation entries. Make sure the retrieved JSON array is valid.',
        confirmButtonColor: '#2563eb',
        background: '#090615',
        color: '#ffffff'
      });
    }
  };

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    Swal.fire({
      title: 'Loading and parsing fonts...',
      text: 'Please wait while the font files are being processed',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
      background: '#090615',
      color: '#ffffff'
    });

    try {
      const loadedFonts: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filename = file.name.toLowerCase();
        
        if (filename.endsWith('.zip')) {
          const zip = await JSZip.loadAsync(file);
          for (const [zipFilename, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            if (zipFilename.match(/\.(ttf|otf|woff|woff2)$/i)) {
              const buffer = await zipEntry.async('arraybuffer');
              const cleanName = zipFilename.split('/').pop()?.replace(/\.[^/.]+$/, "") || "CustomFont";
              const fontName = `MET-${cleanName}`;
              
              const fontFace = new FontFace(fontName, buffer);
              await fontFace.load();
              document.fonts.add(fontFace);
              loadedFonts.push(fontName);
            }
          }
        } else if (filename.match(/\.(ttf|otf|woff|woff2)$/)) {
          const buffer = await file.arrayBuffer();
          const cleanName = file.name.replace(/\.[^/.]+$/, "");
          const fontName = `MET-${cleanName}`;
          
          const fontFace = new FontFace(fontName, buffer);
          await fontFace.load();
          document.fonts.add(fontFace);
          loadedFonts.push(fontName);
        }
      }

      if (loadedFonts.length > 0) {
        setCustomFonts(prev => [...prev, ...loadedFonts]);
        Swal.fire({
          icon: 'success',
          title: 'Custom fonts activated!',
          text: `Extracted and loaded ${loadedFonts.length} fonts successfully into the studio.`,
          confirmButtonText: 'Great',
          confirmButtonColor: '#2563eb',
          background: '#090615',
          color: '#ffffff'
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Error Processing File',
          text: 'No valid fonts (TTF/OTF) were found inside the uploaded file.',
          confirmButtonColor: '#2563eb',
          background: '#090615',
          color: '#ffffff'
        });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: 'error',
        title: 'Failed to Install Fonts',
        text: 'An unexpected error occurred while extracting and reading the font files.',
        confirmButtonColor: '#2563eb',
        background: '#090615',
        color: '#ffffff'
      });
    }
  };

  const handleSplitBubble = () => {
    if (!selectedImageId || !selectedRegionId) return;
    const img = images.find(i => i.id === selectedImageId);
    if (!img) return;
    const region = img.regions.find(r => r.id === selectedRegionId);
    if (!region) return;

    saveHistory(img.id);

    // Filter out active region to make room for two distinct halved split bubbles
    const updatedRegions = img.regions.filter(r => r.id !== region.id);
    
    const id1 = 'region-' + Math.random().toString(36).substr(2, 9);
    const id2 = 'region-' + Math.random().toString(36).substr(2, 9);
    
    let region1: Region;
    let region2: Region;

    if (region.width > region.height) {
      const halfW = region.width / 2;
      region1 = {
        ...region,
        id: id1,
        width: halfW,
        originalText: region.originalText ? region.originalText.substring(0, Math.floor(region.originalText.length / 2)) : '',
        translatedText: region.translatedText ? region.translatedText.substring(0, Math.floor(region.translatedText.length / 2)) : 'First Bubble',
      };
      region2 = {
        ...region,
        id: id2,
        x: region.x + halfW,
        width: halfW,
        originalText: region.originalText ? region.originalText.substring(Math.floor(region.originalText.length / 2)) : '',
        translatedText: region.translatedText ? region.translatedText.substring(Math.floor(region.translatedText.length / 2)) : 'Second Bubble',
      };
    } else {
      const halfH = region.height / 2;
      region1 = {
        ...region,
        id: id1,
        height: halfH,
        originalText: region.originalText ? region.originalText.substring(0, Math.floor(region.originalText.length / 2)) : '',
        translatedText: region.translatedText ? region.translatedText.substring(0, Math.floor(region.translatedText.length / 2)) : 'Top Bubble',
      };
      region2 = {
        ...region,
        id: id2,
        y: region.y + halfH,
        height: halfH,
        originalText: region.originalText ? region.originalText.substring(Math.floor(region.originalText.length / 2)) : '',
        translatedText: region.translatedText ? region.translatedText.substring(Math.floor(region.translatedText.length / 2)) : 'Bottom Bubble',
      };
    }

    const updatedImages = images.map(item => {
      if (item.id !== img.id) return item;
      return {
        ...item,
        regions: [...updatedRegions, region1, region2]
      };
    });

    setImages(updatedImages);
    setSelectedRegionId(id1);

    setMangas(prev => prev.map(m => {
      if (m.id !== activeMangaId) return m;
      return {
        ...m,
        volumes: m.volumes.map(v => {
          if (v.id !== activeVolumeId) return v;
          return {
            ...v,
            chapters: v.chapters.map(c => {
              if (c.id !== activeChapterId) return c;
              return {
                ...c,
                images: updatedImages
              };
            })
          };
        })
      };
    }));

    Swal.fire({
      icon: 'success',
      title: 'Bubbles separated!',
      text: 'The target bubble was intelligently split into two independent, aligned bubbles.',
      timer: 1500,
      showConfirmButton: false,
      background: '#090615',
      color: '#ffffff'
    });
  };

  const applyKashidaHarmony = (style: 'oval' | 'rectangular') => {
    if (!selectedImageId || !selectedRegionId) return;
    const img = images.find(i => i.id === selectedImageId);
    if (!img) return;
    const region = img.regions.find(r => r.id === selectedRegionId);
    if (!region) return;

    saveHistory(img.id);
    let originalText = region.translatedText || '';
    
    // Remove any existing kashidas to format cleanly
    let cleanText = originalText.replace(/ـ+/g, '');

    let formatted = cleanText;
    if (style === 'oval') {
      const fontStyleStr = `${region.fontStyle === 'normal' ? '' : region.fontStyle} ${region.fontWeight === 'normal' ? '' : region.fontWeight}`.trim() || 'normal';
      const extendableArabicLetters = /[بتثجحخسشصضطظعغفقكلمنهيئ]/;

      // Throwaway single-line measurement node (no width constraint) to greedily pack
      // words into visual lines the same way calculateAutoFitFontSize measures text.
      const measureNode = new Konva.Text({
        fontFamily: region.fontFamily,
        fontStyle: fontStyleStr,
        fontSize: region.fontSize,
        letterSpacing: region.letterSpacing || 0,
      });
      const measureWidth = (s: string) => {
        measureNode.text(s);
        return measureNode.width();
      };

      // Greedy word-wrap: pack words per line, breaking when adding the next word
      // would exceed the region's width.
      const paragraphs = cleanText.split('\n');
      const lines: string[] = [];
      for (const para of paragraphs) {
        const words = para.split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) {
          lines.push('');
          continue;
        }
        let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
          const candidate = currentLine + ' ' + words[i];
          if (measureWidth(candidate) > region.width) {
            lines.push(currentLine);
            currentLine = words[i];
          } else {
            currentLine = candidate;
          }
        }
        lines.push(currentLine);
      }

      // Find the widest line's width as the profile's peak reference.
      const lineWidths = lines.map(l => measureWidth(l));
      const maxLineWidth = Math.max(0, ...lineWidths);
      const n = lines.length;
      // Per-line oval/lens target: first/last lines target ~65% of max width,
      // middle lines approach the full width, tapering like an oval bubble.
      const lineTargets = n > 1
        ? lines.map((_, i) => maxLineWidth * (0.65 + 0.35 * Math.sin(Math.PI * (i + 0.5) / n)))
        : lineWidths.slice();

      const justifiedLines = lines.map((line, idx) => {
        if (!line) return line;
        if (n <= 1) return line;
        let width = lineWidths[idx];
        const targetWidth = lineTargets[idx];
        // Only stretch lines meaningfully narrower than this line's own target.
        if (targetWidth <= 0 || width >= targetWidth * 0.95) return line;

        const words = line.split(' ');
        const insertCounts = new Array(words.length).fill(0);
        const MAX_PER_WORD = 2;
        let safety = 0;

        while (width < targetWidth * 0.95 && safety < 200) {
          safety++;
          let insertedThisPass = false;

          for (let w = 0; w < words.length && width < targetWidth * 0.95; w++) {
            if (insertCounts[w] >= MAX_PER_WORD) continue;
            const word = words[w];
            for (let charIdx = 0; charIdx < word.length - 1; charIdx++) {
              if (extendableArabicLetters.test(word[charIdx])) {
                words[w] = word.slice(0, charIdx + 1) + 'ـــ' + word.slice(charIdx + 1);
                insertCounts[w]++;
                insertedThisPass = true;
                width = measureWidth(words.join(' '));
                break;
              }
            }
          }

          if (!insertedThisPass) break; // no more eligible letters anywhere in the line
        }

        return words.join(' ');
      });

      measureNode.destroy();
      formatted = justifiedLines.join('\n');
    }

    if (style === 'oval') {
      updateRegion(region.id, { translatedText: formatted, textAlign: 'center' });
    } else {
      updateRegion(region.id, { translatedText: formatted });
    }

    Swal.fire({
      icon: 'success',
      title: 'Text kashida adjusted!',
      text: style === 'oval' ? 'Applied oval-gradient kashida to fit circular bubbles.' : 'Restored the standard rectangular formatting.',
      timer: 1200,
      showConfirmButton: false,
      background: '#090615',
      color: '#ffffff'
    });
  };

  const handleExportPsd = async () => {
    if (images.length === 0) {
      Swal.fire('Error', 'Please load the chapter images before exporting.', 'error');
      return;
    }

    Swal.fire({
      title: 'Generating Photoshop PSD files...',
      text: 'Packing layers, transparent texts, and repainted art into a PSD-compatible workspace...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
      background: '#090615',
      color: '#ffffff'
    });

    try {
      const zip = new JSZip();
      
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const pageFolder = zip.folder(`Page_${i + 1}`);
        if (!pageFolder) continue;

        const bgResponse = await fetch(img.originalDataUrl || img.dataUrl);
        const bgBlob = await bgResponse.blob();
        pageFolder.file('Background_Clean.png', bgBlob);

        const textLayerInfo = img.regions.map(r => ({
          text: r.translatedText,
          original: r.originalText,
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
          font: r.fontFamily,
          size: Math.round(r.fontSize),
          color: r.textColor,
          align: r.textAlign
        }));

        pageFolder.file('PSD_Text_Layers.json', JSON.stringify(textLayerInfo, null, 2));

        const textCanvas = document.createElement('canvas');
        textCanvas.width = img.width;
        textCanvas.height = img.height;
        const textCtx = textCanvas.getContext('2d');
        if (textCtx) {
          textCtx.clearRect(0, 0, img.width, img.height);
          
          img.regions.forEach(r => {
            textCtx.fillStyle = r.textColor;
            textCtx.font = `${r.fontWeight || 'normal'} ${r.fontSize}px "${r.fontFamily}"`;
            textCtx.textAlign = r.textAlign as any;
            
            const lines = (r.translatedText || '').split('\n');
            const startX = r.textAlign === 'center' ? r.x + r.width / 2 : r.x + 10;
            const startY = r.y + r.fontSize;
            lines.forEach((line, lIdx) => {
              textCtx.fillText(line, startX, startY + (lIdx * r.fontSize * 1.3));
            });
          });

          const transparentTextBase64Blob = await new Promise<Blob>((res) => {
            textCanvas.toBlob((b) => res(b!), 'image/png');
          });
          pageFolder.file('Text_Overlay_Layer.png', transparentTextBase64Blob);
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${mangas.find(m => m.id === activeMangaId)?.title || 'MET'}_Photoshop_MultiLayer_PSD.zip`);

      Swal.fire({
        icon: 'success',
        title: 'PSD layer package exported successfully!',
        text: 'You have received a ZIP file containing fully separated layers, independent transparent text layers, and high-resolution artwork ready to continue in Photoshop.',
        confirmButtonText: 'Excellent',
        confirmButtonColor: '#2563eb',
        background: '#090615',
        color: '#ffffff'
      });
    } catch (err) {
      console.error(err);
      Swal.fire('Export Error', 'Failed to write the exported PSD file.', 'error');
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Swal.fire({
      title: 'Importing Manga Pages...',
      text: 'Please wait while we unpack the archive and prepare the pages.',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
      background: '#120b24',
      color: '#f8fafc'
    });

    try {
      const extractedImages = await extractImagesFromZip(file);
      setImages(extractedImages);
      if (extractedImages.length > 0) {
        setSelectedImageId(extractedImages[0].id);
      }
      Swal.close();
      
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Archive Imported!',
        text: `Successfully loaded ${extractedImages.length} images into the library.`,
        showConfirmButton: false,
        timer: 2000,
        background: '#120b24',
        color: '#f8fafc'
      });
    } catch (error) {
      console.error("Error reading zip", error);
      Swal.fire({
        icon: 'error',
        title: 'ZIP Import Failed',
        text: 'The archive might be corrupted or in an unsupported format.',
        confirmButtonColor: '#2563eb',
        background: '#120b24',
        color: '#f8fafc'
      });
    }
  };

  const cleanZipInputRef = useRef<HTMLInputElement>(null);

  const handleCleanedZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Swal.fire({
      title: 'Merging Cleaned Plates...',
      text: 'Matching the whitened manga sheets against original page indices...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
      background: '#120b24',
      color: '#f8fafc'
    });

    try {
      const cleanedImages = await extractImagesFromZip(file);
      if (cleanedImages.length === 0) {
        Swal.fire({
          icon: 'warning',
          title: 'Empty Clean Archive',
          text: 'No matching cleaned image sheets were found in the uploaded file.',
          confirmButtonColor: '#eab308',
          background: '#120b24',
          color: '#f8fafc'
        });
        return;
      }

      setImages(prev => {
        const newImages = [...prev];
        for (let i = 0; i < cleanedImages.length; i++) {
          const cleanInfo = cleanedImages[i];
          let targetIndex = -1;
          
          if (zipMatchMode === 'filename') {
             targetIndex = newImages.findIndex(img => img.filename === cleanInfo.filename);
             if (targetIndex === -1) targetIndex = i; // fallback to index if names don't match
          } else {
             targetIndex = i;
          }
          
          if (targetIndex < newImages.length) {
             const target = newImages[targetIndex];
             // Save current as original if not already set, then swap dataUrl
             const originalDataUrl = target.originalDataUrl || target.dataUrl;
             
             // Remove backgrounds from regions as the image is already cleaned
             const newRegions = target.regions.map(r => ({ ...r, bgColor: 'transparent' }));
             // Remove all paint strokes, since the user only wants texts over the cleaned image
             const newStrokes: PaintStroke[] = [];
             
             newImages[targetIndex] = {
               ...target,
               originalDataUrl,
               dataUrl: cleanInfo.dataUrl,
               regions: newRegions,
               paintStrokes: newStrokes
             };
          }
        }
        return newImages;
      });
      
      Swal.fire({
        icon: 'success',
        title: 'Manga Cleaning Plates Merged!',
        text: 'Successfully swapped original sheets for whitened plates. Use the "View Original" toggle to inspect any changes.',
        confirmButtonColor: '#2563eb',
        background: '#120b24',
        color: '#f8fafc'
      });
    } catch (error) {
      console.error("Error reading cleaned zip", error);
      Swal.fire({
        icon: 'error',
        title: 'Clean Plate Import Failed',
        text: 'Could not successfully swap or process image paths: ' + (error as Error).message,
        confirmButtonColor: '#ef4444',
        background: '#120b24',
        color: '#f8fafc'
      });
    }
    if (cleanZipInputRef.current) cleanZipInputRef.current.value = '';
  };

  const updateImage = (imgId: string, updates: Partial<ProcessedImage>) => {
    setImages(prev => prev.map(img => img.id === imgId ? { ...img, ...updates } : img));
  };

  const saveHistory = (imgId: string) => {
    setImages(prev => prev.map(img => {
      if (img.id === imgId) {
        const currentHistory = img.history || [];
        const newHistory = [...currentHistory, {
          regions: JSON.parse(JSON.stringify(img.regions)),
          paintStrokes: JSON.parse(JSON.stringify(img.paintStrokes))
        }].slice(-20); // Keep last 20 steps
        // A fresh action invalidates the redo stack
        return { ...img, history: newHistory, redoHistory: [] };
      }
      return img;
    }));
  };

  const undo = (imgId: string) => {
    setImages(prev => prev.map(img => {
      if (img.id === imgId) {
        const history = img.history || [];
        if (history.length === 0) return img;
        const prevState = history[history.length - 1];
        const newHistory = history.slice(0, -1);
        const redoHistory = [...(img.redoHistory || []), {
          regions: img.regions,
          paintStrokes: img.paintStrokes
        }].slice(-20);
        return {
          ...img,
          regions: prevState.regions,
          paintStrokes: prevState.paintStrokes,
          history: newHistory,
          redoHistory
        };
      }
      return img;
    }));
  };

  const redo = (imgId: string) => {
    setImages(prev => prev.map(img => {
      if (img.id === imgId) {
        const redoHistory = img.redoHistory || [];
        if (redoHistory.length === 0) return img;
        const nextState = redoHistory[redoHistory.length - 1];
        const newRedoHistory = redoHistory.slice(0, -1);
        const history = [...(img.history || []), {
          regions: img.regions,
          paintStrokes: img.paintStrokes
        }].slice(-20);
        return {
          ...img,
          regions: nextState.regions,
          paintStrokes: nextState.paintStrokes,
          history,
          redoHistory: newRedoHistory
        };
      }
      return img;
    }));
  };

  const updateRegion = (regionId: string, updates: Partial<Region>) => {
    if (!selectedImageId) return;
    setImages(prev => prev.map(img => {
      if (img.id !== selectedImageId) return img;
      return {
        ...img,
        regions: img.regions.map(r => r.id === regionId ? { ...r, ...updates } : r)
      };
    }));
  };

  const handleSmartBubbleFill = async (imgId: string, region: Region) => {
    if (region.type === 'sfx') {
      alert("The smart bubble-detection algorithm is designed for bubbles only and ignores sound effects (SFX).");
      return;
    }
    const img = images.find(i => i.id === imgId);
    if (!img) return;

    // Use the whitened/inpainted image dataUrl strictly so text strokes don't block flood fill
    const imgSrc = img.dataUrl;
    const imageObj = new Image();
    imageObj.src = imgSrc;
    await new Promise(resolve => imageObj.onload = resolve);

    const canvas = document.createElement('canvas');
    canvas.width = imageObj.width;
    canvas.height = imageObj.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(imageObj, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    const startX = Math.floor(region.x + region.width / 2);
    const startY = Math.floor(region.y + region.height / 2);
    
    const result = floodFillBubbleDetailed(imageData, startX, startY, region.width, region.height);
    
    if (result) {
      saveHistory(img.id);
      updateRegion(region.id, {
        ...result.safeTextBounds,
        bubbleContour: result.contour,
        textAlign: 'center'
      });
    } else {
      alert("Could not automatically detect the bubble bounds.");
    }
  };

  // Pure computation: detects new bounds/contours for every bubble region on the page
  // but does NOT mutate state or history — callers decide when/whether to apply the result.
  const computeBubbleFillPreview = async (imgId: string): Promise<{ id: string, newRegions: Region[], changed: boolean } | null> => {
    const img = images.find(i => i.id === imgId);
    if (!img) return null;

    // Use the whitened/inpainted image dataUrl strictly so text strokes don't block flood fill
    const imgSrc = img.dataUrl;
    const imageObj = new Image();
    imageObj.src = imgSrc;
    await new Promise(resolve => imageObj.onload = resolve);

    const canvas = document.createElement('canvas');
    canvas.width = imageObj.width;
    canvas.height = imageObj.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(imageObj, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const newRegions = [...img.regions];
    let changed = false;

    for (let i = 0; i < newRegions.length; i++) {
      const region = newRegions[i];
      if (region.type === 'bubble') {
        const startX = Math.floor(region.x + region.width / 2);
        const startY = Math.floor(region.y + region.height / 2);
        const result = floodFillBubbleDetailed(imageData, startX, startY, region.width, region.height);
        if (result) {
          newRegions[i] = {
            ...region,
            ...result.safeTextBounds,
            bubbleContour: result.contour,
            textAlign: 'center'
          };
          changed = true;
        }
      }
    }

    return { id: img.id, newRegions, changed };
  };

  const handleGenerateBubbleFillPreview = async (imgId: string) => {
    setIsGeneratingBubbleFillPreview(true);
    try {
      const result = await computeBubbleFillPreview(imgId);
      if (result && result.changed) {
        setBubbleFillPreview({ imgId: result.id, regions: result.newRegions });
      } else {
        alert("No text bubbles were detected for dynamic improvement on this page.");
      }
    } finally {
      setIsGeneratingBubbleFillPreview(false);
    }
  };

  const handleApplyBubbleFillPreview = () => {
    if (!bubbleFillPreview) return;
    saveHistory(bubbleFillPreview.imgId);
    updateImage(bubbleFillPreview.imgId, { regions: bubbleFillPreview.regions });
    setBubbleFillPreview(null);
  };

  const handleCenterText = (regionId: string) => {
    saveHistory(selectedImageId!);
    updateRegion(regionId, { textAlign: 'center' }); // usually already handled, but we can also snap to center of parent bubble if preferred
  };

  const traceRegionsWithBubbleDetection = async (imgDataUrl: string, regions: Region[]): Promise<Region[]> => {
    try {
      const imageObj = new Image();
      imageObj.src = imgDataUrl;
      await new Promise((resolve) => {
        imageObj.onload = resolve;
        imageObj.onerror = resolve;
      });

      const canvas = document.createElement('canvas');
      canvas.width = imageObj.width;
      canvas.height = imageObj.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return regions;

      ctx.drawImage(imageObj, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      return regions.map(region => {
        if (region.type === 'bubble') {
          const startX = Math.floor(region.x + region.width / 2);
          const startY = Math.floor(region.y + region.height / 2);
          const result = floodFillBubbleDetailed(imageData, startX, startY, region.width, region.height);
          if (result) {
            return {
              ...region,
              ...result.safeTextBounds,
              bubbleContour: result.contour,
              textAlign: 'center'
            };
          }
        }
        return region;
      });
    } catch (e) {
      console.error("Error auto-tracing bubbles:", e);
      return regions;
    }
  };

  const toggleSelectForProcess = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSet = new Set(selectedForProcess);
    const keysList = customApiKey.split(/[\s,\n]+/).map(k => k.trim()).filter(Boolean);
    const maxSelect = 5 * Math.max(1, keysList.length);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      if (newSet.size >= maxSelect) {
        alert(`You can select up to ${maxSelect} images based on your API key list (5 per key).`);
        return;
      }
      newSet.add(id);
    }
    setSelectedForProcess(newSet);
  };

  const runParallelMangaTranslation = async (batch: ProcessedImage[]) => {
    const keysList = customApiKey.split(/[\s,\n]+/).map(k => k.trim()).filter(Boolean);
    const keysToUse = keysList.length > 0 ? keysList : [''];
    
    // Chunk batch into groups of 5
    const chunks: ProcessedImage[][] = [];
    for (let i = 0; i < batch.length; i += 5) {
      chunks.push(batch.slice(i, i + 5));
    }
    
    const maxConcurrent = keysToUse.length;
    
    // Process matching the number of keys concurrently
    for (let i = 0; i < chunks.length; i += maxConcurrent) {
      const currentChunks = chunks.slice(i, i + maxConcurrent);
      
      await Promise.all(currentChunks.map(async (chunk, index) => {
        const key = keysToUse[index % keysToUse.length];
        
        // Mark all in chunk as processing
        chunk.forEach(img => updateImage(img.id, { status: 'processing', error: undefined }));
        
        try {
          const processedPages = await Promise.all(chunk.map(async img => {
            const srcBase64 = img.originalDataUrl || img.dataUrl;
            let imgBase64 = srcBase64;
            let mimeType = img.mimeType;
            if (compressBeforeProcessing) {
              try {
                imgBase64 = await compressImageBase64(srcBase64, 1600, 0.82);
                mimeType = 'image/jpeg';
              } catch (e) {
                console.error("Compression failed for img:", img.id, e);
              }
            }
            return { id: img.id, base64Image: imgBase64, mimeType };
          }));

          const chunkResults = await processMangaPages(
            processedPages, 
            key,
            customInstructions,
            translateJapanese,
            translateSfx
          );
          
          await Promise.all(chunkResults.map(async result => {
            const img = chunk.find(b => b.id === result.id);
            if (!img) return;
            
            const newRegions: Region[] = result.regions.map(raw => {
              const { x, y, width, height } = mapRawRegionToPixels(raw, img.width, img.height);

              return {
                id: Math.random().toString(36).substr(2, 9),
                type: raw.type,
                originalText: raw.originalText,
                translatedText: raw.translatedText,
                x, y, width, height,
                angle: raw.angle || 0,
                textColor: raw.textColor || '#000000',
                strokeColor: raw.strokeColor || 'transparent',
                strokeWidth: raw.strokeWidth ?? 0,
                bgColor: img.originalDataUrl ? 'transparent' : (raw.bgColor && raw.bgColor !== 'transparent' ? raw.bgColor : (raw.type === 'bubble' ? '#ffffff' : 'transparent')),
                fontFamily: raw.fontFamily || (raw.type === 'bubble' ? 'Marhey' : 'Aref Ruqaa'),
                fontSize: raw.fontSize || Math.max(16, Math.floor(height / 4)),
                fontWeight: raw.fontWeight || 'normal',
                fontStyle: raw.fontStyle || 'normal',
                textAlign: raw.textAlign || 'center',
                lineHeight: raw.lineHeight || 1.2,
                letterSpacing: 0,
                opacity: 1,
                shadowBlur: 0,
                shadowColor: 'transparent',
                autoFitText: true
              };
            });
            
            let finalRegions = newRegions;
            if (autoFitAndCenter) {
              finalRegions = await traceRegionsWithBubbleDetection(img.originalDataUrl || img.dataUrl, newRegions);
            }
            
            updateImage(img.id, { status: 'done', regions: finalRegions });
          }));
        } catch (err: any) {
          chunk.forEach(img => updateImage(img.id, { status: 'error', error: err.message }));
        }
      }));
    }
  };

  const processSelectedImages = async () => {
    if (selectedForProcess.size === 0) return;
    const batch = images.filter(img => selectedForProcess.has(img.id) && img.status !== 'done');
    if (batch.length === 0) {
       setSelectedForProcess(new Set());
       return;
    }
    
    await runParallelMangaTranslation(batch);
    setSelectedForProcess(new Set());
  };

  const processAllImages = async () => {
    setIsProcessingAll(true);
    const uncompleted = images.filter(img => img.status !== 'done');
    await runParallelMangaTranslation(uncompleted);
    setIsProcessingAll(false);
  };
  
  const processImage = async (img: ProcessedImage) => {
    if (img.status === 'processing') return;
    updateImage(img.id, { status: 'processing', error: undefined });
    
    try {
      const keysList = customApiKey.split(/[\s,\n]+/).map(k => k.trim()).filter(Boolean);
      const key = keysList[0] || '';
      
      const srcBase64 = img.originalDataUrl || img.dataUrl;
      let imgBase64 = srcBase64;
      let mimeType = img.mimeType;
      
      if (compressBeforeProcessing) {
        try {
          imgBase64 = await compressImageBase64(srcBase64, 1600, 0.82);
          mimeType = 'image/jpeg';
        } catch (e) {
          console.error("Compression failed for single image:", e);
        }
      }

      const results = await processMangaPages([{ id: img.id, base64Image: imgBase64, mimeType: mimeType }], key, customInstructions, translateJapanese, translateSfx);
      const rawRegions = results[0]?.regions || [];
      
      const newRegions: Region[] = rawRegions.map(raw => {
        // Map 0-1000 to pixel coordinates
        const { x, y, width, height } = mapRawRegionToPixels(raw, img.width, img.height);

        return {
          id: Math.random().toString(36).substr(2, 9),
          type: raw.type,
          originalText: raw.originalText,
          translatedText: raw.translatedText,
          x,
          y,
          width,
          height,
          angle: raw.angle || 0,
          textColor: raw.textColor || '#000000',
          strokeColor: raw.strokeColor || 'transparent',
          strokeWidth: raw.strokeWidth ?? 0,
          bgColor: img.originalDataUrl ? 'transparent' : (raw.bgColor && raw.bgColor !== 'transparent' ? raw.bgColor : (raw.type === 'bubble' ? '#ffffff' : 'transparent')),
          fontFamily: raw.fontFamily || (raw.type === 'bubble' ? 'Marhey' : 'Aref Ruqaa'),
          fontSize: raw.fontSize || Math.max(16, Math.floor(height / 4)),
          fontWeight: raw.fontWeight || 'normal',
          fontStyle: raw.fontStyle || 'normal',
          textAlign: raw.textAlign || 'center',
          lineHeight: raw.lineHeight || 1.2,
          letterSpacing: 0,
          opacity: 1,
          shadowBlur: 0,
          shadowColor: 'transparent',
          autoFitText: true
        };
      });

      let finalRegions = newRegions;
      if (autoFitAndCenter) {
        finalRegions = await traceRegionsWithBubbleDetection(srcBase64, newRegions);
      }

      updateImage(img.id, { status: 'done', regions: finalRegions });
    } catch (error: any) {
      updateImage(img.id, { status: 'error', error: error.message });
    }
  };

  // Helper handlers for library hierarchy
  const handleOpenChapter = (chap: Chapter) => {
    setActiveChapterId(chap.id);
    setImages(chap.images);
    if (chap.images.length > 0) {
      setSelectedImageId(chap.images[0].id);
    } else {
      setSelectedImageId(null);
    }
  };

  const handleDeleteManga = (mangaId: string) => {
    Swal.fire({
      title: 'Delete this manga entirely from your library?',
      text: "This action will permanently delete all volumes, chapters, and translated pages, and cannot be undone!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete the series',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#374151',
      background: '#120b24',
      color: '#f8fafc'
    }).then((result) => {
      if (result.isConfirmed) {
        setMangas(prev => prev.filter(m => m.id !== mangaId));
        if (activeMangaId === mangaId) {
          setActiveMangaId(null);
          setActiveVolumeId(null);
          setActiveChapterId(null);
        }
        Swal.fire({
          icon: 'success',
          text: 'The manga series was deleted successfully!',
          confirmButtonColor: '#2563eb',
          background: '#120b24',
          color: '#f8fafc'
        });
      }
    });
  };

  const handleDeleteVolume = (volId: string) => {
    Swal.fire({
      title: 'Delete this volume and all its chapters?',
      text: "This volume and all the chapters inside it will be permanently deleted!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete it',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#374151',
      background: '#120b24',
      color: '#f8fafc'
    }).then((result) => {
      if (result.isConfirmed) {
        setMangas(prev => prev.map(m => {
          if (m.id !== activeMangaId) return m;
          return {
            ...m,
            volumes: m.volumes.filter(v => v.id !== volId)
          };
        }));
        if (activeVolumeId === volId) {
          setActiveVolumeId(null);
          setActiveChapterId(null);
        }
        Swal.fire({
          icon: 'success',
          text: 'The volume was deleted successfully!',
          confirmButtonColor: '#2563eb',
          background: '#120b24',
          color: '#f8fafc'
        });
      }
    });
  };

  const handleDeleteChapter = (chapId: string) => {
    Swal.fire({
      title: 'Delete this chapter entirely?',
      text: "This will permanently delete all embedded images and applied edits!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete it',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#374151',
      background: '#120b24',
      color: '#f8fafc'
    }).then((result) => {
      if (result.isConfirmed) {
        setMangas(prev => prev.map(m => {
          if (m.id !== activeMangaId) return m;
          return {
            ...m,
            volumes: m.volumes.map(v => {
              if (v.id !== activeVolumeId) return v;
              return {
                ...v,
                chapters: v.chapters.filter(c => c.id !== chapId)
              };
            })
          };
        }));
        if (activeChapterId === chapId) {
          setActiveChapterId(null);
          setImages([]);
        }
        Swal.fire({
          icon: 'success',
          text: 'The translated chapter was deleted successfully!',
          confirmButtonColor: '#2563eb',
          background: '#120b24',
          color: '#f8fafc'
        });
      }
    });
  };

  const handleAddVolumePrompt = () => {
    Swal.fire({
      title: 'Add New Volume',
      text: 'Enter the volume name or its sequence number for classification:',
      input: 'text',
      inputPlaceholder: 'e.g.: Volume 20 or Volume 1...',
      showCancelButton: true,
      confirmButtonText: 'Add Volume',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#2563eb',
      background: '#120b24',
      color: '#f8fafc',
      inputValidator: (value) => {
        if (!value) {
          return 'You must enter a volume name!';
        }
        return null;
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const value = result.value.trim();
        const newVol: Volume = {
          id: 'volume-' + Math.random().toString(36).substr(2, 9),
          name: value,
          chapters: []
        };
        setMangas(prev => prev.map(m => {
          if (m.id !== activeMangaId) return m;
          return {
            ...m,
            volumes: [...m.volumes, newVol]
          };
        }));
        Swal.fire({
          icon: 'success',
          text: `Volume ${value} added successfully!`,
          confirmButtonColor: '#2563eb',
          background: '#120b24',
          color: '#f8fafc'
        });
      }
    });
  };

  const handleAddChapterPrompt = () => {
    Swal.fire({
      title: 'Add New Chapter',
      text: 'Enter the chapter number or part name for translation:',
      input: 'text',
      inputPlaceholder: 'e.g.: Chapter 150 or Chapter 1...',
      showCancelButton: true,
      confirmButtonText: 'Create Chapter',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#2563eb',
      background: '#120b24',
      color: '#f8fafc',
      inputValidator: (value) => {
        if (!value) {
          return 'You must enter a chapter name!';
        }
        return null;
      }
    }).then((result) => {
      if (result.isConfirmed && result.value) {
        const value = result.value.trim();
        const newChap: Chapter = {
          id: 'chapter-' + Math.random().toString(36).substr(2, 9),
          name: value,
          images: []
        };
        setMangas(prev => prev.map(m => {
          if (m.id !== activeMangaId) return m;
          return {
            ...m,
            volumes: m.volumes.map(v => {
              if (v.id !== activeVolumeId) return v;
              return {
                ...v,
                chapters: [...v.chapters, newChap]
              };
            })
          };
        }));
        
        // Auto enter chapter directly as workspace!
        handleOpenChapter(newChap);
      }
    });
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        Swal.fire({
          icon: 'warning',
          text: 'Please choose an image smaller than 2 MB to keep performance fast.',
          confirmButtonColor: '#2563eb',
          background: '#120b24',
          color: '#f8fafc'
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setNewSeriesCoverUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCreateSeries = () => {
    if (!newSeriesTitle.trim()) {
      Swal.fire({
        icon: 'error',
        text: 'You must enter a manga/manhwa title to get started!',
        confirmButtonColor: '#2563eb',
        background: '#120b24',
        color: '#f8fafc'
      });
      return;
    }

    const newManga: MangaSeries = {
      id: 'manga-' + Math.random().toString(36).substr(2, 9),
      title: newSeriesTitle.trim(),
      type: newSeriesType,
      coverUrl: newSeriesCoverUrl || '', 
      description: newSeriesDesc.trim() || 'No custom description for this series.',
      volumes: []
    };

    setMangas(prev => [...prev, newManga]);
    
    // Clear and close
    setNewSeriesTitle('');
    setNewSeriesType('manga');
    setNewSeriesDesc('');
    setNewSeriesCoverUrl('');
    setShowCreateSeriesModal(false);

    Swal.fire({
      icon: 'success',
      text: 'The new series was added to your library successfully! Click on it now to create volumes and chapters.',
      confirmButtonColor: '#2563eb',
      background: '#120b24',
      color: '#f8fafc'
    });
  };

  const appendImagesInputRef = useRef<HTMLInputElement>(null);

  const handleAppendImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const newImages: ProcessedImage[] = [];
    for (let i = 0; i < files.length; i++) {
       const file = files[i];
       const dataUrl = await new Promise<string>((resolve) => {
           const reader = new FileReader();
           reader.onload = (ev) => resolve(ev.target?.result as string);
           reader.readAsDataURL(file);
       });
       const dimensions = await new Promise<{width: number, height: number}>((resolve) => {
           const img = new Image();
           img.onload = () => resolve({ width: img.width, height: img.height });
           img.src = dataUrl;
       });
       newImages.push({
           id: Math.random().toString(36).substr(2, 9),
           filename: file.name,
           dataUrl,
           mimeType: file.type,
           regions: [],
           paintStrokes: [],
           status: "idle",
           width: dimensions.width,
           height: dimensions.height
       });
    }
    setImages(prev => [...prev, ...newImages]);
    if (appendImagesInputRef.current) appendImagesInputRef.current.value = '';
  };

  const moveImageUp = (index: number) => {
    if (index === 0) return;
    const newImages = [...images];
    [newImages[index - 1], newImages[index]] = [newImages[index], newImages[index - 1]];
    setImages(newImages);
  };

  const moveImageDown = (index: number) => {
    if (index === images.length - 1) return;
    const newImages = [...images];
    [newImages[index + 1], newImages[index]] = [newImages[index], newImages[index + 1]];
    setImages(newImages);
  };

  const deleteImage = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedImageId === id) setSelectedImageId(null);
  };

  const handleExportZip = async () => {
    if (images.length === 0) return;
    setExportProgress('Preparing images for highest quality export...');
    try {
      await downloadProcessedZip(images, (msg) => setExportProgress(msg));
    } catch (err) {
      console.error(err);
      alert("Failed to export ZIP");
    } finally {
      setExportProgress(null);
    }
  };

  const handleExportPdf = async () => {
    if (images.length === 0) return;
    setExportProgress('Preparing PDF export...');
    try {
      await downloadPdf(images, (msg) => setExportProgress(msg));
    } catch (err) {
      console.error(err);
      alert("Failed to export PDF");
    } finally {
      setExportProgress(null);
    }
  };

  const handleDownloadCurrentPage = async () => {
    const imgToDownload = selectedImage || images[0];
    if (!imgToDownload) return;
    setExportProgress('Rendering image...');
    try {
      await downloadSingleImage(imgToDownload);
    } catch (err) {
      console.error(err);
      alert("Failed to download image");
    } finally {
      setExportProgress(null);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-tr from-[#02000a] via-[#0d091a] to-[#0a0514] dynamic-bg text-slate-200 overflow-hidden font-sans">
      {exportProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="liquid-glass rounded-3xl p-8 flex flex-col items-center gap-4 max-w-md w-full shadow-[0_20px_50px_rgba(56, 189, 248,0.35)] border border-sky-500/35 animate-fade-in">
            <Loader2 size={48} className="animate-spin text-sky-400" />
            <h2 className="text-xl font-display font-bold text-white tracking-tight">Exporting High Quality ZIP</h2>
            <p className="text-sm text-slate-400 text-center font-mono">{exportProgress}</p>
          </div>
        </div>
      )}
      {/* Topbar */}
      {activeNavigationTab === 'library' && activeChapterId !== null && (
        <header className="min-h-16 border-b border-sky-500/10 flex flex-wrap items-center justify-between px-3 sm:px-6 py-2 bg-black/40 backdrop-blur-md shrink-0 gap-3">
          <div className="flex items-center gap-3 sm:gap-6 shrink-0">
            <button
              onClick={() => {
                setActiveChapterId(null);
                setImages([]);
                setSelectedImageId(null);
              }}
              className="flex items-center gap-2 bg-blue-950/45 hover:bg-blue-900 border border-sky-500/35 text-sky-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold font-display transition-all"
            >
              ← Back to Library
            </button>
            <div className="hidden sm:flex items-center gap-3">
              <TypeIcon className="text-sky-400" />
              <h1 className="font-display font-bold text-xl tracking-tight text-white leading-none">MangaAI Studio</h1>
            </div>
          </div>

        <div className="flex flex-wrap items-center gap-3 z-10">
          <div className="relative">
            <input
              type="file"
              accept=".zip"
              className="hidden"
              ref={fileInputRef}
              onChange={handleZipUpload}
            />
            <input
              type="file"
              accept=".zip"
              className="hidden"
              ref={cleanZipInputRef}
              onChange={handleCleanedZipUpload}
            />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              ref={appendImagesInputRef}
              onChange={handleAppendImages}
            />
            <button
              onClick={() => setShowManagePages(true)}
              className="flex items-center gap-2 hover:bg-[#222] bg-[#111] px-3 py-1.5 rounded-md text-sm transition-colors text-slate-300"
              title="Manage Pages"
            >
              <ImagePlus size={16} /> <span className="hidden sm:inline">Manage Pages</span>
            </button>
            <button
              onClick={() => setShowPageTextsModal(true)}
              className="flex items-center gap-2 hover:bg-[#222] bg-[#111] px-3 py-1.5 rounded-md text-sm transition-colors text-slate-300"
              title="All Texts in Page"
            >
              <TypeIcon size={16} /> <span className="hidden sm:inline">All Texts</span>
            </button>
          </div>

          <button
            onClick={processAllImages}
            disabled={images.length === 0 || isProcessingAll}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed px-3 sm:px-4 py-2 rounded-md font-medium text-sm transition-colors"
          >
            {isProcessingAll ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            <span className="hidden sm:inline">Process All</span>
          </button>

          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-md font-medium text-sm transition-colors border ${showOriginal ? 'bg-amber-600 border-amber-600 text-white' : 'bg-[#111] border-[#444] text-slate-300 hover:bg-[#222]'}`}
          >
            <span className="sm:hidden">{showOriginal ? 'Original' : 'View'}</span>
            <span className="hidden sm:inline">{showOriginal ? 'Showing Original' : 'View Original'}</span>
          </button>

          <div className="flex bg-emerald-700/50 rounded-md overflow-hidden border border-emerald-600/30">
            <button
              onClick={handleExportZip}
              disabled={images.length === 0}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 disabled:cursor-not-allowed px-3 sm:px-4 py-2 font-medium text-sm text-white transition-colors border-r border-emerald-500/20"
              title="Export as ZIP archive"
            >
              <Download size={16} /> <span className="hidden sm:inline">ZIP</span>
            </button>
            <button
              onClick={handleExportPsd}
              disabled={images.length === 0}
              className="flex items-center gap-2 bg-blue-600 hover:bg-sky-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed px-3 sm:px-4 py-2 font-medium text-sm text-white transition-colors border-r border-sky-500/20"
              title="Export PSD package for Photoshop (Photoshop Layout Layers Archive)"
            >
              <Download size={16} className="text-sky-200" /> <span className="hidden sm:inline">New PSD</span>
            </button>
            <button
              onClick={handleExportPdf}
              disabled={images.length === 0}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 disabled:cursor-not-allowed px-3 sm:px-4 py-2 font-medium text-sm text-white transition-colors"
              title="Export as paginated PDF"
            >
              PDF
            </button>
          </div>
        </div>
      </header>
      )}

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {showSettingsPage && (
          <div className="flex-1 flex flex-col p-8 bg-gradient-to-tr from-[#03010c] via-[#0b0718] to-black relative overflow-y-auto pb-32">
            <div className="absolute top-10 right-10 w-96 h-96 bg-blue-600/5 rounded-full blur-[140px] pointer-events-none" />
            <div className="max-w-5xl mx-auto w-full flex flex-col gap-8 relative z-10">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-3xl font-display font-bold text-white tracking-tight">Studio Configuration Settings</h1>
                  <p className="text-sm text-slate-400 mt-1">Fine-tune translation thresholds, OCR dialects, parallel execution caches, and Gemini API keys.</p>
                </div>
                <button
                  onClick={() => setShowSettingsPage(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                  aria-label="Close Settings"
                >
                  <X size={22} />
                </button>
              </div>

              <div className="flex flex-col gap-6">
                {/* Config Panel */}
                <div className="space-y-6">
                  {/* API Key Box */}
                  <div className="liquid-glass p-6 rounded-2xl border border-sky-500/15 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-base font-semibold text-white font-display">Gemini API Credentials</h3>
                      {customApiKey.split(/[\s,\n]+/).map(k => k.trim()).filter(Boolean).length > 0 && (
                        <span className="text-[11px] bg-blue-950/40 border border-blue-800 text-sky-400 px-2.5 py-0.5 rounded-full font-mono">
                          {customApiKey.split(/[\s,\n]+/).map(k => k.trim()).filter(Boolean).length} Key(s) Loaded
                        </span>
                      )}
                    </div>
                    <textarea 
                      value={customApiKey}
                      onChange={handleApiKeyChange}
                      placeholder="Add keys (one key per line or comma-separated)..."
                      className="w-full h-28 bg-black/60 border border-sky-500/15 rounded-xl p-3 text-sm outline-none focus:border-sky-500 text-slate-200 resize-none font-mono focus:ring-1 focus:ring-sky-500/20"
                    />
                    <div className="space-y-1.5 text-[11px] text-slate-400 leading-relaxed font-mono">
                      <p>✧ Speed tip: Rotating several keys shares requests seamlessly to avoid rate limits safely.</p>
                      <p>✧ Runs automatically on standard Gemini flash parameters to ensure prompt translations.</p>
                    </div>
                  </div>

                  {/* Instructions Box */}
                  <div className="liquid-glass p-6 rounded-2xl border border-sky-500/15 space-y-4">
                    <h3 className="text-base font-semibold text-white font-display">Custom Agent Prompting</h3>
                    <textarea 
                      value={customInstructions}
                      onChange={handleCustomInstructionsChange}
                      placeholder="E.g., Translate to Egyptian dialect, keep humor puns, keep sound effects minimal, etc."
                      className="w-full h-28 bg-black/60 border border-sky-500/15 rounded-xl p-3 text-sm outline-none focus:border-sky-500 text-slate-200 resize-none font-sans focus:ring-1 focus:ring-sky-500/20"
                    />
                    <p className="text-[11px] text-slate-400 font-mono">
                      ✧ Custom instructions are passed directly to the Gemini neural vision matrix during page synthesis.
                    </p>
                  </div>
                </div>

                {/* Toggle Rules */}
                <div className="space-y-6">
                  <div className="liquid-glass p-6 rounded-2xl border border-sky-500/15 space-y-5">
                    <h3 className="text-base font-semibold text-white font-display">Optimization Rules</h3>
                    
                    <div className="space-y-4">
                      {/* Checkboxes */}
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={translateJapanese} 
                          onChange={(e) => handleSetTranslateJapanese(e.target.checked)}
                          className="w-4 h-4 mt-0.5 rounded border-sky-500/20 bg-black text-blue-600 focus:ring-sky-500"
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-200 group-hover:text-sky-300 transition-colors">Translate Japanese Content</span>
                          <span className="text-[10px] text-slate-500 mt-0.5">Optimizes neural model parameters for Japanese language OCR streams.</span>
                        </span>
                      </label>

                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={translateSfx} 
                          onChange={(e) => handleSetTranslateSfx(e.target.checked)}
                          className="w-4 h-4 mt-0.5 rounded border-sky-500/20 bg-black text-blue-600 focus:ring-sky-500"
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-200 group-hover:text-sky-300 transition-colors">Translate Comic SFX</span>
                          <span className="text-[10px] text-slate-500 mt-0.5">Translate small action sound effects alongside text blocks.</span>
                        </span>
                      </label>

                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={autoFitAndCenter} 
                          onChange={(e) => handleSetAutoFitAndCenter(e.target.checked)}
                          className="w-4 h-4 mt-0.5 rounded border-sky-500/20 bg-black text-blue-600 focus:ring-sky-500"
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-200 group-hover:text-sky-300 transition-colors">Auto Bubble Fit & Center</span>
                          <span className="text-[10px] text-slate-500 mt-0.5">Automatically calculates text bounds to match speech balloon radii.</span>
                        </span>
                      </label>

                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={compressBeforeProcessing} 
                          onChange={(e) => handleSetCompressBeforeProcessing(e.target.checked)}
                          className="w-4 h-4 mt-0.5 rounded border-sky-500/20 bg-black text-blue-600 focus:ring-sky-500"
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-200 group-hover:text-sky-300 transition-colors">Pre-Compress Plate Images</span>
                          <span className="text-[10px] text-slate-500 mt-0.5">Reduces page sizes to achieve 3.5x faster analytical cycle times.</span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="liquid-glass p-6 rounded-2xl border border-sky-500/15 space-y-3">
                    <h4 className="text-sm font-semibold text-slate-200">Plates Mapping Mode</h4>
                    <select 
                      value={zipMatchMode}
                      onChange={(e) => handleSetZipMatchMode(e.target.value as 'filename' | 'index')}
                      className="w-full bg-black/60 border border-sky-500/15 rounded-xl p-2.5 text-xs text-slate-300 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20 outline-none"
                    >
                      <option value="filename">Match by Filename (Recommended)</option>
                      <option value="index">Match by Order Index</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeNavigationTab === 'library' && activeChapterId === null && (
          <div className="flex-1 flex flex-col p-8 bg-gradient-to-tr from-[#03010c] via-[#090615] to-black relative overflow-y-auto pb-32">
            <button
              onClick={() => setShowSettingsPage(true)}
              className="fixed top-4 right-4 z-50 p-2.5 rounded-full liquid-glass border border-sky-500/25 text-slate-300 hover:text-white transition-all"
              title="Settings"
              aria-label="Open Settings"
            >
              <Settings size={18} />
            </button>
            <div className="absolute top-10 right-10 w-96 h-96 bg-blue-600/5 rounded-full blur-[140px] pointer-events-none" />
            <div className="absolute bottom-10 left-10 w-96 h-96 bg-blue-650/5 rounded-full blur-[140px] pointer-events-none" />

            <div className="max-w-6xl mx-auto w-full flex flex-col gap-8 relative z-10">
              
              {/* BREADCRUMBS & ACTION HEADER */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-sky-500/10 pb-6">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono text-sky-350 mb-2">
                    <span className="font-semibold select-none">Library (Library)</span>
                    {activeMangaId && (
                      <>
                        <span>/</span>
                        <button 
                          onClick={() => { setActiveMangaId(null); setActiveVolumeId(null); }}
                          className="hover:text-white transition-all underline decoration-sky-500/50"
                        >
                          {mangas.find(m => m.id === activeMangaId)?.title}
                        </button>
                      </>
                    )}
                    {activeVolumeId && (
                      <>
                        <span>/</span>
                        <button 
                          onClick={() => setActiveVolumeId(null)}
                          className="hover:text-white transition-all underline decoration-sky-500/50"
                        >
                          {mangas.find(m => m.id === activeMangaId)?.volumes.find(v => v.id === activeVolumeId)?.name}
                        </button>
                      </>
                    )}
                  </div>
                  
                  <h1 className="text-3xl font-display font-bold text-white tracking-tight">
                    {!activeMangaId
                      ? 'My Library - Series'
                      : !activeVolumeId
                        ? 'Manage Volumes (Volumes List)'
                        : 'Translation Chapters (Chapter Workspace)'}
                  </h1>
                  <p className="text-xs text-slate-400 mt-1.5 font-sans leading-relaxed">
                    {!activeMangaId
                      ? 'Browse your current manga and manhwa series, or create a new translation series with one click.'
                      : !activeVolumeId
                        ? 'Choose a specific volume to split and manage its translation chapters.'
                        : 'Open a translation chapter to enter the studio and start automatic scanning, bubble fitting, and result export.'}
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  {!activeMangaId && (
                    <>
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          value={librarySearchQuery}
                          onChange={(e) => setLibrarySearchQuery(e.target.value)}
                          placeholder="Search series..."
                          className="bg-black/60 border border-sky-500/15 hover:border-sky-500/30 focus:border-sky-500 rounded-xl pl-8 pr-3 py-2.5 text-xs text-white outline-none transition-all w-40 sm:w-56"
                        />
                      </div>
                      <button
                        onClick={() => setShowCreateSeriesModal(true)}
                        className="bg-gradient-to-r from-blue-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold py-2.5 px-5 rounded-xl transition-all cursor-pointer text-xs shadow-md"
                      >
                        + New Manga
                      </button>
                    </>
                  )}
                  {activeMangaId && !activeVolumeId && (
                    <>
                      <button 
                        onClick={() => { setActiveMangaId(null); }}
                        className="bg-black/60 border border-sky-500/15 hover:border-sky-500/40 text-slate-350 font-bold py-2.5 px-4 rounded-xl transition-all text-xs"
                      >
                        ← Back to All
                      </button>
                      <button 
                        onClick={handleAddVolumePrompt}
                        className="bg-blue-600 hover:bg-sky-550 text-white font-bold py-2.5 px-5 rounded-xl transition-all text-xs cursor-pointer shadow-md shadow-blue-950/45"
                      >
                        + Add New Volume
                      </button>
                    </>
                  )}
                  {activeMangaId && activeVolumeId && (
                    <>
                      <button 
                        onClick={() => { setActiveVolumeId(null); }}
                        className="bg-black/60 border border-sky-500/15 hover:border-sky-500/40 text-slate-350 font-bold py-2.5 px-4 rounded-xl transition-all text-xs"
                      >
                        ← Volumes
                      </button>
                      <label 
                        className="bg-blue-600/20 hover:bg-blue-600/40 border border-sky-500/30 text-sky-300 font-bold py-2.5 px-5 rounded-xl transition-all text-xs cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Upload size={14} /> Upload Volume as Chapter
                        <input 
                          type="file" 
                          // @ts-ignore
                          webkitdirectory="true" 
                          directory="true" 
                          multiple 
                          className="hidden"
                          onChange={async (e) => {
                             const files = e.target.files;
                             if (!files || files.length === 0) return;
                             
                             Swal.fire({ title: 'Processing folder images...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                             
                             // filter images only and sort them by name naturally
                             const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
                             
                             if (imageFiles.length === 0) {
                               return Swal.fire('Empty', 'There are no images in this volume', 'error');
                             }
                             
                             const newImages: ProcessedImage[] = [];
                             for (let i = 0; i < imageFiles.length; i++) {
                               const file = imageFiles[i];
                               const dataUrl = await new Promise<string>((resolve) => {
                                 const reader = new FileReader();
                                 reader.onload = (ev) => resolve(ev.target?.result as string);
                                 reader.readAsDataURL(file);
                               });
                               const dimensions = await new Promise<{width: number, height: number}>((resolve) => {
                                   const img = new Image();
                                   img.onload = () => resolve({ width: img.width, height: img.height });
                                   img.src = dataUrl;
                               });
                               newImages.push({
                                   id: Math.random().toString(36).substr(2, 9),
                                   filename: file.name,
                                   dataUrl,
                                   mimeType: file.type,
                                   regions: [],
                                   paintStrokes: [],
                                   status: "idle",
                                   width: dimensions.width,
                                   height: dimensions.height
                               });
                             }
                             
                             const folderPathParts = imageFiles[0].webkitRelativePath.split('/');
                             const chapterName = folderPathParts.length > 1 ? folderPathParts[0] : 'New Chapter (from Volume)';
                             
                             const newChapter: Chapter = {
                               id: Math.random().toString(36).substr(2, 9),
                               name: chapterName,
                               images: newImages
                             };
                             
                             setMangas(prev => prev.map(m => {
                               if (m.id !== activeMangaId) return m;
                               return {
                                 ...m,
                                 volumes: m.volumes.map(v => {
                                   if (v.id !== activeVolumeId) return v;
                                   return { ...v, chapters: [...v.chapters, newChapter] }
                                 })
                               }
                             }));
                             
                             Swal.close();
                             
                             // clear input
                             e.target.value = '';
                          }}
                        />
                      </label>
                      <button 
                        onClick={handleAddChapterPrompt}
                        className="bg-blue-600 hover:bg-blue-550 text-white font-bold py-2.5 px-5 rounded-xl transition-all text-xs cursor-pointer shadow-md shadow-blue-950/45"
                      >
                        + Add Chapter Empty
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* STATE A: MANGA SERIES GRID */}
              {!activeMangaId && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {mangas.length === 0 ? (
                    <div className="col-span-full py-16 text-center">
                      <div className="w-16 h-16 bg-blue-950/20 border border-sky-500/20 rounded-2xl flex items-center justify-center text-sky-400 mx-auto mb-4">
                        <ImageIcon size={28} />
                      </div>
                      <h3 className="text-lg font-bold text-slate-200">No manga series yet</h3>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto mt-2 leading-relaxed font-sans">
                        Start by creating a new manga/manhwa series to organize and translate its chapters.
                      </p>
                      <button
                        onClick={() => setShowCreateSeriesModal(true)}
                        className="mt-5 bg-gradient-to-r from-blue-600 to-blue-600 text-white font-bold text-xs py-2.5 px-6 rounded-xl transition-all"
                      >
                        + Create New Manga (Create New)
                      </button>
                    </div>
                  ) : filteredMangas.length === 0 ? (
                    <div className="col-span-full py-16 text-center">
                      <p className="text-sm text-slate-400">No series match "{librarySearchQuery}".</p>
                    </div>
                  ) : (
                    filteredMangas.map(manga => {
                      const totalChaptersCount = manga.volumes.reduce((acc, v) => acc + v.chapters.length, 0);
                      return (
                        <div 
                          key={manga.id}
                          onClick={() => setActiveMangaId(manga.id)}
                          className="relative aspect-[3/4] rounded-2xl overflow-hidden group shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-sky-500/10 hover:border-sky-500/35 transition-all duration-300 cursor-pointer flex flex-col justify-end bg-[#05020c]"
                        >
                          {/* Cover Image/Gradient Representation */}
                          {manga.coverUrl ? (
                            <img 
                              src={manga.coverUrl} 
                              alt={manga.title} 
                              referrerPolicy="no-referrer"
                              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-60"
                            />
                          ) : (
                            <div className="absolute inset-0 bg-gradient-to-tr from-[#120731] via-[#09041a] to-black flex flex-col items-center justify-center p-6 text-center">
                              <Sparkles className="w-10 h-10 text-sky-500/60 animate-pulse mb-3" />
                              <span className="text-xs text-sky-400/85 tracking-widest uppercase font-mono font-bold leading-none">{manga.type}</span>
                            </div>
                          )}
                          
                          {/* Type Badge top-left */}
                          <span className={`absolute top-4 left-4 text-[9px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider z-20 ${manga.type === 'manhwa' ? 'bg-blue-600 border border-sky-400 text-white' : 'bg-amber-600 border border-amber-400 text-white'}`}>
                            {manga.type}
                          </span>

                          {/* Quick Delete top-right */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteManga(manga.id);
                            }}
                            className="absolute top-4 right-4 bg-red-950/80 hover:bg-red-700 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-20 shadow-md border border-red-500/20"
                            title="Delete the series from Library"
                          >
                            <Trash2 size={13} />
                          </button>

                          {/* Lower Liquid Glass layer - overlay cover bottom */}
                          <div className="absolute bottom-0 left-0 right-0 p-4 bg-black/60 backdrop-blur-md border-t border-sky-500/15 flex flex-col gap-1 transition-all group-hover:bg-[#110729]/85 z-10 text-left">
                            <span className="text-[10px] text-sky-400 tracking-wider uppercase font-mono font-bold">{manga.type}</span>
                            <h3 className="text-base font-display font-bold text-white tracking-tight truncate leading-tight">{manga.title}</h3>
                            <p className="text-[11px] text-slate-350 leading-normal line-clamp-2 h-8 font-sans">{manga.description || 'No custom description has been written for this series yet.'}</p>
                            <div className="flex items-center justify-between text-[10px] text-sky-300 font-mono mt-1 w-full pt-2 border-t border-sky-500/10">
                              <span>📚 Volumes: {manga.volumes.length}</span>
                              <span>📖 Chapters: {totalChaptersCount}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* STATE B: VOLUMES GRID LIST */}
              {activeMangaId && !activeVolumeId && (
                (() => {
                  const currentManga = mangas.find(m => m.id === activeMangaId);
                  if (!currentManga) return null;
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                      {currentManga.volumes.length === 0 ? (
                        <div className="col-span-full py-16 text-center">
                          <div className="w-16 h-16 bg-blue-950/20 border border-sky-500/20 rounded-2xl flex items-center justify-center text-sky-400 mx-auto mb-4">
                            <Plus size={28} />
                          </div>
                          <h3 className="text-lg font-bold text-slate-200">No volumes yet</h3>
                          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-2 leading-relaxed">
                            Manga volumes are used to organize and split large groups of translation chapters (example: Volume 20, Volume 1).
                          </p>
                          <button
                            onClick={handleAddVolumePrompt}
                            className="mt-5 bg-blue-600 hover:bg-sky-550 text-white font-bold text-xs py-2.5 px-6 rounded-xl transition-all"
                          >
                            + Add First Volume (Create Volume)
                          </button>
                        </div>
                      ) : (
                        currentManga.volumes.map(vol => (
                          <div 
                            key={vol.id}
                            onClick={() => setActiveVolumeId(vol.id)}
                            className="relative aspect-[3/4] bg-gradient-to-tr from-[#12072f] via-[#09041a] to-black rounded-2xl overflow-hidden border border-sky-500/10 hover:border-sky-500/35 transition-all duration-300 cursor-pointer flex flex-col justify-end p-6 group text-left"
                          >
                            {/* Inherited Cover backdrop or pattern */}
                            {currentManga.coverUrl && (
                              <img 
                                src={currentManga.coverUrl} 
                                alt={vol.name} 
                                className="absolute inset-0 w-full h-full object-cover opacity-15"
                              />
                            )}

                            {/* Vol Download top-left */}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const allImages = vol.chapters.flatMap(c => c.images);
                                if (allImages.length === 0) return Swal.fire('Empty', 'No images to compress', 'info');
                                Swal.fire({ title: 'Compressing...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                                try {
                                  await downloadProcessedZip(allImages, undefined, `${vol.name}.zip`);
                                } catch (err: any) {
                                  Swal.fire('Error', err?.message || 'Failed to generate ZIP', 'error');
                                } finally {
                                  Swal.close();
                                }
                              }}
                              className="absolute top-4 left-4 bg-blue-950/80 hover:bg-blue-700 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-20 shadow-md border border-sky-500/20"
                              title="Download all volume chapters as ZIP"
                            >
                              <Download size={13} />
                            </button>

                            {/* Vol delete top-right */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteVolume(vol.id);
                              }}
                              className="absolute top-4 right-4 bg-red-950/80 hover:bg-red-700 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-20 shadow-md border border-red-500/20"
                              title="Delete this volume entirely"
                            >
                              <Trash2 size={13} />
                            </button>

                            <div className="absolute inset-0 bg-radial-gradient from-transparent to-black pointer-events-none" />

                            {/* Bottom Liquid Glass display inside the Volume Card */}
                            <div className="absolute bottom-0 left-0 right-0 p-5 bg-black/80 backdrop-blur-md border-t border-sky-500/15 flex flex-col gap-1.5 transition-all group-hover:bg-[#110729]/95 z-10 text-left">
                              <span className="text-[10px] text-sky-400 tracking-wider font-mono font-bold">VOLUME CONTAINER</span>
                              <h3 className="text-xl font-display font-bold text-sky-300 tracking-tight leading-none mb-1">{vol.name}</h3>
                              <p className="text-xs text-slate-350 line-clamp-2 h-8 font-sans leading-relaxed text-left">
                                {vol.chapters.length > 0 
                                  ? `Contains: ${vol.chapters.map(c => c.name).join(', ')}`
                                  : 'This volume is currently empty. Click to add new translation chapters inside it.'}
                              </p>
                              <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono mt-1 pt-2 border-t border-sky-500/10 w-full">
                                <span>📖 Chapters: {vol.chapters.length} </span>
                                <span className="text-emerald-500 font-bold font-mono">✔ Active</span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })()
              )}

              {/* STATE C: CHAPTER REPOSITORY GRID */}
              {activeMangaId && activeVolumeId && (
                (() => {
                  const currentManga = mangas.find(m => m.id === activeMangaId);
                  const currentVolume = currentManga?.volumes.find(v => v.id === activeVolumeId);
                  if (!currentVolume) return null;
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                      {currentVolume.chapters.length === 0 ? (
                        <div className="col-span-full py-16 text-center">
                          <div className="w-16 h-16 bg-blue-950/20 border border-sky-500/20 rounded-2xl flex items-center justify-center text-sky-400 mx-auto mb-4">
                            <Plus size={28} />
                          </div>
                          <h3 className="text-lg font-bold text-slate-200">No chapters yet</h3>
                          <p className="text-xs text-slate-400 max-w-sm mx-auto mt-2 leading-relaxed">
                            Create chapters for this volume to immediately start attaching manga pages, cleaning, and fitting bubbles through the main studio.
                          </p>
                          <button
                            onClick={handleAddChapterPrompt}
                            className="mt-5 bg-blue-600 hover:bg-blue-550 text-white font-bold text-xs py-2.5 px-6 rounded-xl transition-all"
                          >
                            + Add New Chapter for Translation (Add Chapter)
                          </button>
                        </div>
                      ) : (
                        currentVolume.chapters.map(chap => {
                          const coverPage = chap.images[0]?.dataUrl;
                          return (
                            <div 
                              key={chap.id}
                              onClick={() => handleOpenChapter(chap)}
                              className="relative aspect-[3/4] bg-gradient-to-tr from-[#0b0424] via-[#050212] to-black rounded-2xl overflow-hidden border border-sky-500/10 hover:border-sky-500/35 transition-all duration-300 cursor-pointer flex flex-col justify-end p-6 group text-left"
                            >
                              {coverPage ? (
                                <img 
                                  src={coverPage} 
                                  alt={chap.name} 
                                  className="absolute inset-0 w-full h-full object-cover opacity-45 group-hover:scale-105 transition-all duration-300"
                                />
                              ) : (
                                <div className="absolute inset-0 bg-gradient-to-br from-[#120731] via-black to-[#050214] flex flex-col items-center justify-center p-6 text-center opacity-30">
                                  <svg className="w-12 h-12 text-slate-500 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
                                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                                  </svg>
                                </div>
                              )}

                              {/* Chapter Download top-left */}
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (chap.images.length === 0) return Swal.fire('Empty', 'No images to compress', 'info');
                                  Swal.fire({ title: 'Compressing...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                                  try {
                                    await downloadProcessedZip(chap.images, undefined, `${chap.name}.zip`);
                                  } catch (err: any) {
                                    Swal.fire('Error', err?.message || 'Failed to generate ZIP', 'error');
                                  } finally {
                                    Swal.close();
                                  }
                                }}
                                className="absolute top-4 left-4 bg-blue-950/85 hover:bg-blue-750 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-20 shadow-md border border-sky-500/20"
                                title="Download all chapter images as ZIP"
                              >
                                <Download size={13} />
                              </button>

                              {/* Chapter Delete top-right */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteChapter(chap.id);
                                }}
                                className="absolute top-4 right-4 bg-red-950/85 hover:bg-red-750 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-20 shadow-md border border-red-500/20"
                                title="Delete this chapter entirely"
                              >
                                <Trash2 size={13} />
                              </button>

                              {/* Bottom Liquid Glass display inside the Chapter Card */}
                              <div className="absolute bottom-0 left-0 right-0 p-5 bg-black/85 backdrop-blur-md border-t border-sky-500/15 flex flex-col gap-1 transition-all group-hover:bg-[#120733]/90 z-10 text-left">
                                <span className="text-[10px] text-sky-400 tracking-wider font-mono font-bold">MANGA CHAPTER</span>
                                <h3 className="text-base font-display font-bold text-white tracking-tight leading-none mb-1">{chap.name}</h3>
                                <p className="text-[11px] text-slate-350 leading-normal line-clamp-1 font-sans">
                                  {chap.images.length > 0 ? `Contains ${chap.images.length} prepared pages.` : 'Chapter is empty. Click to enter and upload images.'}
                                </p>
                                <div className="flex justify-between items-center text-[10px] text-sky-300 font-mono mt-1.5 pt-1.5 border-t border-sky-500/10 w-full">
                                  <span>🚀 Open in Studio</span>
                                  <span>{chap.images.length} Pages</span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        )}

        {activeNavigationTab === 'library' && activeChapterId !== null && images.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#04020a] relative">
            {/* Ambient spotlights */}
            <div className="absolute top-1/4 left-1/3 w-80 h-80 bg-sky-650/5 rounded-full blur-[140px] pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-blue-650/5 rounded-full blur-[140px] pointer-events-none" />
            
            <div className="liquid-glass p-12 rounded-3xl max-w-xl w-full flex flex-col items-center gap-6 shadow-[0_15px_40px_rgba(56, 189, 248,0.2)] text-slate-200 text-center border border-sky-500/15 relative z-10">
              <div className="w-20 h-20 bg-blue-950/20 rounded-2xl border border-sky-500/25 flex items-center justify-center text-sky-400 shadow-inner">
                <svg className="w-10 h-10 animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-2xl font-display font-bold text-white tracking-tight">This chapter is currently empty (Chapter is Empty)</h3>
                <p className="text-sm text-slate-400 max-w-md mt-1 mx-auto leading-relaxed font-sans">
                  Get started by dragging and dropping a ZIP file, or uploading pages one by one.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full mt-2">
                <button
                  onClick={() => setShowManagePages(true)}
                  className="w-full sm:w-auto flex-1 bg-gradient-to-r from-blue-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold py-3.5 px-6 rounded-xl shadow-lg shadow-blue-950/30 transition-all active:scale-95 cursor-pointer text-sm"
                >
                  + Upload Images
                </button>
              </div>
            </div>
          </div>
        )}

        {activeNavigationTab === 'library' && activeChapterId !== null && images.length > 0 && (
          <>
            {/* Left Sidebar (Thumbnails) */}
            <aside className="w-16 sm:w-48 md:w-64 shrink-0 border-r border-sky-500/10 bg-black/30 backdrop-blur-md flex flex-col overflow-y-auto glass-noise transition-all">
              <div className="flex items-center justify-center gap-2 p-2 border-b border-[#333]/50 shrink-0">
                <button
                  onClick={() => {
                    const idx = images.findIndex(i => i.id === selectedImageId);
                    if (idx > 0) setSelectedImageId(images[idx - 1].id);
                  }}
                  disabled={images.findIndex(i => i.id === selectedImageId) <= 0}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed bg-[#111] hover:bg-[#222]"
                  title="Previous Page"
                >
                  <ChevronUp size={16} />
                </button>
                <span className="hidden sm:inline text-[10px] text-slate-500 font-mono">
                  {images.length > 0 ? `${Math.max(0, images.findIndex(i => i.id === selectedImageId)) + 1}/${images.length}` : '-'}
                </span>
                <button
                  onClick={() => {
                    const idx = images.findIndex(i => i.id === selectedImageId);
                    if (idx >= 0 && idx < images.length - 1) setSelectedImageId(images[idx + 1].id);
                  }}
                  disabled={images.findIndex(i => i.id === selectedImageId) === -1 || images.findIndex(i => i.id === selectedImageId) >= images.length - 1}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed bg-[#111] hover:bg-[#222]"
                  title="Next Page"
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              {images.length === 0 && (
                <div className="p-8 text-center text-slate-500 text-sm hidden sm:block">
                  Upload a ZIP file to get started.
                </div>
              )}
          {images.map((img, i) => (
            <div
              key={img.id}
              className={`relative flex flex-col gap-2 p-3 border-b border-[#333]/50 text-left transition-colors cursor-pointer group ${selectedImageId === img.id ? 'bg-[#111]' : 'hover:bg-[#111]/50'}`}
              onClick={() => setSelectedImageId(img.id)}
            >
              <div className="relative aspect-[3/4] w-full bg-black rounded overflow-hidden flex">
                {img.originalDataUrl && (
                  <img src={img.originalDataUrl} alt={`${img.filename} original`} loading="lazy" className="w-1/2 h-full object-cover opacity-80 border-r border-[#444]" />
                )}
                <img src={img.dataUrl} alt={img.filename} loading="lazy" className={`${img.originalDataUrl ? 'w-1/2' : 'w-full'} h-full object-cover opacity-80`} />
                {img.status === 'processing' && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <Loader2 className="animate-spin text-sky-400" />
                  </div>
                )}
                {img.status === 'done' && (
                  <div className="absolute top-2 right-2 flex gap-1">
                    <span className="bg-emerald-500 text-white text-[10px] uppercase font-bold px-1.5 py-0.5 rounded">Done</span>
                  </div>
                )}
                
                {img.status !== 'done' && (
                  <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
                    <input 
                      type="checkbox"
                      checked={selectedForProcess.has(img.id)}
                      onChange={(e) => toggleSelectForProcess(img.id, e as any)}
                      className="w-4 h-4 rounded border-[#444] bg-[#111] text-blue-600 focus:ring-blue-500"
                      title="Select for batch processing (Max 5)"
                    />
                  </div>
                )}
                
                {/* Overlays for ordering and deletion */}
                <div className="absolute top-2 left-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button 
                     onClick={(e) => { e.stopPropagation(); moveImageUp(i); }}
                     className="bg-black/80 hover:bg-[#111] text-white p-1 rounded"
                     title="Move Up"
                   >
                     <ChevronUp size={14} />
                   </button>
                   <button 
                     onClick={(e) => { e.stopPropagation(); moveImageDown(i); }}
                     className="bg-black/80 hover:bg-[#111] text-white p-1 rounded"
                     title="Move Down"
                   >
                     <ChevronDown size={14} />
                   </button>
                </div>
                
                <button
                   onClick={(e) => deleteImage(img.id, e)}
                   className="absolute bottom-2 right-2 bg-red-900/80 hover:bg-red-700 text-white p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                   title="Delete Image"
                >
                   <Trash2 size={14} />
                </button>
              </div>
              <span className="text-xs truncate w-full" title={img.filename}>{img.filename}</span>
            </div>
          ))}
        </aside>

        {/* Editor Area */}
        <main className="flex-1 min-w-0 p-2 sm:p-4 md:p-6 flex flex-col items-center justify-center relative overflow-hidden">
          {selectedImage ? (
            <div className="w-full h-full flex flex-col gap-4">
              <div className="flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="font-medium text-slate-300 text-sm max-w-[200px] truncate">{selectedImage.filename}</h2>
                  <button
                    onClick={() => setShowExternalAIModal(true)}
                    className="flex items-center gap-1.5 bg-[#090615] hover:bg-[#130d2a] border border-sky-500/30 text-sky-200 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all shadow-[0_4px_12px_rgba(56, 189, 248,0.15)]"
                    title="Load and submit translation via external AI assistant"
                  >
                    <Sparkles size={13} className="text-sky-300 animate-bounce" /> External AI Cocktail ✦
                  </button>
                  
                  {/* Tool selection */}
                  <div className="flex bg-black rounded-lg p-1 border border-[#333] ml-4">
                    <button 
                      onClick={() => setActiveTool('select')}
                      className={`p-1.5 rounded-md ${activeTool === 'select' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      title="Select/Move"
                    >
                      <MousePointer2 size={16} />
                    </button>
                    <button 
                      onClick={() => setActiveTool('draw')}
                      className={`p-1.5 rounded-md ${activeTool === 'draw' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      title="Draw"
                    >
                      <Brush size={16} />
                    </button>
                    <button 
                      onClick={() => setActiveTool('erase')}
                      className={`p-1.5 rounded-md ${activeTool === 'erase' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      title="Erase (White Brush)"
                    >
                      <Eraser size={16} />
                    </button>
                    <div className="w-px bg-slate-700 mx-1 my-1"></div>
                    <button
                      onClick={() => undo(selectedImage.id)}
                      disabled={!(selectedImage.history && selectedImage.history.length > 0)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Undo Action"
                    >
                      <Undo size={16} />
                    </button>
                    <button
                      onClick={() => redo(selectedImage.id)}
                      disabled={!(selectedImage.redoHistory && selectedImage.redoHistory.length > 0)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Redo Action"
                    >
                      <Redo size={16} />
                    </button>
                  </div>

                  {/* Zoom controls */}
                  <div className="flex bg-black rounded-lg p-1 border border-[#333]">
                    <button onClick={() => setZoom(z => Math.max(0.2, z - 0.2))} className="p-1.5 text-slate-400 hover:text-slate-200">
                      <ZoomOut size={16} />
                    </button>
                    <span className="text-xs font-mono w-10 text-center flex items-center justify-center text-slate-400">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} className="p-1.5 text-slate-400 hover:text-slate-200">
                      <ZoomIn size={16} />
                    </button>
                  </div>

                  {selectedImage.status !== 'processing' && (
                    <div className="flex items-center gap-2 ml-4 animate-fade-in">
                      <button
                        onClick={handleDownloadCurrentPage}
                        className="flex items-center gap-1.5 bg-[#111] hover:bg-[#222] px-3 py-1.5 rounded text-xs font-medium transition-colors"
                        title="Download this page as PNG"
                      >
                        <Download size={14} /> Download Page
                      </button>
                      <button 
                        onClick={() => {
                          if (confirm("Are you sure you want to remove all texts and paint strokes from this page?")) {
                            saveHistory(selectedImage.id);
                            updateImage(selectedImage.id, { regions: [], paintStrokes: [] });
                            setSelectedRegionId(null);
                          }
                        }}
                        className="flex items-center gap-1.5 bg-red-900/50 hover:bg-red-800 px-3 py-1.5 rounded text-xs font-medium transition-colors text-red-200"
                        title="Clear all generated texts and paint strokes"
                      >
                        <Trash2 size={14} /> Clear All
                      </button>
                      <button 
                        onClick={() => {
                          saveHistory(selectedImage.id);
                          const newRegion: Region = {
                            id: Math.random().toString(36).substr(2, 9),
                            type: 'bubble',
                            originalText: '',
                            translatedText: 'New Text',
                            x: selectedImage.width / 2 - 100,
                            y: selectedImage.height / 2 - 50,
                            width: 200,
                            height: 100,
                            angle: 0,
                            textColor: '#000000',
                            strokeColor: 'transparent',
                            strokeWidth: 0,
                            bgColor: '#ffffff',
                            fontFamily: 'Marhey',
                            fontSize: 24,
                            fontWeight: 'normal',
                            fontStyle: 'normal',
                            textAlign: 'center',
                            lineHeight: 1.2,
                            letterSpacing: 0,
                            opacity: 1,
                            shadowBlur: 0,
                            shadowColor: 'transparent',
                            autoFitText: true
                          };
                          updateImage(selectedImage.id, { regions: [...selectedImage.regions, newRegion] });
                          setSelectedRegionId(newRegion.id);
                        }}
                        className="flex items-center gap-1.5 bg-[#111] hover:bg-[#222] px-3 py-1.5 rounded text-xs font-medium transition-colors"
                      >
                        <Plus size={14} /> Add Text
                      </button>
                      {isGeneratingBubbleFillPreview ? (
                        <div className="flex items-center gap-1.5 bg-sky-900/40 px-3 py-1.5 rounded text-xs font-medium text-sky-200 border border-sky-800/50">
                          <Loader2 size={14} className="animate-spin" /> Detecting bubble boxes...
                        </div>
                      ) : bubbleFillPreview && bubbleFillPreview.imgId === selectedImage.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={handleApplyBubbleFillPreview}
                            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 rounded text-xs font-medium transition-colors text-white"
                            title="Apply detected bubble bounds"
                          >
                            <Wand2 size={14} /> Apply
                          </button>
                          <button
                            onClick={() => setBubbleFillPreview(null)}
                            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-xs font-medium transition-colors text-slate-200"
                            title="Discard preview"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleGenerateBubbleFillPreview(selectedImage.id)}
                          className="flex items-center gap-1.5 bg-sky-900/40 hover:bg-sky-800 px-3 py-1.5 rounded text-xs font-medium transition-colors text-sky-200 border border-sky-800/50"
                          title="Smart Center All Text Bubbles"
                        >
                          <Wand2 size={14} /> Center All Bubbles
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          if (selectedForProcess.size > 0) {
                            processSelectedImages();
                          } else {
                            processImage(selectedImage);
                          }
                        }}
                        className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                      >
                        <Play size={14} /> {selectedForProcess.size > 0 ? `Process Selected (${selectedForProcess.size})` : 'Process Image'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-slate-500"><Loader2 className="animate-spin mr-2"/> Loading Editor...</div>}>
                <ImageEditor
                  image={selectedImage}
                  selectedRegionId={selectedRegionId}
                  onSelectRegion={setSelectedRegionId}
                  onUpdateRegion={updateRegion}
                  stageRef={React.createRef()}
                  activeTool={activeTool}
                  brushSize={brushSize}
                  brushColor={brushColor}
                  zoom={zoom}
                  showOriginal={showOriginal}
                  onAddStroke={(stroke) => {
                    saveHistory(selectedImage.id);
                    updateImage(selectedImage.id, {
                      paintStrokes: [...selectedImage.paintStrokes, stroke]
                    });
                  }}
                  previewRegions={bubbleFillPreview && bubbleFillPreview.imgId === selectedImage.id
                    ? bubbleFillPreview.regions.filter(r => r.type === 'bubble')
                    : undefined}
                />
              </Suspense>
            </div>
          ) : (
            <div className="text-slate-500 flex flex-col items-center gap-4">
              <ImageIcon size={48} className="opacity-50" />
              <p>Select an image to edit</p>
            </div>
          )}
        </main>

        {/* Toggle button for right properties panel on small viewports */}
        <button
          onClick={() => setShowRightPanel(v => !v)}
          className="md:hidden fixed bottom-24 right-4 z-40 p-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg"
          title="Toggle Properties Panel"
        >
          <Settings size={18} />
        </button>
        {showRightPanel && (
          <div
            className="fixed inset-0 bg-black/60 z-30 md:hidden"
            onClick={() => setShowRightPanel(false)}
          />
        )}

        {/* Right Sidebar (Properties) */}
        <aside className={`fixed inset-y-0 right-0 z-40 w-80 max-w-[85vw] transform transition-transform duration-300 ${showRightPanel ? 'translate-x-0' : 'translate-x-full'} md:translate-x-0 md:static md:z-auto md:w-80 border-l border-[#333] bg-black flex flex-col overflow-y-auto`}>
          {selectedImage && selectedRegion ? (
            <div className="p-5 flex flex-col gap-6">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <h3 className="font-semibold text-slate-300 flex items-center gap-2">
                    Edit Text <span className="text-[10px] bg-[#111] px-1.5 py-0.5 rounded uppercase tracking-wider text-slate-400">{selectedRegion.type}</span>
                  </h3>
                  <button
                    onClick={() => {
                      saveHistory(selectedImage.id);
                      updateImage(selectedImage.id, {
                        regions: selectedImage.regions.filter(r => r.id !== selectedRegion.id)
                      });
                      setSelectedRegionId(null);
                    }}
                    className="text-red-400 hover:text-red-300 bg-red-950/30 p-1.5 rounded transition-colors"
                    title="Delete Region"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-4">{selectedRegion.originalText}</p>
                <textarea
                  value={selectedRegion.translatedText}
                  onChange={(e) => updateRegion(selectedRegion.id, { translatedText: e.target.value })}
                  className="w-full h-24 bg-black border border-[#444] rounded-md p-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                  dir="ltr"
                />
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5 col-span-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-sky-300">Font Used (Font Family)</label>
                      <button 
                        onClick={() => fontInputRef.current?.click()}
                        className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 font-sans bg-blue-950/20 px-1.5 py-0.5 rounded border border-blue-800/30"
                        title="Upload a custom font (.ttf, .otf, .zip)"
                      >
                        <Plus size={10} /> Upload Custom Fonts
                      </button>
                      <input 
                        type="file" 
                        ref={fontInputRef} 
                        onChange={handleFontUpload} 
                        accept=".zip,.ttf,.otf" 
                        className="hidden" 
                        multiple 
                      />
                    </div>
                    
                    <select
                      value={selectedRegion.fontFamily}
                      onChange={(e) => updateRegion(selectedRegion.id, { fontFamily: e.target.value })}
                      className="w-full bg-black border border-[#444] rounded-md p-2 text-sm outline-none font-sans"
                    >
                      {customFonts.map(font => (
                        <option key={font} value={font} style={{ fontFamily: font }}>{font.replace('MET-', '')} (uploaded) ✦</option>
                      ))}
                      {["Cairo", "Tajawal", "Marhey", "Aref Ruqaa", "Almarai", "El Messiri", "Amiri", "Changa", "Harmattan", "Katibeh", "Lalezar", "Lemonada", "Mada", "Markazi Text", "Reem Kufi", "Rakkas"].map(font => (
                        <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                      ))}
                    </select>

                    {/* Highly Elegant Visual Font Live Preview List */}
                    <div className="bg-[#0b0718]/80 border border-blue-900/30 rounded-xl p-2.5 mt-2 max-h-40 overflow-y-auto space-y-1.5 scrollbar-thin">
                      <p className="text-[10px] text-slate-400 font-sans tracking-tight mb-2 border-b border-blue-900/20 pb-1 flex justify-between">
                        <span>Live font preview list</span>
                        <span className="text-sky-400">Font name in its own look ✦</span>
                      </p>
                      {customFonts.concat(["Cairo", "Tajawal", "Marhey", "Aref Ruqaa", "Almarai", "El Messiri", "Amiri", "Changa", "Harmattan", "Katibeh", "Lalezar", "Lemonada", "Mada", "Reem Kufi", "Rakkas"]).map((font) => (
                        <button
                          key={font}
                          onClick={() => updateRegion(selectedRegion.id, { fontFamily: font })}
                          style={{ fontFamily: font }}
                          className={`w-full text-left hover:bg-blue-950/40 p-2 rounded-lg text-xs transition-all flex justify-between items-center ${selectedRegion.fontFamily === font ? 'bg-blue-950/60 text-sky-300 border border-blue-700/50' : 'text-slate-300'}`}
                        >
                          <span className="text-[9px] text-slate-500 font-mono select-none">{font.replace('MET-', '')}</span>
                          <span className="text-sm tracking-wide truncate max-w-[70%] text-left font-semibold">Styling: Manga {font.replace('MET-', '')}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400">Font Size</label>
                    <input
                      type="number"
                      value={Math.round(selectedRegion.fontSize)}
                      onChange={(e) => updateRegion(selectedRegion.id, { fontSize: Number(e.target.value), autoFitText: false })}
                      className="w-full bg-black border border-[#444] rounded-md p-2 text-sm outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400">Text Align</label>
                    <select
                      value={selectedRegion.textAlign}
                      onChange={(e) => updateRegion(selectedRegion.id, { textAlign: e.target.value })}
                      className="w-full bg-black border border-[#444] rounded-md p-2 text-sm outline-none"
                    >
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                      <option value="left">Left</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400">Style</label>
                    <div className="flex gap-2">
                       <button onClick={() => updateRegion(selectedRegion.id, { fontWeight: selectedRegion.fontWeight === 'bold' ? 'normal' : 'bold' })} className={`flex-1 p-2 border rounded-md text-sm font-bold ${selectedRegion.fontWeight === 'bold' ? 'bg-blue-600 border-blue-600' : 'bg-black border-[#444]'}`}>B</button>
                       <button onClick={() => updateRegion(selectedRegion.id, { fontStyle: selectedRegion.fontStyle === 'italic' ? 'normal' : 'italic' })} className={`flex-1 p-2 border rounded-md text-sm italic ${selectedRegion.fontStyle === 'italic' ? 'bg-blue-600 border-blue-600' : 'bg-black border-[#444]'}`}>I</button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400">Text Color</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={selectedRegion.textColor}
                        onChange={(e) => updateRegion(selectedRegion.id, { textColor: e.target.value })}
                        className="w-8 h-8 rounded shrink-0 bg-transparent border-0 p-0 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={selectedRegion.textColor}
                        onChange={(e) => updateRegion(selectedRegion.id, { textColor: e.target.value })}
                        className="w-full bg-black border border-[#444] rounded-md p-1.5 text-xs outline-none uppercase"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400">Outline (Stroke)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={selectedRegion.strokeColor === 'transparent' ? '#ffffff' : selectedRegion.strokeColor}
                        onChange={(e) => updateRegion(selectedRegion.id, { strokeColor: e.target.value })}
                        className="w-8 h-8 rounded shrink-0 bg-transparent border-0 p-0 cursor-pointer"
                        disabled={selectedRegion.strokeColor === 'transparent'}
                      />
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="range"
                          min="0"
                          max="20"
                          value={selectedRegion.strokeColor === 'transparent' ? 0 : selectedRegion.strokeWidth}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            if (val === 0) updateRegion(selectedRegion.id, { strokeColor: 'transparent', strokeWidth: 0 });
                            else updateRegion(selectedRegion.id, { strokeColor: selectedRegion.strokeColor === 'transparent' ? '#ffffff' : selectedRegion.strokeColor, strokeWidth: val });
                          }}
                          className="w-full accent-blue-500"
                        />
                        <span className="text-xs font-mono">{selectedRegion.strokeColor === 'transparent' ? 0 : selectedRegion.strokeWidth}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Background Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selectedRegion.bgColor === 'transparent' ? '#ffffff' : selectedRegion.bgColor}
                      onChange={(e) => updateRegion(selectedRegion.id, { bgColor: e.target.value })}
                      className="w-8 h-8 rounded shrink-0 bg-transparent border-0 p-0 cursor-pointer"
                      disabled={selectedRegion.bgColor === 'transparent'}
                    />
                    <button 
                      onClick={() => updateRegion(selectedRegion.id, { bgColor: selectedRegion.bgColor === 'transparent' ? '#ffffff' : 'transparent' })}
                      className="text-[10px] bg-[#111] px-2 py-1.5 rounded text-slate-300 w-full"
                    >
                      {selectedRegion.bgColor === 'transparent' ? 'No BG' : 'Clear BG'}
                    </button>
                    {selectedRegion.bgColor !== 'transparent' && ('EyeDropper' in window) && (
                      <button
                        onClick={async () => {
                          try {
                            const eyeDropper = new (window as any).EyeDropper();
                            const result = await eyeDropper.open();
                            updateRegion(selectedRegion.id, { bgColor: result.sRGBHex });
                          } catch (e) {}
                        }}
                        className="p-1 px-2 bg-[#111] hover:bg-[#222] rounded-md text-slate-300 shrink-0 h-[28px]"
                        title="Pick Color from Screen"
                      >
                        <Pipette size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Angle (Rotation)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      value={Math.round(selectedRegion.angle)}
                      onChange={(e) => updateRegion(selectedRegion.id, { angle: Number(e.target.value) })}
                      className="flex-1 accent-blue-500"
                    />
                    <span className="text-xs w-8 text-left font-mono">{Math.round(selectedRegion.angle)}°</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400">Letter Spacing</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="-5"
                        max="20"
                        step="0.5"
                        value={selectedRegion.letterSpacing || 0}
                        onChange={(e) => updateRegion(selectedRegion.id, { letterSpacing: Number(e.target.value) })}
                        className="flex-1 accent-blue-500"
                      />
                      <span className="text-xs w-6 text-left font-mono">{selectedRegion.letterSpacing || 0}</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400">Opacity (All)</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={selectedRegion.opacity ?? 1}
                        onChange={(e) => updateRegion(selectedRegion.id, { opacity: Number(e.target.value) })}
                        className="flex-1 accent-blue-500"
                      />
                      <span className="text-xs w-8 text-left font-mono">{Math.round((selectedRegion.opacity ?? 1) * 100)}%</span>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div className="space-y-1.5 flex flex-col justify-end">
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer mb-2">
                      <input 
                        type="checkbox" 
                        checked={!!selectedRegion.autoFitText} 
                        onChange={(e) => updateRegion(selectedRegion.id, { autoFitText: e.target.checked })}
                        className="rounded border-[#444] bg-black accent-blue-500"
                      />
                      Auto-fit Text
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-400">Shadow Color</label>
                      <input
                        type="color"
                        value={selectedRegion.shadowColor === 'transparent' ? '#000000' : (selectedRegion.shadowColor || '#000000')}
                        onChange={(e) => updateRegion(selectedRegion.id, { shadowColor: e.target.value })}
                        className="w-6 h-6 rounded shrink-0 bg-transparent border-0 p-0 cursor-pointer"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-400">Shadow Blur ({selectedRegion.shadowBlur || 0})</label>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      value={selectedRegion.shadowBlur || 0}
                      onChange={(e) => updateRegion(selectedRegion.id, { shadowBlur: Number(e.target.value) })}
                      className="w-full accent-blue-500"
                    />
                  </div>
                </div>

                {/* Dimensions and Coordinates manual inputs in Arabic/English */}
                <div className="space-y-2 border-t border-[#333] pt-4 mt-2">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Coordinates and Dimensions</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500">X (horizontal position)</label>
                      <input 
                        type="number"
                        value={Math.round(selectedRegion.x)}
                        onChange={(e) => updateRegion(selectedRegion.id, { x: Number(e.target.value) })}
                        className="w-full bg-black border border-[#444] rounded-md p-1.5 text-xs text-white outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500">Y (vertical position)</label>
                      <input 
                        type="number"
                        value={Math.round(selectedRegion.y)}
                        onChange={(e) => updateRegion(selectedRegion.id, { y: Number(e.target.value) })}
                        className="w-full bg-black border border-[#444] rounded-md p-1.5 text-xs text-white outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500">Width</label>
                      <input 
                        type="number"
                        value={Math.round(selectedRegion.width)}
                        onChange={(e) => updateRegion(selectedRegion.id, { width: Number(e.target.value) })}
                        className="w-full bg-black border border-[#444] rounded-md p-1.5 text-xs text-white outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500">Height</label>
                      <input 
                        type="number"
                        value={Math.round(selectedRegion.height)}
                        onChange={(e) => updateRegion(selectedRegion.id, { height: Number(e.target.value) })}
                        className="w-full bg-black border border-[#444] rounded-md p-1.5 text-xs text-white outline-none"
                      />
                    </div>
                  </div>
                  <div className="space-y-1 mt-2">
                    <label className="text-[10px] text-slate-500">Angle: {selectedRegion.angle || 0}°</label>
                    <input 
                      type="range"
                      min="-180"
                      max="180"
                      value={selectedRegion.angle || 0}
                      onChange={(e) => updateRegion(selectedRegion.id, { angle: Number(e.target.value) })}
                      className="w-full accent-blue-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 mt-2">
                  <label className="text-xs font-medium text-slate-400">Layer Order</label>
                  <div className="flex gap-2">
                    <button 
                      className="flex-1 bg-[#111] hover:bg-[#222] py-1 rounded text-xs text-slate-300 flex items-center justify-center gap-1"
                      onClick={() => {
                        saveHistory(selectedImage.id);
                        const arr = [...selectedImage.regions];
                        const idx = arr.findIndex(r => r.id === selectedRegion.id);
                        if (idx < arr.length - 1) {
                          [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                          updateImage(selectedImage.id, { regions: arr });
                        }
                      }}
                    >
                      <ChevronUp size={14} /> Bring Forward
                    </button>
                    <button 
                      className="flex-1 bg-[#111] hover:bg-[#222] py-1 rounded text-xs text-slate-300 flex items-center justify-center gap-1"
                      onClick={() => {
                        saveHistory(selectedImage.id);
                        const arr = [...selectedImage.regions];
                        const idx = arr.findIndex(r => r.id === selectedRegion.id);
                        if (idx > 0) {
                          [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
                          updateImage(selectedImage.id, { regions: arr });
                        }
                      }}
                    >
                      <ChevronDown size={14} /> Send Backward
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-[#333] space-y-3 mt-4">
                  <div className="flex gap-2">
                    <button 
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs py-2 rounded transition-colors flex items-center justify-center gap-2 font-medium"
                      onClick={() => handleSmartBubbleFill(selectedImage.id, selectedRegion)}
                    >
                      <Wand2 size={14} /> Smart Detect
                    </button>
                    <button 
                      className="bg-blue-900/60 hover:bg-blue-800 text-sky-200 border border-blue-800/50 text-xs py-2 px-3 rounded transition-colors flex items-center justify-center gap-1.5"
                      onClick={handleSplitBubble}
                      title="Geometric split of two merged circular bubbles"
                    >
                      <Scissors size={13} /> Split Bubble
                    </button>
                  </div>

                  {/* Kashida layouts */}
                  <div className="bg-blue-950/10 p-2 text-left rounded-lg border border-blue-900/20 space-y-1.5">
                    <label className="text-[10px] font-semibold text-sky-300 flex items-center justify-between">
                      <span>Line-extension kashida (Kashida)</span>
                      <span>✦</span>
                    </label>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => applyKashidaHarmony('oval')}
                        className="flex-1 bg-blue-950/30 hover:bg-blue-900/55 border border-blue-800/40 text-[9px] py-1 px-1.5 rounded transition-all text-slate-200 font-sans"
                        title="Extend text to fit circular shape at the center"
                      >
                        Circular Kashida (ـ)
                      </button>
                      <button 
                        onClick={() => applyKashidaHarmony('rectangular')}
                        className="flex-1 bg-black hover:bg-[#111] border border-[#333] text-[9px] py-1 px-1.5 rounded transition-all text-slate-400 font-sans"
                      >
                        Normal Rectangle
                      </button>
                    </div>
                  </div>
                   <button 
                     className="w-full bg-[#111] hover:bg-[#222] text-slate-200 text-xs py-2 rounded transition-colors flex items-center justify-center gap-2"
                     onClick={() => {
                       saveHistory(selectedImage.id);
                       updateImage(selectedImage.id, {
                         regions: [...selectedImage.regions, {
                           ...selectedRegion,
                           id: crypto.randomUUID(),
                           y: selectedRegion.y + 40
                         }]
                       });
                     }}
                   >
                     <Plus size={14} /> Duplicate text region
                   </button>
                   <button 
                     className="w-full bg-[#111] hover:bg-[#222] text-slate-200 text-xs py-2 rounded transition-colors flex items-center justify-center gap-2"
                     onClick={() => {
                       saveHistory(selectedImage.id);
                       updateImage(selectedImage.id, {
                         regions: selectedImage.regions.map(r => ({
                           ...r, 
                           fontFamily: selectedRegion.fontFamily,
                           fontSize: selectedRegion.fontSize,
                           fontWeight: selectedRegion.fontWeight,
                           fontStyle: selectedRegion.fontStyle,
                           textColor: selectedRegion.textColor,
                           strokeColor: selectedRegion.strokeColor,
                           strokeWidth: selectedRegion.strokeWidth,
                           textAlign: selectedRegion.textAlign
                         }))
                       });
                     }}
                   >
                     <TypeIcon size={14} /> Apply text styles to this page
                   </button>
                   <button 
                     className="w-full bg-[#111] hover:bg-[#222] text-slate-200 text-xs py-2 rounded transition-colors flex items-center justify-center gap-2"
                     onClick={() => {
                       if (confirm('Apply these font settings to all text regions across ALL pages?')) {
                         setImages(prev => prev.map(img => ({
                           ...img,
                           regions: img.regions.map(r => ({
                             ...r, 
                             fontFamily: selectedRegion.fontFamily,
                             fontSize: selectedRegion.fontSize,
                             fontWeight: selectedRegion.fontWeight,
                             fontStyle: selectedRegion.fontStyle,
                             textColor: selectedRegion.textColor,
                             strokeColor: selectedRegion.strokeColor,
                             strokeWidth: selectedRegion.strokeWidth,
                             textAlign: selectedRegion.textAlign
                           }))
                         })));
                       }
                     }}
                   >
                     <TypeIcon size={14} /> Apply text styles to ALL pages
                   </button>
                </div>
              </div>
            </div>
          ) : activeTool !== 'select' ? (
             <div className="p-5 flex flex-col gap-6">
                <div>
                  <h3 className="font-semibold text-slate-300 mb-4 flex items-center gap-2">
                    Brush Settings
                  </h3>
                  
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-400 flex justify-between">
                        <span>Size</span>
                        <span>{brushSize}px</span>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        className="w-full accent-blue-500"
                      />
                    </div>
                    
                    {activeTool === 'draw' && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-400">Color</label>
                        <div className="flex items-center gap-2">
                           <input
                            type="color"
                            value={brushColor}
                            onChange={(e) => setBrushColor(e.target.value)}
                            className="w-10 h-10 rounded shrink-0 bg-transparent border-0 p-0 cursor-pointer"
                           />
                           <input
                            type="text"
                            value={brushColor}
                            onChange={(e) => setBrushColor(e.target.value)}
                            className="w-full bg-black border border-[#444] rounded-md p-2 text-sm outline-none uppercase"
                           />
                           {('EyeDropper' in window) && (
                             <button
                               onClick={async () => {
                                 try {
                                   const eyeDropper = new (window as any).EyeDropper();
                                   const result = await eyeDropper.open();
                                   setBrushColor(result.sRGBHex);
                                 } catch (e) {}
                               }}
                               className="p-2 bg-[#111] hover:bg-[#222] rounded-md text-slate-300 shrink-0"
                               title="Pick Color from Screen"
                             >
                               <Pipette size={16} />
                             </button>
                           )}
                        </div>
                      </div>
                    )}
                    
                    {activeTool === 'erase' && (
                      <div className="p-3 bg-black rounded border border-[#333] text-xs text-slate-400 text-center">
                        Eraser paints with white color to match manga background.
                      </div>
                    )}
                    <button
                      onClick={() => {
                        saveHistory(selectedImage!.id);
                        updateImage(selectedImage!.id, { paintStrokes: [] });
                      }}
                      className="w-full mt-4 bg-red-950/50 hover:bg-red-900/50 border border-red-900/50 text-red-400 py-2 rounded text-sm transition-colors"
                      disabled={!selectedImage || selectedImage.paintStrokes.length === 0}
                    >
                      Clear All Strokes
                    </button>
                  </div>
                </div>
             </div>
          ) : (
             <div className="p-8 text-center text-slate-500 flex flex-col items-center gap-4">
               {selectedImage && <p className="text-sm">Click on any text or bubble in the editor to modify it, or select a drawing tool from the top toolbar.</p>}
             </div>
          )}
        </aside>
          </>
        )}
      </div>

      {/* Dynamic Purple/Black Liquid Glass Bottom Toolbar */}
      {activeChapterId === null && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <button
            type="button"
            onClick={() => {
              if (activeMangaId) {
                if (activeVolumeId) {
                  handleAddChapterPrompt();
                } else {
                  handleAddVolumePrompt();
                }
              } else {
                setShowCreateSeriesModal(true);
              }
            }}
            className="w-14 h-14 bg-black border-2 border-sky-500 rounded-full flex items-center justify-center shadow-[0_5px_22px_rgba(56, 189, 248,0.55)] cursor-pointer text-white hover:scale-110 active:scale-95 transition-all duration-350"
            title="Create a new project"
          >
            <svg className="w-6 h-6 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <line x1={12} y1={5} x2={12} y2={19} />
              <line x1={5} y1={12} x2={19} y2={12} />
            </svg>
          </button>
        </div>
      )}

      {/* Unified Upload + Review modal (replaces Create Project modal and Manage Pages dropdown) */}
      {showManagePages && (
        <UploadReviewModal
          images={images}
          setImages={setImages}
          fileInputRef={fileInputRef}
          cleanZipInputRef={cleanZipInputRef}
          appendImagesInputRef={appendImagesInputRef}
          zipMatchMode={zipMatchMode}
          setZipMatchMode={setZipMatchMode}
          moveImageUp={moveImageUp}
          moveImageDown={moveImageDown}
          deleteImage={deleteImage}
          onClose={() => setShowManagePages(false)}
        />
      )}

      {showPageTextsModal && (
        <PageTextsModal
          regions={selectedImage?.regions || []}
          onClose={() => setShowPageTextsModal(false)}
          onSelectRegion={(id) => {
            setSelectedRegionId(id);
            if (activeTool !== 'select') setActiveTool('select');
            setShowPageTextsModal(false);
          }}
        />
      )}

      {/* Stunning Create Series Modal */}
      {showCreateSeriesModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in text-left" dir="ltr">
          <div className="liquid-glass p-8 rounded-3xl max-w-lg w-full mx-4 shadow-[0_20px_50px_rgba(56, 189, 248,0.3)] border border-sky-500/25 relative text-slate-200 flex flex-col gap-5">
            <button 
              onClick={() => setShowCreateSeriesModal(false)}
              className="absolute top-4 left-4 text-slate-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-all text-sm font-bold"
            >
              ✕
            </button>
            
            <div className="flex flex-col gap-1.5 text-left border-b border-sky-500/10 pb-4">
              <h2 className="text-2xl font-display font-bold text-white flex items-center gap-2 justify-start">
                <span className="text-sky-400">✧</span> Add a New Series to Your Library
              </h2>
              <p className="text-xs text-slate-400">
                Create a new manga/manhwa work or series to organize and track its volumes and translation chapters.
              </p>
            </div>

            <div className="space-y-4 text-left">
              {/* Cover Upload / URL Preview inline */}
              <div className="space-y-1.5 text-start">
                <label className="text-xs font-semibold text-sky-300 block text-left">Series Cover Image (PNG or JPG):</label>
                <div className="flex items-center gap-4 flex-row-reverse">
                  <div className="w-20 h-24 rounded-lg border border-sky-500/10 bg-[#0c061c] overflow-hidden flex items-center justify-center shrink-0">
                    {newSeriesCoverUrl ? (
                      <img src={newSeriesCoverUrl} alt="Cover Preview" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={20} className="text-sky-500/40" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2 w-full text-left">
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={handleCoverUpload}
                      id="series-cover-file"
                      className="hidden"
                    />
                    <label 
                      htmlFor="series-cover-file"
                      className="cursor-pointer bg-blue-950/40 hover:bg-blue-900 border border-sky-500/30 text-sky-300 px-4 py-2 rounded-xl text-xs font-bold text-center transition-all block"
                    >
                      Choose an image from your device
                    </label>
                    <span className="text-[10px] text-slate-500 text-center font-mono block">(Recommended: 4:3 aspect ratio)</span>
                  </div>
                </div>
              </div>

              {/* Series Title */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-sky-300 block text-left">Series Title:</label>
                <input 
                  type="text"
                  placeholder="e.g.: My Manga Series..."
                  value={newSeriesTitle}
                  onChange={(e) => setNewSeriesTitle(e.target.value)}
                  className="w-full bg-black/60 border border-sky-500/20 hover:border-sky-500/40 focus:border-sky-400 rounded-xl p-3 text-sm text-white outline-none font-sans text-left"
                />
              </div>

              {/* Series Type */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-sky-300 block text-left">Type (Classification):</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setNewSeriesType('manga')}
                    className={`p-3 rounded-xl border text-xs font-bold transition-all text-center ${newSeriesType === 'manga' ? 'bg-amber-600/35 border-amber-500 text-amber-200' : 'bg-[#080512]/60 border-sky-500/10 text-slate-404'}`}
                  >
                    Manga (black &amp; white)
                  </button>
                  <button
                    onClick={() => setNewSeriesType('manhwa')}
                    className={`p-3 rounded-xl border text-xs font-bold transition-all text-center ${newSeriesType === 'manhwa' ? 'bg-blue-600/35 border-blue-500 text-blue-200' : 'bg-[#080512]/60 border-[#555]/10 text-slate-405'}`}
                  >
                    Manhwa (colored)
                  </button>
                </div>
              </div>

              {/* Series Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-sky-300 block text-left">Brief Description or Summary:</label>
                <textarea 
                  rows={3}
                  placeholder="Write a brief description of the manga's story or translator details..."
                  value={newSeriesDesc}
                  onChange={(e) => setNewSeriesDesc(e.target.value)}
                  className="w-full bg-black/60 border border-sky-500/20 hover:border-sky-500/40 focus:border-sky-400 rounded-xl p-3 text-sm text-white outline-none resize-none font-sans text-left"
                />
              </div>
            </div>

            <div className="border-t border-sky-500/10 pt-4 flex justify-end gap-3 mt-2">
              <button
                onClick={() => setShowCreateSeriesModal(false)}
                className="bg-black/60 hover:bg-black border border-sky-500/15 hover:border-sky-500/30 text-slate-350 font-bold py-2.5 px-6 rounded-xl text-xs transition-all cursor-pointer"
              >
                Cancel (Cancel)
              </button>
              <button
                onClick={handleCreateSeries}
                className="bg-gradient-to-r from-blue-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold py-2.5 px-7 rounded-xl text-xs transition-all shadow-lg shadow-blue-950/45 cursor-pointer"
              >
                ✓ Create and Add Series
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stunning External AI Prompt & Paste Modal */}
      {showExternalAIModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 backdrop-blur-md animate-fade-in text-left" dir="ltr">
          <div className="liquid-glass p-8 rounded-3xl max-w-2xl w-full mx-4 shadow-[0_20px_50px_rgba(56, 189, 248,0.35)] border border-sky-500/25 relative text-slate-200 flex flex-col gap-6 max-h-[90vh] overflow-y-auto">
            <button 
              onClick={() => setShowExternalAIModal(false)}
              className="absolute top-4 left-4 text-slate-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-all text-sm font-bold"
            >
              ✕
            </button>
            
            <div className="flex flex-col gap-1.5 text-left border-b border-sky-500/10 pb-4">
              <h2 className="text-2xl font-display font-bold text-white flex items-center gap-2 justify-start">
                <span className="text-sky-400">✧</span> Translation Wizard via External AI Assistant
              </h2>
              <p className="text-xs text-slate-400">
                If you don't have your own API keys inside the app, you can provide any external AI model (such as Claude 3.5 Sonnet or Gemini 1.5 Pro) with the page image and the detailed prompt below, so it can return the translation file for you to apply instantly!
              </p>
            </div>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="space-y-2 border border-sky-500/10 p-4 rounded-2xl bg-blue-950/5">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center">1</span>
                  Step One: Copy the Request Bundle (AI Request Cocktail)
                </h3>
                <p className="text-xs text-slate-400">
                  Copy the ready detailed prompt and send it to the external AI along with the currently open page image, for AI cleaning:
                </p>
                <div className="relative">
                  <textarea
                    readOnly
                    value={`You are a professional manga & manhwa typesetting and translation assistant. We need you to segment the speech bubbles of the attached page image and translate them into natural, high-quality, typeset Arabic.
Please locate speech balloons and output exactly in this JSON format ONLY (No other conversation or thoughts):
[
  {
    "xmin": 150,
    "ymin": 250,
    "xmax": 320,
    "ymax": 380,
    "type": "bubble",
    "originalText": "Original English balloon text",
    "translatedText": "the alternate translated text, centered"
  }
]`}
                    className="w-full h-28 bg-black/60 border border-[#444] rounded-xl p-3 text-xs text-slate-350 font-mono resize-none text-left"
                    dir="ltr"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`You are a professional manga & manhwa typesetting and translation assistant. We need you to segment the speech bubbles of the attached page image and translate them into natural, high-quality, typeset Arabic.
Please locate speech balloons and output exactly in this JSON format ONLY (No other conversation or thoughts):
[
  {
    "xmin": 150,
    "ymin": 250,
    "xmax": 320,
    "ymax": 380,
    "type": "bubble",
    "originalText": "Original English balloon text",
    "translatedText": "the alternate translated text, centered"
  }
]`);
                      Swal.fire({
                        icon: 'success',
                        title: 'Cocktail prompt copied!',
                        text: 'You can now paste it and provide it to Claude or Gemini externally.',
                        timer: 1500,
                        showConfirmButton: false,
                        background: '#090615',
                        color: '#ffffff'
                      });
                    }}
                    className="absolute bottom-3 left-3 bg-blue-600 hover:bg-sky-500 text-white text-[10px] font-bold py-1.5 px-3 rounded-lg transition-all"
                  >
                    Copy Request (Copy)
                  </button>
                </div>
              </div>

              {/* Step 2 */}
              <div className="space-y-2 border border-sky-500/10 p-4 rounded-2xl bg-blue-950/5">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center">2</span>
                  Step Two: Paste the Retrieved Response (Pasted Response JSON)
                </h3>
                <p className="text-xs text-slate-400">
                  Paste the response that the external AI crafted for you, and we'll distribute the translation onto the page coordinates instantly:
                </p>
                <textarea
                  placeholder="[ ... the retrieved JSON array ... ]"
                  value={externalAIPasteData}
                  onChange={(e) => setExternalAIPasteData(e.target.value)}
                  className="w-full h-32 bg-black border border-sky-500/20 focus:border-sky-400 rounded-xl p-3 text-xs text-slate-205 outline-none resize-none font-mono text-left"
                  dir="ltr"
                />
              </div>
            </div>

            <div className="border-t border-sky-500/10 pt-4 flex justify-end gap-3 mt-2">
              <button
                onClick={() => setShowExternalAIModal(false)}
                className="bg-black/60 hover:bg-black border border-sky-500/15 hover:border-sky-500/30 text-slate-350 font-bold py-2.5 px-6 rounded-xl text-xs transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyExternalAICocktail}
                className="bg-gradient-to-r from-blue-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold py-2.5 px-7 rounded-xl text-xs transition-all shadow-lg shadow-blue-950/45 cursor-pointer"
              >
                ✓ Apply Smart Translation to the Page
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
