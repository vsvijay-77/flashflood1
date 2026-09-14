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
import TwinForecastHeatmap from "./TwinForecastHeatmap";
import ThreeWaterSimulation from "../simulation/ThreeWaterSimulation";
import DisasterIntelligenceChat from "./DisasterIntelligenceChat";
import { toast } from "sonner";
import { generateCirclePolygon } from "@/lib/gisUtils";
import { filterBuildingsClearOfPaths } from "./buildingGeometry";
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

export interface CesiumDigitalTwinViewerProps {
  latitude: number;
  longitude: number;
  areaName?: string;
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

  _srtmTileUrlPromise = (async () => {
    try {
      const res = await fetch("/api/gee/layer-tiles?layer=elevation");
      if (res.ok) {
        const data = await res.json();
        if (data && data.tileUrl) {
          _cachedSrtmTileUrl = data.tileUrl;
          return data.tileUrl;
        }
      }
    } catch (e) {
      console.warn("[STM 30] GEE tile fetch fallback to OpenTopoMap:", e);
    }
    _cachedSrtmTileUrl = "https://tile.opentopomap.org/{z}/{x}/{y}.png";
    return _cachedSrtmTileUrl;
  })();

  return _srtmTileUrlPromise;
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
  bbox: BoundingBox;
  osmTileStatus?: any;
  timestamp: number;
}> = {};

