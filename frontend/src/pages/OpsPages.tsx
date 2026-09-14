import { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Brain, Download, FileText, Info, Play, Sparkles, Box, Boxes, RefreshCw,
  CheckCircle2, ArrowRight, Layers, Globe, Map, MapPin, AlertTriangle,
  Square, CloudRain, Trash2, Radio, Activity, Database, Waves, Compass,
  ShieldAlert, Send, Navigation, Check, X, Shield, Bell, UserCheck,
  AlertCircle, Signal, Battery, Cpu, Wifi, ExternalLink, MapPinned, Phone
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
  type MobUserEvacuationPayload,
} from "@/lib/types";
import { CesiumDigitalTwinViewer } from "@/components/gis/CesiumDigitalTwinViewer";
import GISMap, { DEFAULT_LAYERS } from "@/components/gis/GISMap";
import { supabase } from "@/lib/supabase";
import { parseCustomAreaPolygon } from "@/lib/gisUtils";
import DisasterIntelligenceChat from "@/components/gis/DisasterIntelligenceChat";


const useZones = () => useQuery({ queryKey: ["zones"], queryFn: () => apiGet<Zone[]>("/zones"), retry: false });

const SCENARIOS = [
  { value: "flood", label: "Flood Simulation" },
  { value: "landslide", label: "Landslide Simulation" },
  { value: "evacuation", label: "Evacuation Route Simulation" },
];
const SCENARIO_LABELS: Record<string, string> = Object.fromEntries(SCENARIOS.map((s) => [s.value, s.label]));

