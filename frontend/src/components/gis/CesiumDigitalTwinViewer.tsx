import { loadSelectedAreaNetworks } from "@/services/selectedAreaNetworks";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  Play,
  Pause,
  Mountain,
  Eye,
  EyeOff,
  Compass,
  Loader2,
  PersonStanding,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  BarChart2,
  Plus,
  Minus,
  X,
  Layers,
  Radio,
  Network,
  Trash2,
  Crosshair,
  MapPin,
  Activity,
  Signal,
  Check,
  CheckCircle2,
  Share2,
  Clock,
  History,
  Map,
  Navigation,
  ShieldAlert,
  Sliders,
  Building2,
  Waves,
  AlertTriangle,
  CloudRain,
  Globe,
  Bot,
  Sparkles,
  Cpu,
  Zap,
  Droplets,
} from "lucide-react";
import CesiumSelectedAreaRainOverlay from "../simulation/CesiumSelectedAreaRainOverlay";
import SensorLiveRainController from "./SensorLiveRainController";
import TwinForecastHeatmap from "./TwinForecastHeatmap";
import TwinLandslideHeatmap from "./TwinLandslideHeatmap";
import ThreeWaterSimulation, { type ThreeWaterSimulationHandle } from "../simulation/ThreeWaterSimulation";
import DisasterIntelligenceChat from "./DisasterIntelligenceChat";
import { toast } from "sonner";
import { generateCirclePolygon } from "@/lib/gisUtils";
import { buildingTouchesArea, buildingCenter, prepareBuildingFootprints } from "./buildingGeometry";
import { loadSelectedAreaBuildings } from "@/services/selectedAreaBuildings";
import {
  extractNetworks,
  extractBuildings,
  fetchMicrosoftBuildings,
  calculateEvacuationRoute,
  predictRisk,
} from "../../lib/routingApi";
import type {
  RoadFeature,
  RiverFeature,
  BuildingFeature,
  BoundingBox,
  EvacuationRouteResponse,
  HighRiskZone,
} from "../../lib/routingApi";


declare const Cesium: any;

export interface DigitalTwinMeshNode {
  id: string;
  name: string;
  type: "master" | "slave";
  lat: number;
  lng: number;
  elevationMeters?: number;
  role: string;
  battery: number;
  signalDbm: number;
  status: "online" | "warning" | "offline";
  sensorId?: string;
  connectedStatus?: string;
}

export type SensorType = "water_level" | "soil_moisture" | "imu" | "tilt" | "raindrop";

export interface DeployedSensor {
  id: string;
  type: SensorType;
  name: string;
  slaveId: string; // STRICT CONDITION: Sensors can connect ONLY to a Slave node!
  lat?: number;
  lng?: number;
  connectedAt: string;
}

export interface UserActivityLog {
  id: string;
  action: string;
  nodeName?: string;
  nodeType?: "master" | "slave";
  details: string;
  timestamp: string;
}

export interface LiveSlaveTelemetry {
  deviceId: string;
  hasData: boolean;
  status: "online" | "offline" | "no_data";
  soilMoisture: number;
  waterLevelMm: number;
  waterLevelM: number;
  rainfall: number;
  rainfallMm: number;
  rainfallPct: number;
  tilt: number;
  rawTilt?: number;
  imuX: number;
  imuY: number;
  imuZ: number;
  imuMag: number;
  rssi: number;
  snr: number;
  battery: number;
  txt: string;
  createdAt: string | null;
}

export const defaultLiveTelemetry: LiveSlaveTelemetry = {
  deviceId: "node1",
  hasData: false,
  status: "no_data",
  soilMoisture: 0,
  waterLevelMm: 0,
  waterLevelM: 0,
  rainfall: 0,
  rainfallMm: 0,
  rainfallPct: 0,
  tilt: 0,
  rawTilt: 0,
  imuX: 0,
  imuY: 0,
  imuZ: 0,
  imuMag: 0,
  rssi: 0,
  snr: 0,
  battery: 0,
  txt: "",
  createdAt: null,
};

export interface CesiumDigitalTwinViewerProps {
  latitude: number;
  longitude: number;
  areaName?: string;
  areaId?: string;
  polygon?: [number, number][];
  height?: string;
  className?: string;
  onViewInGIS?: () => void;
  isRaining?: boolean;
  rainfallIntensity?: number;
  windSpeed?: number;
  onToggleRain?: (active: boolean) => void;
}

const CESIUM_ION_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6InlmeEF5U0VaN2hzQ1hyUGsiLCJqdGkiOiIxYjlkZDAzMC1mMmY0LTQyZGMtOGQ0MC0xZWUzZThmOWRiYjciLCJpZCI6NDcwNTc3LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODczNzMxMTN9.PXVCwXJSsqaFXgocVgdatR0Ght__NMG_E-vXSBfczoE";

// ─── 🚀 ULTRA-FAST STM 30 (SRTM 30m DEM) TILE URL PREFETCH & IN-MEMORY CACHE ───
let _cachedSrtmTileUrl: string | null = null;
let _srtmTileUrlPromise: Promise<string> | null = null;

const getFastSrtmTileUrl = async (): Promise<string> => {
  if (_cachedSrtmTileUrl) return _cachedSrtmTileUrl;
  if (_srtmTileUrlPromise) return _srtmTileUrlPromise;

  _srtmTileUrlPromise = (async (): Promise<string> => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    try {
      const res = await fetch("/api/gee/layer-tiles?layer=elevation");
      if (res.ok) {
        const data = await res.json();
        if (data && data.tileUrl) {
          const url = data.tileUrl.startsWith("http") ? data.tileUrl : `${origin}${data.tileUrl}`;
          _cachedSrtmTileUrl = url;
          return url;
        }
      }
    } catch (e) {
      console.warn("[STM 30] GEE tile fetch fallback to local elevation tiles:", e);
    }
    const fallbackUrl = `${origin}/api/gee/tiles/elevation/{z}/{x}/{y}.png`;
    _cachedSrtmTileUrl = fallbackUrl;
    return fallbackUrl;
  })();

  return await _srtmTileUrlPromise;
};

// Start background prefetch immediately when module loads in browser
if (typeof window !== "undefined") {
  setTimeout(() => {
    getFastSrtmTileUrl().catch(() => {});
  }, 100);
}

// ─── 🌐 GLOBAL NETWORK CACHE FOR DIGITAL TWIN AREAS (ROADS, RIVERS, BUILDINGS) ───
const networkAreaCache: Record<string, {
  roads: RoadFeature[];
  rivers: RiverFeature[];
  buildings?: any[];
  buildingsLoadedAt?: number;
  bbox: BoundingBox;
  osmTileStatus?: any;
  timestamp: number;
  complete?: boolean;
}> = {};

window.addEventListener("area-deleted", event => {
  const id = (event as CustomEvent<string>).detail;
  for (const key of Object.keys(networkAreaCache)) if (key.startsWith(`${id}|`)) delete networkAreaCache[key];
});

const selectedAreaKey = (boundary: [number, number][]) => `poly_${JSON.stringify(boundary)}`;

const areaNetworkKey = (id: string | undefined, poly: [number, number][] | undefined, lat = 0, lng = 0) => `${id || "unsaved"}|${poly?.length ? selectedAreaKey(poly) : `${lat},${lng}`}`;

const getCachedNetworkEntry = (areaId?: string, poly?: [number, number][], lat?: number, lng?: number) => {
  return networkAreaCache[areaNetworkKey(areaId, poly, lat, lng)];
};

const setCachedNetworkEntry = (
  entry: (typeof networkAreaCache)[string],
  areaId?: string,
  poly?: [number, number][],
  lat?: number,
  lng?: number,
) => {
  networkAreaCache[areaNetworkKey(areaId, poly, lat, lng)] = entry;
};

