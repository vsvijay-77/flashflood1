import { deleteArea } from "@/services/deleteArea";
import { FloodImpactReport } from "@/components/simulation/FloodImpactReport";
import { downloadFloodReportPdf } from "@/lib/generateFloodReportPdf";
import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Brain, Download, FileText, Info, Play, Sparkles, Box, Boxes, RefreshCw,
  CheckCircle2, ArrowRight, Layers, Globe, Map, MapPin, AlertTriangle,
  Square, CloudRain, Trash2, Radio, Activity, Database, Waves, Compass,
  ShieldAlert, Send, Navigation, Check, X, Shield, Bell, UserCheck,
  AlertCircle, Signal, Battery, Cpu, Wifi, ExternalLink, MapPinned, Phone,
  Mountain, PhoneCall, MessageSquare, BellRing, Users, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingRows, LoadingSymbol, PageHeader, RiskIndicator, SectionCard, StatCard, StatusPill } from "@/components/Primitives";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { apiErrorMessage, useSession } from "@/lib/session";
import {
  HAZARD_LABELS,
  ROLE_LABELS,
  SENSOR_LABELS,
  type Alert,
  type Report,
  type RiskAssessment,
  type Role,
  type Sensor,
  type SimulationResult,
  type User,
  type Zone,
  type CustomArea,
  type ExternalSensorSummary,
  type ExternalSensorHistoryItem,
  type ExternalLoraPacket,
  type MobUser,
  type MobUserAlertPayload,
  type MobUserBroadcastAlertPayload,
  type MobUserEvacuationPayload,
  type MobAlertRecord,
} from "@/lib/types";
import { CesiumDigitalTwinViewer } from "@/components/gis/CesiumDigitalTwinViewer";
import GISMap, { DEFAULT_LAYERS } from "@/components/gis/GISMap";
import { supabase } from "@/lib/supabase";
import { parseCustomAreaPolygon } from "@/lib/gisUtils";
import DisasterIntelligenceChat from "@/components/gis/DisasterIntelligenceChat";
import { SensorManagementSection } from "@/components/dashboard/SensorManagementSection";


const useZones = () => useQuery({ queryKey: ["zones"], queryFn: () => apiGet<Zone[]>("/zones"), retry: false });

const SCENARIOS = [
  { value: "flood", label: "Flood Simulation" },
  { value: "landslide", label: "Landslide Simulation" },
  { value: "evacuation", label: "Evacuation Route Simulation" },
];
const SCENARIO_LABELS: Record<string, string> = Object.fromEntries(SCENARIOS.map((s) => [s.value, s.label]));

export function DigitalTwinPage() {
  const location = useLocation();
  const rainfall = 100;
  const wind = 20;
  const [isRainActive, setIsRainActive] = useState<boolean>(false);

  // 3D Digital Twin State (Cesium 3D Engine)
  const [loadingAreas, setLoadingAreas] = useState<boolean>(() => {
    try {
      return !localStorage.getItem("cached_custom_areas");
    } catch {
      return false;
    }
  });
  const [customAreas, setCustomAreas] = useState<CustomArea[]>(() => {
    try {
      const cached = localStorage.getItem("cached_custom_areas");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((d: any) => ({
            ...d,
            polygon: d.polygon || parseCustomAreaPolygon(d.shape, Number(d.lat), Number(d.lng)),
          }));
        }
      }
    } catch (e) {
      console.warn("Failed to parse cached custom areas", e);
    }
    return [];
  });
  const [selectedAreaId, setSelectedAreaId] = useState<string>(
    location.state?.area?.id || customAreas[0]?.id || ""
  );
  const [activeArea, setActiveArea] = useState<CustomArea | null>(
    location.state?.area || customAreas[0] || null
  );
  const [twinViewMode, setTwinViewMode] = useState<"3d" | "gis">("3d");

  const [lat, setLat] = useState<number>(
    location.state?.latitude ?? (location.state?.area?.lat ? Number(location.state.area.lat) : (customAreas[0]?.lat ? Number(customAreas[0].lat) : 10.6608))
  );
  const [lng, setLng] = useState<number>(
    location.state?.longitude ?? (location.state?.area?.lng ? Number(location.state.area.lng) : (customAreas[0]?.lng ? Number(customAreas[0].lng) : 77.0048))
  );
  const [areaTitle, setAreaTitle] = useState<string>(
    location.state?.area?.name || location.state?.name || customAreas[0]?.name || "Pollachi Basin"
  );

  // Fetch monitored areas from Supabase
  useEffect(() => {
    supabase
      .from("custom_areas")
      .select("*")
      .then(({ data }) => {
        setLoadingAreas(false);
        if (data) {
          const loaded: CustomArea[] = data.map((d: any) => ({
            id: d.id,
            name: d.name,
            district: d.district,
            type: d.area_type || "Forest",
            risk: d.risk_category || "Medium",
            priority: d.priority || "Normal",
            description: d.description || "",
            date: new Date(d.created_at).toLocaleDateString(),
            lat: Number(d.lat),
            lng: Number(d.lng),
            shape: d.shape || "Polygon",
            polygon: parseCustomAreaPolygon(d.shape, Number(d.lat), Number(d.lng)),
            areaSqMeters: 0,
          }));
          setCustomAreas(loaded);
          setActiveArea((current) => {
            const next = loaded.find(area => area.id === current?.id) || loaded[0] || null;
            setSelectedAreaId(next?.id || "");
            setAreaTitle(next?.name || "");
            if (next) { setLat(Number(next.lat)); setLng(Number(next.lng)); }
            return next;
          });
          try {
            const lightweight = loaded.map(({ id, name, district, type, risk, priority, date, lat, lng, shape, polygon }) => ({
              id, name, district, type, risk, priority, date, lat, lng, shape, polygon, areaSqMeters: 0,
            }));
            localStorage.setItem("cached_custom_areas", JSON.stringify(lightweight));
          } catch {
            try {
              for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && (k.startsWith("dt_") || k.startsWith("EIN_") || k.startsWith("cached_"))) {
                  localStorage.removeItem(k);
                }
              }
            } catch {}
          }
        }
      },
      () => {
        setLoadingAreas(false);
      });
  }, []);

  // Sync state from location navigation
  useEffect(() => {
    if (location.state?.area) {
      setActiveArea(location.state.area);
      setSelectedAreaId(location.state.area.id);
      setLat(Number(location.state.area.lat));
      setLng(Number(location.state.area.lng));
      setAreaTitle(location.state.area.name);
    } else if (location.state?.latitude && location.state?.longitude) {
      setLat(Number(location.state.latitude));
      setLng(Number(location.state.longitude));
      if (location.state.name) setAreaTitle(location.state.name);
    }
  }, [location.state]);

  const handleAreaChange = (id: string) => {
    if (!id) {
      setSelectedAreaId("");
      setActiveArea(null);
      setAreaTitle("");
      return;
    }
    setSelectedAreaId(id);
    const chosen = customAreas.find((a) => a.id === id);
    if (chosen) {
      setActiveArea(chosen);
      setLat(Number(chosen.lat));
      setLng(Number(chosen.lng));
      setAreaTitle(chosen.name);
      toast.success(`Loaded 3D Digital Twin for ${chosen.name}`);
    }
  };


  return (
    <div data-testid="digital-twin-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="3D Satellite Terrain Twin"
          description="High-resolution 3D Satellite Terrain View with real-time hazard simulation telemetry."
        />
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/gis"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 text-xs font-semibold shadow-xs"
          >
            ← Select Area on GIS Map
          </Link>
        </div>
      </div>

      {/* ─── 3D Basin Digital Twin Viewport ─── */}
      {!activeArea ? (
        <Card
          data-testid="no-area-selected-card"
          className="border-2 border-dashed border-slate-300 dark:border-slate-700 bg-gradient-to-b from-slate-50/80 via-white to-slate-50/50 dark:from-slate-900/50 dark:via-slate-900/20 dark:to-slate-900/40 p-8 sm:p-14 text-center flex flex-col items-center justify-center min-h-[520px] rounded-2xl shadow-xs"
        >
          <div className="relative mb-5">
            <div className="size-20 rounded-2xl bg-gradient-to-br from-[#0F4C81]/15 via-teal-500/15 to-emerald-500/20 border border-[#0F4C81]/20 flex items-center justify-center shadow-md">
              <Boxes className="size-10 text-[#0F4C81]" />
            </div>
            <span className="absolute -bottom-1 -right-1 flex size-6 rounded-full bg-amber-100 border-2 border-white items-center justify-center shadow-xs">
              <MapPin className="size-3.5 text-amber-600" />
            </span>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold mb-3">
            <AlertTriangle className="size-3.5 text-amber-600" />
            <span>No Area Selected</span>
          </div>

          <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-800 dark:text-slate-100 tracking-tight max-w-xl">
            Select an area in GIS mapping to create a digital twin
          </h2>

          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 max-w-lg leading-relaxed">
            To view the interactive 3D terrain mesh, hazard simulations, and localized sensor mesh telemetry, please select or draw an area in GIS mapping first.
          </p>

          <div className="mt-7 flex flex-col sm:flex-row items-center gap-3">
            <Link
              to="/gis"
              data-testid="goto-gis-mapping-btn"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 hover:from-emerald-700 hover:to-cyan-800 text-white text-sm font-bold shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer"
            >
              <Map className="size-4" />
              <span>Select an Area in GIS Mapping</span>
              <ArrowRight className="size-4" />
            </Link>
          </div>

          {loadingAreas && customAreas.length === 0 ? (
            <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 w-full max-w-md flex justify-center">
              <LoadingSymbol size="sm" label="Loading monitored areas..." />
            </div>
          ) : customAreas.length > 0 ? (
            <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 w-full max-w-md">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
                Or choose from previously saved areas
              </p>
              <Select value={selectedAreaId} onValueChange={handleAreaChange}>
                <SelectTrigger className="w-full text-xs" data-testid="monitored-area-select-trigger">
                  <SelectValue placeholder="Choose a monitored area to load 3D Twin..." />
                </SelectTrigger>
                <SelectContent>
                  {customAreas.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.name} ({a.district}) — {a.risk} Risk
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-3">
              <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
              {/* View Mode Toggle: 3D Twin vs GIS Map */}
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-300 dark:border-slate-700 shadow-xs">
                <button
                  type="button"
                  onClick={() => setTwinViewMode("3d")}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    twinViewMode === "3d"
                      ? "bg-[#0F4C81] text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  <Boxes className="size-3.5" />
                  <span>3D Digital Twin</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTwinViewMode("gis")}
                  className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    twinViewMode === "gis"
                      ? "bg-[#0F4C81] text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  }`}
                >
                  <Map className="size-3.5" />
                  <span>Area in GIS Map</span>
                </button>
              </div>

              {isRainActive && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 text-xs font-bold animate-pulse">
                  <CloudRain className="size-3.5" />
                  <span>Flash Flood Active</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500">
              {customAreas.length > 1 ? (
                <Select value={selectedAreaId} onValueChange={handleAreaChange}>
                  <SelectTrigger className="h-7 px-2.5 text-xs font-bold bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white" data-testid="header-area-select-trigger">
                    <SelectValue placeholder="Switch Area">
                      {(v) => customAreas.find((a) => a.id === v)?.name || areaTitle || "Switch Area"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {customAreas.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">
                        {a.name} ({a.district})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="font-bold text-slate-700">{areaTitle}</span>
              )}
              <span className="font-mono text-slate-500">Lat: <strong className="text-slate-800">{lat.toFixed(4)}°N</strong></span>
              <span className="font-mono text-slate-500">Lng: <strong className="text-slate-800">{lng.toFixed(4)}°E</strong></span>
              <Link
                to="/gis"
                state={{ area: activeArea }}
                className="text-xs text-sky-600 hover:underline font-sans flex items-center gap-0.5 font-semibold"
                title="Open this area in Full GIS Mapping Page"
              >
                <span>Full GIS Page</span>
                <ArrowRight className="size-3" />
              </Link>
              <button
                type="button"
                onClick={() => {
                  setActiveArea(null);
                  setSelectedAreaId("");
                  setAreaTitle("");
                }}
                className="text-xs text-slate-500 hover:text-slate-700 underline font-sans ml-2 cursor-pointer"
                title="Deselect area"
              >
                Change Area
              </button>
              {activeArea && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!activeArea) return;
                    if (!window.confirm(`Delete monitored area "${activeArea.name}" and all its saved data permanently from database?`)) return;

                    try {
                      await deleteArea(activeArea.id, activeArea.name);

                      const filtered = customAreas.filter((a) => a.id !== activeArea.id);
                      setCustomAreas(filtered);
                      setActiveArea(null);
                      setSelectedAreaId("");
                      setAreaTitle("");
                      toast.success(`Monitored Area "${activeArea.name}" deleted from database.`);
                    } catch (err) {
                      toast.error("Failed to delete area from database");
                    }
                  }}
                  className="text-xs text-rose-600 hover:text-rose-700 font-sans ml-3 font-bold flex items-center gap-1 cursor-pointer hover:underline"
                  title="Permanently delete this GIS Monitored Area from database"
                >
                  <Trash2 className="size-3 text-rose-600" />
                  <span>Delete Area</span>
                </button>
              )}
            </div>
          </div>

          {twinViewMode === "3d" ? (
            <div className="w-full transition-all duration-500 ease-out animate-in fade-in zoom-in-[0.99]">
              <CesiumDigitalTwinViewer
                key="cesium-digital-twin"
                latitude={lat}
                longitude={lng}
                areaName={areaTitle}
                areaId={activeArea?.id}
                polygon={activeArea?.polygon}
                height="620px"
                onViewInGIS={() => setTwinViewMode("gis")}
                isRaining={isRainActive}
                rainfallIntensity={isRainActive ? rainfall : 0}
                windSpeed={wind}
                onToggleRain={(val) => setIsRainActive(val)}
              />
            </div>
          ) : (
            <div className="h-[620px] rounded-xl overflow-hidden border border-slate-300 shadow-md transition-all duration-500 ease-out animate-in fade-in">
              <GISMap
                key={`gis-${lat.toFixed(4)}-${lng.toFixed(4)}-${areaTitle}`}
                customAreas={customAreas}
                selectedArea={activeArea}
                focusedArea={activeArea}
                rainActive={isRainActive}
                rainfallIntensity={isRainActive ? rainfall : 0}
                onToggleRain={(val) => setIsRainActive(val)}
                onSelectArea={(area) => {
                  if (area) {
                    setActiveArea(area);
                    setSelectedAreaId(area.id);
                    setAreaTitle(area.name);
                  }
                }}
                onAreaCreated={(newArea) => {
                  setCustomAreas((prev) => [newArea, ...prev]);
                  setActiveArea(newArea);
                  setSelectedAreaId(newArea.id);
                  setAreaTitle(newArea.name);
                }}
                layers={{
                  customAreas: true,
                  satellite: true,
                  areaLabels: true,
                  boundaries: true,
                  rainSimulation: isRainActive,
                }}
                singleAreaMode={true}
                height="620px"
                testId="twin-gis-map"
              />
            </div>
          )}
        </div>
      )}

    </div>
  );
}

