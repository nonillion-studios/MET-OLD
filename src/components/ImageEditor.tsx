import React, { useEffect, useRef, useState, useMemo } from 'react';
import Konva from 'konva';
import { Stage, Layer, Image as KonvaImage, Rect, Text, Group, Transformer, Line } from 'react-konva';
import useImage from 'use-image';
import { ProcessedImage, Region, PaintStroke } from '../types';
import { calculateAutoFitFontSize } from '../utils/textUtils';
import { Sparkles, Plus } from 'lucide-react';

interface ImageEditorProps {
  image: ProcessedImage;
  selectedRegionId: string | null;
  onSelectRegion: (id: string | null) => void;
  onUpdateRegion: (id: string, updates: Partial<Region>) => void;
  stageRef: React.RefObject<any>;
  activeTool: 'select' | 'draw' | 'erase' | 'fill_poly' | 'bg_erase' | 'smart_sfx' | 'gen_erase' | 'crop' | 'scribble_bubble';
  brushSize: number;
  brushColor: string;
  zoom: number;
  showOriginal?: boolean;
  showText?: boolean;
  onAddStroke: (stroke: PaintStroke) => void;
  onGenerateInpaint?: (base64: string) => Promise<string>;
  bubblePreviews?: any[];
  showBubblePreviews?: boolean;
  manhwaMode?: boolean;
  onProcessCropSection?: (rect: { x: number, y: number, w: number, h: number }) => void;
  onQueueCropSection?: (rect: { x: number, y: number, w: number, h: number }) => void;
  onScribbleBubble?: (x: number, y: number) => void;
}

const AIInpaintPatch = ({ base64, rect }: { base64: string, rect: {x: number, y: number, w: number, h: number} }) => {
  const [img] = useImage(base64);
  if (!img || !rect) return null;
  return <KonvaImage image={img} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />;
};

const AutoFitText = ({ region }: { region: Region }) => {
  const fontStyleStr = `${region.fontStyle === 'normal' ? '' : region.fontStyle} ${region.fontWeight === 'normal' ? '' : region.fontWeight}`.trim() || 'normal';

  const fontSize = useMemo(() => {
    if (!region.autoFitText) {
      return region.fontSize;
    }
    return calculateAutoFitFontSize(
      region.translatedText || '',
      region.width,
      region.height,
      region.fontFamily,
      fontStyleStr,
      region.lineHeight || 1.2,
      region.letterSpacing || 0,
      region.fontSize
    );
  }, [
    region.translatedText,
    region.width,
    region.height,
    region.fontSize,
    region.fontFamily,
    region.autoFitText,
    region.lineHeight,
    fontStyleStr,
    region.letterSpacing
  ]);

  return (
    <Text
      text={region.translatedText ? region.translatedText.split('\n').map(line => '\u202B' + line + '\u200F').join('\n') : ''}
      width={region.width}
      height={region.height}
      fill={region.textColor}
      stroke={region.strokeColor !== 'transparent' ? region.strokeColor : undefined}
      strokeWidth={region.strokeColor !== 'transparent' ? region.strokeWidth : 0}
      fontFamily={region.fontFamily}
      fontSize={fontSize}
      fontStyle={fontStyleStr}
      align={region.textAlign}
      verticalAlign="middle"
      lineHeight={region.lineHeight || 1.2}
      letterSpacing={region.letterSpacing || 0}
      wrap="word"
      listening={false}
      fillAfterStrokeEnabled={true}
      shadowColor={region.shadowColor !== 'transparent' && !!region.shadowColor ? region.shadowColor : undefined}
      shadowBlur={region.shadowBlur || 0}
    />
  );
};