export function CesiumDigitalTwinViewer({
  latitude,
  longitude,
  areaName = "Pollachi Basin",
  polygon,
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
  const [waterSimActive, setWaterSimActive] = useState<boolean>(false);

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
 
  // ─── 🛣️ REAL ROAD NETWORK, 🌊 RIVERS & 🚨 EVACUATION ROUTING ───
  const roadEntitiesRef = useRef<any[]>([]);
  const riverEntitiesRef = useRef<any[]>([]);
  const buildingEntitiesRef = useRef<any[]>([]);
  const evacuationEntitiesRef = useRef<any[]>([]);
  const riskZoneEntitiesRef = useRef<any[]>([]);
  // Viewport-based dynamic loading & camera flight guards
  const viewportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViewportBboxRef = useRef<string>("");  // Last fetched bbox string for dedup
  const networkRequestRef = useRef(0);
  const buildingRequestRef = useRef(0);
  const networkAbortRef = useRef<AbortController | null>(null);
  const buildingAbortRef = useRef<AbortController | null>(null);
  const isInFlightRef = useRef<boolean>(false);
  const networksLoadedRef = useRef<boolean>(false);
  const isInitialAreaMountRef = useRef<boolean>(true);

  const [showRoads, setShowRoads] = useState<boolean>(true);
  const [showRivers, setShowRivers] = useState<boolean>(true);
  const [showBuildings, setShowBuildings] = useState<boolean>(true);
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
  const [isLoadingBuildings, setIsLoadingBuildings] = useState<boolean>(false);
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

  const safeName = (areaName || "default").replace(/\s+/g, "_");
  const storageKey = `dt_mesh_nodes_${safeName}`;
  const activityStorageKey = `dt_user_activity_${safeName}`;
  // v6 invalidates center/viewport data saved by older viewers. Only complete
  // selected-polygon responses may be restored for an area.
  const networksStorageKey = `dt_networks_v7_${safeName}_${latitude.toFixed(4)}_${longitude.toFixed(4)}`;

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
  const [simRainIntensity, setSimRainIntensity] = useState<number>(rainfallIntensity ?? 75);
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
    if (onToggleRain) {
      onToggleRain(next);
    }
    if (next) {
      setActivePanelTab("slave");
      setShowMeshPanel(true);
    }
  };

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
    if (polygon && polygon.length >= 3) {
      return polygon;
    }
    // High-resolution 16-point natural basin perimeter around center coordinates (~1.2 km radius)
    return generateCirclePolygon(latitude, longitude, 1200, 16);
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
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;

    viewer.entities.suspendEvents();
    try {
      roadEntitiesRef.current.forEach((ent) => {
        try { viewer.entities.remove(ent); } catch (e) {}
      });
      roadEntitiesRef.current = [];

      if (!roads || roads.length === 0) {
        console.log(`[DT] render3DRoads: skipped (count=${roads?.length || 0})`);
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

        let clippedSegments = clipPolylineToPolygon(coords as [number, number][], activePoly);
        if (clippedSegments.length === 0) {
          const anyInside = (coords as [number, number][]).some(
            ([lng, lat]) =>
              lat >= minPolyLat - padLat && lat <= maxPolyLat + padLat &&
              lng >= minPolyLng - padLng && lng <= maxPolyLng + padLng
          );
          if (anyInside) {
            clippedSegments = [coords as [number, number][]];
          }
        }
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
              zIndex: 30,
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
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;

    viewer.entities.suspendEvents();
    try {
      riverEntitiesRef.current.forEach((ent) => {
        try { viewer.entities.remove(ent); } catch (e) {}
      });
      riverEntitiesRef.current = [];

      if (!rivers || rivers.length === 0) {
        console.log(`[DT] render3DRivers: skipped (count=${rivers?.length || 0})`);
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
      const padLat = Math.max(0.02, (maxPolyLat - minPolyLat) * 0.5);
      const padLng = Math.max(0.02, (maxPolyLng - minPolyLng) * 0.5);

      rivers.forEach((river) => {
        const geom = river.geometry as any;
        const props = (river.properties as any) || {};
        const wType = ((props.waterway_type || props.waterway || "stream") as string).toLowerCase();
        const isWaterBody = Boolean(
          props.is_water_body ||
          ["water", "lake", "reservoir", "pond", "basin", "riverbank", "lagoon", "oxbow"].includes(wType)
        );

        // 1. Water surface polygons (lakes, reservoirs, ponds, basins)
        const polygons = geom?.type === "Polygon" ? [geom.coordinates] : geom?.type === "MultiPolygon" ? geom.coordinates : [];
        for (const rings of polygons as number[][][][]) {
          if (!rings || !rings[0] || rings[0].length < 3) continue;
          const outerRing = rings[0].flat();
          if (outerRing.length < 6) continue;
          const holes = rings.slice(1).map((ring: number[][]) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())));
          const ent = viewer.entities.add({
            name: `💧 ${props.name || (wType === "reservoir" ? "Reservoir" : wType === "lake" ? "Lake" : "Water Body")}`,
            show: visible,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(outerRing), holes),
              material: Cesium.Color.fromCssColorString("#06b6d4").withAlpha(0.65),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              classificationType: Cesium.ClassificationType.TERRAIN,
              zIndex: 10,
            },
          });
          riverEntitiesRef.current.push(ent);
        }

        // 2. Waterway channels (rivers, canals, streams, brooks)
        const rawLines = geom?.type === "LineString" ? [geom.coordinates] : geom?.type === "MultiLineString" ? geom.coordinates : [];
        for (const line of rawLines as [number, number][][]) {
          if (!line || line.length < 2) continue;

          // If line is closed and represents a water body, render as polygon surface
          const isClosed = line.length >= 4 && (
            (line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]) ||
            (Math.abs(line[0][0] - line[line.length - 1][0]) < 1e-4 && Math.abs(line[0][1] - line[line.length - 1][1]) < 1e-4)
          );
          if (isWaterBody && isClosed) {
            const flatRing = line.flat();
            if (flatRing.length >= 6) {
              const ent = viewer.entities.add({
                name: `💧 ${props.name || (wType === "reservoir" ? "Reservoir" : wType === "lake" ? "Lake" : "Water Body")}`,
                show: visible,
                polygon: {
                  hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flatRing)),
                  material: Cesium.Color.fromCssColorString("#06b6d4").withAlpha(0.65),
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                  classificationType: Cesium.ClassificationType.TERRAIN,
                  zIndex: 10,
                },
              });
              riverEntitiesRef.current.push(ent);
              continue;
            }
          }

          let clippedSegments = clipPolylineToPolygon(line, activePoly);
          if (clippedSegments.length === 0) {
            const anyInside = line.some(
              ([lng, lat]) =>
                lat >= minPolyLat - padLat && lat <= maxPolyLat + padLat &&
                lng >= minPolyLng - padLng && lng <= maxPolyLng + padLng
            );
            if (anyInside) {
              clippedSegments = [line];
            }
          }
          if (clippedSegments.length === 0) continue;

          const isMain = wType === "river" || wType === "canal" || Boolean(props.is_main_river);
          const strokeColor = isMain ? "#0284c7" : wType === "stream" ? "#38bdf8" : "#7dd3fc";
          const lineWidth = Math.max(3.5, Math.min(12, props.width_m || (isMain ? 7.5 : 4.0)));

          clippedSegments.forEach((seg) => {
            const flat = seg.flat();
            if (flat.length < 4) return;
            const ent = viewer.entities.add({
              name: `🌊 ${props.name || (isMain ? "River Channel" : "Waterway")}`,
              show: visible,
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(flat),
                width: lineWidth,
                material: new Cesium.PolylineOutlineMaterialProperty({
                  color: Cesium.Color.fromCssColorString(strokeColor),
                  outlineColor: Cesium.Color.fromCssColorString("#082f49"),
                  outlineWidth: 1.5,
                }),
                clampToGround: true,
                zIndex: 15,
              },
            });
            riverEntitiesRef.current.push(ent);
          });
        }
      });
    } finally {
      viewer.entities.resumeEvents();
      viewer.scene.requestRender();
      console.log(`[DT] render3DRivers: added ${riverEntitiesRef.current.length} entities to viewer`);
    }
  };

  // ─── 🏢 MICROSOFT GLOBAL ML BUILDING FOOTPRINTS (3D EXTRUDED & RISK-COLORED) ───
  const render3DBuildings = (buildings: BuildingFeature[]) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;

    viewer.entities.suspendEvents();
    try {
      buildingEntitiesRef.current.forEach((entity) => {
        try { viewer.entities.remove(entity); } catch (e) {}
      });
      buildingEntitiesRef.current = [];

      const activePoly = getActivePolygon();
      const isSimFlooding = Boolean(waterSimActive || (rainActive && simRainIntensity && simRainIntensity > 35));

      buildings.forEach((building, idx) => {
        const source = building.geometry?.coordinates;
        if (!source) return;
        const polygons = building.geometry.type === "Polygon"
          ? [source as number[][][]]
          : source as number[][][][];

        polygons.forEach((rings) => {
          const outer = rings[0];
          if (!outer || outer.length < 4) return;

          // Compute exact centroid [lat, lon]
          const cLat = typeof building.properties?.lat === "number" && !isNaN(building.properties.lat)
            ? building.properties.lat
            : outer.reduce((sum, p) => sum + p[1], 0) / outer.length;
          const cLon = typeof building.properties?.lon === "number" && !isNaN(building.properties.lon)
            ? building.properties.lon
            : outer.reduce((sum, p) => sum + p[0], 0) / outer.length;

          // STRICT FILTER: Only render houses strictly inside the marked area
          if (activePoly && !isPointInPolygon(cLat, cLon, activePoly)) return;

          const holes = rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())));


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

          const entity = viewer.entities.add({
            name: `🏢 ${enrichedProps.name}`,
            show: showBuildings,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(outer.flat()), holes),
              material: Cesium.Color.fromCssColorString("#f97316").withAlpha(0.92),
              outline: true,
              outlineColor: Cesium.Color.fromCssColorString("#c2410c"),
              outlineWidth: 2.0,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              extrudedHeight: height,
              extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 80000),
            },
          });

          // Attach picking metadata for click popup
          (entity as any)._buildingData = enrichedProps;
          (entity as any)._buildingId = enrichedProps.id;
          buildingEntitiesRef.current.push(entity);
        });
      });
    } finally {
      viewer.entities.resumeEvents();
      viewer.scene.requestRender();
      console.log(`[DT] render3DBuildings: added ${buildingEntitiesRef.current.length} Microsoft 3D building entities`);
    }
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
        width: 8.0,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.4,
          taperPower: 1.0,
          color: Cesium.Color.fromCssColorString(routeColor),
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
    const timeout = window.setTimeout(() => controller.abort(), 90_000);

    const viewportBbox = bboxOverride || getViewportBbox();
    const activePoly = polygonOverride || (polygon && polygon.length >= 3 ? polygon : getActivePolygon());
    const selectedPolygon = activePoly && activePoly.length >= 3 ? activePoly : undefined;

    const areaCacheKey = selectedPolygon
      ? `poly_${selectedPolygon.map(([pLat, pLng]) => `${pLat.toFixed(4)},${pLng.toFixed(4)}`).join(";")}`
      : `coord_${latitude.toFixed(3)}_${longitude.toFixed(3)}`;

    // STALE-WHILE-REVALIDATE: If cached, load and display INSTANTLY (0 ms)!
    const cachedEntry = networkAreaCache[areaCacheKey];
    if (cachedEntry && (cachedEntry.roads.length > 0 || cachedEntry.rivers.length > 0)) {
      networksLoadedRef.current = true;
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
      if (Date.now() - cachedEntry.timestamp < 30 * 60 * 1000) {
        window.clearTimeout(timeout);
        // If cached entry has roads/rivers but no buildings yet, trigger building loading now!
        if (!cachedEntry.buildings || cachedEntry.buildings.length === 0) {
          const params: Parameters<typeof extractNetworks>[0] = selectedPolygon
            ? {
                polygon: selectedPolygon,
                lat: latitude,
                lng: longitude,
                radius_km: searchRadiusKm,
                place_name: searchOverride || areaName || undefined,
              }
            : viewportBbox
            ? {
                north: viewportBbox.north,
                south: viewportBbox.south,
                east: viewportBbox.east,
                west: viewportBbox.west,
                lat: latitude,
                lng: longitude,
              }
            : {
                lat: latitude,
                lng: longitude,
                radius_km: searchRadiusKm,
                place_name: searchOverride || areaName || undefined,
              };
          void loadBuildings(params, cachedEntry.roads, cachedEntry.rivers, cachedEntry.bbox, areaCacheKey);
        }
        return;
      }
    } else {
      setIsExtractingNetworks(true);
    }

    try {
      const params: Parameters<typeof extractNetworks>[0] = selectedPolygon
        ? {
            polygon: selectedPolygon,
            lat: latitude,
            lng: longitude,
            radius_km: searchRadiusKm,
            place_name: searchOverride || areaName || undefined,
          }
        : viewportBbox
        ? {
            north: viewportBbox.north,
            south: viewportBbox.south,
            east: viewportBbox.east,
            west: viewportBbox.west,
            lat: latitude,
            lng: longitude,
          }
        : {
            lat: latitude,
            lng: longitude,
            radius_km: searchRadiusKm,
            place_name: searchOverride || areaName || undefined,
          };

      console.log(`[DT] Fetching complete selected-area network: ${selectedPolygon ? `${selectedPolygon.length} boundary points` : viewportBbox ? `${viewportBbox.south.toFixed(3)},${viewportBbox.west.toFixed(3)} → ${viewportBbox.north.toFixed(3)},${viewportBbox.east.toFixed(3)}` : `center ${latitude},${longitude} r=${searchRadiusKm}km`}`);

      const res = await extractNetworks(params, controller.signal);

      // Never let a late response from an older request clear the completed selected-area scene.
      if (requestId !== networkRequestRef.current || !viewerRef.current || viewerRef.current.isDestroyed()) {
        return;
      }

      if (res.status === "success") {
        const roads = res.roads.geojson?.features || [];
        const rivers = res.rivers.geojson?.features || [];
        const tileStatus = res.osm_loading;
        const statusObj = {
          loaded: tileStatus?.loaded_tiles ?? 0,
          total: tileStatus?.total_tiles ?? 0,
          roads: roads.length,
          rivers: rivers.length,
          buildings: networkAreaCache[areaCacheKey]?.buildings?.length || 0,
        };
        setOsmTileStatus(statusObj);

        if (roads.length > 0 || rivers.length > 0) {
          networksLoadedRef.current = true;
          setExtractedBbox(res.bbox);

          // Update in-memory cache, preserving existing buildings
          networkAreaCache[areaCacheKey] = {
            roads,
            rivers,
            bbox: res.bbox,
            osmTileStatus: statusObj,
            buildings: networkAreaCache[areaCacheKey]?.buildings || cachedEntry?.buildings,
            timestamp: Date.now(),
          };
        }

        setRoadFeatures(roads);
        setRiverFeatures(rivers);

        render3DRoads(roads, showRoads);
        render3DRivers(rivers, showRivers);

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
          toast.success(desc);
        } else {
          toast.info("No roads, rivers, or water bodies found in this area from OpenStreetMap");
        }

        handlePredictRisk(res.bbox);
        void loadBuildings(params, roads, rivers, res.bbox, areaCacheKey);
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
      toast.error("Could not load roads/rivers — check your internet connection or try a different area");
    } finally {
      window.clearTimeout(timeout);
      if (requestId === networkRequestRef.current) {
        setIsExtractingNetworks(false);
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
    const buildingRequestId = ++buildingRequestRef.current;
    if (buildingAbortRef.current) {
      try { buildingAbortRef.current.abort(); } catch (e) {}
    }
    const controller = new AbortController();
    buildingAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 90_000);
    setIsLoadingBuildings(true);
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

      let rawCandidates: BuildingFeature[] = [];

      // 1. Fetch real Microsoft Global ML Building Footprints for the marked area
      try {
        const msRes = await fetchMicrosoftBuildings(
          {
            minLat,
            minLon,
            maxLat,
            maxLon,
            polygon: activePoly,
            water_level_m: waterSimActive ? 2.5 : 0.0,
            max_buildings: 3500,
          },
          controller.signal
        );

        if (msRes && msRes.features && msRes.features.length > 0) {
          rawCandidates = msRes.features;
        }
      } catch (msErr: any) {
        console.warn("Microsoft building footprints fetch error, checking OSM fallback:", msErr);
      }

      // 2. Fallback to OSM extraction if Microsoft dataset query returned 0 features
      if (rawCandidates.length === 0) {
        const res = await extractBuildings(
          {
            ...params,
            polygon: activePoly,
            north: maxLat,
            south: minLat,
            east: maxLon,
            west: minLon,
          },
          controller.signal
        );
        rawCandidates = res.buildings.geojson?.features || [];
      }

      // 3. 🎯 STRICT FILTER: Keep houses ONLY inside the marked area polygon
      const markedAreaBuildings = rawCandidates.filter((b) => {
        const coords = b.geometry?.coordinates;
        if (!coords) return false;
        const ring = b.geometry.type === "Polygon"
          ? (coords as number[][][])[0]
          : (coords as number[][][][])[0]?.[0];
        if (!ring || ring.length < 3) return false;

        const cLat = typeof b.properties?.lat === "number" && !isNaN(b.properties.lat)
          ? b.properties.lat
          : ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
        const cLon = typeof b.properties?.lon === "number" && !isNaN(b.properties.lon)
          ? b.properties.lon
          : ring.reduce((sum, p) => sum + p[0], 0) / ring.length;

        return isPointInPolygon(cLat, cLon, activePoly);
      });

      // 4. 🛣️ STRICT PATH & RIVER CLEARANCE: Remove any buildings touching or inside roads/waterways
      const clearBuildings: BuildingFeature[] = filterBuildingsClearOfPaths(markedAreaBuildings, roads, rivers).map((b) => ({
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

      setBuildingFeatures(clearBuildings);
      setBuildingStats(stats);
      setOsmTileStatus((prev) => ({
        ...prev,
        buildings: clearBuildings.length,
      }));
      render3DBuildings(clearBuildings);

      if (areaCacheKey) {
        const entry = networkAreaCache[areaCacheKey];
        if (entry) {
          entry.buildings = clearBuildings;
        }
      }
      try {
        const cacheKey = `dt_networks_${areaName || `${latitude.toFixed(3)}_${longitude.toFixed(3)}`}`;
        localStorage.setItem(cacheKey, JSON.stringify({
          roads,
          rivers,
          buildings: clearBuildings,
          bbox,
          timestamp: Date.now(),
        }));
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
      toast.warning("Paths and waterways are ready; building detail is still unavailable");
    } finally {
      window.clearTimeout(timeout);
      if (buildingRequestId === buildingRequestRef.current) setIsLoadingBuildings(false);
    }
  };


  // ─── 📐 SELECTED-AREA NETWORK LOADING ───
  // Load concurrently with camera movements or when area selection changes.
  const scheduleSelectedAreaLoad = (polygonOverride?: [number, number][], forceImmediate = false) => {
    if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
    const trigger = () => {
      const selectedPolygon = polygonOverride || (polygon && polygon.length >= 3 ? polygon : getActivePolygon());
      const areaKey = selectedPolygon && selectedPolygon.length >= 3
        ? selectedPolygon.map(([pLat, pLng]) => `${pLat.toFixed(5)},${pLng.toFixed(5)}`).join(";")
        : `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
      if (areaKey === lastViewportBboxRef.current && networksLoadedRef.current && roadEntitiesRef.current.length > 0 && buildingEntitiesRef.current.length > 0) return;
      lastViewportBboxRef.current = areaKey;
      handleExtractNetworks(undefined, undefined, selectedPolygon);
    };

    if (forceImmediate) {
      trigger();
    } else {
      viewportDebounceRef.current = setTimeout(trigger, 250);
    }
  };

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
        position: Cesium.Cartesian3.fromDegrees(master.lng, master.lat, 20),
        cylinder: {
          length: 40.0,
          topRadius: 2.5,
          bottomRadius: 4.5,
          material: Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.95),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#fef08a"),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        point: {
          pixelSize: 15,
          color: Cesium.Color.fromCssColorString("#f59e0b"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        label: {
          text: "Master Node • Connected",
          font: "bold 24px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          scale: 0.5,
          fillColor: Cesium.Color.fromCssColorString("#fef08a"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#451a03").withAlpha(0.92),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -32),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
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
        position: Cesium.Cartesian3.fromDegrees(slave.lng, slave.lat, 12),
        cylinder: {
          length: 24.0,
          topRadius: 1.8,
          bottomRadius: 3.0,
          material: Cesium.Color.fromCssColorString("#06b6d4").withAlpha(0.95),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#67e8f9"),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString("#06b6d4"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        label: {
          text: `Slave Node #${idx + 1} • Connected`,
          font: "bold 24px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          scale: 0.5,
          fillColor: Cesium.Color.fromCssColorString("#67e8f9"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#083344").withAlpha(0.92),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -26),
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      (slaveMast as any)._nodeId = slave.id;
      meshNodeEntitiesRef.current.push(slaveMast);

      // ALWAYS-ON 3D CONNECTION LINK (MASTER ↔ SLAVE) if Master exists
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
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.35,
              taperPower: 0.8,
              color: Cesium.Color.fromCssColorString("#22c55e"), // Vibrant RF link green (Master ↔ Slave)
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
          position: Cesium.Cartesian3.fromDegrees(midLng, midLat),
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

      // 3D Sensor Node Marker
      const sensorEntity = viewer.entities.add({
        id: `mesh-sensor-${sensor.id}`,
        name: `📡 ${sensor.name} (Slave: ${parentSlave.name})`,
        position: Cesium.Cartesian3.fromDegrees(sensor.lng, sensor.lat, 8),
        cylinder: {
          length: 14.0,
          topRadius: 1.2,
          bottomRadius: 2.0,
          material: Cesium.Color.fromCssColorString(hexColor).withAlpha(0.95),
          outline: true,
          outlineColor: Cesium.Color.WHITE,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(hexColor),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
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
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      (sensorEntity as any)._sensorId = sensor.id;
      meshNodeEntitiesRef.current.push(sensorEntity);

      // Clamped glow polyline connecting Sensor to its parent Slave node
      const sensorLinkLine = viewer.entities.add({
        id: `sensor-link-${sensor.id}`,
        name: `Sensor Link: ${sensor.name} ↔ ${parentSlave.name}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([
            sensor.lng, sensor.lat,
            parentSlave.lng, parentSlave.lat,
          ]),
          width: 2.5,
          clampToGround: true,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.3,
            taperPower: 0.8,
            color: Cesium.Color.fromCssColorString("#f97316"), // Vibrant sensor link orange (Sensor ↔ Slave)
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

  const addMasterAtCenter = () => {
    const master: DigitalTwinMeshNode = {
      id: "node-master",
      name: "Basin Central Gateway Alpha",
      type: "master",
      lat: Number(latitude.toFixed(6)),
      lng: Number(longitude.toFixed(6)),
      role: "Central Gateway & Telemetry Master",
      battery: 100,
      signalDbm: -45,
      status: "online",
    };
    setMeshNodes((prev) => [master, ...prev.filter((n) => n.type !== "master")]);
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

  const addPresetSlaveNode = (
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
    };
    setMeshNodes((prev) => [...prev, newSlave]);

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
    logUserActivity("Cleared Network", "Removed all nodes from 3D terrain");
  };

  const clearUserActivities = () => {
    setUserActivities([]);
    try {
      localStorage.removeItem(activityStorageKey);
    } catch (e) {}
  };

  // ─── SRTM 30m DEM TOPOGRAPHY LAYER (NASA / USGS SRTMGL1_003) ───
  const loadSrtmLayer = async (viewer: any, opacity: number = 0.65, visible: boolean = true) => {
    if (!viewer || viewer.isDestroyed()) return;

    // If layer already loaded — just update visibility and opacity in 0 ms!
    if (srtmLayerRef.current) {
      try {
        srtmLayerRef.current.show = visible;
        srtmLayerRef.current.alpha = opacity;
      } catch (e) {}
      return;
    }

    try {
      const srtmTileUrl = await getFastSrtmTileUrl();
      if (!viewer || viewer.isDestroyed() || srtmLayerRef.current) return;

      const srtmProvider = new Cesium.UrlTemplateImageryProvider({
        url: srtmTileUrl,
        maximumLevel: 17,
        minimumLevel: 0,
        tileWidth: 256,
        tileHeight: 256,
        enablePickFeatures: false,
        hasAlphaChannel: true,
        credit: "NASA / USGS SRTM 30m DEM (USGS/SRTMGL1_003)",
      });

      const layer = viewer.imageryLayers.addImageryProvider(srtmProvider);
      layer.alpha = opacity;
      layer.show = visible;
      srtmLayerRef.current = layer;
    } catch (err) {
      console.warn("Failed to load SRTM 30m DEM layer onto 3D terrain:", err);
    }
  };

  const toggleSrtm30 = () => {
    const nextState = !showSrtm30;
    setShowSrtm30(nextState);
    if (nextState) setShowSrtmLegend(true);
    if (srtmLayerRef.current) {
      // Layer already preloaded / loaded — flip visibility in 0 ms!
      srtmLayerRef.current.show = nextState;
      srtmLayerRef.current.alpha = srtmOpacity;
    } else if (viewerRef.current) {
      loadSrtmLayer(viewerRef.current, srtmOpacity, nextState);
    }
  };

  const handleSrtmOpacityChange = (newVal: number) => {
    setSrtmOpacity(newVal);
    if (srtmLayerRef.current) {
      srtmLayerRef.current.alpha = newVal;
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
          zIndex: 10000,
        },
      });
      maskEntitiesRef.current.push(borderEnt);
    } catch (e) {
      console.warn("[DT] Border entity error:", e);
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
              "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
            );
            baseLayer = new Cesium.ImageryLayer(esri);
          } catch (esriErr) {
            console.warn("Satellite fallback:", esriErr);
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
        scene.globe.depthTestAgainstTerrain = false;
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


        // 🚀 Ultra-Smooth Cinematic Entry: From Orbital Horizon to 3D Oblique Basin View
        isInFlightRef.current = true;
        // 1. Initial view: Clean regional orbital vista (~1,600 km) angled gently toward target topography
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude - 0.22, 1600000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-75),
            roll: 0.0,
          },
        });

        // 2. Allow the initial WebGL frame & terrain tiles to render before gently dissolving the loading veil
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
            // Smoothly dissolve the loading veil
            setLoading(false);

            // 3. Single continuous, uninterrupted cinematic flight into high-resolution 3D oblique perspective (6,500m at -45° tilt)
            viewerRef.current.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(longitude, latitude - 0.045, 6500),
              orientation: {
                heading: Cesium.Math.toRadians(0),
                pitch: Cesium.Math.toRadians(-45),
                roll: 0.0,
              },
              duration: 3.2,
              easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
              complete: () => {
                isInFlightRef.current = false;
                scheduleSelectedAreaLoad();
              },
              cancel: () => {
                isInFlightRef.current = false;
                scheduleSelectedAreaLoad();
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
    if (isInitialAreaMountRef.current) {
      isInitialAreaMountRef.current = false;
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

    const polyCoords = getActivePolygon();
    // Refresh the white outer mask around the new active polygon
    updateWhiteMask(polyCoords, longitude, latitude);

    // Cancel any previous area's in-flight network requests safely
    if (networkAbortRef.current) {
      try { networkAbortRef.current.abort(); } catch (e) {}
    }
    if (buildingAbortRef.current) {
      try { buildingAbortRef.current.abort(); } catch (e) {}
    }

    const areaCacheKey = polyCoords && polyCoords.length >= 3
      ? `poly_${polyCoords.map(([pLat, pLng]) => `${pLat.toFixed(4)},${pLng.toFixed(4)}`).join(";")}`
      : `coord_${latitude.toFixed(3)}_${longitude.toFixed(3)}`;
    const cached = networkAreaCache[areaCacheKey];

    if (cached) {
      // Instant restore from cache: render immediately!
      setRoadFeatures(cached.roads);
      setRiverFeatures(cached.rivers);
      render3DRoads(cached.roads, showRoads);
      render3DRivers(cached.rivers, showRivers);
      if (cached.buildings) {
        setBuildingFeatures(cached.buildings);
        render3DBuildings(cached.buildings);
      }
      setExtractedBbox(cached.bbox);
      networksLoadedRef.current = true;
    } else {
      // Clear previous entities while flying to the unvisited area
      setRoadFeatures([]);
      setRiverFeatures([]);
      setBuildingFeatures([]);
      setEvacuationRoute(null);
      networksLoadedRef.current = false;
    }
    lastViewportBboxRef.current = "";

    // Start loading the new area networks concurrently in parallel with camera flight
    scheduleSelectedAreaLoad(polyCoords);

    const onFlyComplete = () => {
      isInFlightRef.current = false;
    };

    isInFlightRef.current = true;
    if (viewMode === "flat") {
      switchToFlatView().finally(onFlyComplete);
    } else if (viewMode === "topdown") {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 8500),
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

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude - 0.045, 6500),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0.0,
      },
      duration: 1.5,
    });
  };

  // 🛰️ TOP-DOWN SATELLITE (Nadir perspective with Google Maps controls)
  const switchToTopDown = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    if (isOrbiting) stopOrbit();
    setViewMode("topdown");
    applyControllerSettings("topdown");

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 8000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-88),
        roll: 0.0,
      },
      duration: 1.4,
    });
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
            if (ageMs < MAX_AGE_MS && hasData) {
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
              lastViewportBboxRef.current = getActivePolygon()
                .map(([areaLat, areaLng]) => `${areaLat.toFixed(5)},${areaLng.toFixed(5)}`)
                .join(";");
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
        if (!networksLoadedRef.current && !isInFlightRef.current) {
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

  // Toggle Rivers visibility without re-creating entities
  useEffect(() => {
    if (riverEntitiesRef.current.length > 0) {
      riverEntitiesRef.current.forEach((ent) => {
        try { ent.show = showRivers; } catch (e) {}
      });
    }
  }, [showRivers]);


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

  // Re-render buildings dynamically when flood simulation or rain state toggles
  useEffect(() => {
    if (buildingFeatures.length > 0) {
      render3DBuildings(buildingFeatures);
    }
  }, [waterSimActive, isRaining]);

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
            const masterExists = meshNodes.some((n) => n.type === "master");
            if (masterExists) {
              setMeshNodes((prev) =>
                prev.map((n) =>
                  n.type === "master" ? { ...n, lat: clickLat, lng: clickLng } : n
                )
              );
              logUserActivity(
                "Relocated Master Gateway",
                `Moved to coords (${clickLat.toFixed(5)}° N, ${clickLng.toFixed(5)}° E)`
              );
            } else {
              const newMaster: DigitalTwinMeshNode = {
                id: "node-master",
                name: "Master Gateway",
                type: "master",
                lat: clickLat,
                lng: clickLng,
                role: "Master Gateway",
                battery: 100,
                signalDbm: -45,
                status: "online",
              };
              setMeshNodes((prev) => [newMaster, ...prev]);
              setSelectedNodeId(newMaster.id);
              logUserActivity(
                "Placed Master Gateway",
                `Positioned at (${clickLat.toFixed(5)}° N, ${clickLng.toFixed(5)}° E)`,
                newMaster
              );
              setNewNodeName("");
            }
          } else if (isPickingLocation === "slave") {
            // Add new Slave Node
            const newIdx = meshNodes.filter((n) => n.type === "slave").length + 1;
            const newSlave: DigitalTwinMeshNode = {
              id: `node-slave-${Date.now()}`,
              name: `Slave Node ${newIdx}`,
              type: "slave",
              lat: clickLat,
              lng: clickLng,
              role: "Slave Node",
              battery: 98,
              signalDbm: -66,
              status: "online",
            };
            setMeshNodes((prev) => [...prev, newSlave]);
            setSelectedNodeId(newSlave.id);
            logUserActivity(
              "Added Slave Node",
              `Placed ${newSlave.name} at (${clickLat.toFixed(5)}° N, ${clickLng.toFixed(5)}° E)`,
              newSlave
            );
            setNewNodeName("");
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
  }, [isPickingLocation, isDeleteMode, newNodeName, newNodeRole, meshNodes, deployedSensors]);



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

      {/* 🌤️ Weather Forecast Box on Left Rail (Shifted 50px down: top-[105px], 100% Opacity) */}
      <div className="absolute top-[105px] left-3 z-20 w-64 rounded-xl border border-cyan-500/50 bg-slate-950 opacity-100 p-3 shadow-2xl text-white space-y-2 animate-in fade-in slide-in-from-left-2 duration-200">
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

      {/* 🌊 Forecast Heatmap Box (20px Spaced Below Weather Forecast: top-[275px], 100% Opacity) */}
      <div className="absolute top-[275px] left-3 z-20 w-64 rounded-xl border border-cyan-500/50 bg-slate-950 opacity-100 p-3 shadow-2xl text-white space-y-2 animate-in fade-in slide-in-from-left-2 duration-200">
        <div
          onClick={() => {
            enterFullscreen();
            if (!forecastActive) setForecastActive(true);
          }}
          className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 cursor-pointer group hover:border-cyan-500/50 transition-colors"
          title="Click to view Forecast Heatmap in Fullscreen"
        >
          <div className="flex items-center gap-1.5">
            <Waves className="size-4 text-cyan-400 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-bold text-cyan-200 group-hover:text-white">Forecast Heatmap</span>
          </div>
          <button
            type="button"
            aria-pressed={forecastActive}
            onClick={(e) => {
              e.stopPropagation();
              enterFullscreen();
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
                onClick={() => {
                  enterFullscreen();
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
      </div>

      {/* 🌧️ 3D Cesium Selected Area Rain Simulation Overlay (Restricted 100% strictly inside selected boundary) */}
      <CesiumSelectedAreaRainOverlay
        viewer={cesiumViewer || viewerRef.current}
        polygonCoords={getActivePolygon()}
        active={Boolean(rainActive)}
        intensityMm={simRainIntensity}
        windSpeedKmh={simWindSpeed}
        groundHeight={groundHeightMeters}
        isFlatView={viewMode === "flat"}
      />

      {forecastActive && <TwinForecastHeatmap
        viewer={cesiumViewer || viewerRef.current}
        polygon={getActivePolygon()}
        selectedHour={forecastHour}
        onSelectedHourChange={setForecastHour}
      />}

      {/* 🌊 3D Realistic Three.js Water Simulation (OSM Water Bodies + DEM Shallow-Water Flow) */}
      <ThreeWaterSimulation
        cesiumViewer={cesiumViewer || viewerRef.current}
        centerLat={latitude}
        centerLng={longitude}
        baseElevation={groundHeightMeters}
        polygonCoords={getActivePolygon()}
        active={waterSimActive}
        onClose={() => setWaterSimActive(false)}
      />

      {/* 🌟 Smooth Cinematic Loading Fade-Out Veil */}
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

        {/* ⚙️ SIMULATION CONTROLS (SENSORS: MASTER/SLAVE & ENVIRONMENT: RAIN/INTENSITY) */}
        <div className="relative" ref={simulationDropdownRef}>
          <button
            onClick={() => {
              enterFullscreen();
              setSimulationMenuOpen((prev) => !prev);
            }}
            title="Simulation: Sensors (Master, Slave) & Environment (Rain, Rain Intensity)"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold cursor-pointer transition-all ${
              showMeshPanel || simulationMenuOpen
                ? "bg-cyan-600 text-white ring-1 ring-cyan-400 shadow-sm"
                : "hover:bg-slate-800 text-cyan-300 hover:text-white"
            }`}
          >
            <Sliders className="size-3.5 text-cyan-300" />
            <span>Simulation</span>
            <ChevronDown
              className={`size-3 text-cyan-200 transition-transform duration-150 ${
                simulationMenuOpen ? "rotate-180" : ""
              }`}
            />
            {rainActive && (
              <span className="flex h-1.5 w-1.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400"></span>
              </span>
            )}
          </button>

          {simulationMenuOpen && (
            <div
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              style={{ maxHeight: isFullscreen ? "82vh" : "calc(100% - 60px)" }}
              className="absolute top-full mt-1.5 right-0 w-84 bg-slate-900/98 backdrop-blur-md border border-cyan-500/40 rounded-xl shadow-2xl p-3 z-50 animate-in fade-in-50 zoom-in-95 duration-150 flex flex-col gap-2.5 text-left overflow-y-auto overscroll-contain custom-dt-scrollbar"
            >


              {/* MASTER / SLAVE / SENSOR MESH */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider px-0.5 flex items-center justify-between">
                  <span>IoT Sensor Mesh</span>
                  <span className="text-[9px] text-cyan-400 font-mono">
                    {meshNodes.length} nodes · {deployedSensors.length} sensors
                  </span>
                </div>
                <div
                  onClick={() => {
                    enterFullscreen();
                    setSimulationMenuOpen(false);
                    setShowEvacPanel(false);
                    setShowRainPanel(false);
                    setShowMeshPanel(true);
                  }}
                  className="p-2 bg-slate-950/70 hover:bg-slate-800/80 border border-slate-800 hover:border-cyan-500/50 rounded-lg flex items-center justify-between cursor-pointer transition-all group"
                >
                  <div>
                    <div className="text-xs font-semibold text-white group-hover:text-cyan-300">
                      IoT Mesh Nodes & Sensors
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {meshNodes.length > 0
                        ? `${masterNode ? "1 Master" : "0 Master"}, ${slaveNodes.length} Slaves, ${deployedSensors.length} Sensors`
                        : "Click to place Master, Slaves & Sensors"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      enterFullscreen();
                      setSimulationMenuOpen(false);
                      setShowEvacPanel(false);
                      setShowRainPanel(false);
                      setShowMeshPanel(true);
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                      showMeshPanel
                        ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-xs"
                        : "bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700"
                    }`}
                  >
                    {showMeshPanel ? "Active" : "Open"}
                  </button>
                </div>
              </div>

              {/* DIVIDER */}
              <div className="border-t border-slate-800" />

              {/* RAIN */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider px-0.5">
                  Rain
                </div>
                <div
                  onClick={() => {
                    enterFullscreen();
                    setSimulationMenuOpen(false);
                    setShowEvacPanel(false);
                    setShowMeshPanel(false);
                    setShowRainPanel(true);
                    if (!rainActive) {
                      handleToggleRain();
                    }
                  }}
                  className="p-2 bg-slate-950/70 hover:bg-slate-800/80 border border-slate-800 hover:border-sky-500/50 rounded-lg flex items-center justify-between cursor-pointer transition-all group"
                >
                  <div>
                    <div className="text-xs font-semibold text-white group-hover:text-sky-300">Rain Simulation</div>
                    <div className="text-[10px] text-slate-400">
                      {rainActive ? `${simRainIntensity} mm/h active` : "Off"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      enterFullscreen();
                      setSimulationMenuOpen(false);
                      setShowRainPanel(true);
                      setShowMeshPanel(false);
                      handleToggleRain();
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                      rainActive
                        ? "bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-xs"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                    }`}
                  >
                    {rainActive ? "Active (Stop)" : "Start"}
                  </button>
                </div>
              </div>

              {/* DIVIDER */}
              <div className="border-t border-slate-800" />

              {/* 4. WATER */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider px-0.5">
                  Water
                </div>
                <div
                  onClick={() => {
                    enterFullscreen();
                    setSimulationMenuOpen(false);
                    setShowEvacPanel(false);
                    setShowMeshPanel(false);
                    setShowRainPanel(false);
                    setWaterSimActive(true);
                  }}
                  className="p-2 bg-slate-950/70 hover:bg-slate-800/80 border border-slate-800 hover:border-teal-500/50 rounded-lg flex items-center justify-between cursor-pointer transition-all group"
                >
                  <div>
                    <div className="text-xs font-semibold text-white group-hover:text-teal-300">Water Simulation</div>
                    <div className="text-[10px] text-slate-400">
                      {waterSimActive ? "3D Flow active" : "Off"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      enterFullscreen();
                      setSimulationMenuOpen(false);
                      setShowMeshPanel(false);
                      setShowRainPanel(false);
                      setWaterSimActive((prev) => !prev);
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all cursor-pointer ${
                      waterSimActive
                        ? "bg-teal-600 hover:bg-teal-500 text-white shadow-xs"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                    }`}
                  >
                    {waterSimActive ? "Active (Stop)" : "Start"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>


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
                  <span>{isExtractingNetworks ? "Loading priority OSM data…" : isLoadingBuildings ? "Loading building detail…" : "OSM data complete"}</span>
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
                  onClick={() => setIsPickingLocation("master")}
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
                    Central LoRaWAN Gateway node
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setIsPickingLocation("slave")}
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
                    Relay Slave node for sensors
                  </div>
                </button>
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
                        className={`p-2 rounded-xl border flex items-center justify-between text-xs transition-all ${
                          isMaster
                            ? "bg-amber-950/40 border-amber-500/50"
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
                          onClick={() => deleteNode(node.id)}
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

      {/* 🌧️ STANDALONE RAIN SIMULATION PANEL (Shows ONLY Rain without Simulation Studio) */}
      {showRainPanel && (
        <div
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{ maxHeight: isFullscreen ? "85vh" : "calc(100% - 70px)" }}
          className={`absolute z-30 w-88 bg-slate-900/95 backdrop-blur-md border border-sky-500/50 rounded-xl p-3.5 shadow-2xl text-white flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden overscroll-contain ${
            showSrtm30 && showSrtmLegend
              ? "top-[320px] right-3"
              : "top-14 right-3"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-md bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <CloudRain className="size-3.5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white leading-tight">Rain Simulation</div>
                <div className="text-[10px] text-slate-400">Atmospheric Precipitation Engine</div>
              </div>
            </div>
            <button
              onClick={() => setShowRainPanel(false)}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              title="Close Rain Simulation Panel"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Rain Content */}
          <div 
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1.5 overscroll-contain custom-dt-scrollbar"
          >
            {/* Rain Status Card */}
            <div className="bg-gradient-to-br from-sky-950/40 via-slate-800/80 to-slate-900/90 rounded-xl p-3 border border-sky-500/50 space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-7 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-300">
                    <CloudRain className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Precipitation Engine</div>
                    <div className="text-[10px] text-sky-300/80">Selected Polygon Area</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleRain}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    rainActive
                      ? "bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-md shadow-sky-900/50"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                  }`}
                >
                  {rainActive ? "Stop Rain" : "Start Rain"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/70">
                <div>
                  <span className="text-slate-400 block text-[10px]">Status</span>
                  <span className={`font-bold ${rainActive ? "text-emerald-400" : "text-slate-400"}`}>
                    {rainActive ? "Pouring In Basin" : "Standby / Inactive"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Rainfall Rate</span>
                  <span className="font-bold text-sky-300">{simRainIntensity} mm/h</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-cyan-800/70 bg-slate-950/70 p-3">
              <label className="block text-[11px] font-semibold text-cyan-200">
                Common forecast time · +{forecastHour}h
                <input aria-label="Common forecast time" className="mt-1.5 w-full accent-cyan-400" type="range"
                  min={0} max={11} step={1} value={forecastHour}
                  onChange={event => setForecastHour(Number(event.target.value))} />
              </label>
              <p className="mt-1 text-[10px] text-slate-400">This time is shared with the GNN heatmap.</p>
            </div>

            {/* Rain Intensity Section */}
            <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Sliders className="size-3.5 text-sky-400" />
                  <span>Rain Intensity</span>
                </div>
                <span className="text-xs font-mono font-extrabold text-sky-300 bg-sky-950 px-2 py-0.5 rounded border border-sky-600/40">
                  {simRainIntensity} mm/h
                </span>
              </div>

              <input
                type="range"
                min={10}
                max={150}
                step={5}
                value={simRainIntensity}
                onChange={(e) => setSimRainIntensity(Number(e.target.value))}
                className="w-full accent-sky-400 h-1.5 bg-slate-900 rounded-lg cursor-pointer"
              />

              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: "Light", val: 30 },
                  { label: "Heavy", val: 75 },
                  { label: "Extreme", val: 120 },
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setSimRainIntensity(p.val)}
                    className={`text-xs py-1 rounded font-semibold transition-all cursor-pointer ${
                      simRainIntensity === p.val
                        ? "bg-sky-600 text-white font-bold shadow-xs"
                        : "bg-slate-900/80 text-slate-300 hover:bg-slate-700 hover:text-white"
                    }`}
                  >
                    {p.label} ({p.val})
                  </button>
                ))}
              </div>
            </div>

            {/* Wind Speed Section */}
            <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">Wind Dynamics</span>
                <span className="text-xs font-mono text-slate-300">{simWindSpeed} km/h</span>
              </div>
              <input
                type="range"
                min={0}
                max={60}
                step={2}
                value={simWindSpeed}
                onChange={(e) => setSimWindSpeed(Number(e.target.value))}
                className="w-full accent-cyan-400 h-1.5 bg-slate-900 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-400">
                <span>Calm (0)</span>
                <span>Breeze (30)</span>
                <span>Gale (60 km/h)</span>
              </div>
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
        <div className="absolute top-14 left-3 z-20 w-80 bg-slate-900/95 backdrop-blur-md border border-orange-500/40 rounded-xl p-3 shadow-2xl text-white animate-in fade-in slide-in-from-top-2 duration-200">
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
                  All Houses Monitored
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
              <div className="text-[9px] text-orange-300/80 font-medium">Clear of Paths</div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 px-0.5">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Path Clearance: Verified
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
    </div>
  );
}
