import { useState, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FileText,
  Download,
  X,
  AlertTriangle,
  Cpu,
  Droplets,
  Waves,
  CheckCircle2,
  RefreshCw,
  Search,
  ExternalLink,
  Info,
  ArrowRight,
} from "lucide-react";
import type { SimulationReportData } from "./simulationReport";
import type { BuildingExposure } from "./buildingExposure";
import {
  buildStandardFloodReport,
  type StandardFloodReportData,
} from "./standardFloodReport";
import { downloadFloodReportPdf } from "@/lib/generateFloodReportPdf";

export interface FloodImpactReportProps {
  buildings: BuildingExposure[];
  scenario: Record<string, unknown>;
  graphCounts?: {
    nodes?: number;
    edges?: number;
    displayedEdges?: number;
    areaKm2?: number;
    spacingM?: number;
  };
  completedReport?: SimulationReportData;
  saveStatus?: string;
  isReportsPage?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function FloodImpactReport({
  buildings,
  scenario,
  graphCounts,
  completedReport,
  saveStatus,
  isReportsPage,
  onRetry,
  onDismiss,
}: FloodImpactReportProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "summary" | "hardware" | "met" | "impact" | "response" | "annexures">("all");
  const [searchQuery, setSearchQuery] = useState("");

  let currentPath = "";
  try {
    const loc = useLocation();
    currentPath = loc.pathname;
  } catch {
    currentPath = typeof window !== "undefined" ? window.location.pathname : "";
  }
  const isOnReportsPage = isReportsPage ?? currentPath.startsWith("/reports");

  const reportData: StandardFloodReportData = useMemo(() => {
    if (completedReport?.standardReport) {
      return completedReport.standardReport;
    }
    return buildStandardFloodReport(scenario, buildings, graphCounts, completedReport?.runId);
  }, [completedReport, scenario, buildings, graphCounts]);

  const {
    cover,
    hardware,
    executiveSummary,
    introduction,
    metHydrological,
    floodExtent,
    impactAssessment,
    causesAndFactors,
    responseMeasures,
    recommendations,
    conclusion,
    annexures,
  } = reportData;

  const affected = buildings.filter((b) => b.affectedDuringRun);
  const assessed = buildings.filter((b) => b.assessed).length;

  const downloadJson = () => {
    const payload = completedReport || {
      generatedAt: new Date().toISOString(),
      scenario,
      standardReport: reportData,
      buildings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `flood-impact-report-${cover.reportRef.toLowerCase()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadPdf = () => {
    downloadFloodReportPdf({
      areaName: cover.location,
      centerLat: typeof scenario.centerLat === "number" ? scenario.centerLat : 30.5432,
      centerLng: typeof scenario.centerLng === "number" ? scenario.centerLng : 79.1245,
      scenario,
      buildings,
      graphCounts,
      reportData,
    });
  };

  const filteredAnnexures = useMemo(() => {
    if (!searchQuery.trim()) return annexures.buildingsSummary;
    const q = searchQuery.toLowerCase();
    return annexures.buildingsSummary.filter(
      (b) => b.name.toLowerCase().includes(q) || b.kind.toLowerCase().includes(q) || b.id.toLowerCase().includes(q)
    );
  }, [annexures.buildingsSummary, searchQuery]);

  return (
    <>
      {!completedReport && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute bottom-4 right-3 z-30 flex items-center gap-2 rounded-xl border border-cyan-500/80 bg-slate-950/95 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur hover:bg-slate-900 transition-all cursor-pointer"
        >
          <FileText className="size-4 text-cyan-400" />
          <span>Flood Report · {assessed ? `${affected.length} exposed buildings` : "monitoring area"}</span>
        </button>
      )}

      {(open || completedReport) && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Official Flood Impact Assessment Report"
            className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-cyan-700/60 bg-slate-950 text-white shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-cyan-950 border border-cyan-700/60 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-cyan-300">
                    Official Standard Report
                  </span>
                  <span className="font-mono text-xs text-slate-400">{cover.reportRef}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      executiveSummary.severity === "CRITICAL"
                        ? "bg-red-950/90 border border-red-500 text-red-300"
                        : executiveSummary.severity === "HIGH"
                        ? "bg-amber-950/90 border border-amber-500 text-amber-300"
                        : "bg-emerald-950/90 border border-emerald-500 text-emerald-300"
                    }`}
                  >
                    {executiveSummary.severity} SEVERITY
                  </span>
                </div>
                <h2 className="mt-1 text-lg font-bold tracking-tight text-white sm:text-xl">
                  {cover.reportTitle} — {cover.location}
                </h2>
                <p className="text-xs text-slate-400">
                  {cover.preparedBy} · Event Date: {cover.eventDate}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isOnReportsPage ? (
                  <>
                    <button
                      type="button"
                      data-testid="download-pdf-btn"
                      onClick={handleDownloadPdf}
                      className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 px-3.5 py-2 text-xs font-bold text-white shadow-md hover:from-red-500 hover:to-rose-500 active:scale-95 transition-all cursor-pointer"
                    >
                      <FileText className="size-3.5" />
                      <span>Download PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={downloadJson}
                      className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
                    >
                      <Download className="size-3.5" />
                      <span>JSON</span>
                    </button>
                  </>
                ) : (
                  <Link
                    to="/reports"
                    className="flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3.5 py-2 text-xs font-bold text-white shadow-md active:scale-95 transition-all cursor-pointer"
                    title="Reports are available in the Reports page. Download from there."
                  >
                    <FileText className="size-3.5" />
                    <span>Download in Reports Page</span>
                    <ArrowRight className="size-3.5" />
                  </Link>
                )}
                <button
                  autoFocus
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onDismiss?.();
                  }}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
                  aria-label="Close report"
                >
                  <X className="size-5" />
                </button>
              </div>
            </header>

            {/* Directive banner: reports available in Reports page */}
            {!isOnReportsPage && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-800/60 bg-gradient-to-r from-cyan-950/90 via-slate-900 to-cyan-950/90 px-6 py-3 text-xs text-cyan-200">
                <div className="flex items-center gap-2.5">
                  <Info className="size-4 text-cyan-400 shrink-0" />
                  <span>
                    <strong>Official Flood Report Available:</strong> This simulation report is archived in the <strong>Reports page library</strong>. Official PDF and JSON downloads are available exclusively from the Reports page.
                  </span>
                </div>
                <Link
                  to="/reports"
                  className="flex items-center gap-1 rounded-md bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-bold text-white shadow transition-all whitespace-nowrap"
                >
                  <span>Go to Reports Page to Download</span>
                  <ArrowRight className="size-3" />
                </Link>
              </div>
            )}

            {/* Status notification if completed */}
            {completedReport && (
              <div
                role="status"
                className="flex items-center justify-between border-b border-slate-800 bg-slate-900/50 px-6 py-2.5 text-xs text-cyan-200"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-cyan-400" />
                  <span>
                    Simulation Run Complete · {saveStatus || "Archived to Departmental Reports Library"}
                  </span>
                </div>
                {saveStatus?.startsWith("Save failed") && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="flex items-center gap-1 rounded bg-cyan-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-cyan-600"
                  >
                    <RefreshCw className="size-3" /> Retry save
                  </button>
                )}
              </div>
            )}

            {/* Sub-navigation tabs */}
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-800 bg-slate-950 px-6 py-2 text-xs font-medium text-slate-400">
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className={`rounded-md px-3 py-1.5 transition-colors whitespace-nowrap ${
                  activeTab === "all" ? "bg-cyan-600/30 text-cyan-300 font-semibold" : "hover:bg-slate-800"
                }`}
              >
                All 12 Sections
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("summary")}
                className={`rounded-md px-3 py-1.5 transition-colors whitespace-nowrap ${
                  activeTab === "summary" ? "bg-cyan-600/30 text-cyan-300 font-semibold" : "hover:bg-slate-800"
                }`}
              >
                1-3. Summary & Cover
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("hardware")}
                className={`rounded-md px-3 py-1.5 transition-colors whitespace-nowrap ${
                  activeTab === "hardware" ? "bg-cyan-600/30 text-cyan-300 font-semibold" : "hover:bg-slate-800"
                }`}
              >
                2. Hardware & Nodes
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("met")}
                className={`rounded-md px-3 py-1.5 transition-colors whitespace-nowrap ${
                  activeTab === "met" ? "bg-cyan-600/30 text-cyan-300 font-semibold" : "hover:bg-slate-800"
                }`}
              >
                4-6. Hydrological Extent
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("impact")}
                className={`rounded-md px-3 py-1.5 transition-colors whitespace-nowrap ${
                  activeTab === "impact" ? "bg-cyan-600/30 text-cyan-300 font-semibold" : "hover:bg-slate-800"
                }`}
              >
                7-8. Impact & Causes
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("response")}
                className={`rounded-md px-3 py-1.5 transition-colors whitespace-nowrap ${
                  activeTab === "response" ? "bg-cyan-600/30 text-cyan-300 font-semibold" : "hover:bg-slate-800"
                }`}
              >
                9-11. Response & Recommendations
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("annexures")}
                className={`rounded-md px-3 py-1.5 transition-colors whitespace-nowrap ${
                  activeTab === "annexures" ? "bg-cyan-600/30 text-cyan-300 font-semibold" : "hover:bg-slate-800"
                }`}
              >
                12. Annexures Table ({annexures.buildingsSummary.length})
              </button>
            </div>

            {/* Main Report Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8 text-sm">
              {/* SECTION 1: COVER PAGE METADATA */}
              {(activeTab === "all" || activeTab === "summary") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
                    <div>
                      <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 1</span>
                      <h3 className="text-base font-bold text-white uppercase tracking-wide">Cover Page</h3>
                    </div>
                    <span className="text-xs text-slate-400">Ref: {cover.reportRef}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                    <div>
                      <div className="text-slate-400">Report Title</div>
                      <div className="mt-1 font-semibold text-slate-200">{cover.reportTitle}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Location / Region Affected</div>
                      <div className="mt-1 font-semibold text-slate-200">{cover.location}</div>
                      <div className="text-[11px] font-mono text-cyan-300">{cover.coordinatesText}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Date of Flood Event</div>
                      <div className="mt-1 font-semibold text-slate-200">{cover.eventDate}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Prepared By</div>
                      <div className="mt-1 font-semibold text-slate-200">{cover.preparedBy}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Report Reference Number</div>
                      <div className="mt-1 font-mono font-semibold text-cyan-300">{cover.reportRef}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Generated Timestamp</div>
                      <div className="mt-1 text-slate-300">{cover.reportDate}</div>
                    </div>
                  </div>
                </section>
              )}

              {/* SECTION 2: HARDWARE USED, AREA COVERED, NODES & EDGES */}
              {(activeTab === "all" || activeTab === "summary" || activeTab === "hardware") && (
                <section className="rounded-xl border border-cyan-900/60 bg-gradient-to-br from-slate-900/90 via-slate-950 to-slate-900/90 p-5">
                  <div className="flex items-center gap-2 border-b border-cyan-800/40 pb-3">
                    <Cpu className="size-4 text-cyan-400" />
                    <div>
                      <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 2</span>
                      <h3 className="text-base font-bold text-white uppercase tracking-wide">
                        Hardware Used, Area Covered, Nodes and Edges
                      </h3>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                    <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-3.5">
                      <div className="text-slate-400">Basin Area Covered</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        {hardware.areaCoveredKm2.toFixed(2)} km²
                      </div>
                      <div className="text-[11px] text-slate-400">({hardware.areaCoveredHectares.toFixed(1)} hectares)</div>
                    </div>
                    <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-3.5">
                      <div className="text-slate-400">Grid Spacing / Resolution</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        {hardware.gridSpacingM.toFixed(1)}m × {hardware.gridSpacingM.toFixed(1)}m
                      </div>
                      <div className="text-[11px] text-slate-400">{hardware.cellAreaM2.toFixed(0)} m² per cell</div>
                    </div>
                    <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-3.5">
                      <div className="text-slate-400">Active Terrain Nodes</div>
                      <div className="mt-1 text-base font-bold font-mono text-emerald-400">
                        {hardware.nodesCount.toLocaleString()} nodes
                      </div>
                      <div className="text-[11px] text-slate-400">Surface DEM vertices</div>
                    </div>
                    <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-3.5">
                      <div className="text-slate-400">Connected Hydraulic Edges</div>
                      <div className="mt-1 text-base font-bold font-mono text-emerald-400">
                        {hardware.displayedEdgesCount.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-slate-400">~{hardware.d8PhysicsEdgesCount.toLocaleString()} D8 physics routes</div>
                    </div>
                  </div>

                  {/* Physical Hardware Deployment breakdown */}
                  <div className="mt-4 rounded-lg bg-slate-900/50 border border-slate-800/80 p-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      IoT Field Hardware & Telemetry Architecture
                    </h4>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-slate-400">Gateway Stations:</span>{" "}
                        <span className="font-semibold text-white">{hardware.masterGateways} Master Gateway (node1)</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Slave Sentries:</span>{" "}
                        <span className="font-semibold text-white">{hardware.slaveStations} Solar Field Sentries</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Total Probes:</span>{" "}
                        <span className="font-semibold text-white">{hardware.sensorProbes} Active Telemetry Probes</span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {hardware.sensorTypes.map((type, idx) => (
                        <span
                          key={idx}
                          className="rounded-md bg-slate-800/80 border border-slate-700 px-2.5 py-1 text-[11px] text-cyan-200"
                        >
                          • {type}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] text-slate-400 font-mono">
                      Communication Layer: {hardware.telemetryProtocol}
                    </p>
                  </div>
                </section>
              )}

              {/* SECTION 3: EXECUTIVE SUMMARY */}
              {(activeTab === "all" || activeTab === "summary") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
                    <Info className="size-4 text-cyan-400" />
                    <div>
                      <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 3</span>
                      <h3 className="text-base font-bold text-white uppercase tracking-wide">Executive Summary</h3>
                    </div>
                  </div>
                  <p className="mt-3 text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {executiveSummary.overview}
                  </p>
                  <div className="mt-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Key Event Impacts
                    </h4>
                    <ul className="mt-2 space-y-1 text-xs text-slate-300">
                      {executiveSummary.keyImpacts.map((impact, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-cyan-400 font-bold">•</span>
                          <span>{impact}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              {/* SECTION 4: INTRODUCTION / BACKGROUND */}
              {(activeTab === "all" || activeTab === "met") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="border-b border-slate-700/60 pb-3">
                    <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 4</span>
                    <h3 className="text-base font-bold text-white uppercase tracking-wide">
                      Introduction / Background
                    </h3>
                  </div>
                  <div className="mt-4 space-y-3 text-xs text-slate-300 leading-relaxed">
                    <div>
                      <h4 className="font-semibold text-white">Purpose of Report</h4>
                      <p className="mt-1">{introduction.purpose}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">Study Area Description</h4>
                      <p className="mt-1">{introduction.studyAreaDescription}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">Historical Flood Context</h4>
                      <p className="mt-1">{introduction.historicalContext}</p>
                    </div>
                  </div>
                </section>
              )}

              {/* SECTION 5: METEOROLOGICAL & HYDROLOGICAL DATA */}
              {(activeTab === "all" || activeTab === "met") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
                    <Droplets className="size-4 text-cyan-400" />
                    <div>
                      <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 5</span>
                      <h3 className="text-base font-bold text-white uppercase tracking-wide">
                        Meteorological & Hydrological Data
                      </h3>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Rainfall Intensity</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        {metHydrological.rainfallIntensityMmH} mm/h
                      </div>
                      <div className="text-[11px] text-slate-400">Storm duration: {metHydrological.stormDurationMin} min</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">River Surge / Rise</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        +{metHydrological.riverRiseM.toFixed(2)} m
                      </div>
                      <div className="text-[11px] text-slate-400">Upstream head increase</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Peak Water Discharge</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        {metHydrological.peakDischargeM3s.toLocaleString()} m³/s
                      </div>
                      <div className="text-[11px] text-slate-400">Basin outlet flow</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Cumulative Flood Volume</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        {metHydrological.totalFloodVolumeM3.toLocaleString()} m³
                      </div>
                      <div className="text-[11px] text-slate-400">Total water in basin</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Soil Saturation</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        {metHydrological.soilSaturationPercent}%
                      </div>
                      <div className="text-[11px] text-slate-400">Pre-event moisture</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Manning's Roughness (n)</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        {metHydrological.groundRoughnessManningN}
                      </div>
                      <div className="text-[11px] text-slate-400">Surface overland friction</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3 sm:col-span-2">
                      <div className="text-slate-400">Data Sources & Telemetry</div>
                      <div className="mt-1 text-[11px] text-slate-300">
                        {metHydrological.dataSources.join(" • ")}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* SECTION 6: FLOOD EXTENT & MAPPING */}
              {(activeTab === "all" || activeTab === "met") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
                    <Waves className="size-4 text-cyan-400" />
                    <div>
                      <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 6</span>
                      <h3 className="text-base font-bold text-white uppercase tracking-wide">
                        Flood Extent & Mapping
                      </h3>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Area Inundated (km²)</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        {floodExtent.areaInundatedKm2.toFixed(3)} km²
                      </div>
                      <div className="text-[11px] text-slate-400">{floodExtent.areaInundatedHa.toFixed(2)} hectares</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Basin Coverage Ratio</div>
                      <div className="mt-1 text-base font-bold font-mono text-cyan-300">
                        {floodExtent.inundationPercentage}%
                      </div>
                      <div className="text-[11px] text-slate-400">Of total monitored terrain</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Maximum Flood Depth</div>
                      <div className="mt-1 text-base font-bold font-mono text-rose-400">
                        {floodExtent.maxDepthM.toFixed(2)} m
                      </div>
                      <div className="text-[11px] text-slate-400">Average: {floodExtent.averageDepthM.toFixed(2)} m</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Simulation Run Duration</div>
                      <div className="mt-1 text-xs font-bold font-mono text-slate-200">
                        {floodExtent.floodDurationFormatted}
                      </div>
                      <div className="text-[11px] text-slate-400">Real-time shallow-water solver</div>
                    </div>
                  </div>
                </section>
              )}

              {/* SECTION 7: IMPACT ASSESSMENT */}
              {(activeTab === "all" || activeTab === "impact") && (
                <section className="rounded-xl border border-rose-950/60 bg-slate-900/60 p-5">
                  <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
                    <AlertTriangle className="size-4 text-rose-400" />
                    <div>
                      <span className="text-[11px] font-mono text-rose-400 font-semibold">SECTION 7</span>
                      <h3 className="text-base font-bold text-white uppercase tracking-wide">
                        Impact Assessment
                      </h3>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Exposed Structures</div>
                      <div className="mt-1 text-base font-bold font-mono text-rose-400">
                        {impactAssessment.buildingsExposed} / {impactAssessment.totalBuildingsAssessed}
                      </div>
                      <div className="text-[11px] text-slate-400">≥0.10m simulated water depth</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Residential Homes</div>
                      <div className="mt-1 text-base font-bold font-mono text-rose-400">
                        {impactAssessment.residentialHomesExposed} homes
                      </div>
                      <div className="text-[11px] text-slate-400">{impactAssessment.commercialStructuresExposed} commercial units</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Population at Risk</div>
                      <div className="mt-1 text-base font-bold font-mono text-amber-300">
                        ~{impactAssessment.estimatedPopulationAffected.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-slate-400">{impactAssessment.displacedHouseholds} households</div>
                    </div>
                    <div className="rounded-lg bg-slate-900 p-3">
                      <div className="text-slate-400">Road Infrastructure</div>
                      <div className="mt-1 text-base font-bold font-mono text-amber-300">
                        ~{impactAssessment.infrastructureRoadsDisruptedKm} km
                      </div>
                      <div className="text-[11px] text-slate-400">Disrupted road network</div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs flex items-center justify-between">
                    <div>
                      <span className="text-slate-400">Estimated Economic Damage:</span>{" "}
                      <span className="font-bold text-amber-300">{impactAssessment.economicLossEstimateInr}</span>
                    </div>
                    <span className="rounded bg-amber-950 px-2 py-0.5 font-semibold text-amber-400 border border-amber-800/80">
                      Tag: {impactAssessment.severityTag}
                    </span>
                  </div>
                </section>
              )}

              {/* SECTION 8: CAUSES & CONTRIBUTING FACTORS */}
              {(activeTab === "all" || activeTab === "impact") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="border-b border-slate-700/60 pb-3">
                    <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 8</span>
                    <h3 className="text-base font-bold text-white uppercase tracking-wide">
                      Causes & Contributing Factors
                    </h3>
                  </div>
                  <ul className="mt-4 space-y-2 text-xs text-slate-300">
                    {causesAndFactors.map((cause, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                          {idx + 1}
                        </span>
                        <span>{cause}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* SECTION 9: RESPONSE & MITIGATION MEASURES TAKEN */}
              {(activeTab === "all" || activeTab === "response") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="border-b border-slate-700/60 pb-3">
                    <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 9</span>
                    <h3 className="text-base font-bold text-white uppercase tracking-wide">
                      Response & Mitigation Measures Taken
                    </h3>
                  </div>
                  <div className="mt-4 space-y-3 text-xs text-slate-300">
                    <div>
                      <h4 className="font-semibold text-white">Emergency Warning & Notification Operations</h4>
                      <ul className="mt-1.5 space-y-1">
                        {responseMeasures.emergencyActions.map((action, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0 mt-0.5" />
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">Evacuation Corridors</h4>
                      <p className="mt-1">{responseMeasures.evacuationDetails}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">Emergency Relief Provisions</h4>
                      <ul className="mt-1.5 space-y-1">
                        {responseMeasures.reliefMeasures.map((relief, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-cyan-400 font-bold">•</span>
                            <span>{relief}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              )}

              {/* SECTION 10: RECOMMENDATIONS */}
              {(activeTab === "all" || activeTab === "response") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="border-b border-slate-700/60 pb-3">
                    <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 10</span>
                    <h3 className="text-base font-bold text-white uppercase tracking-wide">
                      Recommendations
                    </h3>
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="rounded-lg bg-slate-900/80 p-4 border border-slate-800">
                      <h4 className="font-bold text-amber-300 uppercase tracking-wider">
                        Immediate / Short-Term Measures
                      </h4>
                      <ul className="mt-2 space-y-1.5 text-slate-300">
                        {recommendations.shortTerm.map((rec, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-amber-400 font-bold">•</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-lg bg-slate-900/80 p-4 border border-slate-800">
                      <h4 className="font-bold text-cyan-300 uppercase tracking-wider">
                        Medium / Long-Term Structural Measures
                      </h4>
                      <ul className="mt-2 space-y-1.5 text-slate-300">
                        {recommendations.longTerm.map((rec, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-cyan-400 font-bold">•</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              )}

              {/* SECTION 11: CONCLUSION */}
              {(activeTab === "all" || activeTab === "response") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="border-b border-slate-700/60 pb-3">
                    <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 11</span>
                    <h3 className="text-base font-bold text-white uppercase tracking-wide">
                      Conclusion
                    </h3>
                  </div>
                  <p className="mt-3 text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {conclusion}
                  </p>
                </section>
              )}

              {/* SECTION 12: ANNEXURES / APPENDICES */}
              {(activeTab === "all" || activeTab === "annexures") && (
                <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 pb-3">
                    <div>
                      <span className="text-[11px] font-mono text-cyan-400 font-semibold">SECTION 12</span>
                      <h3 className="text-base font-bold text-white uppercase tracking-wide">
                        Annexures: Structure-by-Structure Inundation & Reach Times
                      </h3>
                    </div>
                    <div className="relative w-64 max-w-full">
                      <Search className="absolute left-2.5 top-2.5 size-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search building or kind..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto max-h-72 border border-slate-800 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 sticky top-0">
                        <tr className="border-b border-slate-700">
                          <th className="py-2.5 px-3">Structure / Type</th>
                          <th className="py-2.5 px-3">Simulated Arrival</th>
                          <th className="py-2.5 px-3">Peak Water Depth</th>
                          <th className="py-2.5 px-3">Assessed Hazard Level</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {filteredAnnexures.slice(0, 150).map((b) => (
                          <tr key={b.id} className="hover:bg-slate-900/40">
                            <td className="py-2 px-3 font-medium text-slate-200">
                              {b.name}
                              <div className="text-[11px] text-slate-400">{b.kind}</div>
                            </td>
                            <td className="py-2 px-3 font-mono text-cyan-300">
                              {b.arrivalFormatted}
                            </td>
                            <td className="py-2 px-3 font-mono font-semibold text-slate-200">
                              {b.peakDepthM > 0 ? `${b.peakDepthM.toFixed(2)} m` : "0.00 m"}
                            </td>
                            <td className="py-2 px-3">
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                                  b.riskCategory === "Severe Hazard"
                                    ? "bg-red-950 text-red-300 border border-red-800"
                                    : b.riskCategory === "High Risk"
                                    ? "bg-amber-950 text-amber-300 border border-amber-800"
                                    : b.riskCategory === "Moderate"
                                    ? "bg-yellow-950 text-yellow-300 border border-yellow-800"
                                    : "bg-slate-800 text-slate-300"
                                }`}
                              >
                                {b.riskCategory}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Authoritative References & Methodologies
                    </h4>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">
                      {annexures.references.map((ref, idx) => (
                        <li key={idx} className="flex items-center gap-1.5">
                          <ExternalLink className="size-3 text-slate-500" />
                          <span>{ref}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}
            </div>

            {/* Footer controls */}
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/90 px-6 py-3">
              <div className="text-xs text-slate-400">
                {isOnReportsPage
                  ? "Departmental Standard Format · 12 Sections · Official Output"
                  : "Reports available in Reports Page · Download official exports from there"}
              </div>
              <div className="flex items-center gap-2">
                {isOnReportsPage ? (
                  <>
                    <button
                      type="button"
                      data-testid="download-pdf-footer-btn"
                      onClick={handleDownloadPdf}
                      className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:from-red-500 hover:to-rose-500 active:scale-95 transition-all cursor-pointer"
                    >
                      <FileText className="size-3.5" />
                      <span>Download Official PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={downloadJson}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
                    >
                      Download JSON
                    </button>
                  </>
                ) : (
                  <Link
                    to="/reports"
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 px-4 py-2 text-xs font-bold text-white shadow-md transition-all cursor-pointer"
                  >
                    <FileText className="size-3.5" />
                    <span>Go to Reports Page to Download</span>
                    <ArrowRight className="size-3.5" />
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onDismiss?.();
                  }}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  Close
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
