/** User-facing pace presets. Starting speed 1× at 2 simulated s/s, 10× fast-forward at 120 simulated s/s. */
export const floodPlaybackSpeeds = [0.5, 1, 2, 3, 5, 10] as const;
const simulatedRates = [0.5, 2, 6, 12, 30, 120] as const;

export function clampFloodPlaybackSpeed(speed: number) {
  return Number.isFinite(speed) ? Math.max(0.5, Math.min(10, speed)) : 1;
}

/** Actual simulated seconds per real second; interpolation supports external controls. */
export function floodPlaybackRate(speed: number) {
  const level = clampFloodPlaybackSpeed(speed);
  for (let i = 1; i < floodPlaybackSpeeds.length; i++) {
    if (level <= floodPlaybackSpeeds[i]) {
      const fraction = (level - floodPlaybackSpeeds[i - 1]) / (floodPlaybackSpeeds[i] - floodPlaybackSpeeds[i - 1]);
      return simulatedRates[i - 1] + fraction * (simulatedRates[i] - simulatedRates[i - 1]);
    }
  }
  return 120;
}
