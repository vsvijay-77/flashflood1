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
} from "lucide-react";
import CesiumSelectedAreaRainOverlay from "../simulation/CesiumSelectedAreaRainOverlay";
import { toast } from "sonner";
import { generateCirclePolygon } from "@/lib/gisUtils";
import {
  extractNetworks,
  extractBuildings,
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
  const networkAbortRef = useRef<AbortController | null>(null);
  const buildingAbortRef = useRef<AbortController | null>(null);
  const isInFlightRef = useRef<boolean>(false);
  const networksLoadedRef = useRef<boolean>(false);

  const [showRoads, setShowRoads] = useState<boolean>(true);
  const [showRivers, setShowRivers] = useState<boolean>(true);
  const [showEvacPanel, setShowEvacPanel] = useState<boolean>(false);
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

  // ─── 📡 3D IOT MESH NODES (MASTER & SLAVE SENSORS) ───
  const meshNodeEntitiesRef = useRef<any[]>([]);
  const [showMeshNodes, setShowMeshNodes] = useState<boolean>(true);
  const [showMeshPanel, setShowMeshPanel] = useState<boolean>(false);
  const [isPickingLocation, setIsPickingLocation] = useState<"master" | "slave" | null>(null);
  const [isDeleteMode, setIsDeleteMode] = useState<boolean>(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const safeName = (areaName || "default").replace(/\s+/g, "_");
  const storageKey = `dt_mesh_nodes_${safeName}`;
  const activityStorageKey = `dt_user_activity_${safeName}`;
  // v6 invalidates center/viewport data saved by older viewers. Only complete
  // selected-polygon responses may be restored for an area.
  const networksStorageKey = `dt_networks_v6_${safeName}_${latitude.toFixed(4)}_${longitude.toFixed(4)}`;

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
  const isSensorDeleted = (slaveId: string, sensorKey: string) =>
    deletedSensors.has(`${slaveId}:${sensorKey}`);

  const [activePanelTab, setActivePanelTab] = useState<"master" | "slave" | "environment" | "activity">("slave");
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
      console.log(`[DT] render3DRoads: rendering ${roads.length} road ways (visible=${visible})`);

      roads.forEach((road) => {
        const coords = road.geometry?.coordinates;
        if (!coords || coords.length < 2) return;

        // Clip road line segments strictly inside the selected polygon
        const clippedSegments = clipPolylineToPolygon(coords as [number, number][], activePoly);
        if (clippedSegments.length === 0) return;

        const rType = road.properties?.road_type || "residential";
        const isMajor = road.properties?.is_major ?? ["motorway", "trunk", "primary", "secondary"].includes(rType);
        const access = road.properties?.accessibility || "open";
        const risk = road.properties?.flood_risk || 0;
        const widthPx = road.properties?.width_px;

        // Color: flooded = dark red, major = bright red, minor = muted red/salmon
        let strokeColor: string;
        let lineWidth: number;

        if (access === "flooded" || risk >= 0.7) {
          strokeColor = "#dc2626";   // Dark red — flooded
          lineWidth = widthPx ?? 6.0;
        } else if (rType === "motorway") {
          strokeColor = "#ff4444";   // Bright red
          lineWidth = widthPx ?? 7.0;
        } else if (rType === "trunk" || rType === "primary") {
          strokeColor = "#ef4444";   // Red 500
          lineWidth = widthPx ?? 5.5;
        } else if (rType === "secondary" || rType === "tertiary") {
          strokeColor = "#f87171";   // Red 400
          lineWidth = widthPx ?? 4.0;
        } else if (rType === "residential" || rType === "unclassified") {
          strokeColor = "#fca5a5";   // Red 300
          lineWidth = widthPx ?? 2.5;
        } else {
          strokeColor = "#fecaca";   // Red 200 — tracks, paths
          lineWidth = widthPx ?? 1.5;
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
              material: Cesium.Color.fromCssColorString(strokeColor).withAlpha(isMajor ? 0.95 : 0.85),
              clampToGround: true,
            },
          });
          roadEntitiesRef.current.push(ent);
        });
      });
    } finally {
      viewer.entities.resumeEvents();
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
      console.log(`[DT] render3DRivers: rendering ${rivers.length} waterway ways (visible=${visible})`);

      rivers.forEach((river) => {
        const coords = river.geometry?.coordinates;
        if (!coords || coords.length < 2) return;

        // Clip river line segments strictly inside the selected polygon
        const clippedSegments = clipPolylineToPolygon(coords as [number, number][], activePoly);
        if (clippedSegments.length === 0) return;

        const props = (river.properties as any) || {};
        const wType = (props.waterway_type || props.waterway || "stream").toLowerCase();
        const isWaterBody = Boolean(
          props.is_water_body ||
          ["water", "lake", "reservoir", "pond", "basin", "riverbank", "lagoon", "oxbow"].includes(wType)
        );
        const isMainRiver = Boolean(props.is_main_river) || wType === "river" || wType === "canal";
        const widthM = props.width_m;

        let strokeColor: string;
        let lineWidth: number;
        let alpha: number;
        let displayName: string;

        if (isWaterBody) {
          strokeColor = "#06b6d4";  // Cyan — lakes, reservoirs, ponds
          lineWidth = widthM ?? 9.0;
          alpha = 0.88;
          displayName = `💧 ${props.name || "Water Body"}`;
        } else if (wType === "river") {
          strokeColor = "#1d4ed8";  // Deep blue — main rivers
          lineWidth = widthM ?? 7.0;
          alpha = 0.95;
          displayName = `🌊 River: ${props.name || "River"}`;
        } else if (wType === "canal") {
          strokeColor = "#2563eb";  // Blue — canals
          lineWidth = widthM ?? 5.5;
          alpha = 0.92;
          displayName = `🌊 Canal: ${props.name || "Canal"}`;
        } else if (wType === "stream") {
          strokeColor = "#3b82f6";  // Blue 500 — streams
          lineWidth = widthM ?? 3.5;
          alpha = 0.88;
          displayName = `〰️ Stream: ${props.name || "Stream"}`;
        } else {
          strokeColor = "#60a5fa";  // Light blue — drains/ditches
          lineWidth = widthM ?? 2.0;
          alpha = 0.80;
          displayName = `〰️ ${wType}: ${props.name || "Waterway"}`;
        }

        clippedSegments.forEach((seg) => {
          const flatPositions = seg.flat();
          if (flatPositions.length < 4) return;

          const ent = viewer.entities.add({
            name: displayName,
            show: visible,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(flatPositions),
              width: lineWidth,
              material: Cesium.Color.fromCssColorString(strokeColor).withAlpha(alpha),
              clampToGround: true,
            },
          });
          riverEntitiesRef.current.push(ent);
        });
      });
    } finally {
      viewer.entities.resumeEvents();
      console.log(`[DT] render3DRivers: added ${riverEntitiesRef.current.length} entities to viewer`);
    }
  };

  // ─── 🏢 OSM BUILDING FOOTPRINTS ───
  // Building geometry is kept in state for the full AOI, while Cesium applies
  // distance-based visibility so dense areas remain smooth from far away.
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

      buildings.forEach((building) => {
        const source = building.geometry?.coordinates;
        if (!source) return;
        const polygons = building.geometry.type === "Polygon"
          ? [source as number[][][]]
          : source as number[][][][];
        polygons.forEach((rings) => {
          const outer = rings[0];
          if (!outer || outer.length < 4) return;
          // Only render buildings situated inside the selected polygon
          if (!isPointInPolygon(outer[0][1], outer[0][0], activePoly)) return;
          const holes = rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())));
          const height = Math.max(3, building.properties?.height_m || 6);
          const entity = viewer.entities.add({
            name: `🏢 ${building.properties?.name || building.properties?.building || "Building"}`,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(outer.flat()), holes),
              material: Cesium.Color.fromCssColorString("#94a3b8").withAlpha(0.55),
              outline: false,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              extrudedHeight: height,
              extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000),
            },
          });
          buildingEntitiesRef.current.push(entity);
        });
      });
    } finally {
      viewer.entities.resumeEvents();
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
    const routeColor = "#dc2626"; // Red color for evacuation path

    const pathEntity = viewer.entities.add({
      name: "🚨 Evacuation Path",
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(flatPositions),
        width: 6.5,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.35,
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
        pixelSize: 16,
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
        pixelSize: 18,
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
    networkAbortRef.current?.abort();
    buildingAbortRef.current?.abort();
    const controller = new AbortController();
    networkAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    setIsExtractingNetworks(true);
    try {
      // A selected polygon is authoritative. It keeps the network complete for
      // that area, regardless of where the cinematic camera happens to be.
      const viewportBbox = bboxOverride || getViewportBbox();

      const params: Parameters<typeof extractNetworks>[0] = polygonOverride
        ? { polygon: polygonOverride }
        : viewportBbox
        ? {
            north: viewportBbox.north,
            south: viewportBbox.south,
            east: viewportBbox.east,
            west: viewportBbox.west,
          }
        : {
            lat: latitude,
            lng: longitude,
            radius_km: searchRadiusKm,
            place_name: searchOverride || areaName || undefined,
          };

      console.log(`[DT] Fetching complete selected-area network: ${polygonOverride ? `${polygonOverride.length} boundary points` : viewportBbox ? `${viewportBbox.south.toFixed(3)},${viewportBbox.west.toFixed(3)} → ${viewportBbox.north.toFixed(3)},${viewportBbox.east.toFixed(3)}` : `center ${latitude},${longitude} r=${searchRadiusKm}km`}`);

      const res = await extractNetworks(params, controller.signal);

      // Never let a late response from an older request clear the completed
      // selected-area scene.
      if (requestId !== networkRequestRef.current || !viewerRef.current || viewerRef.current.isDestroyed()) {
        return;
      }

      if (res.status === "success") {
        networksLoadedRef.current = true;
        setExtractedBbox(res.bbox);
        const roads = res.roads.geojson?.features || [];
        const rivers = res.rivers.geojson?.features || [];
        const tileStatus = res.osm_loading;
        setOsmTileStatus({
          loaded: tileStatus?.loaded_tiles ?? 0,
          total: tileStatus?.total_tiles ?? 0,
          roads: roads.length,
          rivers: rivers.length,
          buildings: 0,
        });
        console.log(`[DT] API returned: ${roads.length} road ways, ${rivers.length} waterways`);

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
        // Building footprint detail is deliberately lower priority: paths and
        // waterways are visible first, and this request fills in afterward.
        void loadBuildings(params, requestId, roads, rivers, res.bbox);
      } else {
        toast.error("Network extraction failed — check backend connection");
      }
    } catch (err) {
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
    requestId: number,
    roads: RoadFeature[],
    rivers: RiverFeature[],
    bbox: BoundingBox,
  ) => {
    const controller = new AbortController();
    buildingAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    setIsLoadingBuildings(true);
    try {
      const res = await extractBuildings(params, controller.signal);
      if (requestId !== networkRequestRef.current || !viewerRef.current || viewerRef.current.isDestroyed()) return;
      const buildings = res.buildings.geojson?.features || [];
      setBuildingFeatures(buildings);
      setOsmTileStatus((current) => ({
        ...current,
        buildings: buildings.length,
      }));
      render3DBuildings(buildings);
      try {
        localStorage.setItem(networksStorageKey, JSON.stringify({
          roads,
          rivers,
          buildings,
          bbox,
          timestamp: Date.now(),
        }));
      } catch (e) {}
    } catch (err) {
      console.error("Failed to extract building footprints:", err);
      toast.warning("Paths and waterways are ready; building detail is still unavailable");
    } finally {
      window.clearTimeout(timeout);
      if (requestId === networkRequestRef.current) setIsLoadingBuildings(false);
    }
  };

  // ─── 📐 SELECTED-AREA NETWORK LOADING ───
  // Load exactly once after the intro flight. The old viewport loader started
  // several overlapping requests and repeatedly replaced the network mid-load.
  const scheduleSelectedAreaLoad = () => {
    if (isInFlightRef.current) return;
    if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
    viewportDebounceRef.current = setTimeout(() => {
      if (isInFlightRef.current) return;
      const selectedPolygon = getActivePolygon();
      const areaKey = selectedPolygon
        .map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
        .join(";");
      if (areaKey === lastViewportBboxRef.current) return;
      lastViewportBboxRef.current = areaKey;
      handleExtractNetworks(undefined, undefined, selectedPolygon);
    }, 200);
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
      const north = extractedBbox?.north || latitude + 0.015;
      const south = extractedBbox?.south || latitude - 0.015;
      const east = extractedBbox?.east || longitude + 0.015;
      const west = extractedBbox?.west || longitude - 0.015;

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
      render3DEvacuationRoute(res);
    } catch (err) {
      console.error("Failed to calculate evacuation route:", err);
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
    if (!showMeshNodes || validNodes.length === 0) return;

    const master = validNodes.find((n) => n.type === "master") || validNodes[0];
    if (!master) return;

    // 1. Render Master Node (Golden Amber Mast + Radar Footprint)
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
        text: `📡 MASTER GATEWAY\n${master.name} • 915MHz Base`,
        font: "bold 26px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
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

    const masterRadar = viewer.entities.add({
      id: `radar-${master.id}`,
      name: `Radar Coverage: ${master.name}`,
      position: Cesium.Cartesian3.fromDegrees(master.lng, master.lat),
      ellipse: {
        semiMajorAxis: 240.0,
        semiMinorAxis: 240.0,
        granularity: Cesium.Math.toRadians(4),
        material: Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.18),
        outline: false,
        height: 0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
    (masterRadar as any)._nodeId = master.id;
    meshNodeEntitiesRef.current.push(masterRadar);

    // 2. Render Slave Nodes & Continuous 3D Connection Lines
    const slaves = validNodes.filter((n) => n.id !== master.id);

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
          text: `⚡ SLAVE #${idx + 1}: ${slave.name}\n[${slave.role}]`,
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

      // ALWAYS-ON 3D CONNECTION LINK (MASTER ↔ SLAVE)
      // Clamped glow polyline draped over 3D terrain
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
            color: Cesium.Color.fromCssColorString("#00f0ff"), // Glowing electric cyan RF laser
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
          text: `🔗 RF LINK: ${distKm < 1 ? Math.round(distKm * 1000) + "m" : distKm.toFixed(2) + "km"} • ${slave.signalDbm} dBm • 100% OK`,
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

  const addPresetSlaveNode = (presetType: "inflow" | "depth" | "rain" | "outfall") => {
    const master = meshNodes.find((n) => n.type === "master");
    const refLat = master ? master.lat : latitude;
    const refLng = master ? master.lng : longitude;
    const offsetMap = {
      inflow: { dLat: 0.006, dLng: -0.009, name: "Upstream Inflow Sentry", role: "River Inflow Doppler Velocity" },
      depth: { dLat: -0.008, dLng: -0.004, name: "Flash Inundation Sensor", role: "Ultrasonic Water Depth Sensor" },
      rain: { dLat: 0.009, dLng: 0.007, name: "High-Altitude Rain Station", role: "Radar Precipitation Sensor" },
      outfall: { dLat: -0.009, dLng: 0.008, name: "Downstream Outfall Monitor", role: "Flood Discharge Gauge" },
    };
    const p = offsetMap[presetType];
    const newSlave: DigitalTwinMeshNode = {
      id: `node-slave-${Date.now()}`,
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
    logUserActivity("Added Preset Slave", `Added ${newSlave.name} [${newSlave.role}]`, newSlave);
  };

  const clearAllNodes = () => {
    setMeshNodes([]);
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

    // If layer already loaded — just update visibility and opacity
    if (srtmLayerRef.current) {
      srtmLayerRef.current.show = visible;
      srtmLayerRef.current.alpha = opacity;
      return;
    }

    // Only bother loading the imagery if it should be visible
    if (!visible) return;

    try {
      let srtmTileUrl = "";

      // 1. Attempt to fetch real-time Google Earth Engine SRTM 30m DEM tile endpoint
      try {
        const res = await fetch("/api/gee/layer-tiles?layer=elevation");
        if (res.ok) {
          const data = await res.json();
          if (data && data.tileUrl) {
            srtmTileUrl = data.tileUrl;
          }
        }
      } catch (e) {
        console.warn("GEE SRTM 30 tile fetch notice, using topography fallback:", e);
      }

      // 2. High-reliability fallback using OpenTopoMap (SRTM 30m elevation contours & hillshade)
      if (!srtmTileUrl) {
        srtmTileUrl = "https://tile.opentopomap.org/{z}/{x}/{y}.png";
      }

      const srtmProvider = new Cesium.UrlTemplateImageryProvider({
        url: srtmTileUrl,
        maximumLevel: 17,
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
    if (srtmLayerRef.current) {
      // Layer already loaded — just flip visibility
      srtmLayerRef.current.show = nextState;
    } else if (nextState && viewerRef.current) {
      // Load it fresh and show immediately
      loadSrtmLayer(viewerRef.current, srtmOpacity, true);
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
          width: 3.5,
          material: new Cesium.PolylineOutlineMaterialProperty({
            color: Cesium.Color.fromCssColorString("#38bdf8"),
            outlineColor: Cesium.Color.fromCssColorString("#0284c7"),
            outlineWidth: 1.5,
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
        });

        viewerRef.current = viewer;
        setCesiumViewer(viewer);

        // High-performance 60 FPS resolution configuration (prevents GPU fill-rate exhaustion)
        viewer.useBrowserRecommendedResolution = true;
        viewer.resolutionScale = 1.0;

        // Configure High-Performance Photorealistic Atmosphere & 3D Terrain
        const scene = viewer.scene;
        scene.globe.depthTestAgainstTerrain = false;
        scene.globe.enableLighting = false; // Disabled dynamic terrain vertex lighting calculation for 60 FPS
        scene.globe.showGroundAtmosphere = true;
        scene.globe.terrainExaggeration = 1.0;
        scene.globe.maximumScreenSpaceError = 2.5; // Fast LOD terrain mesh streaming
        scene.globe.tileCacheSize = 100;
        scene.globe.preloadAncestors = false;
        scene.globe.preloadSiblings = false;
        scene.globe.baseColor = Cesium.Color.BLACK; // Deep black base for outside imagery
        scene.backgroundColor = Cesium.Color.BLACK;
        scene.globe.undergroundColor = Cesium.Color.BLACK;

        // Apply Google Maps camera controller configuration (3D mode by default)
        applyControllerSettings("3d");

        scene.skyAtmosphere.show = true;
        scene.fog.enabled = true;
        scene.fog.density = 0.0002;

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

        // Load SRTM 30m DEM Elevation Topography Layer (NASA / USGS SRTMGL1_003)
        if (showSrtm30) {
          loadSrtmLayer(viewer, srtmOpacity, true);
        }

        // Render Master & Slave 3D IoT Mesh Nodes & Connection Links
        render3DMeshNodes(meshNodes);


        // 🚀 Smooth Cinematic Entry: Starting in Space & Descending to Earth
        isInFlightRef.current = true;
        // 1. Initial view: High orbital altitude looking down at the curved blue Earth (16,000 km in space)
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 16000000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-90),
            roll: 0.0,
          },
        });

        // Dismiss loading screen immediately so user watches the journey down to Earth
        setLoading(false);

        // 2. Stage 1: Plunge from space down to regional atmosphere (from 16,000km to 75km)
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude - 0.12, 75000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-65),
            roll: 0.0,
          },
          duration: 2.4,
          easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
          complete: () => {
            if (!viewerRef.current || viewerRef.current.isDestroyed()) {
              isInFlightRef.current = false;
              return;
            }
            // 3. Stage 2: Smooth descent into high-resolution 3D oblique perspective (6,500m at -45° tilt)
            viewerRef.current.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(longitude, latitude - 0.045, 6500),
              orientation: {
                heading: Cesium.Math.toRadians(0),
                pitch: Cesium.Math.toRadians(-45),
                roll: 0.0,
              },
              duration: 2.2,
              easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
              complete: () => {
                isInFlightRef.current = false;
                scheduleSelectedAreaLoad();
              },
              cancel: () => {
                isInFlightRef.current = false;
                scheduleSelectedAreaLoad();
              },
            });
          },
          cancel: () => {
            isInFlightRef.current = false;
          },
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

        // 🎮 WASD & FLAT VIEW TICK LOOP (preRender)
        scene.preRender.addEventListener(() => {
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

          if (!hasMovement) return;

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
            const walkSpeed = Math.min(50.0, Math.max(5.5, heightAboveGround * 0.35));
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
              const climb = Math.min(10.0, Math.max(0.4, heightAboveGround * 0.035));
              cam.moveUp(climb);
            }
            if (flags.down) {
              const descend = Math.min(10.0, Math.max(0.4, heightAboveGround * 0.035));
              if (curAlt - descend >= groundHeightMeters + 1.2) {
                cam.moveDown(descend);
              }
            }
            if (flags.turnLeft) {
              const newHeading = Cesium.Math.zeroToTwoPi(cam.heading - Cesium.Math.toRadians(1.2));
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
              const newHeading = Cesium.Math.zeroToTwoPi(cam.heading + Cesium.Math.toRadians(1.2));
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
            const moveSpeed = Math.max(16.0, curH * 0.08);

            if (flags.forward) cam.moveForward(moveSpeed);
            if (flags.backward) cam.moveBackward(moveSpeed);
            if (flags.left) cam.moveLeft(moveSpeed);
            if (flags.right) cam.moveRight(moveSpeed);
            if (flags.up) cam.moveUp(moveSpeed * 0.7);
            if (flags.down) cam.moveDown(moveSpeed * 0.7);

            if (flags.turnLeft) cam.lookLeft(Cesium.Math.toRadians(1.2));
            if (flags.turnRight) cam.lookRight(Cesium.Math.toRadians(1.2));
            if (flags.lookUp) cam.lookUp(Cesium.Math.toRadians(0.8));
            if (flags.lookDown) cam.lookDown(Cesium.Math.toRadians(0.8));
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

  // React to Latitude / Longitude / Polygon changes
  useEffect(() => {
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

    // Reset network state so the new area triggers a fresh API load
    networksLoadedRef.current = false;
    lastViewportBboxRef.current = "";

    const onFlyComplete = () => {
      isInFlightRef.current = false;
      scheduleSelectedAreaLoad();
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

      orbitListenerRef.current = viewer.scene.preRender.addEventListener(() => {
        if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
        angle += 0.0025;
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

  // Sync 3D Mesh Nodes whenever state or visibility changes
  useEffect(() => {
    if (viewerRef.current && !viewerRef.current.isDestroyed()) {
      render3DMeshNodes(meshNodes);
    }
  }, [meshNodes, showMeshNodes]);

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

  // Interactive 3D Terrain & Entity Click Handler (Place, Select, or Delete Node)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const scene = viewer.scene;
    const clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);

    clickHandler.setInputAction((click: any) => {
      // 1. Check if a 3D Mesh Node entity was clicked
      const picked = scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id) {
        const entity = picked.id;
        const targetId =
          (entity as any)?._nodeId ||
          (typeof entity?.id === "string" && entity.id.startsWith("mesh-node-")
            ? entity.id.replace("mesh-node-", "")
            : null);
        const clickedNode = meshNodes.find((n) => n.id === targetId || n.id === entity?.id);

        if (clickedNode) {
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
        const cartesian = scene.globe.pick(ray, scene);
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
                name: newNodeName.trim() || "Basin Central Gateway Alpha",
                type: "master",
                lat: clickLat,
                lng: clickLng,
                role: "Central Gateway & Telemetry Master",
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
          } else {
            // Add new Slave Node
            const newIdx = meshNodes.filter((n) => n.type === "slave").length + 1;
            const newSlave: DigitalTwinMeshNode = {
              id: `node-slave-${Date.now()}`,
              name: newNodeName.trim() || `Basin Sensor Station ${newIdx}`,
              type: "slave",
              lat: clickLat,
              lng: clickLng,
              role: newNodeRole.trim() || "Multi-Parameter Water Gauge",
              battery: 98,
              signalDbm: -66,
              status: "online",
            };
            setMeshNodes((prev) => [...prev, newSlave]);
            setSelectedNodeId(newSlave.id);
            logUserActivity(
              "Added Slave Node",
              `Placed ${newSlave.name} [${newSlave.role}] at (${clickLat.toFixed(5)}° N, ${clickLng.toFixed(5)}° E)`,
              newSlave
            );
            setNewNodeName("");
          }
          setIsPickingLocation(null);
        }
      } else if (!isDeleteMode) {
        // Deselect if clicking on empty terrain
        setSelectedNodeId(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Cancel on right click
    clickHandler.setInputAction(() => {
      setIsPickingLocation(null);
      setIsDeleteMode(false);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    return () => {
      try {
        clickHandler.destroy();
      } catch (e) {}
    };
  }, [isPickingLocation, isDeleteMode, newNodeName, newNodeRole, meshNodes]);



  // Directional button helpers for touch & mouse free movement
  const setMoveFlag = (key: keyof typeof movementFlagsRef.current, active: boolean) => {
    movementFlagsRef.current[key] = active;
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-slate-950 border border-slate-800 shadow-xl transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-[9999] w-screen h-screen rounded-none border-none"
          : `w-full rounded-xl ${className}`
      }`}
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      {/* CSS rule hiding any Cesium branding/credits/logo completely */}
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
      `}</style>

      {/* Cesium WebGL Viewport */}
      <div ref={cesiumContainerRef} className="w-full h-full" />

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

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30 text-white">
          <Loader2 className="size-8 text-sky-400 animate-spin" />
          <div className="text-center space-y-1">
            <p className="text-sm font-bold text-white tracking-wide">
              Loading 3D Satellite Terrain…
            </p>
            <p className="text-xs text-slate-400">
              Streaming high-resolution elevation & aerial imagery
            </p>
          </div>
        </div>
      )}

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
            onClick={() => setSimulationMenuOpen((prev) => !prev)}
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
            <div className="absolute top-full mt-1.5 right-0 w-72 bg-slate-900/98 backdrop-blur-md border border-cyan-500/50 rounded-xl shadow-2xl p-3 z-50 animate-in fade-in-50 zoom-in-95 duration-150 flex flex-col gap-3 text-left">
              {/* SECTION 1: SENSORS */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-1">
                  <span className="flex items-center gap-1 text-cyan-400">
                    <Radio className="size-3" /> Sensors
                  </span>
                  <span className="text-slate-400 font-normal">
                    {meshNodes.length} Total
                  </span>
                </div>

                <div className="space-y-1">
                  {/* Master */}
                  <button
                    type="button"
                    onClick={() => {
                      setSimulationMenuOpen(false);
                      setActivePanelTab("master");
                      setShowMeshPanel(true);
                    }}
                    className={`w-full flex items-center justify-between p-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showMeshPanel && activePanelTab === "master"
                        ? "bg-amber-950/90 text-white border border-amber-500 ring-1 ring-amber-400/50"
                        : "bg-slate-950/60 hover:bg-slate-800 text-slate-200 border border-slate-800/80"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-md bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                        <Radio className="size-3.5" />
                      </div>
                      <div className="text-left min-w-0">
                        <div className="font-bold text-white text-xs">Master</div>
                        <div className="text-[10px] text-amber-300 truncate">
                          {masterNode ? "Active Gateway" : "Disconnected"}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-amber-300 bg-amber-900/60 px-2 py-0.5 rounded border border-amber-500/30 shrink-0">
                      Open Tab →
                    </span>
                  </button>

                  {/* Slave */}
                  <button
                    type="button"
                    onClick={() => {
                      setSimulationMenuOpen(false);
                      setActivePanelTab("slave");
                      setShowMeshPanel(true);
                    }}
                    className={`w-full flex items-center justify-between p-2 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      showMeshPanel && activePanelTab === "slave"
                        ? "bg-cyan-950/90 text-white border border-cyan-500 ring-1 ring-cyan-400/50"
                        : "bg-slate-950/60 hover:bg-slate-800 text-slate-200 border border-slate-800/80"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-md bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
                        <Share2 className="size-3.5" />
                      </div>
                      <div className="text-left min-w-0">
                        <div className="font-bold text-white text-xs">Slave</div>
                        <div className="text-[10px] text-cyan-300 truncate">
                          {slaveNodes.length > 0 ? `${slaveNodes.length} Online • Active` : "0 Connected"}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-cyan-300 bg-cyan-900/60 px-2 py-0.5 rounded border border-cyan-500/30 shrink-0">
                      Open Tab →
                    </span>
                  </button>

                  {/* Sensor Points (Violet) */}
                  <button
                    type="button"
                    onClick={() => {
                      setSimulationMenuOpen(false);
                      setActivePanelTab("slave");
                      setShowMeshPanel(true);
                    }}
                    className="w-full flex items-center justify-between p-2 rounded-lg text-xs font-semibold cursor-pointer transition-all bg-slate-950/60 hover:bg-slate-800 text-slate-200 border border-slate-800/80"
                  >
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-md bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-violet-300 shrink-0">
                        <Activity className="size-3.5" />
                      </div>
                      <div className="text-left min-w-0">
                        <div className="font-bold text-violet-300 text-xs">Sensor Points</div>
                        <div className="text-[10px] text-violet-400 truncate">
                          {slaveNodes.length > 0 ? `${slaveNodes.length * 6} Telemetry Nodes` : "0 Connected"}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-violet-300 bg-violet-900/60 px-2 py-0.5 rounded border border-violet-500/30 shrink-0">
                      View →
                    </span>
                  </button>
                </div>
              </div>

              {/* DIVIDER */}
              <div className="border-t border-slate-800" />

              {/* SECTION 2: ENVIRONMENT */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-1">
                  <span className="flex items-center gap-1 text-sky-400">
                    <CloudRain className="size-3" /> Environment
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                    rainActive
                      ? "bg-sky-500/20 text-sky-300 border border-sky-400/40 animate-pulse"
                      : "bg-slate-800 text-slate-400"
                  }`}>
                    {rainActive ? "Active Pouring" : "Standby"}
                  </span>
                </div>

                {/* Rain Toggle & State */}
                <div className="p-2 bg-slate-950/70 border border-slate-800 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="size-6 rounded-md bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-300 shrink-0">
                      <CloudRain className="size-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">Rain</div>
                      <div className="text-[10px] text-slate-400">
                        {rainActive ? "Precipitation active" : "No precipitation"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleRain}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                      rainActive
                        ? "bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-sm"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                    }`}
                  >
                    {rainActive ? "Stop" : "Start"}
                  </button>
                </div>

                {/* Rain Intensity */}
                <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Rain Intensity</span>
                    <span className="text-xs font-mono font-bold text-sky-300 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-600/40">
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
                    className="w-full accent-sky-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />

                  {/* Quick Presets */}
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { label: "Light", val: 30 },
                      { label: "Heavy", val: 75 },
                      { label: "Extreme", val: 120 },
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setSimRainIntensity(p.val)}
                        className={`text-[10px] py-0.8 rounded font-semibold transition-all cursor-pointer ${
                          simRainIntensity === p.val
                            ? "bg-sky-600 text-white font-bold"
                            : "bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-white"
                        }`}
                      >
                        {p.label} ({p.val})
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* FOOTER ACTIONS */}
              <button
                type="button"
                onClick={() => {
                  setSimulationMenuOpen(false);
                  setActivePanelTab("environment");
                  setShowMeshPanel(true);
                }}
                className="w-full mt-1 py-1.5 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white font-bold text-xs rounded-lg text-center transition-all cursor-pointer shadow-sm"
              >
                Open Simulation Studio Panel →
              </button>
              <button
                type="button"
                onClick={() => {
                  setSimulationMenuOpen(false);
                  navigate("/environmental");
                }}
                className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 font-bold text-xs rounded-lg text-center transition-all cursor-pointer border border-slate-700"
              >
                📡 View Sensor Deploy Data →
              </button>
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


      {/* 🎯 Interactive 3D Terrain Node Placement Banner */}
      {isPickingLocation && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold text-xs px-4 py-2 rounded-full shadow-2xl flex items-center gap-2.5 border border-cyan-300 animate-bounce">
          <Crosshair className="size-4 animate-spin text-cyan-200" />
          <span>Click on 3D terrain to place {isPickingLocation === "master" ? "MASTER GATEWAY" : "SLAVE SENSOR"} node</span>
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
              disabled={isCalculatingRoute || roadFeatures.length === 0}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-bold py-2.5 px-3 rounded-lg text-xs shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              {isCalculatingRoute ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Computing Optimal Risk-Weighted Path...</span>
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

      {/* 📡 ADD SENSOR (3D IOT MESH NETWORK CONTROL PANEL) */}
      {showMeshPanel && (
        <div
          className={`absolute z-30 w-88 max-h-[82vh] bg-slate-900/95 backdrop-blur-md border border-cyan-500/50 rounded-xl p-3.5 shadow-2xl text-white flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden ${
            showSrtm30 && showSrtmLegend
              ? "top-[320px] right-3"
              : "top-14 right-3"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                <Sliders className="size-3.5 text-cyan-400" />
              </div>
              <div>
                <div className="text-xs font-bold text-white leading-tight">Simulation Studio</div>
                <div className="text-[10px] text-slate-400">Sensors (Master/Slave) & Environment (Rain)</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowMeshNodes((prev) => !prev)}
                title={showMeshNodes ? "Hide 3D Nodes & Links" : "Show 3D Nodes & Links"}
                className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
                  showMeshNodes
                    ? "bg-cyan-700/80 text-cyan-100 hover:bg-cyan-700"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                {showMeshNodes ? "Visible" : "Hidden"}
              </button>
              <button
                onClick={() => setShowMeshPanel(false)}
                className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                title="Close Panel"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Simulation Tabs: Environment, Slave, Master, History */}
          <div className="grid grid-cols-[1.1fr_1fr_1fr_auto] gap-1 shrink-0">
            {/* Tab 1: Environment */}
            <button
              type="button"
              onClick={() => setActivePanelTab("environment")}
              className={`p-2 rounded-xl text-left transition-all cursor-pointer border ${
                activePanelTab === "environment"
                  ? "bg-sky-950/80 border-sky-400 ring-2 ring-sky-500/40 shadow-md shadow-sky-950/50"
                  : "bg-slate-950/60 hover:bg-slate-900/90 border-slate-800/80 text-slate-400 hover:text-white"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1 font-bold text-[11px] text-white">
                  <CloudRain className="size-3 text-sky-400" />
                  <span>Rain</span>
                </div>
                <span className="relative flex h-2 w-2 shrink-0">
                  {rainActive ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400"></span>
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-600"></span>
                  )}
                </span>
              </div>
              <div className="text-[10px] font-mono font-bold text-sky-300 truncate">
                {rainActive ? `${simRainIntensity} mm/h` : "Standby"}
              </div>
            </button>

            {/* Tab 2: Slave */}
            <button
              type="button"
              onClick={() => setActivePanelTab("slave")}
              className={`p-2 rounded-xl text-left transition-all cursor-pointer border ${
                activePanelTab === "slave"
                  ? "bg-cyan-950/80 border-cyan-400 ring-2 ring-cyan-500/40 shadow-md shadow-cyan-950/50"
                  : "bg-slate-950/60 hover:bg-slate-900/90 border-slate-800/80 text-slate-400 hover:text-white"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1 font-bold text-[11px] text-white">
                  <Share2 className="size-3 text-cyan-400" />
                  <span>Slave</span>
                </div>
                <span className="relative flex h-2 w-2 shrink-0">
                  {slaveNodes.length > 0 ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-600"></span>
                  )}
                </span>
              </div>
              <div className="text-[10px] font-mono font-bold text-cyan-300 truncate">
                {slaveNodes.length > 0 ? `${slaveNodes.length} Online` : "0 Nodes"}
              </div>
            </button>

            {/* Tab 3: Master */}
            <button
              type="button"
              onClick={() => setActivePanelTab("master")}
              className={`p-2 rounded-xl text-left transition-all cursor-pointer border ${
                activePanelTab === "master"
                  ? "bg-amber-950/80 border-amber-400 ring-2 ring-amber-500/40 shadow-md shadow-amber-950/50"
                  : "bg-slate-950/60 hover:bg-slate-900/90 border-slate-800/80 text-slate-400 hover:text-white"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1 font-bold text-[11px] text-white">
                  <Radio className="size-3 text-amber-400" />
                  <span>Master</span>
                </div>
                <span className="relative flex h-2 w-2 shrink-0">
                  {masterNode ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-600"></span>
                  )}
                </span>
              </div>
              <div className="text-[10px] font-mono font-bold text-amber-300 truncate">
                {masterNode ? "Active" : "Off"}
              </div>
            </button>

            {/* Tab 4: History */}
            <button
              type="button"
              onClick={() => setActivePanelTab("activity")}
              title="Audit & Activity History"
              className={`px-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center ${
                activePanelTab === "activity"
                  ? "bg-slate-700 text-white border-slate-500 ring-2 ring-slate-400/40"
                  : "bg-slate-950/60 hover:bg-slate-900/90 border-slate-800/80 text-slate-400 hover:text-white"
              }`}
            >
              <History className="size-3.5" />
            </button>
          </div>

          {/* TAB 0: ENVIRONMENT (RAIN & RAIN INTENSITY) */}
          {activePanelTab === "environment" && (
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[48vh]">
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

                {/* Direct shortcut to Slave Node Telemetry details */}
                <button
                  type="button"
                  onClick={() => setActivePanelTab("slave")}
                  className="w-full py-1.5 px-2 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
                >
                  <Share2 className="size-3.5 text-cyan-400" />
                  <span>View Telemetry Sensor Details in Slave Node ➔</span>
                </button>
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
                  className="w-full accent-sky-400 h-2 bg-slate-900 rounded-lg cursor-pointer"
                />

                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  {[
                    { label: "Light", val: 30, desc: "Drizzle" },
                    { label: "Heavy", val: 75, desc: "Basin Saturation" },
                    { label: "Torrential", val: 120, desc: "Flash Risk" },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setSimRainIntensity(p.val)}
                      className={`p-1.5 rounded-lg text-left transition-all cursor-pointer border ${
                        simRainIntensity === p.val
                          ? "bg-sky-900/70 border-sky-400 text-white font-bold"
                          : "bg-slate-900/60 hover:bg-slate-800 border-slate-800 text-slate-300"
                      }`}
                    >
                      <div className="text-[10px] font-bold">{p.label}</div>
                      <div className="text-[9px] text-sky-300/80">{p.val} mm/h</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Atmospheric Wind Vector */}
              <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60 space-y-2">
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
          )}

          {/* TAB 1: MASTER VIEW */}
          {activePanelTab === "master" && (
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[48vh]">
              {masterNode ? (
                <div className="bg-gradient-to-br from-amber-950/30 via-slate-800/80 to-slate-900/90 rounded-xl p-3 border border-amber-500/50 space-y-3 shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[9px] font-extrabold bg-amber-500 text-slate-950 uppercase tracking-wide">
                      📡 Master Gateway
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold bg-emerald-950/50 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Active • Connected
                    </span>
                  </div>

                  <div>
                    <div className="font-bold text-sm text-white">{masterNode.name}</div>
                    <div className="text-[11px] text-amber-200/80 mt-0.5">{masterNode.role}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-black/30 p-2 rounded-lg border border-white/5 text-slate-300">
                    <div>Lat: {masterNode.lat.toFixed(5)}°N</div>
                    <div>Lng: {masterNode.lng.toFixed(5)}°E</div>
                    <div>Power: {masterNode.battery}% (Solar)</div>
                    <div>Signal: {masterNode.signalDbm} dBm</div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => focusOnNode(masterNode)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 bg-amber-600/90 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer active:scale-95 transition-all"
                      title="Focus on Master Gateway in 3D"
                    >
                      <Crosshair className="size-3.5" />
                      <span>Focus 3D</span>
                    </button>
                    <button
                      onClick={() => setIsPickingLocation("master")}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 hover:text-white rounded-lg text-xs font-semibold cursor-pointer active:scale-95 transition-all"
                      title="Click on 3D terrain to reposition Master"
                    >
                      <MapPin className="size-3.5 text-amber-300" />
                      <span>Move</span>
                    </button>
                    <button
                      onClick={() => deleteNode(masterNode.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/50 rounded-lg text-xs font-bold shadow-xs cursor-pointer active:scale-95 transition-all"
                      title="Delete Master Gateway"
                    >
                      <Trash2 className="size-3.5 text-rose-400" />
                      <span>Delete Master</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-800/60 border border-dashed border-amber-500/40 rounded-xl p-4 text-center space-y-3">
                  <div className="size-10 rounded-full bg-amber-950/80 border border-amber-400/40 flex items-center justify-center mx-auto text-amber-300">
                    <Radio className="size-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">No Master Gateway</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Place the Master gateway to establish central communication for slave sensors.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 pt-1">
                    <button
                      onClick={() => setIsPickingLocation("master")}
                      className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow-md cursor-pointer active:scale-95 transition-all"
                    >
                      <Crosshair className="size-3.5" />
                      <span>Click Map to Place Master</span>
                    </button>
                    <button
                      onClick={addMasterAtCenter}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-[10px] font-semibold cursor-pointer transition-all"
                    >
                      <MapPin className="size-3 text-amber-300" />
                      <span>Place Master at Center</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SLAVE VIEW */}
          {activePanelTab === "slave" && (
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[48vh]">
              {/* Add Slave Controls */}
              <div className="space-y-2 bg-slate-950/50 rounded-xl p-2.5 border border-slate-800">
                <button
                  onClick={() => setIsPickingLocation("slave")}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold shadow-sm cursor-pointer active:scale-95 transition-all"
                >
                  <Crosshair className="size-3.5" />
                  <span>+ Click Map to Add Slave Sensor</span>
                </button>
                <button
                  onClick={() => navigate("/environmental")}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/50 rounded-lg text-xs font-bold cursor-pointer active:scale-95 transition-all"
                >
                  <span>📡 View Deployed Sensor Data →</span>
                </button>

                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    onClick={() => addPresetSlaveNode("inflow")}
                    className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700/80 text-[11px] text-slate-200 rounded-md border border-slate-700/60 text-left font-medium truncate cursor-pointer transition-colors"
                    title="Add Upstream River Inflow Doppler Station"
                  >
                    + River Inflow
                  </button>
                  <button
                    onClick={() => addPresetSlaveNode("depth")}
                    className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700/80 text-[11px] text-slate-200 rounded-md border border-slate-700/60 text-left font-medium truncate cursor-pointer transition-colors"
                    title="Add Reservoir Depth & Pressure Gauge"
                  >
                    + Depth Gauge
                  </button>
                  <button
                    onClick={() => addPresetSlaveNode("rain")}
                    className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700/80 text-[11px] text-slate-200 rounded-md border border-slate-700/60 text-left font-medium truncate cursor-pointer transition-colors"
                    title="Add High-Altitude Optical Rain Station"
                  >
                    + Rain Gauge
                  </button>
                  <button
                    onClick={() => addPresetSlaveNode("outfall")}
                    className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700/80 text-[11px] text-slate-200 rounded-md border border-slate-700/60 text-left font-medium truncate cursor-pointer transition-colors"
                    title="Add Flood Outfall Monitor"
                  >
                    + Outfall Sentry
                  </button>
                </div>
              </div>

              {/* Slaves List Header */}
              <div className="flex flex-col gap-1.5 px-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Connected Slaves ({slaveNodes.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsDeleteMode((prev) => !prev)}
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold cursor-pointer transition-all ${
                        isDeleteMode
                          ? "bg-rose-600 text-white animate-pulse"
                          : "text-rose-400 hover:text-rose-300 hover:bg-slate-800"
                      }`}
                      title="Click any node on the 3D map to delete it"
                    >
                      {isDeleteMode ? "✕ Exit Delete" : "🗑️ Delete Mode"}
                    </button>
                    {slaveNodes.length > 0 && (
                      <button
                        onClick={() => setMeshNodes((p) => p.filter((n) => n.type === "master"))}
                        className="text-[9px] text-rose-400 hover:text-rose-300 underline cursor-pointer"
                        title="Remove all slave nodes"
                      >
                        Clear Slaves
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 border border-amber-700/40">● Master</span>
                  <span className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded bg-cyan-900/50 text-cyan-300 border border-cyan-700/40">● Slave</span>
                  <span className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-700/40">● Sensor</span>
                </div>
              </div>

              {/* Slave Cards */}
              {slaveNodes.length === 0 ? (
                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 text-center text-xs text-slate-400">
                  No slave sensors connected yet. Click above or select a preset to add telemetry stations.
                </div>
              ) : (
                <div className="space-y-2">
                  {slaveNodes.map((slave, idx) => {
                    const distKm = masterNode ? calculateDistanceKm(masterNode.lat, masterNode.lng, slave.lat, slave.lng) : 0;
                    return (
                      <div
                        key={slave.id}
                        className={`bg-slate-800/70 hover:bg-slate-800 rounded-xl p-2.5 border border-cyan-500/30 transition-all ${
                          selectedNodeId === slave.id ? "ring-2 ring-cyan-400 shadow-cyan-500/20" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-950 text-cyan-200 border border-cyan-500/40">
                            ⚡ SLAVE #{idx + 1}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => focusOnNode(slave)}
                              className="text-cyan-400 hover:text-cyan-200 p-1 hover:bg-slate-700/60 rounded cursor-pointer"
                              title="Focus in 3D"
                            >
                              <Crosshair className="size-3" />
                            </button>
                            <button
                              onClick={() => setNodeAsMaster(slave.id)}
                              className="text-[9px] text-amber-400 hover:text-amber-300 px-1.5 py-0.5 hover:bg-slate-700/60 rounded cursor-pointer"
                              title="Promote to Master Node"
                            >
                              Make Master
                            </button>
                            <button
                              onClick={() => deleteNode(slave.id)}
                              className="text-rose-400 hover:text-rose-300 p-1 hover:bg-slate-700/60 rounded cursor-pointer"
                              title="Delete Slave Node"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </div>

                        <div className="font-bold text-xs text-white mt-1">{slave.name}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{slave.role}</div>

                        {/* Network Topology Connection Banner: Telemetry Sensors -> Slave -> Master */}
                        <div className="mt-2 p-1.5 bg-slate-950/80 rounded-lg border border-slate-800 text-[9px] text-slate-300 flex items-center justify-between font-mono">
                          <span className="flex items-center gap-1 text-cyan-300 font-bold">
                            <Radio className="size-2.5 text-cyan-400" />
                            <span>6 Telemetry Sensors</span>
                          </span>
                          <span className="text-slate-500">➔</span>
                          <span className="text-cyan-400 font-bold">Slave #{idx + 1}</span>
                          <span className="text-slate-500">➔</span>
                          <span className="text-amber-400 font-bold truncate max-w-[90px]" title={masterNode ? masterNode.name : "Master Gateway"}>
                            {masterNode ? masterNode.name : "Master Gateway"}
                          </span>
                        </div>

                        {/* 6 Connected Telemetry Sensor Points */}
                        <div className="mt-2 space-y-1">
                          <div className="text-[9px] font-extrabold uppercase tracking-wider text-cyan-300 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <Network className="size-2.5 text-cyan-400" />
                              <span>Connected Telemetry Points</span>
                            </span>
                            <span className={`text-[8px] font-bold px-1.5 py-0.2 rounded-full ${
                              rainActive ? "bg-sky-500/20 text-sky-300 border border-sky-400/40 animate-pulse" : "bg-slate-800 text-slate-400"
                            }`}>
                              {rainActive ? "Live Pouring Data" : "Standby Data"}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-1 pt-0.5">
                            {/* 1. 9-Axis IMU */}
                            {!isSensorDeleted(slave.id, "imu") && (
                              <div className="relative group p-1.5 bg-slate-950/70 rounded-md border border-purple-500/30 flex items-center gap-1.5">
                                <div className="size-5 rounded bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0">
                                  <Navigation className="size-3" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[9px] font-bold text-slate-200 truncate">9-Axis IMU</div>
                                  <div className="text-[8px] font-mono text-purple-300 truncate">
                                    {rainActive ? "Accel: ±0.03g • Gyro 0.2°/s" : "Accel: 0.00g • Gyro 0°/s"}
                                  </div>
                                </div>
                                <button onClick={() => deleteSensor(slave.id, "imu")} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 size-3.5 flex items-center justify-center bg-rose-900/90 hover:bg-rose-700 text-rose-300 rounded cursor-pointer transition-opacity" title="Remove 9-Axis IMU">
                                  <X className="size-2.5" />
                                </button>
                              </div>
                            )}

                            {/* 2. Soil Moisture Sensor */}
                            {!isSensorDeleted(slave.id, "soil") && (
                              <div className="relative group p-1.5 bg-slate-950/70 rounded-md border border-emerald-500/30 flex items-center gap-1.5">
                                <div className="size-5 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
                                  <Activity className="size-3" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[9px] font-bold text-slate-200 truncate">Soil Moisture</div>
                                  <div className="text-[8px] font-mono text-emerald-300 truncate">
                                    {rainActive ? `${Math.min(99, 65 + Math.round(simRainIntensity * 0.25))}% Saturation` : "42% Saturation"}
                                  </div>
                                </div>
                                <button onClick={() => deleteSensor(slave.id, "soil")} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 size-3.5 flex items-center justify-center bg-rose-900/90 hover:bg-rose-700 text-rose-300 rounded cursor-pointer transition-opacity" title="Remove Soil Moisture">
                                  <X className="size-2.5" />
                                </button>
                              </div>
                            )}

                            {/* 3. Tilt Sensor */}
                            {!isSensorDeleted(slave.id, "tilt") && (
                              <div className="relative group p-1.5 bg-slate-950/70 rounded-md border border-indigo-500/30 flex items-center gap-1.5">
                                <div className="size-5 rounded bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 shrink-0">
                                  <Sliders className="size-3" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[9px] font-bold text-slate-200 truncate">Tilt Sensor</div>
                                  <div className="text-[8px] font-mono text-indigo-300 truncate">
                                    {rainActive ? "Pitch: 0.4° • Roll: 0.8°" : "Pitch: 0.1° • Roll: 0.2°"}
                                  </div>
                                </div>
                                <button onClick={() => deleteSensor(slave.id, "tilt")} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 size-3.5 flex items-center justify-center bg-rose-900/90 hover:bg-rose-700 text-rose-300 rounded cursor-pointer transition-opacity" title="Remove Tilt Sensor">
                                  <X className="size-2.5" />
                                </button>
                              </div>
                            )}

                            {/* 4. Flowmeter */}
                            {!isSensorDeleted(slave.id, "flow") && (
                              <div className="relative group p-1.5 bg-slate-950/70 rounded-md border border-amber-500/30 flex items-center gap-1.5">
                                <div className="size-5 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                                  <Activity className="size-3" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[9px] font-bold text-slate-200 truncate">Flowmeter</div>
                                  <div className="text-[8px] font-mono text-amber-300 truncate">
                                    {rainActive ? `${(8.2 + simRainIntensity * 0.16).toFixed(1)} m³/s` : "2.4 m³/s"}
                                  </div>
                                </div>
                                <button onClick={() => deleteSensor(slave.id, "flow")} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 size-3.5 flex items-center justify-center bg-rose-900/90 hover:bg-rose-700 text-rose-300 rounded cursor-pointer transition-opacity" title="Remove Flowmeter">
                                  <X className="size-2.5" />
                                </button>
                              </div>
                            )}

                            {/* 5. Rain Sensor */}
                            {!isSensorDeleted(slave.id, "rain") && (
                              <div className="relative group p-1.5 bg-slate-950/70 rounded-md border border-sky-500/30 flex items-center gap-1.5">
                                <div className="size-5 rounded bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-300 shrink-0">
                                  <CloudRain className="size-3" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[9px] font-bold text-slate-200 truncate">Rain Sensor</div>
                                  <div className="text-[8px] font-mono text-sky-300 truncate">
                                    {rainActive ? `${simRainIntensity} mm/h` : "0 mm/h (Dry)"}
                                  </div>
                                </div>
                                <button onClick={() => deleteSensor(slave.id, "rain")} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 size-3.5 flex items-center justify-center bg-rose-900/90 hover:bg-rose-700 text-rose-300 rounded cursor-pointer transition-opacity" title="Remove Rain Sensor">
                                  <X className="size-2.5" />
                                </button>
                              </div>
                            )}

                            {/* 6. Water Level Sensor */}
                            {!isSensorDeleted(slave.id, "level") && (
                              <div className="relative group p-1.5 bg-slate-950/70 rounded-md border border-cyan-500/30 flex items-center gap-1.5">
                                <div className="size-5 rounded bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
                                  <Waves className="size-3" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[9px] font-bold text-slate-200 truncate">Water Level</div>
                                  <div className="text-[8px] font-mono text-cyan-300 truncate">
                                    {rainActive ? `${(2.10 + simRainIntensity * 0.035).toFixed(2)} m` : "1.20 m"}
                                  </div>
                                </div>
                                <button onClick={() => deleteSensor(slave.id, "level")} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 size-3.5 flex items-center justify-center bg-rose-900/90 hover:bg-rose-700 text-rose-300 rounded cursor-pointer transition-opacity" title="Remove Water Level">
                                  <X className="size-2.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center justify-between gap-2">
                          <span className="text-cyan-300 flex items-center gap-1 text-[10px] font-mono">
                            <Share2 className="size-2.5 text-cyan-400" />
                            <span>
                              {masterNode
                                ? `Link: ${distKm < 1 ? Math.round(distKm * 1000) + "m" : distKm.toFixed(2) + " km"}`
                                : "No Master"}
                            </span>
                          </span>

                          <div className="flex items-center gap-1.5">
                            <span className="text-emerald-400 font-bold text-[10px] font-mono mr-0.5">
                              {slave.signalDbm} dBm
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteNode(slave.id)}
                              className="px-2 py-1 bg-rose-950/90 hover:bg-rose-900 text-rose-200 border border-rose-500/50 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs active:scale-95"
                              title={`Delete ${slave.name} node separately`}
                            >
                              <Trash2 className="size-3 text-rose-400" />
                              <span>Delete Node</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}


          {/* TAB 2: USER ACTIVITY LOG */}
          {activePanelTab === "activity" && (
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[50vh]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  User Actions Audit Log
                </span>
                {userActivities.length > 0 && (
                  <button
                    onClick={clearUserActivities}
                    className="text-[9px] text-rose-400 hover:text-rose-300 underline cursor-pointer"
                  >
                    Clear Log
                  </button>
                )}
              </div>

              {userActivities.length === 0 ? (
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-4 text-center text-slate-400 text-xs">
                  <Clock className="size-5 mx-auto mb-1 opacity-50 text-cyan-400" />
                  <span>No user activity recorded yet.</span>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Your node additions, movements, promotions, and deletions will be logged here.
                  </p>
                </div>
              ) : (
                userActivities.map((act) => (
                  <div
                    key={act.id}
                    className="bg-slate-800/80 border border-slate-700/50 rounded-lg p-2 text-xs text-white flex flex-col gap-1 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[11px] text-cyan-300 flex items-center gap-1">
                        <Activity className="size-3 text-emerald-400" />
                        <span>{act.action}</span>
                      </span>
                      <span className="text-[9px] font-mono text-slate-400">{act.timestamp}</span>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-snug">{act.details}</p>
                  </div>
                ))
              )}
            </div>
          )}
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
                className="flex-1 flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-500 text-white rounded px-2 py-1.5 text-xs font-semibold cursor-pointer"
                title="Delete this sensor from the 3D map"
              >
                <Trash2 className="size-3" />
                <span>Delete</span>
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

      {/* Bottom Right: Navigation Guide & Live Alt */}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 pointer-events-none">
        <div className="pointer-events-auto hidden sm:flex items-center gap-3 bg-slate-900/85 backdrop-blur-md border border-slate-700/70 px-3 py-1.5 rounded-lg shadow-lg text-[11px] text-slate-300 font-mono">
          <span className="flex items-center gap-1 text-slate-200">
            <Compass className="size-3.5 text-emerald-400" />
            <span>
              {viewMode === "flat"
                ? "WASD: Walk | Drag / ↶ ↷ / Arrows: Turn Left & Right | Mouse Up/Down: Altitude"
                : "Google Maps: Left Drag: Pan | Right Drag: Tilt/Rotate | Wheel: Zoom"}
            </span>
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-sky-300 font-bold">
            {viewMode === "flat"
              ? `Alt: ${camAltitude.toLocaleString()}m (Ground: ${groundHeightMeters}m)`
              : `Alt: ${camAltitude.toLocaleString()}m`}
          </span>
        </div>
      </div>
    </div>
  );
}
