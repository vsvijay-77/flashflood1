import { supabase } from "@/lib/supabase";
import { useMemo, useState, useEffect, useRef } from "react";
import L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { Map as MapIcon, Radio, Waves, Trash2, ZoomIn, Globe, ArrowRight, MousePointerClick, Sparkles, Box, CloudRain } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import GISMap, { DEFAULT_LAYERS, type GISLayerState } from "@/components/gis/GISMap";
import { EmptyState, LoadingRows, LoadingSymbol, PageHeader, RiskIndicator, SectionCard, StatCard, StatusPill } from "@/components/Primitives";
import { apiGet } from "@/lib/api";
import { HAZARD_LABELS, SENSOR_LABELS, type Alert, type NetworkStats, type Sensor, type Zone } from "@/lib/types";

// New Dashboard Components
import { SystemStatusHeader } from "@/components/dashboard/SystemStatusHeader";
import { NetworkOverviewKPIs } from "@/components/dashboard/NetworkOverviewKPIs";

import { LiveSensorMonitoring } from "@/components/dashboard/LiveSensorMonitoring";
import { AccelerometerGraph } from "@/components/dashboard/AccelerometerGraph";


import { BatteryAndAlerts } from "@/components/dashboard/BatteryAndAlerts";

const AXIS = { stroke: "#94A3B8", fontSize: 11 };

function useNetwork() {
  const zones = useQuery({ queryKey: ["zones"], queryFn: () => apiGet<Zone[]>("/zones"), retry: false });
  const sensors = useQuery({ queryKey: ["sensors"], queryFn: () => apiGet<Sensor[]>("/sensors"), retry: false });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => apiGet<NetworkStats>("/stats"), retry: false });
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => apiGet<Alert[]>("/alerts"), retry: false });
  return { zones, sensors, stats, alerts };
}

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-8 bg-slate-50 min-h-screen pb-12" data-testid="dashboard-page">
      <SystemStatusHeader />
      
      <div className="px-4 sm:px-6 space-y-8 max-w-[1600px] mx-auto w-full">
        <NetworkOverviewKPIs />
        
        <hr className="border-slate-200" />
        <LiveSensorMonitoring />
        
        <hr className="border-slate-200" />
        <AccelerometerGraph />
        
        <hr className="border-slate-200" />
        <BatteryAndAlerts />

      </div>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { calculatePolygonAreaSqMeters, formatArea, parseCustomAreaPolygon } from "@/lib/gisUtils";
import type { CustomArea } from "@/lib/types";

const LAYER_ROWS: { key: keyof GISLayerState; label: string }[] = [
  { key: "customAreas", label: "Custom Monitored Areas" },
  { key: "areaLabels", label: "Area Names & Measurements" },
  { key: "boundaries", label: "Center Marker Badges" },
  { key: "satellite", label: "Satellite Imagery Layer" },
];

const getAreaThumbnail = (type: string) => {
  const t = type?.toLowerCase() || "";
  if (t.includes("forest")) return "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&q=60&w=400";
  if (t.includes("river") || t.includes("basin") || t.includes("water")) return "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&q=60&w=400";
  if (t.includes("urban") || t.includes("city")) return "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&q=60&w=400";
  return "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=60&w=400";
};

function getShapeClipStyle(shape: string): React.CSSProperties {
  const s = shape?.toLowerCase() || "";
  if (s === "circle") return { borderRadius: "50%", overflow: "hidden" };
  if (s === "hexagon") return { clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)", overflow: "hidden" };
  return { overflow: "hidden" }; // rectangle, square
}

function MiniSatelliteMap({
  lat,
  lng,
}: {
  polygon?: [number, number][];
  shape?: string;
  lat: number;
  lng: number;
  risk?: string;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const container = mapRef.current;
    if ((container as any)._leaflet_id) return;

    const center: [number, number] = [Number(lat), Number(lng)];

    const map = L.map(container, {
      center: center,
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      touchZoom: false,
    });

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
    }).addTo(map);

    const timer = setTimeout(() => {
      map.invalidateSize();
      map.setView(center, 14);
    }, 100);

    return () => {
      clearTimeout(timer);
      map.remove();
    };
  }, [lat, lng]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }} className="relative">
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

interface MonitoredAreaDetailsContentProps {
  selectedArea: CustomArea | null;
  customAreas: CustomArea[];
  loadingAreas?: boolean;
  onSelectArea: (area: CustomArea) => void;
  onDeleteTarget: (area: CustomArea) => void;
  onDrawMode: (v: boolean) => void;
  onFocusArea: (area: CustomArea) => void;
  onResetFocus: () => void;
  creatingTwin: boolean;
  handleCreateDigitalTwin: (area: CustomArea | null) => void;
}

