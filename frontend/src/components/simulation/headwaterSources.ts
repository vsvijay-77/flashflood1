/** Select uphill entry points, never the complete river network.
 * The upper 35% of mapped-channel elevation range represents the catchment
 * headwaters. Equal-height plateaus contribute one entry, at a downhill edge.
 * This is a scenario boundary condition, not an observed discharge dataset.
 */
export function selectHeadwaterSources(cols: number, rows: number, bed: Float32Array, inside: Uint8Array, waterways: Uint8Array) {
  const sources = new Uint8Array(bed.length);
  const visited = new Uint8Array(bed.length);
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < bed.length; i++) if (inside[i] && waterways[i]) {
    low = Math.min(low, bed[i]); high = Math.max(high, bed[i]);
  }
  // No mapped slope means no justified uphill river entry; rain can still run.
  if (!Number.isFinite(low) || high - low < 0.1) return sources;
  const minimumElevation = low + (high - low) * 0.65;
  const queue = new Int32Array(bed.length);
  for (let start = 0; start < bed.length; start++) {
    if (visited[start] || !inside[start] || !waterways[start] || bed[start] < minimumElevation) continue;
    let count = 1, higherWaterway = false, downhillEntry = -1;
    queue[0] = start; visited[start] = 1;
    for (let cursor = 0; cursor < count; cursor++) {
      const cell = queue[cursor], row = Math.floor(cell / cols), col = cell % cols;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if ((!ox && !oy) || col + ox < 0 || col + ox >= cols || row + oy < 0 || row + oy >= rows) continue;
        const neighbour = (row + oy) * cols + col + ox;
        if (!inside[neighbour]) continue;
        if (bed[neighbour] < bed[cell] - 0.01) downhillEntry = cell;
        if (!waterways[neighbour]) continue;
        if (bed[neighbour] > bed[start] + 0.01) higherWaterway = true;
        if (!visited[neighbour] && Math.abs(bed[neighbour] - bed[start]) <= 0.01) {
          visited[neighbour] = 1; queue[count++] = neighbour;
        }
      }
    }
    if (!higherWaterway && downhillEntry >= 0) sources[downhillEntry] = 1;
  }
  return sources;
}
