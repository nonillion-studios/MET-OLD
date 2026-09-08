export function floodFillBubble(
  imageData: ImageData,
  startX: number,
  startY: number,
  regionWidth?: number,
  regionHeight?: number
): { x: number; y: number; width: number; height: number } | null {
  const result = floodFillBubbleDetailed(imageData, startX, startY, regionWidth, regionHeight);
  if (!result) return null;
  return {
    x: result.x,
    y: result.y,
    width: result.width,
    height: result.height,
  };
}

export interface DetailedBubbleResult {
  x: number;
  y: number;
  width: number;
  height: number;
  contour: number[]; // flat array of coordinates [x1, y1, x2, y2, ...]
  safeTextBounds: { x: number; y: number; width: number; height: number };
}

// Moore-Neighbor tracing function to extract pixel-perfect boundary of a visited mask
function traceContour(visited: Uint8Array, width: number, height: number, startX: number, startY: number): number[] {
  // Find leftmost visited pixel in the connected component to start boundary search safely
  let bx = startX;
  let by = startY;
  while (bx > 0 && visited[by * width + (bx - 1)] === 1) {
    bx--;
  }

  const contourPoints: number[] = [];
  let cx = bx;
  let cy = by;
  let dir = 6; // Start searching with direction pointing left (6)

  // 8 directions clockwise (0=up, 1=up-right, 2=right, 3=down-right, 4=down, 5=down-left, 6=left, 7=up-left)
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

  let startCx = cx;
  let startCy = cy;
  let firstStep = true;
  let maxSteps = Math.max(1000, width * height * 0.1); // Guard limit
  let steps = 0;

  while (steps < maxSteps) {
    if (!firstStep && cx === startCx && cy === startCy) {
      break;
    }
    firstStep = false;
    contourPoints.push(cx, cy);

    let foundNext = false;
    // Walk counter-clockwise/clockwise around Moore neighborhood
    let searchDir = (dir + 5) % 8; // backtrack direction
    for (let k = 0; k < 8; k++) {
      const d = (searchDir + k) % 8;
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (visited[ny * width + nx] === 1) {
          cx = nx;
          cy = ny;
          dir = d;
          foundNext = true;
          break;
        }
      }
    }
    if (!foundNext) {
      break;
    }
    steps++;
  }

  // If the contour has enough points, we can downsample slightly to simplify Konva Line rendering
  if (contourPoints.length > 200) {
    const downsampled: number[] = [];
    const factor = Math.max(1, Math.floor(contourPoints.length / 150)); // target around 150 points max for high fluid speed
    for (let i = 0; i < contourPoints.length; i += 2 * factor) {
      const idx = Math.floor(i / 2) * 2;
      if (idx + 1 < contourPoints.length) {
        downsampled.push(contourPoints[idx], contourPoints[idx + 1]);
      }
    }
    return downsampled;
  }

  return contourPoints;
}

