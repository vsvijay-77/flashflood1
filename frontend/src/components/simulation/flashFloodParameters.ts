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
