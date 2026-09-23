import { WaterPhysicsSimulation, type SimulationConfig } from "./waterPhysics";
import { getFloodForcing, type FlashFloodParameters } from "./flashFloodParameters";
import { exposureThresholdM } from "./buildingExposure";

export interface ArrivalForecastInput {
  config: SimulationConfig;
  bed: Float32Array;
  inside: Uint8Array;
  sources: Uint8Array;
  paths: Uint8Array;
  depth: Float32Array;
  discharges: number[] | Float32Array;
  initialSourceDepth?: Float32Array;
  firstArrivalSeconds?: Float64Array;
  velocityX?: Float32Array;
  velocityY?: Float32Array;
  elapsed: number;
  rainfall: number;
  sourceRise: number;
  parameters: FlashFloodParameters;
  horizon: number;
}

export interface ArrivalForecastResult {
  arrivals: Float64Array;
  throughSeconds: number;
  horizon: number;
  complete: boolean;
  model?: string;
  source?: string;
  revision?: string;
}

export function createArrivalForecast(input: ArrivalForecastInput) {
  const simulation = new WaterPhysicsSimulation(input.config, input.bed, input.inside, input.sources, input.depth, input.paths);
  // Source targets are relative to the original dry scenario, not the forecast snapshot.
  if (input.initialSourceDepth) simulation.state.initialSourceDepth.set(input.initialSourceDepth);
  else simulation.state.initialSourceDepth.fill(0);
  simulation.state.elapsedSeconds = input.elapsed;
  simulation.state.firstArrivalSeconds = input.firstArrivalSeconds
    ? new Float64Array(input.firstArrivalSeconds)
    : Float64Array.from(input.depth, (d, i) => input.inside[i] && d >= exposureThresholdM ? input.elapsed : -1);
  simulation.state.edges.forEach((edge, i) => { edge.discharge = input.discharges[i] ?? 0; });
  if (input.velocityX) simulation.state.velocityX.set(input.velocityX);
  if (input.velocityY) simulation.state.velocityY.set(input.velocityY);
  return simulation;
}

/** Advances a persistent rollout. The returned arrivals array is borrowed, not a snapshot. */
export function advanceArrivalForecast(simulation: WaterPhysicsSimulation, input: ArrivalForecastInput, budgetMs: number) {
  const started = performance.now();
  const forcing = (elapsed: number) => getFloodForcing(input.rainfall, input.sourceRise, input.parameters, elapsed);
  const stormEnd = input.parameters.durationMinutes * 60;
  const peakForcing = forcing(stormEnd * 0.5);
  // An empty domain with no remaining input cannot acquire an arrival. This
  // handles dry/zero-intensity scenarios without thousands of empty steps.
  const noFutureWater = simulation.state.elapsedSeconds >= stormEnd ||
    (peakForcing.rainfallMmH <= 0 && (peakForcing.sourceRiseM <= 0 || !simulation.state.isSource.some(Boolean)));
  if (noFutureWater && simulation.state.maxDepthM === 0) {
    simulation.state.elapsedSeconds = Math.max(simulation.state.elapsedSeconds, input.horizon);
  }
  while (simulation.state.elapsedSeconds < input.horizon - 1e-6 && performance.now() - started < budgetMs) {
    const elapsed = simulation.state.elapsedSeconds;
    const remaining = Math.min(input.horizon - elapsed, stormEnd - elapsed > 1e-6 ? stormEnd - elapsed : Infinity);
    const advanced = simulation.advanceWithForcing(Math.min(5, remaining), 1, forcing, Math.max(0, budgetMs - (performance.now() - started)));
    if (!(advanced > 0)) break;
  }

  const reachedHorizon = simulation.state.elapsedSeconds >= input.horizon - 1e-6;

  return {
    arrivals: simulation.state.firstArrivalSeconds,
    throughSeconds: simulation.state.elapsedSeconds,
    horizon: input.horizon,
    complete: reachedHorizon,
    model: `${input.config.flowModel ?? "physics"} rollout`,
  } satisfies ArrivalForecastResult;
}

export function arrivalLabel(
  building: { assessed: boolean; arrivalSeconds: number | null; predictedArrivalSeconds: number | null },
  elapsed: number,
  forecast: Pick<ArrivalForecastResult, "complete" | "horizon"> | null
) {
  if (!building.assessed) return "Water ETA · unassessed";
  if (building.arrivalSeconds !== null) return `Reached at ${formatArrivalTime(building.arrivalSeconds)}`;
  if (building.predictedArrivalSeconds !== null && building.predictedArrivalSeconds > elapsed) {
    return `Water in ~${formatArrivalTime(building.predictedArrivalSeconds - elapsed)}`;
  }
  if (building.predictedArrivalSeconds !== null) return "Water ETA · updating";
  return forecast?.complete ? `No arrival by ${formatArrivalTime(forecast.horizon)}` : "Water ETA · calculating…";
}

export function formatArrivalTime(seconds: number) {
  const rounded = Math.max(0, Math.ceil(seconds));
  return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}