function MonitoredAreaDetailsContent({
  selectedArea,
  customAreas,
  loadingAreas,
  onSelectArea,
  onDeleteTarget,
  onDrawMode,
  onFocusArea,
  onResetFocus,
  creatingTwin,
  handleCreateDigitalTwin,
}: MonitoredAreaDetailsContentProps) {
  if (!selectedArea) {
    return (
      <div className="flex flex-col justify-between h-full">
        <div>
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Monitored Area</p>
            <span className="text-[10px] bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
              {customAreas.length} {customAreas.length === 1 ? "Area" : "Areas"}
            </span>
          </div>

          <div className="mt-6 flex flex-col items-center justify-center text-center px-1">
            <div className="w-14 h-14 rounded-2xl bg-sky-50 border border-sky-100 flex items-center justify-center text-2xl shadow-xs mb-3 text-[#0F4C81]">
              <MousePointerClick className="size-7 text-[#0F4C81]" />
            </div>
            <h4 className="text-sm font-bold text-slate-900 mb-1">Select an Area on the Map</h4>
            <p className="text-xs text-slate-500 max-w-[240px] leading-relaxed mb-5">
              Click on any monitored boundary directly on the map or choose an area below to view its real-time satellite data.
            </p>

            {loadingAreas && customAreas.length === 0 ? (
              <LoadingSymbol size="sm" label="Loading monitored zones..." />
            ) : customAreas.length > 0 ? (
              <div className="w-full text-left">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Registered Monitored Areas:
                </p>
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-0.5">
                  {customAreas.map((area) => (
                    <button
                      key={area.id}
                      type="button"
                      onClick={() => onSelectArea(area)}
                      className="w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-[#0F4C81] hover:bg-sky-50/70 transition-all text-left group cursor-pointer"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-bold text-slate-800 group-hover:text-[#0F4C81] truncate">
                          {area.name}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {area.district} · {formatArea(area.areaSqMeters).sqKmFormatted}
                        </div>
                      </div>
                      <span
                        className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          area.risk === "Critical"
                            ? "bg-red-100 text-red-700"
                            : area.risk === "High"
                            ? "bg-orange-100 text-orange-700"
                            : area.risk === "Medium"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {area.risk}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-slate-100 text-center">
          <Button
            onClick={() => onDrawMode(true)}
            variant="outline"
            className="w-full text-xs font-semibold border-dashed border-slate-300 text-[#0F4C81] hover:bg-sky-50 cursor-pointer"
          >
            + Measure / Draw New Area
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-between h-full space-y-4">
      <div>
        {/* Header with Title and Delete Button */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div className="min-w-0 pr-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Selected Monitored Area</p>
            <h3 className="text-base font-bold text-slate-900 mt-0.5 truncate" data-testid="selected-location-name">
              {selectedArea.name}
            </h3>
            <p className="text-xs text-slate-500 truncate">{selectedArea.district}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 px-2.5 py-1 h-auto font-semibold transition-colors cursor-pointer shrink-0"
            onClick={() => onDeleteTarget(selectedArea)}
            title="Delete this monitored area"
          >
            <Trash2 className="size-3.5 mr-1" />
            Delete
          </Button>
        </div>

        <div className="mt-3.5 space-y-3.5">
          <div className="flex items-center justify-between">
            <span
              className={`text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full ${
                selectedArea.risk === "Critical"
                  ? "bg-red-100 text-red-700 border border-red-200"
                  : selectedArea.risk === "High"
                  ? "bg-orange-100 text-orange-700 border border-orange-200"
                  : selectedArea.risk === "Medium"
                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                  : "bg-emerald-100 text-emerald-700 border border-emerald-200"
              }`}
            >
              {selectedArea.risk} Risk
            </span>
            <span className="text-xs text-slate-600 font-medium bg-slate-100 px-2 py-0.5 rounded">
              {selectedArea.type}
            </span>
          </div>

          {/* Calculated Area Highlight */}
          <div className="bg-sky-50/90 border border-sky-200/90 rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-sky-800">Calculated Surface Area</div>
            <div className="text-lg font-black text-[#0F4C81] font-mono mt-0.5">
              {formatArea(selectedArea.areaSqMeters).sqMetersFormatted}
            </div>
            <div className="text-xs font-semibold text-teal-700 mt-0.5">
              {formatArea(selectedArea.areaSqMeters).sqKmFormatted}
            </div>
          </div>

          {/* Zoom to Land View Buttons */}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 text-xs bg-[#0F4C81] hover:bg-[#0B3A61] text-white font-semibold shadow-xs cursor-pointer"
              onClick={() => onFocusArea(selectedArea)}
            >
              <ZoomIn className="size-3.5 mr-1" />
              Zoom Land
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold cursor-pointer"
              onClick={onResetFocus}
            >
              <Globe className="size-3.5 mr-1" />
              Full India
            </Button>
          </div>

          <dl className="space-y-2 text-xs border-t border-slate-100 pt-2.5">
            {[
              ["Priority Level", selectedArea.priority],
              ["Center Coordinates", `${selectedArea.lat.toFixed(4)}, ${selectedArea.lng.toFixed(4)}`],
              ["Boundary Points", `${selectedArea.polygon?.length || 0} coordinates`],
              ["Boundary Type", "Custom Area Boundary"],
              ["Registered Date", selectedArea.date],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-slate-50 pb-1.5">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-mono font-semibold text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>

          {selectedArea.description && (
            <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
              {selectedArea.description}
            </div>
          )}
        </div>
      </div>

      {/* High-impact Attractive Satellite View Button & Create Digital Twin Button */}
      <div className="pt-2 space-y-2">
        <Button
          disabled={creatingTwin}
          onClick={() => handleCreateDigitalTwin(selectedArea)}
          className="w-full text-xs font-bold text-white bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 hover:from-emerald-700 hover:to-cyan-800 py-3 px-4 rounded-xl shadow-md transition-all duration-200 hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer border border-emerald-400/30"
          title="Generate ONE 3D GLB Digital Twin from 4 satellite tiles via Meshy Multi-Image-to-3D"
        >
          {creatingTwin ? (
            <>
              <span className="inline-block size-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Splitting 4 Tiles & Generating…</span>
            </>
          ) : (
            <>
              <Sparkles className="size-4 text-amber-300 animate-pulse" />
              <span>Create Digital Twin</span>
              <ArrowRight className="size-3.5" />
            </>
          )}
        </Button>

        <Link
          to="/area"
          state={{ area: selectedArea }}
          className="group relative overflow-hidden w-full text-xs font-bold text-white bg-gradient-to-r from-[#0F4C81] via-[#16568c] to-[#0B355A] hover:from-[#0B3A61] hover:to-[#07243e] py-2.5 px-4 rounded-xl text-center transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2 cursor-pointer border border-sky-400/40"
        >
          <span className="text-base animate-pulse">🛰️</span>
          <span className="tracking-wide">Inspect Detailed Satellite View</span>
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </div>
  );
}

export function GISMonitoringPage() {
  const mapTopRef = useRef<HTMLDivElement | null>(null);
  const [layers, setLayers] = useState<GISLayerState>(() => {
    const saved = localStorage.getItem("gis_layers_state");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_LAYERS;
  });

  useEffect(() => {
    localStorage.setItem("gis_layers_state", JSON.stringify(layers));
  }, [layers]);

  const [selectedArea, setSelectedArea] = useState<CustomArea | null>(null);
  const [focusedArea, setFocusedArea] = useState<CustomArea | null>(null);
  const navigate = useNavigate();
  const [creatingTwin, setCreatingTwin] = useState(false);

  const handleCreateDigitalTwin = async (areaToTwin: CustomArea | null) => {
    if (!areaToTwin) {
      toast.error("Please select a monitored area on the map first.");
      return;
    }
    setCreatingTwin(true);
    try {
      const coords =
        areaToTwin.polygon && areaToTwin.polygon.length >= 3
          ? areaToTwin.polygon
          : parseCustomAreaPolygon(areaToTwin.shape, areaToTwin.lat, areaToTwin.lng);

      const baseLat = Number(areaToTwin.lat || 10.66);
      const baseLng = Number(areaToTwin.lng || 77.00);
      let north = baseLat + 0.008;
      let south = baseLat - 0.008;
      let east = baseLng + 0.008;
      let west = baseLng - 0.008;

      if (coords && coords.length >= 3) {
        const lats = coords.map((c: [number, number]) => Number(c[0]));
        const lngs = coords.map((c: [number, number]) => Number(c[1]));
        north = Math.max(...lats);
        south = Math.min(...lats);
        east = Math.max(...lngs);
        west = Math.min(...lngs);
      }

      toast.success(`Opening 3D Digital Twin for "${areaToTwin.name}"…`);
      navigate("/digital-twin", {
        state: {
          area: areaToTwin,
          latitude: Number(areaToTwin.lat),
          longitude: Number(areaToTwin.lng),
        },
      });
    } catch (err: any) {
      console.error("Digital twin error:", err);
      toast.error(err.message || "Failed to open Digital Twin.");
    } finally {
      setCreatingTwin(false);
    }
  };

  // Custom Area Drawing State
  const [drawMode, setDrawMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomArea | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [currentLatlngs, setCurrentLatlngs] = useState<L.LatLng[]>([]);
  const [currentCalculatedArea, setCurrentCalculatedArea] = useState<number>(0);
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
            bounds: d.polygon && d.polygon.length >= 3 ? L.latLngBounds(d.polygon) : undefined,
          }));
        }
      }
    } catch (e) {
      console.warn("Failed to parse cached custom areas", e);
    }
    return [];
  });

  useEffect(() => {
    supabase
      .from("custom_areas")
      .select("*")
      .then(({ data }) => {
        setLoadingAreas(false);
        if (data) {
          const loaded: CustomArea[] = data.map((d: any) => {
            const shapeType = d.shape && d.shape.includes(":") ? d.shape.split(":")[0] : "Polygon";
            const polygonCoords = parseCustomAreaPolygon(d.shape, Number(d.lat), Number(d.lng));
            const areaSq = calculatePolygonAreaSqMeters(polygonCoords);
            const bounds = polygonCoords.length >= 3 ? L.latLngBounds(polygonCoords) : undefined;

            return {
              id: d.id,
              name: d.name,
              district: d.district,
              type: d.area_type || "Forest",
              risk: d.risk_category || "Medium",
              priority: d.priority || "Normal",
              description: d.description || "",
              bounds: bounds,
              date: new Date(d.created_at).toLocaleDateString(),
              lat: Number(d.lat),
              lng: Number(d.lng),
              shape: shapeType,
              polygon: polygonCoords,
              areaSqMeters: areaSq,
              user_id: d.user_id,
            };
          });

          setCustomAreas(loaded);
          try {
            localStorage.setItem("cached_custom_areas", JSON.stringify(loaded.map(({ bounds, ...rest }) => rest)));
          } catch (e) {
            console.warn("Failed to persist custom areas to localStorage", e);
          }
        }
      },
      () => {
        setLoadingAreas(false);
      });
  }, []);

  const handleAreaSelected = (latlngs: L.LatLng[], calculatedAreaSqMeters: number) => {
    setCurrentLatlngs(latlngs);
    setCurrentCalculatedArea(calculatedAreaSqMeters);
    setDrawMode(false);
  };

  const detailsContent = (
    <MonitoredAreaDetailsContent
      selectedArea={selectedArea}
      customAreas={customAreas}
      loadingAreas={loadingAreas}
      onSelectArea={(area) => {
        setSelectedArea(area);
        setFocusedArea(area);
      }}
      onDeleteTarget={(area) => setDeleteTarget(area)}
      onDrawMode={(v) => setDrawMode(v)}
      onFocusArea={(area) => {
        setFocusedArea({ ...area });
        mapTopRef.current?.scrollIntoView({ behavior: "smooth" });
      }}
      onResetFocus={() => setFocusedArea(null)}
      creatingTwin={creatingTwin}
      handleCreateDigitalTwin={handleCreateDigitalTwin}
    />
  );

  return (
    <div data-testid="gis-monitoring-page" ref={mapTopRef}>
      <PageHeader
        title="GIS Custom Area Monitoring"
        description="Full India national geospatial overview by default. Zoom into marked custom monitoring boundaries to inspect land terrain and surface areas in square metres."
      />
      <div className="grid gap-6 xl:grid-cols-[250px_1fr_310px]">
        <div className="flex flex-col gap-6">
          <Card className="border-slate-200/80 p-5" data-testid="map-layers-panel">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Map Layers</p>
            <div className="mt-4 space-y-3">
              {LAYER_ROWS.map((row) => (
                <label key={row.key} className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
                  <Checkbox
                    checked={Boolean(layers[row.key])}
                    onCheckedChange={(v) => {
                      const checked = Boolean(v);
                      setLayers((p) => ({ ...p, [row.key]: checked }));
                      if (row.key === "customAreas" && !checked) {
                        setSelectedArea(null);
                        setFocusedArea(null);
                      }
                    }}
                    data-testid={`layer-toggle-${row.key}`}
                  />
                  <span>{row.label}</span>
                </label>
              ))}
            </div>
          </Card>

          <Card className="border-slate-200/80 p-5 bg-sky-50/50">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Custom Area Measurement</p>
            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Define custom area boundaries on the map. The system automatically computes the exact enclosed surface area in <strong>square metres (m²)</strong>.
            </p>
            <Button
              onClick={() => {
                setDrawMode(!drawMode);
              }}
              className={`w-full ${drawMode ? "bg-amber-500 hover:bg-amber-600 text-white" : "bg-[#0F4C81] hover:bg-[#0B3A61]"}`}
            >
              {drawMode ? "Cancel Drawing" : "Select Custom Area"}
            </Button>
            {drawMode && (
              <div className="mt-3 space-y-1.5 p-2.5 bg-amber-50 rounded-md border border-amber-200">
                <p className="text-xs text-amber-800 font-semibold text-center animate-pulse">
                  Click points on map to measure boundary
                </p>
                <ul className="text-[11px] text-amber-900/80 space-y-1 leading-relaxed">
                  <li>• Click to place each point</li>
                  <li>• Click first point or double-click to close</li>
                  <li>• Real-time sq. metre area calculation</li>
                </ul>
              </div>
            )}
          </Card>
        </div>

        <Card className="overflow-hidden border-slate-200/80 p-0 relative shadow-sm">
          <div className="h-[580px]">
            <GISMap
              customAreas={customAreas}
              selectedArea={selectedArea}
              focusedArea={focusedArea}
              onSelectArea={(area) => {
                setSelectedArea(area);
                setFocusedArea(area);
              }}
              layers={layers}
              drawMode={drawMode}
              onToggleDrawMode={(v) => setDrawMode(v)}
              onAreaSelected={handleAreaSelected}
              onAreaCreated={(newArea) => {
                setCustomAreas((prev) => [newArea, ...prev]);
                setSelectedArea(newArea);
                setFocusedArea(newArea);
              }}
              testId="gis-monitoring-map"
              detailsPanel={detailsContent}
            />
          </div>
        </Card>

        <Card className="border-slate-200/80 p-5 flex flex-col justify-between shadow-sm bg-white min-h-[580px]" data-testid="selected-location-panel">
          {detailsContent}
        </Card>
      </div>



      {/* ─── Custom Delete Confirmation Modal ─────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100002] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Red header banner */}
            <div className="bg-gradient-to-r from-red-600 to-rose-600 px-6 py-5 text-white">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <Trash2 className="size-5" />
                </div>
                <div>
                  <h4 className="font-bold text-base leading-tight">Delete Monitored Area</h4>
                  <p className="text-red-100 text-xs mt-0.5">This action cannot be undone</p>
                </div>
              </div>
            </div>

            {/* Area info */}
            <div className="px-6 py-4">
              <div className="bg-red-50 border border-red-100 rounded-lg p-3.5 mb-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-red-700 mb-1">Area to be deleted</div>
                <div className="font-bold text-slate-900 text-sm">{deleteTarget.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{deleteTarget.district} · {deleteTarget.type}</div>
                {deleteTarget.areaSqMeters && (
                  <div className="text-xs font-mono text-red-700 font-semibold mt-1">
                    {formatArea(deleteTarget.areaSqMeters).sqMetersFormatted}
                  </div>
                )}
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                You're about to permanently delete <span className="font-bold text-slate-800">"{deleteTarget.name}"</span> from your monitoring system. All associated boundary data and measurements will be lost.
              </p>
            </div>

            {/* Actions */}
            <div className="px-6 pb-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={async () => {
                  if (!deleteTarget) return;
                  setDeleteLoading(true);
                  await supabase.from("custom_areas").delete().eq("id", deleteTarget.id);
                  const safeName = deleteTarget.name.replace(/\s+/g, "_");
                  localStorage.removeItem(`dt_mesh_nodes_${safeName}`);
                  localStorage.removeItem(`dt_user_activity_${safeName}`);
                  localStorage.removeItem(`dt_networks_${safeName}`);
                  const filtered = customAreas.filter((a) => a.id !== deleteTarget.id);
                  setCustomAreas(filtered);
                  if (selectedArea?.id === deleteTarget.id) {
                    setSelectedArea(filtered[0] || null);
                    setFocusedArea(null);
                  }
                  setDeleteTarget(null);
                  setDeleteLoading(false);
                }}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {deleteLoading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4" />
                    Yes, Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function EnvironmentalMonitoringPage() {
  const { sensors, zones } = useNetwork();
  const [zoneId, setZoneId] = useState<string>("");
  const list = useMemo(
    () => (sensors.data ?? []).filter((s) => !zoneId || s.zone_id === zoneId),
    [sensors.data, zoneId],
  );

  return (
    <div data-testid="environmental-monitoring-page">
      <PageHeader title="Environmental Monitoring" description="Latest LoRa uplink readings from every deployed sensor node." />
      <div className="mb-4 flex flex-wrap gap-2" data-testid="environmental-zone-filters">
        <button
          onClick={() => setZoneId("")}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${zoneId === "" ? "border-[#0F4C81] bg-[#0F4C81] text-white" : "border-slate-200 bg-white text-slate-600"}`}
          data-testid="environmental-filter-all"
        >
          All Zones
        </button>
        {(zones.data ?? []).map((z) => (
          <button
            key={z.id}
            onClick={() => setZoneId(z.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${zoneId === z.id ? "border-[#0F4C81] bg-[#0F4C81] text-white" : "border-slate-200 bg-white text-slate-600"}`}
            data-testid={`environmental-filter-${z.id}`}
          >
            {z.name}
          </button>
        ))}
      </div>

      <SectionCard testId="environmental-readings-card" title="Sensor readings" description={`${list.length} nodes reporting`}>
        {sensors.isLoading ? (
          <LoadingRows rows={5} />
        ) : list.length === 0 ? (
          <EmptyState testId="environmental-empty" title="No sensor readings" description="No nodes are registered for this zone yet." />
        ) : (
          <Table data-testid="environmental-readings-table">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Zone</TableHead>
                <TableHead>Reading</TableHead>
                <TableHead>Battery</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => (
                <TableRow key={s.id} data-testid={`sensor-row-${s.code}`}>
                  <TableCell className="font-mono text-xs font-semibold">{s.code}</TableCell>
                  <TableCell>{SENSOR_LABELS[s.sensor_type] ?? s.sensor_type}</TableCell>
                  <TableCell className="text-xs text-slate-500">{s.zone_name}</TableCell>
                  <TableCell className="font-mono font-semibold">{s.last_value} {s.unit}</TableCell>
                  <TableCell className="font-mono text-xs">{s.battery}%</TableCell>
                  <TableCell><StatusPill status={s.status} testId={`sensor-status-${s.code}`} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}

export function AnalyticsPage() {
  const { zones, sensors } = useNetwork();
  const zoneList = zones.data ?? [];
  const byRisk = zoneList.map((z) => ({ name: z.district, risk: z.risk_score, rainfall: z.rainfall_mm }));
  const online = (sensors.data ?? []).filter((s) => s.status === "online").length;

  return (
    <div data-testid="analytics-page">
      <PageHeader title="Analytics" description="Comparative hazard analytics across monitored districts." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard testId="analytics-kpi-zones" label="Zones analysed" value={zoneList.length} icon={<MapIcon className="size-5" />} />
        <StatCard testId="analytics-kpi-online" label="Nodes reporting" value={online} icon={<Radio className="size-5" />} tone="green" />
        <StatCard testId="analytics-kpi-peak" label="Peak risk score" value={zoneList.length ? Math.max(...zoneList.map((z) => z.risk_score)) : "—"} icon={<Waves className="size-5" />} tone="red" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard testId="analytics-risk-chart" title="Risk score by district">
          {byRisk.length === 0 ? (
            <EmptyState testId="analytics-risk-empty" title="No zone data available" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byRisk}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={AXIS} />
                <YAxis tick={AXIS} />
                <Tooltip />
                <Bar dataKey="risk" fill="#0F4C81" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
        <SectionCard testId="analytics-rainfall-chart" title="Rainfall intensity by district">
          {byRisk.length === 0 ? (
            <EmptyState testId="analytics-rainfall-empty" title="No rainfall data available" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byRisk}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={AXIS} />
                <YAxis tick={AXIS} />
                <Tooltip />
                <Bar dataKey="rainfall" fill="#0D9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// ─── 8 Primary GIS Layers Configuration (4 Up, 4 Down) ─────────────────────
interface GisLayerDef {
  id: string;
  icon: string;
  name: string;
  purpose: string;
  endpoint?: string;
  isSatellite?: boolean;
  opacity: number;
  baseOpacity: number;
  legend: { color: string; label: string; border?: string }[];
}

const GIS_8_LAYERS: GisLayerDef[] = [
  {
    id: "satellite",
    icon: "🛰️",
    name: "Satellite",
    purpose: "Visual monitoring",
    isSatellite: true,
    opacity: 1,
    baseOpacity: 1,
    legend: [
      { color: "#2B5329", label: "Vegetation" },
      { color: "#8B7355", label: "Soil / Land" },
      { color: "#1C39BB", label: "Water Bodies" },
    ],
  },
  {
    id: "elevation",
    icon: "⛰️",
    name: "SRTM 30m Elevation (STM 30)",
    purpose: "NASA/USGS SRTM 30m DEM",
    endpoint: "/api/gee/layer-tiles?layer=elevation",
    opacity: 0.85,
    baseOpacity: 0.25,
    legend: [
      { color: "#000080", label: "0m Sea" },
      { color: "#00FF00", label: "500m" },
      { color: "#FFFF00", label: "1500m" },
      { color: "#FF0000", label: "3000m+" },
    ],
  },
  {
    id: "slope",
    icon: "📐",
    name: "Slope",
    purpose: "Landslide analysis",
    endpoint: "/api/gee/layer-tiles?layer=slope",
    opacity: 0.9,
    baseOpacity: 0.25,
    legend: [
      { color: "#00A000", label: "0–10° Low" },
      { color: "#FFFF00", label: "10–25° Mod" },
      { color: "#FF8000", label: "25–45° High" },
      { color: "#FF0000", label: "45°+ Steep" },
    ],
  },
  {
    id: "ndvi",
    icon: "🌳",
    name: "NDVI",
    purpose: "Vegetation health",
    endpoint: "/api/gee/layer-tiles?layer=ndvi",
    opacity: 0.85,
    baseOpacity: 0.25,
    legend: [
      { color: "#d73027", label: "Barren (<0)" },
      { color: "#ffffbf", label: "Sparse (0.2–0.4)" },
      { color: "#1a9641", label: "Dense (>0.6)" },
    ],
  },
  {
    id: "ndwi",
    icon: "💧",
    name: "NDWI",
    purpose: "Water detection",
    endpoint: "/api/gee/layer-tiles?layer=ndwi",
    opacity: 0.85,
    baseOpacity: 0.25,
    legend: [
      { color: "#8B4513", label: "Dry (< -0.2)" },
      { color: "#87CEEB", label: "Moist" },
      { color: "#0000CD", label: "Water (>0.2)" },
    ],
  },
  {
    id: "flood",
    icon: "🌊",
    name: "Flood Extent",
    purpose: "Inundation Detection",
    endpoint: "/api/gee/layer-tiles?layer=flood",
    opacity: 0.9,
    baseOpacity: 0.25,
    legend: [
      { color: "#0066FF", label: "Inundated Water" },
    ],
  },
  {
    id: "rainfall",
    icon: "🌧️",
    name: "Rainfall",
    purpose: "Live precipitation rate",
    endpoint: "/api/gee/layer-tiles?layer=rainfall",
    opacity: 0.88,
    baseOpacity: 0.25,
    legend: [
      { color: "#08306B", label: "< 0.1" },
      { color: "#41B6C4", label: "0.5" },
      { color: "#74C476", label: "0.8" },
      { color: "#FFFF00", label: "1.2" },
      { color: "#FF7F00", label: "1.5" },
      { color: "#E31A1C", label: "2.0+ mm/h" },
    ],
  },
  {
    id: "soil_moisture",
    icon: "💦",
    name: "Soil Moisture",
    purpose: "Landslide saturation risk",
    endpoint: "/api/gee/layer-tiles?layer=soil_moisture",
    opacity: 0.85,
    baseOpacity: 0.25,
    legend: [
      { color: "#FED98E", label: "Dry (<0.15)" },
      { color: "#7FCDBB", label: "Mod (~0.28)" },
      { color: "#081D58", label: "Saturated (>0.45)" },
    ],
  },
];

// ─── Individual GIS Map Panel Component ──────────────────────────────────────
function GisMapPanel({
  layer,
  area,
  coords,
  sampleValues,
  tileData,
  height = "220px",
  onZoom,
  onTimestamp,
}: {
  layer: GisLayerDef;
  area: CustomArea;
  coords: [number, number][];
  sampleValues: { lat: number; lng: number; slope: number | null; elevation: number | null }[];
  tileData?: { tileUrl?: string; timestamp?: string; isForecast?: boolean; error?: string };
  height?: string;
  onZoom?: () => void;
  onTimestamp?: (ts: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const geeLayerRef = useRef<L.TileLayer | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Initialize Leaflet Map Instance ONCE per area & layer ID
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !area) return;
    if ((el as any)._leaflet_id) {
      mapRef.current?.remove();
      mapRef.current = null;
    }

    const center: [number, number] = [Number(area.lat), Number(area.lng)];
    const map = L.map(el, {
      center,
      zoom: 6,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      touchZoom: false,
      keyboard: false,
    });
    mapRef.current = map;

    // Base tile layer
    const baseTileUrl = layer.isSatellite
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

    L.tileLayer(baseTileUrl, { maxZoom: 19, opacity: layer.baseOpacity }).addTo(map);



    // Create a layer group for sample markers
    const markersGroup = L.layerGroup().addTo(map);
    markersGroupRef.current = markersGroup;

    const applyBounds = () => {
      if (!mapRef.current) return;
      mapRef.current.invalidateSize();
      if (coords.length >= 3) {
        const bounds = L.latLngBounds(coords.map(([la, ln]) => L.latLng(la, ln)));
        if (bounds.isValid()) mapRef.current.fitBounds(bounds, { padding: [4, 4], maxZoom: 19, animate: false });
      } else {
        mapRef.current.setView(center, 18, { animate: false });
      }
    };

    const boundsTimer = setTimeout(applyBounds, 40);

    return () => {
      clearTimeout(boundsTimer);
      if (geeLayerRef.current && mapRef.current) {
        mapRef.current.removeLayer(geeLayerRef.current);
        geeLayerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      markersGroupRef.current = null;
    };
  }, [layer.id, area?.id]);

  // 2. Add / Update Sample Value Markers without recreating the map (omit for satellite)
  useEffect(() => {
    const group = markersGroupRef.current;
    if (!group || !sampleValues || sampleValues.length === 0 || layer.isSatellite) return;
    group.clearLayers();

    sampleValues.forEach((v) => {
      let badgeHtml = "";
      if (layer.id === "slope" && v.slope !== null) {
        const color = v.slope < 10 ? "#00A000" : v.slope < 25 ? "#D97706" : v.slope < 45 ? "#EA580C" : "#DC2626";
        badgeHtml = `<div style="background:${color};color:#FFFFFF;font:800 14px/1.2 'IBM Plex Mono',monospace;padding:5px 9px;border-radius:6px;border:2px solid rgba(255,255,255,0.95);white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,0.55);transform:translate(-50%,-50%)">📐 ${v.slope}°</div>`;
      } else if (layer.id === "elevation" && v.elevation !== null) {
        badgeHtml = `<div style="background:#000000;color:#FFFFFF;font:800 14px/1.2 'IBM Plex Mono',monospace;padding:5px 9px;border-radius:6px;border:2px solid rgba(255,255,255,0.95);white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,0.75);transform:translate(-50%,-50%)">⛰️ ${v.elevation}m</div>`;
      }
      if (badgeHtml) {
        L.marker([v.lat, v.lng], {
          icon: L.divIcon({ className: "", html: badgeHtml, iconSize: [0, 0] }),
          interactive: false,
        }).addTo(group);
      }
    });
  }, [sampleValues, layer.id]);

  // 3. Overlay GEE Tile Data on Existing Leaflet Map (never tears down the map)
  useEffect(() => {
    let cancelled = false;

    const applyTileData = (data: { tileUrl?: string; timestamp?: string; isForecast?: boolean; error?: string }) => {
      if (cancelled || !mapRef.current) return;
      if (data.error) {
        setError(data.error);
        setLoading(false);
        return;
      }
      if (data.timestamp && onTimestamp && !data.isForecast) {
        onTimestamp(data.timestamp);
      }
      if (data.tileUrl) {
        if (geeLayerRef.current && mapRef.current) {
          mapRef.current.removeLayer(geeLayerRef.current);
        }
        const geeLayer = L.tileLayer(data.tileUrl, {
          maxZoom: 19,
          opacity: layer.opacity,
          attribution: "Google Earth Engine",
          keepBuffer: 8,
          updateWhenIdle: false,
        });
        geeLayer.addTo(mapRef.current);
        geeLayerRef.current = geeLayer;
        mapRef.current.invalidateSize();
      }
      setLoading(false);
    };

    if (tileData) {
      applyTileData(tileData);
    } else if (layer.isSatellite) {
      setLoading(false);
    } else {
      setLoading(true);
    }

    return () => {
      cancelled = true;
    };
  }, [tileData, layer.opacity, layer.isSatellite]);

  return (
    <div className="group relative flex flex-col h-full bg-slate-900 overflow-hidden border border-slate-700/60 rounded-xl shadow-md transition-all hover:border-sky-500/60 hover:shadow-xl">
      {/* Header - Fixed uniform height & layout across all cards */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950/95 border-b border-slate-800 text-white shrink-0 h-[52px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">{layer.icon}</span>
          <div className="min-w-0">
            <div className="text-xs font-black tracking-wide text-white flex items-center gap-1.5 truncate">
              {layer.name}
              {loading && <span className="inline-block w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin ml-1 shrink-0" />}
            </div>
            <div className="text-[10px] text-slate-400 truncate">{layer.purpose}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onZoom && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onZoom();
              }}
              title="Zoom this map"
              className="p-1 rounded bg-sky-600/80 hover:bg-sky-500 text-white text-[11px] font-bold px-2 py-0.5 transition-colors cursor-pointer flex items-center gap-1 shrink-0"
            >
              🔍 Zoom
            </button>
          )}
        </div>
      </div>

      {/* Map Canvas - Strict uniform container */}
      <div className="relative w-full overflow-hidden bg-slate-950 shrink-0" style={{ height }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%", pointerEvents: "none", userSelect: "none" }} />

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/85 text-red-300 text-xs p-3 text-center">
            ⚠ GEE layer unavailable: {error}
          </div>
        )}
      </div>

      {/* Legend - Outside the map canvas in dedicated bottom panel */}
      <div className="bg-slate-950 px-3 py-2 border-t border-slate-800/80 flex items-center min-h-[48px] h-[48px] shrink-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] w-full">
          <span className="font-bold text-slate-400 text-[10px] uppercase tracking-wider shrink-0 mr-0.5">Legend:</span>
          {layer.legend.map((item) => (
            <div key={item.label} className="flex items-center gap-1 shrink-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-xs shrink-0"
                style={{ background: item.color, border: item.border || "1px solid rgba(255,255,255,0.2)" }}
              />
              <span className="text-[10px] text-slate-300 font-medium whitespace-nowrap">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Module-level memory caches for instant re-visits and fast navigation
let cachedBatchTileData: Record<string, any> | null = null;
let cachedCommonDate: string | null = null;
const cachedSampleValues: Record<string, any> = {};

// ─── AreaDetailsPage Component ───────────────────────────────────────────────
export function AreaDetailsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const area = location.state?.area as CustomArea;

  const [zoomedLayerId, setZoomedLayerId] = useState<string | null>(null);
  const [commonDate, setCommonDate] = useState<string | null>(() => cachedCommonDate);
  const [batchTileData, setBatchTileData] = useState<Record<string, any>>(() => cachedBatchTileData || {});
  const [creatingTwin, setCreatingTwin] = useState(false);

  const coords = useMemo(() => {
    if (!area) return [] as [number, number][];
    return (area.polygon && area.polygon.length >= 3
      ? area.polygon
      : parseCustomAreaPolygon(area.shape, Number(area.lat), Number(area.lng))) as [number, number][];
  }, [area]);

  const handleCreateDigitalTwin = async () => {
    if (!area) return;
    setCreatingTwin(true);
    try {
      const baseLat = Number(area.lat || 10.66);
      const baseLng = Number(area.lng || 77.00);
      let north = baseLat + 0.008;
      let south = baseLat - 0.008;
      let east = baseLng + 0.008;
      let west = baseLng - 0.008;

      if (coords && coords.length >= 3) {
        const lats = coords.map((c) => Number(c[0]));
        const lngs = coords.map((c) => Number(c[1]));
        north = Math.max(...lats);
        south = Math.min(...lats);
        east = Math.max(...lngs);
        west = Math.min(...lngs);
      }

      toast.success(`Opening 3D Digital Twin for "${area.name}"…`);
      navigate("/digital-twin", {
        state: {
          area,
          latitude: Number(area.lat),
          longitude: Number(area.lng),
        },
      });
    } catch (err: any) {
      console.error("Digital twin error:", err);
      toast.error(err.message || "Failed to open Digital Twin.");
    } finally {
      setCreatingTwin(false);
    }
  };

  const handleTimestamp = (ts: string) => {
    if (!ts) return;
    setCommonDate((prev) => {
      const next = !prev ? ts : new Date(ts).getTime() > new Date(prev).getTime() ? ts : prev;
      cachedCommonDate = next;
      return next;
    });
  };

  // Batch fetch all 7 GEE layers concurrently in a single HTTP request (cached in memory)
  useEffect(() => {
    if (cachedBatchTileData && Object.keys(cachedBatchTileData).length > 0) {
      return;
    }
    fetch("/api/gee/batch-tiles?layers=elevation,slope,ndvi,ndwi,flood,rainfall,soil_moisture")
      .then((r) => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        return r.json();
      })
      .then((data) => {
        cachedBatchTileData = data;
        setBatchTileData(data);
        Object.values(data).forEach((layerData: any) => {
          if (layerData.timestamp && !layerData.isForecast) {
            handleTimestamp(layerData.timestamp);
          }
        });
      })
      .catch((err) => {
        const errorState: Record<string, any> = {};
        GIS_8_LAYERS.forEach((l) => {
          if (!l.isSatellite) errorState[l.id] = { error: err?.message || "Unavailable" };
        });
        setBatchTileData(errorState);
      });
  }, []);

  // Sample values for enlarged markings (numeric only)
  const [sampleValues, setSampleValues] = useState<{ lat: number; lng: number; slope: number | null; elevation: number | null }[]>([]);

  // Format ISO date "2026-09-01" → "1 Sep 2026"
  const formatDisplayDate = (iso: string) => {
    try {
      return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    } catch {
      return iso;
    }
  };


  const areaSq = useMemo(() => {
    if (!area) return 0;
    return area.areaSqMeters && area.areaSqMeters > 0
      ? area.areaSqMeters
      : calculatePolygonAreaSqMeters(coords);
  }, [area, coords]);

  const areaFormatted = useMemo(() => formatArea(areaSq), [areaSq]);

  // Sample GEE values at centroid + polygon vertices
  const samplePoints: [number, number][] = useMemo(() => {
    const pts: [number, number][] = [[area?.lat ?? 0, area?.lng ?? 0]];
    if (coords.length >= 3) {
      const step = Math.max(1, Math.floor(coords.length / 4));
      for (let i = 0; i < coords.length && pts.length < 5; i += step) {
        pts.push([coords[i][0], coords[i][1]]);
      }
    }
    return pts;
  }, [area, coords]);

  useEffect(() => {
    if (!area) return;
    const cacheKey = `${area.id || area.name || "default"}_${samplePoints.length}`;
    if (cachedSampleValues[cacheKey]) {
      setSampleValues(cachedSampleValues[cacheKey]);
      return;
    }
    Promise.all(
      samplePoints.map(([lat, lng]) =>
        fetch(`/api/gee/sample-values?lat=${lat}&lng=${lng}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Status ${r.status}`))))
          .catch(() => ({ lat, lng, elevation_m: null, slope_deg: null }))
      )
    ).then((results) => {
      const vals = results.map((r) => ({ lat: r.lat, lng: r.lng, slope: r.slope_deg, elevation: r.elevation_m }));
      cachedSampleValues[cacheKey] = vals;
      setSampleValues(vals);
    });
  }, [area, samplePoints]);

  const zoomedLayer = useMemo(() => {
    return GIS_8_LAYERS.find((l) => l.id === zoomedLayerId) || null;
  }, [zoomedLayerId]);

  if (!area) {
    return <Navigate to="/gis" replace />;
  }

  return (
    <div data-testid="area-details-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <PageHeader
          title={area.name}
          description={`Geospatial specifications and 8-layer environmental analysis for ${area.district}`}
        />
        <div className="flex items-center gap-2 self-start sm:self-center shrink-0 flex-wrap">
          <Button
            disabled={creatingTwin}
            onClick={handleCreateDigitalTwin}
            size="sm"
            className="bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 cursor-pointer border border-emerald-400/30"
            title="Generate ONE 3D GLB Digital Twin model from 4 satellite tiles"
          >
            {creatingTwin ? (
              <>
                <span className="inline-block size-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Processing 4 Tiles…</span>
              </>
            ) : (
              <>
                <Sparkles className="size-3.5 text-amber-300 animate-pulse" />
                <span>Create Digital Twin</span>
              </>
            )}
          </Button>
          <Link
            to="/digital-twin"
            state={{ area }}
            className={buttonVariants({
              size: "sm",
              className: "bg-[#0F4C81] hover:bg-[#0B3A61] text-white shadow-sm font-semibold flex items-center gap-1.5",
            })}
          >
            <Box className="size-3.5" />
            <span>Digital Twin View</span>
          </Link>
          <Link
            to="/gis"
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "border-slate-300 text-slate-700 hover:bg-slate-100",
            })}
          >
            ← Back to GIS Dashboard
          </Link>
        </div>
      </div>

      {/* ─── Top KPI Cards (with Latitude & Longitude near Risk Assessment) ─── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mt-6">
        <Card className="p-4 border-slate-200 bg-white shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Surface Area (m²)</div>
          <div className="text-xl font-black text-[#0F4C81] font-mono mt-1">
            {Math.round(areaSq).toLocaleString()} m²
          </div>
          <div className="text-[11px] text-teal-700 mt-0.5">Exact geodesic square metres</div>
        </Card>

        <Card className="p-4 border-slate-200 bg-white shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Surface Area (km²)</div>
          <div className="text-xl font-black text-slate-900 font-mono mt-1">
            {areaFormatted.sqKmFormatted}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Metric square kilometres</div>
        </Card>

        {/* Latitude & Longitude Card */}
        <Card className="p-4 border-slate-200 bg-white shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Coordinates (Lat / Lng)</div>
          <div className="text-base font-black text-slate-900 font-mono mt-1 bg-sky-50 text-[#0F4C81] px-2 py-0.5 rounded border border-sky-100">
            {area.lat.toFixed(4)}°, {area.lng.toFixed(4)}°
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">WGS84 GPS Latitude & Longitude</div>
        </Card>

        {/* Risk Assessment Card */}
        <Card className="p-4 border-slate-200 bg-white shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Risk Assessment</div>
          <div className="mt-1">
            <span
              className={`text-xs font-bold uppercase px-2.5 py-1 rounded ${
                area.risk === "Critical"
                  ? "bg-red-100 text-red-700"
                  : area.risk === "High"
                  ? "bg-orange-100 text-orange-700"
                  : area.risk === "Medium"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {area.risk}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Priority: {area.priority} · {area.type}</div>
        </Card>

        <Card className="p-4 border-slate-200 bg-white shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Boundary Coordinates</div>
          <div className="text-xl font-black text-slate-900 font-mono mt-1">
            {coords.length} Points
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Geospatial boundary coordinates</div>
        </Card>
      </div>

      {/* ─── 8 Maps Section: 4 Up, 4 Down by Default ───────────────────────── */}
      <div className="mt-6">
        {zoomedLayer ? (
          /* Zoom View: Left = Zoomed Map | Right = "It will be updated soon" */
          <div className="grid gap-6 lg:grid-cols-2 items-start">
            {/* Left: Zoomed Map */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setZoomedLayerId(null)}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                >
                  ← Back to All 8 Maps Grid
                </button>
                <span className="text-xs text-slate-500 font-medium">
                  Zoomed View: <span className="font-bold text-slate-900">{zoomedLayer.name}</span>
                </span>
              </div>
              <GisMapPanel
                layer={zoomedLayer}
                area={area}
                coords={coords}
                sampleValues={sampleValues}
                tileData={batchTileData[zoomedLayer.id]}
                height="480px"
              />
            </div>

            {/* Right: 3D Digital Twin action card */}
            <Card className="p-8 border-dashed border-2 border-slate-200 bg-slate-50/50 shadow-sm flex flex-col items-center justify-center text-center min-h-[520px]">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl shadow-sm mb-4">
                ✨
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">3D Digital Twin Simulation</h3>
              <p className="text-sm text-slate-600 max-w-sm leading-relaxed mb-6">
                Reconstruct a unified 3D GLB terrain model for <span className="font-semibold text-slate-800">"{area.name}"</span>. Captures high-resolution satellite imagery, divides into 4 overlapping tiles, and runs Meshy Multi-Image-to-3D.
              </p>

              <div className="flex flex-col sm:flex-row gap-2 justify-center w-full max-w-xs">
                <Button
                  disabled={creatingTwin}
                  onClick={handleCreateDigitalTwin}
                  className="w-full text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 py-2.5 px-4 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {creatingTwin ? (
                    <>
                      <span className="inline-block size-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Processing 4 Tiles…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4 text-amber-300 animate-pulse" />
                      <span>Create Digital Twin</span>
                    </>
                  )}
                </Button>
                <button
                  onClick={() => setZoomedLayerId(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors cursor-pointer shadow-xs"
                >
                  View All 8 Maps
                </button>
              </div>
            </Card>
          </div>
        ) : (
          /* Default: 8 Maps 4 Up, 4 Down Grid */
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Google Earth Engine Satellite Analysis</h3>
                <p className="text-xs text-slate-500">8 live environmental layers (4 up, 4 down) — Click 🔍 Zoom on any map to expand</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {commonDate && (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-full border border-sky-200">
                    🛰️ Imagery Date: {formatDisplayDate(commonDate)}
                  </span>
                )}
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  8 Live Environmental Layers
                </span>
                <Link
                  to="/dashboard"
                  className="flex items-center gap-1 text-[11px] font-bold text-white bg-[#0F4C81] hover:bg-[#0B3A61] px-2.5 py-1 rounded-lg transition-colors cursor-pointer shadow-xs"
                  title="Navigate to Live Monitoring Tab"
                >
                  📊 Monitoring Tab →
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
              {GIS_8_LAYERS.map((layer) => (
                <div
                  key={layer.id}
                  onClick={() => setZoomedLayerId(layer.id)}
                  className="cursor-pointer h-full"
                >
                  <GisMapPanel
                    layer={layer}
                    area={area}
                    coords={coords}
                    sampleValues={sampleValues}
                    tileData={batchTileData[layer.id]}
                    height="210px"
                    onZoom={() => setZoomedLayerId(layer.id)}
                    onTimestamp={handleTimestamp}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

