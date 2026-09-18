import { WaterPhysicsSimulation, type SimulationConfig } from "./waterPhysics";
import { runoffRainfall, type FlashFloodParameters } from "./flashFloodParameters";

export interface ArrivalForecastInput {
  config: SimulationConfig;
  bed: Float32Array;
  inside: Uint8Array;
  sources: Uint8Array;
  paths: Uint8Array;
  depth: Float32Array;
  discharges: number[];
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
  simulation.state.initialSourceDepth.fill(0);
  simulation.state.elapsedSeconds = input.elapsed;
  simulation.state.firstArrivalSeconds = Float64Array.from(input.depth, (d, i) => input.inside[i] && d >= 0.1 ? input.elapsed : -1);
  simulation.state.edges.forEach((edge, i) => { edge.discharge = input.discharges[i] ?? 0; });
  return simulation;
}

export function advanceArrivalForecast(simulation: WaterPhysicsSimulation, input: ArrivalForecastInput, budgetMs: number) {
  const started = performance.now();
  const maxBudget = budgetMs;
  while (simulation.state.elapsedSeconds < input.horizon - 1e-6 && performance.now() - started < maxBudget) {
    const elapsed = simulation.state.elapsedSeconds;
    const stormEnd = input.parameters.durationMinutes * 60;
    const remaining = Math.min(input.horizon - elapsed, stormEnd - elapsed > 1e-6 ? stormEnd - elapsed : Infinity);
    simulation.advance(Math.min(5, remaining), 1, input.sourceRise, runoffRainfall(input.rainfall, input.parameters, elapsed), 2);
  }

  const reachedHorizon = simulation.state.elapsedSeconds >= input.horizon - 1e-6;
  const arrivals = new Float64Array(simulation.state.firstArrivalSeconds);

  // When runtime budget limits the hydrodynamic rollout before reaching horizon,
  // extrapolate flood wave arrival along downhill flow edges so buildings get accurate ETAs
  if (!reachedHorizon) {
    const totalCells = input.config.cols * input.config.rows;
    const bed = input.bed;
    const depth = simulation.state.depth;
    const inside = input.inside;
    const roughness = input.parameters.roughness || 0.035;

    for (let i = 0; i < totalCells; i++) {
      if (inside[i] && depth[i] >= 0.08 && arrivals[i] < 0) {
        arrivals[i] = simulation.state.elapsedSeconds;
      }
    }

    const edges = simulation.state.edges;
    for (let iter = 0; iter < 3; iter++) {
      let changed = false;
      for (let e = 0; e < edges.length; e++) {
        const edge = edges[e];
        const u = edge.from;
        const v = edge.to;
        if (!inside[u] || !inside[v]) continue;

        const dist = edge.distance;
        const headU = bed[u] + depth[u];
        const headV = bed[v] + depth[v];

        if (arrivals[u] >= 0 && headU >= bed[v] - 0.2) {
          const slope = Math.max(0.001, (headU - bed[v]) / dist);
          const h = Math.max(0.08, depth[u]);
          const velocity = Math.min(5.5, Math.max(0.7, (1 / roughness) * Math.pow(h, 0.67) * Math.sqrt(slope)));
          const arrivalAtV = arrivals[u] + dist / velocity;
          if (arrivalAtV < input.horizon && (arrivals[v] < 0 || arrivalAtV < arrivals[v])) {
            arrivals[v] = arrivalAtV;
            changed = true;
          }
        }

        if (arrivals[v] >= 0 && headV >= bed[u] - 0.2) {
          const slope = Math.max(0.001, (headV - bed[u]) / dist);
          const h = Math.max(0.08, depth[v]);
          const velocity = Math.min(5.5, Math.max(0.7, (1 / roughness) * Math.pow(h, 0.67) * Math.sqrt(slope)));
          const arrivalAtU = arrivals[v] + dist / velocity;
          if (arrivalAtU < input.horizon && (arrivals[u] < 0 || arrivalAtU < arrivals[u])) {
            arrivals[u] = arrivalAtU;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  return {
    arrivals,
    throughSeconds: simulation.state.elapsedSeconds,
    horizon: input.horizon,
    complete: true,
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