export function ImageEditor({ 
  image, 
  selectedRegionId, 
  onSelectRegion, 
  onUpdateRegion, 
  stageRef,
  activeTool,
  brushSize,
  brushColor,
  zoom,
  showOriginal,
  showText = true,
  onAddStroke,
  onGenerateInpaint,
  bubblePreviews = [],
  showBubblePreviews = false,
  manhwaMode = false,
  onProcessCropSection,
  onQueueCropSection,
  onScribbleBubble
}: ImageEditorProps) {
  const bgToUse = showOriginal && image.originalDataUrl ? image.originalDataUrl : image.dataUrl;
  const [img] = useImage(bgToUse);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const trRef = useRef<any>(null);
  const shapeRefs = useRef<{ [key: string]: any }>({});
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<PaintStroke | null>(null);

  // Manhwa Mode Crop states
  const [cropRect, setCropRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
  const [isDrawingCrop, setIsDrawingCrop] = useState(false);

  useEffect(() => {
    if (containerRef.current) {
      const resize = () => {
        if (containerRef.current) {
          setSize({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight
          });
        }
      };
      
      resize();
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }
  }, []);

  useEffect(() => {
    if (selectedRegionId && shapeRefs.current[selectedRegionId]) {
      trRef.current?.nodes([shapeRefs.current[selectedRegionId]]);
      trRef.current?.getLayer()?.batchDraw();
    } else {
      trRef.current?.nodes([]);
    }
  }, [selectedRegionId, activeTool]);

  const baseScale = img 
    ? (manhwaMode ? (size.width - 16) / image.width : Math.min((size.width - 40) / image.width, (size.height - 40) / image.height))
    : 1;
  const scale = baseScale * zoom;

  const stageWidth = img ? image.width * scale : size.width;
  const stageHeight = img ? image.height * scale : size.height;

  const getPixelColor = (x: number, y: number) => {
    if (!img) return '#ffffff';
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '#ffffff';
    ctx.drawImage(img, -x, -y);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  const handleMouseDown = (e: any) => {
    if (activeTool === 'select') {
      const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'bgImage';
      if (clickedOnEmpty) {
        onSelectRegion(null);
      }
      return;
    }

    const pos = e.target.getStage().getPointerPosition();
    if (!pos) return;
    
    const x = pos.x / scale;
    const y = pos.y / scale;

    if (activeTool === 'crop') {
      setCropRect({ x, y, w: 0, h: 0 });
      setIsDrawingCrop(true);
      return;
    }

    let initialColor = brushColor;
    if (activeTool === 'draw' || activeTool === 'fill_poly') initialColor = brushColor;
    else if (activeTool === 'erase') initialColor = '#ffffff';
    else if (activeTool === 'bg_erase') initialColor = '#000000';
    else if (activeTool === 'gen_erase') initialColor = 'rgba(236, 72, 153, 0.5)'; // Pink translucent for masking
    else if (activeTool === 'scribble_bubble') initialColor = '#38bdf8'; // Sky blue neon for scribble
    else if (activeTool === 'smart_sfx') initialColor = getPixelColor(x, y);

    if (activeTool === 'fill_poly') {
      if (!currentStroke || currentStroke.tool !== 'fill_poly') {
         setIsDrawing(true);
         setCurrentStroke({ tool: 'fill_poly', points: [x, y], color: initialColor, size: 0 });
      } else {
         const newPoints = [...currentStroke.points, x, y];
         if (newPoints.length === 8) {
           onAddStroke({ ...currentStroke, points: newPoints });
           setCurrentStroke(null);
           setIsDrawing(false);
         } else {
           setCurrentStroke({ ...currentStroke, points: newPoints });
         }
      }
      return;
    }

    setIsDrawing(true);
    setCurrentStroke({
      tool: activeTool,
      points: [x, y],
      color: initialColor,
      size: brushSize / scale
    });
  };

  const handleMouseMove = (e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const x = pos.x / scale;
    const y = pos.y / scale;

    if (activeTool === 'crop') {
      if (isDrawingCrop && cropRect) {
        setCropRect(prev => prev ? {
          ...prev,
          w: x - prev.x,
          h: y - prev.y
        } : null);
      }
      return;
    }

    if (!isDrawing || !currentStroke) return;
    if (activeTool === 'fill_poly') return; 

    setCurrentStroke({
      ...currentStroke,
      points: currentStroke.points.concat([x, y])
    });
  };

  const [isGenerating, setIsGenerating] = useState(false);

  const handleMouseUp = async () => {
    if (activeTool === 'crop') {
      if (isDrawingCrop && cropRect) {
        setIsDrawingCrop(false);
        const normalized = {
          x: cropRect.w < 0 ? cropRect.x + cropRect.w : cropRect.x,
          y: cropRect.h < 0 ? cropRect.y + cropRect.h : cropRect.y,
          w: Math.abs(cropRect.w),
          h: Math.abs(cropRect.h)
        };
        if (normalized.w > 10 && normalized.h > 10) {
          setCropRect(normalized);
        } else {
          setCropRect(null);
        }
      }
      return;
    }

    if (activeTool === 'fill_poly') return; 
    if (isDrawing && currentStroke) {
      setIsDrawing(false);
      let finalStroke = { ...currentStroke };

      if (activeTool === 'gen_erase' && img && finalStroke.points.length >= 4 && onGenerateInpaint) {
        setIsGenerating(true);
        try {
          // Calculate bounding box of the stroke
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let i = 0; i < finalStroke.points.length; i += 2) {
            minX = Math.min(minX, finalStroke.points[i]);
            maxX = Math.max(maxX, finalStroke.points[i]);
            minY = Math.min(minY, finalStroke.points[i+1]);
            maxY = Math.max(maxY, finalStroke.points[i+1]);
          }
          
          // Pad to get context and make it a square (better for GenAI)
          const pad = (finalStroke.size / 2) + 20;
          minX = Math.max(0, minX - pad);
          maxX = Math.min(img.width - 1, maxX + pad);
          minY = Math.max(0, minY - pad);
          maxY = Math.min(img.height - 1, maxY + pad);

          const w = maxX - minX;
          const h = maxY - minY;
          const size = Math.max(w, h); // Square dimensions
          
          // Center the square
          const centerX = minX + w / 2;
          const centerY = minY + h / 2;
          const sMinX = Math.max(0, centerX - size / 2);
          const sMinY = Math.max(0, centerY - size / 2);
          const sMaxX = Math.min(img.width - 1, centerX + size / 2);
          const sMaxY = Math.min(img.height - 1, centerY + size / 2);
          
          const sW = sMaxX - sMinX;
          const sH = sMaxY - sMinY;

          if (sW > 0 && sH > 0) {
            const canvas = document.createElement('canvas');
            canvas.width = sW; canvas.height = sH;
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
              ctx.drawImage(img, sMinX, sMinY, sW, sH, 0, 0, sW, sH);
              const dataUrl = canvas.toDataURL('image/jpeg', 1.0);
              const base64Crop = dataUrl.split(',')[1];
              
              const generatedBase64 = await onGenerateInpaint(base64Crop);
              
              finalStroke.imageBase64 = generatedBase64;
              finalStroke.rect = { x: sMinX, y: sMinY, w: sW, h: sH };
            }
          }
        } catch (error) {
          console.error("Generative inpaint failed", error);
          alert("Failed to run AI Inpainting. " + (error as Error).message);
        } finally {
          setIsGenerating(false);
        }
      }

      if (activeTool === 'scribble_bubble') {
        if (finalStroke.points.length >= 2 && onScribbleBubble) {
          let sumX = 0, sumY = 0, count = 0;
          for (let i = 0; i < finalStroke.points.length; i += 2) {
            sumX += finalStroke.points[i];
            sumY += finalStroke.points[i+1];
            count++;
          }
          const seedX = sumX / count;
          const seedY = sumY / count;
          onScribbleBubble(seedX, seedY);
        }
        setCurrentStroke(null);
        return;
      }

      onAddStroke(finalStroke);
      setCurrentStroke(null);
    }
  };

  const allStrokes = useMemo(() => image.paintStrokes.concat(currentStroke ? [currentStroke] : []), [image.paintStrokes, currentStroke]);
  
  // If the image is a cleaned zip image (has originalDataUrl) and we are not showing the original,
  // we should hide all strokes since the image is already clean and user only wants text.
  const strokesToRender = useMemo(() => {
    if (image.originalDataUrl && !showOriginal) {
      return [];
    }
    return allStrokes;
  }, [allStrokes, image.originalDataUrl, showOriginal]);

  const normalStrokes = strokesToRender.filter(s => s.tool !== 'bg_erase');
  const bgEraseStrokes = strokesToRender.filter(s => s.tool === 'bg_erase');

  return (
    <div 
      ref={containerRef} 
      className={`w-full h-full bg-slate-900 rounded-lg overflow-auto relative ${activeTool !== 'select' ? 'cursor-crosshair' : 'cursor-default'}`}
    >
      <div 
        style={{ 
          width: Math.max(size.width, stageWidth), 
          height: Math.max(size.height, stageHeight),
          position: 'relative'
        }}
      >
        {isGenerating && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-lg" style={{ width: stageWidth, height: stageHeight, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <div className="flex flex-col items-center gap-3 text-white">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="font-medium text-sm">AI Inpainting in progress...</p>
            </div>
          </div>
        )}
        <div 
          style={{ 
            position: 'absolute', 
            left: '50%', top: '50%', 
            transform: 'translate(-50%, -50%)', 
            width: stageWidth, height: stageHeight 
          }}
        >
          <Stage
            width={stageWidth}
            height={stageHeight}
            scaleX={scale}
            scaleY={scale}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            ref={stageRef}
          >
            {/* Layer 1: Image & normal paint strokes */}
            <Layer>
              {img && (
                <KonvaImage
                  image={img}
                  name="bgImage"
                />
              )}

              {!showOriginal && normalStrokes.map((stroke, i) => (
                stroke.imageBase64 && stroke.rect ? (
                  <AIInpaintPatch key={i} base64={stroke.imageBase64} rect={stroke.rect} />
                ) : (
                  <Line
                    key={i}
                    points={stroke.points}
                    stroke={stroke.tool === 'fill_poly' ? (stroke.points.length === 8 ? 'transparent' : stroke.color) : stroke.color}
                    strokeWidth={stroke.tool === 'fill_poly' ? Math.max(1, stroke.size) : stroke.size}
                    fill={stroke.tool === 'fill_poly' ? stroke.color : undefined}
                    closed={stroke.tool === 'fill_poly'}
                    tension={stroke.tool === 'fill_poly' ? 0 : 0.5}
                    lineCap="round"
                    lineJoin="round"
                  />
                )
              ))}
            </Layer>

            {/* Layer 2: Region Backgrounds & bg_erase strokes (with destination-out hole punching) */}
            {!showOriginal && (
              <Layer>
                {image.regions.map((region) => {
                  if (region.bgColor === 'transparent') return null;

                  const contour = (region as any).bubbleContour;
                  if (region.type === 'bubble' && contour && contour.length > 0) {
                    const isSelected = region.id === selectedRegionId;
                    return (
                      <Line
                        key={region.id}
                        points={contour}
                        closed={true}
                        fill={isSelected ? 'rgba(59, 130, 246, 0.4)' : region.bgColor}
                        stroke={isSelected ? '#3b82f6' : region.bgColor}
                        strokeWidth={isSelected ? 3.0 : 1.5}
                        lineJoin="round"
                        lineCap="round"
                        opacity={region.opacity ?? 1}
                      />
                    );
                  }

                  return (
                    <Group
                      key={region.id}
                      x={region.x + region.width / 2}
                      y={region.y + region.height / 2}
                      rotation={region.angle}
                      offset={{ x: region.width / 2, y: region.height / 2 }}
                      opacity={region.opacity ?? 1}
                    >
                      <Rect
                        width={region.width}
                        height={region.height}
                        fill={region.bgColor}
                        cornerRadius={region.type === 'bubble' ? 10 : 0}
                      />
                    </Group>
                  );
                })}
                
                {/* Apply destination-out to punching holes exactly into the solid backgrounds above */}
                {bgEraseStrokes.map((stroke, i) => (
                  <Line
                    key={i}
                    points={stroke.points}
                    stroke="black"
                    strokeWidth={stroke.size}
                    globalCompositeOperation="destination-out"
                    tension={0.5}
                    lineCap="round"
                    lineJoin="round"
                  />
                ))}
              </Layer>
            )}

            {/* Layer 3: Texts and Transformer */}
            {!showOriginal && showText && (
              <Layer>
                {image.regions.map((region) => (
                  <Group
                    key={region.id}
                    name={region.id}
                    x={region.x}
                    y={region.y}
                    width={region.width}
                    height={region.height}
                    rotation={region.angle}
                    opacity={region.opacity ?? 1}
                    draggable={activeTool === 'select'}
                    onClick={() => activeTool === 'select' && onSelectRegion(region.id)}
                    onTap={() => activeTool === 'select' && onSelectRegion(region.id)}
                    ref={(node) => {
                      if (node) shapeRefs.current[region.id] = node;
                    }}
                    onDragMove={(e) => {
                      if (activeTool !== 'select') return;
                      onUpdateRegion(region.id, {
                        x: e.target.x(),
                        y: e.target.y()
                      });
                    }}
                    onDragEnd={(e) => {
                      if (activeTool !== 'select') return;
                      onUpdateRegion(region.id, {
                        x: e.target.x(),
                        y: e.target.y()
                      });
                    }}
                    onTransformEnd={(e) => {
                      if (activeTool !== 'select') return;
                      const node = shapeRefs.current[region.id];
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();
                      
                      node.scaleX(1);
                      node.scaleY(1);

                      onUpdateRegion(region.id, {
                        x: node.x(),
                        y: node.y(),
                        width: Math.max(5, node.width() * scaleX),
                        height: Math.max(5, node.height() * scaleY),
                        angle: node.rotation()
                      });
                    }}
                  >
                    <Rect width={region.width} height={region.height} fill="transparent" />
                    <AutoFitText region={region} />
                  </Group>
                ))}
                
                {showBubblePreviews && bubblePreviews.map((preview, idx) => {
                  const labelX = preview.safeTextBounds.x;
                  const labelY = Math.max(10, preview.safeTextBounds.y - 18);
                  
                  return (
                    <Group key={`preview-grp-${idx}`}>
                      {/* Fully colored polygon utilizing the flood filled contour line points */}
                      {preview.contour && preview.contour.length > 0 && (
                        <Line
                          points={preview.contour}
                          closed={true}
                          fill="rgba(59, 130, 246, 0.38)"
                          stroke="#2563eb"
                          strokeWidth={2.5}
                          lineJoin="round"
                          lineCap="round"
                          opacity={0.95}
                        />
                      )}
                      
                      {/* Safe Inscribed boundaries (for centering text intelligently) */}
                      <Rect
                        x={preview.safeTextBounds.x}
                        y={preview.safeTextBounds.y}
                        width={preview.safeTextBounds.width}
                        height={preview.safeTextBounds.height}
                        stroke="#10b981"
                        strokeWidth={1.5}
                        dash={[3, 3]}
                        opacity={0.85}
                      />
                      
                      {/* Interactive Label badge centered inside the detected bubble shape */}
                      <Rect
                        x={labelX}
                        y={labelY}
                        width={82}
                        height={16}
                        fill="#2563eb"
                        cornerRadius={3}
                        shadowBlur={2}
                        shadowColor="black"
                        shadowOpacity={0.2}
                      />
                      <Text
                        x={labelX + 6}
                        y={labelY + 2}
                        text="Smart Bubble Bound"
                        fontFamily="Cairo"
                        fontSize={8.5}
                        fontWeight="bold"
                        fill="#ffffff"
                      />
                    </Group>
                  );
                })}
                
                {selectedRegionId && activeTool === 'select' && (
                  <Transformer
                    ref={trRef}
                    boundBoxFunc={(oldBox, newBox) => {
                      if (newBox.width < 10 || newBox.height < 10) return oldBox;
                      return newBox;
                    }}
                  />
                )}
              </Layer>
            )}

            {/* Layer 4: Crop Selection Overlay */}
            {activeTool === 'crop' && cropRect && (
              <Layer>
                <Rect
                  x={cropRect.w < 0 ? cropRect.x + cropRect.w : cropRect.x}
                  y={cropRect.h < 0 ? cropRect.y + cropRect.h : cropRect.y}
                  width={Math.abs(cropRect.w)}
                  height={Math.abs(cropRect.h)}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dash={[4, 4]}
                  fill="rgba(59, 130, 246, 0.15)"
                />
              </Layer>
            )}
          </Stage>

          {/* Floating HTML div for AI Crop actions */}
          {activeTool === 'crop' && cropRect && !isDrawingCrop && (
            <div 
              style={{ 
                position: 'absolute', 
                left: '0px', 
                top: '0px', 
                width: stageWidth, 
                height: stageHeight,
                pointerEvents: 'none'
              }}
            >
              <div 
                style={{ 
                  position: 'absolute',
                  left: `${(cropRect.x + cropRect.w/2) * scale}px`,
                  top: `${(cropRect.y + (cropRect.h < 0 ? 0 : cropRect.h)) * scale + 15}px`,
                  transform: 'translateX(-50%)',
                  pointerEvents: 'auto'
                }}
                className="flex items-center gap-2 bg-[#14141d]/95 backdrop-blur-md p-2 border border-slate-700/60 rounded-xl shadow-2xl z-[90] animate-fade-in whitespace-nowrap"
              >
                <button
                  onClick={() => {
                    if (onQueueCropSection) {
                      onQueueCropSection(cropRect);
                    }
                    setCropRect(null);
                  }}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded font-bold transition-all active:scale-95 shadow-md cursor-pointer"
                >
                  <Plus size={12} className="text-emerald-200" /> Add to Batch Queue
                </button>
                <div className="w-px bg-slate-800 h-5"></div>
                <button
                  onClick={() => {
                    if (onProcessCropSection) {
                      onProcessCropSection(cropRect);
                    }
                    setCropRect(null);
                  }}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded font-bold transition-all active:scale-95 shadow-md cursor-pointer"
                >
                  <Sparkles size={12} className="text-indigo-200 animate-pulse" /> Direct Translate
                </button>
                <div className="w-px bg-slate-800 h-5"></div>
                <button
                  onClick={() => setCropRect(null)}
                  className="text-slate-400 hover:text-white text-xs px-2.5 py-1.5 rounded transition-all font-medium cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