export function floodFillBubbleDetailed(
  imageData: ImageData,
  startX: number,
  startY: number,
  regionWidth?: number,
  regionHeight?: number
): DetailedBubbleResult | null {
  const { width, height, data } = imageData;
  
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return null;
  }

  // Lenient, robust speech-bubble background detection
  const isLight = (idx: number) => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (a < 64) return true; // Treats transparent background regions elegantly as bubbles
    
    // Luminance calculation
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return (lum > 175); // More lenient to capture whole bubble area perfectly
  };

  let startIdx = (startY * width + startX) * 4;
  if (!isLight(startIdx)) {
    // Attempt searching neighbors in case the point is on black text remnants
    let found = false;
    for (let r = 1; r < 35; r++) {
       for (let i = -r; i <= r; i += Math.max(1, Math.floor(r / 2))) {
         for (let j = -r; j <= r; j += Math.max(1, Math.floor(r / 2))) {
           const nx = startX + i;
           const ny = startY + j;
           if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
             startIdx = (ny * width + nx) * 4;
             if (isLight(startIdx)) {
               startX = nx;
               startY = ny;
               found = true;
               break;
             }
           }
         }
         if (found) break;
       }
       if (found) break;
    }
    if (!found) return null; // failed to find bubble white canvas
  }

  const visited = new Uint8Array(width * height);
  // Tracks only pixels confirmed to be inside the bubble's light interior (unlike `visited`,
  // which also marks the dark boundary ring touching the fill so it isn't re-queued). The
  // safe-bounds distance walk below must use this, not `visited`, or it treats the border
  // itself as "inside" and can walk straight through it into whatever lies beyond the bubble.
  const interior = new Uint8Array(width * height);
  const queue: [number, number][] = [[startX, startY]];
  visited[startY * width + startX] = 1;
  interior[startY * width + startX] = 1;

  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;

  const bubblePoints: [number, number][] = [];
  bubblePoints.push([startX, startY]);

  // Expand search limits slightly to let flood fill fully explore bubbles
  const maxExtentX = regionWidth ? Math.max(160, Math.round(regionWidth * 2.2)) : 300;
  const maxExtentY = regionHeight ? Math.max(160, Math.round(regionHeight * 2.2)) : 300;

  let iterations = 0;
  const maxIterations = 35000; // Fast BFS safety limit

  while (queue.length > 0 && iterations < maxIterations) {
    const [cx, cy] = queue.shift()!;
    iterations++;

    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;

    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      
      // Keep inside bounds so we don't accidentally leak to unrelated panels
      if (Math.abs(nx - startX) > maxExtentX || Math.abs(ny - startY) > maxExtentY) {
        continue;
      }

      const idx1D = ny * width + nx;
      if (visited[idx1D]) continue;
      
      const pxIdx = idx1D * 4;
      if (isLight(pxIdx)) {
        visited[idx1D] = 1;
        interior[idx1D] = 1;
        queue.push([nx, ny]);
        bubblePoints.push([nx, ny]);
      } else {
        visited[idx1D] = 1; // register boundary, mark visited
      }
    }
  }

  if (bubblePoints.length < 15) return null;

  // Extract extremely precise Moore-Neighbor outer contour
  const contourPoints = traceContour(visited, width, height, startX, startY);

  // Compute precise center of mass to align the text beautifully
  let sumX = 0;
  let sumY = 0;
  for (const [px, py] of bubblePoints) {
    sumX += px;
    sumY += py;
  }
  const centerX = sumX / bubblePoints.length;
  const centerY = sumY / bubblePoints.length;

  // Calculate maximum distance to safe bounding box edges to fit text accurately
  let distLeft = 0;
  while (centerX - distLeft >= 0 && interior[Math.round(centerY) * width + Math.round(centerX - distLeft)] === 1 && distLeft < maxExtentX) {
    distLeft++;
  }
  let distRight = 0;
  while (centerX + distRight < width && interior[Math.round(centerY) * width + Math.round(centerX + distRight)] === 1 && distRight < maxExtentX) {
    distRight++;
  }
  let distUp = 0;
  while (centerY - distUp >= 0 && interior[Math.round(centerY - distUp) * width + Math.round(centerX)] === 1 && distUp < maxExtentY) {
    distUp++;
  }
  let distDown = 0;
  while (centerY + distDown < height && interior[Math.round(centerY + distDown) * width + Math.round(centerX)] === 1 && distDown < maxExtentY) {
    distDown++;
  }

  // Margin coefficient (approximately 71%)
  const marginScale = 0.71; 
  let safeW = (distLeft + distRight) * marginScale;
  let safeH = (distUp + distDown) * marginScale;

  // Calculate centered position safely within the organic mass coordinates
  const safeX = centerX - safeW / 2;
  const safeY = centerY - safeH / 2;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    contour: contourPoints,
    safeTextBounds: {
      x: safeX,
      y: safeY,
      width: safeW,
      height: safeH
    }
  };
}
