import { WaterPhysicsSimulation, type SimulationConfig } from "./waterPhysics";
import { runoffRainfall, type FlashFloodParameters } from "./flashFloodParameters";

export interface ArrivalForecastInput {
  config: SimulationConfig; bed: Float32Array; inside: Uint8Array; sources: Uint8Array;
  paths: Uint8Array; depth: Float32Array; discharges: number[]; elapsed: number;
  rainfall: number; sourceRise: number; parameters: FlashFloodParameters; horizon: number;
}
export interface ArrivalForecastResult {
  arrivals: Float64Array; throughSeconds: number; horizon: number; complete: boolean;
  model?: string; source?: string; revision?: string;
}
export function createArrivalForecast(input: ArrivalForecastInput) {
  const simulation = new WaterPhysicsSimulation(input.config, input.bed, input.inside, input.sources, input.depth, input.paths);
  // Source targets are relative to the original dry scenario, not the forecast snapshot.
  simulation.state.initialSourceDepth.fill(0);
  simulation.state.elapsedSeconds = input.elapsed;
  simulation.state.firstArrivalSeconds = Float64Array.from(input.depth, (d, i) => input.inside[i] && d >= 0.1 ? input.elapsed : -1);
  simulation.state.edges.forEach((edge, i) => { edge.discharge = input.discharges[i] ?? 0; });
  return simulation;
}
export function advanceArrivalForecast(simulation: WaterPhysicsSimulation, input: ArrivalForecastInput, budgetMs: number) {
  const started = performance.now();
  while (simulation.state.elapsedSeconds < input.horizon - 1e-6 && performance.now() - started < budgetMs) {
    const elapsed = simulation.state.elapsedSeconds;
    const stormEnd = input.parameters.durationMinutes * 60;
    const remaining = Math.min(input.horizon - elapsed, stormEnd - elapsed > 1e-6 ? stormEnd - elapsed : Infinity);
    simulation.advance(Math.min(5, remaining), 1, input.sourceRise, runoffRainfall(input.rainfall, input.parameters, elapsed), 10);
  }
  return {
    arrivals: simulation.state.firstArrivalSeconds,
    throughSeconds: simulation.state.elapsedSeconds,
    horizon: input.horizon,
    complete: simulation.state.elapsedSeconds >= input.horizon - 1e-6,
    model: `${input.config.flowModel ?? "physics"} rollout`,
  } satisfies ArrivalForecastResult;
}
export function arrivalLabel(building: { assessed: boolean; arrivalSeconds: number | null; predictedArrivalSeconds: number | null }, elapsed: number, forecast: Pick<ArrivalForecastResult, "complete" | "horizon"> | null) {
  if (!building.assessed) return "Water ETA · unassessed";
  if (building.arrivalSeconds !== null) return `Reached at ${formatArrivalTime(building.arrivalSeconds)}`;
  if (building.predictedArrivalSeconds !== null && building.predictedArrivalSeconds > elapsed) return `Water in ~${formatArrivalTime(building.predictedArrivalSeconds - elapsed)}`;
  if (building.predictedArrivalSeconds !== null) return "Water ETA · updating";
  return forecast?.complete ? `No arrival by ${formatArrivalTime(forecast.horizon)}` : "Water ETA · calculating…";
}
export function formatArrivalTime(seconds: number) {
  const rounded = Math.max(0, Math.ceil(seconds));
  return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}
