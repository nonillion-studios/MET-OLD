import React, { useEffect, useRef, useState, useMemo } from 'react';
import Konva from 'konva';
import { Stage, Layer, Image as KonvaImage, Rect, Text, Group, Transformer, Line } from 'react-konva';
import useImage from 'use-image';
import { ProcessedImage, Region, PaintStroke, Tool } from '../types';
import { calculateAutoFitFontSize, measureWrappedTextHeight, wrapRtlLines } from '../utils/textUtils';
import { Loader2 } from 'lucide-react';

interface ImageEditorProps {
  image: ProcessedImage;
  selectedRegionId: string | null;
  onSelectRegion: (id: string | null) => void;
  onUpdateRegion: (id: string, updates: Partial<Region>) => void;
  stageRef: React.RefObject<any>;
  activeTool: Tool;
  brushSize: number;
  brushColor: string;
  zoom: number;
  showOriginal?: boolean;
  onAddStroke: (stroke: PaintStroke) => void;
  previewRegions?: Region[];
  processingStatusLog?: string | null;
}

const AutoFitText = ({ region, pageHeight }: { region: Region; pageHeight: number }) => {
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

  // Ensure the box never clips the text: grow the rendered height (centered on the
  // region's vertical middle, clamped to the page bounds) if the wrapped text at the
  // effective font size doesn't fit within region.height.
  const { renderHeight, yOffset } = useMemo(() => {
    if (!region.translatedText) return { renderHeight: region.height, yOffset: 0 };
    const requiredHeight = measureWrappedTextHeight(
      region.translatedText,
      region.width,
      region.fontFamily,
      fontStyleStr,
      region.lineHeight || 1.2,
      region.letterSpacing || 0,
      fontSize
    );
    if (requiredHeight <= region.height) return { renderHeight: region.height, yOffset: 0 };

    const extra = requiredHeight - region.height;
    let offset = -extra / 2;
    if (region.y + offset < 0) {
      offset = -region.y;
    }
    if (region.y + offset + requiredHeight > pageHeight) {
      offset = Math.min(offset, pageHeight - requiredHeight - region.y);
    }
    return { renderHeight: requiredHeight, yOffset: offset };
  }, [
    region.translatedText,
    region.width,
    region.height,
    region.fontFamily,
    fontStyleStr,
    region.lineHeight,
    region.letterSpacing,
    region.y,
    fontSize,
    pageHeight
  ]);

  return (
    <Text
      text={region.translatedText ? wrapRtlLines(region.translatedText) : ''}
      y={yOffset}
      width={region.width}
      height={renderHeight}
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
  onAddStroke,
  previewRegions,
  processingStatusLog,
}: ImageEditorProps) {
  const bgToUse = showOriginal && image.originalDataUrl ? image.originalDataUrl : image.dataUrl;
  const [img] = useImage(bgToUse);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const trRef = useRef<any>(null);
  const shapeRefs = useRef<{ [key: string]: any }>({});

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<PaintStroke | null>(null);

  // Text measurement (calculateAutoFitFontSize / measureWrappedTextHeight) relies on
  // canvas font metrics, which can still be using fallback-font metrics if a custom
  // Arabic web font is still loading when a region is first rendered - this would
  // under-measure the required box height and cause real clipping once the font swaps
  // in. Force one re-render once all fonts are ready so AutoFitText's memoized
  // measurements recompute against final metrics.
  const [, setFontsReadyTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(() => {
        if (!cancelled) setFontsReadyTick(t => t + 1);
      });
    }
    return () => { cancelled = true; };
  }, []);

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
      const observer = new ResizeObserver(resize);
      observer.observe(containerRef.current);
      window.addEventListener('resize', resize);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', resize);
      };
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

  // Flexible canvas: always fit the image to the container's width and allow
  // vertical scrolling for tall pages (manga or long-strip manhwa alike).
  const baseScale = img ? (size.width - 16) / image.width : 1;
  const scale = baseScale * zoom;

  const stageWidth = img ? image.width * scale : size.width;
  const stageHeight = img ? image.height * scale : size.height;

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

    const initialColor = brushColor;

    setIsDrawing(true);
    setCurrentStroke({
      tool: activeTool,
      points: [x, y],
      color: initialColor,
      size: brushSize / scale
    });
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || !currentStroke) return;

    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const x = pos.x / scale;
    const y = pos.y / scale;

    setCurrentStroke({
      ...currentStroke,
      points: currentStroke.points.concat([x, y])
    });
  };

  const handleMouseUp = () => {
    if (isDrawing && currentStroke) {
      setIsDrawing(false);
      onAddStroke(currentStroke);
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

  return (
    <div
      ref={containerRef}
      className={`w-full h-full min-w-0 flex-1 bg-slate-900 rounded-lg overflow-y-auto overflow-x-hidden relative ${activeTool !== 'select' ? 'cursor-crosshair' : 'cursor-default'}`}
    >
      <div
        style={{
          width: Math.max(size.width, stageWidth),
          minHeight: size.height,
          position: 'relative'
        }}
      >
        <div
          style={{
            position: 'relative',
            width: stageWidth, height: stageHeight,
            margin: '0 auto'
          }}
        >
          {image.status === 'processing' && (
            <div className="absolute inset-0 z-20 backdrop-blur-md bg-sky-950/20 flex flex-col items-center justify-center gap-2 rounded-lg pointer-events-none">
              <Loader2 className="animate-spin text-sky-300" size={32} />
              <span className="text-sky-100 text-sm font-medium">Processing...</span>
              {processingStatusLog && (
                <span className="text-sky-300/80 text-xs">{processingStatusLog}</span>
              )}
            </div>
          )}
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

              {!showOriginal && strokesToRender.map((stroke, i) => (
                <Line
                  key={i}
                  points={stroke.points}
                  stroke={stroke.color}
                  strokeWidth={stroke.size}
                  lineCap="round"
                  lineJoin="round"
                  tension={0.5}
                />
              ))}
            </Layer>

            {/* Layer 2: Region Backgrounds */}
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
              </Layer>
            )}

            {/* Layer 3: Texts and Transformer */}
            {!showOriginal && (
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
                    <AutoFitText region={region} pageHeight={image.height} />
                  </Group>
                ))}

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

            {/* Layer 4: Bubble-fill preview overlay (blue, non-interactive) */}
            {previewRegions && previewRegions.length > 0 && (
              <Layer listening={false}>
                {previewRegions.map((region) => {
                  const contour = (region as any).bubbleContour;
                  if (contour && contour.length > 0) {
                    return (
                      <Line
                        key={`preview-${region.id}`}
                        points={contour}
                        closed={true}
                        stroke="#38bdf8"
                        strokeWidth={2}
                        dash={[6, 4]}
                        fill="rgba(56,189,248,0.12)"
                        lineJoin="round"
                        lineCap="round"
                        listening={false}
                      />
                    );
                  }
                  return (
                    <Rect
                      key={`preview-${region.id}`}
                      x={region.x}
                      y={region.y}
                      width={region.width}
                      height={region.height}
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dash={[6, 4]}
                      fill="rgba(56,189,248,0.12)"
                      listening={false}
                    />
                  );
                })}
              </Layer>
            )}
          </Stage>
        </div>
      </div>
    </div>
  );
}
