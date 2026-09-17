export interface FlashFloodParameters {
  durationMinutes: number;
  soilSaturation: number;
  infiltrationMmH: number;
  roughness: number;
  windSpeedKmh: number;
  flowModel: "gnn" | "physics";
}

export const defaultFlashFloodParameters: FlashFloodParameters = {
  durationMinutes: 60, soilSaturation: 70, infiltrationMmH: 15, roughness: 0.035, windSpeedKmh: 20, flowModel: "gnn",
};

export function runoffRainfall(rainfallMmH: number, parameters: FlashFloodParameters, elapsedSeconds: number) {
  if (elapsedSeconds + 1e-6 >= parameters.durationMinutes * 60) return 0;
  const infiltration = Math.max(0, parameters.infiltrationMmH) * (1 - Math.min(100, Math.max(0, parameters.soilSaturation)) / 100);
  return Math.max(0, rainfallMmH - infiltration);
}
