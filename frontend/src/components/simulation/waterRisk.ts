export type WaterRiskSnapshot = {
  cols: number; rows: number;
  south: number; north: number; west: number; east: number;
  elapsedSeconds: number;
  depth: Float32Array;
  velocityX: Float32Array;
  velocityY: Float32Array;
  inside: Uint8Array;
  knownTerrain: Uint8Array;
};

export const hazardColors = [[37, 99, 235], [6, 182, 212], [234, 88, 12], [220, 38, 38]];

export function hazardColor(score: number): number[] {
  const scaled = Math.max(0, Math.min(1, score)) * 3;
  const stop = Math.min(2, Math.floor(scaled)), mix = scaled - stop;
  return hazardColors[stop].map((value, channel) => Math.round(value * (1 - mix) + hazardColors[stop + 1][channel] * mix));
}

// A display index, not a probability or a pedestrian safety classification.
// Fixed scales preserve comparisons over time: 2 m depth or 2 m²/s depth × speed
// reaches the top of the display. A dry cell can never become a flow hotspot.
export function waterHazard(depth: number, vx: number, vy: number): number {
  if (![depth, vx, vy].every(Number.isFinite)) return NaN;
  if (depth <= 0.02) return 0;
  return Math.min(1, Math.max(depth / 2, depth * Math.hypot(vx, vy) / 2));
}

export function waterRiskPixels(snapshot: WaterRiskSnapshot) {
  const { cols, rows, depth, velocityX, velocityY, inside, knownTerrain } = snapshot;
  const pixels = new Uint8ClampedArray(cols * rows * 4);
  let wetCells = 0, unknownCells = 0;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const cell = row * cols + col;
    if (!inside[cell]) continue;
    const score = waterHazard(depth[cell], velocityX[cell], velocityY[cell]);
    if (!knownTerrain[cell] || !Number.isFinite(score)) { unknownCells++; continue; }
    if (score === 0) continue;
    wetCells++;
    const pixel = ((rows - 1 - row) * cols + col) * 4;
    pixels.set(hazardColor(score), pixel);
    pixels[pixel + 3] = 220;
  }
  return { pixels, wetCells, unknownCells };
}
