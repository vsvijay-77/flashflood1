import type { BuildingExposure } from "./buildingExposure";
import type { StandardFloodReportData } from "./standardFloodReport";

export interface SimulationReportData {
  runId: string; startedAt: string; endedAt: string;
  scenario: Record<string, unknown>;
  settingsHistory: { elapsedSeconds: number; settings: Record<string, unknown> }[];
  buildings: BuildingExposure[];
  summary: { loaded: number; assessed: number; affectedNow: number; affectedDuringRun: number; residentialAffectedDuringRun: number };
  method: string;
  standardReport?: StandardFloodReportData;
}
export function buildSimulationReport(runId: string, startedAt: string, scenario: Record<string, unknown>, buildings: BuildingExposure[], settingsHistory: SimulationReportData["settingsHistory"]): SimulationReportData {
  return { runId, startedAt, endedAt: new Date().toISOString(), scenario, settingsHistory,
    buildings, summary: { loaded: buildings.length, assessed: buildings.filter(b => b.assessed).length,
      affectedNow: buildings.filter(b => b.affectedNow).length,
      affectedDuringRun: buildings.filter(b => b.affectedDuringRun).length,
      residentialAffectedDuringRun: buildings.filter(b => b.affectedDuringRun && ["house", "residential", "apartments", "detached", "semidetached_house", "terrace"].includes(b.kind)).length },
    method: "Experimental terrain graph simulation. Arrival is the first substep reaching 0.10 m in any terrain cell intersecting a building. Predicted times use a separate rollout of the same solver and current settings. No observed flood calibration or damage assessment.",
  };
}
