export interface FlashFloodParameters {
  durationMinutes: number;
  soilSaturation: number;
  infiltrationMmH: number;
  roughness: number;
  windSpeedKmh: number;
  flowModel: "gnn" | "physics";
  floodIntensity: number; // 0–200 % — directly scales effective water volume
}

export const defaultFlashFloodParameters: FlashFloodParameters = {
  durationMinutes: 3, soilSaturation: 80, infiltrationMmH: 5, roughness: 0.035, windSpeedKmh: 20, flowModel: "physics", floodIntensity: 100,
};

export function runoffRainfall(rainfallMmH: number, parameters: FlashFloodParameters, elapsedSeconds: number) {
  if (elapsedSeconds + 1e-6 >= parameters.durationMinutes * 60) return 0;
  const infiltration = Math.max(0, parameters.infiltrationMmH) * (1 - Math.min(100, Math.max(0, parameters.soilSaturation)) / 100);
  return Math.max(0, rainfallMmH - infiltration);
}

export interface FloodForcing {
  sourceRiseM: number;
  rainfallMmH: number;
}

/**
 * One storm hydrograph shared by playback and arrival prediction. Controls are
 * peak values: the flood starts dry, grows gradually, then stops receiving new
 * storm water at the selected duration. Existing water continues to flow.
 */
export function getFloodForcing(
  rainfallMmH: number,
  sourceRiseM: number,
  parameters: FlashFloodParameters,
  elapsedSeconds: number,
): FloodForcing {
  const durationSeconds = parameters.durationMinutes * 60;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(elapsedSeconds) ||
      elapsedSeconds <= 0 || elapsedSeconds >= durationSeconds) {
    return { sourceRiseM: 0, rainfallMmH: 0 };
  }

  const phase = elapsedSeconds / durationSeconds;
  const ramp = phase < 0.4 ? phase / 0.4 : phase > 0.75 ? (1 - phase) / 0.25 : 1;
  const hydrograph = ramp * ramp * (3 - 2 * ramp);
  const intensity = Math.max(0, Math.min(200, parameters.floodIntensity ?? 100)) / 100;

  return {
    sourceRiseM: Math.max(0, sourceRiseM) * hydrograph * intensity,
    rainfallMmH: runoffRainfall(Math.max(0, rainfallMmH) * hydrograph, parameters, elapsedSeconds) * intensity,
  };
}