export function RiskAssessmentPage() {
  const { data, isLoading } = useQuery({ queryKey: ["risk"], queryFn: () => apiGet<RiskAssessment[]>("/risk"), retry: false });
  const list = data ?? [];
  const [selectedId, setSelectedId] = useState("");
  const active = list.find((r) => r.zone_id === selectedId) ?? list[0] ?? null;

  return (
    <div data-testid="risk-assessment-page">
      <PageHeader title="AI Risk Assessment" description="Multi-agent risk scoring derived from live telemetry, satellite intelligence and historical hazard datasets." />

      {isLoading ? (
        <LoadingRows rows={4} />
      ) : !active ? (
        <EmptyState testId="risk-empty" title="No assessments available" description="Risk scoring becomes available once monitoring zones report telemetry." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="border-slate-200/80 p-5" data-testid="risk-zone-list">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Monitoring Zones</p>
            <ul className="mt-4 space-y-2">
              {list.map((r) => (
                <li key={r.zone_id}>
                  <button
                    onClick={() => setSelectedId(r.zone_id)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ${active.zone_id === r.zone_id ? "border-[#0F4C81] bg-[#0F4C81]/5" : "border-slate-200 hover:bg-slate-50"}`}
                    data-testid={`risk-zone-btn-${r.zone_id}`}
                  >
                    <span className="block text-sm font-semibold text-slate-900">{r.zone_name}</span>
                    <span className="mt-1 flex items-center justify-between">
                      <RiskIndicator level={r.risk_level} />
                      <span className="font-mono text-sm font-bold text-slate-900">{r.risk_score}%</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-6">
            <SectionCard testId="risk-score-card" title={`Current risk score — ${active.zone_name}`} description={`Last analysis ${new Date(active.analyzed_at).toLocaleString()}`}>
              <div className="flex flex-wrap items-center gap-8">
                <div className="relative grid size-36 place-items-center">
                  <svg viewBox="0 0 120 120" className="size-36 -rotate-90">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="#E2E8F0" strokeWidth="10" />
                    <circle
                      cx="60" cy="60" r="52" fill="none"
                      stroke={active.risk_score >= 75 ? "#DC2626" : active.risk_score >= 55 ? "#EA580C" : active.risk_score >= 30 ? "#D97706" : "#15803D"}
                      strokeWidth="10" strokeLinecap="round"
                      strokeDasharray={`${(active.risk_score / 100) * 327} 327`}
                    />
                  </svg>
                  <div className="absolute text-center">
                    <p className="font-mono text-3xl font-bold text-slate-900" data-testid="risk-score-value">{active.risk_score}%</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{active.risk_level}</p>
                  </div>
                </div>
                <div className="min-w-[220px] flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Contributing factors</p>
                  <ul className="mt-3 space-y-2.5">
                    {active.factors.map((f) => (
                      <li key={f.name} data-testid={`risk-factor-${f.name.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700">{f.name}</span>
                          <span className="font-mono text-slate-500">{f.value}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-[#0F4C81]" style={{ width: `${Math.min(100, f.weight * 2.8)}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </SectionCard>

            <SectionCard testId="risk-recommendation-card" title="AI recommendation" description={`Confidence ${active.confidence}%`}>
              <p className="flex items-start gap-3 rounded-lg border border-[#0F4C81]/20 bg-[#0F4C81]/[0.05] px-4 py-3 text-sm leading-relaxed text-slate-800" data-testid="risk-recommendation-text">
                <Brain className="mt-0.5 size-4 shrink-0 text-[#0F4C81]" />
                {active.recommendation}
              </p>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Data sources used</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">{active.data_sources.map((d) => <li key={d}>• {d}</li>)}</ul>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Models applied</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">{active.models_used.map((m) => <li key={m}>• {m}</li>)}</ul>
                </div>
              </div>
              <p className="mt-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900" data-testid="risk-disclaimer">
                <Info className="mt-0.5 size-4 shrink-0" />
                {active.disclaimer}
              </p>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}

const LEVELS = ["critical", "high", "medium", "low"] as const;

export function AlertsPage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const [level, setLevel] = useState("");
  const [hazard, setHazard] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");

  const params = new URLSearchParams();
  if (level) params.set("risk_level", level);
  if (hazard) params.set("hazard_type", hazard);
  if (status) params.set("status", status);
  if (query) params.set("location", query);
  const qs = params.toString();

  const { data, isLoading } = useQuery({
    queryKey: ["alerts", qs],
    queryFn: () => apiGet<Alert[]>(`/alerts${qs ? `?${qs}` : ""}`),
    retry: false,
  });

  const act = useMutation({
    mutationFn: (vars: { id: string; action: string; assigned_to?: string }) =>
      apiPost<Alert>(`/alerts/${vars.id}/action`, { action: vars.action, assigned_to: vars.assigned_to ?? "" }),
    onSuccess: (a) => {
      toast.success(`Alert ${a.code} → ${a.status}`);
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Action failed.")),
  });

  const list = data ?? [];
  const canAct = user?.role !== "viewer";

  return (
    <div data-testid="alerts-page">
      <PageHeader title="Alerts Center" description="Government-grade alert triage — acknowledge, assign and resolve hazard notifications." />

      <Card className="mb-6 border-slate-200/80 p-5" data-testid="alert-filters">
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label>Risk Level</Label>
            <Select value={level} onValueChange={(v: string) => setLevel(v === "all" ? "" : v)}>
              <SelectTrigger className="mt-1.5 w-full" data-testid="alert-filter-level"><SelectValue placeholder="All levels">{(v) => (v === "all" || !v ? "All levels" : String(v).toUpperCase())}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="alert-filter-level-all">All levels</SelectItem>
                {LEVELS.map((l) => <SelectItem key={l} value={l} data-testid={`alert-filter-level-${l}`}>{l.toUpperCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Hazard Type</Label>
            <Select value={hazard} onValueChange={(v: string) => setHazard(v === "all" ? "" : v)}>
              <SelectTrigger className="mt-1.5 w-full" data-testid="alert-filter-hazard"><SelectValue placeholder="All hazards">{(v) => (v === "all" || !v ? "All hazards" : HAZARD_LABELS[v as string] ?? String(v))}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="alert-filter-hazard-all">All hazards</SelectItem>
                {Object.entries(HAZARD_LABELS).map(([k, v]) => <SelectItem key={k} value={k} data-testid={`alert-filter-hazard-${k}`}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v: string) => setStatus(v === "all" ? "" : v)}>
              <SelectTrigger className="mt-1.5 w-full" data-testid="alert-filter-status"><SelectValue placeholder="All statuses">{(v) => (v === "all" || !v ? "All statuses" : String(v))}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="alert-filter-status-all">All statuses</SelectItem>
                {["open", "acknowledged", "assigned", "resolved"].map((s) => <SelectItem key={s} value={s} data-testid={`alert-filter-status-${s}`}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="alert-search">Location</Label>
            <Input id="alert-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="District or zone" className="mt-1.5" data-testid="alert-filter-location" />
          </div>
        </div>
      </Card>

      {isLoading ? (
        <LoadingRows rows={4} />
      ) : list.length === 0 ? (
        <EmptyState testId="alerts-empty" title="No alerts match these filters" description="Adjust the risk level, hazard type or location filters." />
      ) : (
        <div className="space-y-4" data-testid="alerts-list">
          {list.map((a) => (
            <Card key={a.id} className="border-slate-200/80 p-5" data-testid={`alert-card-${a.code}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <RiskIndicator level={a.risk_level} testId={`alert-risk-${a.code}`} />
                    <StatusPill status={a.status} testId={`alert-status-${a.code}`} />
                    <span className="font-mono text-[11px] font-semibold text-slate-400">{a.code}</span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold text-slate-900">{a.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{a.detail}</p>
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                    {a.location} · {HAZARD_LABELS[a.hazard_type] ?? a.hazard_type} · {new Date(a.created_at).toLocaleString()}
                    {a.assigned_to ? ` · assigned to ${a.assigned_to}` : ""}
                  </p>
                </div>
                {canAct ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={act.isPending || a.status !== "open"} onClick={() => act.mutate({ id: a.id, action: "acknowledge" })} data-testid={`alert-acknowledge-btn-${a.code}`}>Acknowledge</Button>
                    <Button variant="outline" size="sm" disabled={act.isPending || a.status === "resolved"} onClick={() => act.mutate({ id: a.id, action: "assign", assigned_to: `${user?.first_name ?? "Officer"} ${user?.last_name ?? ""}`.trim() })} data-testid={`alert-assign-btn-${a.code}`}>Assign Officer</Button>
                    <Button size="sm" disabled={act.isPending || a.status === "resolved"} onClick={() => act.mutate({ id: a.id, action: "resolve" })} data-testid={`alert-resolve-btn-${a.code}`}>Resolve</Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const qc = useQueryClient();
  const { user } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ["reports"], queryFn: () => apiGet<Report[]>("/reports"), retry: false });
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: () => apiPost<Report>("/reports", { title, report_type: "Risk Assessment", period: "Last 30 days" }),
    onSuccess: () => {
      toast.success("Report generated and queued for download");
      setTitle("");
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Report generation failed.")),
  });

  const list = useMemo(() => {
    const backendReports = data ?? [];
    let localReports: Report[] = [];
    try {
      const raw = localStorage.getItem("dt_saved_flood_reports");
      if (raw) {
        localReports = JSON.parse(raw);
      }
    } catch (e) {
      console.warn("Failed to parse local flood reports", e);
    }
    const seen = new Set(backendReports.map((r) => r.id));
    const merged = [...backendReports];
    for (const r of localReports) {
      if (!seen.has(r.id)) {
        merged.unshift(r);
        seen.add(r.id);
      }
    }
    return merged;
  }, [data]);
  const canCreate = user?.role === "admin" || user?.role === "gov_officer";

  const download = (r: Report) => {
    if (r.simulation_report) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(r.simulation_report, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `flood-simulation-${r.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const csv = `Title,Type,Period,Zone,Status,Generated\n"${r.title}","${r.report_type}","${r.period}","${r.zone_name}","${r.status}","${r.created_at}"\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.title.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report exported as CSV");
  };

  return (
    <div data-testid="reports-page">
      {selectedReport?.simulation_report && <FloodImpactReport buildings={selectedReport.simulation_report.buildings}
        scenario={selectedReport.simulation_report.scenario} completedReport={selectedReport.simulation_report}
        saveStatus="Saved to Reports" onDismiss={() => setSelectedReport(null)} />}
      <PageHeader title="Reports" description="Generated hazard, risk and compliance reports available for departmental export." />

      {canCreate ? (
        <Card className="mb-6 border-slate-200/80 p-5" data-testid="report-generator">
          <Label htmlFor="report-title">Generate a new report</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monsoon Risk Digest — Wayanad" className="max-w-md" data-testid="report-title-input" />
            <Button disabled={title.trim().length < 3 || create.isPending} onClick={() => create.mutate()} data-testid="report-generate-btn">
              <FileText className="mr-2 size-4" /> {create.isPending ? "Generating…" : "Generate Report"}
            </Button>
          </div>
        </Card>
      ) : null}

      <SectionCard testId="reports-card" title="Report library" description={`${list.length} reports available`}>
        {isLoading ? (
          <LoadingRows rows={3} />
        ) : list.length === 0 ? (
          <EmptyState testId="reports-empty" title="No reports yet" description="Generate a report to build the departmental library." />
        ) : (
          <Table data-testid="reports-table">
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Export</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.id} data-testid={`report-row-${r.id}`}>
                  <TableCell className="font-medium">{r.title}{r.simulation_report && <div className="mt-1 text-xs font-normal text-slate-500">{r.simulation_report.summary.affectedDuringRun} exposed / {r.simulation_report.summary.assessed} assessed buildings · {Number(r.simulation_report.scenario.elapsedSeconds).toFixed(0)} simulated seconds</div>}</TableCell>
                  <TableCell className="text-xs text-slate-500">{r.report_type}</TableCell>
                  <TableCell className="text-xs text-slate-500">{r.period}</TableCell>
                  <TableCell><StatusPill status={r.status} /></TableCell>
                  <TableCell className="text-right">
                    {r.simulation_report ? (
                      <>
                        <Button
                          variant="outline"
                          size="xs"
                          className="mr-2 border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                          onClick={() => {
                            downloadFloodReportPdf({
                              areaName: r.title,
                              scenario: r.simulation_report?.scenario,
                              buildings: r.simulation_report?.buildings || [],
                              generatedAt: r.created_at,
                              reportData: (r.simulation_report as any)?.standardReport,
                            });
                            toast.success("Downloaded Official 12-Section PDF Report");
                          }}
                          data-testid={`report-pdf-btn-${r.id}`}
                        >
                          <FileText className="mr-1.5 size-3.5 text-red-500" /> PDF
                        </Button>
                        <Button variant="outline" size="xs" className="mr-2" onClick={() => setSelectedReport(r)}>View report</Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="xs"
                        className="mr-2 border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                        onClick={() => {
                          downloadFloodReportPdf({
                            areaName: r.title,
                            scenario: { model: r.report_type, elapsedSeconds: 0 },
                            buildings: [],
                            generatedAt: r.created_at,
                          });
                          toast.success("Downloaded PDF Report");
                        }}
                        data-testid={`report-pdf-btn-${r.id}`}
                      >
                        <FileText className="mr-1.5 size-3.5 text-red-500" /> PDF
                      </Button>
                    )}
                    <Button variant="outline" size="xs" onClick={() => download(r)} data-testid={`report-download-btn-${r.id}`}>
                      <Download className="mr-1.5 size-3.5" /> {r.simulation_report ? "JSON" : "CSV"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}

export function SensorManagementPage() {
  return <SensorManagementSection />;
}

export const MONITORED_AREAS = [
  {
    id: "Pollachi Catchment Basin",
    label: "Pollachi Catchment Basin",
    tag: "LORA_NODE_1 Primary",
    desc: "Riverbed gauge (94mm), high flash flood risk",
    shelterName: "Pollachi High Ground Relief Camp Alpha",
    defaultLat: 10.6695,
    defaultLng: 77.0190,
    defaultElev: 310.5,
    instructions: "Follow north high-ground corridor away from riverbed.",
  },
  {
    id: "Aliyar River Corridor & Dam Sector",
    label: "Aliyar River Corridor & Dam Sector",
    tag: "Downstream Surge",
    desc: "Spillway discharge overflow corridor and agricultural plains",
    shelterName: "Aliyar Dam Elevated Emergency Center",
    defaultLat: 10.4920,
    defaultLng: 76.9740,
    defaultElev: 345.0,
    instructions: "Move east toward Aliyar Hill Ridge safe zone.",
  },
  {
    id: "Upper Sholayar Slopes & Valparai",
    label: "Upper Sholayar Slopes & Valparai",
    tag: "Hillside Slopes",
    desc: "Critical slope shear & pore saturation, landslide risk",
    shelterName: "Valparai Upper Ridge Community Center",
    defaultLat: 10.3250,
    defaultLng: 76.9550,
    defaultElev: 1050.0,
    instructions: "Evacuate steep drainage gullies toward tea estate plateau.",
  },
  {
    id: "Thirumoorthy Catchment Sector",
    label: "Thirumoorthy Catchment Sector",
    tag: "Reservoir Zone",
    desc: "Reservoir catchment and downstream settlements",
    shelterName: "Meenkara High Safe Zone Camp",
    defaultLat: 10.6120,
    defaultLng: 76.8120,
    defaultElev: 285.0,
    instructions: "Head west on elevated bund road toward relief camp.",
  },
  {
    id: "All Monitored Catchment Zones",
    label: "All Catchment Zones",
    tag: "Full Basin",
    desc: "Multi-sector dispatch covering entire monitored watershed",
    shelterName: "Pollachi Central High Ground Camp",
    defaultLat: 10.6695,
    defaultLng: 77.0190,
    defaultElev: 310.5,
    instructions: "Proceed immediately to the nearest designated high ground shelter.",
  },
];

export const SHELTER_PRESETS = [
  {
    name: "Pollachi High Ground Relief Camp Alpha",
    lat: 10.6695,
    lng: 77.0190,
    elev: 310.5,
    instructions: "Follow north high-ground corridor away from riverbed.",
  },
  {
    name: "Aliyar Dam Elevated Emergency Center",
    lat: 10.4920,
    lng: 76.9740,
    elev: 345.0,
    instructions: "Move east toward Aliyar Hill Ridge safe zone.",
  },
  {
    name: "Valparai Upper Ridge Community Center",
    lat: 10.3250,
    lng: 76.9550,
    elev: 1050.0,
    instructions: "Evacuate steep drainage gullies toward tea estate plateau.",
  },
  {
    name: "Meenkara High Safe Zone Camp",
    lat: 10.6120,
    lng: 76.8120,
    elev: 285.0,
    instructions: "Head west on elevated bund road toward relief camp.",
  },
];

function EvacuationMapPicker({
  value,
  onChange,
}: {
  value: MobUserEvacuationPayload;
  onChange: (updated: MobUserEvacuationPayload) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const initialLat = value.latitude || 10.6695;
    const initialLng = value.longitude || 77.0190;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 12,
      zoomControl: true,
      attributionControl: false,
    });
    mapInstanceRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
    }).addTo(map);

    // Preset shelter pins
    SHELTER_PRESETS.forEach((s) => {
      const presetIcon = L.divIcon({
        className: "custom-shelter-pin",
        html: `<div style="background-color: #0284c7; color: white; padding: 2px 6px; border-radius: 9999px; font-size: 10px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); white-space: nowrap; cursor: pointer;">🏕️ ${s.name.split(" ")[0]}</div>`,
        iconSize: [80, 24],
        iconAnchor: [40, 12],
      });
      const m = L.marker([s.lat, s.lng], { icon: presetIcon }).addTo(map);
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onChange({
          shelter_name: s.name,
          latitude: s.lat,
          longitude: s.lng,
          elevation_m: s.elev,
          instructions: s.instructions,
        });
      });
    });

    // Custom Selected Pin Icon
    const selectedIcon = L.divIcon({
      className: "selected-evac-pin",
      html: `<div style="display:flex; flex-direction:column; align-items:center; cursor:grab;">
        <div style="background:#e11d48; color:white; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:6px; box-shadow:0 2px 8px rgba(225,29,72,0.5); border:1px solid white; white-space:nowrap;">📍 SAFE SHELTER</div>
        <div style="width:0; height:0; border-left:6px solid transparent; border-right:6px solid transparent; border-top:8px solid #e11d48;"></div>
      </div>`,
      iconSize: [100, 36],
      iconAnchor: [50, 36],
    });

    const marker = L.marker([initialLat, initialLng], {
      icon: selectedIcon,
      draggable: true,
    }).addTo(map);
    markerRef.current = marker;

    const circle = L.circle([initialLat, initialLng], {
      radius: 600,
      color: "#2563eb",
      fillColor: "#3b82f6",
      fillOpacity: 0.18,
      weight: 1.5,
      dashArray: "4, 4",
    }).addTo(map);
    circleRef.current = circle;

    const handleCoordUpdate = (lat: number, lng: number) => {
      marker.setLatLng([lat, lng]);
      circle.setLatLng([lat, lng]);
      const elev = Math.round(285 + Math.abs(lat - 10.65) * 1200 + Math.abs(lng - 77.0) * 850);
      onChange({
        shelter_name: `Safe High Ground Shelter (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        latitude: lat,
        longitude: lng,
        elevation_m: elev,
        instructions: `Proceed to designated safe elevation shelter coordinate [${lat.toFixed(4)}, ${lng.toFixed(4)}]. Elevation: ${elev}m.`,
      });
    };

    map.on("click", (e: L.LeafletMouseEvent) => {
      const lat = Number(e.latlng.lat.toFixed(5));
      const lng = Number(e.latlng.lng.toFixed(5));
      handleCoordUpdate(lat, lng);
    });

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      const lat = Number(pos.lat.toFixed(5));
      const lng = Number(pos.lng.toFixed(5));
      handleCoordUpdate(lat, lng);
    });

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update marker position when value coordinates change externally
  useEffect(() => {
    if (markerRef.current && circleRef.current && mapInstanceRef.current) {
      const lat = value.latitude || 10.6695;
      const lng = value.longitude || 77.0190;
      markerRef.current.setLatLng([lat, lng]);
      circleRef.current.setLatLng([lat, lng]);
      mapInstanceRef.current.setView([lat, lng], mapInstanceRef.current.getZoom(), { animate: true });
    }
  }, [value.latitude, value.longitude]);

  return (
    <div className="relative rounded-lg overflow-hidden border border-blue-300 shadow-inner">
      <div
        ref={mapContainerRef}
        data-testid="evacuation-leaflet-map"
        className="h-44 w-full bg-slate-100 cursor-crosshair z-0"
      />
      <div className="absolute bottom-1.5 left-2 z-10 bg-slate-900/85 text-white text-[9px] px-2 py-0.5 rounded backdrop-blur-xs font-mono pointer-events-none flex items-center gap-1.5">
        <MapPin className="size-3 text-rose-400" />
        Click anywhere on map to drop shelter location pin
      </div>
    </div>
  );
}

export function UserManagementPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"mob_users" | "mob_alerts" | "officers">("mob_users");

  // 1. Supabase mob_users Query
  const mobUsersQuery = useQuery({
    queryKey: ["mob-users"],
    queryFn: () => apiGet<MobUser[]>("/mob-users"),
    refetchInterval: 8000,
  });

  // 2. Dispatched mob_alerts Query
  const mobAlertsQuery = useQuery<MobAlertRecord[]>({
    queryKey: ["mob-alerts"],
    queryFn: () => apiGet<MobAlertRecord[]>("/mob-alerts"),
    refetchInterval: 6000,
  });

  // 3. Officers Query
  const officersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<User[]>("/users"),
    retry: false,
  });

  // Officer Update
  const updateOfficer = useMutation({
    mutationFn: (vars: { id: string; role?: Role; status?: string }) =>
      apiPatch<User>(`/users/${vars.id}`, { role: vars.role, status: vars.status }),
    onSuccess: (u) => {
      toast.success(`${u.email} clearance updated`);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  // Citizen Emergency Alert State & Mutations
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertTarget, setAlertTarget] = useState<"monitored_zone" | "all" | "selected">("monitored_zone");
  const [monitoredArea, setMonitoredArea] = useState<string>("Pollachi Catchment Basin");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [hazardType, setHazardType] = useState<"Flood" | "Landslide">("Flood");
  const [channels, setChannels] = useState<string[]>(["call", "message", "in_app"]);
  const [dispatchMode, setDispatchMode] = useState<"manual" | "automatic">("manual");
  const [includeEvacuation, setIncludeEvacuation] = useState<boolean>(true);

  const [alertForm, setAlertForm] = useState<MobUserAlertPayload>({
    hazard_type: "Flash Flood",
    risk_level: "critical",
    title: "Flash Flood Warning - High River Surge",
    detail: "River water levels have reached critical threshold (94mm). Seek high ground immediately and avoid low-lying bridges and riverbanks.",
    channels: ["call", "message", "in_app"],
    dispatch_mode: "manual",
    monitored_area: "Pollachi Catchment Basin",
  });

  const [evacForm, setEvacForm] = useState<MobUserEvacuationPayload>({
    shelter_name: "Pollachi High Ground Relief Camp Alpha",
    latitude: 10.6695,
    longitude: 77.0190,
    elevation_m: 310.5,
    instructions: "Follow north high-ground corridor away from riverbed. Drinking water, dry rations, and medical aid available.",
  });

  const sendAlertMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: MobUserAlertPayload }) =>
      apiPost(`/mob-users/${userId}/alert`, payload),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Emergency alert dispatched to citizen");
      setIsAlertModalOpen(false);
      qc.invalidateQueries({ queryKey: ["mob-users"] });
      qc.invalidateQueries({ queryKey: ["mob-alerts"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Failed to dispatch emergency alert")),
  });

  const broadcastAlertMutation = useMutation({
    mutationFn: (payload: MobUserBroadcastAlertPayload) =>
      apiPost("/mob-users/broadcast-alert", payload),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Emergency alert successfully broadcasted");
      setIsAlertModalOpen(false);
      qc.invalidateQueries({ queryKey: ["mob-users"] });
      qc.invalidateQueries({ queryKey: ["mob-alerts"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Failed to broadcast emergency alert")),
  });

  // Citizen Evacuation Modal State & Mutation
  const [evacTargetUser, setEvacTargetUser] = useState<MobUser | null>(null);

  const sendEvacMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: MobUserEvacuationPayload }) =>
      apiPost(`/mob-users/${userId}/evacuation-point`, payload),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Evacuation shelter assigned to citizen");
      setEvacTargetUser(null);
      qc.invalidateQueries({ queryKey: ["mob-users"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Failed to assign evacuation point")),
  });

  // Clear Alert Mutation
  const clearAlertMutation = useMutation({
    mutationFn: (userId: string) => apiDelete(`/mob-users/${userId}/alert`),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Alert cleared");
      qc.invalidateQueries({ queryKey: ["mob-users"] });
      qc.invalidateQueries({ queryKey: ["mob-alerts"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const mobUsersList = mobUsersQuery.data ?? [];
  const mobAlertsList = mobAlertsQuery.data ?? [];
  const officersList = officersQuery.data ?? [];

  const activeAlertsCount = mobUsersList.filter(
    (u) => u.preferences?.active_alert && u.preferences.active_alert.active
  ).length;
  const assignedEvacCount = mobUsersList.filter(
    (u) => u.preferences?.evacuation_point
  ).length;

  // Monitored Zone Detection (Pollachi Catchment Basin & Coordinates)
  const isUserInMonitoredZone = (u: MobUser) => {
    const loc = (u.location_name || "").toLowerCase();
    const lat = u.latitude;
    const lng = u.longitude;
    const inBbox = lat != null && lng != null && lat >= 10.50 && lat <= 10.80 && lng >= 76.85 && lng <= 77.15;
    const inText = ["pollachi", "catchment", "basin", "sector", "zone", "coimbatore", "aliyar", "sholayar", "valparai"].some((k) => loc.includes(k));
    return inBbox || inText || (lat == null && lng == null);
  };
  const monitoredZoneUsers = mobUsersList.filter(isUserInMonitoredZone);

  return (
    <div data-testid="user-management-page" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="User & Citizen Management"
          description="Manage mobile app citizens (mob_users) in Supabase, dispatch targeted emergency alerts, assign evacuation shelters, and manage departmental officers."
        />
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
          <button
            data-testid="tab-mob-users-btn"
            onClick={() => setActiveTab("mob_users")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
              activeTab === "mob_users"
                ? "bg-rose-700 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Phone className="size-3.5" />
            Mobile App Citizens ({mobUsersList.length})
            {activeAlertsCount > 0 && (
              <span className="flex size-2 rounded-full bg-rose-400 ring-2 ring-rose-300 animate-ping ml-1" />
            )}
          </button>
          <button
            data-testid="tab-mob-alerts-btn"
            onClick={() => setActiveTab("mob_alerts")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
              activeTab === "mob_alerts"
                ? "bg-rose-700 text-white shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ShieldAlert className="size-3.5" />
            Dispatched Alerts (mob_alerts DB) ({mobAlertsList.length})
          </button>
          <button
            data-testid="tab-officers-btn"
            onClick={() => setActiveTab("officers")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
              activeTab === "officers"
                ? "bg-slate-900 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <UserCheck className="size-3.5" />
            Departmental Officers ({officersList.length})
          </button>
        </div>
      </div>

      {activeTab === "mob_users" ? (
        <div className="space-y-6">
          {/* Supabase Integration Summary Card */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-rose-200 bg-linear-to-br from-rose-50/70 to-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-rose-800">
                  Registered Citizens
                </span>
                <Phone className="size-4 text-rose-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-3xl font-extrabold text-rose-950">
                  {mobUsersList.length}
                </span>
                <span className="text-xs text-rose-700">Supabase mob_users</span>
              </div>
              <p className="mt-1 text-[11px] text-rose-800/80">
                Connected directly to citizen mobile handsets
              </p>
            </Card>

            <Card className="border-amber-200 bg-linear-to-br from-amber-50/70 to-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                  Active Dispatched Alerts
                </span>
                <ShieldAlert className="size-4 text-amber-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-3xl font-extrabold text-amber-950">
                  {activeAlertsCount}
                </span>
                <span className="text-xs text-amber-700">citizens alerted</span>
              </div>
              <p className="mt-1 text-[11px] text-amber-800/80">
                Live banner warnings displayed on handsets
              </p>
            </Card>

            <Card className="border-blue-200 bg-linear-to-br from-blue-50/70 to-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-800">
                  Assigned Evacuations
                </span>
                <Navigation className="size-4 text-blue-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-3xl font-extrabold text-blue-950">
                  {assignedEvacCount}
                </span>
                <span className="text-xs text-blue-700">shelters designated</span>
              </div>
              <p className="mt-1 text-[11px] text-blue-800/80">
                Turn-by-turn high-ground shelters dispatched
              </p>
            </Card>
          </div>

          {/* Citizen Table */}
          <SectionCard
            testId="mob-users-card"
            title="Mobile Citizens Directory (Supabase mob_users)"
            description="Real-time geo-located citizen handsets in the flash flood basin. Send emergency warnings and designated evacuation shelters directly."
            actions={
              <Button
                data-testid="open-broadcast-alert-btn"
                onClick={() => {
                  setAlertTarget("monitored_zone");
                  setIsAlertModalOpen(true);
                }}
                size="sm"
                className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-950/40 cursor-pointer"
              >
                <Radio className="size-3.5 mr-1.5" />
                Send Emergency Alert
              </Button>
            }
          >
            {mobUsersQuery.isLoading ? (
              <LoadingRows rows={4} />
            ) : mobUsersList.length === 0 ? (
              <EmptyState
                testId="mob-users-empty"
                title="No Citizens Registered in Supabase"
                description="When citizens launch the mobile application, their profiles will synchronize here automatically."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Citizen</TableHead>
                      <TableHead className="w-[220px]">Live Location &amp; Coords</TableHead>
                      <TableHead className="w-[230px]">Active Emergency Alert</TableHead>
                      <TableHead className="w-[230px]">Assigned Evacuation Shelter</TableHead>
                      <TableHead className="w-[180px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mobUsersList.map((user) => {
                      const activeAlert = user.preferences?.active_alert;
                      const hasAlert = activeAlert && activeAlert.active;
                      const evacPoint = user.preferences?.evacuation_point;
                      const inMonitoredZone = isUserInMonitoredZone(user);

                      return (
                        <TableRow key={user.id} className="text-xs">
                          <TableCell>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-900 text-sm">
                                  {user.full_name || "Anonymous Citizen"}
                                </span>
                                {inMonitoredZone && (
                                  <span
                                    data-testid={`monitored-zone-badge-${user.id}`}
                                    className="inline-flex items-center gap-0.5 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-700 border border-rose-200"
                                  >
                                    <MapPin className="size-2.5 text-rose-600" />
                                    Monitored Zone
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-slate-500 mt-0.5">
                                {user.phone_number || "No phone number"}
                              </span>
                              <div className="mt-1">
                                <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                  Lang: {user.language === "ta" ? "தமிழ் (Tamil)" : "English"}
                                </span>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="font-medium text-slate-800">
                                {user.location_name || "Pollachi Catchment Basin"}
                              </span>
                              {user.latitude && user.longitude ? (
                                <div className="flex items-center gap-1.5 font-mono text-[11px] text-blue-700 bg-blue-50/80 px-2 py-1 rounded-md border border-blue-100 w-fit">
                                  <MapPin className="size-3 text-blue-600 shrink-0" />
                                  <span>
                                    {user.latitude.toFixed(6)}°N, {user.longitude.toFixed(6)}°E
                                  </span>
                                  {user.location_accuracy_m && (
                                    <span className="text-slate-400 text-[10px]">
                                      (±{user.location_accuracy_m}m)
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">No GPS coordinates</span>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            {hasAlert ? (
                              <div className="rounded-lg border border-red-200 bg-red-50 p-2 max-w-xs space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 font-bold text-[10px] text-white uppercase">
                                    <AlertTriangle className="size-2.5" />
                                    {activeAlert.risk_level || "CRITICAL"}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    className="h-5 px-1.5 text-red-700 hover:bg-red-100"
                                    onClick={() => clearAlertMutation.mutate(user.id)}
                                    title="Clear alert for this user"
                                  >
                                    <X className="size-3 mr-0.5" /> Clear
                                  </Button>
                                </div>
                                <p className="font-bold text-red-950 text-xs">{activeAlert.title}</p>
                                <p className="text-[11px] text-red-800 line-clamp-2">{activeAlert.detail}</p>
                                {activeAlert.channels && (
                                  <div className="flex items-center gap-1 pt-0.5 text-[9px] text-red-700 font-mono">
                                    <span>Channels: {activeAlert.channels.join(", ")}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="size-3" />
                                Normal / No Alert
                              </span>
                            )}
                          </TableCell>

                          <TableCell>
                            {evacPoint ? (
                              <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 max-w-xs space-y-1">
                                <div className="flex items-center gap-1 font-bold text-blue-950 text-xs">
                                  <Navigation className="size-3 text-blue-600" />
                                  <span>{evacPoint.shelter_name}</span>
                                </div>
                                <div className="font-mono text-[10px] text-blue-700">
                                  Coords: {evacPoint.latitude}, {evacPoint.longitude}{" "}
                                  {evacPoint.elevation_m ? `(${evacPoint.elevation_m}m)` : ""}
                                </div>
                                {evacPoint.instructions && (
                                  <p className="text-[10px] text-blue-800 line-clamp-2">
                                    {evacPoint.instructions}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs italic">None assigned</span>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex flex-col gap-1.5 items-end justify-center">
                              <Button
                                size="xs"
                                data-testid={`send-alert-user-${user.id}`}
                                className="w-28 justify-center bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                                onClick={() => {
                                  setSelectedUserId(user.id);
                                  setAlertTarget("selected");
                                  setIsAlertModalOpen(true);
                                  setAlertForm((prev) => ({
                                    ...prev,
                                    hazard_type: hazardType === "Flood" ? "Flash Flood" : "Landslide",
                                    title: hazardType === "Flood" ? "Flash Flood Warning - High River Surge" : "Landslide Warning - Slope Instability",
                                    detail: hazardType === "Flood"
                                      ? `River water levels have reached critical threshold (94mm) near ${user.location_name || "your area"}. Seek elevated high ground immediately.`
                                      : `Critical slope shear detected near ${user.location_name || "your area"}. Evacuate unstable hillside terrain immediately.`,
                                  }));
                                }}
                              >
                                <AlertTriangle className="size-3 mr-1" />
                                Send Alert
                              </Button>

                              <Button
                                size="xs"
                                variant="outline"
                                className="w-28 justify-center border-blue-300 text-blue-700 hover:bg-blue-50 font-semibold"
                                onClick={() => {
                                  setEvacTargetUser(user);
                                  setEvacForm({
                                    shelter_name: "Pollachi High Ground Relief Camp Alpha",
                                    latitude: 10.6695,
                                    longitude: 77.0190,
                                    elevation_m: 310.5,
                                    instructions: `Proceed immediately to designated high-ground relief camp from ${user.location_name || "current coordinates"}. Food, medical aid, and shelter available.`,
                                  });
                                }}
                              >
                                <Navigation className="size-3 mr-1" />
                                Evac Point
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>

          {/* Recent Dispatched Alerts (Database: mob_alerts) */}
          <SectionCard
            testId="mob-alerts-summary-card"
            title="Dispatched Emergency Alerts (Database: mob_alerts)"
            description={`${mobAlertsList.length} alerts successfully logged in new db collection mob_alerts.`}
            actions={
              <Button
                variant="outline"
                size="xs"
                data-testid="switch-to-mob-alerts-btn"
                onClick={() => setActiveTab("mob_alerts")}
                className="text-xs border-rose-300 text-rose-700 hover:bg-rose-50 cursor-pointer"
              >
                View Full Alert Log ({mobAlertsList.length}) <ArrowRight className="size-3 ml-1" />
              </Button>
            }
          >
            {mobAlertsList.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-3">
                No emergency alerts recorded yet. Click "Send Emergency Alert" to broadcast to citizens.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alert Code</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Monitored Area</TableHead>
                      <TableHead>Hazard</TableHead>
                      <TableHead>Channels</TableHead>
                      <TableHead>Evacuation Shelter</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mobAlertsList.slice(0, 5).map((a) => (
                      <TableRow key={a.id || a.alert_code} data-testid={`summary-alert-${a.alert_code}`}>
                        <TableCell className="font-mono text-xs font-bold text-rose-700">{a.alert_code}</TableCell>
                        <TableCell className="text-xs font-medium">{a.recipient_name} ({a.recipient_phone})</TableCell>
                        <TableCell className="text-xs text-slate-700">
                          <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-900 border border-rose-200">
                            <MapPin className="size-2.5 text-rose-600" />
                            {a.monitored_area || "Pollachi Catchment Basin"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-rose-50 text-rose-900 border border-rose-200">
                            {a.hazard_type}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 font-mono">{(a.channels || []).join(", ")}</TableCell>
                        <TableCell className="text-xs text-blue-900 truncate max-w-[180px]">
                          {a.evacuation_point?.shelter_name || "None"}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="size-3" />
                            {a.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>

          {/* Comprehensive Emergency Alert & Evacuation Modal */}
          {isAlertModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
              <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
                {/* Modal Header */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 text-rose-700">
                    <ShieldAlert className="size-5" />
                    <h3 className="font-bold text-slate-900 text-base">
                      Dispatch Emergency Alert &amp; Evacuation Order
                    </h3>
                  </div>
                  <button
                    data-testid="close-alert-modal-btn"
                    onClick={() => setIsAlertModalOpen(false)}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                {/* 1. Target Option: 1st option is Monitored Zone, also All Users, or Selected User */}
                <div>
                  <Label className="text-xs font-semibold text-slate-700">1. Target Recipients</Label>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {/* 1st option: Users in Monitored Zone */}
                    <button
                      type="button"
                      data-testid="target-monitored-zone-btn"
                      onClick={() => setAlertTarget("monitored_zone")}
                      className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                        alertTarget === "monitored_zone"
                          ? "border-rose-500 bg-rose-50/90 ring-2 ring-rose-300 text-rose-950 font-bold"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <MapPin className="size-4 text-rose-600 shrink-0" />
                        <span className="text-xs">Monitored Zone</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        {monitoredZoneUsers.length} citizens in catchment
                      </p>
                    </button>

                    {/* 2nd option: All Users */}
                    <button
                      type="button"
                      data-testid="target-all-users-btn"
                      onClick={() => setAlertTarget("all")}
                      className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                        alertTarget === "all"
                          ? "border-rose-500 bg-rose-50/90 ring-2 ring-rose-300 text-rose-950 font-bold"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Users className="size-4 text-rose-600 shrink-0" />
                        <span className="text-xs">All Users</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Broadcast to all {mobUsersList.length} citizens
                      </p>
                    </button>

                    {/* 3rd option: Selected Citizen */}
                    <button
                      type="button"
                      data-testid="target-selected-user-btn"
                      onClick={() => {
                        setAlertTarget("selected");
                        if (!selectedUserId && mobUsersList.length > 0) {
                          setSelectedUserId(mobUsersList[0].id);
                        }
                      }}
                      className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                        alertTarget === "selected"
                          ? "border-rose-500 bg-rose-50/90 ring-2 ring-rose-300 text-rose-950 font-bold"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <UserCheck className="size-4 text-rose-600 shrink-0" />
                        <span className="text-xs">Selected User</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1 truncate">
                        {selectedUserId
                          ? mobUsersList.find((u) => u.id === selectedUserId)?.full_name || "1 Selected"
                          : "Choose citizen"}
                      </p>
                    </button>
                  </div>

                  {alertTarget === "selected" && (
                    <div className="mt-2">
                      <select
                        data-testid="select-citizen-dropdown"
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                        className="w-full text-xs rounded-md border border-slate-300 p-2 bg-white"
                      >
                        <option value="">-- Select Specific Citizen Handset --</option>
                        {mobUsersList.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.full_name || "Anonymous"} ({u.phone_number || "No Phone"}) — {u.location_name || "Pollachi"}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Ask which monitored area when targeting Monitored Zone */}
                  {alertTarget === "monitored_zone" && (
                    <div className="mt-2.5 p-2.5 rounded-lg border border-rose-200 bg-rose-50/70 space-y-2 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-bold text-rose-950 flex items-center gap-1.5">
                          <Compass className="size-3.5 text-rose-700" />
                          Which Monitored Area?
                        </Label>
                        <span className="text-[10px] font-semibold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full font-mono">
                          Targeting {monitoredZoneUsers.length} Citizens
                        </span>
                      </div>
                      <select
                        data-testid="select-monitored-area-dropdown"
                        value={monitoredArea}
                        onChange={(e) => {
                          const area = MONITORED_AREAS.find((a) => a.id === e.target.value);
                          setMonitoredArea(e.target.value);
                          if (area) {
                            setEvacForm((prev) => ({
                              ...prev,
                              shelter_name: area.shelterName,
                              latitude: area.defaultLat,
                              longitude: area.defaultLng,
                              elevation_m: area.defaultElev,
                              instructions: area.instructions,
                            }));
                          }
                        }}
                        className="w-full text-xs rounded-md border border-rose-300 p-2 bg-white text-rose-950 font-medium focus:ring-1 focus:ring-rose-500"
                      >
                        {MONITORED_AREAS.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label} — {a.tag}
                          </option>
                        ))}
                      </select>
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {MONITORED_AREAS.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            data-testid={`quick-area-${a.id.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                            onClick={() => {
                              setMonitoredArea(a.id);
                              setEvacForm((prev) => ({
                                ...prev,
                                shelter_name: a.shelterName,
                                latitude: a.defaultLat,
                                longitude: a.defaultLng,
                                elevation_m: a.defaultElev,
                                instructions: a.instructions,
                              }));
                            }}
                            className={`px-2 py-0.5 text-[10px] rounded border transition cursor-pointer ${
                              monitoredArea === a.id
                                ? "bg-rose-700 text-white border-rose-700 font-bold shadow-xs"
                                : "bg-white text-slate-700 border-rose-200 hover:bg-rose-100/50"
                            }`}
                          >
                            {a.tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Alert Hazard Types: Landslide or Flood */}
                <div>
                  <Label className="text-xs font-semibold text-slate-700">2. Alert Type (Landslide or Flood)</Label>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      data-testid="alert-type-flood-btn"
                      onClick={() => {
                        setHazardType("Flood");
                        setAlertForm((p) => ({
                          ...p,
                          hazard_type: "Flash Flood",
                          title: "Flash Flood Warning - High River Surge",
                          detail: "River water levels have reached critical threshold (94mm). Seek high ground immediately and avoid low-lying bridges and riverbanks.",
                        }));
                      }}
                      className={`p-2.5 rounded-lg border text-left flex items-center gap-2.5 transition cursor-pointer ${
                        hazardType === "Flood"
                          ? "border-cyan-500 bg-cyan-50/90 ring-2 ring-cyan-300 text-cyan-950 font-bold"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                      }`}
                    >
                      <Waves className="size-5 text-cyan-600 shrink-0" />
                      <div>
                        <span className="text-xs font-bold block">🌊 Flood Alert</span>
                        <span className="text-[10px] text-slate-500 block">River surge &amp; catchment inundation</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      data-testid="alert-type-landslide-btn"
                      onClick={() => {
                        setHazardType("Landslide");
                        setAlertForm((p) => ({
                          ...p,
                          hazard_type: "Landslide",
                          title: "Landslide Warning - Slope Instability",
                          detail: "Critical slope shear and pore saturation detected (FoS < 1.0). Evacuate unstable hillside terrain and drainage corridors immediately.",
                        }));
                      }}
                      className={`p-2.5 rounded-lg border text-left flex items-center gap-2.5 transition cursor-pointer ${
                        hazardType === "Landslide"
                          ? "border-amber-500 bg-amber-50/90 ring-2 ring-amber-300 text-amber-950 font-bold"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                      }`}
                    >
                      <Mountain className="size-5 text-amber-600 shrink-0" />
                      <div>
                        <span className="text-xs font-bold block">⛰️ Landslide Alert</span>
                        <span className="text-[10px] text-slate-500 block">Slope instability &amp; debris flow</span>
                      </div>
                    </button>
                  </div>
                </div>

                {/* 3. Notification Channels: Checkboxes for Call, Message, In-App Notification */}
                <div>
                  <Label className="text-xs font-semibold text-slate-700">3. Notification Channels (Select Checkboxes)</Label>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {/* Call Checkbox */}
                    <label
                      data-testid="channel-call-label"
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition ${
                        channels.includes("call")
                          ? "border-rose-400 bg-rose-50 text-rose-950 font-semibold"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        data-testid="channel-call-checkbox"
                        checked={channels.includes("call")}
                        onChange={(e) => {
                          if (e.target.checked) setChannels((c) => [...c, "call"]);
                          else setChannels((c) => c.filter((x) => x !== "call"));
                        }}
                        className="accent-rose-600 rounded size-3.5"
                      />
                      <PhoneCall className="size-3.5 text-rose-600 shrink-0" />
                      <span>Call (Voice IVR)</span>
                    </label>

                    {/* Message Checkbox */}
                    <label
                      data-testid="channel-message-label"
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition ${
                        channels.includes("message")
                          ? "border-rose-400 bg-rose-50 text-rose-950 font-semibold"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        data-testid="channel-message-checkbox"
                        checked={channels.includes("message")}
                        onChange={(e) => {
                          if (e.target.checked) setChannels((c) => [...c, "message"]);
                          else setChannels((c) => c.filter((x) => x !== "message"));
                        }}
                        className="accent-rose-600 rounded size-3.5"
                      />
                      <MessageSquare className="size-3.5 text-rose-600 shrink-0" />
                      <span>Message (SMS)</span>
                    </label>

                    {/* In-App Notification Checkbox */}
                    <label
                      data-testid="channel-inapp-label"
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs transition ${
                        channels.includes("in_app")
                          ? "border-rose-400 bg-rose-50 text-rose-950 font-semibold"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        data-testid="channel-inapp-checkbox"
                        checked={channels.includes("in_app")}
                        onChange={(e) => {
                          if (e.target.checked) setChannels((c) => [...c, "in_app"]);
                          else setChannels((c) => c.filter((x) => x !== "in_app"));
                        }}
                        className="accent-rose-600 rounded size-3.5"
                      />
                      <BellRing className="size-3.5 text-rose-600 shrink-0" />
                      <span>In-App Notification</span>
                    </label>
                  </div>
                </div>

                {/* 4. Mode: Automatic and Manual Mode */}
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-700">4. Dispatch Mode</Label>
                    <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5 text-xs">
                      <button
                        type="button"
                        data-testid="mode-manual-btn"
                        onClick={() => setDispatchMode("manual")}
                        className={`px-3 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                          dispatchMode === "manual" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Manual Mode
                      </button>
                      <button
                        type="button"
                        data-testid="mode-automatic-btn"
                        onClick={() => setDispatchMode("automatic")}
                        className={`px-3 py-1 rounded text-xs font-semibold transition cursor-pointer ${
                          dispatchMode === "automatic" ? "bg-rose-600 text-white shadow-xs font-bold" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Automatic Mode
                      </button>
                    </div>
                  </div>
                  {dispatchMode === "automatic" ? (
                    <div className="mt-2 rounded-lg bg-rose-50/80 border border-rose-200 p-2.5 text-xs text-rose-950 space-y-1 animate-in fade-in duration-150">
                      <div className="flex items-center gap-1.5 font-bold text-rose-800">
                        <Zap className="size-3.5 text-rose-600" />
                        <span>Autonomous IoT &amp; Model Threshold Trigger Rules Active</span>
                      </div>
                      <p className="text-[11px] text-rose-900">
                        • 🌊 <strong>Flood Auto-Dispatch</strong>: LoRa river depth &gt; 90mm or 1h rainfall surge &gt; 35 mm/h.
                      </p>
                      <p className="text-[11px] text-rose-900">
                        • ⛰️ <strong>Landslide Auto-Dispatch</strong>: Slope Stability (Factor of Safety) &lt; 1.0 or Pore Pressure &gt; 35 kPa.
                      </p>
                      <p className="text-[10px] text-rose-700 italic">
                        When threshold condition occurs, warning is auto-broadcasted without delay across selected channels.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Manual Mode: Officer authorizes immediate broadcast with custom details.
                    </p>
                  )}
                </div>

                {/* 5. Set Evacuation Point Option (Ask Location from Map) */}
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        data-testid="include-evacuation-checkbox"
                        checked={includeEvacuation}
                        onChange={(e) => setIncludeEvacuation(e.target.checked)}
                        className="accent-blue-600 rounded size-4 cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-xs text-blue-950 block">
                          Set Evacuation Point Option (for all users in scope)
                        </span>
                        <span className="text-[11px] text-blue-700 block">
                          Pick shelter location from interactive map and assign turn-by-turn route
                        </span>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${includeEvacuation ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"}`}>
                      {includeEvacuation ? "Active" : "Disabled"}
                    </span>
                  </label>

                  {includeEvacuation && (
                    <div className="space-y-3 pt-2 border-t border-blue-200 text-xs animate-in fade-in duration-150">
                      {/* Interactive Map Picker & Shelter Quick Buttons */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-blue-950 font-bold flex items-center gap-1 text-xs">
                            <MapPin className="size-3.5 text-blue-600" />
                            Evacuation Shelter Location (Map Picker &amp; Safe Presets)
                          </Label>
                          <span className="text-[10px] text-blue-700 bg-blue-100 px-2 py-0.5 rounded font-mono font-bold">
                            {evacForm.latitude.toFixed(4)}°N, {evacForm.longitude.toFixed(4)}°E ({evacForm.elevation_m || 310}m)
                          </span>
                        </div>

                        {/* Quick Shelter Presets */}
                        <div className="flex flex-wrap gap-1">
                          {SHELTER_PRESETS.map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              data-testid={`preset-shelter-${p.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                              onClick={() => {
                                setEvacForm({
                                  shelter_name: p.name,
                                  latitude: p.lat,
                                  longitude: p.lng,
                                  elevation_m: p.elev,
                                  instructions: p.instructions,
                                });
                              }}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium border transition cursor-pointer ${
                                evacForm.shelter_name === p.name
                                  ? "bg-blue-600 text-white border-blue-600 font-bold shadow-xs"
                                  : "bg-white text-blue-900 border-blue-200 hover:bg-blue-100/50"
                              }`}
                            >
                              🏕️ {p.name.split(" ")[0]} ({p.elev}m)
                            </button>
                          ))}
                        </div>

                        {/* Interactive Leaflet Map for pinpointing shelter location */}
                        <EvacuationMapPicker
                          value={evacForm}
                          onChange={(updated) => setEvacForm(updated)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="evac-shelter" className="text-blue-950 font-semibold">
                          Designated Shelter Name
                        </Label>
                        <Input
                          id="evac-shelter"
                          data-testid="evac-shelter-input"
                          value={evacForm.shelter_name}
                          onChange={(e) => setEvacForm((p) => ({ ...p, shelter_name: e.target.value }))}
                          className="mt-1 text-xs bg-white"
                          placeholder="e.g. Pollachi High Ground Relief Camp Alpha"
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label htmlFor="evac-lat" className="text-blue-950 font-semibold">Latitude</Label>
                          <Input
                            id="evac-lat"
                            data-testid="evac-lat-input"
                            type="number"
                            step="0.0001"
                            value={evacForm.latitude}
                            onChange={(e) => setEvacForm((p) => ({ ...p, latitude: parseFloat(e.target.value) || 0 }))}
                            className="mt-1 text-xs bg-white font-mono"
                          />
                        </div>
                        <div>
                          <Label htmlFor="evac-lng" className="text-blue-950 font-semibold">Longitude</Label>
                          <Input
                            id="evac-lng"
                            data-testid="evac-lng-input"
                            type="number"
                            step="0.0001"
                            value={evacForm.longitude}
                            onChange={(e) => setEvacForm((p) => ({ ...p, longitude: parseFloat(e.target.value) || 0 }))}
                            className="mt-1 text-xs bg-white font-mono"
                          />
                        </div>
                        <div>
                          <Label htmlFor="evac-elev" className="text-blue-950 font-semibold">Safe Elevation (m)</Label>
                          <Input
                            id="evac-elev"
                            data-testid="evac-elev-input"
                            type="number"
                            step="1"
                            value={evacForm.elevation_m || 310}
                            onChange={(e) => setEvacForm((p) => ({ ...p, elevation_m: parseFloat(e.target.value) || 0 }))}
                            className="mt-1 text-xs bg-white font-mono"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="evac-instructions" className="text-blue-950 font-semibold">
                          Evacuation Route Instructions
                        </Label>
                        <Input
                          id="evac-instructions"
                          data-testid="evac-instructions-input"
                          value={evacForm.instructions || ""}
                          onChange={(e) => setEvacForm((p) => ({ ...p, instructions: e.target.value }))}
                          className="mt-1 text-xs bg-white"
                          placeholder="Follow north high-ground corridor away from river."
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 6. Alert Message Details */}
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="alert-title">Alert Title</Label>
                      <Input
                        id="alert-title"
                        data-testid="alert-title-input"
                        value={alertForm.title}
                        onChange={(e) => setAlertForm((p) => ({ ...p, title: e.target.value }))}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <Label>Risk Level</Label>
                      <Select
                        value={alertForm.risk_level}
                        onValueChange={(v: string) => setAlertForm((p) => ({ ...p, risk_level: v }))}
                      >
                        <SelectTrigger className="mt-1 text-xs w-full">
                          <SelectValue>{(v) => String(v).toUpperCase()}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="critical">CRITICAL (Red Alert)</SelectItem>
                          <SelectItem value="high">HIGH (Orange Alert)</SelectItem>
                          <SelectItem value="medium">MEDIUM (Yellow Warning)</SelectItem>
                          <SelectItem value="low">LOW (Advisory)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="alert-detail">Emergency Instructions &amp; Action Details</Label>
                    <textarea
                      id="alert-detail"
                      data-testid="alert-detail-textarea"
                      rows={3}
                      value={alertForm.detail}
                      onChange={(e) => setAlertForm((p) => ({ ...p, detail: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 p-2 text-xs focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none"
                    />
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-[11px] text-slate-500">
                    Target: <strong className="text-slate-800">
                      {alertTarget === "monitored_zone"
                        ? `${monitoredArea} (${monitoredZoneUsers.length} Citizens)`
                        : alertTarget === "all"
                        ? `All Citizens (${mobUsersList.length})`
                        : `Selected Citizen (${selectedUserId ? mobUsersList.find(u => u.id === selectedUserId)?.full_name || "1 Citizen" : "None"})`}
                    </strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setIsAlertModalOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      data-testid="dispatch-emergency-alert-btn"
                      className="bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
                      disabled={
                        !alertForm.title ||
                        !alertForm.detail ||
                        channels.length === 0 ||
                        (alertTarget === "selected" && !selectedUserId) ||
                        sendAlertMutation.isPending ||
                        broadcastAlertMutation.isPending
                      }
                      onClick={() => {
                        const payload: MobUserBroadcastAlertPayload = {
                          target: alertTarget,
                          user_ids: alertTarget === "selected" && selectedUserId ? [selectedUserId] : undefined,
                          hazard_type: hazardType === "Flood" ? "Flash Flood" : "Landslide",
                          risk_level: alertForm.risk_level,
                          title: alertForm.title,
                          detail: alertForm.detail,
                          channels,
                          dispatch_mode: dispatchMode,
                          monitored_area: alertTarget === "monitored_zone" ? monitoredArea : undefined,
                          evacuation_point: includeEvacuation ? evacForm : undefined,
                        };

                        if (alertTarget === "selected" && selectedUserId) {
                          sendAlertMutation.mutate({
                            userId: selectedUserId,
                            payload: {
                              ...alertForm,
                              hazard_type: hazardType === "Flood" ? "Flash Flood" : "Landslide",
                              channels,
                              dispatch_mode: dispatchMode,
                              monitored_area: undefined,
                              evacuation_point: includeEvacuation ? evacForm : undefined,
                            },
                          });
                        } else {
                          broadcastAlertMutation.mutate(payload);
                        }
                      }}
                    >
                      {sendAlertMutation.isPending || broadcastAlertMutation.isPending
                        ? "Dispatching…"
                        : "Dispatch Emergency Alert"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Modal: Send Evacuation Point */}
          {evacTargetUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
              <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 text-blue-700">
                    <Navigation className="size-5" />
                    <h3 className="font-bold text-slate-900 text-base">
                      Assign Safe Evacuation Shelter Point
                    </h3>
                  </div>
                  <button
                    onClick={() => setEvacTargetUser(null)}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="rounded-lg bg-blue-50/70 border border-blue-100 p-3 text-xs text-blue-900">
                  <span className="font-bold">Citizen:</span> {evacTargetUser.full_name || "Citizen"} •{" "}
                  <span className="font-mono">
                    Current GPS: {evacTargetUser.latitude?.toFixed(5)}°N, {evacTargetUser.longitude?.toFixed(5)}°E
                  </span>
                </div>

                {/* Preset Safe Shelters */}
                <div>
                  <Label className="text-xs font-semibold text-slate-700">
                    Designated Safe Relief Shelters (Pollachi Basin)
                  </Label>
                  <div className="mt-1.5 space-y-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setEvacForm({
                          shelter_name: "Pollachi High Ground Relief Camp Alpha",
                          latitude: 10.6695,
                          longitude: 77.0190,
                          elevation_m: 310.5,
                          instructions: "Proceed north along Main High Ground Road. Medical camp, drinking water, and dry rations available.",
                        })
                      }
                      className="w-full text-left rounded-md border border-slate-200 bg-slate-50 p-2 text-xs hover:border-blue-300 hover:bg-blue-50/50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">🏫 Pollachi High Ground Relief Camp Alpha</span>
                        <span className="font-mono text-emerald-700 font-bold">310.5m Elev</span>
                      </div>
                      <p className="text-[11px] text-slate-500">Coords: 10.6695° N, 77.0190° E • 350m from river corridor</p>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setEvacForm({
                          shelter_name: "Govt Higher Secondary School Safe Shelter",
                          latitude: 10.6620,
                          longitude: 77.0110,
                          elevation_m: 298.0,
                          instructions: "Evacuate south-west to concrete multi-story school building. Shelter ground floor is elevated.",
                        })
                      }
                      className="w-full text-left rounded-md border border-slate-200 bg-slate-50 p-2 text-xs hover:border-blue-300 hover:bg-blue-50/50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">🏛️ Govt Higher Secondary School Safe Shelter</span>
                        <span className="font-mono text-emerald-700 font-bold">298.0m Elev</span>
                      </div>
                      <p className="text-[11px] text-slate-500">Coords: 10.6620° N, 77.0110° E • Multi-story safe refuge</p>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setEvacForm({
                          shelter_name: "Municipal Community Flood Center Beta",
                          latitude: 10.6720,
                          longitude: 77.0250,
                          elevation_m: 325.0,
                          instructions: "Proceed east toward hilltop civic center. Elevated helicopter pad and ambulance access available.",
                        })
                      }
                      className="w-full text-left rounded-md border border-slate-200 bg-slate-50 p-2 text-xs hover:border-blue-300 hover:bg-blue-50/50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">⛰️ Municipal Community Flood Center Beta</span>
                        <span className="font-mono text-emerald-700 font-bold">325.0m Elev</span>
                      </div>
                      <p className="text-[11px] text-slate-500">Coords: 10.6720° N, 77.0250° E • High hill refuge</p>
                    </button>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <Label htmlFor="shelter-name">Shelter Facility Name</Label>
                    <Input
                      id="shelter-name"
                      value={evacForm.shelter_name}
                      onChange={(e) => setEvacForm((p) => ({ ...p, shelter_name: e.target.value }))}
                      className="mt-1 text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor="shelter-lat">Latitude</Label>
                      <Input
                        id="shelter-lat"
                        type="number"
                        step="0.00001"
                        value={evacForm.latitude}
                        onChange={(e) =>
                          setEvacForm((p) => ({ ...p, latitude: parseFloat(e.target.value) || 0 }))
                        }
                        className="mt-1 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label htmlFor="shelter-lng">Longitude</Label>
                      <Input
                        id="shelter-lng"
                        type="number"
                        step="0.00001"
                        value={evacForm.longitude}
                        onChange={(e) =>
                          setEvacForm((p) => ({ ...p, longitude: parseFloat(e.target.value) || 0 }))
                        }
                        className="mt-1 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label htmlFor="shelter-elev">Elevation (m)</Label>
                      <Input
                        id="shelter-elev"
                        type="number"
                        value={evacForm.elevation_m || 300}
                        onChange={(e) =>
                          setEvacForm((p) => ({ ...p, elevation_m: parseFloat(e.target.value) || 0 }))
                        }
                        className="mt-1 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="shelter-inst">Evacuation Route Instructions</Label>
                    <textarea
                      id="shelter-inst"
                      rows={3}
                      value={evacForm.instructions}
                      onChange={(e) => setEvacForm((p) => ({ ...p, instructions: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 p-2 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button variant="outline" size="sm" onClick={() => setEvacTargetUser(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    disabled={!evacForm.shelter_name || sendEvacMutation.isPending}
                    onClick={() =>
                      sendEvacMutation.mutate({
                        userId: evacTargetUser.id,
                        payload: evacForm,
                      })
                    }
                  >
                    {sendEvacMutation.isPending ? "Assigning…" : "Assign & Dispatch Evacuation Point"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : activeTab === "mob_alerts" ? (
        /* Dispatched Alerts (Database: mob_alerts) Tab */
        <SectionCard
          testId="mob-alerts-card"
          title="Dispatched Citizen Alerts (Database: mob_alerts)"
          description={`Log of ${mobAlertsList.length} citizen emergency alerts and evacuation orders stored in database mob_alerts.`}
          actions={
            <Button
              size="sm"
              data-testid="dispatch-alert-tab-btn"
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
              onClick={() => {
                setAlertTarget("monitored_zone");
                setIsAlertModalOpen(true);
              }}
            >
              <ShieldAlert className="size-4 mr-1.5" />
              Dispatch Emergency Alert
            </Button>
          }
        >
          {mobAlertsQuery.isLoading ? (
            <LoadingRows rows={4} />
          ) : mobAlertsList.length === 0 ? (
            <EmptyState
              testId="mob-alerts-empty"
              title="No Dispatched Alerts in mob_alerts"
              description="No alerts have been recorded in the mob_alerts collection yet. Click Dispatch Emergency Alert to broadcast warnings to citizens."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="mob-alerts-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Alert Code &amp; Time</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Monitored Area</TableHead>
                    <TableHead>Hazard &amp; Severity</TableHead>
                    <TableHead>Channels &amp; Mode</TableHead>
                    <TableHead>Evacuation Shelter</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mobAlertsList.map((alert) => (
                    <TableRow key={alert.id || alert.alert_code} data-testid={`alert-record-row-${alert.alert_code}`}>
                      <TableCell>
                        <div className="space-y-0.5">
                          <span className="font-mono text-xs font-bold text-rose-700 block">
                            {alert.alert_code || alert.id.slice(0, 8)}
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            {new Date(alert.sent_at).toLocaleString()}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="font-semibold text-slate-900 text-xs block">
                            {alert.recipient_name || "Citizen"}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500 block">
                            {alert.recipient_phone || "No Phone"}
                          </span>
                          <span className="text-[10px] text-slate-400 block truncate max-w-[140px]">
                            {alert.recipient_location || "Monitored Zone"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-900 border border-rose-200">
                          <MapPin className="size-3 text-rose-600" />
                          {alert.monitored_area || "Pollachi Catchment Basin"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                            alert.hazard_type.includes("Landslide")
                              ? "bg-amber-100 text-amber-900 border border-amber-300"
                              : "bg-cyan-100 text-cyan-900 border border-cyan-300"
                          }`}>
                            {alert.hazard_type.includes("Landslide") ? "⛰️ Landslide" : "🌊 Flood"}
                          </span>
                          <span className="block text-[10px] uppercase font-bold text-rose-700">
                            {alert.risk_level}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex flex-wrap gap-1">
                            {(alert.channels || []).map((ch) => (
                              <span key={ch} className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 text-[9px] font-medium border border-slate-200">
                                {ch === "call" ? "📞 Call" : ch === "message" ? "💬 SMS" : "🔔 In-App"}
                              </span>
                            ))}
                          </div>
                          <span className="block text-[9px] text-slate-500 italic">
                            Mode: {alert.dispatch_mode || "manual"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {alert.evacuation_point ? (
                          <div className="text-xs space-y-0.5 max-w-[200px]">
                            <span className="font-semibold text-blue-900 block truncate">
                              🏕️ {alert.evacuation_point.shelter_name}
                            </span>
                            <span className="text-[10px] font-mono text-blue-700 block">
                              {alert.evacuation_point.latitude.toFixed(4)}°N, {alert.evacuation_point.longitude.toFixed(4)}°E ({alert.evacuation_point.elevation_m || 310}m)
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="size-3" />
                          {alert.status || "Delivered"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      ) : (
        /* Departmental Officers Tab */
        <SectionCard
          testId="users-card"
          title="Registered Officers & Personnel"
          description={`${officersList.length} accounts registered`}
        >
          {officersQuery.isLoading ? (
            <LoadingRows rows={4} />
          ) : officersList.length === 0 ? (
            <EmptyState testId="users-empty" title="No accounts registered" />
          ) : (
            <Table data-testid="users-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Officer</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Clearance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {officersList.map((u) => (
                  <TableRow key={u.id} data-testid={`user-row-${u.email}`}>
                    <TableCell>
                      <span className="block font-medium text-slate-900">
                        {u.first_name} {u.last_name}
                      </span>
                      <span className="block font-mono text-[11px] text-slate-500">{u.email}</span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">{u.organization}</TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        onValueChange={(v: string) => updateOfficer.mutate({ id: u.id, role: v as Role })}
                      >
                        <SelectTrigger size="sm" className="w-[170px]" data-testid={`user-role-trigger-${u.email}`}>
                          <SelectValue>{(v) => ROLE_LABELS[v as Role] ?? String(v)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                            <SelectItem key={r} value={r} data-testid={`user-role-${r}`}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <StatusPill status={u.status} testId={`user-status-${u.email}`} />
                    </TableCell>
                    <TableCell className="text-right">
                      {u.status === "active" ? (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => updateOfficer.mutate({ id: u.id, status: "suspended" })}
                          data-testid={`user-suspend-btn-${u.email}`}
                        >
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          onClick={() => updateOfficer.mutate({ id: u.id, status: "active" })}
                          data-testid={`user-verify-btn-${u.email}`}
                        >
                          Verify &amp; Activate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      )}
    </div>
  );
}

export function ProfilePage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", organization: "" });
  const [pw, setPw] = useState({ current_password: "", new_password: "" });

  const save = useMutation({
    mutationFn: () =>
      apiPatch<User>("/auth/me", {
        first_name: form.first_name || user?.first_name,
        last_name: form.last_name || user?.last_name,
        phone: form.phone || user?.phone,
        organization: form.organization || user?.organization,
      }),
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const changePw = useMutation({
    mutationFn: () => apiPost<{ message: string }>("/auth/change-password", pw),
    onSuccess: (r) => { toast.success(r.message); setPw({ current_password: "", new_password: "" }); },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div data-testid="profile-page">
      <PageHeader title="My Profile" description="Departmental identity, clearance level and account security." />
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard testId="profile-details-card" title="Officer details">
          <dl className="space-y-2.5 text-sm">
            {[
              ["Name", `${user?.first_name ?? ""} ${user?.last_name ?? ""}`],
              ["Role", ROLE_LABELS[user?.role ?? "viewer"]],
              ["Designation", user?.designation ?? "—"],
              ["Department", user?.organization ?? "—"],
              ["Email", user?.email ?? "—"],
              ["Phone", user?.phone ?? "—"],
              ["Jurisdiction", `${user?.district ?? "—"}, ${user?.state ?? "—"}`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-medium text-slate-900" data-testid={`profile-field-${String(k).toLowerCase()}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard testId="profile-edit-card" title="Edit profile">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="p-first">First Name</Label><Input id="p-first" value={form.first_name} onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))} placeholder={user?.first_name} className="mt-1.5" data-testid="profile-first-name-input" /></div>
              <div><Label htmlFor="p-last">Last Name</Label><Input id="p-last" value={form.last_name} onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))} placeholder={user?.last_name} className="mt-1.5" data-testid="profile-last-name-input" /></div>
              <div><Label htmlFor="p-phone">Phone</Label><Input id="p-phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder={user?.phone} className="mt-1.5" data-testid="profile-phone-input" /></div>
              <div><Label htmlFor="p-org">Organization</Label><Input id="p-org" value={form.organization} onChange={(e) => setForm((p) => ({ ...p, organization: e.target.value }))} placeholder={user?.organization} className="mt-1.5" data-testid="profile-org-input" /></div>
            </div>
            <Button className="mt-4" disabled={save.isPending} onClick={() => save.mutate()} data-testid="profile-save-btn">{save.isPending ? "Saving…" : "Save Changes"}</Button>
          </SectionCard>

          <SectionCard testId="profile-password-card" title="Change password">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="cp-cur">Current Password</Label><Input id="cp-cur" type="password" value={pw.current_password} onChange={(e) => setPw((p) => ({ ...p, current_password: e.target.value }))} className="mt-1.5" data-testid="profile-current-password-input" /></div>
              <div><Label htmlFor="cp-new">New Password</Label><Input id="cp-new" type="password" value={pw.new_password} onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))} className="mt-1.5" data-testid="profile-new-password-input" /></div>
            </div>
            <Button className="mt-4" variant="outline" disabled={pw.new_password.length < 8 || changePw.isPending} onClick={() => changePw.mutate()} data-testid="profile-change-password-btn">Update Password</Button>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { user } = useSession();
  const [prefs, setPrefs] = useState({ critical: true, sensorOffline: true, aiPrediction: false, weekly: true });

  return (
    <div data-testid="settings-page">
      <PageHeader title="System Settings" description="Notification preferences and platform configuration." />
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard testId="settings-notifications-card" title="Notification preferences" description="Channels used to reach you during an escalation">
          <div className="space-y-3">
            {([
              ["critical", "Critical hazard alerts"],
              ["sensorOffline", "Sensor offline notices"],
              ["aiPrediction", "AI prediction updates"],
              ["weekly", "Weekly report digest"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700">
                {label}
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={(e) => { setPrefs((p) => ({ ...p, [key]: e.target.checked })); toast.success(`${label} ${e.target.checked ? "enabled" : "disabled"}`); }}
                  className="size-4 accent-[#0F4C81]"
                  data-testid={`settings-toggle-${key}`}
                />
              </label>
            ))}
          </div>
        </SectionCard>

        <SectionCard testId="settings-platform-card" title="Platform configuration">
          <dl className="space-y-2.5 text-sm">
            {[
              ["Platform version", "3.4.2"],
              ["Your clearance", ROLE_LABELS[user?.role ?? "viewer"]],
              ["Session type", "httpOnly JWT cookie · auto-renewing, ends on sign-out"],
              ["Telemetry cadence", "5 minute LoRaWAN uplink window"],
              ["Data residency", "India (AWS ap-south-1)"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-mono text-xs font-semibold text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </div>
    </div>
  );
}