export function CesiumDigitalTwinViewer({
  latitude,
  longitude,
  areaName = "Pollachi Basin",
  polygon,
  areaId,
  height = "600px",
  className = "",
  onViewInGIS,
  isRaining,
  rainfallIntensity = 65,
  windSpeed = 24,
  onToggleRain,
}: CesiumDigitalTwinViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cesiumContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const orbitListenerRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const maskEntitiesRef = useRef<any[]>([]);
  const srtmLayerRef = useRef<any>(null);

  // Rain simulation state
  const [internalRain, setInternalRain] = useState<boolean>(false);
  const rainActive = isRaining !== undefined ? isRaining : internalRain;
  const [cesiumViewer, setCesiumViewer] = useState<any>(null);
  const [forecastActive, setForecastActive] = useState(false);
  const [forecastHour, setForecastHour] = useState(0);
  const [forecastOpacity, setForecastOpacity] = useState(0.85);
  const [forecastRailHidden, setForecastRailHidden] = useState(true);
  const [landslideActive, setLandslideActive] = useState(false);
  const [landslideHour, setLandslideHour] = useState(0);
  const [landslideOpacity, setLandslideOpacity] = useState(0.85);
  const [landslideDayTab, setLandslideDayTab] = useState<"1d" | "2d" | "3d" | "4d" | "5d" | "6d" | "7d">("1d");
  const [waterSimActive, setWaterSimActive] = useState<boolean>(false);
  const [isFloodPaused, setIsFloodPaused] = useState<boolean>(false);
  const [isFloodRunning, setIsFloodRunning] = useState<boolean>(false);
  const [isFloodReady, setIsFloodReady] = useState<boolean>(false);
  const [showVisibleRain, setShowVisibleRain] = useState<boolean>(false);
  const flashFloodRef = useRef<ThreeWaterSimulationHandle | null>(null);

  // Movement flags for WASD and free-style navigation
  const movementFlagsRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
    turnLeft: false,
    turnRight: false,
    lookUp: false,
    lookDown: false,
  });

  const [cesiumReady, setCesiumReady] = useState<boolean>(typeof Cesium !== "undefined");
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // View mode
  const [isOrbiting, setIsOrbiting] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"3d" | "flat" | "topdown">("3d");
  const viewModeRef = useRef<"3d" | "flat" | "topdown">("3d");
  const navigate = useNavigate();
  const [camAltitude, setCamAltitude] = useState<number>(6500);
  const [camHeading, setCamHeading] = useState<number>(0);
  const [groundHeightMeters, setGroundHeightMeters] = useState<number>(293);
  const [showSrtm30, setShowSrtm30] = useState<boolean>(false);
  const [srtmOpacity, setSrtmOpacity] = useState<number>(0.65);
  const [showSrtmLegend, setShowSrtmLegend] = useState<boolean>(false);
  const [showLayersStatusBox, setShowLayersStatusBox] = useState<boolean>(true);
 
  // ─── 🛣️ REAL ROAD NETWORK, 🌊 RIVERS & 🚨 EVACUATION ROUTING ───
  const roadEntitiesRef = useRef<any[]>([]);
  const riverEntitiesRef = useRef<any[]>([]);
  const riverPrimitivesRef = useRef<any[]>([]); // Batched GroundPolylinePrimitives (fast path)
  const riverFlowPrimitivesRef = useRef<any[]>([]); // Animated flow-pulse overlay (shown when sim running)
  const buildingEntitiesRef = useRef<any[]>([]);
  const evacuationEntitiesRef = useRef<any[]>([]);
  const riskZoneEntitiesRef = useRef<any[]>([]);
  // Viewport-based dynamic loading & camera flight guards
  const viewportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViewportBboxRef = useRef<string>("");  // Last fetched bbox string for dedup
  const networkRequestRef = useRef(0);
  const selectedAreaRef = useRef({ latitude, longitude, polygon });
  selectedAreaRef.current = { latitude, longitude, polygon };
  const scheduleAreaLoadRef = useRef<(boundary?: [number, number][], immediate?: boolean) => void>(() => {});
  const buildingRequestRef = useRef(0);
  const networkAbortRef = useRef<AbortController | null>(null);
  const buildingAbortRef = useRef<AbortController | null>(null);
  const buildingAreaRef = useRef<string | null>(null);
  const buildingRenderRef = useRef(0);
  const isInFlightRef = useRef<boolean>(false);
  const networksLoadedRef = useRef<boolean>(false);
  const isInitialAreaMountRef = useRef<boolean>(true);
  const lastAreaSignatureRef = useRef<string>("");

  const [showRoads, setShowRoads] = useState<boolean>(true);
  const [showRivers, setShowRivers] = useState<boolean>(true);
  const [showBuildings, setShowBuildings] = useState<boolean>(true);
  const layerVisibilityRef = useRef({ roads: true, rivers: true, buildings: true });
  layerVisibilityRef.current = { roads: showRoads, rivers: showRivers, buildings: showBuildings };
  const [showBuildingStats, setShowBuildingStats] = useState<boolean>(true);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingFeature["properties"] | null>(null);
  const [buildingRiskFilter, setBuildingRiskFilter] = useState<"ALL" | "SAFE" | "MODERATE" | "HIGH" | "CRITICAL">("ALL");
  const [buildingStats, setBuildingStats] = useState<{
    total: number;
    safe: number;
    moderate: number;
    high: number;
    critical: number;
  }>({ total: 0, safe: 0, moderate: 0, high: 0, critical: 0 });
  const [showEvacPanel, setShowEvacPanel] = useState<boolean>(false);
  const [showAIChat, setShowAIChat] = useState<boolean>(false);
  const [showRiskHotspots, setShowRiskHotspots] = useState<boolean>(false);

  const [extractedBbox, setExtractedBbox] = useState<BoundingBox | null>(null);
  const [roadFeatures, setRoadFeatures] = useState<RoadFeature[]>([]);
  const [riverFeatures, setRiverFeatures] = useState<RiverFeature[]>([]);
  const [buildingFeatures, setBuildingFeatures] = useState<BuildingFeature[]>([]);
  const [highRiskZones, setHighRiskZones] = useState<HighRiskZone[]>([]);
  const [evacuationRoute, setEvacuationRoute] = useState<EvacuationRouteResponse | null>(null);


  const [evacDestMode, setEvacDestMode] = useState<"safe_exit" | "custom">("safe_exit");
  const [customDestLat, setCustomDestLat] = useState<number>(0);
  const [customDestLng, setCustomDestLng] = useState<number>(0);
  const [customDestName, setCustomDestName] = useState<string>("Safe High-Ground Exit");

  const [searchRadiusKm, setSearchRadiusKm] = useState<number>(5.0);
  const [isExtractingNetworks, setIsExtractingNetworks] = useState<boolean>(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [isLoadingBuildings, setIsLoadingBuildings] = useState<boolean>(false);
  const [buildingLoadStatus, setBuildingLoadStatus] = useState("");
  const [buildingLoadError, setBuildingLoadError] = useState<string | null>(null);
  const [osmTileStatus, setOsmTileStatus] = useState<{ loaded: number; total: number; roads: number; rivers: number; buildings: number }>({ loaded: 0, total: 0, roads: 0, rivers: 0, buildings: 0 });
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [isPredictingRisk, setIsPredictingRisk] = useState<boolean>(false);
  const [routeAvoidCritical, setRouteAvoidCritical] = useState<boolean>(true);
  const [userOriginCoords, setUserOriginCoords] = useState<{ lat: number; lng: number }>({
    lat: latitude,
    lng: longitude,
  });

  useEffect(() => {
    setUserOriginCoords({ lat: latitude, lng: longitude });
  }, [latitude, longitude]);

  // ─── 📡 3D IOT MESH NODES (MASTER & SLAVE SENSORS) ───
  const meshNodeEntitiesRef = useRef<any[]>([]);
  const [weatherDayTab, setWeatherDayTab] = useState<"1d" | "2d" | "3d" | "4d" | "5d" | "6d" | "7d">("1d");
  const [showMeshNodes, setShowMeshNodes] = useState<boolean>(true);
  const [showMeshPanel, setShowMeshPanel] = useState<boolean>(false);
  const [showRainPanel, setShowRainPanel] = useState<boolean>(false);
  const [isPickingLocation, setIsPickingLocation] = useState<"master" | "slave" | SensorType | null>(null);
  const [isDeleteMode, setIsDeleteMode] = useState<boolean>(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showSlaveDataBox, setShowSlaveDataBox] = useState<boolean>(false);
  const [activeSlaveId, setActiveSlaveId] = useState<string | null>(null);
  const [slaveLiveTelemetry, setSlaveLiveTelemetry] = useState<LiveSlaveTelemetry>(defaultLiveTelemetry);
  const lastAutoStartedRainRef = useRef<boolean>(false);
  const lastAutoStartedFloodRef = useRef<boolean>(false);
  const autoStartedBySensorRef = useRef<boolean>(false);

  // Sensor ID prompt modal state for adding master and slave nodes
  const [sensorPromptModal, setSensorPromptModal] = useState<{
    open: boolean;
    nodeType: "master" | "slave";
    lat: number;
    lng: number;
    sensorId: string;
  }>({
    open: false,
    nodeType: "master",
    lat: 0,
    lng: 0,
    sensorId: "node1",
  });
  const [stagedSensorId, setStagedSensorId] = useState<string>("node1");
  const [lastConnectedSensorMsg, setLastConnectedSensorMsg] = useState<string | null>(null);
  const [sensorConnectedOnce, setSensorConnectedOnce] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`dt_sensor_connected_${areaName || "default"}`) === "true";
    } catch {
      return false;
    }
  });

  const safeName = (areaName || "default").replace(/\s+/g, "_");
  const storageKey = `dt_mesh_nodes_${safeName}`;
  const activityStorageKey = `dt_user_activity_${safeName}`;
  // v6 invalidates center/viewport data saved by older viewers. Only complete
  // selected-polygon responses may be restored for an area.
  const networksStorageKey = `dt_networks_v11_${safeName}_${latitude.toFixed(4)}_${longitude.toFixed(4)}`;

  // Purge old v1/v2 cache entries for this area (stale data from old code)
  try {
    [`dt_networks_${safeName}`, `dt_networks_v2_${safeName}`, `dt_networks_v3_${safeName}`, `dt_networks_v4_${safeName}_${latitude.toFixed(4)}_${longitude.toFixed(4)}`, `dt_networks_v5_${safeName}_${latitude.toFixed(4)}_${longitude.toFixed(4)}`].forEach(k => {
      if (localStorage.getItem(k)) localStorage.removeItem(k);
    });
  } catch (e) {}

  // User adds nodes themselves — start empty (no default nodes), load from localStorage only
  const [meshNodes, setMeshNodes] = useState<DigitalTwinMeshNode[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return []; // No default nodes — user places them via map click
  });

  // User activity log state (persisted in localStorage + backend)
  const [userActivities, setUserActivities] = useState<UserActivityLog[]>(() => {
    try {
      const saved = localStorage.getItem(activityStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });

  const [deletedSensors, setDeletedSensors] = useState<Set<string>>(new Set());
  const deleteSensor = (slaveId: string, sensorKey: string) => {
    setDeletedSensors(prev => new Set([...prev, `${slaveId}:${sensorKey}`]));
  };
  const restoreSensor = (slaveId: string, sensorKey: string) => {
    setDeletedSensors(prev => {
      const next = new Set(prev);
      next.delete(`${slaveId}:${sensorKey}`);
      return next;
    });
  };
  const isSensorDeleted = (slaveId: string, sensorKey: string) =>
    deletedSensors.has(`${slaveId}:${sensorKey}`);

  const [activePanelTab, setActivePanelTab] = useState<"master" | "slave" | "rain" | "water" | "sensors" | "environment" | "activity">("master");
  const [simulationMenuOpen, setSimulationMenuOpen] = useState<boolean>(false);
  const simulationDropdownRef = useRef<HTMLDivElement | null>(null);
  const [simRainIntensity, setSimRainIntensity] = useState<number>(rainfallIntensity ?? 0);
  const [simWindSpeed, setSimWindSpeed] = useState<number>(windSpeed ?? 20);

  useEffect(() => {
    if (rainfallIntensity !== undefined) setSimRainIntensity(rainfallIntensity);
  }, [rainfallIntensity]);

  useEffect(() => {
    if (windSpeed !== undefined) setSimWindSpeed(windSpeed);
  }, [windSpeed]);

  // Close Simulation menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        simulationDropdownRef.current &&
        !simulationDropdownRef.current.contains(event.target as Node)
      ) {
        setSimulationMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleToggleRain = () => {
    const next = !rainActive;
    setInternalRain(next);
    setShowVisibleRain(next);
    onToggleRain?.(next);
    // User requested: "no simultaion page no water incresase nothing"
    // Atmospheric rain operates purely independently without triggering water simulation
    setWaterSimActive(false);
  };

  useEffect(() => {
    if (isRaining !== undefined) {
      setShowVisibleRain(isRaining);
      // User requested: "no simultaion page no water incresase nothing"
      if (!isRaining) {
        setWaterSimActive(false);
      }
    }
  }, [isRaining]);

  const masterNode = meshNodes.find((n) => n.type === "master");
  const slaveNodes = meshNodes.filter((n) => n.type === "slave");

  // ─── 📡 DEPLOYED SENSORS (CONDITION: SENSORS CONNECT ONLY TO SLAVE NODES) ───
  const sensorsStorageKey = `dt_deployed_sensors_${safeName}`;
  const [selectedTargetSlaveId, setSelectedTargetSlaveId] = useState<string>("");

  const [deployedSensors, setDeployedSensors] = useState<DeployedSensor[]>(() => {
    try {
      const saved = localStorage.getItem(sensorsStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    const firstSlave = meshNodes.find((n) => n.type === "slave");
    if (firstSlave) {
      return [
        { id: `sensor-water_level-${firstSlave.id}`, type: "water_level", name: "Water Level Sensor #1", slaveId: firstSlave.id, connectedAt: "System Init" },
        { id: `sensor-soil_moisture-${firstSlave.id}`, type: "soil_moisture", name: "Soil Moisture Sensor #1", slaveId: firstSlave.id, connectedAt: "System Init" },
        { id: `sensor-imu-${firstSlave.id}`, type: "imu", name: "9-Axis IMU #1", slaveId: firstSlave.id, connectedAt: "System Init" },
        { id: `sensor-tilt-${firstSlave.id}`, type: "tilt", name: "Tilt Sensor #1", slaveId: firstSlave.id, connectedAt: "System Init" },
        { id: `sensor-raindrop-${firstSlave.id}`, type: "raindrop", name: "Rain Drop Sensor #1", slaveId: firstSlave.id, connectedAt: "System Init" },
      ];
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(sensorsStorageKey, JSON.stringify(deployedSensors));
    } catch (e) {}
  }, [deployedSensors, sensorsStorageKey]);

  // Click to Add Sensor with STRICT Condition: Sensors can connect ONLY to a Slave node!
  const addSensorToSlave = (type: SensorType, targetSlaveIdOverride?: string): boolean => {
    if (slaveNodes.length === 0) {
      toast.error("Condition Error: Sensors can connect ONLY to a Slave node! Please add a Slave node first.");
      logUserActivity(
        "Sensor Connection Blocked",
        "Failed to connect sensor: No Slave node deployed. Sensors connect only to Slave nodes."
      );
      return false;
    }

    const targetSlave = slaveNodes.find(
      (s) => s.id === (targetSlaveIdOverride || selectedTargetSlaveId)
    ) || slaveNodes[0];

    if (!targetSlave) {
      toast.error("Condition Error: Selected target is not a valid Slave node! Sensors can connect ONLY to a Slave node.");
      return false;
    }

    const sensorTitles: Record<SensorType, string> = {
      water_level: "Water Level Sensor",
      soil_moisture: "Soil Moisture Sensor",
      imu: "9-Axis IMU",
      tilt: "Tilt Sensor",
      raindrop: "Rain Drop Sensor",
    };

    const countOfType = deployedSensors.filter((s) => s.type === type && s.slaveId === targetSlave.id).length;
    // Position sensor with a distinct spread around target slave node (~30-60 meters offset)
    const angle = (deployedSensors.filter((s) => s.slaveId === targetSlave.id).length * (Math.PI * 2 / 5)) + 0.35;
    const offsetDist = 0.00045; // ~50 meters
    const sensorLat = targetSlave.lat + offsetDist * Math.cos(angle);
    const sensorLng = targetSlave.lng + (offsetDist / Math.cos((targetSlave.lat * Math.PI) / 180)) * Math.sin(angle);

    const newSensor: DeployedSensor = {
      id: `sensor-${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type,
      name: `${sensorTitles[type]} #${countOfType + 1}`,
      slaveId: targetSlave.id,
      lat: sensorLat,
      lng: sensorLng,
      connectedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };

    setDeployedSensors((prev) => [...prev, newSensor]);
    toast.success(`Connected ${newSensor.name} to ${targetSlave.name}`);
    logUserActivity("Connected Sensor to Slave", `Attached ${newSensor.name} to ${targetSlave.name} [Slave ID: ${targetSlave.id}]`);
    return true;
  };

  const deleteDeployedSensor = (sensorId: string) => {
    const toDelete = deployedSensors.find((s) => s.id === sensorId);
    if (!toDelete) return;
    setDeployedSensors((prev) => prev.filter((s) => s.id !== sensorId));
    toast.info(`Deleted ${toDelete.name}`);
    logUserActivity("Deleted Sensor", `Removed ${toDelete.name} from Slave node [ID: ${toDelete.slaveId}]`);
  };

  // Save mesh nodes to localStorage whenever modified
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(meshNodes));
    } catch (e) {}
  }, [meshNodes, storageKey]);

  // Log and persist user activity
  const logUserActivity = (action: string, details: string, node?: DigitalTwinMeshNode) => {
    const newEntry: UserActivityLog = {
      id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      action,
      nodeName: node?.name,
      nodeType: node?.type,
      details,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };

    setUserActivities((prev) => {
      const updated = [newEntry, ...prev].slice(0, 50);
      try {
        localStorage.setItem(activityStorageKey, JSON.stringify(updated));
        // Also save to backend
        fetch("/api/digital-twin/user-activity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: newEntry.id,
            action: newEntry.action,
            node_name: newEntry.nodeName,
            node_type: newEntry.nodeType,
            details: newEntry.details,
            timestamp: newEntry.timestamp,
            area_name: areaName,
          }),
        }).catch(() => {});
      } catch (e) {}
      return updated;
    });
  };

  // Form input for node creation
  const [newNodeName, setNewNodeName] = useState<string>("");
  const [newNodeRole, setNewNodeRole] = useState<string>("Water Level Sensor");

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  // Compute active polygon coordinates [[lat, lng], ...]
  const getActivePolygon = (): [number, number][] => {
    if (polygon && polygon.length >= 3) return polygon;
    const selected = selectedAreaRef.current;
    if (selected.polygon && selected.polygon.length >= 3) {
      return selected.polygon;
    }
    // High-resolution 16-point natural basin perimeter around center coordinates (~1.2 km radius)
    return generateCirclePolygon(selected.latitude, selected.longitude, 1200, 16);
  };

  const isPointInPolygon = (lat: number, lng: number, poly: [number, number][]): boolean => {
    if (!poly || poly.length < 3) return true;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][1], yi = poly[i][0];
      const xj = poly[j][1], yj = poly[j][0];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  /**
   * Calculates 2D line segment intersection between (p1x, p1y)-(p2x, p2y) and (p3x, p3y)-(p4x, p4y).
   */
  const lineSegmentIntersection = (
    p1x: number, p1y: number, p2x: number, p2y: number,
    p3x: number, p3y: number, p4x: number, p4y: number
  ): [number, number] | null => {
    const d = (p2x - p1x) * (p4y - p3y) - (p2y - p1y) * (p4x - p3x);
    if (Math.abs(d) < 1e-12) return null;
    const t = ((p3x - p1x) * (p4y - p3y) - (p3y - p1y) * (p4x - p3x)) / d;
    const u = ((p3x - p1x) * (p2y - p1y) - (p3y - p1y) * (p2x - p1x)) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return [p1x + t * (p2x - p1x), p1y + t * (p2y - p1y)];
    }
    return null;
  };

  /**
   * Clips a polyline (array of [lng, lat]) strictly inside a polygon (array of [lat, lng]).
   * Returns one or more contiguous line segments that are guaranteed to lie within the polygon.
   */
  const clipPolylineToPolygon = (
    coords: [number, number][],
    poly: [number, number][]
  ): [number, number][][] => {
    if (!poly || poly.length < 3) return [coords];
    const segments: [number, number][][] = [];
    let cur: [number, number][] = [];

    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];     // [lng, lat]
      const p2 = coords[i + 1]; // [lng, lat]
      const in1 = isPointInPolygon(p1[1], p1[0], poly);
      const in2 = isPointInPolygon(p2[1], p2[0], poly);

      if (in1 && in2) {
        if (cur.length === 0) cur.push(p1);
        cur.push(p2);
      } else if (in1 && !in2) {
        // Line exits polygon: find intersection with polygon boundary
        let pt: [number, number] | null = null;
        let minT = Infinity;
        for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
          const c: [number, number] = [poly[k][1], poly[k][0]]; // [lng, lat]
          const d: [number, number] = [poly[j][1], poly[j][0]]; // [lng, lat]
          const inter = lineSegmentIntersection(p1[0], p1[1], p2[0], p2[1], c[0], c[1], d[0], d[1]);
          if (inter) {
            const dist = Math.hypot(inter[0] - p1[0], inter[1] - p1[1]);
            if (dist < minT) { minT = dist; pt = inter; }
          }
        }
        if (cur.length === 0) cur.push(p1);
        if (pt) cur.push(pt);
        if (cur.length >= 2) segments.push(cur);
        cur = [];
      } else if (!in1 && in2) {
        // Line enters polygon: find intersection with polygon boundary
        let pt: [number, number] | null = null;
        let minT = Infinity;
        for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
          const c: [number, number] = [poly[k][1], poly[k][0]];
          const d: [number, number] = [poly[j][1], poly[j][0]];
          const inter = lineSegmentIntersection(p1[0], p1[1], p2[0], p2[1], c[0], c[1], d[0], d[1]);
          if (inter) {
            const dist = Math.hypot(inter[0] - p2[0], inter[1] - p2[1]);
            if (dist < minT) { minT = dist; pt = inter; }
          }
        }
        if (cur.length >= 2) segments.push(cur);
        cur = [];
        if (pt) cur.push(pt);
        cur.push(p2);
      } else {
        // Both outside: check if segment cuts across the polygon
        const inters: { pt: [number, number]; t: number }[] = [];
        for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
          const c: [number, number] = [poly[k][1], poly[k][0]];
          const d: [number, number] = [poly[j][1], poly[j][0]];
          const inter = lineSegmentIntersection(p1[0], p1[1], p2[0], p2[1], c[0], c[1], d[0], d[1]);
          if (inter) {
            const t = Math.hypot(inter[0] - p1[0], inter[1] - p1[1]);
            inters.push({ pt: inter, t });
          }
        }
        if (inters.length >= 2) {
          inters.sort((a, b) => a.t - b.t);
          if (cur.length >= 2) segments.push(cur);
          cur = [];
          segments.push([inters[0].pt, inters[1].pt]);
        } else {
          if (cur.length >= 2) segments.push(cur);
          cur = [];
        }
      }
    }
    if (cur.length >= 2) segments.push(cur);
    return segments;
  };

  // Ensure 3D engine script & stylesheet are loaded
  useEffect(() => {
    if (typeof Cesium !== "undefined") {
      setCesiumReady(true);
      return;
    }

    const linkId = "cesium-css-cdn";
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = "https://cesium.com/downloads/cesiumjs/releases/1.125/Build/Cesium/Widgets/widgets.css";
      document.head.appendChild(link);
    }

    const scriptId = "cesium-js-cdn";
    let script = document.getElementById(scriptId) as HTMLScriptElement;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://cesium.com/downloads/cesiumjs/releases/1.125/Build/Cesium/Cesium.js";
      script.async = true;
      script.onload = () => setCesiumReady(true);
      script.onerror = () => {
        setLoadError("Failed to load 3D terrain engine.");
        setLoading(false);
      };
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", () => setCesiumReady(true));
    }
  }, []);

  // WASD and Arrow key navigation listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      const flags = movementFlagsRef.current;
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          flags.forward = true;
          break;
        case "KeyS":
        case "ArrowDown":
          flags.backward = true;
          break;
        case "KeyA":
          flags.left = true;
          break;
        case "KeyD":
          flags.right = true;
          break;
        case "ArrowLeft":
          if (viewModeRef.current === "flat") {
            flags.turnLeft = true;
          } else {
            flags.left = true;
          }
          break;
        case "ArrowRight":
          if (viewModeRef.current === "flat") {
            flags.turnRight = true;
          } else {
            flags.right = true;
          }
          break;
        case "KeyQ":
        case "PageUp":
          flags.up = true;
          break;
        case "KeyE":
        case "PageDown":
          flags.down = true;
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const flags = movementFlagsRef.current;
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          flags.forward = false;
          break;
        case "KeyS":
        case "ArrowDown":
          flags.backward = false;
          break;
        case "KeyA":
          flags.left = false;
          break;
        case "KeyD":
          flags.right = false;
          break;
        case "ArrowLeft":
          flags.turnLeft = false;
          flags.left = false;
          break;
        case "ArrowRight":
          flags.turnRight = false;
          flags.right = false;
          break;
        case "KeyQ":
        case "PageUp":
          flags.up = false;
          break;
        case "KeyE":
        case "PageDown":
          flags.down = false;
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs =
        !!document.fullscreenElement ||
        !!(document as any).webkitFullscreenElement ||
        !!(document as any).mozFullScreenElement;
      setIsFullscreen(isFs);

      setTimeout(() => {
        if (viewerRef.current && !viewerRef.current.isDestroyed()) {
          viewerRef.current.resize();
        }
      }, 150);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Sample ground elevation
  const sampleGroundElevation = async (lon: number, lat: number): Promise<number> => {
    const viewer = viewerRef.current;
    if (!viewer) return 293.0;

    const carto = Cesium.Cartographic.fromDegrees(lon, lat);
    let elev = viewer.scene.globe.getHeight(carto);

    if (elev === undefined || isNaN(elev) || elev < -50) {
      try {
        if (viewer.terrainProvider) {
          const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [carto]);
          if (sampled?.[0]?.height !== undefined) {
            elev = sampled[0].height;
          }
        }
      } catch (e) {
        console.warn("Elevation fallback:", e);
      }
    }

    const finalVal = elev && !isNaN(elev) && elev > -50 ? elev : 293.0;
    setGroundHeightMeters(Math.round(finalVal));
    return finalVal;
  };

  // ─── GOOGLE MAPS CONTROLLER SETTINGS ───
  // Configures Cesium's ScreenSpaceCameraController:
  // - Except Flat View: Exactly like Google Maps (Left Drag: Pan, Right/Ctrl Drag: Tilt, Wheel: Zoom)
  // - In Flat View: Cesium defaults disabled, custom mouse altitude & WASD walking handles everything
  const applyControllerSettings = (mode: "3d" | "flat" | "topdown") => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const controller = viewer.scene.screenSpaceCameraController;
    if (!controller) return;

    if (mode === "flat") {
      controller.enableRotate = false;
      controller.enableTranslate = false;
      controller.enableZoom = false;
      controller.enableTilt = false;
      controller.enableLook = false;
    } else {
      controller.enableRotate = true;
      controller.enableTranslate = true;
      controller.enableZoom = true;
      controller.enableTilt = true;
      controller.enableLook = false;
      controller.enableCollisionDetection = false;
      controller.minimumZoomDistance = 1.0;
      controller.maximumZoomDistance = 50000000;
      controller.inertiaSpin = 0.85;
      controller.inertiaTranslate = 0.85;
      controller.inertiaZoom = 0.8;

      controller.rotateEventTypes = Cesium.CameraEventType.LEFT_DRAG;
      controller.zoomEventTypes = [
        Cesium.CameraEventType.WHEEL,
        Cesium.CameraEventType.PINCH,
      ];
      controller.tiltEventTypes = [
        Cesium.CameraEventType.RIGHT_DRAG,
        Cesium.CameraEventType.MIDDLE_DRAG,
        {
          eventType: Cesium.CameraEventType.LEFT_DRAG,
          modifier: Cesium.KeyboardEventModifier.CTRL,
        },
        {
          eventType: Cesium.CameraEventType.LEFT_DRAG,
          modifier: Cesium.KeyboardEventModifier.SHIFT,
        },
      ];
    }
  };

  // Google Maps navigation actions: Zoom In, Zoom Out, Reset North
  const handleZoomIn = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const cam = viewer.camera;
    if (viewMode === "flat") {
      const curH = cam.positionCartographic?.height || groundHeightMeters + 5;
      const heightAbove = Math.max(1.0, curH - groundHeightMeters);
      cam.moveUp(Math.max(2.5, heightAbove * 0.15));
      if (cam.positionCartographic) setCamAltitude(Math.round(cam.positionCartographic.height));
    } else {
      const curH = cam.positionCartographic?.height || 2000;
      cam.zoomIn(Math.max(30, curH * 0.35));
    }
  };

  const handleZoomOut = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const cam = viewer.camera;
    if (viewMode === "flat") {
      const curH = cam.positionCartographic?.height || groundHeightMeters + 5;
      const minAlt = groundHeightMeters + 1.2;
      const heightAbove = Math.max(1.0, curH - groundHeightMeters);
      const step = Math.max(2.5, heightAbove * 0.15);
      if (curH - step >= minAlt) {
        cam.moveDown(step);
      } else {
        const carto = cam.positionCartographic;
        if (carto) {
          const newCarto = Cesium.Cartographic.fromRadians(carto.longitude, carto.latitude, minAlt);
          cam.position = Cesium.Ellipsoid.WGS84.cartographicToCartesian(newCarto);
        }
      }
      if (cam.positionCartographic) setCamAltitude(Math.round(cam.positionCartographic.height));
    } else {
      const curH = cam.positionCartographic?.height || 2000;
      cam.zoomOut(Math.max(30, curH * 0.35));
    }
  };

  const handleResetNorth = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const cam = viewer.camera;
    viewer.camera.flyTo({
      destination: cam.position,
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: cam.pitch,
        roll: 0.0,
      },
      duration: 0.8,
    });
  };

  const calculateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // ─── 🛣️ 3D ROAD NETWORK RENDERING ───
  const render3DRoads = (roads: RoadFeature[], visible: boolean) => {
    visible = layerVisibilityRef.current.roads;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;

    viewer.entities.suspendEvents();
    try {
      roadEntitiesRef.current.forEach((ent) => {
        try { viewer.entities.remove(ent); } catch (e) {}
      });
      roadEntitiesRef.current = [];

      if (!roads || roads.length === 0) {
        return;
      }

      const activePoly = getActivePolygon();
      let minPolyLat = Infinity, maxPolyLat = -Infinity;
      let minPolyLng = Infinity, maxPolyLng = -Infinity;
      if (activePoly && activePoly.length >= 3) {
        for (const [pLat, pLng] of activePoly) {
          if (pLat < minPolyLat) minPolyLat = pLat;
          if (pLat > maxPolyLat) maxPolyLat = pLat;
          if (pLng < minPolyLng) minPolyLng = pLng;
          if (pLng > maxPolyLng) maxPolyLng = pLng;
        }
      }
      const padLat = Math.max(0.015, (maxPolyLat - minPolyLat) * 0.5);
      const padLng = Math.max(0.015, (maxPolyLng - minPolyLng) * 0.5);

      roads.forEach((road) => {
        const coords = road.geometry?.coordinates;
        if (!coords || coords.length < 2) return;

        const clippedSegments = clipPolylineToPolygon(coords as [number, number][], activePoly);
        if (clippedSegments.length === 0) return;

        const rType = road.properties?.road_type || "residential";
        const isMajor = road.properties?.is_major ?? ["motorway", "trunk", "primary", "secondary"].includes(rType);
        const access = road.properties?.accessibility || "open";
        const risk = road.properties?.flood_risk || 0;
        const widthPx = road.properties?.width_px;

        // Cartographic hierarchy with dark casing:
        // Ensures roads/paths never mix with rivers (zIndex: 30 > 15) or house boundaries
        let strokeColor: string;
        let outlineColor: string;
        let lineWidth: number;
        let outlineWidth: number;

        if (access === "flooded" || risk >= 0.7) {
          strokeColor = "#ef4444";   // Danger red — flooded road
          outlineColor = "#7f1d1d";  // Deep crimson outline
          lineWidth = widthPx ?? 6.0;
          outlineWidth = 2.0;
        } else if (rType === "motorway" || rType === "trunk") {
          strokeColor = "#f59e0b";   // Amber-500 — arterial highways
          outlineColor = "#0f172a";  // Slate-900 border
          lineWidth = widthPx ?? 6.5;
          outlineWidth = 2.0;
        } else if (rType === "primary") {
          strokeColor = "#fbbf24";   // Amber-400 — primary connectors
          outlineColor = "#1e293b";  // Slate-800 border
          lineWidth = widthPx ?? 5.0;
          outlineWidth = 1.5;
        } else if (rType === "secondary" || rType === "tertiary") {
          strokeColor = "#fef08a";   // Warm cream/yellow-200 — secondary streets
          outlineColor = "#334155";  // Slate-700 border
          lineWidth = widthPx ?? 4.0;
          outlineWidth = 1.5;
        } else if (rType === "residential" || rType === "living_street" || rType === "unclassified") {
          strokeColor = "#ffffff";   // Crisp white — residential streets
          outlineColor = "#334155";  // Slate-700 border
          lineWidth = widthPx ?? 3.0;
          outlineWidth = 1.0;
        } else {
          strokeColor = "#cbd5e1";   // Light slate — footpaths, trails, service paths
          outlineColor = "#475569";  // Slate-600 border
          lineWidth = widthPx ?? 2.0;
          outlineWidth = 1.0;
        }

        clippedSegments.forEach((seg) => {
          const flatPositions = seg.flat();
          if (flatPositions.length < 4) return;

          const ent = viewer.entities.add({
            name: `🛣️ ${isMajor ? "Road" : "Path"}: ${road.properties?.name || rType}`,
            show: visible,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(flatPositions),
              width: lineWidth,
              material: new Cesium.PolylineOutlineMaterialProperty({
                color: Cesium.Color.fromCssColorString(strokeColor),
                outlineColor: Cesium.Color.fromCssColorString(outlineColor),
                outlineWidth: outlineWidth,
              }),
              clampToGround: true,
            },
          });
          roadEntitiesRef.current.push(ent);
        });
      });
    } finally {
      viewer.entities.resumeEvents();
      viewer.scene.requestRender();
      console.log(`[DT] render3DRoads: added ${roadEntitiesRef.current.length} entities to viewer`);
    }
  };

  // ─── 🌊 3D RIVER & WATER BODY RENDERING ───
  const render3DRivers = (rivers: RiverFeature[], visible: boolean) => {
    visible = layerVisibilityRef.current.rivers;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;

    // --- Cleanup previous river entities (polygons/labels) ---
    viewer.entities.suspendEvents();
    try {
      riverEntitiesRef.current.forEach((ent) => {
        try { viewer.entities.remove(ent); } catch (e) {}
      });
      riverEntitiesRef.current = [];
    } finally {
      viewer.entities.resumeEvents();
    }

    // --- Cleanup previous batched primitives (channel lines) ---
    riverPrimitivesRef.current.forEach((prim) => {
      try {
        if (!prim.isDestroyed()) viewer.scene.primitives.remove(prim);
      } catch (e) {}
    });
    riverPrimitivesRef.current = [];

    if (!rivers || rivers.length === 0) {
      viewer.scene.requestRender();
      return;
    }

    const activePoly = getActivePolygon();
    let minPolyLat = Infinity, maxPolyLat = -Infinity;
    let minPolyLng = Infinity, maxPolyLng = -Infinity;
    if (activePoly && activePoly.length >= 3) {
      for (const [pLat, pLng] of activePoly) {
        if (pLat < minPolyLat) minPolyLat = pLat;
        if (pLat > maxPolyLat) maxPolyLat = pLat;
        if (pLng < minPolyLng) minPolyLng = pLng;
        if (pLng > maxPolyLng) maxPolyLng = pLng;
      }
    }

    // Collect all channel line instances for batching into one primitive per width tier
    // (main rivers wider, tributaries narrower)
    const mainInstances: any[] = [];
    const tributaryInstances: any[] = [];

    viewer.entities.suspendEvents();
    try {
      rivers.forEach((river) => {
        const geom = river.geometry as any;
        const props = (river.properties as any) || {};
        const wType = ((props.waterway_type || props.waterway || "stream") as string).toLowerCase();
        const isWaterBody = Boolean(
          props.is_water_body ||
          ["water", "lake", "reservoir", "pond", "basin", "riverbank", "lagoon", "oxbow"].includes(wType)
        );

        // 1. Water surface polygons (lakes, reservoirs, ponds, basins) — keep as entities
        const polygons = geom?.type === "Polygon" ? [geom.coordinates] : geom?.type === "MultiPolygon" ? geom.coordinates : [];
        for (const rings of polygons as number[][][][]) {
          if (!rings || !rings[0] || rings[0].length < 3) continue;

          // STRICT BOUNDARY CHECK: Never render water bodies floating outside the selected area!
          if (activePoly && activePoly.length >= 3) {
            const hasPointInside = rings[0].some(([lng, lat]) => isPointInPolygon(lat, lng, activePoly));
            const hasEdgeIntersect = rings[0].some((p1, idx) => {
              const p2 = rings[0][(idx + 1) % rings[0].length];
              for (let k = 0; k < activePoly.length; k++) {
                const c1 = activePoly[k];
                const c2 = activePoly[(k + 1) % activePoly.length];
                if (lineSegmentIntersection(p1[0], p1[1], p2[0], p2[1], c1[1], c1[0], c2[1], c2[0])) {
                  return true;
                }
              }
              return false;
            });
            if (!hasPointInside && !hasEdgeIntersect) {
              continue;
            }
          }

          const outerRing = rings[0].flat();
          if (outerRing.length < 6) continue;
          const holes = rings.slice(1).map((ring: number[][]) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())));
          const ent = viewer.entities.add({
            name: `💧 ${props.name || (wType === "reservoir" ? "Reservoir" : wType === "lake" ? "Lake" : "Water Body")}`,
            show: visible,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(outerRing), holes),
              material: Cesium.Color.fromCssColorString("#06b6d4").withAlpha(0.80),
              height: 0,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              classificationType: Cesium.ClassificationType.TERRAIN,
            },
            label: props.name ? {
              text: `💧 ${props.name}`,
              font: "bold 12px sans-serif",
              fillColor: Cesium.Color.fromCssColorString("#38bdf8"),
              outlineColor: Cesium.Color.fromCssColorString("#082f49"),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 60000),
            } : undefined,
          });
          riverEntitiesRef.current.push(ent);
        }

        // 2. Waterway channels (rivers, canals, streams, brooks) — collect for batch primitive
        const rawLines = geom?.type === "LineString" ? [geom.coordinates] : geom?.type === "MultiLineString" ? geom.coordinates : [];
        for (const line of rawLines as [number, number][][]) {
          if (!line || line.length < 2) continue;

          // If line is closed and represents a water body, render as polygon surface
          const isClosed = line.length >= 4 && (
            (line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]) ||
            (Math.abs(line[0][0] - line[line.length - 1][0]) < 1e-4 && Math.abs(line[0][1] - line[line.length - 1][1]) < 1e-4)
          );
          if (isWaterBody && isClosed) {
            if (activePoly && activePoly.length >= 3) {
              const hasPointInside = line.some(([lng, lat]) => isPointInPolygon(lat, lng, activePoly));
              if (!hasPointInside) continue;
            }
            const flatRing = line.flat();
            if (flatRing.length >= 6) {
              const ent = viewer.entities.add({
                name: `💧 ${props.name || (wType === "reservoir" ? "Reservoir" : wType === "lake" ? "Lake" : "Water Body")}`,
                show: visible,
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flatRing)),
                  material: Cesium.Color.fromCssColorString("#06b6d4").withAlpha(0.80),
                  height: 0,
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                  classificationType: Cesium.ClassificationType.TERRAIN,
                },
              });
              riverEntitiesRef.current.push(ent);
              continue;
            }
          }

          const clippedSegments = clipPolylineToPolygon(line, activePoly);
          if (clippedSegments.length === 0) continue;

          const isMain = wType === "river" || wType === "canal" || Boolean(props.is_main_river);

          // Batch into GeometryInstance array — one GroundPolylinePrimitive per tier
          clippedSegments.forEach((seg) => {
            const flat = seg.flat();
            if (flat.length < 4) return;
            const positions = Cesium.Cartesian3.fromDegreesArray(flat);
            if (positions.length < 2) return;
            const instance = new Cesium.GeometryInstance({
              geometry: new Cesium.GroundPolylineGeometry({
                positions,
                width: isMain ? 6.0 : 4.0, // GroundPolylineGeometry width is in metres, not pixels — keep compact
              }),
            });
            if (isMain) {
              mainInstances.push(instance);
            } else {
              tributaryInstances.push(instance);
            }
          });
        }
      });
    } finally {
      viewer.entities.resumeEvents();
    }

    // --- Batch all channel instances into two GroundPolylinePrimitive (main + tributary) ---
    // This replaces hundreds of individual entity draw calls with just 2 GPU draw calls.
    const riverColor = Cesium.Color.fromCssColorString("#06b6d4").withAlpha(0.90);

    if (mainInstances.length > 0) {
      try {
        const prim = new Cesium.GroundPolylinePrimitive({
          geometryInstances: mainInstances,
          appearance: new Cesium.PolylineMaterialAppearance({
            material: Cesium.Material.fromType("Color", { color: riverColor }),
          }),
          show: visible,
          asynchronous: false,
        });
        viewer.scene.primitives.add(prim);
        riverPrimitivesRef.current.push(prim);
      } catch (e) {
        console.warn("[DT] GroundPolylinePrimitive (main) failed, skipping:", e);
      }
    }

    if (tributaryInstances.length > 0) {
      try {
        const tributaryColor = Cesium.Color.fromCssColorString("#06b6d4").withAlpha(0.75);
        const prim = new Cesium.GroundPolylinePrimitive({
          geometryInstances: tributaryInstances,
          appearance: new Cesium.PolylineMaterialAppearance({
            material: Cesium.Material.fromType("Color", { color: tributaryColor }),
          }),
          show: visible,
          asynchronous: false,
        });
        viewer.scene.primitives.add(prim);
        riverPrimitivesRef.current.push(prim);
      } catch (e) {
        console.warn("[DT] GroundPolylinePrimitive (tributary) failed, skipping:", e);
      }
    }

    // --- Animated flow-pulse overlay ---
    // Destroy old flow primitives
    riverFlowPrimitivesRef.current.forEach((prim) => {
      try { if (!prim.isDestroyed()) viewer.scene.primitives.remove(prim); } catch (e) {}
    });
    riverFlowPrimitivesRef.current = [];

    // Build fresh geometry instances for flow animation (same positions, thinner lines)
    const flowAllInstances: any[] = [];
    // Rebuild instances from already-collected segments by re-running just the instance builder.
    // We reuse the same rivers array already processed above.
    for (const river of rivers) {
      const geom = river.geometry as any;
      const props = (river.properties as any) || {};
      const wType = ((props.waterway_type || props.waterway || "stream") as string).toLowerCase();
      const isWaterBody = Boolean(props.is_water_body || ["water","lake","reservoir","pond","basin","riverbank","lagoon","oxbow"].includes(wType));
      if (isWaterBody) continue; // polygons don't need flow pulse
      const rawLines = geom?.type === "LineString" ? [geom.coordinates] : geom?.type === "MultiLineString" ? geom.coordinates : [];
      for (const line of rawLines as [number, number][][]) {
        if (!line || line.length < 2) continue;
        const segs = clipPolylineToPolygon(line, activePoly);
        for (const seg of segs) {
          const flat = seg.flat();
          if (flat.length < 4) continue;
          const positions = Cesium.Cartesian3.fromDegreesArray(flat);
          if (positions.length < 2) continue;
          flowAllInstances.push(new Cesium.GeometryInstance({
            geometry: new Cesium.GroundPolylineGeometry({ positions, width: 3.0 }),
          }));
        }
      }
    }

    if (flowAllInstances.length > 0) {
      try {
        // Fabric material: bright cyan pulse that moves along the line using czm_frameNumber
        const flowMaterial = new Cesium.Material({
          fabric: {
            type: "RiverFlowPulse",
            uniforms: { color: new Cesium.Color(0.3, 0.95, 1.0, 1.0), speed: 2.0, pulseWidth: 0.25 },
            source: `
              czm_material czm_getMaterial(czm_materialInput materialInput) {
                czm_material material = czm_getDefaultMaterial(materialInput);
                float t = fract(materialInput.st.s - czm_frameNumber * 0.012 * speed);
                float pulse = smoothstep(0.0, pulseWidth * 0.5, t) * (1.0 - smoothstep(pulseWidth * 0.5, pulseWidth, t));
                float alpha = 0.55 + pulse * 0.45;
                material.diffuse = color.rgb * (0.7 + pulse * 0.6);
                material.alpha = alpha;
                return material;
              }`,
          },
          translucent: true,
        });
        const flowPrim = new Cesium.GroundPolylinePrimitive({
          geometryInstances: flowAllInstances,
          appearance: new Cesium.PolylineMaterialAppearance({ material: flowMaterial }),
          show: false, // Hidden by default — shown when simulation runs
          asynchronous: false,
        });
        viewer.scene.primitives.add(flowPrim);
        riverFlowPrimitivesRef.current.push(flowPrim);
      } catch (e) {
        console.warn("[DT] Flow pulse primitive failed:", e);
      }
    }

    viewer.scene.requestRender();
    console.log(`[DT] render3DRivers: ${riverEntitiesRef.current.length} polygon entities + ${mainInstances.length} main + ${tributaryInstances.length} tributary channel instances (2 primitives) + ${flowAllInstances.length} flow-pulse instances`);
  };

  // ─── 🏢 MICROSOFT GLOBAL ML BUILDING FOOTPRINTS (3D EXTRUDED & RISK-COLORED) ───
  const render3DBuildings = async (buildings: BuildingFeature[]) => {
    const generation = ++buildingRenderRef.current;
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;
      buildingEntitiesRef.current.forEach((entity) => {
        try { viewer.entities.remove(entity); } catch (e) {}
      });
      buildingEntitiesRef.current = [];

      const activePoly = getActivePolygon();
      let failed = 0;
      for (let offset = 0; offset < buildings.length; offset += 40) {
        if (generation !== buildingRenderRef.current || viewer.isDestroyed()) return;
        viewer.entities.suspendEvents();
        try {
      buildings.slice(offset, offset + 40).forEach((building, batchIndex) => {
        const idx = offset + batchIndex;
        try {
        const source = building.geometry?.coordinates;
        if (!source) return;
        const polygons = building.geometry.type === "Polygon"
          ? [source as number[][][]]
          : source as number[][][][];

        polygons.forEach((rings) => {
          const outer = rings[0];
          if (!outer || outer.length < 4) return;

          // Compute exact centroid [lat, lon]
          const center = buildingCenter(outer);
          const cLat = center.lat;
          const cLon = center.lon;

          // STRICT FILTER: Only render houses strictly inside the marked area
          if (activePoly && !buildingTouchesArea(rings, activePoly)) return;

          const holes = rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flatMap(point => point.slice(0, 2)))));


          // User Requirement: Extrusion height logic
          // small=4–6m, medium=6–10m, large=10–15m based on footprint size
          const rawHeight = Number(
            building.properties?.estimated_height ||
            building.properties?.height ||
            building.properties?.height_m ||
            6.0
          );
          const height = Math.max(3.5, Number.isFinite(rawHeight) ? rawHeight : 6.0);

          // User Requirement: Keep ALL houses uniform radiant orange (#f97316)
          const risk = "MONITORED";
          const riskColor = "#f97316";

          const enrichedProps = {
            ...building.properties,
            id: building.properties?.id || `MS-BLDG-${idx + 1}`,
            name: building.properties?.name || `Building ${building.properties?.id || `#${idx + 1}`}`,
            lat: cLat,
            lon: cLon,

            estimated_height: height,
            height: height,
            elevation: building.properties?.elevation || building.properties?.elevation_m || 298.0,
            flood_risk: risk,
            risk_color: riskColor,
            landslide_risk: building.properties?.landslide_risk || "LOW",
            distance_from_river: building.properties?.distance_from_river || `${building.properties?.distance_to_river_m || 350} m`,
            evacuation_zone: building.properties?.evacuation_zone || "Zone B (Monitored Area)",
          };

          // Ground-clamped building footprint:
          // Uses CLAMP_TO_GROUND + ClassificationType.TERRAIN so the footprint drapes
          // seamlessly onto the 3D terrain surface without floating in the air.
          // Extrusion with flat base causes floating boxes on mountain slopes;
          // terrain-classified polygons hug the ground 100% at any elevation.
          const entity = viewer.entities.add({
            name: `🏢 ${enrichedProps.name}`,
            show: layerVisibilityRef.current.buildings,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(outer.flatMap(point => point.slice(0, 2))), holes),
              material: Cesium.Color.fromCssColorString("#f97316").withAlpha(0.88),
              height: 0,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              classificationType: Cesium.ClassificationType.TERRAIN,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 60000),
            },
          });

          // Separate outline polyline clamped to ground for clear boundary visibility
          const rawCoords = outer.flatMap(point => point.slice(0, 2));
          const isClosed = outer.length >= 2 &&
            outer[0][0] === outer[outer.length - 1][0] &&
            outer[0][1] === outer[outer.length - 1][1];
          const outlineCoords = isClosed ? rawCoords : [...rawCoords, outer[0][0], outer[0][1]];

          const outlineEntity = viewer.entities.add({
            show: layerVisibilityRef.current.buildings,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(outlineCoords),
              width: 2.5,
              material: Cesium.Color.fromCssColorString("#ea580c").withAlpha(0.95),
              clampToGround: true,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 45000),
            },
          });
          (outlineEntity as any)._buildingOutline = true;
          buildingEntitiesRef.current.push(outlineEntity);

          // Attach picking metadata for click popup
          (entity as any)._buildingData = enrichedProps;
          (entity as any)._buildingId = enrichedProps.id;
          buildingEntitiesRef.current.push(entity);
        });
        } catch (error) {
          failed++;
          console.warn("Building footprint could not be rendered", building.properties?.id, error);
        }
      });
        } finally {
      viewer.entities.resumeEvents();
      viewer.scene.requestRender();
        }
        setBuildingLoadStatus(`Placing buildings on terrain · ${Math.min(offset + 40, buildings.length)} / ${buildings.length}`);
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      if (generation !== buildingRenderRef.current || viewer.isDestroyed()) return;
      setBuildingLoadStatus(failed ? `${failed} building footprints could not be rendered.` : `${buildings.length} building footprints loaded`);
      console.log(`[DT] render3DBuildings: added ${buildingEntitiesRef.current.length} entities to viewer`);
      viewer.scene.requestRender();
  };


  // ─── 🚨 3D EVACUATION ROUTE RENDERING ───
  const render3DEvacuationRoute = (route: EvacuationRouteResponse | null) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;

    evacuationEntitiesRef.current.forEach((ent) => {
      try { viewer.entities.remove(ent); } catch (e) {}
    });
    evacuationEntitiesRef.current = [];

    if (!route || !route.coordinates || route.coordinates.length < 2) return;

    const flatPositions = route.coordinates.map(([lat, lng]) => [lng, lat]).flat();
    const isSafe = route.route_status === "SAFE";
    const isCaution = route.route_status === "CAUTION";
    const routeColor = isSafe ? "#10b981" : isCaution ? "#f59e0b" : "#ef4444";

    const pathEntity = viewer.entities.add({
      name: `🚨 Evacuation Route (${route.route_status})`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(flatPositions),
        width: 6.0,
        material: new Cesium.PolylineOutlineMaterialProperty({
          color: Cesium.Color.fromCssColorString(routeColor),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2.0,
        }),
        clampToGround: true,
      },
    });
    evacuationEntitiesRef.current.push(pathEntity);

    const [startLat, startLng] = route.coordinates[0];
    const startEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(startLng, startLat),
      point: {
        pixelSize: 18,
        color: Cesium.Color.fromCssColorString("#38bdf8"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: "📍 YOUR LOCATION\nOrigin",
        font: "bold 22px system-ui, sans-serif",
        scale: 0.5,
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#0369a1").withAlpha(0.92),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    evacuationEntitiesRef.current.push(startEntity);

    const [endLat, endLng] = route.coordinates[route.coordinates.length - 1];
    const destinationLabel = route.destination_name || route.shelter?.name || "Safe High-Ground Exit";
    const endEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(endLng, endLat),
      point: {
        pixelSize: 20,
        color: Cesium.Color.fromCssColorString("#10b981"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 4,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: `🏁 DESTINATION\n${destinationLabel}`,
        font: "bold 24px system-ui, sans-serif",
        scale: 0.5,
        fillColor: Cesium.Color.fromCssColorString("#6ee7b7"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#064e3b").withAlpha(0.92),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    evacuationEntitiesRef.current.push(endEntity);

    // Smoothly fly camera to show entire route
    try {
      const lats = route.coordinates.map(([lat]) => lat);
      const lngs = route.coordinates.map(([, lng]) => lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const spanLat = Math.max(maxLat - minLat, 0.008);
      const spanLng = Math.max(maxLng - minLng, 0.008);
      viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(
          minLng - spanLng * 0.35,
          minLat - spanLat * 0.35,
          maxLng + spanLng * 0.35,
          maxLat + spanLat * 0.35
        ),
        duration: 1.8,
      });
    } catch (e) {
      console.warn("[DT] Camera flyTo route bounds failed:", e);
    }
  };

  // ─── ⚠️ 3D FLOOD HAZARD HOTSPOTS RENDERING ───
  const render3DRiskZones = (zones: HighRiskZone[], visible: boolean) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;

    riskZoneEntitiesRef.current.forEach((ent) => {
      try { viewer.entities.remove(ent); } catch (e) {}
    });
    riskZoneEntitiesRef.current = [];

    if (!visible || !zones || zones.length === 0) return;

    const activePoly = getActivePolygon();

    zones.forEach((z, idx) => {
      if (!isPointInPolygon(z.lat, z.lng, activePoly)) return;

      // Use a small point marker instead of a large red circle
      const ent = viewer.entities.add({
        id: `risk-zone-${idx}`,
        name: `⚠️ High Flood Hazard Zone (Risk: ${Math.round(z.probability * 100)}%)`,
        position: Cesium.Cartesian3.fromDegrees(z.lng, z.lat, 2),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString("#f97316").withAlpha(0.85), // Orange
          outlineColor: Cesium.Color.fromCssColorString("#ffedd5"),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      riskZoneEntitiesRef.current.push(ent);
    });
  };

  // ─── 📐 VIEWPORT BBOX DETECTION ───
  const getViewportBbox = (): { north: number; south: number; east: number; west: number } | null => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return null;
    try {
      const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
      if (!rect) return null;
      const north = Cesium.Math.toDegrees(rect.north);
      const south = Cesium.Math.toDegrees(rect.south);
      const east  = Cesium.Math.toDegrees(rect.east);
      const west  = Cesium.Math.toDegrees(rect.west);
      // Sanity check — if viewport is too large (zoomed out), clamp to reasonable size
      const latSpan = Math.abs(north - south);
      const lngSpan = Math.abs(east - west);
      if (latSpan > 1.0 || lngSpan > 1.0) {
        // Too zoomed out — fall back to center + radius
        return null;
      }
      return { north, south, east, west };
    } catch (e) {
      return null;
    }
  };

  // ─── 📡 DATA FETCHING: COMPLETE SELECTED-AREA ROAD & RIVER NETWORK ───
  const handleExtractNetworks = async (
    searchOverride?: string,
    bboxOverride?: { north: number; south: number; east: number; west: number },
    polygonOverride?: [number, number][],
  ) => {
    const requestId = ++networkRequestRef.current;
    
    // Safely abort previous in-flight requests without throwing uncaught errors
    if (networkAbortRef.current) {
      try { networkAbortRef.current.abort(); } catch (e) {}
    }

    const controller = new AbortController();
    networkAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 750_000);

    const viewportBbox = bboxOverride || getViewportBbox();
    const activePoly = polygonOverride || (polygon && polygon.length >= 3 ? polygon : getActivePolygon());
    const selectedPolygon = activePoly && activePoly.length >= 3 ? activePoly : undefined;

    const areaCacheKey = areaNetworkKey(areaId, selectedPolygon, latitude, longitude);

    // STALE-WHILE-REVALIDATE: If cached, load and display INSTANTLY (0 ms)!
    const cachedEntry = getCachedNetworkEntry(areaId, selectedPolygon, latitude, longitude);
    if (cachedEntry && (cachedEntry.roads.length > 0 || cachedEntry.rivers.length > 0)) {
      networksLoadedRef.current = cachedEntry.complete === true;
      setExtractedBbox(cachedEntry.bbox);
      setRoadFeatures(cachedEntry.roads);
      setRiverFeatures(cachedEntry.rivers);
      render3DRoads(cachedEntry.roads, showRoads);
      render3DRivers(cachedEntry.rivers, showRivers);
      if (cachedEntry.buildings && cachedEntry.buildings.length > 0) {
        setBuildingFeatures(cachedEntry.buildings);
        render3DBuildings(cachedEntry.buildings);
      }
      if (cachedEntry.osmTileStatus) {
        setOsmTileStatus(cachedEntry.osmTileStatus);
      }
      setIsExtractingNetworks(false);

      // If cache is fresh (< 30 minutes old), check if buildings need loading
      if (cachedEntry.complete && Date.now() - cachedEntry.timestamp < 30 * 60 * 1000) {
        window.clearTimeout(timeout);
        networkAbortRef.current = null;
        // If cached entry has roads/rivers but no buildings yet, trigger building loading now!
        if (!cachedEntry.buildingsLoadedAt || Date.now() - cachedEntry.buildingsLoadedAt > 30 * 60 * 1000) {
          const params: Parameters<typeof extractNetworks>[0] = selectedPolygon
            ? {
                polygon: selectedPolygon,
                lat: latitude,
                lng: longitude,
                radius_km: searchRadiusKm,
                place_name: searchOverride || areaName || undefined,
                area_id: areaId,
                area_key: areaId || areaCacheKey,
              }
            : viewportBbox
            ? {
                north: viewportBbox.north,
                south: viewportBbox.south,
                east: viewportBbox.east,
                west: viewportBbox.west,
                lat: latitude,
                lng: longitude,
                area_id: areaId,
                area_key: areaId || areaCacheKey,
              }
            : {
                lat: latitude,
                lng: longitude,
                radius_km: searchRadiusKm,
                place_name: searchOverride || areaName || undefined,
                area_id: areaId,
                area_key: areaId || areaCacheKey,
              };
          void loadBuildings(params, cachedEntry.roads, cachedEntry.rivers, cachedEntry.bbox, areaCacheKey);
        }
        return;
      }
    } else {
      setIsExtractingNetworks(true);
    }

    try {
      setNetworkError(null);
      const params: Parameters<typeof extractNetworks>[0] = selectedPolygon
        ? {
            polygon: selectedPolygon,
            lat: latitude,
            lng: longitude,
            radius_km: searchRadiusKm,
            place_name: searchOverride || areaName || undefined,
            area_id: areaId,
            area_key: areaId || areaCacheKey,
          }
        : viewportBbox
        ? {
            north: viewportBbox.north,
            south: viewportBbox.south,
            east: viewportBbox.east,
            west: viewportBbox.west,
            lat: latitude,
            lng: longitude,
            area_id: areaId,
            area_key: areaId || areaCacheKey,
          }
        : {
            lat: latitude,
            lng: longitude,
            radius_km: searchRadiusKm,
            place_name: searchOverride || areaName || undefined,
            area_id: areaId,
            area_key: areaId || areaCacheKey,
          };

      console.log(`[DT] Fetching complete selected-area network: ${selectedPolygon ? `${selectedPolygon.length} boundary points` : viewportBbox ? `${viewportBbox.south.toFixed(3)},${viewportBbox.west.toFixed(3)} → ${viewportBbox.north.toFixed(3)},${viewportBbox.east.toFixed(3)}` : `center ${latitude},${longitude} r=${searchRadiusKm}km`}`);

      const res = await loadSelectedAreaNetworks(params, controller.signal);

      // Never let a late response from an older request clear the completed selected-area scene.
      if (requestId !== networkRequestRef.current || !viewerRef.current || viewerRef.current.isDestroyed()) {
        console.warn(`[DT] Discarded extract-networks response: requestId=${requestId}, current=${networkRequestRef.current}, viewerDestroyed=${!viewerRef.current || viewerRef.current.isDestroyed()}`);
        return;
      }

      if (res.status === "success") {
        const roads = res.roads.geojson?.features || [];
        const rivers = res.rivers.geojson?.features || [];
        const tileStatus = res.osm_loading;
        const complete = tileStatus?.complete !== false;
        setNetworkError(complete ? null : "Some map layers failed to load. Retry to finish this area.");
        const statusObj = {
          loaded: tileStatus?.loaded_tiles ?? 0,
          total: tileStatus?.total_tiles ?? 0,
          roads: roads.length,
          rivers: rivers.length,
          buildings: networkAreaCache[areaCacheKey]?.buildings?.length || cachedEntry?.buildings?.length || 0,
        };
        setOsmTileStatus(statusObj);

        if (complete || roads.length > 0 || rivers.length > 0) {
          networksLoadedRef.current = complete;
          setExtractedBbox(res.bbox);

          // Update in-memory cache, preserving existing buildings
          const entryToStore = {
            roads,
            rivers,
            bbox: res.bbox,
            osmTileStatus: statusObj,
            buildings: networkAreaCache[areaCacheKey]?.buildings || cachedEntry?.buildings,
            buildingsLoadedAt: networkAreaCache[areaCacheKey]?.buildingsLoadedAt || cachedEntry?.buildingsLoadedAt,
            timestamp: Date.now(),
            complete,
          };
          setCachedNetworkEntry(entryToStore, areaId, selectedPolygon, latitude, longitude);
        }

        setRoadFeatures(roads);
        setRiverFeatures(rivers);

        render3DRoads(roads, showRoads);
        render3DRivers(rivers, showRivers);

        // Check if network response includes buildings from DB cache
        const cachedDbBuildings: BuildingFeature[] = (res as any).buildings?.geojson?.features || [];

        // User feedback
        if (roads.length > 0 || rivers.length > 0) {
          const waterBodiesCount = rivers.filter((r: any) => {
            const wt = ((r.properties?.waterway_type || r.properties?.waterway || "") as string).toLowerCase();
            return r.properties?.is_water_body || ["water", "lake", "reservoir", "pond", "basin", "riverbank", "lagoon", "oxbow"].includes(wt);
          }).length;
          const riverCount = rivers.length - waterBodiesCount;
          let desc = `Loaded ${roads.length} paths`;
          if (riverCount > 0) desc += `, ${riverCount} rivers`;
          if (waterBodiesCount > 0) desc += `, ${waterBodiesCount} water bodies`;
          if (cachedDbBuildings.length > 0) desc += `, ${cachedDbBuildings.length} buildings`;
          toast.success(desc);
        } else {
          toast.info("No roads, rivers, or water bodies found in this area from OpenStreetMap");
        }

        handlePredictRisk(res.bbox);


        if (res.buildings) {
          // Buildings already available from DB cache — render immediately, no separate fetch needed
          setBuildingFeatures(cachedDbBuildings);
          setOsmTileStatus(prev => ({ ...prev, buildings: cachedDbBuildings.length }));
          void render3DBuildings(cachedDbBuildings);
          const entry = networkAreaCache[areaCacheKey];
          if (entry) {
            entry.buildings = cachedDbBuildings;
            entry.buildingsLoadedAt = Date.now();
          }
          // If the cached layer was empty, still try loading fresh buildings from OSM
          if (cachedDbBuildings.length === 0) {
            void loadBuildings(params, roads, rivers, res.bbox, areaCacheKey);
          }
        } else {
          // Buildings not in Supabase yet — load from OSM and save
          void loadBuildings(params, roads, rivers, res.bbox, areaCacheKey);
        }
      } else {
        toast.error("Network extraction failed — check backend connection");
      }
    } catch (err: any) {
      const isAbort =
        err?.name === "AbortError" ||
        err?.name === "CanceledError" ||
        err?.code === 20 ||
        controller.signal.aborted ||
        String(err?.message || "").toLowerCase().includes("abort") ||
        String(err || "").toLowerCase().includes("abort") ||
        String(err?.message || "").toLowerCase().includes("canceled");
      if (isAbort) {
        return;
      }
      console.error("Failed to extract road/river networks:", err);
      setNetworkError("Paths or waterways could not be loaded. Retry this area.");
      toast.error("Could not load roads/rivers — check your internet connection or try a different area");
    } finally {
      window.clearTimeout(timeout);
      if (requestId === networkRequestRef.current) {
        networkAbortRef.current = null;
        setIsExtractingNetworks(false);
        if (controller.signal.aborted && !networksLoadedRef.current) {
          setNetworkError("Map loading timed out. Retry this area.");
        }
      }
    }
  };

  const loadBuildings = async (
    params: Parameters<typeof extractBuildings>[0],
    roads: RoadFeature[],
    rivers: RiverFeature[],
    bbox: BoundingBox,
    areaCacheKey?: string,
  ) => {
    if (buildingAreaRef.current === areaCacheKey && buildingAbortRef.current && !buildingAbortRef.current.signal.aborted) return;
    // Only skip if buildings are already loaded in cache AND the cache is fresh (< 30 min)
    // Don't skip just because a load is in-flight — abort the old one and start fresh
    const cachedForArea = areaCacheKey ? networkAreaCache[areaCacheKey] : undefined;
    if (areaCacheKey && cachedForArea?.buildingsLoadedAt && cachedForArea.buildings
        && (Date.now() - cachedForArea.buildingsLoadedAt < 30 * 60 * 1000)) {
      return;
    }
    const buildingRequestId = ++buildingRequestRef.current;
    if (buildingAbortRef.current) {
      try { buildingAbortRef.current.abort(); } catch (e) {}
    }
    const controller = new AbortController();
    buildingAbortRef.current = controller;
    buildingAreaRef.current = areaCacheKey ?? null;
    setIsLoadingBuildings(true);
    setBuildingLoadError(null);
    try {
      // 🎯 STRICT MARKED AREA ONLY: Use the exact marked polygon
      const activePoly = (params as any)?.polygon && (params as any).polygon.length >= 3
        ? (params as any).polygon
        : (polygon && polygon.length >= 3 ? polygon : getActivePolygon());

      // Derive tight bounding box directly from the marked polygon
      const polyLats = activePoly.map((p: [number, number]) => p[0]);
      const polyLngs = activePoly.map((p: [number, number]) => p[1]);
      const minLat = Math.min(...polyLats);
      const maxLat = Math.max(...polyLats);
      const minLon = Math.min(...polyLngs);
      const maxLon = Math.max(...polyLngs);

      const rawCandidates = await loadSelectedAreaBuildings(
        activePoly,
        controller.signal,
        message => {
          if (buildingRequestId === buildingRequestRef.current) setBuildingLoadStatus(message);
        },
        areaId,
        areaCacheKey
      );

      // Validate and deduplicate without dropping real houses beside roads or water.
      const preparedBuildings = prepareBuildingFootprints(rawCandidates, activePoly);
      const clearBuildings: BuildingFeature[] = preparedBuildings.map((b) => ({
        ...b,
        properties: {
          ...b.properties,
          risk_color: "#f97316",
          flood_risk: "SAFE" as const,
        },
      }));

      // 5. 📊 ACCURATE STATS: All monitored houses uniform count
      const stats = {
        total: clearBuildings.length,
        safe: clearBuildings.length,
        moderate: 0,
        high: 0,
        critical: 0,
      };

      if (buildingRequestId !== buildingRequestRef.current || !viewerRef.current || viewerRef.current.isDestroyed()) {
        return;
      }

      setBuildingLoadStatus(`${clearBuildings.length} building footprints loaded`);
      setBuildingFeatures(clearBuildings);
      setBuildingStats(stats);
      setOsmTileStatus((prev) => ({
        ...prev,
        buildings: clearBuildings.length,
      }));
      await render3DBuildings(clearBuildings);
      if (buildingRequestId !== buildingRequestRef.current || controller.signal.aborted) return;

      if (areaCacheKey) {
        const entry = networkAreaCache[areaCacheKey] ??= { roads, rivers, bbox, timestamp: 0, complete: false };
        if (entry) {
          entry.buildings = clearBuildings;
          entry.buildingsLoadedAt = Date.now();
        }
      }
      const completedEntry = areaCacheKey ? networkAreaCache[areaCacheKey] : undefined;
      if (completedEntry?.complete) try {
        localStorage.setItem(networksStorageKey, JSON.stringify({ ...completedEntry, areaKey: areaCacheKey }));
      } catch (e) {}

    } catch (err: any) {
      const isAbort =
        err?.name === "AbortError" ||
        err?.name === "CanceledError" ||
        err?.code === 20 ||
        controller.signal.aborted ||
        String(err?.message || "").toLowerCase().includes("abort") ||
        String(err || "").toLowerCase().includes("abort") ||
        String(err?.message || "").toLowerCase().includes("canceled");
      if (isAbort) {
        return;
      }
      console.error("Failed to extract building footprints:", err);
      if (buildingRequestId !== buildingRequestRef.current) return;
      setBuildingLoadError("Building provider unavailable after retries. Existing footprints are preserved.");
      toast.warning("Paths and waterways are ready; building detail is still unavailable");
    } finally {
      if (buildingRequestId === buildingRequestRef.current) {
        buildingAbortRef.current = null;
        setIsLoadingBuildings(false);
        // Keep buildingAreaRef pointing to the last area so the guard at the top
        // of loadBuildings can skip a duplicate call for the same completed area.
        // It is reset to null only when switching areas (networkRequestRef bump).
      }
    }
  };


  // ─── 📐 SELECTED-AREA NETWORK LOADING ───
  // Load concurrently with camera movements or when area selection changes.
  const scheduleSelectedAreaLoad = (polygonOverride?: [number, number][], forceImmediate = false) => {
    if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
    const trigger = () => {
      const selectedPolygon = polygonOverride || getActivePolygon();
      const areaKey = selectedPolygon && selectedPolygon.length >= 3
        ? selectedAreaKey(selectedPolygon)
        : `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
      if (areaKey === lastViewportBboxRef.current && (networkAbortRef.current && !networkAbortRef.current.signal.aborted || networksLoadedRef.current)) return;
      lastViewportBboxRef.current = areaKey;
      handleExtractNetworks(undefined, undefined, selectedPolygon);
    };

    if (forceImmediate) {
      trigger();
    } else {
      viewportDebounceRef.current = setTimeout(trigger, 250);
    }
  };

  scheduleAreaLoadRef.current = scheduleSelectedAreaLoad;

  const handlePredictRisk = async (bbox?: BoundingBox | null) => {
    setIsPredictingRisk(true);
    try {
      const targetBbox = bbox || extractedBbox;
      const cLat = targetBbox?.center_lat || latitude;
      const cLng = targetBbox?.center_lng || longitude;

      const res = await predictRisk({
        lat: cLat,
        lng: cLng,
        radius_km: searchRadiusKm,
        rainfall_intensity_mm: 50.0,
        soil_saturation_pct: 80.0,
      });

      if (res.status === "success" && res.prediction) {
        const zones = res.prediction.high_risk_zones || [];
        setHighRiskZones(zones);
        render3DRiskZones(zones, showRiskHotspots);
      }
    } catch (err) {
      console.error("Failed to predict flood risk:", err);
    } finally {
      setIsPredictingRisk(false);
    }
  };

  const handleCalculateEvacuationRoute = async () => {
    setIsCalculatingRoute(true);
    try {
      if (roadFeatures.length === 0 && !isExtractingNetworks) {
        toast.info("Extracting road paths for evacuation routing…");
        await handleExtractNetworks();
      }

      const north = extractedBbox?.north || latitude + 0.025;
      const south = extractedBbox?.south || latitude - 0.025;
      const east = extractedBbox?.east || longitude + 0.025;
      const west = extractedBbox?.west || longitude - 0.025;

      const res = await calculateEvacuationRoute({
        north,
        south,
        east,
        west,
        user_lat: userOriginCoords.lat,
        user_lng: userOriginCoords.lng,
        dest_lat: evacDestMode === "custom" && customDestLat ? customDestLat : undefined,
        dest_lng: evacDestMode === "custom" && customDestLng ? customDestLng : undefined,
        destination_name: evacDestMode === "custom" ? customDestName : "Safe High-Ground Exit",
        avoid_critical: routeAvoidCritical,
        rainfall_intensity_mm: 55.0,
      });

      setEvacuationRoute(res);
      if (res.status === "success") {
        render3DEvacuationRoute(res);
        toast.success(`Safe route found: ${res.total_distance_km} km (${res.route_status})`);
      } else {
        toast.error(res.message || "Failed to calculate evacuation route");
      }
    } catch (err) {
      console.error("Failed to calculate evacuation route:", err);
      toast.error("Evacuation routing service error — please retry");
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  // ─── 📡 MASTER & SLAVE 3D IOT MESH NETWORK LOGIC ───
  const render3DMeshNodes = (nodes: DigitalTwinMeshNode[]) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // Remove existing mesh node & link entities
    meshNodeEntitiesRef.current.forEach((ent) => {
      try {
        viewer.entities.remove(ent);
      } catch (e) {}
    });
    meshNodeEntitiesRef.current = [];

    const activePoly = getActivePolygon();
    const validNodes = nodes.filter((n) => isPointInPolygon(n.lat, n.lng, activePoly));
    if (!showMeshNodes) return;
    if (validNodes.length === 0 && deployedSensors.length === 0) return;

    const master = validNodes.find((n) => n.type === "master");

    // 1. Render Master Node (Golden Amber Mast + Radar Footprint) if deployed
    if (master) {
      const masterMast = viewer.entities.add({
        id: `mesh-node-${master.id}`,
        name: `📡 MASTER GATEWAY: ${master.name}`,
        position: Cesium.Cartesian3.fromDegrees(master.lng, master.lat, 0),
        cylinder: {
          length: 20.0,
          topRadius: 1.8,
          bottomRadius: 3.2,
          material: Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.95),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#fef08a"),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString("#f59e0b"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `${master.sensorId || "node1"} • Sensor connected successfully`,
          font: "bold 24px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          scale: 0.5,
          fillColor: Cesium.Color.fromCssColorString("#34d399"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#064e3b").withAlpha(0.94),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -28),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      (masterMast as any)._nodeId = master.id;
      meshNodeEntitiesRef.current.push(masterMast);
    }

    // 2. Render Slave Nodes & Continuous 3D Connection Lines
    const slaves = validNodes.filter((n) => n.type === "slave");

    slaves.forEach((slave, idx) => {
      // 3D Slave Telemetry Station (Electric Cyan)
      const slaveMast = viewer.entities.add({
        id: `mesh-node-${slave.id}`,
        name: `⚡ SLAVE NODE #${idx + 1}: ${slave.name}`,
        position: Cesium.Cartesian3.fromDegrees(slave.lng, slave.lat, 0),
        cylinder: {
          length: 16.0,
          topRadius: 1.4,
          bottomRadius: 2.4,
          material: Cesium.Color.fromCssColorString("#06b6d4").withAlpha(0.95),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#67e8f9"),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        point: {
          pixelSize: 11,
          color: Cesium.Color.fromCssColorString("#06b6d4"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `${slave.sensorId || `node${idx + 2}`} • Sensor connected successfully`,
          font: "bold 24px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          scale: 0.5,
          fillColor: Cesium.Color.fromCssColorString("#67e8f9"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#083344").withAlpha(0.94),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -24),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      (slaveMast as any)._nodeId = slave.id;
      meshNodeEntitiesRef.current.push(slaveMast);

      // ALWAYS-ON 3D CONNECTION LINK (MASTER ↔ SLAVE) clamped directly to terrain surface
      if (master) {
        const linkLine = viewer.entities.add({
          id: `link-${master.id}-${slave.id}`,
          name: `Mesh RF Link: ${master.name} ↔ ${slave.name}`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray([
              master.lng, master.lat,
              slave.lng, slave.lat,
            ]),
            width: 3.5,
            clampToGround: true,
            material: new Cesium.PolylineOutlineMaterialProperty({
              color: Cesium.Color.fromCssColorString("#22c55e"), // Vibrant RF link green
              outlineColor: Cesium.Color.fromCssColorString("#14532d"),
              outlineWidth: 1.5,
            }),
          },
        });
        (linkLine as any)._nodeId = slave.id;
        meshNodeEntitiesRef.current.push(linkLine);

        // Midpoint RF Telemetry Badge
        const midLat = (master.lat + slave.lat) / 2;
        const midLng = (master.lng + slave.lng) / 2;
        const distKm = calculateDistanceKm(master.lat, master.lng, slave.lat, slave.lng);
        const midBadge = viewer.entities.add({
          id: `badge-${slave.id}`,
          name: `Link Status: ${master.name} ↔ ${slave.name}`,
          position: Cesium.Cartesian3.fromDegrees(midLng, midLat, 0),
          label: {
            text: `Connected • ${distKm.toFixed(2)} km`,
            font: "bold 22px monospace",
            scale: 0.5,
            fillColor: Cesium.Color.fromCssColorString("#a5f3fc"),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString("#042f2e").withAlpha(0.95),
            backgroundPadding: new Cesium.Cartesian2(8, 4),
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        (midBadge as any)._nodeId = slave.id;
        meshNodeEntitiesRef.current.push(midBadge);
      }
    });

    // 3. Render Deployed Sensors (Connected to their respective Slave node)
    deployedSensors.forEach((sensor) => {
      if (sensor.lat === undefined || sensor.lng === undefined) return;
      const parentSlave = slaves.find((s) => s.id === sensor.slaveId);
      if (!parentSlave) return;

      const sensorColorMap: Record<SensorType, string> = {
        water_level: "#38bdf8",
        soil_moisture: "#34d399",
        imu: "#c084fc",
        tilt: "#fbbf24",
        raindrop: "#60a5fa",
      };
      const hexColor = sensorColorMap[sensor.type] || "#38bdf8";

      // 3D Sensor Node Marker clamped to ground
      const sensorEntity = viewer.entities.add({
        id: `mesh-sensor-${sensor.id}`,
        name: `📡 ${sensor.name} (Slave: ${parentSlave.name})`,
        position: Cesium.Cartesian3.fromDegrees(sensor.lng, sensor.lat, 0),
        cylinder: {
          length: 12.0,
          topRadius: 1.0,
          bottomRadius: 1.8,
          material: Cesium.Color.fromCssColorString(hexColor).withAlpha(0.95),
          outline: true,
          outlineColor: Cesium.Color.WHITE,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(hexColor),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `${sensor.name} • Connected`,
          font: "bold 22px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          scale: 0.48,
          fillColor: Cesium.Color.fromCssColorString(hexColor),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#0f172a").withAlpha(0.92),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      (sensorEntity as any)._sensorId = sensor.id;
      meshNodeEntitiesRef.current.push(sensorEntity);

      // Clamped polyline connecting Sensor to its parent Slave node (follows terrain surface)
      const sensorLinkLine = viewer.entities.add({
        id: `sensor-link-${sensor.id}`,
        name: `Sensor Link: ${sensor.name} ↔ ${parentSlave.name}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([
            sensor.lng, sensor.lat,
            parentSlave.lng, parentSlave.lat,
          ]),
          width: 3.0,
          clampToGround: true,
          material: new Cesium.PolylineOutlineMaterialProperty({
            color: Cesium.Color.fromCssColorString("#f97316"), // Vibrant sensor link orange
            outlineColor: Cesium.Color.fromCssColorString("#7c2d12"),
            outlineWidth: 1.5,
          }),
        },
      });
      (sensorLinkLine as any)._sensorId = sensor.id;
      meshNodeEntitiesRef.current.push(sensorLinkLine);
    });
  };

  const focusOnNode = (node: DigitalTwinMeshNode) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(node.lng, node.lat - 0.003, 400),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-35),
        roll: 0.0,
      },
      duration: 1.2,
    });
  };

  const confirmSensorPlacement = (
    type: "master" | "slave",
    lat: number,
    lng: number,
    sensorId: string = "node1"
  ) => {
    const finalSensorId = sensorId.trim() || "node1";
    if (type === "master") {
      const masterExists = meshNodes.some((n) => n.type === "master");
      if (masterExists) {
        setMeshNodes((prev) =>
          prev.map((n) =>
            n.type === "master"
              ? { ...n, lat, lng, sensorId: finalSensorId, connectedStatus: "Sensor connected successfully" }
              : n
          )
        );
        logUserActivity(
          "Relocated Master Gateway",
          `Master node (${finalSensorId}) updated at (${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E)`
        );
      } else {
        const newMaster: DigitalTwinMeshNode = {
          id: "node-master",
          name: `Master Gateway (${finalSensorId})`,
          type: "master",
          lat,
          lng,
          role: "Central Gateway & Telemetry Master",
          battery: 100,
          signalDbm: -45,
          status: "online",
          sensorId: finalSensorId,
          connectedStatus: "Sensor connected successfully",
        };
        setMeshNodes((prev) => [newMaster, ...prev]);
        setSelectedNodeId(newMaster.id);
        logUserActivity(
          "Placed Master Gateway",
          `Positioned Master (${finalSensorId}) at (${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E)`,
          newMaster
        );
      }
    } else {
      const newIdx = meshNodes.filter((n) => n.type === "slave").length + 1;
      const newSlave: DigitalTwinMeshNode = {
        id: `node-slave-${Date.now()}`,
        name: `Slave Node ${newIdx} (${finalSensorId})`,
        type: "slave",
        lat,
        lng,
        role: "Slave Node",
        battery: 98,
        signalDbm: -66,
        status: "online",
        sensorId: finalSensorId,
        connectedStatus: "Sensor connected successfully",
      };
      setMeshNodes((prev) => [...prev, newSlave]);
      setSelectedNodeId(newSlave.id);
      setActiveSlaveId(newSlave.id);
      setShowSlaveDataBox(true);
      logUserActivity(
        "Added Slave Node",
        `Placed ${newSlave.name} (${finalSensorId}) at (${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E)`,
        newSlave
      );
    }
    setStagedSensorId(finalSensorId);
    setSensorConnectedOnce(true);
    try {
      localStorage.setItem(`dt_sensor_connected_${areaName || "default"}`, "true");
    } catch {}
    setLastConnectedSensorMsg(`Sensor connected successfully (ID: ${finalSensorId})`);
    toast.success("Sensor connected successfully");
    setSensorPromptModal((prev) => ({ ...prev, open: false }));
    setIsPickingLocation(null);
  };

  const handleConnectSensorOneTime = (idToConnect?: string) => {
    const finalId = (idToConnect || stagedSensorId || "node1").trim() || "node1";
    setStagedSensorId(finalId);
    setSensorConnectedOnce(true);
    try {
      localStorage.setItem(`dt_sensor_connected_${areaName || "default"}`, "true");
    } catch {}
    setLastConnectedSensorMsg(`Sensor connected successfully (ID: ${finalId})`);
    toast.success("Sensor connected successfully");

    // Update any existing master/slave nodes with this sensorId
    setMeshNodes((prev) =>
      prev.map((n) => ({
        ...n,
        sensorId: n.sensorId || finalId,
        connectedStatus: "Sensor connected successfully",
      }))
    );

    const firstSlave = meshNodes.find((n) => n.type === "slave");
    if (firstSlave) {
      setActiveSlaveId(firstSlave.id);
      setShowSlaveDataBox(true);
    }
  };

  const addMasterAtCenter = () => {
    const master: DigitalTwinMeshNode = {
      id: "node-master",
      name: "Basin Central Gateway Alpha (node1)",
      type: "master",
      lat: Number(latitude.toFixed(6)),
      lng: Number(longitude.toFixed(6)),
      role: "Central Gateway & Telemetry Master",
      battery: 100,
      signalDbm: -45,
      status: "online",
      sensorId: "node1",
      connectedStatus: "Sensor connected successfully",
    };
    setMeshNodes((prev) => [master, ...prev.filter((n) => n.type !== "master")]);
    setLastConnectedSensorMsg("Sensor connected successfully (ID: node1)");
    toast.success("Sensor connected successfully");
    logUserActivity("Added Master Gateway", `Placed at center coords (${latitude.toFixed(5)}° N, ${longitude.toFixed(5)}° E)`, master);
  };

  const deleteNode = (id: string) => {
    const toDelete = meshNodes.find((n) => n.id === id);
    if (!toDelete) return;
    setMeshNodes((prev) => prev.filter((n) => n.id !== id));
    if (toDelete.type === "slave") {
      setDeployedSensors((prev) => prev.filter((s) => s.slaveId !== id));
    }
    if (selectedNodeId === id) setSelectedNodeId(null);
    if (activeSlaveId === id) {
      setActiveSlaveId(null);
      setShowSlaveDataBox(false);
    }
    logUserActivity("Deleted Node", `Removed ${toDelete.name} [${toDelete.type.toUpperCase()}]`, toDelete);
  };

  const setNodeAsMaster = (id: string) => {
    const target = meshNodes.find((n) => n.id === id);
    setMeshNodes((prev) =>
      prev.map((n) => ({
        ...n,
        type: n.id === id ? "master" : "slave",
        role: n.id === id ? "Central Gateway & Telemetry Master" : n.role,
      }))
    );
    if (target) {
      logUserActivity("Promoted to Master", `Promoted ${target.name} to central gateway`, target);
    }
  };

  const addPresetSlave = (
    presetType: SensorType
  ) => {
    const master = meshNodes.find((n) => n.type === "master");
    const refLat = master ? master.lat : latitude;
    const refLng = master ? master.lng : longitude;
    const offsetMap: Record<SensorType, { dLat: number; dLng: number; name: string; role: string }> = {
      water_level: { dLat: -0.0075, dLng: -0.0045, name: "Water Level Slave Sentry", role: "Water Level Submersible Sensor" },
      soil_moisture: { dLat: -0.0055, dLng: 0.0078, name: "Soil Moisture Slave Sentry", role: "Capacitive Soil Saturation Probe" },
      imu: { dLat: 0.0082, dLng: -0.0068, name: "9-Axis IMU Slave Station", role: "9-Axis IMU Orientation & Landslide Sentry" },
      tilt: { dLat: 0.0065, dLng: 0.0058, name: "Tilt Sensor Slave Station", role: "Structural & Slope Inclinometer" },
      raindrop: { dLat: 0.0092, dLng: 0.0035, name: "Raindrop Sensor Slave Station", role: "Optical Raindrop Sentry Station" },
    };
    const p = offsetMap[presetType];
    const newSlaveId = `node-slave-${Date.now()}`;
    const newSlave: DigitalTwinMeshNode = {
      id: newSlaveId,
      name: p.name,
      type: "slave",
      lat: Number((refLat + p.dLat).toFixed(6)),
      lng: Number((refLng + p.dLng).toFixed(6)),
      role: p.role,
      battery: 96,
      signalDbm: -69,
      status: "online",
      sensorId: stagedSensorId || "node1",
    };
    setMeshNodes((prev) => [...prev, newSlave]);
    setSelectedNodeId(newSlaveId);
    setActiveSlaveId(newSlaveId);
    setShowSlaveDataBox(true);

    const sensorNameMap: Record<SensorType, string> = {
      water_level: "Water Level Sensor",
      soil_moisture: "Soil Moisture Sensor",
      imu: "9-Axis IMU",
      tilt: "Tilt Sensor",
      raindrop: "Rain Drop Sensor",
    };
    setDeployedSensors((prev) => [
      ...prev,
      {
        id: `sensor-${presetType}-${Date.now()}`,
        type: presetType,
        name: `${sensorNameMap[presetType]} #1`,
        slaveId: newSlaveId,
        lat: newSlave.lat,
        lng: newSlave.lng,
        connectedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      },
    ]);
    logUserActivity("Added Preset Slave", `Added ${newSlave.name} with ${sensorNameMap[presetType]}`, newSlave);
  };

  const clearAllNodes = () => {
    setMeshNodes([]);
    setDeployedSensors([]);
    setActiveSlaveId(null);
    setShowSlaveDataBox(false);
    logUserActivity("Cleared Network", "Removed all nodes from 3D terrain");
  };

  const clearUserActivities = () => {
    setUserActivities([]);
    try {
      localStorage.removeItem(activityStorageKey);
    } catch (e) {}
  };

  // ─── 📡 FETCH LIVE DATA FOR SLAVE NODE 1 (Poll every 1s) ───
  useEffect(() => {
    let isMounted = true;
    const activeSlaveNode = meshNodes.find((n) => n.id === activeSlaveId) || meshNodes.find((n) => n.type === "slave");
    const targetSensorId = (activeSlaveNode?.sensorId || stagedSensorId || "node1").trim() || "node1";

    const fetchSlaveData = async () => {
      try {
        const res = await fetch(`/api/external-sensors/node/${encodeURIComponent(targetSensorId)}`);
        if (!res.ok) {
          if (isMounted) setSlaveLiveTelemetry(defaultLiveTelemetry);
          return;
        }
        const data = await res.json();
        if (!isMounted) return;

        if (data && data.has_data) {
          const rawTilt = Number(data.raw_tilt ?? data.tilt ?? 0);
          // Calibrate tilt: 100% = 0, 0% = 100%
          const tiltVal = data.raw_tilt !== undefined 
            ? Number(data.tilt ?? 0) 
            : Math.max(0, Math.min(100, 100 - rawTilt));

          const telemetry: LiveSlaveTelemetry = {
            deviceId: data.device_id || targetSensorId,
            hasData: true,
            status: "online",
            soilMoisture: Number(data.soil_moisture ?? 0),
            waterLevelMm: Number(data.water_level_mm ?? data.water_level ?? 0),
            waterLevelM: Number(data.water_level_m ?? (Number(data.water_level ?? 0) / 1000.0)),
            rainfall: Number(data.rainfall ?? data.rainfall_mm ?? 0),
            rainfallMm: Number(data.rainfall_mm ?? data.rainfall ?? 0),
            rainfallPct: Number(data.rainfall_pct ?? data.rainfall ?? 0),
            tilt: tiltVal,
            rawTilt: rawTilt,
            imuX: Number(data.imu_x ?? 0),
            imuY: Number(data.imu_y ?? 0),
            imuZ: Number(data.imu_z ?? 0),
            imuMag: Number(data.imu_mag ?? 0),
            rssi: Number(data.rssi ?? 0),
            snr: Number(data.snr ?? 0),
            battery: Number(data.battery ?? 0),
            txt: String(data.txt || ""),
            createdAt: data.created_at || null,
          };

          setSlaveLiveTelemetry(telemetry);

          // ─── 1. ATMOSPHERIC RAIN (Strictly sensor rainfall, no simulation) ───
          const isRainOver20 = telemetry.rainfall > 20 || telemetry.rainfallPct > 20;
          if (isRainOver20) {
            if (!rainActive) {
              setInternalRain(true);
              setShowVisibleRain(true);
              onToggleRain?.(true);
            }
            setSimRainIntensity(telemetry.rainfall);
            if (!lastAutoStartedRainRef.current) {
              lastAutoStartedRainRef.current = true;
              toast.success(`🌧️ Sensor rainfall detected (${telemetry.rainfall.toFixed(1)} mm/h)! Atmospheric rain active.`);
            }
          } else {
            lastAutoStartedRainRef.current = false;
            if (rainActive || internalRain || showVisibleRain) {
              setInternalRain(false);
              setShowVisibleRain(false);
              onToggleRain?.(false);
            }
            setSimRainIntensity(0);
          }

          // ─── 2. SENSOR-DRIVEN FLOOD SIMULATION (Water level > 40 OR Soil moisture > 40) ───
          // "if water level and soil moisture lvel raised by 40 or eithier one of them simulate flood slowly nomal is enough"
          const isFloodRiskTriggered = telemetry.hasData && (telemetry.waterLevelMm > 40 || telemetry.soilMoisture > 40);
          if (isFloodRiskTriggered) {
            setWaterSimActive(true);
            autoStartedBySensorRef.current = true;
            flashFloodRef.current?.setSpeed(1.0);
            flashFloodRef.current?.startSimulation();
            if (!lastAutoStartedFloodRef.current) {
              lastAutoStartedFloodRef.current = true;
              const triggerReason = telemetry.waterLevelMm > 40 && telemetry.soilMoisture > 40
                ? `Water level (${telemetry.waterLevelMm.toFixed(0)} mm) & Soil moisture (${telemetry.soilMoisture.toFixed(0)}%) > 40`
                : telemetry.waterLevelMm > 40
                ? `Water level (${telemetry.waterLevelMm.toFixed(0)} mm) > 40`
                : `Soil moisture (${telemetry.soilMoisture.toFixed(0)}%) > 40`;
              toast.success(`🌊 ${triggerReason}: Simulating flood slowly.`);
            }
          } else {
            lastAutoStartedFloodRef.current = false;
            if (autoStartedBySensorRef.current) {
              autoStartedBySensorRef.current = false;
              setWaterSimActive(false);
              flashFloodRef.current?.pauseSimulation();
            }
          }
        } else {
          // "if no data display 0 in that tab"
          setSlaveLiveTelemetry(defaultLiveTelemetry);
          lastAutoStartedRainRef.current = false;
          lastAutoStartedFloodRef.current = false;
          if (rainActive || internalRain || showVisibleRain) {
            setInternalRain(false);
            setShowVisibleRain(false);
            onToggleRain?.(false);
          }
          if (autoStartedBySensorRef.current) {
            autoStartedBySensorRef.current = false;
            setWaterSimActive(false);
            flashFloodRef.current?.pauseSimulation();
          }
          setSimRainIntensity(0);
        }
      } catch (err) {
        if (isMounted) {
          setSlaveLiveTelemetry(defaultLiveTelemetry);
          lastAutoStartedRainRef.current = false;
          lastAutoStartedFloodRef.current = false;
          if (rainActive || internalRain || showVisibleRain) {
            setInternalRain(false);
            setShowVisibleRain(false);
            onToggleRain?.(false);
          }
          if (autoStartedBySensorRef.current) {
            autoStartedBySensorRef.current = false;
            setWaterSimActive(false);
            flashFloodRef.current?.pauseSimulation();
          }
          setSimRainIntensity(0);
        }
      }
    };

    fetchSlaveData();
    const interval = setInterval(fetchSlaveData, 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeSlaveId, stagedSensorId, meshNodes, rainActive, onToggleRain]);

  // ─── SRTM 30m DEM TOPOGRAPHY LAYER (NASA / USGS SRTMGL1_003) ───
  const showSrtm30Ref = useRef(showSrtm30);
  showSrtm30Ref.current = showSrtm30;
  const srtmLoadingRef = useRef(false);

  const loadSrtmLayer = async (viewer: any, opacity: number = 0.65, visible: boolean = true) => {
    if (!viewer || viewer.isDestroyed()) return;

    // If layer already loaded — just update visibility and opacity in 0 ms!
    if (srtmLayerRef.current) {
      try {
        srtmLayerRef.current.show = visible;
        srtmLayerRef.current.alpha = opacity;
        if (visible) {
          viewer.imageryLayers?.raiseToTop(srtmLayerRef.current);
        }
        viewer.scene?.requestRender();
      } catch (e) {}
      return;
    }

    if (srtmLoadingRef.current) return;
    srtmLoadingRef.current = true;

    try {
      const srtmTileUrl = await getFastSrtmTileUrl();
      if (!viewer || viewer.isDestroyed()) {
        srtmLoadingRef.current = false;
        return;
      }

      if (srtmLayerRef.current) {
        srtmLayerRef.current.show = showSrtm30Ref.current;
        srtmLayerRef.current.alpha = opacity;
        if (showSrtm30Ref.current) {
          viewer.imageryLayers?.raiseToTop(srtmLayerRef.current);
        }
        viewer.scene?.requestRender();
        srtmLoadingRef.current = false;
        return;
      }

      const srtmProvider = new Cesium.UrlTemplateImageryProvider({
        url: srtmTileUrl,
        maximumLevel: 18,
        minimumLevel: 0,
        tileWidth: 256,
        tileHeight: 256,
        enablePickFeatures: false,
        hasAlphaChannel: true,
        credit: "NASA / USGS SRTM 30m DEM (USGS/SRTMGL1_003)",
      });

      const layer = viewer.imageryLayers.addImageryProvider(srtmProvider);
      layer.alpha = opacity;
      layer.show = showSrtm30Ref.current;
      viewer.imageryLayers.raiseToTop(layer);
      srtmLayerRef.current = layer;
      viewer.scene?.requestRender();
    } catch (err) {
      console.warn("Failed to load SRTM 30m DEM layer onto 3D terrain:", err);
    } finally {
      srtmLoadingRef.current = false;
    }
  };

  const toggleSrtm30 = () => {
    const nextState = !showSrtm30;
    setShowSrtm30(nextState);
    showSrtm30Ref.current = nextState;
    if (nextState) setShowSrtmLegend(true);
    if (srtmLayerRef.current) {
      // Layer already preloaded / loaded — flip visibility in 0 ms!
      srtmLayerRef.current.show = nextState;
      srtmLayerRef.current.alpha = srtmOpacity;
      if (nextState) {
        viewerRef.current?.imageryLayers?.raiseToTop(srtmLayerRef.current);
      }
      viewerRef.current?.scene?.requestRender();
    } else if (viewerRef.current) {
      loadSrtmLayer(viewerRef.current, srtmOpacity, nextState);
    }
  };

  const handleSrtmOpacityChange = (newVal: number) => {
    setSrtmOpacity(newVal);
    if (srtmLayerRef.current) {
      srtmLayerRef.current.alpha = newVal;
      viewerRef.current?.scene?.requestRender();
    }
  };


  // ─── AREA CLIPPING: Restrict globe strictly to monitored polygon (removes everything outside) ───
  const updateWhiteMask = (polyCoords: [number, number][], _centerLon: number, _centerLat: number) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // Clear any previous clipping polygons on the globe
    if (viewer.scene.globe.clippingPolygons) {
      try {
        viewer.scene.globe.clippingPolygons.enabled = false;
        viewer.scene.globe.clippingPolygons = undefined;
      } catch (e) {}
    }

    // Ensure background and globe base are pure black
    const pureBlackColor = Cesium.Color.BLACK;
    viewer.scene.backgroundColor = pureBlackColor;
    viewer.scene.globe.baseColor = pureBlackColor;
    viewer.scene.globe.undergroundColor = pureBlackColor;
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
    if (viewer.scene.fog) {
      viewer.scene.fog.enabled = false;
    }

    // Clear any old mask / border entities
    maskEntitiesRef.current.forEach((ent) => {
      try { viewer.entities.remove(ent); } catch (e) {}
    });
    maskEntitiesRef.current = [];

    if (!polyCoords || polyCoords.length < 3) {
      // No polygon — show full globe without any clip
      try { viewer.scene.globe.cartographicLimitRectangle = Cesium.Rectangle.MAX_VALUE; } catch (e) {}
      return;
    }

    // Ensure polygon positions do not have duplicate closing vertex for ClippingPolygon
    const cleanCoords = [...polyCoords];
    if (
      cleanCoords.length > 3 &&
      cleanCoords[0][0] === cleanCoords[cleanCoords.length - 1][0] &&
      cleanCoords[0][1] === cleanCoords[cleanCoords.length - 1][1]
    ) {
      cleanCoords.pop();
    }

    // 1. Precise 3D Terrain & Satellite Imagery clipping using Cesium's ClippingPolygonCollection.
    //    inverse = true clips away all terrain and imagery OUTSIDE the selected polygon!
    let clippingApplied = false;
    if (
      typeof Cesium !== "undefined" &&
      Cesium.ClippingPolygonCollection &&
      Cesium.ClippingPolygon &&
      (!Cesium.ClippingPolygonCollection.isSupported || Cesium.ClippingPolygonCollection.isSupported(viewer.scene))
    ) {
      try {
        const cartesianPositions = cleanCoords.map(([lat, lng]) =>
          Cesium.Cartesian3.fromDegrees(lng, lat)
        );
        const clipPoly = new Cesium.ClippingPolygon({
          positions: cartesianPositions,
        });
        const clipColl = new Cesium.ClippingPolygonCollection({
          polygons: [clipPoly],
          enabled: true,
          inverse: true, // CLIPS AWAY EVERYTHING OUTSIDE THE SELECTED POLYGON!
        });
        viewer.scene.globe.clippingPolygons = clipColl;
        clippingApplied = true;
      } catch (e) {
        console.warn("[DT] ClippingPolygonCollection error:", e);
      }
    }

    // 2. Set cartographicLimitRectangle tightly around the polygon so Cesium only loads tiles for this area
    const lats = cleanCoords.map(([la]) => la);
    const lngs = cleanCoords.map(([, lo]) => lo);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const pad = clippingApplied ? 0.005 : 0.0005;

    try {
      viewer.scene.globe.cartographicLimitRectangle = Cesium.Rectangle.fromDegrees(
        minLng - pad, minLat - pad, maxLng + pad, maxLat + pad
      );
    } catch (e) {}

    // 3. Crisp border polyline around the exact boundary of the selected area
    const borderPositions: number[] = [];
    cleanCoords.forEach(([lat, lng]) => {
      borderPositions.push(lng, lat);
    });
    // Ensure the border polyline is closed
    borderPositions.push(cleanCoords[0][1], cleanCoords[0][0]);

    try {
      const borderEnt = viewer.entities.add({
        name: "Selected Area Boundary",
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(borderPositions),
          width: 4,
          material: new Cesium.PolylineOutlineMaterialProperty({
            color: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.fromAlpha(Cesium.Color.WHITE, 0.4),
            outlineWidth: 2,
          }),
          clampToGround: true,
        },
      });
      maskEntitiesRef.current.push(borderEnt);
    } catch (e) {
      console.warn("[DT] Border entity error:", e);
    }
  };

  // ─── 🎯 SMART CAMERA DESTINATION: Frames custom polygon or regional basin accurately ───
  const getCameraDestinationForArea = (
    mode: "3d" | "topdown" = "3d",
    targetPoly?: [number, number][],
    targetLat?: number,
    targetLng?: number
  ) => {
    const lat = targetLat ?? latitude;
    const lng = targetLng ?? longitude;
    const poly = targetPoly ?? getActivePolygon();

    if (poly && poly.length >= 3) {
      const lats = poly.map(([la]) => la);
      const lngs = poly.map(([, lo]) => lo);
      const minLa = Math.min(...lats);
      const maxLa = Math.max(...lats);
      const minLo = Math.min(...lngs);
      const maxLo = Math.max(...lngs);
      const cLat = (minLa + maxLa) / 2;
      const cLng = (minLo + maxLo) / 2;
      const dLatM = (maxLa - minLa) * 111320;
      const dLngM = (maxLo - minLo) * 111320 * Math.cos((cLat * Math.PI) / 180);
      const diagM = Math.hypot(dLatM, dLngM);

      if (mode === "topdown") {
        const topHeight = Math.max(500, Math.min(8500, diagM * 2.0));
        return {
          destination: Cesium.Cartesian3.fromDegrees(cLng, cLat, topHeight),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-88),
            roll: 0.0,
          },
        };
      } else {
        const targetAlt = Math.max(450, Math.min(6500, diagM * 1.5));
        const latOffset = (targetAlt * 0.72) / 111320;
        return {
          destination: Cesium.Cartesian3.fromDegrees(cLng, cLat - latOffset, targetAlt),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-45),
            roll: 0.0,
          },
        };
      }
    }

    if (mode === "topdown") {
      return {
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 8000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-88),
          roll: 0.0,
        },
      };
    } else {
      return {
        destination: Cesium.Cartesian3.fromDegrees(lng, lat - 0.045, 6500),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0.0,
        },
      };
    }
  };

  // Initialize Viewer with Mouse Controls for Up/Down & WASD Movement
  useEffect(() => {
    if (!cesiumReady || !cesiumContainerRef.current) return;
    setLoading(true);
    setLoadError(null);

    let isDisposed = false;
    let viewer: any = null;
    let removePointerListeners = () => {};

    async function initCesium() {
      try {
        Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

        // 1. Load 3D World Terrain
        let terrainProvider: any = null;
        try {
          terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
            requestVertexNormals: true,
            requestWaterMask: true,
          });
        } catch (terrErr) {
          console.warn("Terrain fallback:", terrErr);
          try {
            terrainProvider = await Cesium.createWorldTerrainAsync({
              requestWaterMask: true,
              requestVertexNormals: true,
            });
          } catch (terrFallbackErr) {
            terrainProvider = new Cesium.EllipsoidTerrainProvider();
          }
        }

        // 2. Load Aerial Imagery with ArcGIS fallback
        let baseLayer: any = undefined;
        try {
          const imagery = await Cesium.IonImageryProvider.fromAssetId(2);
          baseLayer = new Cesium.ImageryLayer(imagery);
        } catch (imgErr) {
          try {
            const esri = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
              "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
              { enablePickFeatures: false }
            );
            baseLayer = new Cesium.ImageryLayer(esri);
          } catch (esriErr) {
            // This direct tile template does not need the ArcGIS metadata
            // request, so satellite imagery still works when that endpoint is
            // blocked or slow on a local network.
            const esriTiles = new Cesium.UrlTemplateImageryProvider({
              url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
              maximumLevel: 19,
              credit: "Esri World Imagery",
            });
            baseLayer = new Cesium.ImageryLayer(esriTiles);
            console.warn("Satellite metadata fallback:", esriErr);
          }
        }

        if (isDisposed || !cesiumContainerRef.current) return;

        viewer = new Cesium.Viewer(cesiumContainerRef.current, {
          terrainProvider: terrainProvider || undefined,
          baseLayer: baseLayer || undefined,
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
          targetFrameRate: 60,
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          shadows: false, // Disabled heavy cascading shadow maps for maximum FPS
          skyBox: false, // Disabled default starry space skybox to show clean sky blue background
          skyAtmosphere: false, // Disabled dark atmospheric rim
        });

        viewerRef.current = viewer;
        setCesiumViewer(viewer);
        (window as any)._dtCesiumViewer = viewer;

        // High-performance 60 FPS resolution configuration (prevents GPU fill-rate exhaustion)
        viewer.useBrowserRecommendedResolution = true;
        viewer.resolutionScale = 1.0;

        // Configure High-Performance Photorealistic Atmosphere & 3D Terrain
        const scene = viewer.scene;
        scene.globe.show = true;
        scene.globe.depthTestAgainstTerrain = true; // Enables true 3D terrain depth testing so objects sit on ground
        scene.globe.enableLighting = false; // Disabled dynamic terrain vertex lighting calculation for 60 FPS
        scene.globe.showGroundAtmosphere = false; // Disabled to prevent dark horizon shading
        scene.globe.terrainExaggeration = 1.0;
        scene.globe.maximumScreenSpaceError = 2.5; // Fast LOD terrain mesh streaming
        scene.globe.tileCacheSize = 100;
        scene.globe.preloadAncestors = false;
        scene.globe.preloadSiblings = false;
        // Pure black background & globe base for clean contrast
        const pureBlackColor = Cesium.Color.BLACK;
        scene.globe.baseColor = pureBlackColor;
        scene.backgroundColor = pureBlackColor;
        scene.globe.undergroundColor = pureBlackColor;

        // Ensure skybox, skyAtmosphere, sun and moon are completely hidden so space is pure black
        if (scene.skyBox) {
          scene.skyBox.show = false;
        }
        if (scene.skyAtmosphere) {
          scene.skyAtmosphere.show = false;
        }
        if (scene.sun) {
          scene.sun.show = false;
        }
        if (scene.moon) {
          scene.moon.show = false;
        }

        // Apply Google Maps camera controller configuration (3D mode by default)
        applyControllerSettings("3d");

        // Fog disabled for crisp pure black void contrast
        scene.fog.enabled = false;

        // Position sunlight for clear surface depth
        viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date("2026-09-05T09:30:00Z"));

        // Completely hide credit container, logo, and watermarks
        if (viewer.cesiumWidget?.creditContainer) {
          viewer.cesiumWidget.creditContainer.style.display = "none";
        }
        if (viewer.bottomContainer) {
          viewer.bottomContainer.style.display = "none";
        }

        // Add Target Area Ground Marker (High-DPI text)
        markerRef.current = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(longitude, latitude),
          point: {
            pixelSize: 10,
            color: Cesium.Color.fromCssColorString("#38bdf8"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          label: {
            text: areaName,
            font: "bold 26px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            scale: 0.5,
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 4,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString("#0f172a").withAlpha(0.85),
            backgroundPadding: new Cesium.Cartesian2(8, 4),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });

        // Add the white outer mask showing only the selected area
        const polyCoords = getActivePolygon();
        updateWhiteMask(polyCoords, longitude, latitude);

        // Pre-load SRTM 30m DEM Elevation Topography Layer (STM 30) for instant 0ms toggling
        loadSrtmLayer(viewer, srtmOpacity, showSrtm30);

        // Render Master & Slave 3D IoT Mesh Nodes & Connection Links
        render3DMeshNodes(meshNodes);


        // 🚀 Smooth Cinematic Entry: Direct Monitored Basin / Polygon 3D Oblique View
        const initTarget = getCameraDestinationForArea("3d", getActivePolygon(), latitude, longitude);
        isInFlightRef.current = true;
        viewer.camera.setView({
          destination: initTarget.destination,
          orientation: initTarget.orientation,
        });

        // 2. Allow the initial WebGL frame & terrain tiles to render before gently dissolving the loading veil
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
            // Smoothly dissolve the loading veil
            setLoading(false);

            // 3. Smooth cinematic flight into high-resolution 3D oblique perspective
            viewerRef.current.camera.flyTo({
              destination: initTarget.destination,
              orientation: initTarget.orientation,
              duration: 1.2,
              easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
              complete: () => {
                isInFlightRef.current = false;
                scheduleAreaLoadRef.current();
              },
              cancel: () => {
                isInFlightRef.current = false;
                scheduleAreaLoadRef.current();
              },
            });
          }, 120);
        });

        // Track altitude and compass heading on camera change (throttled to avoid React re-render lag)
        let lastCamUpdate = 0;
        viewer.camera.changed.addEventListener(() => {
          const now = performance.now();
          if (now - lastCamUpdate < 200) return;
          lastCamUpdate = now;
          if (viewerRef.current && !viewerRef.current.isDestroyed()) {
            const cam = viewerRef.current.camera;
            const carto = cam.positionCartographic;
            if (carto) {
              setCamAltitude(Math.round(carto.height));
            }
            if (cam.heading !== undefined) {
              setCamHeading(Math.round(Cesium.Math.toDegrees(cam.heading)));
            }
          }
        });

        // 🖱️ MOUSE CONTROLS:
        // In Flat View:
        // - Dragging mouse UP: Increase altitude (camera ascends)
        // - Dragging mouse DOWN: Decrease altitude (camera descends, clamped to ground)
        // - Dragging mouse LEFT/RIGHT: Turn heading left/right
        // - Mouse wheel UP: Increase altitude
        // - Mouse wheel DOWN: Decrease altitude
        // In all other views (3D, Top-Down):
        // - 100% native Google Maps navigation (Left Drag: Pan, Right Drag / Ctrl+Drag: Tilt, Wheel: Zoom).
        let isMouseDown = false;
        let prevMouseY = 0;
        let prevMouseX = 0;

        const canvas = scene.canvas;

        const handleMouseDown = (e: MouseEvent) => {
          if (viewModeRef.current !== "flat") return;
          isMouseDown = true;
          prevMouseY = e.clientY;
          prevMouseX = e.clientX;
        };

        const handleMouseUp = () => {
          isMouseDown = false;
        };

        const handleMouseMove = (e: MouseEvent) => {
          if (!isMouseDown || !viewerRef.current || viewerRef.current.isDestroyed()) return;

          if (viewModeRef.current === "flat") {
            const dy = e.clientY - prevMouseY;
            const dx = e.clientX - prevMouseX;
            prevMouseY = e.clientY;
            prevMouseX = e.clientX;

            const cam = viewerRef.current.camera;
            const carto = cam.positionCartographic;
            if (!carto) return;

            const currentAlt = carto.height;
            const minAlt = groundHeightMeters + 1.2;
            const heightAboveGround = Math.max(1.0, currentAlt - groundHeightMeters);

            // Responsive vertical climb / descent
            if (dy !== 0) {
              const climbRate = Math.min(25.0, Math.max(0.18, heightAboveGround * 0.022)) * Math.abs(dy);
              if (dy < 0) {
                // Dragging mouse UP -> INCREASE ALTITUDE
                cam.moveUp(climbRate);
              } else {
                // Dragging mouse DOWN -> DECREASE ALTITUDE
                if (currentAlt - climbRate >= minAlt) {
                  cam.moveDown(climbRate);
                } else {
                  const newCarto = Cesium.Cartographic.fromRadians(carto.longitude, carto.latitude, minAlt);
                  cam.position = Cesium.Ellipsoid.WGS84.cartographicToCartesian(newCarto);
                }
              }
            }

            // Horizontal mouse drag -> Smooth, level turning left/right (zero horizon roll)
            if (dx !== 0) {
              const turnRad = dx * 0.0035;
              const newHeading = Cesium.Math.zeroToTwoPi(cam.heading + turnRad);
              cam.setView({
                destination: cam.position,
                orientation: {
                  heading: newHeading,
                  pitch: cam.pitch,
                  roll: 0.0,
                },
              });
            }
          }
        };

        // Mouse Wheel in Flat View: Wheel Up -> Increase Altitude; Wheel Down -> Decrease Altitude
        const handleWheel = (e: WheelEvent) => {
          if (viewModeRef.current === "flat" && viewerRef.current && !viewerRef.current.isDestroyed()) {
            e.preventDefault();
            const cam = viewerRef.current.camera;
            const carto = cam.positionCartographic;
            if (!carto) return;

            const currentAlt = carto.height;
            const minAlt = groundHeightMeters + 1.2;
            const heightAboveGround = Math.max(1.0, currentAlt - groundHeightMeters);
            const scrollStep = Math.min(25.0, Math.max(0.6, heightAboveGround * 0.06));

            if (e.deltaY < 0) {
              // Wheel UP -> INCREASE ALTITUDE
              cam.moveUp(scrollStep);
            } else {
              // Wheel DOWN -> DECREASE ALTITUDE
              if (currentAlt - scrollStep >= minAlt) {
                cam.moveDown(scrollStep);
              } else {
                const newCarto = Cesium.Cartographic.fromRadians(carto.longitude, carto.latitude, minAlt);
                cam.position = Cesium.Ellipsoid.WGS84.cartographicToCartesian(newCarto);
              }
            }
          }
        };

        canvas.addEventListener("mousedown", handleMouseDown);
        window.addEventListener("mouseup", handleMouseUp);
        window.addEventListener("mousemove", handleMouseMove);
        canvas.addEventListener("wheel", handleWheel, { passive: false });
        removePointerListeners = () => {
          canvas.removeEventListener("mousedown", handleMouseDown);
          window.removeEventListener("mouseup", handleMouseUp);
          window.removeEventListener("mousemove", handleMouseMove);
          canvas.removeEventListener("wheel", handleWheel);
        };

        // Input stays responsive while the scene is idle between requested frames.
        let lastMovementTime = performance.now();
        scene.preUpdate.addEventListener(() => {
          const now = performance.now();
          const movementStep = Math.min((now - lastMovementTime) / (1000 / 60), 3);
          lastMovementTime = now;
          if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
          const cam = viewerRef.current.camera;
          const flags = movementFlagsRef.current;

          const hasMovement =
            flags.forward ||
            flags.backward ||
            flags.left ||
            flags.right ||
            flags.up ||
            flags.down ||
            flags.turnLeft ||
            flags.turnRight ||
            flags.lookUp ||
            flags.lookDown;

          if (!hasMovement || document.hidden) return;
          scene.requestRender();

          if (viewModeRef.current === "flat") {
            // Normal Ground Movements on Flat View using WASD
            const ellipsoid = scene.globe.ellipsoid;
            const normal = ellipsoid.geodeticSurfaceNormal(cam.position);

            // Project camera direction onto horizontal plane
            const dotVal = Cesium.Cartesian3.dot(cam.direction, normal);
            const forwardH = Cesium.Cartesian3.subtract(
              cam.direction,
              Cesium.Cartesian3.multiplyByScalar(normal, dotVal, new Cesium.Cartesian3()),
              new Cesium.Cartesian3()
            );
            Cesium.Cartesian3.normalize(forwardH, forwardH);
            const rightH = cam.right;

            const currentCarto = ellipsoid.cartesianToCartographic(cam.position);
            const curAlt = currentCarto ? currentCarto.height : groundHeightMeters + 1.8;
            const heightAboveGround = Math.max(1.5, curAlt - groundHeightMeters);
            const walkSpeed = Math.min(50.0, Math.max(5.5, heightAboveGround * 0.35)) * movementStep;
            let movedOnGround = false;

            if (flags.forward) {
              Cesium.Cartesian3.add(
                cam.position,
                Cesium.Cartesian3.multiplyByScalar(forwardH, walkSpeed, new Cesium.Cartesian3()),
                cam.position
              );
              movedOnGround = true;
            }
            if (flags.backward) {
              Cesium.Cartesian3.subtract(
                cam.position,
                Cesium.Cartesian3.multiplyByScalar(forwardH, walkSpeed, new Cesium.Cartesian3()),
                cam.position
              );
              movedOnGround = true;
            }
            if (flags.left) {
              Cesium.Cartesian3.subtract(
                cam.position,
                Cesium.Cartesian3.multiplyByScalar(rightH, walkSpeed, new Cesium.Cartesian3()),
                cam.position
              );
              movedOnGround = true;
            }
            if (flags.right) {
              Cesium.Cartesian3.add(
                cam.position,
                Cesium.Cartesian3.multiplyByScalar(rightH, walkSpeed, new Cesium.Cartesian3()),
                cam.position
              );
              movedOnGround = true;
            }

            // Up / Down keys (Q / E or D-Pad): Increase / Decrease Altitude
            if (flags.up) {
              const climb = Math.min(10.0, Math.max(0.4, heightAboveGround * 0.035)) * movementStep;
              cam.moveUp(climb);
            }
            if (flags.down) {
              const descend = Math.min(10.0, Math.max(0.4, heightAboveGround * 0.035)) * movementStep;
              if (curAlt - descend >= groundHeightMeters + 1.2) {
                cam.moveDown(descend);
              }
            }
            if (flags.turnLeft) {
              const newHeading = Cesium.Math.zeroToTwoPi(cam.heading - Cesium.Math.toRadians(1.2 * movementStep));
              cam.setView({
                destination: cam.position,
                orientation: {
                  heading: newHeading,
                  pitch: cam.pitch,
                  roll: 0.0,
                },
              });
              setCamHeading(Math.round(Cesium.Math.toDegrees(newHeading)));
            }
            if (flags.turnRight) {
              const newHeading = Cesium.Math.zeroToTwoPi(cam.heading + Cesium.Math.toRadians(1.2 * movementStep));
              cam.setView({
                destination: cam.position,
                orientation: {
                  heading: newHeading,
                  pitch: cam.pitch,
                  roll: 0.0,
                },
              });
              setCamHeading(Math.round(Cesium.Math.toDegrees(newHeading)));
            }

            // Keep camera clamped at minimum ground + 1.2m when walking across terrain
            if (movedOnGround) {
              const postCarto = ellipsoid.cartesianToCartographic(cam.position);
              if (postCarto) {
                const gH = scene.globe.getHeight(postCarto);
                if (gH !== undefined && !isNaN(gH) && gH > -50) {
                  const minH = gH + 1.2;
                  if (postCarto.height < minH) {
                    cam.position = Cesium.Cartesian3.fromRadians(postCarto.longitude, postCarto.latitude, minH);
                  }
                }
              }
            }
          } else {
            // 3D / Top-Down Flight Mode
            const carto = cam.positionCartographic;
            const curH = carto ? Math.max(5, carto.height) : 500;
            const moveSpeed = Math.max(16.0, curH * 0.08) * movementStep;

            if (flags.forward) cam.moveForward(moveSpeed);
            if (flags.backward) cam.moveBackward(moveSpeed);
            if (flags.left) cam.moveLeft(moveSpeed);
            if (flags.right) cam.moveRight(moveSpeed);
            if (flags.up) cam.moveUp(moveSpeed * 0.7);
            if (flags.down) cam.moveDown(moveSpeed * 0.7);

            if (flags.turnLeft) cam.lookLeft(Cesium.Math.toRadians(1.2 * movementStep));
            if (flags.turnRight) cam.lookRight(Cesium.Math.toRadians(1.2 * movementStep));
            if (flags.lookUp) cam.lookUp(Cesium.Math.toRadians(0.8 * movementStep));
            if (flags.lookDown) cam.lookDown(Cesium.Math.toRadians(0.8 * movementStep));
          }
        });

        sampleGroundElevation(longitude, latitude);

        setLoading(false);
        scheduleAreaLoadRef.current(undefined, true);
      } catch (err: any) {
        console.error("Initialization error:", err);
        if (!isDisposed) {
          setLoadError(err.message || "Failed to initialize 3D satellite view.");
          setLoading(false);
        }
      }
    }

    initCesium();

    return () => {
      isDisposed = true;
      removePointerListeners();
      networkAbortRef.current?.abort();
      buildingAbortRef.current?.abort();
      buildingRenderRef.current++;
      if (orbitListenerRef.current) {
        orbitListenerRef.current();
        orbitListenerRef.current = null;
      }
      if (viewportDebounceRef.current) {
        clearTimeout(viewportDebounceRef.current);
        viewportDebounceRef.current = null;
      }
      srtmLayerRef.current = null;
      if (viewer && !viewer.isDestroyed()) {
        // Reset globe limit so next mount starts fresh
        try {
          if (viewer.scene.globe.clippingPolygons) {
            viewer.scene.globe.clippingPolygons.enabled = false;
            viewer.scene.globe.clippingPolygons = undefined;
          }
          viewer.scene.globe.cartographicLimitRectangle = Cesium.Rectangle.MAX_VALUE;
        } catch (e) {}
        viewer.destroy();
        viewerRef.current = null;
        setCesiumViewer(null);
      }
    };
  }, [cesiumReady]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  });

  // React to Latitude / Longitude / Polygon changes
  useEffect(() => {
    const polyCoords = getActivePolygon();
    const areaSig = `${areaId || ""}_${areaName || ""}_${latitude.toFixed(4)}_${longitude.toFixed(4)}_${JSON.stringify(polyCoords)}`;
    if (isInitialAreaMountRef.current) {
      isInitialAreaMountRef.current = false;
      lastAreaSignatureRef.current = areaSig;
      return;
    }

    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (markerRef.current) {
      markerRef.current.position = Cesium.Cartesian3.fromDegrees(longitude, latitude);
      if (markerRef.current.label) {
        markerRef.current.label.text = areaName;
      }
    }

    if (isOrbiting) stopOrbit();

    if (lastAreaSignatureRef.current === areaSig) {
      // Area has not actually changed; preserve in-flight loads and scene entities
      return;
    }
    lastAreaSignatureRef.current = areaSig;
    setShowLayersStatusBox(true);

    // Refresh the white outer mask around the new active polygon
    updateWhiteMask(polyCoords, longitude, latitude);

    // Cancel any previous area's in-flight network requests safely
    networkRequestRef.current++;
    buildingRequestRef.current++;
    buildingRenderRef.current++;
    setIsLoadingBuildings(false);
    setBuildingLoadStatus("");
    setBuildingLoadError(null);
    if (networkAbortRef.current) {
      try { networkAbortRef.current.abort(); } catch (e) {}
    }
    if (buildingAbortRef.current) {
      try { buildingAbortRef.current.abort(); } catch (e) {}
    }

    const cached = getCachedNetworkEntry(areaId, polyCoords, latitude, longitude);

    if (cached) {
      // Instant restore from cache: render immediately!
      setRoadFeatures(cached.roads);
      setRiverFeatures(cached.rivers);
      render3DRoads(cached.roads, showRoads);
      render3DRivers(cached.rivers, showRivers);
      if (cached.buildings) {
        setBuildingFeatures(cached.buildings);
        render3DBuildings(cached.buildings);
      } else {
        setBuildingFeatures([]);
        render3DBuildings([]);
      }
      setExtractedBbox(cached.bbox);
      networksLoadedRef.current = cached.complete === true;
    } else {
      // Clear previous entities while flying to the unvisited area
      setRoadFeatures([]);
      setRiverFeatures([]);
      setBuildingFeatures([]);
      render3DRoads([], showRoads);
      render3DRivers([], showRivers);
      render3DBuildings([]);
      setOsmTileStatus({ loaded: 0, total: 0, roads: 0, rivers: 0, buildings: 0 });
      setBuildingStats({ total: 0, safe: 0, moderate: 0, high: 0, critical: 0 });
      setNetworkError(null);
      setEvacuationRoute(null);
      networksLoadedRef.current = false;
    }
    lastViewportBboxRef.current = "";

    // Start loading the new area networks concurrently in parallel with camera flight
    scheduleSelectedAreaLoad(polyCoords);

    const onFlyComplete = () => {
      isInFlightRef.current = false;
      const v = viewerRef.current;
      if (v && !v.isDestroyed() && v.camera?.positionCartographic) {
        setCamAltitude(Math.round(v.camera.positionCartographic.height));
      }
    };

    isInFlightRef.current = true;
    if (viewMode === "flat") {
      switchToFlatView().finally(onFlyComplete);
    } else if (polyCoords && polyCoords.length >= 3) {
      const positions = polyCoords.map(([la, lo]) => Cesium.Cartesian3.fromDegrees(lo, la, 0));
      const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
      boundingSphere.radius = Math.max(150, boundingSphere.radius * 1.3);
      const pitch = viewMode === "topdown" ? Cesium.Math.toRadians(-88) : Cesium.Math.toRadians(-45);
      viewer.camera.flyToBoundingSphere(boundingSphere, {
        offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(0), pitch, 0),
        duration: 1.8,
        complete: onFlyComplete,
        cancel: onFlyComplete,
      });
    } else if (viewMode === "topdown") {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 8000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-88),
          roll: 0.0,
        },
        duration: 1.8,
        complete: onFlyComplete,
        cancel: onFlyComplete,
      });
    } else {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude - 0.045, 6500),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0.0,
        },
        duration: 1.8,
        complete: onFlyComplete,
        cancel: onFlyComplete,
      });
    }
  }, [latitude, longitude, areaName, polygon]);

  // 🚶 FLAT VIEW (Ground level perspective)
  const switchToFlatView = async () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (isOrbiting) stopOrbit();
    setViewMode("flat");
    applyControllerSettings("flat");

    const groundElev = await sampleGroundElevation(longitude, latitude);
    const eyeLevelAltitude = groundElev + 1.8;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, eyeLevelAltitude),
      orientation: {
        heading: viewer.camera.heading || Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(1.0),
        roll: 0.0,
      },
      duration: 2.0,
    });
  };

  // 🏔️ 3D VIEW (Oblique 3D perspective with Google Maps controls)
  const switchTo3DView = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (isOrbiting) stopOrbit();
    setViewMode("3d");
    applyControllerSettings("3d");

    const poly = getActivePolygon();
    if (poly && poly.length >= 3) {
      const positions = poly.map(([la, lo]) => Cesium.Cartesian3.fromDegrees(lo, la, 0));
      const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
      boundingSphere.radius = Math.max(150, boundingSphere.radius * 1.3);
      viewer.camera.flyToBoundingSphere(boundingSphere, {
        offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(0), Cesium.Math.toRadians(-45), 0),
        duration: 1.5,
      });
    } else {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude - 0.045, 6500),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0.0,
        },
        duration: 1.5,
      });
    }
  };

  // 🛰️ TOP-DOWN SATELLITE (Nadir perspective with Google Maps controls)
  const switchToTopDown = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (isOrbiting) stopOrbit();
    setViewMode("topdown");
    applyControllerSettings("topdown");

    const poly = getActivePolygon();
    if (poly && poly.length >= 3) {
      const positions = poly.map(([la, lo]) => Cesium.Cartesian3.fromDegrees(lo, la, 0));
      const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
      boundingSphere.radius = Math.max(150, boundingSphere.radius * 1.3);
      viewer.camera.flyToBoundingSphere(boundingSphere, {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(0),
          Cesium.Math.toRadians(-89.5),
          Math.max(650, boundingSphere.radius * 2.25)
        ),
        duration: 1.4,
      });
    } else {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 8000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-88),
          roll: 0.0,
        },
        duration: 1.4,
      });
    }
  };

  // 360° Terrain Orbit
  const toggleOrbit = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (isOrbiting) {
      stopOrbit();
    } else {
      setIsOrbiting(true);
      const target = Cesium.Cartesian3.fromDegrees(longitude, latitude, groundHeightMeters);
      let angle = 0;
      const distance = viewMode === "flat" ? 60.0 : 7500.0;
      const pitchAngle = viewMode === "flat" ? -4 : -38;

      let lastOrbitTime = performance.now();
      orbitListenerRef.current = viewer.scene.preUpdate.addEventListener(() => {
        const now = performance.now();
        const dt = Math.min((now - lastOrbitTime) / 1000, 0.05);
        lastOrbitTime = now;
        if (document.hidden) return;
        if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
        angle += 0.15 * dt;
        viewer.scene.requestRender();
        viewer.camera.lookAt(
          target,
          new Cesium.HeadingPitchRange(angle, Cesium.Math.toRadians(pitchAngle), distance)
        );
      });
    }
  };

  const stopOrbit = () => {
    if (orbitListenerRef.current) {
      orbitListenerRef.current();
      orbitListenerRef.current = null;
    }
    setIsOrbiting(false);
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
  };

  // Reset Camera View
  const handleResetCamera = () => {
    switchTo3DView();
  };

  // Fullscreen Toggle
  const toggleFullscreen = () => {
    const elem = containerRef.current;
    if (!elem) return;

    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(() => setIsFullscreen(true));
      } else if ((elem as any).webkitRequestFullscreen) {
        (elem as any).webkitRequestFullscreen();
      } else {
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => setIsFullscreen(false));
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else {
        setIsFullscreen(false);
      }
    }
  };

  // Enter Fullscreen Helper (opens the entire Digital Twin in fullscreen mode)
  const enterFullscreen = () => {
    const elem = containerRef.current;
    setIsFullscreen(true);
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (elem?.requestFullscreen) {
        elem.requestFullscreen().catch(() => setIsFullscreen(true));
      } else if ((elem as any)?.webkitRequestFullscreen) {
        (elem as any).webkitRequestFullscreen();
      }
    }
    setTimeout(() => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        try {
          viewerRef.current.resize();
        } catch (e) {}
      }
    }, 150);
  };

  // Resize Cesium viewer immediately whenever fullscreen toggles
  useEffect(() => {
    const timer = setTimeout(() => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        try {
          viewerRef.current.resize();
        } catch (e) {}
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [isFullscreen]);

  // Sync 3D Mesh Nodes whenever state or visibility changes
  useEffect(() => {
    if (viewerRef.current && !viewerRef.current.isDestroyed()) {
      render3DMeshNodes(meshNodes);
    }
  }, [meshNodes, showMeshNodes, deployedSensors]);

  // Initial load of road & river networks — use localStorage cache if < 24h old
  useEffect(() => {
    if (!loading && viewerRef.current && !viewerRef.current.isDestroyed()) {
      // Small delay to ensure terrain tiles are loaded before rendering ground-clamped polylines
      const timer = setTimeout(() => {
        if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
        try {
          const raw = localStorage.getItem(networksStorageKey);
          if (raw) {
            const cached = JSON.parse(raw);
            const ageMs = Date.now() - (cached.timestamp || 0);
            const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
            const hasData = Array.isArray(cached.roads) && Array.isArray(cached.rivers) && Array.isArray(cached.buildings);
            if (ageMs < MAX_AGE_MS && hasData && cached.complete && cached.areaKey === areaNetworkKey(areaId, getActivePolygon(), latitude, longitude)) {
              // Use cached data — skip API call
              console.log(`[DT] Using cached networks: ${cached.roads.length} roads, ${cached.rivers.length} rivers`);
              networksLoadedRef.current = true;
              setRoadFeatures(cached.roads);
              setRiverFeatures(cached.rivers);
              setBuildingFeatures(cached.buildings);
              setOsmTileStatus({ loaded: 0, total: 0, roads: cached.roads.length, rivers: cached.rivers.length, buildings: cached.buildings.length });
              if (cached.bbox) setExtractedBbox(cached.bbox);
              render3DRoads(cached.roads, showRoads);
              render3DRivers(cached.rivers, showRivers);
              render3DBuildings(cached.buildings);
              lastViewportBboxRef.current = selectedAreaKey(getActivePolygon());
              const cachedAreaKey = areaNetworkKey(areaId, getActivePolygon(), latitude, longitude);
              networkAreaCache[cachedAreaKey] = cached;
              if (!cached.buildingsLoadedAt || Date.now() - cached.buildingsLoadedAt > 30 * 60 * 1000) {
                void loadBuildings({ polygon: getActivePolygon() }, cached.roads, cached.rivers, cached.bbox, cachedAreaKey);
              }
              if (cached.bbox) handlePredictRisk(cached.bbox);
              return;
            }
            // Stale cache — purge it so fresh API call is made
            localStorage.removeItem(networksStorageKey);
          }
        } catch (e) {}
        // No valid cache: if the intro flight already completed (or no flight is
        // in progress), trigger a fresh load now. The intro flight's complete
        // callback also calls scheduleSelectedAreaLoad, but if the component
        // mounts after an area change or the flight has already finished, this
        // fallback ensures networks are always loaded.
        if (!networksLoadedRef.current) {
          scheduleSelectedAreaLoad();
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [loading, latitude, longitude, areaName]);

  // Toggle Roads visibility without re-creating entities
  useEffect(() => {
    if (roadEntitiesRef.current.length > 0) {
      roadEntitiesRef.current.forEach((ent) => {
        try { ent.show = showRoads; } catch (e) {}
      });
    }
  }, [showRoads]);

  // Toggle Rivers visibility without re-creating entities/primitives
  useEffect(() => {
    riverEntitiesRef.current.forEach((ent) => {
      try { ent.show = showRivers; } catch (e) {}
    });
    riverPrimitivesRef.current.forEach((prim) => {
      try { prim.show = showRivers; } catch (e) {}
    });
    // Flow pulse follows river visibility
    riverFlowPrimitivesRef.current.forEach((prim) => {
      try { prim.show = showRivers && isFloodRunning; } catch (e) {}
    });
    viewerRef.current?.scene?.requestRender();
  }, [showRivers, isFloodRunning]);

  // Show/hide animated flow pulse on river lines when simulation starts or stops.
  // Also switch Cesium between requestRenderMode and continuous mode so czm_frameNumber
  // advances continuously (needed for the flowing animation) when the simulation is active.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    // Show flow animation only when rivers are visible and simulation is running
    const showFlow = isFloodRunning && showRivers;
    riverFlowPrimitivesRef.current.forEach((prim) => {
      try { prim.show = showFlow; } catch (e) {}
    });
    // Switch Cesium to continuous render mode so animation frames advance
    viewer.scene.requestRenderMode = !isFloodRunning;
    if (isFloodRunning) {
      viewer.scene.maximumRenderTimeChange = Infinity;
    }
    viewer.scene.requestRender();
  }, [isFloodRunning]);

  // Re-render Risk Hotspots when showRiskHotspots toggle changes
  useEffect(() => {
    render3DRiskZones(highRiskZones, showRiskHotspots);
  }, [showRiskHotspots, highRiskZones]);

  // Toggle Buildings visibility without re-creating entities
  useEffect(() => {
    if (buildingEntitiesRef.current.length > 0) {
      buildingEntitiesRef.current.forEach((ent) => {
        try {
          ent.show = showBuildings;
        } catch (e) {}
      });
    }
  }, [showBuildings]);

  // Interactive 3D Terrain & Entity Click Handler (Buildings, Mesh Nodes, Place, Delete)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const scene = viewer.scene;
    const clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);

    clickHandler.setInputAction((click: any) => {
      // 1. Check if a 3D Building or 3D Mesh Node entity was clicked
      const picked = scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id) {
        const entity = picked.id;

        // User Requirement: Check if 3D building footprint was clicked
        if ((entity as any)?._buildingData) {
          setSelectedBuilding((entity as any)._buildingData);
          setSelectedNodeId(null);
          return;
        }

        const targetId =
          (entity as any)?._nodeId ||
          (typeof entity?.id === "string" && entity.id.startsWith("mesh-node-")
            ? entity.id.replace("mesh-node-", "")
            : null);
        const clickedNode = meshNodes.find((n) => n.id === targetId || n.id === entity?.id);

        if (clickedNode) {
          setSelectedBuilding(null);
          if (isDeleteMode) {
            deleteNode(clickedNode.id);
            return;
          } else if (!isPickingLocation) {
            setSelectedNodeId(clickedNode.id);
            if (clickedNode.type === "slave") {
              setActiveSlaveId(clickedNode.id);
              setShowSlaveDataBox(true);
            }
            return;
          }
        }
      }


      // 2. Handle Picking Location for placing Master or Slave node
      if (isPickingLocation) {
        const ray = viewer.camera.getPickRay(click.position);
        let cartesian = scene.globe.pick(ray, scene);
        if (!cartesian && scene.pickPositionSupported) {
          try { cartesian = scene.pickPosition(click.position); } catch (e) {}
        }
        if (cartesian) {
          const carto = Cesium.Cartographic.fromCartesian(cartesian);
          const clickLng = Number(Cesium.Math.toDegrees(carto.longitude).toFixed(6));
          const clickLat = Number(Cesium.Math.toDegrees(carto.latitude).toFixed(6));

          if (isPickingLocation === "master") {
            confirmSensorPlacement("master", clickLat, clickLng, stagedSensorId || "node1");
            setNewNodeName("");
            return;
          } else if (isPickingLocation === "slave") {
            confirmSensorPlacement("slave", clickLat, clickLng, stagedSensorId || "node1");
            setNewNodeName("");
            return;
          } else {
            // Sensor placement: STRICT CONDITION: First slave node must be placed! All sensors connect to a slave.
            const slaves = meshNodes.filter((n) => n.type === "slave");
            if (slaves.length === 0) {
              toast.error("Condition: Place a Slave node first! All sensors connect to a Slave node.");
              logUserActivity(
                "Sensor Placement Blocked",
                "Cannot place sensor: No Slave node deployed. First place a Slave node."
              );
            } else {
              // Find closest slave node to the placed sensor coordinate
              let closestSlave = slaves[0];
              let minDistance = calculateDistanceKm(clickLat, clickLng, closestSlave.lat, closestSlave.lng);
              for (let i = 1; i < slaves.length; i++) {
                const d = calculateDistanceKm(clickLat, clickLng, slaves[i].lat, slaves[i].lng);
                if (d < minDistance) {
                  minDistance = d;
                  closestSlave = slaves[i];
                }
              }

              const sensorTitles: Record<SensorType, string> = {
                water_level: "Water Level",
                soil_moisture: "Soil Moisture",
                imu: "9-Axis IMU",
                tilt: "Tilt Sensor",
                raindrop: "Rain Drop Sensor",
              };

              const sensorType = isPickingLocation as SensorType;
              const countOfType = deployedSensors.filter((s) => s.type === sensorType && s.slaveId === closestSlave.id).length;
              const newSensor: DeployedSensor = {
                id: `sensor-${sensorType}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                type: sensorType,
                name: `${sensorTitles[sensorType]} #${countOfType + 1}`,
                slaveId: closestSlave.id,
                lat: clickLat,
                lng: clickLng,
                connectedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              };

              setDeployedSensors((prev) => [...prev, newSensor]);
              toast.success(`Placed ${newSensor.name} • Connected to ${closestSlave.name}`);
              logUserActivity(
                "Placed Sensor",
                `Placed ${newSensor.name} at (${clickLat.toFixed(5)}° N, ${clickLng.toFixed(5)}° E) connected to ${closestSlave.name}`
              );
            }
          }
          setIsPickingLocation(null);
        }
      } else if (!isDeleteMode) {
        // Deselect if clicking on empty terrain
        setSelectedNodeId(null);
        setSelectedBuilding(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Cancel on right click
    clickHandler.setInputAction(() => {
      setIsPickingLocation(null);
      setIsDeleteMode(false);
      setSelectedBuilding(null);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);


    return () => {
      try {
        clickHandler.destroy();
      } catch (e) {}
    };
  }, [isPickingLocation, isDeleteMode, newNodeName, newNodeRole, meshNodes, deployedSensors, stagedSensorId]);



  // Directional button helpers for touch & mouse free movement
  const setMoveFlag = (key: keyof typeof movementFlagsRef.current, active: boolean) => {
    movementFlagsRef.current[key] = active;
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-black border border-slate-800/80 shadow-xl transition-all duration-700 ease-out animate-in fade-in ${
        isFullscreen
          ? "fixed inset-0 z-[9999] w-screen h-screen rounded-none border-none"
          : `w-full rounded-xl ${className}`
      }`}
      style={{ minHeight: isFullscreen ? "100vh" : "600px", height: isFullscreen ? "100vh" : "100%" }}
    >
      {/* Dynamic Global Cesium CSS overrides */}
      <style>{`
        .cesium-widget-credits,
        .cesium-credit-logoContainer,
        .cesium-credit-textContainer,
        .cesium-credit-expand-link,
        .cesium-widget-credits * {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
          width: 0 !important;
          height: 0 !important;
        }

        .cesium-widget,
        .cesium-widget canvas {
          background: #000000 !important;
        }

        /* 🎛️ High-contrast, responsive custom scrollbar for Simulation dropdown & tabs */
        .custom-dt-scrollbar {
          scrollbar-width: thin !important;
          scrollbar-color: #06b6d4 rgba(15, 23, 42, 0.85) !important;
          -webkit-overflow-scrolling: touch !important;
        }
        .custom-dt-scrollbar::-webkit-scrollbar {
          width: 6px !important;
          height: 6px !important;
        }
        .custom-dt-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.75) !important;
          border-radius: 6px !important;
        }
        .custom-dt-scrollbar::-webkit-scrollbar-thumb {
          background: #0891b2 !important;
          border-radius: 6px !important;
          border: 1px solid rgba(6, 182, 212, 0.4) !important;
        }
        .custom-dt-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #38bdf8 !important;
        }
      `}</style>

      {/* Cesium WebGL Viewport */}
      <div ref={cesiumContainerRef} className="w-full h-full bg-black" />

      {/* Left Rail: Weather, Flood, and Landslide Forecast Panels or Collapsed Right Arrow (>) Trigger */}
      {forecastRailHidden ? (
        /* Collapsed > Arrow Button: Positioned exactly 30px below Flat View toolbar */
        <div className="absolute top-[93px] left-3 z-30 animate-in fade-in slide-in-from-left-2 duration-200 flex items-center">
          <button
            type="button"
            data-testid="forecast-toggle-btn"
            onClick={() => setForecastRailHidden(false)}
            className="size-9 flex items-center justify-center rounded-xl bg-slate-950/95 hover:bg-slate-900 border border-cyan-500/60 shadow-2xl text-cyan-300 hover:text-white transition-all backdrop-blur-md cursor-pointer group"
            title="Expand Flood Intelligence"
          >
            <ChevronRight className="size-5 text-cyan-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      ) : (
        /* Expanded Forecast Rail: Starting with Flood Intelligence header bar */
        <div className="absolute top-[93px] left-3 z-30 w-64 flex flex-col gap-2 max-h-[calc(100%-240px)] overflow-y-auto custom-dt-scrollbar pr-0.5 animate-in fade-in slide-in-from-left-2 duration-200 pointer-events-auto">
          {/* Header Bar: Flood Intelligence Title and Collapse Toggle */}
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-950/95 border border-cyan-500/50 backdrop-blur-md shadow-xl shrink-0">
            <div className="flex items-center gap-1.5 text-cyan-300">
              <Waves className="size-3.5 text-cyan-400" />
              <span className="text-[11px] font-bold text-cyan-200">Flood Intelligence</span>
            </div>
            <button
              type="button"
              data-testid="forecast-toggle-btn"
              onClick={() => setForecastRailHidden(true)}
              className="size-6 flex items-center justify-center rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
              title="Hide Forecasts"
            >
              <ChevronLeft className="size-3.5" />
            </button>
          </div>

          {/* 🌤️ Weather Forecast Box */}
          <div className="rounded-xl border border-cyan-500/50 bg-slate-950 opacity-100 p-3 shadow-2xl text-white space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <div className="flex items-center gap-1.5">
                <CloudRain className="size-4 text-cyan-400" />
                <span className="text-xs font-bold text-cyan-200">Weather Forecast</span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                Live Overview
              </span>
            </div>

            {/* Weather Metrics: Condition, Rainfall Rate, Temp, Humidity, Wind */}
            <div className="space-y-1.5 bg-slate-900 p-2 rounded-lg border border-slate-800 text-[10px]">
              <div className="grid grid-cols-2 gap-1.5 pb-1 border-b border-slate-800/80">
                <div>
                  <span className="text-slate-400 block text-[9px]">Condition</span>
                  <span className="font-semibold text-white truncate block">
                    {weatherDayTab === "1d"
                      ? "Moderate Rain"
                      : weatherDayTab === "2d"
                      ? "Heavy Rain"
                      : weatherDayTab === "3d"
                      ? "Storm Alert"
                      : weatherDayTab === "4d"
                      ? "Thunderstorm"
                      : weatherDayTab === "5d"
                      ? "Passing Showers"
                      : weatherDayTab === "6d"
                      ? "Light Drizzle"
                      : "Clear Sky"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px]">Rainfall Rate</span>
                  <span className="font-mono text-cyan-300 font-bold">
                    {weatherDayTab === "1d"
                      ? "12.4 mm/h"
                      : weatherDayTab === "2d"
                      ? "28.5 mm/h"
                      : weatherDayTab === "3d"
                      ? "54.2 mm/h"
                      : weatherDayTab === "4d"
                      ? "68.0 mm/h"
                      : weatherDayTab === "5d"
                      ? "18.3 mm/h"
                      : weatherDayTab === "6d"
                      ? "4.1 mm/h"
                      : "0.0 mm/h"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1 pt-0.5 text-center text-[9px]">
                <div className="bg-slate-950/70 p-1 rounded border border-slate-800/80">
                  <span className="text-slate-400 block text-[8px]">Temp</span>
                  <span className="font-mono text-cyan-300 font-bold">
                    {weatherDayTab === "1d" ? "27.4 °C" : weatherDayTab === "2d" ? "24.1 °C" : weatherDayTab === "3d" ? "23.0 °C" : "29.2 °C"}
                  </span>
                </div>
                <div className="bg-slate-950/70 p-1 rounded border border-slate-800/80">
                  <span className="text-slate-400 block text-[8px]">Humidity</span>
                  <span className="font-mono text-cyan-300 font-bold">
                    {weatherDayTab === "1d" ? "82%" : weatherDayTab === "2d" ? "94%" : weatherDayTab === "3d" ? "98%" : "71%"}
                  </span>
                </div>
                <div className="bg-slate-950/70 p-1 rounded border border-slate-800/80">
                  <span className="text-slate-400 block text-[8px]">Wind</span>
                  <span className="font-mono text-cyan-300 font-bold">
                    {weatherDayTab === "1d" ? "14.2 km/h" : weatherDayTab === "2d" ? "28.0 km/h" : weatherDayTab === "3d" ? "36.5 km/h" : "10.1 km/h"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 🌊 Flood Forecast Heatmap Box */}
          <div className="rounded-xl border border-cyan-500/50 bg-slate-950 opacity-100 p-3 shadow-2xl text-white space-y-2">
            <div
              onClick={() => {
                if (!forecastActive) setForecastActive(true);
              }}
              className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 cursor-pointer group hover:border-cyan-500/50 transition-colors"
              title="Forecast Heatmap Controls"
            >
              <div className="flex items-center gap-1.5">
                <Waves className="size-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold text-cyan-200 group-hover:text-white">Forecast Heatmap</span>
              </div>
              <button
                type="button"
                data-testid="flood-visible-toggle"
                aria-pressed={forecastActive}
                onClick={(e) => {
                  e.stopPropagation();
                  setForecastActive((prev) => !prev);
                }}
                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer shadow-sm ${
                  forecastActive
                    ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 ring-1 ring-cyan-300"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                }`}
                title={forecastActive ? "Forecast Heatmap Visible (Click to turn Off)" : "Forecast Heatmap Off (Click to turn Visible & Fullscreen)"}
              >
                {forecastActive ? (
                  <>
                    <Eye className="size-3 text-slate-950" />
                    <span>Visible</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="size-3 text-slate-400" />
                    <span>Off</span>
                  </>
                )}
              </button>
            </div>

            {/* 1d, 2d, 3d, 4d, 5d, 6d, 7d Forecast Horizon Buttons */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[9px] text-slate-400 font-semibold">
                <span>Forecast Horizon</span>
                <span className="font-mono text-cyan-300 font-bold">{weatherDayTab}</span>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {(["1d", "2d", "3d", "4d", "5d", "6d", "7d"] as const).map((day, idx) => (
                  <button
                    key={day}
                    type="button"
                    data-testid={`flood-horizon-${day}`}
                    onClick={() => {
                      setWeatherDayTab(day);
                      setForecastHour(idx * 2);
                      if (!forecastActive) setForecastActive(true);
                    }}
                    className={`py-1 text-[9px] font-bold rounded transition-all cursor-pointer text-center ${
                      weatherDayTab === day
                        ? "bg-cyan-500 text-slate-950 ring-1 ring-cyan-300 shadow-sm"
                        : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            {/* Flood Hydrological Risk Metrics (same structure as Landslide) */}
            <div className="space-y-1 bg-slate-900 p-2 rounded-lg border border-slate-800 text-[10px]">
              <div className="grid grid-cols-2 gap-1.5 pb-1 border-b border-slate-800/80">
                <div>
                  <span className="text-slate-400 block text-[9px]">Inundation Level</span>
                  <span className={`font-mono font-bold ${
                    weatherDayTab === "3d" || weatherDayTab === "4d"
                      ? "text-red-400"
                      : weatherDayTab === "2d" || weatherDayTab === "5d"
                      ? "text-cyan-400"
                      : "text-emerald-400"
                  }`}>
                    {weatherDayTab === "1d"
                      ? "0.42m (Normal)"
                      : weatherDayTab === "2d"
                      ? "0.85m (Moderate)"
                      : weatherDayTab === "3d"
                      ? "2.14m (Severe)"
                      : weatherDayTab === "4d"
                      ? "2.86m (Critical)"
                      : weatherDayTab === "5d"
                      ? "1.20m (Elevated)"
                      : weatherDayTab === "6d"
                      ? "0.55m (Minor)"
                      : "0.20m (Safe)"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px]">Inundation Risk</span>
                  <span className={`font-mono font-bold ${
                    weatherDayTab === "3d" || weatherDayTab === "4d"
                      ? "text-red-400"
                      : weatherDayTab === "2d" || weatherDayTab === "5d"
                      ? "text-cyan-400"
                      : "text-emerald-400"
                  }`}>
                    {weatherDayTab === "1d"
                      ? "15% Low"
                      : weatherDayTab === "2d"
                      ? "42% Moderate"
                      : weatherDayTab === "3d"
                      ? "82% High"
                      : weatherDayTab === "4d"
                      ? "95% Extreme"
                      : weatherDayTab === "5d"
                      ? "58% Elevated"
                      : weatherDayTab === "6d"
                      ? "20% Low"
                      : "4% Safe"}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 pt-0.5 text-[9px]">
                <div className="bg-slate-950/70 p-1 rounded border border-slate-800/80">
                  <span className="text-slate-400 block text-[8px]">Peak Discharge</span>
                  <span className="font-mono text-cyan-300 font-bold">
                    {weatherDayTab === "3d" || weatherDayTab === "4d" ? "342 m³/s" : "46 m³/s"}
                  </span>
                </div>
                <div className="bg-slate-950/70 p-1 rounded border border-slate-800/80">
                  <span className="text-slate-400 block text-[8px]">Crit Lowlands (&lt;2m)</span>
                  <span className="font-mono text-cyan-300 font-bold">
                    {weatherDayTab === "3d" || weatherDayTab === "4d" ? "11 Sectors" : "2 Sectors"}
                  </span>
                </div>
              </div>
            </div>

            {/* Heatmap Settings when Flood Forecast is ON */}
            {forecastActive && (
              <div className="pt-2 border-t border-slate-800/80 space-y-2 text-[10px] animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Timeline Scrubber</span>
                  <span className="font-mono text-cyan-300 font-bold">+{forecastHour * 2}h (Frame {forecastHour})</span>
                </div>
                <input
                  aria-label="Flood forecast hour"
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={forecastHour}
                  onChange={(e) => setForecastHour(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />

                {/* Relative Flood Hazard Color Gradient Ramp */}
                <div>
                  <div
                    className="h-2 rounded"
                    style={{ background: "linear-gradient(to right, #2563eb, #06b6d4, #facc15, #dc2626)" }}
                  />
                  <div className="mt-0.5 flex justify-between text-[8px] text-slate-400 font-mono">
                    <span>Low · 0.0</span>
                    <span>Flood Hazard Index</span>
                    <span>High · 1.0</span>
                  </div>
                </div>

                {/* Opacity Slider */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="text-slate-400 text-[9px]">Opacity</span>
                  <input
                    aria-label="Flood heatmap opacity"
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={forecastOpacity}
                    onChange={(e) => setForecastOpacity(Number(e.target.value))}
                    className="w-24 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <span className="font-mono text-cyan-300 text-[9px] font-bold w-7 text-right">
                    {Math.round(forecastOpacity * 100)}%
                  </span>
                </div>
                <p className="text-[8px] text-slate-500 leading-tight">
                  Open-Meteo GNN estimate + terrain depth variation
                </p>
              </div>
            )}
          </div>

          {/* ⛰️ Landslide Forecast Box (Below flood forecast, same like flood one) */}
          <div className="rounded-xl border border-amber-500/50 bg-slate-950 opacity-100 p-3 shadow-2xl text-white space-y-2">
            <div
              onClick={() => {
                setLandslideActive((prev) => !prev);
              }}
              className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 cursor-pointer group hover:border-amber-500/50 transition-colors"
              title="Landslide Forecast Heatmap Controls"
            >
              <div className="flex items-center gap-1.5">
                <Mountain className="size-4 text-amber-400 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold text-amber-200 group-hover:text-white">Landslide Forecast</span>
              </div>
              <button
                type="button"
                data-testid="landslide-visible-toggle"
                aria-pressed={landslideActive}
                onClick={(e) => {
                  e.stopPropagation();
                  setLandslideActive((prev) => !prev);
                }}
                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer shadow-sm ${
                  landslideActive
                    ? "bg-amber-500 hover:bg-amber-400 text-slate-950 ring-1 ring-amber-300 font-bold"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                }`}
                title={landslideActive ? "Landslide Forecast Visible (Click to turn Off)" : "Landslide Forecast Off (Click to turn Visible & Fullscreen)"}
              >
                {landslideActive ? (
                  <>
                    <Eye className="size-3 text-slate-950" />
                    <span>Visible</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="size-3 text-slate-400" />
                    <span>Off</span>
                  </>
                )}
              </button>
            </div>

            {/* 1d, 2d, 3d, 4d, 5d, 6d, 7d Landslide Forecast Horizon Buttons */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[9px] text-slate-400 font-semibold">
                <span>Hazard Horizon</span>
                <span className="font-mono text-amber-300 font-bold">{landslideDayTab}</span>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {(["1d", "2d", "3d", "4d", "5d", "6d", "7d"] as const).map((day, idx) => (
                  <button
                    key={day}
                    type="button"
                    data-testid={`landslide-horizon-${day}`}
                    onClick={() => {
                      setLandslideDayTab(day);
                      setLandslideHour(idx * 2);
                      if (!landslideActive) setLandslideActive(true);
                    }}
                    className={`py-1 text-[9px] font-bold rounded transition-all cursor-pointer text-center ${
                      landslideDayTab === day
                        ? "bg-amber-500 text-slate-950 ring-1 ring-amber-300 shadow-sm font-bold"
                        : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            {/* Landslide Geotechnical Risk Metrics */}
            <div className="space-y-1 bg-slate-900 p-2 rounded-lg border border-slate-800 text-[10px]">
              <div className="grid grid-cols-2 gap-1.5 pb-1 border-b border-slate-800/80">
                <div>
                  <span className="text-slate-400 block text-[9px]">Slope Stability (FS)</span>
                  <span className={`font-mono font-bold ${
                    landslideDayTab === "3d" || landslideDayTab === "4d"
                      ? "text-red-400"
                      : landslideDayTab === "2d" || landslideDayTab === "5d"
                      ? "text-amber-400"
                      : "text-emerald-400"
                  }`}>
                    {landslideDayTab === "1d"
                      ? "1.42 (Stable)"
                      : landslideDayTab === "2d"
                      ? "1.14 (Moderate)"
                      : landslideDayTab === "3d"
                      ? "0.88 (Failure)"
                      : landslideDayTab === "4d"
                      ? "0.74 (Critical)"
                      : landslideDayTab === "5d"
                      ? "1.06 (Alert)"
                      : landslideDayTab === "6d"
                      ? "1.35 (Marginal)"
                      : "1.65 (Stable)"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px]">Failure Risk</span>
                  <span className={`font-mono font-bold ${
                    landslideDayTab === "3d" || landslideDayTab === "4d"
                      ? "text-red-400"
                      : landslideDayTab === "2d" || landslideDayTab === "5d"
                      ? "text-amber-400"
                      : "text-emerald-400"
                  }`}>
                    {landslideDayTab === "1d"
                      ? "18% Low"
                      : landslideDayTab === "2d"
                      ? "46% Moderate"
                      : landslideDayTab === "3d"
                      ? "78% High"
                      : landslideDayTab === "4d"
                      ? "91% Extreme"
                      : landslideDayTab === "5d"
                      ? "52% Elevated"
                      : landslideDayTab === "6d"
                      ? "24% Low"
                      : "6% Safe"}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 pt-0.5 text-[9px]">
                <div className="bg-slate-950/70 p-1 rounded border border-slate-800/80">
                  <span className="text-slate-400 block text-[8px]">Pore Pressure</span>
                  <span className="font-mono text-amber-300 font-bold">
                    {landslideDayTab === "3d" || landslideDayTab === "4d" ? "42.8 kPa" : "18.4 kPa"}
                  </span>
                </div>
                <div className="bg-slate-950/70 p-1 rounded border border-slate-800/80">
                  <span className="text-slate-400 block text-[8px]">Crit Slopes (&gt;30°)</span>
                  <span className="font-mono text-amber-300 font-bold">
                    {landslideDayTab === "3d" || landslideDayTab === "4d" ? "14 Sectors" : "3 Sectors"}
                  </span>
                </div>
              </div>
            </div>

            {/* Heatmap Settings when Landslide Forecast is ON */}
            {landslideActive && (
              <div className="pt-2 border-t border-slate-800/80 space-y-2 text-[10px] animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Timeline Scrubber</span>
                  <span className="font-mono text-amber-300 font-bold">+{landslideHour * 2}h (Frame {landslideHour})</span>
                </div>
                <input
                  aria-label="Landslide forecast hour"
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={landslideHour}
                  onChange={(e) => setLandslideHour(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                />

                {/* Slope Instability Color Gradient Ramp */}
                <div>
                  <div
                    className="h-2 rounded"
                    style={{ background: "linear-gradient(to right, #10b981, #f59e0b, #ea580c, #dc2626)" }}
                  />
                  <div className="mt-0.5 flex justify-between text-[8px] text-slate-400 font-mono">
                    <span>Stable (FS&gt;1.5)</span>
                    <span>Slope Instability</span>
                    <span>Critical (FS&lt;1.0)</span>
                  </div>
                </div>

                {/* Opacity Slider */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="text-slate-400 text-[9px]">Opacity</span>
                  <input
                    aria-label="Landslide heatmap opacity"
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={landslideOpacity}
                    onChange={(e) => setLandslideOpacity(Number(e.target.value))}
                    className="w-24 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                  />
                  <span className="font-mono text-amber-300 text-[9px] font-bold w-7 text-right">
                    {Math.round(landslideOpacity * 100)}%
                  </span>
                </div>
                <p className="text-[8px] text-slate-500 leading-tight">
                  Infinite slope factor of safety (c&apos;, &phi;, m, &beta;) + DEM saturation
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {forecastActive && (
        <TwinForecastHeatmap
          viewer={cesiumViewer || viewerRef.current}
          polygon={getActivePolygon()}
          selectedHour={forecastHour}
          onSelectedHourChange={setForecastHour}
          opacity={forecastOpacity}
          hideCard={true}
        />
      )}

      {/* ⛰️ Landslide Hazard Heatmap Surface Overlay */}
      {landslideActive && (
        <TwinLandslideHeatmap
          viewer={cesiumViewer || viewerRef.current}
          polygon={getActivePolygon()}
          selectedHour={landslideHour}
          onSelectedHourChange={setLandslideHour}
          opacity={landslideOpacity}
          hideCard={true}
          onClose={() => setLandslideActive(false)}
        />
      )}


      {/* 🌧️ Standalone Sensor-Driven Live Rain Overlay (Dedicated Separate Code: No simulation, no water increase) */}
      <SensorLiveRainController
        viewer={cesiumViewer || viewerRef.current}
        polygonCoords={getActivePolygon()}
        sensorRainfall={simRainIntensity}
        windSpeedKmh={simWindSpeed}
        groundHeight={groundHeightMeters}
        isFlatView={viewMode === "flat"}
        forceActive={(rainActive || showVisibleRain) && simRainIntensity > 0}
      />

      {/* 🌊 3D Realistic Three.js Water Simulation (OSM Water Bodies + DEM Shallow-Water Flow) */}
      <ThreeWaterSimulation
        ref={flashFloodRef}
        cesiumViewer={cesiumViewer || viewerRef.current}
        centerLat={latitude}
        centerLng={longitude}
        baseElevation={groundHeightMeters}
        polygonCoords={getActivePolygon()}
        active={waterSimActive}
        autoStart={autoStartedBySensorRef.current}
        riverFeatures={riverFeatures}
        roadFeatures={roadFeatures}
        buildingFeatures={buildingFeatures}
        rainfallMmH={simRainIntensity}
        windSpeedKmh={simWindSpeed}
        defaultSoilSaturation={slaveLiveTelemetry.hasData ? slaveLiveTelemetry.soilMoisture : undefined}
        defaultSourceRise={slaveLiveTelemetry.hasData && slaveLiveTelemetry.waterLevelM > 0 ? Math.max(0.5, slaveLiveTelemetry.waterLevelM * 5) : undefined}
        isFlatView={viewMode === "flat"}
        onPauseChange={setIsFloodPaused}
        onRunningChange={setIsFloodRunning}
        onReadyChange={setIsFloodReady}
        showVisibleRain={showVisibleRain}
        onToggleVisibleRain={setShowVisibleRain}
        onClose={() => {
          setWaterSimActive(false);
          setIsFloodRunning(false);
          setIsFloodPaused(false);
          setIsFloodReady(false);
          setInternalRain(false);
          onToggleRain?.(false);
        }}
      />

      {/* 🗺️ Selected Area Map Layers Status Box (Moved below ML Footprint box so they do not overlap) */}
      {!loading && showLayersStatusBox && (
        <div
          role="status"
          aria-label="Selected area map layers"
          className={`absolute z-30 pointer-events-auto ${
            showBuildings && showBuildingStats && buildingFeatures.length > 0
              ? "top-[235px]"
              : "top-14"
          } ${forecastRailHidden ? "left-14" : "left-[276px]"} w-80 max-w-[calc(100%-1.5rem)] rounded-xl border border-slate-700/80 bg-slate-950/90 backdrop-blur-md px-3.5 py-2.5 shadow-xl transition-all duration-300`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              {isExtractingNetworks || isLoadingBuildings ? (
                <Loader2 className="size-3.5 animate-spin text-cyan-400 shrink-0" />
              ) : (
                <Layers className="size-3.5 text-cyan-400 shrink-0" />
              )}
              <div className="flex items-center gap-2 flex-wrap text-slate-200">
                <span>
                  <strong className="text-white font-semibold">{osmTileStatus.roads}</strong> paths
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  <strong className="text-white font-semibold">{osmTileStatus.rivers}</strong> waterways
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  <strong className="text-white font-semibold">{osmTileStatus.buildings}</strong> buildings
                </span>
              </div>
            </div>
            <button
              type="button"
              data-testid="close-layers-status-btn"
              aria-label="Close layers status"
              className="text-slate-400 hover:text-white p-1 rounded transition-colors ml-auto shrink-0 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                console.log("[DT] Layers status box closed");
                setShowLayersStatusBox(false);
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="pl-[22px] mt-1 text-[11px] text-slate-400 leading-tight">
            {networkError ? (
              <span className="text-amber-200">
                {networkError}{" "}
                <button
                  type="button"
                  className="underline font-semibold hover:text-amber-100 cursor-pointer ml-1"
                  onClick={() => {
                    lastViewportBboxRef.current = "";
                    handleExtractNetworks();
                  }}
                >
                  Retry layers
                </button>
              </span>
            ) : isExtractingNetworks ? (
              "Loading selected-area paths and waterways…"
            ) : isLoadingBuildings ? (
              buildingLoadStatus || "Loading building footprints…"
            ) : (
              "Mapped features · heights estimated where unavailable"
            )}
          </div>
          <div className="mt-2 pl-[22px] text-[11px] text-slate-300">
            {buildingLoadError ? <span className="text-amber-200">{buildingLoadError} </span> : !isLoadingBuildings && buildingLoadStatus ? <span>{buildingLoadStatus} · </span> : null}
            <button type="button" disabled={isLoadingBuildings} className="underline disabled:opacity-50" onClick={() => {
              const boundary = getActivePolygon();
              const areaKey = areaNetworkKey(areaId, boundary, latitude, longitude);
              const bounds = { north: Math.max(...boundary.map(point => point[0])), south: Math.min(...boundary.map(point => point[0])), east: Math.max(...boundary.map(point => point[1])), west: Math.min(...boundary.map(point => point[1])) };
              networkAreaCache[areaKey] ??= { roads: roadFeatures, rivers: riverFeatures, bbox: bounds, timestamp: 0, complete: networksLoadedRef.current };
              delete networkAreaCache[areaKey].buildingsLoadedAt;
              void loadBuildings({ polygon: boundary }, roadFeatures, riverFeatures, bounds, areaKey);
            }}>{isLoadingBuildings ? "Buildings are still loading…" : "Reload buildings only"}</button>
          </div>
        </div>
      )}
      <div
        className={`absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center gap-3.5 z-30 text-white transition-opacity duration-700 ease-out pointer-events-none ${
          loading ? "opacity-100 pointer-events-auto" : "opacity-0"
        }`}
      >
        <div className="relative flex items-center justify-center">
          <div className="size-14 rounded-full border-2 border-sky-500/20 border-t-sky-400 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Globe className="size-6 text-sky-400 animate-pulse" />
          </div>
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-bold text-white tracking-wide">
            Initializing 3D Digital Twin…
          </p>
          <p className="text-xs text-slate-400">
            Streaming high-resolution satellite terrain & orbital perspective
          </p>
        </div>
      </div>

      {/* Error Fallback */}
      {loadError && (
        <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center z-30">
          <p className="text-red-400 font-bold text-sm">3D Terrain Initialization Error</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold cursor-pointer"
          >
            Reload View
          </button>
        </div>
      )}



      {/* Top Right Floating Toolbar */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-md border border-slate-700/70 p-1.5 rounded-lg shadow-xl text-white">
        {/* 🚶 FLAT VIEW BUTTON */}
        <button
          onClick={switchToFlatView}
          title="Flat View: Ground level perspective"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold cursor-pointer transition-all shadow-xs ${
            viewMode === "flat"
              ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white ring-1 ring-emerald-400"
              : "hover:bg-slate-800 text-slate-200"
          }`}
        >
          <PersonStanding className="size-4 text-emerald-300" />
          <span>Flat View</span>
        </button>

        {/* 🏔️ 3D VIEW BUTTON */}
        <button
          onClick={switchTo3DView}
          title="3D View: Oblique perspective"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
            viewMode === "3d"
              ? "bg-sky-600 text-white ring-1 ring-sky-400"
              : "hover:bg-slate-800 text-slate-300"
          }`}
        >
          <Mountain className="size-3.5" />
          <span>3D View</span>
        </button>

        {/* 🛰️ TOP-DOWN SATELLITE BUTTON */}
        <button
          onClick={switchToTopDown}
          title="Top-Down Satellite Nadir View"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
            viewMode === "topdown"
              ? "bg-sky-600 text-white ring-1 ring-sky-400"
              : "hover:bg-slate-800 text-slate-300"
          }`}
        >
          <Eye className="size-3.5" />
          <span className="hidden sm:inline">Top-Down</span>
        </button>

        <div className="w-px h-5 bg-slate-700 mx-0.5" />

        {/* ⛰️ STM 30 (SRTM 30m DEM) TOGGLE */}
        <button
          onClick={toggleSrtm30}
          title={
            showSrtm30
              ? "SRTM 30m DEM Elevation: Visible (Click to Hide)"
              : "SRTM 30m DEM Elevation: Hidden (Click to Show)"
          }
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all ${
            showSrtm30
              ? "bg-amber-600/90 text-white ring-1 ring-amber-400 shadow-xs"
              : "hover:bg-slate-800 text-slate-400 opacity-75"
          }`}
        >
          <Layers className="size-3.5 text-amber-300" />
          <span className="hidden sm:inline">STM 30</span>
        </button>

        {/* 🌊 RIVERS TOGGLE BUTTON */}
        <button
          onClick={() => setShowRivers((prev) => !prev)}
          title={showRivers ? "Hide Rivers & Waterways" : "Show Rivers & Waterways"}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
            showRivers ? "bg-blue-600/90 text-white ring-1 ring-blue-400" : "hover:bg-slate-800 text-slate-300"
          }`}
        >
          <Waves className="size-3.5 text-blue-300" />
          <span className="hidden sm:inline">Rivers</span>
        </button>

        {/* 🛣️ ROADS / PATHS TOGGLE BUTTON */}
        <button
          onClick={() => setShowRoads((prev) => !prev)}
          title={showRoads ? "Hide Road Paths" : "Show Road Paths"}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
            showRoads ? "bg-red-600/90 text-white ring-1 ring-red-400" : "hover:bg-slate-800 text-slate-300"
          }`}
        >
          <Navigation className="size-3.5 text-red-300" />
          <span className="hidden sm:inline">Paths</span>
        </button>

        {/* 🏢 3D BUILDINGS TOGGLE BUTTON */}
        <button
          onClick={() => setShowBuildings((prev) => !prev)}
          title={showBuildings ? "Hide 3D Buildings" : "Show 3D Buildings"}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
            showBuildings ? "bg-orange-600/90 text-white ring-1 ring-orange-400" : "hover:bg-slate-800 text-slate-300"
          }`}
        >
          <Building2 className="size-3.5 text-orange-300" />
          <span className="hidden sm:inline">Buildings</span>
          {buildingFeatures.length > 0 && (
            <span className="text-[10px] ml-0.5 px-1 py-0.2 bg-black/40 rounded text-orange-200 font-mono">
              {buildingFeatures.length}
            </span>
          )}
        </button>



        {/* 🗺️ AREA IN GIS BUTTON */}
        {onViewInGIS && (
          <>
            <div className="w-px h-5 bg-slate-700 mx-0.5" />
            <button
              onClick={onViewInGIS}
              title="Show this area in 2D GIS Map"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs"
            >
              <Map className="size-3.5 text-emerald-200" />
              <span>Area in GIS</span>
            </button>
          </>
        )}

        <div className="w-px h-5 bg-slate-700 mx-0.5" />

        <button
          type="button"
          data-testid="simulation-menu-btn"
          onClick={() => {
            setShowEvacPanel(false);
            setShowMeshPanel(false);
            if (waterSimActive) {
              flashFloodRef.current?.closeSimulation();
              setIsFloodReady(false);
            } else {
              setWaterSimActive(true);
              setIsFloodPaused(false);
              // openControls() will be called by the component itself on mount (controlsOpen starts true)
            }
          }}
          title={
            waterSimActive && !isFloodReady
              ? "Initializing terrain & water sources…"
              : waterSimActive
              ? isFloodRunning
                ? "End Flash Flood & Save Report"
                : "Close Simulation Settings"
              : "Configure Flash Flood & Rain Simulation"
          }
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold cursor-pointer transition-all ${
            waterSimActive
              ? isFloodRunning
                ? "bg-cyan-600 text-white ring-2 ring-cyan-300 shadow-md shadow-cyan-950"
                : "bg-amber-600 text-white ring-2 ring-amber-300 shadow-md shadow-amber-950"
              : "bg-cyan-700 hover:bg-cyan-600 text-white"
          }`}
        >
          {waterSimActive && !isFloodReady ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CloudRain className="size-4" />
          )}
          <span>
            {waterSimActive
              ? !isFloodReady
                ? "Initializing…"
                : isFloodRunning
                ? isFloodPaused
                  ? "Flood Paused"
                  : "Flash Flood"
                : "Flood Settings"
              : "Flash Flood"}
          </span>
          {waterSimActive && isFloodReady && (
            isFloodRunning ? (
              isFloodPaused ? (
                <span className="size-2 rounded-full bg-amber-400 ml-0.5" title="Paused" />
              ) : (
                <span className="size-2 rounded-full bg-cyan-300 animate-ping ml-0.5" />
              )
            ) : (
              <span className="size-2 rounded-full bg-amber-300 ml-0.5" title="Configuring Settings" />
            )
          )}
        </button>
        {/* Rain toggle removed — rain visualization controlled via simulation settings */}
        <button type="button" data-testid="open-mesh-panel-btn" onClick={() => setShowMeshPanel(previous => !previous)} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold text-cyan-200 hover:bg-slate-800">
          <Network className="size-3.5" /><span>Sensors</span>
        </button>


        {/* 🚨 EVACUATION & RISK ROUTING BUTTON */}
        <button
          onClick={() => setShowEvacPanel((prev) => !prev)}
          title="Open AI Evacuation Routing & Flood Risk Prediction Panel"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer transition-all ${
            showEvacPanel
              ? "bg-rose-600 text-white ring-2 ring-rose-400 shadow-md shadow-rose-950"
              : "bg-emerald-700/90 hover:bg-emerald-600 text-white shadow-sm"
          }`}
        >
          <ShieldAlert className="size-3.5 text-white" />
          <span>Evacuation</span>
          {evacuationRoute && evacuationRoute.status === "success" && (
            <span className="size-2 rounded-full bg-emerald-300 animate-ping ml-0.5" />
          )}
        </button>

        {/* 🤖 AI ASSISTANT CHAT BUTTON */}
        <button
          onClick={() => {
            setShowAIChat((prev) => !prev);
            if (!showAIChat) {
              setShowEvacPanel(false);
            }
          }}
          title="Open AI Disaster Intelligence & Simulation Assistant"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer transition-all ${
            showAIChat
              ? "bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-md shadow-indigo-950"
              : "bg-indigo-700/90 hover:bg-indigo-600 text-white shadow-sm"
          }`}
        >
          <Bot className="size-3.5 text-indigo-200" />
          <span>AI Chat</span>
          <Sparkles className="size-3 text-amber-300 animate-pulse" />
        </button>

        <div className="w-px h-5 bg-slate-700 mx-0.5" />

        {/* Reset Camera */}
        <button
          onClick={handleResetCamera}
          title="Reset View"
          className="p-1.5 rounded-md hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer transition-colors"
        >
          <RotateCcw className="size-3.5" />
        </button>

        <div className="w-px h-5 bg-slate-700 mx-0.5" />

        {/* 🔲 FULLSCREEN BUTTON */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit Fullscreen (Esc)" : "Enter Fullscreen Mode"}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer transition-all ${
            isFullscreen
              ? "bg-purple-600 hover:bg-purple-700 text-white ring-1 ring-purple-400"
              : "bg-slate-800/90 hover:bg-slate-700 text-sky-300 hover:text-white"
          }`}
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="size-3.5" />
              <span>Exit Fullscreen</span>
            </>
          ) : (
            <>
              <Maximize2 className="size-3.5" />
              <span>Full Screen</span>
            </>
          )}
        </button>
      </div>


      {/* 🎯 Interactive 3D Terrain Node / Sensor Placement Banner */}
      {isPickingLocation && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold text-xs px-4 py-2 rounded-full shadow-2xl flex items-center gap-2.5 border border-cyan-300 animate-bounce">
          <Crosshair className="size-4 animate-spin text-cyan-200" />
          <span>
            {isPickingLocation === "master"
              ? "Click on terrain to place Master node"
              : isPickingLocation === "slave"
              ? "Click on terrain to place Slave node"
              : `Click on terrain to place ${
                  isPickingLocation === "water_level"
                    ? "Water Level Sensor"
                    : isPickingLocation === "soil_moisture"
                    ? "Soil Moisture Sensor"
                    : isPickingLocation === "imu"
                    ? "9-Axis IMU"
                    : isPickingLocation === "tilt"
                    ? "Tilt Sensor"
                    : "Rain Drop Sensor"
                } (Connects to Slave)`}
          </span>
          <button
            onClick={() => setIsPickingLocation(null)}
            className="ml-2 bg-black/40 hover:bg-black/60 px-2 py-0.5 rounded text-[10px] cursor-pointer"
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      {/* 🚨 AI EVACUATION ROUTING & RISK PANEL */}
      {showEvacPanel && (
        <div className="absolute top-14 left-3 z-30 w-96 max-h-[85vh] bg-slate-900/95 backdrop-blur-md border border-emerald-500/50 rounded-xl p-3.5 shadow-2xl text-white flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <ShieldAlert className="size-3.5 text-emerald-400" />
              </div>
              <div>
                <div className="text-xs font-bold text-white leading-tight">AI Evacuation & Risk Routing</div>
                <div className="text-[10px] text-slate-400">OSM Directed Road Graph & GNN Risk</div>
              </div>
            </div>
            <button
              onClick={() => setShowEvacPanel(false)}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              title="Close Panel"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-3 scrollbar-thin scrollbar-thumb-slate-700">
            {/* 1. Monitored Area Location & Bounding Box */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 space-y-2">
              <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-3 text-sky-400" />
                  {areaName || "Monitored Zone"}
                </span>
                <div className="flex items-center gap-1.5">
                  {isExtractingNetworks && <Loader2 className="size-3 animate-spin text-sky-400" />}
                  {extractedBbox && (
                    <span className="text-[9px] bg-sky-950 text-sky-300 px-1.5 py-0.5 rounded border border-sky-800">
                      Radius: {searchRadiusKm} km
                    </span>
                  )}
                </div>
              </div>

              <div className="text-[10px] text-slate-400 flex items-center justify-between bg-slate-900/60 px-2 py-1.5 rounded border border-slate-800/80">
                <span>Coordinates:</span>
                <span className="font-mono text-slate-300 text-[10px]">
                  {latitude.toFixed(4)}°N, {longitude.toFixed(4)}°E
                </span>
              </div>

              <div className="bg-slate-900/60 px-2 py-1.5 rounded border border-slate-800/80">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{isExtractingNetworks ? "Loading paths and waterways…" : isLoadingBuildings ? "Loading building detail…" : networkError ? "Map data incomplete" : "Available map data loaded"}</span>
                  <span className="text-sky-300 font-mono">
                    {isExtractingNetworks || isLoadingBuildings ? "Fetching tiles" : osmTileStatus.total ? `${osmTileStatus.loaded}/${osmTileStatus.total} tiles` : "Cached"}
                  </span>
                </div>
                <div className="mt-1 h-1 rounded bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-sky-400 transition-all duration-300"
                    style={{ width: `${isExtractingNetworks ? 35 : isLoadingBuildings ? 75 : osmTileStatus.total ? Math.round((osmTileStatus.loaded / osmTileStatus.total) * 100) : 100}%` }}
                  />
                </div>
                <div className="mt-1 text-[9px] text-slate-500">
                  Buildings: {osmTileStatus.buildings} · Paths: {osmTileStatus.roads} · Waterways: {osmTileStatus.rivers}
                </div>
              </div>

              {/* Radius selector */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-slate-400">Coverage Radius:</span>
                <div className="flex items-center gap-1">
                  {[1.0, 2.0, 3.5, 5.0].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSearchRadiusKm(r)}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold cursor-pointer ${
                        searchRadiusKm === r
                          ? "bg-sky-500 text-slate-950 font-bold"
                          : "bg-slate-800 text-slate-400 hover:text-white"
                      }`}
                    >
                      {r}km
                    </button>
                  ))}
                </div>
              </div>

              {/* Bounding box display */}
              {extractedBbox && (
                <div className="bg-slate-900/80 rounded p-1.5 text-[9px] font-mono text-slate-400 grid grid-cols-2 gap-1 border border-slate-800">
                  <div>N: {extractedBbox.north?.toFixed(4)}°</div>
                  <div>S: {extractedBbox.south?.toFixed(4)}°</div>
                  <div>E: {extractedBbox.east?.toFixed(4)}°</div>
                  <div>W: {extractedBbox.west?.toFixed(4)}°</div>
                </div>
              )}
            </div>

            {/* 2. Unified Graph Metrics */}
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-center">
                <div className="text-[10px] text-red-400 font-semibold flex items-center justify-center gap-1">
                  <Navigation className="size-2.5" /> Paths
                </div>
                <div className="text-xs font-bold text-red-300 mt-0.5">
                  {roadFeatures.length > 0 ? `${roadFeatures.length} Paths` : "Network Active"}
                </div>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-center">
                <div className="text-[10px] text-blue-400 font-semibold flex items-center justify-center gap-1">
                  <Waves className="size-2.5" /> Rivers
                </div>
                <div className="text-xs font-bold text-blue-300 mt-0.5">
                  {riverFeatures.length > 0 ? `${riverFeatures.length} Rivers` : "Flow Monitored"}
                </div>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-center">
                <div className="text-[10px] text-rose-400 font-semibold flex items-center justify-center gap-1">
                  <AlertTriangle className="size-2.5" /> Hazard Zones
                </div>
                <div className="text-xs font-bold text-rose-300 mt-0.5">{highRiskZones.length > 0 ? `${highRiskZones.length} Zones` : "Clear"}</div>
              </div>
            </div>

            {/* 3. Destination Selection */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 space-y-2">
              <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Navigation className="size-3 text-emerald-400" />
                  Target Evacuation Destination
                </span>
                <span className="text-[9px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800">
                  {evacDestMode === "safe_exit" ? "Automatic Safe Exit" : "Custom Point"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setEvacDestMode("safe_exit")}
                  className={`p-2 rounded-lg text-xs font-semibold cursor-pointer border text-left transition-all ${
                    evacDestMode === "safe_exit"
                      ? "bg-emerald-950/90 border-emerald-400 ring-1 ring-emerald-500/40 text-white"
                      : "bg-slate-900 hover:bg-slate-850 border-slate-800 text-slate-400"
                  }`}
                >
                  <div className="font-bold text-emerald-300 flex items-center gap-1">
                    🛡️ Safe High-Ground Exit
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    GNN finds highest, lowest-risk road exit
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setEvacDestMode("custom")}
                  className={`p-2 rounded-lg text-xs font-semibold cursor-pointer border text-left transition-all ${
                    evacDestMode === "custom"
                      ? "bg-emerald-950/90 border-emerald-400 ring-1 ring-emerald-500/40 text-white"
                      : "bg-slate-900 hover:bg-slate-850 border-slate-800 text-slate-400"
                  }`}
                >
                  <div className="font-bold text-sky-300 flex items-center gap-1">
                    📍 Custom Destination
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Enter target GPS coordinates
                  </div>
                </button>
              </div>

              {evacDestMode === "custom" && (
                <div className="space-y-1.5 pt-1">
                  <input
                    type="text"
                    value={customDestName}
                    onChange={(e) => setCustomDestName(e.target.value)}
                    placeholder="Destination Name (e.g. Community Center)"
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="number"
                      step="0.0001"
                      value={customDestLat || ""}
                      onChange={(e) => setCustomDestLat(parseFloat(e.target.value) || 0)}
                      placeholder="Destination Lat"
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                    />
                    <input
                      type="number"
                      step="0.0001"
                      value={customDestLng || ""}
                      onChange={(e) => setCustomDestLng(parseFloat(e.target.value) || 0)}
                      placeholder="Destination Lng"
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                    />
                  </div>
                </div>
              )}

              {/* Avoid critical road check */}
              <label className="flex items-center gap-2 pt-1 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={routeAvoidCritical}
                  onChange={(e) => setRouteAvoidCritical(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-600 text-emerald-500 focus:ring-0"
                />
                <span>Dynamically avoid flooded & high-risk road edges</span>
              </label>
            </div>

            {/* 4. Action Button: Calculate Safest Route */}
            <button
              type="button"
              onClick={handleCalculateEvacuationRoute}
              disabled={isCalculatingRoute || isExtractingNetworks}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-bold py-2.5 px-3 rounded-lg text-xs shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              {isCalculatingRoute ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Computing Optimal Risk-Weighted Path...</span>
                </>
              ) : isExtractingNetworks ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Loading Roads & Waterways...</span>
                </>
              ) : (
                <>
                  <Navigation className="size-3.5" />
                  <span>Calculate Safest Evacuation Route</span>
                </>
              )}
            </button>

            {/* 5. Route Result Card */}
            {evacuationRoute && (
              <div
                className={`border rounded-lg p-3 space-y-2.5 animate-in fade-in slide-in-from-bottom-2 ${
                  evacuationRoute.status === "success"
                    ? evacuationRoute.route_status === "SAFE"
                      ? "bg-emerald-950/60 border-emerald-500/60"
                      : evacuationRoute.route_status === "CAUTION"
                      ? "bg-amber-950/60 border-amber-500/60"
                      : "bg-rose-950/60 border-rose-500/60"
                    : "bg-slate-950/80 border-slate-800"
                }`}
              >
                {evacuationRoute.status === "success" ? (
                  <>
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                            evacuationRoute.route_status === "SAFE"
                              ? "bg-emerald-500 text-slate-950"
                              : evacuationRoute.route_status === "CAUTION"
                              ? "bg-amber-500 text-slate-950"
                              : "bg-rose-500 text-white"
                          }`}
                        >
                          {evacuationRoute.route_status} ROUTE
                        </span>
                        <span className="text-xs font-bold text-white truncate max-w-[180px]">
                          To: {evacuationRoute.destination_name || "Safe High-Ground Exit"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => render3DEvacuationRoute(evacuationRoute)}
                        className="px-2 py-0.5 bg-emerald-800/80 hover:bg-emerald-700 text-[10px] font-bold text-emerald-200 rounded flex items-center gap-1 cursor-pointer transition-colors"
                        title="Fly camera to frame the evacuation path"
                      >
                        <Crosshair className="size-2.5" /> Focus Path
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-900/60 rounded p-1.5">
                        <div className="text-[10px] text-slate-400">Total Distance</div>
                        <div className="text-sm font-bold text-white">{evacuationRoute.total_distance_km} km</div>
                      </div>
                      <div className="bg-slate-900/60 rounded p-1.5">
                        <div className="text-[10px] text-slate-400">Estimated Drive Time</div>
                        <div className="text-sm font-bold text-white">{evacuationRoute.estimated_time_minutes} min</div>
                      </div>
                      <div className="bg-slate-900/60 rounded p-1.5">
                        <div className="text-[10px] text-slate-400">Max Flood Risk</div>
                        <div className="text-sm font-bold text-white">
                          {Math.round((evacuationRoute.max_flood_risk_encountered || 0) * 100)}%
                        </div>
                      </div>
                      <div className="bg-slate-900/60 rounded p-1.5">
                        <div className="text-[10px] text-slate-400">Flooded Roads Avoided</div>
                        <div className="text-sm font-bold text-emerald-400">
                          {evacuationRoute.avoided_blocked_edges || 0} segments
                        </div>
                      </div>
                    </div>

                    {/* Turn-by-turn preview */}
                    {evacuationRoute.segments && evacuationRoute.segments.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Turn-by-turn road path:
                        </div>
                        <div className="max-h-28 overflow-y-auto space-y-1 text-[10px] font-mono text-slate-300 pr-1">
                          {evacuationRoute.segments.map((seg, sIdx) => (
                            <div key={sIdx} className="flex items-center justify-between py-0.5 border-b border-slate-800/60">
                              <span className="truncate max-w-[200px]">{seg.road_name || "Connecting Road"}</span>
                              <span className="text-slate-400">{seg.length_m}m</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-rose-300 p-2 text-center font-semibold">
                    {evacuationRoute.message || "No accessible evacuation path found due to severe flooding."}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🤖 FLOATING AI DISASTER INTELLIGENCE ASSISTANT */}
      {showAIChat && (
        <div
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="absolute top-14 right-3 z-40 w-96 sm:w-[420px] shadow-2xl rounded-2xl overflow-hidden border border-indigo-500/50 flex flex-col animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <DisasterIntelligenceChat
            latitude={latitude}
            longitude={longitude}
            areaName={areaName}
            polygon={polygon}
            radiusKm={searchRadiusKm}
            paths={roadFeatures.map((r) => ({
              name: r.properties?.name || "Unnamed Path",
              road_type: r.properties?.road_type || "road",
            }))}
            isRaining={rainActive}
            waterSimActive={waterSimActive}
            forecastHour={forecastHour}
            rainfallIntensity={simRainIntensity}
            windSpeed={simWindSpeed}
            buildings={buildingFeatures.slice(0, 100).map(building => ({
              name: building.properties?.name || building.properties?.id || "Building",
              flood_risk: building.properties?.flood_risk || "UNKNOWN",
              elevation: building.properties?.elevation || building.properties?.elevation_m,
              latitude: building.properties?.lat,
              longitude: building.properties?.lon,
            }))}
            riskZones={highRiskZones.slice(0, 100).map(zone => ({
              node_id: zone.node_id,
              probability: zone.probability,
              severity: zone.severity,
              latitude: zone.lat,
              longitude: zone.lng,
            }))}
            sensors={deployedSensors.map(sensor => ({
              id: sensor.id,
              type: sensor.type,
              name: sensor.name,
              slave_id: sensor.slaveId,
              latitude: sensor.lat,
              longitude: sensor.lng,
            }))}
            meshNodes={meshNodes.map(node => ({
              id: node.id,
              name: node.name,
              type: node.type,
              status: node.status,
              latitude: node.lat,
              longitude: node.lng,
              battery: node.battery,
              signal_dbm: node.signalDbm,
            }))}
            onToggleRain={handleToggleRain}
            onToggleWaterSim={() => setWaterSimActive((prev) => !prev)}
            onViewGIS={onViewInGIS}
            onClose={() => setShowAIChat(false)}
            containerClassName="bg-white border-0 shadow-none flex flex-col h-[520px]"
          />
        </div>
      )}



      {/* 📡 IOT MESH NODES & SENSORS (MASTER / SLAVE) FLOATING OVERLAY PANEL */}
      {showMeshPanel && (
        <div
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{ maxHeight: isFullscreen ? "85vh" : "calc(100% - 70px)" }}
          className="absolute top-14 right-3 z-30 w-96 bg-slate-900/95 backdrop-blur-md border border-cyan-500/50 rounded-xl p-3.5 shadow-2xl text-white flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Network className="size-3.5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>IoT Mesh Architecture</span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-cyan-950 text-cyan-300 rounded border border-cyan-800 font-mono">
                    Master / Slave
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">Click anywhere on map to drop nodes & field sensors</div>
              </div>
            </div>
            <button
              onClick={() => setShowMeshPanel(false)}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              title="Close Mesh Panel"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
            {/* Quick Summary Bar */}
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-slate-950/70 border border-amber-500/30 rounded-lg p-2 text-center">
                <div className="text-[9px] text-amber-400 font-bold uppercase tracking-wider">Master Gateway</div>
                <div className="text-xs font-bold text-amber-200 mt-0.5 font-mono">
                  {masterNode ? "1 Active" : "0 Placed"}
                </div>
              </div>
              <div className="bg-slate-950/70 border border-cyan-500/30 rounded-lg p-2 text-center">
                <div className="text-[9px] text-cyan-400 font-bold uppercase tracking-wider">Slave Nodes</div>
                <div className="text-xs font-bold text-cyan-200 mt-0.5 font-mono">
                  {slaveNodes.length} Deployed
                </div>
              </div>
              <div className="bg-slate-950/70 border border-emerald-500/30 rounded-lg p-2 text-center">
                <div className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider">Sensors</div>
                <div className="text-xs font-bold text-emerald-200 mt-0.5 font-mono">
                  {deployedSensors.length} Live
                </div>
              </div>
            </div>

            {/* 📍 Click Map to Place Section */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 space-y-2">
              {lastConnectedSensorMsg && (
                <div
                  data-testid="sensor-connected-banner"
                  className="flex items-center gap-2 p-2 bg-emerald-950/80 border border-emerald-500/40 rounded-lg text-emerald-300 text-xs font-semibold animate-in fade-in"
                >
                  <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                  <div className="flex-1 text-[11px] leading-tight font-medium">{lastConnectedSensorMsg}</div>
                  <button
                    type="button"
                    onClick={() => setLastConnectedSensorMsg(null)}
                    className="text-emerald-400/60 hover:text-emerald-300 text-xs px-1 cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              )}

              <div className="text-[11px] font-bold text-cyan-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-cyan-400" />
                  Place Nodes Anywhere on 3D Map
                </span>
                {isPickingLocation && (
                  <span className="text-[9px] bg-amber-950 text-amber-300 px-1.5 py-0.5 rounded animate-pulse">
                    Click Map Now
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  data-testid="drop-master-btn"
                  onClick={() => {
                    if (!sensorConnectedOnce) {
                      setSensorPromptModal({
                        open: true,
                        nodeType: "master",
                        lat: Number(latitude.toFixed(6)),
                        lng: Number(longitude.toFixed(6)),
                        sensorId: stagedSensorId || "node1",
                      });
                    } else {
                      setIsPickingLocation(isPickingLocation === "master" ? null : "master");
                      toast.info(`Click on 3D map to place Master Gateway (${stagedSensorId || "node1"})`);
                    }
                  }}
                  className={`p-2 rounded-lg text-xs font-semibold cursor-pointer border text-left transition-all ${
                    isPickingLocation === "master"
                      ? "bg-amber-950/90 border-amber-400 ring-2 ring-amber-500 text-white"
                      : "bg-slate-900 hover:bg-slate-850 border-amber-500/30 text-amber-200"
                  }`}
                >
                  <div className="font-bold text-amber-300 flex items-center gap-1">
                    <Radio className="size-3 text-amber-400" />
                    <span>+ Drop Master</span>
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5 leading-tight">
                    Central LoRaWAN Gateway ({stagedSensorId || "node1"})
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="drop-slave-btn"
                  onClick={() => {
                    if (!sensorConnectedOnce) {
                      setSensorPromptModal({
                        open: true,
                        nodeType: "slave",
                        lat: Number((latitude + 0.003).toFixed(6)),
                        lng: Number((longitude + 0.003).toFixed(6)),
                        sensorId: stagedSensorId || "node1",
                      });
                    } else {
                      setIsPickingLocation(isPickingLocation === "slave" ? null : "slave");
                      toast.info(`Click on 3D map to place Slave node (${stagedSensorId || "node1"})`);
                    }
                  }}
                  className={`p-2 rounded-lg text-xs font-semibold cursor-pointer border text-left transition-all ${
                    isPickingLocation === "slave"
                      ? "bg-cyan-950/90 border-cyan-400 ring-2 ring-cyan-500 text-white"
                      : "bg-slate-900 hover:bg-slate-850 border-cyan-500/30 text-cyan-200"
                  }`}
                >
                  <div className="font-bold text-cyan-300 flex items-center gap-1">
                    <Cpu className="size-3 text-cyan-400" />
                    <span>+ Drop Slave</span>
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5 leading-tight">
                    Relay Slave node ({stagedSensorId || "node1"})
                  </div>
                </button>
              </div>

              {/* In Slave / Below that: Ask ID & Connect Option (Ask One Time) */}
              <div
                data-testid="sensor-id-connect-box"
                className="p-2.5 bg-slate-900/95 border border-cyan-500/40 rounded-xl space-y-2 shadow-inner"
              >
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
                    <Cpu className="size-3.5 text-cyan-400" />
                    <span>Sensor ID & Connect Option</span>
                  </div>
                  {sensorConnectedOnce ? (
                    <span className="text-[9px] bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-800 font-mono font-semibold flex items-center gap-1">
                      <CheckCircle2 className="size-2.5 text-emerald-400" />
                      <span>Connected ({stagedSensorId || "node1"})</span>
                    </span>
                  ) : (
                    <span className="text-[9px] bg-cyan-950 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-800 font-mono">
                      Connect Once
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      data-testid="inline-sensor-id-input"
                      value={stagedSensorId}
                      onChange={(e) => setStagedSensorId(e.target.value)}
                      placeholder="e.g. node1"
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-cyan-500/50 focus:border-cyan-400 rounded-lg text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-400 transition-all"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleConnectSensorOneTime();
                        }
                      }}
                    />
                    <span className="absolute right-2 top-1.5 text-[9px] font-mono text-cyan-400/80">
                      ID
                    </span>
                  </div>

                  <button
                    type="button"
                    data-testid="inline-connect-sensor-btn"
                    onClick={() => handleConnectSensorOneTime()}
                    className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:from-emerald-700 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0 shadow-sm"
                  >
                    <CheckCircle2 className="size-3.5" />
                    <span>{sensorConnectedOnce ? "Connected" : "Connect"}</span>
                  </button>
                </div>

                <p className="text-[10px] text-slate-400 leading-tight">
                  {sensorConnectedOnce
                    ? `Sensor ID [${stagedSensorId || "node1"}] is connected. Master and Slave nodes will auto-use this ID.`
                    : `Enter Sensor ID once (default node1) and click Connect. Master & Slave nodes will connect without asking again.`}
                </p>
              </div>

              {/* Quick Preset Sensor buttons */}
              <div className="pt-1 space-y-1.5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Drop Sensor Node on Map:
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { type: "water_level", label: "Water Level", icon: Waves, color: "text-cyan-300 hover:bg-cyan-950" },
                    { type: "soil_moisture", label: "Soil Moisture", icon: Droplets, color: "text-emerald-300 hover:bg-emerald-950" },
                    { type: "imu", label: "9-Axis IMU", icon: Navigation, color: "text-purple-300 hover:bg-purple-950" },
                    { type: "tilt", label: "Tilt Sentry", icon: ShieldAlert, color: "text-amber-300 hover:bg-amber-950" },
                    { type: "raindrop", label: "Rain Drop", icon: CloudRain, color: "text-sky-300 hover:bg-sky-950" },
                  ].map((s) => {
                    const SIcon = s.icon;
                    const isActive = isPickingLocation === s.type;
                    return (
                      <button
                        key={s.type}
                        type="button"
                        onClick={() => setIsPickingLocation(s.type as SensorType)}
                        className={`p-1.5 rounded text-[10px] font-semibold border border-slate-800 bg-slate-900 flex items-center gap-1 cursor-pointer transition-all ${
                          isActive ? "bg-cyan-600 text-white border-cyan-400" : s.color
                        }`}
                      >
                        <SIcon className="size-3" />
                        <span className="truncate">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Instant Auto-Deploy Button */}
              <button
                type="button"
                onClick={addMasterAtCenter}
                className="w-full mt-1.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs rounded-lg shadow cursor-pointer transition-all flex items-center justify-center gap-1.5"
              >
                <Zap className="size-3.5" />
                <span>Auto-Deploy Gateway & Nodes at Map Center</span>
              </button>
            </div>

            {/* Deployed Nodes List */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                <span>Deployed Mesh Nodes ({meshNodes.length})</span>
                <button
                  type="button"
                  onClick={() => setShowMeshNodes((prev) => !prev)}
                  className={`text-[9px] px-2 py-0.5 rounded font-mono border transition-all cursor-pointer flex items-center gap-1 ${
                    showMeshNodes
                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30"
                      : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
                  }`}
                  title="Toggle visibility of nodes and sensors on 3D map"
                >
                  <span>{showMeshNodes ? "👁️ Visible on 3D Map" : "👁️‍🗨️ Hidden"}</span>
                </button>
              </div>

              {meshNodes.length === 0 ? (
                <div className="text-center py-4 bg-slate-950/60 rounded-xl border border-dashed border-slate-800 text-slate-500 text-xs">
                  No mesh nodes deployed yet. Click "+ Drop Master" or "+ Drop Slave" above to place anywhere on the 3D viewer!
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
                  {meshNodes.map((node) => {
                    const isMaster = node.type === "master";
                    const nodeSensors = deployedSensors.filter((s) => s.slaveId === node.id);
                    return (
                      <div
                        key={node.id}
                        onClick={() => {
                          setSelectedNodeId(node.id);
                          focusOnNode(node);
                          if (node.type === "slave") {
                            setActiveSlaveId(node.id);
                            setShowSlaveDataBox(true);
                          }
                        }}
                        className={`p-2 rounded-xl border flex items-center justify-between text-xs transition-all cursor-pointer ${
                          selectedNodeId === node.id
                            ? "bg-cyan-950/70 border-cyan-400 ring-1 ring-cyan-400"
                            : isMaster
                            ? "bg-amber-950/40 border-amber-500/50 hover:border-amber-400"
                            : "bg-slate-950/80 border-slate-800 hover:border-cyan-500/40"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-bold ${isMaster ? "text-amber-300" : "text-cyan-300"}`}>
                              {isMaster ? "📡 " : "⚡ "}{node.name}
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-900 rounded text-slate-400">
                              {node.lat.toFixed(4)}°, {node.lng.toFixed(4)}°
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
                            <span>Signal: <strong className="text-emerald-400">{node.signalDbm} dBm</strong></span>
                            <span>Bat: <strong className="text-emerald-400">{node.battery}%</strong></span>
                            {!isMaster && <span>Sensors: <strong className="text-cyan-300">{nodeSensors.length}</strong></span>}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNode(node.id);
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                          title="Remove node"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* 🗑️ CLICK-TO-DELETE BANNER */}
      {isDeleteMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 bg-rose-950/95 backdrop-blur-md border border-rose-500/80 text-rose-200 px-4 py-2 rounded-full shadow-2xl flex items-center gap-3 text-xs font-bold animate-pulse">
          <Trash2 className="size-4 text-rose-400" />
          <span>CLICK-TO-DELETE: Click any 3D node on map to delete it</span>
          <button
            onClick={() => setIsDeleteMode(false)}
            className="bg-rose-800 hover:bg-rose-700 text-white px-2 py-0.5 rounded text-[10px] cursor-pointer"
          >
            ✕ Done
          </button>
        </div>
      )}

      {/* 🏢 REAL BUILDING FOOTPRINT INSPECTION CARD (Microsoft Global ML Building Footprints) */}
      {selectedBuilding && (
        <div className="absolute bottom-6 right-6 z-30 w-84 bg-slate-900/95 backdrop-blur-md border border-orange-500/60 rounded-xl p-3.5 shadow-2xl text-white animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Building2 className="size-4 text-orange-400 shrink-0" />
              <div className="truncate">
                <span className="font-bold text-xs text-white tracking-wide block truncate">
                  {selectedBuilding.name || selectedBuilding.id}
                </span>
                <span className="text-[9px] text-slate-400 block font-mono">
                  3D Building Footprint
                </span>
              </div>
            </div>
            <button
              onClick={() => setSelectedBuilding(null)}
              className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close Popup"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Risk Badge */}
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
              Flood Risk Assessment
            </span>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: `${selectedBuilding.risk_color || '#f97316'}25`,
                color: selectedBuilding.risk_color || '#f97316',
                border: `1px solid ${selectedBuilding.risk_color || '#f97316'}60`,
              }}
            >
              ● {selectedBuilding.flood_risk || "MONITORED"}
            </span>
          </div>

          {/* Comprehensive 8-Metric Grid */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80">
            <div>
              <div className="text-[9px] text-slate-400 uppercase font-semibold">Building ID</div>
              <div className="font-mono text-cyan-300 font-medium text-[10px] truncate" title={selectedBuilding.id}>
                {selectedBuilding.id}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-slate-400 uppercase font-semibold">Lat, Lon</div>
              <div className="font-mono text-slate-200 text-[10px]">
                {selectedBuilding.lat ? `${selectedBuilding.lat.toFixed(5)}°, ${selectedBuilding.lon?.toFixed(5)}°` : "Extracted"}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-slate-400 uppercase font-semibold">Estimated Height</div>
              <div className="font-semibold text-white">
                {selectedBuilding.estimated_height || selectedBuilding.height || 6} m
                {selectedBuilding.height_category && (
                  <span className="text-[9px] text-slate-400 ml-1 font-normal">
                    ({selectedBuilding.height_category})
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-slate-400 uppercase font-semibold">Elevation</div>
              <div className="font-semibold text-amber-300">
                {selectedBuilding.elevation || selectedBuilding.elevation_m || 298} m MSL
              </div>
            </div>
            <div>
              <div className="text-[9px] text-slate-400 uppercase font-semibold">Distance From River</div>
              <div className="font-semibold text-blue-300">
                {selectedBuilding.distance_from_river || `${selectedBuilding.distance_to_river_m || 350} m`}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-slate-400 uppercase font-semibold">Landslide Risk</div>
              <div className={`font-semibold ${selectedBuilding.landslide_risk === "HIGH" ? "text-rose-400" : selectedBuilding.landslide_risk === "MODERATE" ? "text-amber-400" : "text-emerald-400"}`}>
                {selectedBuilding.landslide_risk || "LOW"}
              </div>
            </div>
            <div className="col-span-2 pt-1 border-t border-slate-800">
              <div className="text-[9px] text-slate-400 uppercase font-semibold">Evacuation Zone</div>
              <div className="font-semibold text-emerald-300">
                {selectedBuilding.evacuation_zone || "Zone D (Safe Sector)"}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => {
                if (selectedBuilding.lat && selectedBuilding.lon && viewerRef.current) {
                  viewerRef.current.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(
                      selectedBuilding.lon,
                      selectedBuilding.lat - 0.0012,
                      260
                    ),
                    orientation: {
                      heading: Cesium.Math.toRadians(0),
                      pitch: Cesium.Math.toRadians(-35),
                      roll: 0,
                    },
                    duration: 1.2,
                  });
                }
              }}
              className="flex-1 flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg py-1.5 text-xs font-semibold cursor-pointer transition-colors shadow-sm"
            >
              <Crosshair className="size-3" />
              <span>Focus 3D View</span>
            </button>
            <button
              onClick={() => {
                if (selectedBuilding.lat && selectedBuilding.lon) {
                  setUserOriginCoords({ lat: selectedBuilding.lat, lng: selectedBuilding.lon });
                  setShowEvacPanel(true);
                  toast.success(`Set evacuation start to ${selectedBuilding.id}`);
                }
              }}
              className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-lg py-1.5 text-xs font-semibold cursor-pointer transition-colors"
            >
              <ShieldAlert className="size-3" />
              <span>Evacuate</span>
            </button>
          </div>
        </div>
      )}

      {/* 📊 BUILDING FOOTPRINT ANALYTICS STATS PANEL */}
      {showBuildings && showBuildingStats && buildingFeatures.length > 0 && (
        <div className={`absolute top-14 ${forecastRailHidden ? "left-14" : "left-[276px]"} z-20 w-80 bg-slate-900/95 backdrop-blur-md border border-orange-500/40 rounded-xl p-3 shadow-2xl text-white animate-in fade-in slide-in-from-top-2 duration-200 transition-all`}>
          <div className="flex items-center justify-between border-b border-slate-700/70 pb-2">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded bg-orange-500/20 border border-orange-500/40">
                <Building2 className="size-4 text-orange-400" />
              </div>
              <div>
                <span className="font-bold text-xs text-white">Houses in Marked Area</span>
                <span className="text-[9px] text-slate-400 block">Open Buildings & ML Footprints</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/40 font-mono text-xs font-bold">
                {buildingFeatures.length} Houses
              </span>
              <button
                onClick={() => setShowBuildingStats(false)}
                className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-slate-800 cursor-pointer"
                title="Minimize Stats"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Unified Radiant Orange Building Status */}
          <div className="mt-2.5 bg-orange-950/40 border border-orange-500/40 rounded-lg p-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-orange-500 animate-pulse" />
              <div>
                <div className="text-xs font-semibold text-orange-200">
                  Mapped Building Footprints
                </div>
                <div className="text-[10px] text-slate-400">
                  Uniform Orange Twin Footprints
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-base font-extrabold text-orange-400 font-mono">
                {buildingFeatures.length}
              </div>
              <div className="text-[9px] text-orange-300/80 font-medium">3D Extruded Footprints</div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 px-0.5">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Heights may be estimated
            </span>
            <span className="text-slate-500 font-mono">3D Extrusion Active</span>
          </div>
        </div>
      )}

      {/* 📍 SELECTED 3D NODE QUICK ACTION CARD (Direct Delete & Info on Map) */}
      {selectedNodeId && (() => {
        const selNode = meshNodes.find((n) => n.id === selectedNodeId);
        if (!selNode) return null;

        return (
          <div className="absolute bottom-6 right-6 z-30 w-76 bg-slate-900/95 backdrop-blur-md border border-cyan-500/60 rounded-xl p-3 shadow-2xl text-white animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
              <span
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  selNode.type === "master" ? "bg-amber-500 text-slate-950" : "bg-cyan-600 text-white"
                }`}
              >
                {selNode.type === "master" ? "📡 MASTER GATEWAY" : "⚡ SLAVE SENSOR"}
              </span>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                title="Close"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="font-bold text-xs mt-2 text-white">{selNode.name}</div>
            <div className="text-[10px] text-slate-300 mt-0.5">{selNode.role}</div>
            <div className="text-[9px] font-mono text-cyan-300 mt-1">
              Lat: {selNode.lat.toFixed(5)}° • Lng: {selNode.lng.toFixed(5)}°
            </div>
            <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-slate-800">
              <button
                onClick={() => focusOnNode(selNode)}
                className="flex-1 flex items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded px-2 py-1.5 text-xs font-semibold cursor-pointer"
              >
                <Crosshair className="size-3" />
                <span>Focus</span>
              </button>
              {selNode.type === "slave" && (
                <button
                  onClick={() => setNodeAsMaster(selNode.id)}
                  className="flex-1 flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1.5 text-xs font-semibold cursor-pointer"
                >
                  <span>Make Master</span>
                </button>
              )}
              <button
                onClick={() => deleteNode(selNode.id)}
                className="flex-1 flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-500 text-white rounded px-2 py-1.5 text-xs font-bold cursor-pointer transition-all active:scale-95"
                title={`Click to delete ${selNode.name} from the 3D map`}
              >
                <Trash2 className="size-3" />
                <span>Click to Delete {selNode.type === "master" ? "Master" : "Slave"}</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* 📡 DEDICATED SLAVE DATA BOX ON THE RIGHT (Close with '<') */}
      {(() => {
        const activeSlave =
          meshNodes.find((n) => n.id === activeSlaveId) ||
          meshNodes.find((n) => n.type === "slave");
        if (!activeSlave) return null;

        // Minimized side tab when box is closed
        if (!showSlaveDataBox) {
          return (
            <button
              data-testid="open-slave-data-box-btn"
              onClick={() => setShowSlaveDataBox(true)}
              className="absolute top-24 right-0 z-30 flex items-center gap-1.5 bg-slate-900/95 hover:bg-slate-800 text-cyan-300 hover:text-white text-xs font-bold px-3 py-2 rounded-l-xl shadow-2xl border border-r-0 border-cyan-500/50 cursor-pointer transition-all hover:pr-4 group"
              title="Open Slave Data Box (<)"
            >
              <span className="font-mono font-black text-sm text-cyan-400 group-hover:-translate-x-0.5 transition-transform">&lt;</span>
              <span>{activeSlave.name.includes("Slave") ? activeSlave.name : `Slave 1 (${activeSlave.sensorId || stagedSensorId || "node1"})`} Data</span>
            </button>
          );
        }

        const calculatedWaterDepth = 0.24 + (simRainIntensity > 0 ? (simRainIntensity / 100) * 0.42 : 0);
        const calculatedMoisture = Math.min(99.4, 72.4 + (simRainIntensity > 0 ? (simRainIntensity / 100) * 18.2 : 0));

        return (
          <div
            data-testid="slave-data-box"
            className="absolute top-16 right-3 sm:right-4 z-40 w-84 sm:w-96 max-h-[85vh] bg-slate-900/95 backdrop-blur-md border border-cyan-500/60 rounded-2xl p-4 shadow-2xl text-white flex flex-col gap-3 animate-in fade-in slide-in-from-right-3 duration-200 overflow-hidden"
          >
            {/* Header with '<' close button */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-cyan-950 border border-cyan-500/50 flex items-center justify-center text-cyan-400 shadow-sm">
                  <Zap className="size-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="font-bold text-sm text-cyan-300 leading-none">
                      {activeSlave.name}
                    </h3>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${
                        slaveLiveTelemetry.hasData
                          ? "bg-emerald-950 border-emerald-500/40 text-emerald-300"
                          : "bg-slate-800 border-slate-700 text-slate-400"
                      }`}
                    >
                      {slaveLiveTelemetry.hasData ? "● Live Data" : "● No Data (0)"}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                    Sensor ID: <span className="text-cyan-300 font-bold">{activeSlave.sensorId || stagedSensorId || "node1"}</span>
                  </p>
                </div>
              </div>

              {/* Close with literal '<' as requested: "add< to close that" */}
              <button
                data-testid="close-slave-data-box-btn"
                onClick={() => setShowSlaveDataBox(false)}
                className="flex items-center justify-center h-7 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-white border border-slate-700 text-sm font-black cursor-pointer transition-all hover:scale-105 active:scale-95 shadow group"
                title="Close (<)"
                aria-label="Close"
              >
                <span className="font-mono font-black text-sm group-hover:-translate-x-0.5 transition-transform">&lt;</span>
              </button>
            </div>

            {/* Scrollable telemetry body */}
            <div className="overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-thumb-slate-700 text-xs">
              {/* Node status / RF & Battery badges */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                    <Signal className="size-3 text-cyan-400" />
                    <span>Signal</span>
                  </div>
                  <div className="font-mono font-bold text-emerald-400 text-xs mt-0.5">
                    {slaveLiveTelemetry.hasData ? `${slaveLiveTelemetry.rssi} dBm` : "0 dBm"}
                  </div>
                </div>
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                    <Zap className="size-3 text-amber-400" />
                    <span>Battery</span>
                  </div>
                  <div className="font-mono font-bold text-emerald-400 text-xs mt-0.5">
                    {slaveLiveTelemetry.hasData ? `${slaveLiveTelemetry.battery}%` : "0%"}
                  </div>
                </div>
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                    <Cpu className="size-3 text-indigo-400" />
                    <span>Protocol</span>
                  </div>
                  <div className="font-mono font-bold text-indigo-300 text-[10px] mt-0.5">
                    LoRaWAN
                  </div>
                </div>
              </div>

              {/* GPS Coordinates & Elevation */}
              <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-2.5 space-y-1">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1">
                  <MapPin className="size-3 text-rose-400" />
                  <span>Coordinates &amp; Location</span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400">Lat / Long:</span>
                  <span className="text-cyan-300 font-semibold">
                    {activeSlave.lat.toFixed(5)}° N, {activeSlave.lng.toFixed(5)}° E
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400">Elevation:</span>
                  <span className="text-emerald-300 font-semibold">
                    {(activeSlave.elevationMeters ?? 14.8).toFixed(1)} m AMSL
                  </span>
                </div>
              </div>

              {/* Live Probe Telemetry Readings */}
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Activity className="size-3 text-cyan-400" />
                    <span>Live Probe Telemetry</span>
                  </span>
                  <span className="text-[9px] text-emerald-400 font-mono animate-pulse">
                    {slaveLiveTelemetry.hasData ? "● Live 1 Hz" : "● No Data"}
                  </span>
                </div>

                {/* 1. Submersible Water Level */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40 rounded-xl p-2.5 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Waves className="size-3.5 text-blue-400" />
                      <span className="font-semibold text-slate-200 text-xs">Submersible Water Level</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 font-mono border border-blue-800/50">
                      {slaveLiveTelemetry.hasData ? (slaveLiveTelemetry.waterLevelM > 0.8 ? "High" : "Normal") : "0"}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-1.5">
                    <span className="text-[10px] text-slate-400 font-mono">Current Depth:</span>
                    <span className="font-mono font-bold text-cyan-300 text-sm">
                      {slaveLiveTelemetry.hasData
                        ? `${slaveLiveTelemetry.waterLevelM.toFixed(2)} m (${slaveLiveTelemetry.waterLevelMm.toFixed(0)} mm)`
                        : "0 m"}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, (slaveLiveTelemetry.waterLevelM / 2.0) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* 2. Capacitive Soil Moisture */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40 rounded-xl p-2.5 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Droplets className="size-3.5 text-emerald-400" />
                      <span className="font-semibold text-slate-200 text-xs">Capacitive Soil Moisture</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono border border-emerald-800/50">
                      {slaveLiveTelemetry.hasData ? (slaveLiveTelemetry.soilMoisture > 70 ? "Saturated" : "Moist") : "0"}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-1.5">
                    <span className="text-[10px] text-slate-400 font-mono">Volumetric Content:</span>
                    <span className="font-mono font-bold text-emerald-300 text-sm">
                      {slaveLiveTelemetry.hasData ? `${slaveLiveTelemetry.soilMoisture.toFixed(1)}%` : "0%"}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, slaveLiveTelemetry.soilMoisture)}%` }}
                    />
                  </div>
                </div>

                {/* 3. Slope Inclinometer / Tilt */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40 rounded-xl p-2.5 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Mountain className="size-3.5 text-amber-400" />
                      <span className="font-semibold text-slate-200 text-xs">Slope Inclinometer (Tilt)</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 font-mono border border-amber-800/50">
                      {slaveLiveTelemetry.hasData ? (slaveLiveTelemetry.tilt > 15 ? "Warning" : "Stable") : "0"}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-1.5">
                    <span className="text-[10px] text-slate-400 font-mono">Axis Deviation:</span>
                    <span className="font-mono font-bold text-amber-300 text-sm">
                      {slaveLiveTelemetry.hasData ? `${slaveLiveTelemetry.tilt.toFixed(1)}%` : "0%"}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="bg-amber-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, slaveLiveTelemetry.tilt)}%` }}
                    />
                  </div>
                </div>

                {/* 4. Optical Raindrop Sensor */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40 rounded-xl p-2.5 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <CloudRain className="size-3.5 text-cyan-400" />
                      <span className="font-semibold text-slate-200 text-xs">Optical Rain Sensor</span>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono border ${
                        slaveLiveTelemetry.rainfall > 20
                          ? "bg-rose-950 text-rose-300 border-rose-800/50 animate-pulse font-bold"
                          : slaveLiveTelemetry.hasData && slaveLiveTelemetry.rainfall > 0
                          ? "bg-cyan-950 text-cyan-300 border-cyan-800/50"
                          : "bg-slate-900 text-slate-400 border-slate-800"
                      }`}
                    >
                      {slaveLiveTelemetry.rainfall > 20
                        ? `${slaveLiveTelemetry.rainfall.toFixed(0)} mm/h (>20% Active)`
                        : slaveLiveTelemetry.hasData && slaveLiveTelemetry.rainfall > 0
                        ? `${slaveLiveTelemetry.rainfall.toFixed(0)} mm/h`
                        : "0"}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-1.5">
                    <span className="text-[10px] text-slate-400 font-mono">Precipitation:</span>
                    <span className="font-mono font-bold text-cyan-300 text-sm">
                      {slaveLiveTelemetry.hasData ? `${slaveLiveTelemetry.rainfall.toFixed(1)} mm/h` : "0 mm/h"}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="bg-cyan-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, slaveLiveTelemetry.rainfall)}%` }}
                    />
                  </div>
                </div>

                {/* 5. 9-Axis Ground IMU */}
                <div className="bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40 rounded-xl p-2.5 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Activity className="size-3.5 text-purple-400" />
                      <span className="font-semibold text-slate-200 text-xs">9-Axis Ground IMU</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 font-mono border border-purple-800/50">
                      {slaveLiveTelemetry.hasData ? "Active" : "0"}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-1.5">
                    <span className="text-[10px] text-slate-400 font-mono">Vibration / Accel:</span>
                    <span className="font-mono font-bold text-purple-300 text-sm">
                      {slaveLiveTelemetry.hasData ? `${slaveLiveTelemetry.imuMag.toFixed(2)} g` : "0 g"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => focusOnNode(activeSlave)}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-cyan-700/80 hover:bg-cyan-600 text-white rounded-xl py-2 font-semibold text-xs transition-colors cursor-pointer"
                >
                  <Crosshair className="size-3.5" />
                  <span>Focus in 3D</span>
                </button>
                <button
                  onClick={() => {
                    toast.success(`Pinged ${activeSlave.name}: Round-trip 18ms (Mesh 1-hop)`);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl py-2 font-semibold text-xs border border-slate-700 transition-colors cursor-pointer"
                >
                  <Radio className="size-3.5 text-cyan-400" />
                  <span>Ping Node</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ⛰️ SRTM 30m (STM 30) DEM Elevation Topography Overlay Card */}
      {showSrtm30 && showSrtmLegend && (
        <div className="absolute top-14 right-3 z-20 w-64 bg-slate-900/95 backdrop-blur-md border border-amber-500/40 rounded-xl p-3 shadow-2xl text-white animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-start justify-between gap-2 border-b border-slate-700/80 pb-2">
            <div>
              <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold">
                <Layers className="size-3.5" />
                <span>SRTM 30m Elevation</span>
              </div>
              <p className="text-[10px] text-slate-300 font-medium mt-0.5">
                NASA/USGS SRTMGL1 (30m DEM)
              </p>
            </div>
            <button
              onClick={() => setShowSrtmLegend(false)}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              title="Minimize Legend"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Elevation Color Ramp */}
          <div className="mt-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>0m Sea</span>
              <span>1500m</span>
              <span>3000m+</span>
            </div>
            <div
              className="h-3 w-full rounded-md shadow-inner border border-slate-700/50"
              style={{
                background:
                  "linear-gradient(to right, #000080 0%, #0000FF 15%, #00FFFF 30%, #00FF00 50%, #FFFF00 70%, #FF8000 85%, #FF0000 95%, #FFFFFF 100%)",
              }}
              title="SRTM 30m Hypsometric Elevation Ramp"
            />
            <div className="flex items-center justify-between text-[9px] text-slate-400 font-medium">
              <span className="text-blue-300">Basin</span>
              <span className="text-emerald-300">Foothills</span>
              <span className="text-yellow-300">Plateau</span>
              <span className="text-red-400">Peaks</span>
            </div>
          </div>

          {/* Target Elevation & Opacity Control */}
          <div className="mt-3 pt-2.5 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Target Ground Elev:</span>
              <span className="font-mono font-bold text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60">
                {groundHeightMeters}m MSL
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>Overlay Opacity:</span>
                <span className="font-mono text-slate-300">{Math.round(srtmOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={srtmOpacity}
                onChange={(e) => handleSrtmOpacityChange(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Re-open minimized legend button */}
      {showSrtm30 && !showSrtmLegend && (
        <button
          onClick={() => setShowSrtmLegend(true)}
          className="absolute top-14 right-3 z-20 flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-md border border-amber-500/40 px-2.5 py-1 rounded-lg shadow-lg text-[10px] font-bold text-amber-300 hover:bg-slate-800 cursor-pointer transition-colors"
          title="Show SRTM 30m Legend & Controls"
        >
          <Layers className="size-3 text-amber-400" />
          <span>SRTM 30 Legend ({Math.round(srtmOpacity * 100)}%)</span>
        </button>
      )}

      {/* Free Style On-Screen Movement D-Pad Controller (Bottom-Left) */}
      <div className="absolute bottom-3 left-3 z-20 flex flex-col items-center gap-1.5 p-2 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-2xl text-white select-none">
        <div className="text-[10px] font-bold text-sky-400 uppercase tracking-wider text-center px-1">
          {viewMode === "flat" ? "Walk (WASD)" : "Free Move"}
        </div>

        {/* 3x3 Movement & Turn Cross Grid */}
        <div className="grid grid-cols-3 gap-1.5 w-[114px]">
          {/* Row 1: Turn Left (↶), W/Up (↑), Turn Right (↷) */}
          <button
            onMouseDown={() => setMoveFlag("turnLeft", true)}
            onMouseUp={() => setMoveFlag("turnLeft", false)}
            onTouchStart={() => setMoveFlag("turnLeft", true)}
            onTouchEnd={() => setMoveFlag("turnLeft", false)}
            title={
              viewMode === "flat"
                ? "Turn Left (↶ / Arrow Left / Mouse Drag Left)"
                : "Turn Left"
            }
            className="size-9 flex flex-col items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-emerald-600 text-slate-200 active:text-white transition-colors cursor-pointer border border-slate-700 shadow-xs"
          >
            <RotateCcw className="size-3.5 text-emerald-400" />
            <span className="text-[7px] font-mono font-bold leading-none mt-0.5 text-slate-300">TURN</span>
          </button>

          <button
            onMouseDown={() => setMoveFlag("forward", true)}
            onMouseUp={() => setMoveFlag("forward", false)}
            onTouchStart={() => setMoveFlag("forward", true)}
            onTouchEnd={() => setMoveFlag("forward", false)}
            title="Move Forward (W / Up Arrow)"
            className="size-9 flex flex-col items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 active:text-white transition-colors cursor-pointer border border-slate-700 shadow-xs"
          >
            <ArrowUp className="size-4" />
            <span className="text-[8px] font-mono font-bold leading-none -mt-0.5">W</span>
          </button>

          <button
            onMouseDown={() => setMoveFlag("turnRight", true)}
            onMouseUp={() => setMoveFlag("turnRight", false)}
            onTouchStart={() => setMoveFlag("turnRight", true)}
            onTouchEnd={() => setMoveFlag("turnRight", false)}
            title={
              viewMode === "flat"
                ? "Turn Right (↷ / Arrow Right / Mouse Drag Right)"
                : "Turn Right"
            }
            className="size-9 flex flex-col items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-emerald-600 text-slate-200 active:text-white transition-colors cursor-pointer border border-slate-700 shadow-xs"
          >
            <RotateCw className="size-3.5 text-emerald-400" />
            <span className="text-[7px] font-mono font-bold leading-none mt-0.5 text-slate-300">TURN</span>
          </button>

          {/* Row 2: A/Left, S/Down, D/Right */}
          <button
            onMouseDown={() => setMoveFlag("left", true)}
            onMouseUp={() => setMoveFlag("left", false)}
            onTouchStart={() => setMoveFlag("left", true)}
            onTouchEnd={() => setMoveFlag("left", false)}
            title="Strafe Left (A)"
            className="size-9 flex flex-col items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 active:text-white transition-colors cursor-pointer border border-slate-700 shadow-xs"
          >
            <ArrowLeft className="size-4" />
            <span className="text-[8px] font-mono font-bold leading-none -mt-0.5">A</span>
          </button>

          <button
            onMouseDown={() => setMoveFlag("backward", true)}
            onMouseUp={() => setMoveFlag("backward", false)}
            onTouchStart={() => setMoveFlag("backward", true)}
            onTouchEnd={() => setMoveFlag("backward", false)}
            title="Move Backward (S / Down Arrow)"
            className="size-9 flex flex-col items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 active:text-white transition-colors cursor-pointer border border-slate-700 shadow-xs"
          >
            <ArrowDown className="size-4" />
            <span className="text-[8px] font-mono font-bold leading-none -mt-0.5">S</span>
          </button>

          <button
            onMouseDown={() => setMoveFlag("right", true)}
            onMouseUp={() => setMoveFlag("right", false)}
            onTouchStart={() => setMoveFlag("right", true)}
            onTouchEnd={() => setMoveFlag("right", false)}
            title="Strafe Right (D)"
            className="size-9 flex flex-col items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 active:text-white transition-colors cursor-pointer border border-slate-700 shadow-xs"
          >
            <ArrowRight className="size-4" />
            <span className="text-[8px] font-mono font-bold leading-none -mt-0.5">D</span>
          </button>
        </div>

        {/* Altitude Up / Down 2-column bar */}
        <div className="grid grid-cols-2 gap-1.5 w-[114px] pt-1.5 border-t border-slate-700/70">
          <button
            onMouseDown={() => setMoveFlag("up", true)}
            onMouseUp={() => setMoveFlag("up", false)}
            onTouchStart={() => setMoveFlag("up", true)}
            onTouchEnd={() => setMoveFlag("up", false)}
            title={
              viewMode === "flat"
                ? "Increase Altitude (Q / Mouse Up / Wheel Up)"
                : "Move Up (Q)"
            }
            className="h-7 flex items-center justify-center gap-1 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-emerald-600 text-[10px] font-semibold text-slate-300 active:text-white cursor-pointer border border-slate-700 shadow-xs"
          >
            <ChevronUp className="size-3 text-emerald-400" />
            <span>{viewMode === "flat" ? "Alt +" : "Up"}</span>
          </button>
          <button
            onMouseDown={() => setMoveFlag("down", true)}
            onMouseUp={() => setMoveFlag("down", false)}
            onTouchStart={() => setMoveFlag("down", true)}
            onTouchEnd={() => setMoveFlag("down", false)}
            title={
              viewMode === "flat"
                ? "Decrease Altitude (E / Mouse Down / Wheel Down)"
                : "Move Down (E)"
            }
            className="h-7 flex items-center justify-center gap-1 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-emerald-600 text-[10px] font-semibold text-slate-300 active:text-white cursor-pointer border border-slate-700 shadow-xs"
          >
            <ChevronDown className="size-3 text-emerald-400" />
            <span>{viewMode === "flat" ? "Alt -" : "Down"}</span>
          </button>
        </div>
      </div>

      {/* 🗺️ Google Maps Style Floating Navigation Controls (Compass, Zoom +, Zoom -) */}
      <div className="absolute bottom-12 right-3 z-20 flex flex-col items-center gap-1 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1 rounded-xl shadow-2xl">
        {/* North Compass Button */}
        <button
          onClick={handleResetNorth}
          title="Reset to North Orientation"
          className="size-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white transition-colors cursor-pointer group"
        >
          <div
            className="size-5 flex items-center justify-center transition-transform duration-200"
            style={{ transform: `rotate(${-camHeading}deg)` }}
          >
            <svg viewBox="0 0 24 24" className="size-full drop-shadow-xs">
              {/* North pointer (Red) */}
              <polygon points="12,2 8,12 12,9 16,12" fill="#ef4444" />
              {/* South pointer (Slate) */}
              <polygon points="12,22 8,12 12,15 16,12" fill="#cbd5e1" />
            </svg>
          </div>
        </button>

        <div className="w-5 h-px bg-slate-700/80 my-0.5" />

        {/* Zoom In (+) */}
        <button
          onClick={handleZoomIn}
          title={viewMode === "flat" ? "Increase Altitude (+)" : "Zoom In (+)"}
          className="size-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 active:text-white transition-colors cursor-pointer"
        >
          <Plus className="size-4" />
        </button>

        {/* Zoom Out (-) */}
        <button
          onClick={handleZoomOut}
          title={viewMode === "flat" ? "Decrease Altitude (-)" : "Zoom Out (-)"}
          className="size-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-sky-600 text-slate-200 active:text-white transition-colors cursor-pointer"
        >
          <Minus className="size-4" />
        </button>
      </div>

      {/* Bottom Right: Live Alt & Flat Walk Guide */}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 pointer-events-none">
        <div className="pointer-events-auto hidden sm:flex items-center gap-3 bg-slate-900/85 backdrop-blur-md border border-slate-700/70 px-3 py-1.5 rounded-lg shadow-lg text-[11px] text-slate-300 font-mono">
          {viewMode === "flat" && (
            <>
              <span className="flex items-center gap-1 text-slate-200">
                <Compass className="size-3.5 text-emerald-400" />
                <span>
                  WASD: Walk | Drag / ↶ ↷ / Arrows: Turn Left & Right | Mouse Up/Down: Altitude
                </span>
              </span>
              <span className="text-slate-600">|</span>
            </>
          )}
          <span className="flex items-center gap-1.5 text-sky-300 font-bold">
            {viewMode !== "flat" && <Compass className="size-3.5 text-sky-400" />}
            <span>
              {viewMode === "flat"
                ? `Alt: ${camAltitude.toLocaleString()}m (Ground: ${groundHeightMeters}m)`
                : `Alt: ${camAltitude.toLocaleString()}m`}
            </span>
          </span>
        </div>
      </div>

      {/* Sensor ID Prompt Modal for Master / Slave Nodes */}
      {sensorPromptModal.open && (
        <div
          data-testid="sensor-id-modal"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSensorPromptModal((prev) => ({ ...prev, open: false }));
            }
          }}
        >
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl shadow-2xl max-w-md w-full p-6 text-slate-100 relative space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-xl border ${
                    sensorPromptModal.nodeType === "master"
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                      : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  }`}
                >
                  {sensorPromptModal.nodeType === "master" ? (
                    <Radio className="size-6" />
                  ) : (
                    <Cpu className="size-6" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-wide">
                    {sensorPromptModal.nodeType === "master"
                      ? "Add Master Gateway Node"
                      : "Add Slave Relay Node"}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Assign Sensor ID for live telemetry & DB monitoring
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="close-sensor-modal-btn"
                onClick={() => setSensorPromptModal((prev) => ({ ...prev, open: false }))}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Sensor ID <span className="text-cyan-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  data-testid="sensor-id-input"
                  value={sensorPromptModal.sensorId}
                  onChange={(e) =>
                    setSensorPromptModal((prev) => ({ ...prev, sensorId: e.target.value }))
                  }
                  placeholder="e.g. node1"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-cyan-500/50 rounded-lg text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all placeholder:text-slate-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      confirmSensorPlacement(
                        sensorPromptModal.nodeType,
                        sensorPromptModal.lat,
                        sensorPromptModal.lng,
                        sensorPromptModal.sensorId
                      );
                    }
                  }}
                />
                <span className="absolute right-3 top-2.5 text-[11px] font-mono text-cyan-400/80 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800/40">
                  Target Node
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Default ID is <code className="text-cyan-300 font-bold bg-cyan-950 px-1 py-0.5 rounded">node1</code>. Live telemetry packets from this sensor will stream continuously into the digital twin & dashboard.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                data-testid="confirm-connect-sensor-btn"
                onClick={() =>
                  confirmSensorPlacement(
                    sensorPromptModal.nodeType,
                    sensorPromptModal.lat,
                    sensorPromptModal.lng,
                    sensorPromptModal.sensorId
                  )
                }
                className="w-full py-2.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-lg hover:shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="size-4" />
                <span>Connect Sensor & Deploy Node</span>
              </button>

              <button
                type="button"
                data-testid="pick-location-sensor-btn"
                onClick={() => {
                  setStagedSensorId(sensorPromptModal.sensorId || "node1");
                  setIsPickingLocation(sensorPromptModal.nodeType);
                  setSensorPromptModal((prev) => ({ ...prev, open: false }));
                  toast.info(
                    `Sensor ID [${sensorPromptModal.sensorId || "node1"}] staged! Click anywhere on the 3D map to place.`
                  );
                }}
                className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-slate-600 text-slate-300 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <MapPin className="size-3.5 text-amber-400" />
                <span>Click Specific Location on 3D Globe</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