export function DigitalTwinPage() {
  const location = useLocation();
  const zones = useZones();
  const [zoneId, setZoneId] = useState("");
  const [scenario, setScenario] = useState("flood");
  const [rainfall, setRainfall] = useState(70);
  const [saturation, setSaturation] = useState(65);
  const [slope, setSlope] = useState(32);
  const [wind, setWind] = useState(18);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isRainActive, setIsRainActive] = useState<boolean>(false);

  // 3D Digital Twin State (Cesium 3D Engine)
  const [loadingAreas, setLoadingAreas] = useState<boolean>(() => {
    try {
      return !localStorage.getItem("cached_custom_areas");
    } catch {
      return true;
    }
  });
  const [customAreas, setCustomAreas] = useState<CustomArea[]>(() => {
    try {
      const cached = localStorage.getItem("cached_custom_areas");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
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
    location.state?.area?.id || (customAreas[0]?.id ?? "")
  );
  const [activeArea, setActiveArea] = useState<CustomArea | null>(
    location.state?.area || (customAreas[0] ?? null)
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
        if (data && data.length > 0) {
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
            if (!current && loaded.length > 0) {
              setSelectedAreaId(loaded[0].id);
              setLat(Number(loaded[0].lat));
              setLng(Number(loaded[0].lng));
              setAreaTitle(loaded[0].name);
              return loaded[0];
            }
            return current;
          });
          try {
            localStorage.setItem("cached_custom_areas", JSON.stringify(loaded));
          } catch (e) {
            console.warn("Failed to persist custom areas to localStorage", e);
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

  const zoneList = zones.data ?? [];
  const effectiveZone = zoneId || zoneList[0]?.id || "";

  const run = useMutation({
    mutationFn: () =>
      apiPost<SimulationResult>("/simulations", {
        zone_id: effectiveZone,
        scenario,
        rainfall_intensity: rainfall,
        soil_saturation: saturation,
        slope_angle: slope,
        wind_speed: wind,
      }),
    onSuccess: (res) => {
      setResult(res);
      setIsRainActive(true);
      toast.success(`${SCENARIO_LABELS[res.scenario] ?? res.scenario} completed — severity ${res.severity}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Simulation could not be executed.")),
  });

  const slider = (label: string, value: number, setter: (v: number) => void, min: number, max: number, unit: string, testId: string) => (
    <div>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-xs font-semibold text-[#0F4C81]">{value} {unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => setter(Number(e.target.value))}
        className="mt-2 w-full accent-[#0F4C81]"
        data-testid={testId}
      />
    </div>
  );

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
                <SelectTrigger className="w-full text-xs">
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

              {(isRainActive || run.isPending) && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 text-xs font-bold animate-pulse">
                  <CloudRain className="size-3.5" />
                  <span>Rain Simulation Active</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
              <span className="font-bold text-slate-700">{areaTitle}</span>
              <span>Lat: <strong className="text-slate-800">{lat.toFixed(4)}°N</strong></span>
              <span>Lng: <strong className="text-slate-800">{lng.toFixed(4)}°E</strong></span>
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
                      await supabase.from("custom_areas").delete().eq("id", activeArea.id);
                      const safeName = activeArea.name.replace(/\s+/g, "_");
                      localStorage.removeItem(`dt_mesh_nodes_${safeName}`);
                      localStorage.removeItem(`dt_user_activity_${safeName}`);
                      localStorage.removeItem(`dt_networks_${safeName}`);

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
                polygon={activeArea?.polygon}
                height="620px"
                onViewInGIS={() => setTwinViewMode("gis")}
                isRaining={isRainActive || run.isPending}
                rainfallIntensity={rainfall}
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
                rainfallIntensity={rainfall}
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

      {/* ─── Disaster Intelligence Chat ─── */}
      <DisasterIntelligenceChat
        latitude={activeArea ? lat : undefined}
        longitude={activeArea ? lng : undefined}
        areaName={areaTitle || undefined}
        polygon={activeArea?.polygon}
        radiusKm={20}
        onToggleRain={() => setIsRainActive((p) => !p)}
        onViewGIS={() => setTwinViewMode("gis")}
        isRaining={isRainActive}
      />

      {/* ─── Simulation Controls & Twin Projection Grid ─── */}
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card className="border-slate-200/80 p-6 space-y-6" data-testid="digital-twin-controls">
          {/* Quick 3D Twin Trigger Section */}
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0F4C81]">
                3D Monitored Area
              </p>
              {activeArea ? (
                <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  Active 3D
                </span>
              ) : (
                <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  No Area Selected
                </span>
              )}
            </div>

            {!activeArea && (
              <div className="p-2.5 rounded-lg bg-amber-50/90 border border-amber-200 text-xs text-amber-900 space-y-1.5">
                <p className="font-semibold text-amber-900 text-[11px]">
                  Select an area in GIS mapping to create a digital twin
                </p>
                <Link
                  to="/gis"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0F4C81] hover:underline"
                >
                  <MapPin className="size-3 text-[#0F4C81]" />
                  Open GIS Mapping →
                </Link>
              </div>
            )}

            {customAreas.length > 0 ? (
              <div>
                <Label className="text-xs text-slate-600">Select Monitored Area</Label>
                <Select
                  value={selectedAreaId || activeArea?.id || ""}
                  onValueChange={handleAreaChange}
                >
                  <SelectTrigger className="mt-1 w-full text-xs">
                    <SelectValue placeholder="Select an area...">
                      {customAreas.find((a) => a.id === (selectedAreaId || activeArea?.id))?.name || "Choose Area"}
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
              </div>
            ) : (
              <p className="text-xs text-slate-500">Loading custom areas from database…</p>
            )}

            {/* Target Coordinates */}
            <div className="pt-2 border-t border-slate-200/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-600">Target Coordinates</span>
                <span className="text-[10px] text-slate-400 font-mono">WGS84</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-500 font-medium">Latitude</span>
                  <Input
                    type="number"
                    step="0.0001"
                    value={lat}
                    onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-0.5"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-medium">Longitude</span>
                  <Input
                    type="number"
                    step="0.0001"
                    value={lng}
                    onChange={(e) => setLng(parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs font-mono mt-0.5"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Simulation Controls</p>
            <div className="mt-4 space-y-5">
              <div>
                <Label>Monitoring Zone</Label>
                <Select value={effectiveZone} onValueChange={(v: string) => setZoneId(v)}>
                  <SelectTrigger className="mt-1.5 w-full" data-testid="twin-zone-trigger">
                    <SelectValue placeholder="Select zone">{(v) => zoneList.find((z) => z.id === v)?.name ?? "Select zone"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {zoneList.map((z) => (
                      <SelectItem key={z.id} value={z.id} data-testid={`twin-zone-${z.id}`}>{z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Scenario</Label>
                <Select value={scenario} onValueChange={(v: string) => setScenario(v)}>
                  <SelectTrigger className="mt-1.5 w-full" data-testid="twin-scenario-trigger">
                    <SelectValue>{(v) => SCENARIO_LABELS[v as string] ?? "Select scenario"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SCENARIOS.map((s) => (
                      <SelectItem key={s.value} value={s.value} data-testid={`twin-scenario-${s.value}`}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {slider("Rainfall intensity", rainfall, setRainfall, 10, 150, "mm/h", "twin-rainfall-slider")}
              {slider("Soil saturation", saturation, setSaturation, 0, 100, "%", "twin-saturation-slider")}
              {slider("Slope angle", slope, setSlope, 0, 70, "°", "twin-slope-slider")}
              {slider("Wind speed", wind, setWind, 0, 150, "km/h", "twin-wind-slider")}

              <div className="space-y-2">
                <Button
                  size="lg"
                  className="w-full cursor-pointer bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white font-bold shadow-md transition-all"
                  disabled={run.isPending || !effectiveZone || !activeArea}
                  onClick={() => {
                    setIsRainActive(true);
                    run.mutate();
                  }}
                  data-testid="run-simulation-btn"
                >
                  {run.isPending ? (
                    "Running simulation…"
                  ) : !activeArea ? (
                    "Select an area in GIS to simulate"
                  ) : (
                    <>
                      <Play className="mr-2 size-4" /> {result ? "RE-RUN SIMULATION" : "RUN SIMULATION"}
                    </>
                  )}
                </Button>

                {(isRainActive || run.isPending || result) && (
                  <Button
                    size="lg"
                    variant="destructive"
                    className="w-full cursor-pointer bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold shadow-md transition-all"
                    onClick={() => {
                      setIsRainActive(false);
                      run.reset();
                      setResult(null);
                      toast.info("Simulation and weather dynamics stopped.");
                    }}
                    data-testid="stop-simulation-btn"
                  >
                    <Square className="mr-2 size-4 fill-current" /> STOP SIMULATION
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        <SectionCard testId="digital-twin-output" title="Twin projection" description="12-hour hazard propagation forecast">
          {run.isPending ? (
            <div data-testid="simulation-progress">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-[#0F4C81]" />
              </div>
              <p className="mt-3 text-sm text-slate-600">Solving terrain hydrology and propagation kernels…</p>
            </div>
          ) : !activeArea ? (
            <EmptyState
              testId="simulation-empty"
              title="Select an area in GIS mapping"
              description="Select an area in GIS mapping to create a digital twin and view simulation projections."
            />
          ) : !result ? (
            <EmptyState
              testId="simulation-empty"
              title="No simulation run yet"
              description="Configure the parameters and run a simulation to project hazard propagation."
            />
          ) : (
            <div data-testid="simulation-result">
              <div className="grid gap-4 sm:grid-cols-4">
                <StatCard testId="sim-kpi-severity" label="Severity" value={result.severity} tone="red" />
                <StatCard testId="sim-kpi-impact" label="Peak impact" value={`${result.peak_impact_pct}%`} tone="amber" />
                <StatCard testId="sim-kpi-area" label="Affected area" value={`${result.affected_area_km2} km²`} tone="teal" />
                <StatCard testId="sim-kpi-evac" label="Evac window" value={`${result.evacuation_time_min} min`} tone="green" />
              </div>
              <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700" data-testid="simulation-summary">{result.summary}</p>
              <ResponsiveContainer width="100%" height={240} className="mt-5">
                <AreaChart data={result.steps}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} unit="h" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="impact_pct" name="Impact %" stroke="#DC2626" fill="#DC2626" fillOpacity={0.15} />
                  <Area type="monotone" dataKey="affected_area_km2" name="Area km²" stroke="#0F4C81" fill="#0F4C81" fillOpacity={0.12} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>
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

  const list = data ?? [];
  const canCreate = user?.role === "admin" || user?.role === "gov_officer";

  const download = (r: Report) => {
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
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-xs text-slate-500">{r.report_type}</TableCell>
                  <TableCell className="text-xs text-slate-500">{r.period}</TableCell>
                  <TableCell><StatusPill status={r.status} /></TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="xs" onClick={() => download(r)} data-testid={`report-download-btn-${r.id}`}>
                      <Download className="mr-1.5 size-3.5" /> CSV
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
  const qc = useQueryClient();
  const zones = useZones();
  const [activeTab, setActiveTab] = useState<"live_lora" | "inventory">("live_lora");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [telemetrySubTab, setTelemetrySubTab] = useState<"readings" | "packets">("readings");
  const [readingPage, setReadingPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const itemsPerPage = 15;

  // 1. Live Summary query from sensor_db
  const summaryQuery = useQuery({
    queryKey: ["external-sensors-summary"],
    queryFn: () => apiGet<ExternalSensorSummary>("/external-sensors/summary"),
    refetchInterval: autoRefresh ? 6000 : false,
  });

  // 2. Telemetry History query from sensor_data table
  const historyQuery = useQuery({
    queryKey: ["external-sensors-history"],
    queryFn: () => apiGet<ExternalSensorHistoryItem[]>("/external-sensors/history?limit=300"),
    refetchInterval: autoRefresh ? 6000 : false,
  });

  // 3. Raw LoRa packets query from lora_packets table
  const packetsQuery = useQuery({
    queryKey: ["external-sensors-packets"],
    queryFn: () => apiGet<ExternalLoraPacket[]>("/external-sensors/packets?limit=100"),
    refetchInterval: autoRefresh ? 6000 : false,
  });

  // Inventory queries
  const { data: inventoryData, isLoading: inventoryLoading } = useQuery({
    queryKey: ["sensors"],
    queryFn: () => apiGet<Sensor[]>("/sensors"),
    retry: false,
  });
  const [form, setForm] = useState({ code: "", name: "", sensor_type: "rainfall", zone_id: "" });

  const zoneList = zones.data ?? [];
  const zoneId = form.zone_id || zoneList[0]?.id || "";

  const create = useMutation({
    mutationFn: () => {
      const zone = zoneList.find((z) => z.id === zoneId);
      return apiPost<Sensor>("/sensors", {
        code: form.code,
        name: form.name,
        sensor_type: form.sensor_type,
        zone_id: zoneId,
        lat: zone ? zone.lat + 0.01 : 10.667366,
        lng: zone ? zone.lng + 0.01 : 77.016900,
        status: "online",
        battery: 100,
        unit: "",
      });
    },
    onSuccess: (s) => {
      toast.success(`Sensor ${s.code} commissioned`);
      setForm({ code: "", name: "", sensor_type: "rainfall", zone_id: "" });
      qc.invalidateQueries({ queryKey: ["sensors"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["zones"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Sensor could not be commissioned.")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<{ message: string }>(`/sensors/${id}`),
    onSuccess: (r) => {
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["sensors"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const summary = summaryQuery.data;
  const history = historyQuery.data ?? [];
  const packets = packetsQuery.data ?? [];
  const activeDevice = summary?.devices?.[0];
  const inventoryList = inventoryData ?? [];

  const filteredHistory = history.filter((h) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      h.device_id.toLowerCase().includes(q) ||
      String(h.id).includes(q) ||
      (h.txt && h.txt.toLowerCase().includes(q))
    );
  });

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  const currentHistorySlice = filteredHistory.slice(
    (readingPage - 1) * itemsPerPage,
    readingPage * itemsPerPage
  );

  const handleRefreshAll = () => {
    summaryQuery.refetch();
    historyQuery.refetch();
    packetsQuery.refetch();
    toast.success("Live sensor data refreshed");
  };

  return (
    <div data-testid="sensor-management-page" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Sensor Management & Live LoRaWAN Telemetry"
          description="Real-time environmental sensor ingest from PostgreSQL sensor_db, LoRa packet streams, and node fleet management."
        />
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
            <button
              onClick={() => setActiveTab("live_lora")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "live_lora"
                  ? "bg-emerald-700 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Radio className="size-3.5" />
              Live LoRaWAN Telemetry
              <span className="flex size-2 rounded-full bg-emerald-400 ring-2 ring-emerald-300 animate-pulse ml-1" />
            </button>
            <button
              onClick={() => setActiveTab("inventory")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "inventory"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Boxes className="size-3.5" />
              Node Inventory & Commissioning ({inventoryList.length})
            </button>
          </div>
        </div>
      </div>

      {activeTab === "live_lora" ? (
        <div className="space-y-6">
          {/* Database Connection Status Banner */}
          <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
                <Database className="size-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-emerald-950 text-sm">
                    PostgreSQL Ingest Connection: Active
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-300">
                    <span className="size-1.5 rounded-full bg-emerald-600 animate-ping" />
                    LIVE TELEMETRY
                  </span>
                </div>
                <p className="font-mono text-xs text-emerald-800 mt-0.5">
                  postgresql://sensor_user:***@db.nishanth.qzz.io:5432/sensor_db
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-900">
                <span className="rounded-md bg-emerald-200/80 px-2.5 py-1 font-mono">
                  {summary?.total_readings ?? history.length} readings
                </span>
                <span className="rounded-md bg-emerald-200/80 px-2.5 py-1 font-mono">
                  {summary?.total_packets ?? packets.length} LoRa packets
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-emerald-900 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500 size-3.5"
                  />
                  <span>Auto-sync (6s)</span>
                </label>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleRefreshAll}
                  disabled={summaryQuery.isFetching}
                  className="bg-white border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                >
                  <RefreshCw className={`size-3 mr-1 ${summaryQuery.isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {/* Active Device Overview Card */}
          <Card className="border-slate-200/80 bg-linear-to-br from-white to-slate-50/50 p-5 shadow-xs">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
                  <Radio className="size-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-slate-900 text-base">
                      {activeDevice?.name || "LoRaWAN Hydrology Node (LORA_NODE_1)"}
                    </h2>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      <span className="size-1.5 rounded-full bg-emerald-600" />
                      ONLINE
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Device Identifier: <span className="font-mono font-semibold text-slate-700">{activeDevice?.device_id || "LORA_NODE_1"}</span> • Pollachi Catchment Basin
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
                  <Battery className="size-4 text-emerald-600" />
                  <span className="text-slate-600 font-medium">Battery:</span>
                  <span className="font-mono font-bold text-slate-900">{activeDevice?.battery_pct ?? 95}%</span>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
                  <Signal className="size-4 text-blue-600" />
                  <span className="text-slate-600 font-medium">RSSI:</span>
                  <span className="font-mono font-bold text-slate-900">{activeDevice?.latest?.rssi_dbm ?? -105} dBm</span>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
                  <Wifi className="size-4 text-amber-600" />
                  <span className="text-slate-600 font-medium">SNR:</span>
                  <span className="font-mono font-bold text-slate-900">{activeDevice?.latest?.snr_db ?? 8.0} dB</span>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
                  <span className="text-slate-500">Last Telemetry:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {activeDevice?.latest?.created_at
                      ? new Date(activeDevice.latest.created_at).toLocaleTimeString()
                      : "Recent"}
                  </span>
                </div>
              </div>
            </div>

            {/* 4 Real Metric Stat Cards */}
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-800">
                    Water Level
                  </span>
                  <Waves className="size-5 text-blue-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-blue-950">
                    {activeDevice?.latest?.water_level_mm ?? 94.0}
                  </span>
                  <span className="text-sm font-bold text-blue-700">mm</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-blue-800/80">
                  <span>River Bed Pressure Gauge</span>
                  <span className="font-mono font-medium">Max: {activeDevice?.stats?.max_water_level ?? 94.0} mm</span>
                </div>
              </div>

              <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-cyan-800">
                    Precipitation / Rain
                  </span>
                  <CloudRain className="size-5 text-cyan-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-cyan-950">
                    {activeDevice?.latest?.rainfall_mm ?? 2.0}
                  </span>
                  <span className="text-sm font-bold text-cyan-700">mm</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-cyan-800/80">
                  <span>Tipping Bucket Sensor</span>
                  <span className="font-mono font-medium">Peak: {activeDevice?.stats?.max_rainfall ?? 24.0} mm</span>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                    Soil Moisture
                  </span>
                  <Activity className="size-5 text-amber-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-amber-950">
                    {activeDevice?.latest?.soil_moisture?.toFixed(1) ?? "0.0"}
                  </span>
                  <span className="text-sm font-bold text-amber-700">% VWC</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-amber-800/80">
                  <span>Capacitive In-Ground</span>
                  <span className="font-medium text-emerald-700">Unsaturated</span>
                </div>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-800">
                    Tilt &amp; IMU Stability
                  </span>
                  <Compass className="size-5 text-indigo-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-indigo-950">
                    {activeDevice?.latest?.tilt_deg?.toFixed(1) ?? "0.0"}°
                  </span>
                  <span className="text-sm font-bold text-indigo-700">Tilt</span>
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-indigo-900">
                  <span>IMU [X:{activeDevice?.latest?.imu_x ?? 0}, Y:{activeDevice?.latest?.imu_y ?? 0}, Z:{activeDevice?.latest?.imu_z ?? 0}]</span>
                  <span className="text-emerald-700 font-semibold">Stable</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Telemetry Stream Views */}
          <SectionCard
            testId="sensor-telemetry-card"
            title="Real-time LoRaWAN Stream"
            description="Live historical sensor readings and raw packet frames directly from sensor_db"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setTelemetrySubTab("readings")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    telemetrySubTab === "readings"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Telemetry Records (sensor_data: {history.length})
                </button>
                <button
                  onClick={() => setTelemetrySubTab("packets")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    telemetrySubTab === "packets"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Raw LoRaWAN Packets (lora_packets: {packets.length})
                </button>
              </div>

              {telemetrySubTab === "readings" && (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Search by ID or device..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setReadingPage(1);
                    }}
                    className="h-8 w-48 text-xs"
                  />
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    Page {readingPage} of {totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={readingPage <= 1}
                      onClick={() => setReadingPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={readingPage >= totalPages}
                      onClick={() => setReadingPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {telemetrySubTab === "readings" ? (
              historyQuery.isLoading ? (
                <LoadingRows rows={6} />
              ) : currentHistorySlice.length === 0 ? (
                <EmptyState
                  testId="sensor-telemetry-empty"
                  title="No Telemetry Records Found"
                  description="No records matching current query in sensor_data table."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16"># ID</TableHead>
                        <TableHead>Device Node</TableHead>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Water Level</TableHead>
                        <TableHead>Rainfall</TableHead>
                        <TableHead>Soil Moisture</TableHead>
                        <TableHead>Tilt</TableHead>
                        <TableHead>IMU (X,Y,Z)</TableHead>
                        <TableHead>RF Signal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentHistorySlice.map((item) => (
                        <TableRow key={item.id} className="font-mono text-xs">
                          <TableCell className="font-bold text-slate-600">#{item.id}</TableCell>
                          <TableCell className="font-sans font-semibold text-slate-900">
                            {item.device_id}
                          </TableCell>
                          <TableCell className="text-slate-500 whitespace-nowrap">
                            {item.created_at ? new Date(item.created_at).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 font-bold text-blue-800">
                              {item.water_level} mm
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-700 font-semibold">{item.rainfall} mm</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-700">{item.soil_moisture}%</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-700">{item.tilt}°</span>
                          </TableCell>
                          <TableCell className="text-slate-500 text-[11px]">
                            [{item.imu_x}, {item.imu_y}, {item.imu_z}]
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-700 font-semibold">{item.rssi} dBm</span>{" "}
                            <span className="text-slate-400 text-[11px]">(SNR {item.snr})</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            ) : packetsQuery.isLoading ? (
              <LoadingRows rows={6} />
            ) : packets.length === 0 ? (
              <EmptyState
                testId="lora-packets-empty"
                title="No LoRaWAN Packets Logged"
                description="No raw packet logs currently in lora_packets table."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16"># ID</TableHead>
                      <TableHead>Device ID</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Port / Counter</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Gateway EUI</TableHead>
                      <TableHead>RF Signal</TableHead>
                      <TableHead>Raw Payload</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packets.map((pkt) => (
                      <TableRow key={pkt.id} className="font-mono text-xs">
                        <TableCell className="font-bold text-slate-600">#{pkt.id}</TableCell>
                        <TableCell className="font-sans font-semibold text-slate-900">{pkt.device_id}</TableCell>
                        <TableCell className="text-slate-500 whitespace-nowrap">
                          {pkt.created_at ? new Date(pkt.created_at).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-slate-700">Port {pkt.fport} (cnt: {pkt.fcnt})</TableCell>
                        <TableCell className="text-slate-600">{pkt.frequency_mhz} MHz</TableCell>
                        <TableCell className="text-slate-500">{pkt.gateway_eui || "—"}</TableCell>
                        <TableCell className="text-slate-700 font-semibold">
                          {pkt.rssi} dBm <span className="text-slate-400 text-[11px]">(SNR {pkt.snr})</span>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-[11px] text-slate-600">
                          {pkt.raw_payload || "(empty)"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </div>
      ) : (
        /* Node Inventory & Commissioning Tab */
        <div className="space-y-6">
          <Card className="border-slate-200/80 p-6" data-testid="sensor-create-form">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Commission new sensor node
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              <div>
                <Label htmlFor="sensor-code">Node Code</Label>
                <Input
                  id="sensor-code"
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                  placeholder="LORA-POL-02"
                  className="mt-1.5"
                  data-testid="sensor-code-input"
                />
              </div>
              <div>
                <Label htmlFor="sensor-name">Node Name</Label>
                <Input
                  id="sensor-name"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Pollachi Gauge 2"
                  className="mt-1.5"
                  data-testid="sensor-name-input"
                />
              </div>
              <div>
                <Label>Sensor Type</Label>
                <Select
                  value={form.sensor_type}
                  onValueChange={(v: string) => setForm((p) => ({ ...p, sensor_type: v }))}
                >
                  <SelectTrigger className="mt-1.5 w-full" data-testid="sensor-type-trigger">
                    <SelectValue>{(v) => SENSOR_LABELS[v as string] ?? "Select type"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SENSOR_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k} data-testid={`sensor-type-${k}`}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Monitoring Zone</Label>
                <Select
                  value={zoneId}
                  onValueChange={(v: string) => setForm((p) => ({ ...p, zone_id: v }))}
                >
                  <SelectTrigger className="mt-1.5 w-full" data-testid="sensor-zone-trigger">
                    <SelectValue>{(v) => zoneList.find((z) => z.id === v)?.name ?? "Select zone"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {zoneList.map((z) => (
                      <SelectItem key={z.id} value={z.id} data-testid={`sensor-zone-${z.id}`}>
                        {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              className="mt-4"
              disabled={form.code.length < 2 || form.name.length < 2 || !zoneId || create.isPending}
              onClick={() => create.mutate()}
              data-testid="sensor-create-btn"
            >
              {create.isPending ? "Commissioning…" : "Commission Sensor"}
            </Button>
          </Card>

          <SectionCard
            testId="sensor-inventory-card"
            title="Registered Sensor Fleet"
            description={`${inventoryList.length} nodes registered`}
          >
            {inventoryLoading ? (
              <LoadingRows rows={5} />
            ) : inventoryList.length === 0 ? (
              <EmptyState
                testId="sensor-inventory-empty"
                title="No sensors registered"
                description="Commission your first LoRaWAN node above."
              />
            ) : (
              <Table data-testid="sensor-inventory-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Battery</TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryList.map((s) => (
                    <TableRow key={s.id} data-testid={`sensor-mgmt-row-${s.code}`}>
                      <TableCell className="font-mono text-xs font-semibold">{s.code}</TableCell>
                      <TableCell>{SENSOR_LABELS[s.sensor_type] ?? s.sensor_type}</TableCell>
                      <TableCell className="text-xs text-slate-500">{s.zone_name}</TableCell>
                      <TableCell className="font-mono text-xs">{s.battery}%</TableCell>
                      <TableCell className="font-mono text-xs">{s.signal_dbm} dBm</TableCell>
                      <TableCell>
                        <StatusPill status={s.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-red-700 hover:bg-red-50"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(s.id)}
                          data-testid={`sensor-delete-btn-${s.code}`}
                        >
                          Decommission
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}

export function UserManagementPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"mob_users" | "officers">("mob_users");

  // 1. Supabase mob_users Query
  const mobUsersQuery = useQuery({
    queryKey: ["mob-users"],
    queryFn: () => apiGet<MobUser[]>("/mob-users"),
    refetchInterval: 8000,
  });

  // 2. Officers Query
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

  // Citizen Alert Modal State & Mutation
  const [alertTargetUser, setAlertTargetUser] = useState<MobUser | null>(null);
  const [alertForm, setAlertForm] = useState<MobUserAlertPayload>({
    hazard_type: "Flash Flood",
    risk_level: "critical",
    title: "Flash Flood Warning - High River Surge",
    detail: "River water levels have reached critical threshold (94mm). Seek high ground immediately and avoid low-lying bridges and riverbanks.",
  });

  const sendAlertMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: MobUserAlertPayload }) =>
      apiPost(`/mob-users/${userId}/alert`, payload),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Emergency alert dispatched to citizen");
      setAlertTargetUser(null);
      qc.invalidateQueries({ queryKey: ["mob-users"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Failed to dispatch emergency alert")),
  });

  // Citizen Evacuation Modal State & Mutation
  const [evacTargetUser, setEvacTargetUser] = useState<MobUser | null>(null);
  const [evacForm, setEvacForm] = useState<MobUserEvacuationPayload>({
    shelter_name: "Pollachi High Ground Relief Camp Alpha",
    latitude: 10.6695,
    longitude: 77.0190,
    elevation_m: 310.5,
    instructions: "Follow north high-ground corridor. Water, hot meals, and medical supplies available at relief shelter.",
  });

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
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const mobUsersList = mobUsersQuery.data ?? [];
  const officersList = officersQuery.data ?? [];

  const activeAlertsCount = mobUsersList.filter(
    (u) => u.preferences?.active_alert && u.preferences.active_alert.active
  ).length;
  const assignedEvacCount = mobUsersList.filter(
    (u) => u.preferences?.evacuation_point
  ).length;

  return (
    <div data-testid="user-management-page" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="User & Citizen Management"
          description="Manage mobile app citizens (mob_users) in Supabase, dispatch targeted emergency alerts, assign evacuation shelters, and manage departmental officers."
        />
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
          <button
            onClick={() => setActiveTab("mob_users")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
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
            onClick={() => setActiveTab("officers")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
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

                      return (
                        <TableRow key={user.id} className="text-xs">
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900 text-sm">
                                {user.full_name || "Anonymous Citizen"}
                              </span>
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
                                className="w-28 justify-center bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                                onClick={() => {
                                  setAlertTargetUser(user);
                                  setAlertForm((prev) => ({
                                    ...prev,
                                    title: "Flash Flood Warning - High River Surge",
                                    detail: `River water levels have reached critical threshold (94mm) near ${user.location_name || "your area"}. Seek elevated high ground immediately.`,
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

          {/* Modal: Send Emergency Alert */}
          {alertTargetUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
              <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 text-rose-700">
                    <ShieldAlert className="size-5" />
                    <h3 className="font-bold text-slate-900 text-base">
                      Dispatch Emergency Alert
                    </h3>
                  </div>
                  <button
                    onClick={() => setAlertTargetUser(null)}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="rounded-lg bg-rose-50/70 border border-rose-100 p-3 text-xs text-rose-900">
                  <span className="font-bold">Recipient Handset:</span> {alertTargetUser.full_name || "Citizen"} (
                  {alertTargetUser.phone_number || "No Phone"}) • Location: {alertTargetUser.location_name || "Pollachi Catchment Basin"}
                </div>

                {/* Pre-set Alert Buttons */}
                <div>
                  <Label className="text-xs font-semibold text-slate-700">Quick Incident Templates</Label>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() =>
                        setAlertForm({
                          hazard_type: "Flash Flood",
                          risk_level: "critical",
                          title: "Flash Flood Warning - High River Surge",
                          detail: "River water levels have reached critical threshold (94mm). Seek high ground immediately and avoid low-lying bridges.",
                        })
                      }
                      className="text-left rounded-md border border-slate-200 bg-slate-50 p-2 text-xs hover:border-rose-300 hover:bg-rose-50/50"
                    >
                      <p className="font-semibold text-slate-900">🚨 94mm Flash Flood Surge</p>
                      <p className="text-[11px] text-slate-500">Critical warning based on sensor_db</p>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setAlertForm({
                          hazard_type: "Severe Rainfall",
                          risk_level: "high",
                          title: "Torrential Cloudburst Warning",
                          detail: "Extreme rainfall detected in upper catchment. Inundation of roads and storm drains expected within 30 minutes.",
                        })
                      }
                      className="text-left rounded-md border border-slate-200 bg-slate-50 p-2 text-xs hover:border-amber-300 hover:bg-amber-50/50"
                    >
                      <p className="font-semibold text-slate-900">🌧️ Torrential Cloudburst</p>
                      <p className="text-[11px] text-slate-500">High rain intensity warning</p>
                    </button>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="hazard-type">Hazard Type</Label>
                      <Input
                        id="hazard-type"
                        value={alertForm.hazard_type}
                        onChange={(e) => setAlertForm((p) => ({ ...p, hazard_type: e.target.value }))}
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
                    <Label htmlFor="alert-title">Alert Title</Label>
                    <Input
                      id="alert-title"
                      value={alertForm.title}
                      onChange={(e) => setAlertForm((p) => ({ ...p, title: e.target.value }))}
                      className="mt-1 text-xs"
                    />
                  </div>

                  <div>
                    <Label htmlFor="alert-detail">Emergency Instructions &amp; Action Details</Label>
                    <textarea
                      id="alert-detail"
                      rows={3}
                      value={alertForm.detail}
                      onChange={(e) => setAlertForm((p) => ({ ...p, detail: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 p-2 text-xs focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                  <Button variant="outline" size="sm" onClick={() => setAlertTargetUser(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                    disabled={!alertForm.title || !alertForm.detail || sendAlertMutation.isPending}
                    onClick={() =>
                      sendAlertMutation.mutate({
                        userId: alertTargetUser.id,
                        payload: alertForm,
                      })
                    }
                  >
                    {sendAlertMutation.isPending ? "Dispatching…" : "Dispatch Emergency Alert"}
                  </Button>
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
