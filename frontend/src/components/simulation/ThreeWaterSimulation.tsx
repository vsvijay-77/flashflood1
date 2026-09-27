import React, { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Loader2, CloudRain } from "lucide-react";
import * as THREE from "three";
import { WaterPhysicsSimulation } from "./waterPhysics";
import type { WaterRiskSnapshot } from "./waterRisk";
import { clampFloodPlaybackSpeed, floodPlaybackRate } from "./playbackSpeed";
import { createWaterShaderMaterial } from "./WaterShaders";
import { createWaterwayDistanceTexture } from "./waterwayDistance";
import type { OsmWaterQueryResult, WaterSourceFeature } from "@/services/osmWaterSourceService";
import { FlashFloodControlPanel } from "./FlashFloodControlPanel";
import { defaultFlashFloodParameters, getFloodForcing } from "./flashFloodParameters";
import CesiumSelectedAreaRainOverlay from "./CesiumSelectedAreaRainOverlay";
import { rasterizeWaterSources } from "./water/sourceRaster";
import { fetchWater, type WaterFootprint } from "./water/osmWater";
import type { RiverFeature, RoadFeature, EvacuationRouteResponse } from "@/lib/routingApi";
import { createFlowGraphOverlay } from "./flowGraphOverlay";
import { type BuildingExposure, type BuildingSample } from "./buildingExposure";
import { FloodImpactReport } from "./FloodImpactReport";
import { buildStandardFloodReport } from "./standardFloodReport";
import { buildSimulationReport, type SimulationReportData } from "./simulationReport";
import { apiPost } from "@/lib/api";
import { toast } from "sonner";
import { HouseArrivalPanel } from "./HouseArrivalPanel";
import { BuildingArrivalLabels } from "./BuildingArrivalLabels";
import { arrivalLabel, type ArrivalForecastInput, type ArrivalForecastResult } from "./arrivalForecast";
import type { BuildingFeature } from "@/lib/routingApi";

declare const Cesium: any;

export interface ThreeWaterSimulationProps {
  cesiumViewer: any;
  centerLat: number;
  centerLng: number;
  baseElevation?: number;
  polygonCoords?: [number, number][] | null;
  active: boolean;
  riverFeatures?: RiverFeature[];
  roadFeatures?: RoadFeature[];
  buildingFeatures?: BuildingFeature[];
  rainfallMmH?: number;
  windSpeedKmh?: number;
  isFlatView?: boolean;
  defaultSoilSaturation?: number;
  defaultSourceRise?: number;
  simulationSpeed?: number;
  defaultDurationMinutes?: number;
  hideControlsOnStart?: boolean;
  onPauseChange?: (isPaused: boolean) => void;
  onRunningChange?: (isRunning: boolean) => void;
  onReadyChange?: (isReady: boolean) => void;
  showVisibleRain?: boolean;
  onToggleVisibleRain?: (show: boolean) => void;
  autoStart?: boolean;
  onClose?: () => void;
  debugMode?: boolean;
  houseSelectionEnabled?: boolean;
  onEvacuationReady?: (ready: boolean) => void;
  onRouteInvalidated?: () => void;
  onBuildingExposureChange?: (affectedNow: number, affectedTotal: number) => void;
  selectedBuildingId?: string | null;
  onSelectedBuildingArrivalChange?: (arrival: { id: string; label: string } | null) => void;
}

export interface ThreeWaterSimulationHandle {
  getWaterRiskSnapshot: () => WaterRiskSnapshot | null;
  calculateEvacuation: (origin: { lat: number; lng: number }, destination?: { lat: number; lng: number }) => Promise<EvacuationRouteResponse>;
  openControls: () => void;
  closeControls?: () => void;
  startSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  resetSimulation: () => void;
  setSourceRise: (rise: number) => void;
  setSpeed: (speed: number) => void;
  setWaveIntensity: (intensity: number) => void;
  toggleWater: (show: boolean) => void;
  toggleGraph?: (show?: boolean) => void;
  endSimulation?: () => void;
  closeSimulation: () => void;
}

export const ThreeWaterSimulation = forwardRef<ThreeWaterSimulationHandle, ThreeWaterSimulationProps>(
  (
    {
      cesiumViewer,
      centerLat,
      centerLng,
      baseElevation = 293,
      polygonCoords,
      active,
      riverFeatures,
      roadFeatures,
      buildingFeatures,
      rainfallMmH = 150,
      windSpeedKmh = 20,
      isFlatView = false,
      defaultSoilSaturation,
      defaultSourceRise,
      simulationSpeed,
      defaultDurationMinutes,
      hideControlsOnStart = false,
      onPauseChange,
      onRunningChange,
      onReadyChange,
      showVisibleRain,
      onToggleVisibleRain,
      autoStart = false,
      onClose,
      houseSelectionEnabled = true,
      onEvacuationReady,
      onRouteInvalidated,
      onBuildingExposureChange,
      selectedBuildingId,
      onSelectedBuildingArrivalChange,
    },
    ref
  ) => {
    const polygonKey = JSON.stringify(polygonCoords ?? null);
    const stablePolygon = useMemo<[number, number][] | null>(() => JSON.parse(polygonKey), [polygonKey]);
    polygonCoords = stablePolygon;
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const terrainMeshRef = useRef<THREE.Mesh | null>(null);
    const waterMeshRef = useRef<THREE.Mesh | null>(null);
    const waterMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
    const waterwayTextureRef = useRef<THREE.DataTexture | null>(null);
    const lastLoadedPolyKeyRef = useRef<string>("");

    // Physics Engine Ref
    const physicsSimRef = useRef<WaterPhysicsSimulation | null>(null);
    const knownTerrainRef = useRef(new Uint8Array());
    const routeJobRef = useRef<{ worker: Worker; finish: (result: EvacuationRouteResponse) => void } | null>(null);
    const routeInvalidatedRef = useRef(onRouteInvalidated);
    routeInvalidatedRef.current = onRouteInvalidated;
    const cancelRoute = () => routeJobRef.current?.finish({ status: "error", message: "Scenario changed. Recalculate the evacuation route." });
    const insideMaskRef = useRef<Uint8Array | null>(null);
    const waterBodyMaskRef = useRef<Uint8Array | null>(null);
    const pathMaskRef = useRef<Uint8Array>(new Uint8Array());
    const graphRef = useRef<ReturnType<typeof createFlowGraphOverlay> | null>(null);
    const [showGraph, setShowGraph] = useState(false);
    const showGraphRef = useRef(showGraph);
    showGraphRef.current = showGraph;
    const [graphCounts, setGraphCounts] = useState<{
      nodes: number;
      edges: number;
      displayedEdges: number;
      areaKm2?: number;
      spacingM?: number;
    }>({ nodes: 0, edges: 0, displayedEdges: 0 });
    const [waterVolume, setWaterVolume] = useState(0);
    const buildingSamplesRef = useRef<BuildingSample[]>([]);
    const exposureWorkerRef = useRef<Worker | null>(null);
    const exposureBusyRef = useRef(false);
    const exposureDirtyRef = useRef(false);
    const exposureRevisionRef = useRef(0);
    const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
    const requestExposure = () => {
      const sim = physicsSimRef.current;
      if (!sim || !exposureWorkerRef.current) return;
      if (exposureBusyRef.current) { exposureDirtyRef.current = true; return; }
      exposureDirtyRef.current = false;
      exposureBusyRef.current = true;
      exposureWorkerRef.current.postMessage({ type: "assess", revision: exposureRevisionRef.current,
        depth: sim.state.depth, peaks: sim.state.peakDepth, arrivals: sim.state.firstArrivalSeconds,
        predicted: arrivalForecastRef.current?.arrivals });
    };
    const peakDepthRef = useRef(new Float32Array());
    const [buildingExposure, setBuildingExposure] = useState<BuildingExposure[]>([]);
    const [arrivalForecast, setArrivalForecast] = useState<ArrivalForecastResult | null>(null);
    const arrivalForecastRef = useRef<ArrivalForecastResult | null>(null);
    const [forecastRevision, setForecastRevision] = useState(0);
    const [forecastError, setForecastError] = useState<string | null>(null);
    const startPlaybackRef = useRef<() => void>(() => {});
    const [completedReport, setCompletedReport] = useState<SimulationReportData | null>(null);
    const [saveStatus, setSaveStatus] = useState<string>("Ready");
    const simulationStartedAtRef = useRef<string | null>(null);

    // Notify parent of live affected building counts whenever exposure changes
    const onBuildingExposureChangeRef = useRef(onBuildingExposureChange);
    onBuildingExposureChangeRef.current = onBuildingExposureChange;
    useEffect(() => {
      const affectedNow = buildingExposure.filter(b => b.affectedNow).length;
      const affectedTotal = buildingExposure.filter(b => b.affectedDuringRun).length;
      onBuildingExposureChangeRef.current?.(affectedNow, affectedTotal);
    }, [buildingExposure]);

    // Local-inertial & coordinate frame refs
    const effectiveCenterElevRef = useRef<number>(baseElevation);
    const enuTransformRef = useRef<{
      fixedToThree: any;
      threeFrame: THREE.Matrix4;
      centerCartesian: any;
    } | null>(null);

    // Grid meta ref
    const gridMetaRef = useRef<{
      cols: number;
      rows: number;
      dx: number;
      dy: number;
      south: number;
      west: number;
      north: number;
      east: number;
      positions: Float32Array;
    } | null>(null);

    // UI & Control State
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [isPaused, setIsPaused] = useState<boolean>(false);
    const [showWater, setShowWater] = useState<boolean>(true);
    const [sourceRise, setSourceRise] = useState<number>(defaultSourceRise !== undefined ? Math.max(0, defaultSourceRise) : 1.2);
    const [speed, setSpeed] = useState<number>(
      simulationSpeed !== undefined && Number.isFinite(simulationSpeed)
        ? clampFloodPlaybackSpeed(simulationSpeed)
        : 1
    );

    useEffect(() => {
      if (simulationSpeed !== undefined && Number.isFinite(simulationSpeed)) {
        setSpeed(clampFloodPlaybackSpeed(simulationSpeed));
      }
    }, [simulationSpeed]);
    const [waveIntensity, setWaveIntensity] = useState<number>(1.0);
    const [statusText, setStatusText] = useState<string>("Initializing terrain & water sources…");
    const [isFallbackSource, setIsFallbackSource] = useState<boolean>(false);
    const [osmFeatureCount, setOsmFeatureCount] = useState<number>(0);
    const [gridResolutionText, setGridResolutionText] = useState<string>("Initializing…");
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
    const inspectedBuilding = buildingExposure.find(building => building.id === selectedBuildingId);
    const inspectedArrivalLabel = active && selectedBuildingId
      ? inspectedBuilding ? arrivalLabel(inspectedBuilding, elapsedSeconds, arrivalForecast) : "Water ETA · calculating…"
      : null;
    useEffect(() => {
      onSelectedBuildingArrivalChange?.(selectedBuildingId && inspectedArrivalLabel
        ? { id: selectedBuildingId, label: inspectedArrivalLabel }
        : null);
    }, [selectedBuildingId, inspectedArrivalLabel, onSelectedBuildingArrivalChange]);
    const [spreadAreaHectares, setSpreadAreaHectares] = useState<number>(0);
    const [maxDepthM, setMaxDepthM] = useState<number>(0);
    const [isReady, setIsReady] = useState(false);
    const [controlsOpen, setControlsOpen] = useState(!autoStart && !showVisibleRain && !hideControlsOnStart);
    const controlsSuppressedRef = useRef(false);
    controlsSuppressedRef.current = Boolean(autoStart || showVisibleRain || hideControlsOnStart);
    const [parameters, setParameters] = useState({
      ...defaultFlashFloodParameters,
      durationMinutes: defaultDurationMinutes !== undefined && defaultDurationMinutes > 0 ? defaultDurationMinutes : defaultFlashFloodParameters.durationMinutes,
      soilSaturation: defaultSoilSaturation !== undefined ? defaultSoilSaturation : defaultFlashFloodParameters.soilSaturation,
      windSpeedKmh,
    });
    const parametersRef = useRef(parameters);
    parametersRef.current = parameters;

    useEffect(() => {
      if (defaultSoilSaturation !== undefined) {
        setParameters((prev) => ({ ...prev, soilSaturation: defaultSoilSaturation }));
      }
    }, [defaultSoilSaturation]);

    useEffect(() => {
      if (defaultDurationMinutes !== undefined && defaultDurationMinutes > 0) {
        setParameters((prev) => ({ ...prev, durationMinutes: defaultDurationMinutes }));
      }
    }, [defaultDurationMinutes]);

    useEffect(() => {
      if (defaultSourceRise !== undefined) {
        setSourceRise(defaultSourceRise);
      }
    }, [defaultSourceRise]);

    const [rainfall, setRainfall] = useState(Math.max(0, rainfallMmH));
    const [fps, setFps] = useState(0);
    const [effectiveSpeed, setEffectiveSpeed] = useState(0);
    const [renderScale, setRenderScale] = useState(1);
    const rainfallRef = useRef(rainfall);
    rainfallRef.current = rainfall;
    useEffect(() => {
      if (Number.isFinite(rainfallMmH)) {
        setRainfall(rainfallMmH);
      }
    }, [rainfallMmH]);

    const [localShowRain, setLocalShowRain] = useState<boolean>(showVisibleRain ?? false);
    useEffect(() => {
      if (showVisibleRain !== undefined) {
        setLocalShowRain(showVisibleRain);
      }
    }, [showVisibleRain]);

    const isRainVisible = showVisibleRain !== undefined ? showVisibleRain : localShowRain;
    const isRainVisibleRef = useRef<boolean>(isRainVisible);
    isRainVisibleRef.current = isRainVisible;

    const handleToggleVisibleRain = (visible: boolean) => {
      setLocalShowRain(visible);
      onToggleVisibleRain?.(visible);
    };
    const waterFeaturesRef = useRef(riverFeatures);
    waterFeaturesRef.current = riverFeatures;
    const roadFeaturesRef = useRef(roadFeatures);
    roadFeaturesRef.current = roadFeatures;

    // Dynamic refs to avoid stale closures in postRender loop
    const isRunningRef = useRef(isRunning);
    isRunningRef.current = isRunning;
    const isPausedRef = useRef(isPaused);
    isPausedRef.current = isPaused;
    const speedRef = useRef(speed);
    speedRef.current = speed;
    const sourceRiseRef = useRef(sourceRise);
    sourceRiseRef.current = sourceRise;
    const waveIntensityRef = useRef(waveIntensity);
    waveIntensityRef.current = waveIntensity;
    const showWaterRef = useRef(showWater);
    showWaterRef.current = showWater;

    useEffect(() => {
      routeInvalidatedRef.current?.();
      return () => cancelRoute();
    }, [active, isReady, rainfall, sourceRise, parameters.durationMinutes, parameters.soilSaturation,
      parameters.infiltrationMmH, parameters.roughness, parameters.flowModel, parameters.floodIntensity,
      roadFeatures, riverFeatures, polygonKey, forecastRevision]);
    useEffect(() => {
      onEvacuationReady?.(Boolean(active && isReady && arrivalForecast && arrivalForecast.throughSeconds >= elapsedSeconds + 120));
    }, [active, isReady, arrivalForecast, elapsedSeconds, onEvacuationReady]);

    // ─── 1. INITIALIZE TERRAIN & OSM WATER BODIES ────────────────────────────
    useEffect(() => {
      if (!active || !cesiumViewer || cesiumViewer.isDestroyed()) return;

      // Do NOT reset if the simulation is currently active and running on the same polygon area
      if (isRunningRef.current && polygonKey === lastLoadedPolyKeyRef.current && physicsSimRef.current) {
        return;
      }
      lastLoadedPolyKeyRef.current = polygonKey;

      const abortController = new AbortController();
      let isMounted = true;
      isRunningRef.current = false;
      isPausedRef.current = false;
      arrivalForecastRef.current = null;
      setArrivalForecast(null);
      setCompletedReport(null);
      simulationStartedAtRef.current = null;
      setIsRunning(false);
      setIsPaused(false);
      setIsReady(false);
      setControlsOpen(!autoStart && !showVisibleRain && !hideControlsOnStart);
      setElapsedSeconds(0);
      setOsmFeatureCount(0);
      if (waterMeshRef.current) waterMeshRef.current.visible = false;
      physicsSimRef.current = null;
      graphRef.current?.dispose();
      graphRef.current = null;
      setGraphCounts({ nodes: 0, edges: 0, displayedEdges: 0 });
      setWaterVolume(0);

      const setupSimulation = async () => {
        setStatusText("Sampling Cesium high-resolution DEM…");
        await new Promise<void>(res => setTimeout(res, 0));
        if (!isMounted) return;

        // 1. Calculate Bounding Box
        let north = centerLat + 0.015;
        let south = centerLat - 0.015;
        let east = centerLng + 0.015;
        let west = centerLng - 0.015;

        if (polygonCoords && polygonCoords.length >= 3) {
          north = Math.max(...polygonCoords.map((p) => p[0]));
          south = Math.min(...polygonCoords.map((p) => p[0]));
          east = Math.max(...polygonCoords.map((p) => p[1]));
          west = Math.min(...polygonCoords.map((p) => p[1]));
          const padLat = (north - south) * 0.05;
          const padLng = (east - west) * 0.05;
          north += padLat;
          south -= padLat;
          east += padLng;
          west -= padLng;
        }

        // Center elevation sampling
        let centerElev = baseElevation;
        try {
          const centerCarto = Cesium.Cartographic.fromDegrees(centerLng, centerLat);
          if (
            cesiumViewer.terrainProvider &&
            !(cesiumViewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)
          ) {
            try {
              await Promise.race([
                Cesium.sampleTerrainMostDetailed(cesiumViewer.terrainProvider, [centerCarto]),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
              ]);
              if (Number.isFinite(centerCarto.height)) centerElev = centerCarto.height;
            } catch (e) {}
          }
          if (centerElev === baseElevation) {
            const h = cesiumViewer.scene.globe.getHeight(centerCarto);
            if (h !== undefined && !isNaN(h) && h > -50) centerElev = h;
          }
        } catch (e) {}
        effectiveCenterElevRef.current = centerElev;

        // Establish Local-to-Cesium Fixed Transform
        // Three.js local space has X: East, Y: Up, Z: -North (South)
        // enuToFixed has Col 0: East, Col 1: North, Col 2: Up, Col 3: Origin
        // So matrix m that transforms Three.js (East, Up, -North) to ECEF has:
        // Col 0: East, Col 1: Up, Col 2: -North, Col 3: Origin
        const centerCartesian = Cesium.Cartesian3.fromDegrees(centerLng, centerLat, centerElev);
        const enuToFixed = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);

        const m = new Cesium.Matrix4();
        Cesium.Matrix4.clone(enuToFixed, m);
        m[4] = enuToFixed[8];
        m[5] = enuToFixed[9];
        m[6] = enuToFixed[10];
        m[7] = enuToFixed[11];
        m[8] = -enuToFixed[4];
        m[9] = -enuToFixed[5];
        m[10] = -enuToFixed[6];
        m[11] = -enuToFixed[7];

        const fixedToThree = Cesium.Matrix4.inverseTransformation(m, new Cesium.Matrix4());
        const threeFrame = new THREE.Matrix4().fromArray(Array.from(m) as number[]);
        enuTransformRef.current = { fixedToThree, threeFrame, centerCartesian };

        // Keep the hydraulic grid fine enough that flood edges do not appear as
        // kilometre-wide blocks across a large selected catchment.
        const radLat = (centerLat * Math.PI) / 180;
        const metersPerLat = 111132.92 - 559.82 * Math.cos(2 * radLat);
        const metersPerLng = 111412.84 * Math.cos(radLat);

        const totalWidthM = (east - west) * metersPerLng;
        const totalHeightM = (north - south) * metersPerLat;
        if (!(totalWidthM > 0 && totalHeightM > 0)) throw new Error("Select an area with nonzero width and height.");

        const maxGridAxis = 128;
        const targetCellSizeM = 16;
        const spacing = Math.max(targetCellSizeM, totalWidthM / (maxGridAxis - 1), totalHeightM / (maxGridAxis - 1));
        const COLS = Math.max(2, Math.round(totalWidthM / spacing) + 1);
        const ROWS = Math.max(2, Math.round(totalHeightM / spacing) + 1);
        const totalCells = COLS * ROWS;
        const dx = totalWidthM / (COLS - 1);
        const dy = totalHeightM / (ROWS - 1);

        setGridResolutionText(`${COLS} × ${ROWS} (${dx.toFixed(1)}m)`);

        // Build Cartographic sample points
        const cartographics: any[] = [];
        const latList: number[] = [];
        const lngList: number[] = [];

        for (let r = 0; r < ROWS; r++) {
          const lat = south + (r / (ROWS - 1)) * (north - south);
          for (let c = 0; c < COLS; c++) {
            const lng = west + (c / (COLS - 1)) * (east - west);
            const point = Cesium.Cartographic.fromDegrees(lng, lat);
            point.height = NaN; // A default ellipsoid height of zero is not a measured elevation.
            cartographics.push(point);
            latList.push(lat);
            lngList.push(lng);
          }
        }

        // Sample terrain elevation with high-precision terrain provider:
        setStatusText("Sampling high-precision terrain elevations across area...");
        const sampledElevations = new Float32Array(COLS * ROWS).fill(NaN);

        if (
          cesiumViewer.terrainProvider &&
          !(cesiumViewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)
        ) {
          try {
            const chunkSize = 2048;
            const chunks: any[][] = [];
            for (let i = 0; i < cartographics.length; i += chunkSize) {
              chunks.push(cartographics.slice(i, i + chunkSize));
            }

            // Sample all chunks with individual timeout so trailing chunks always complete
            await Promise.all(
              chunks.map(async (chunk) => {
                if (abortController.signal.aborted) return;
                try {
                  await Promise.race([
                    Cesium.sampleTerrainMostDetailed(cesiumViewer.terrainProvider, chunk),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Chunk timeout")), 15000)),
                  ]);
                } catch {
                  // Fallback for points in this specific chunk from globe tiles
                  for (const pt of chunk) {
                    if (!Number.isFinite(pt.height)) {
                      const h = cesiumViewer.scene.globe.getHeight(pt);
                      if (Number.isFinite(h) && h > -200) pt.height = h;
                    }
                  }
                }
              })
            );
          } catch (e) {
            console.warn("[WaterSim] sampleTerrainMostDetailed fallback:", e);
          }
        }

        if (!isMounted) return;

        let measuredCount = 0;
        for (let i = 0; i < cartographics.length; i++) {
          if (Number.isFinite(cartographics[i].height) && cartographics[i].height > -200) {
            sampledElevations[i] = cartographics[i].height;
            measuredCount++;
          }
        }

        // Secondary fallback: sample from loaded scene globe tiles for any still-missing points
        if (measuredCount < totalCells) {
          for (let i = 0; i < cartographics.length; i++) {
            if (!Number.isFinite(sampledElevations[i])) {
              const h = cesiumViewer.scene.globe.getHeight(cartographics[i]);
              if (Number.isFinite(h) && h > -200) {
                sampledElevations[i] = h;
                measuredCount++;
              }
            }
          }
        }

        knownTerrainRef.current = Uint8Array.from(sampledElevations, h => Number.isFinite(h) ? 1 : 0);

        // Full progressive neighbor relaxation across all rows & columns so the entire area (including boundaries and tail rows) seamlessly blends
        if (measuredCount > 0 && measuredCount < totalCells) {
          for (let pass = 0; pass < Math.max(ROWS, COLS); pass++) {
            let filledThisPass = 0;
            for (let r = 0; r < ROWS; r++) {
              for (let c = 0; c < COLS; c++) {
                const idx = r * COLS + c;
                if (!Number.isFinite(sampledElevations[idx])) {
                  let sum = 0;
                  let count = 0;
                  if (r > 0 && Number.isFinite(sampledElevations[(r - 1) * COLS + c])) {
                    sum += sampledElevations[(r - 1) * COLS + c];
                    count++;
                  }
                  if (r < ROWS - 1 && Number.isFinite(sampledElevations[(r + 1) * COLS + c])) {
                    sum += sampledElevations[(r + 1) * COLS + c];
                    count++;
                  }
                  if (c > 0 && Number.isFinite(sampledElevations[r * COLS + (c - 1)])) {
                    sum += sampledElevations[r * COLS + (c - 1)];
                    count++;
                  }
                  if (c < COLS - 1 && Number.isFinite(sampledElevations[r * COLS + (c + 1)])) {
                    sum += sampledElevations[r * COLS + (c + 1)];
                    count++;
                  }
                  if (count > 0) {
                    sampledElevations[idx] = sum / count;
                    filledThisPass++;
                    measuredCount++;
                  }
                }
              }
            }
            if (filledThisPass === 0) break;
          }
        }

        // Complete any remaining unmeasured points with center elevation
        for (let i = 0; i < sampledElevations.length; i++) {
          if (!Number.isFinite(sampledElevations[i])) {
            sampledElevations[i] = centerElev;
          }
        }

        // Brief yield — lets browser repaint the loading spinner & rain overlay
        // before the synchronous mesh-building computation blocks the main thread.
        await new Promise<void>(res => setTimeout(res, 0));
        if (!isMounted) return;

        // 2. Fetch OSM Water Sources from cached digital twin features
        let osmResult: OsmWaterQueryResult = {
          features: [],
          isFallback: true,
          attribution: "© OpenStreetMap contributors",
          cached: false,
        };

        const mapped = waterFeaturesRef.current;
        if (mapped?.length) {
          osmResult = {
            features: mapped.map((feature, index) => ({
              id: String(feature.properties?.id ?? index),
              name: feature.properties?.name ?? "Waterway",
              waterType: feature.properties?.waterway_type as WaterSourceFeature["waterType"],
              isPolygon: ["Polygon", "MultiPolygon"].includes(feature.geometry.type),
              geometry: feature.geometry,
              properties: feature.properties,
            })),
            isFallback: false,
            cached: true,
            attribution: "© OpenStreetMap contributors",
          };
        }

        if (!isMounted) return;

        // 3. Calculate Elevation Relief and Mark Polygon Masks
        const insideMask = new Uint8Array(totalCells);
        let sourceMask = new Uint8Array(totalCells);
        const initialDepths = new Float32Array(totalCells);

        let minElev = Infinity;
        let maxElev = -Infinity;
        let insideCellsCount = 0;

        // Polygon boundary check and elevation range detection
        for (let i = 0; i < totalCells; i++) {
          const lat = latList[i];
          const lng = lngList[i];

          let inside = true;
          if (polygonCoords && polygonCoords.length >= 3) {
            inside = isPointInPoly(lat, lng, polygonCoords);
          }
          insideMask[i] = inside ? 1 : 0;

          if (inside) {
            insideCellsCount++;
            const h = sampledElevations[i];
            if (h < minElev) minElev = h;
            if (h > maxElev) maxElev = h;
          }
        }
        insideMaskRef.current = insideMask;

        if (minElev === Infinity || insideCellsCount === 0) {
          minElev = centerElev;
          maxElev = centerElev + 10;
        }
        const relief = maxElev - minElev;

        // Rasterize ALL mapped water features (all blue markings) with tight single-cell width
        let waterFeatureCount = 0;
        const waterFeatures: WaterSourceFeature[] = osmResult.features || [];
        const raster = rasterizeWaterSources(waterFeatures, { cols: COLS, rows: ROWS, dx, dy, west, south, east, north }, insideMask);
        sourceMask = raster.mask;

        const mappedPaths: WaterSourceFeature[] = (roadFeaturesRef.current || []).map(feature => ({
          id: feature.properties.id, name: feature.properties.name, waterType: "stream", isPolygon: false,
          geometry: feature.geometry, properties: { width_m: 6 },
        }));
        pathMaskRef.current = rasterizeWaterSources(mappedPaths, { cols: COLS, rows: ROWS, dx, dy, west, south, east, north }, insideMask).mask;

        // Count OSM water cells
        for (let i = 0; i < totalCells; i++) {
          if (insideMask[i] && sourceMask[i]) {
            waterFeatureCount++;
          }
        }

        // Floodwater starts dry; rainfall and selected river rise build a small
        // front over simulated time without a pre-filled river-width band.
        // Missing waterways permit rainfall-only runoff, never synthetic sources.
        waterBodyMaskRef.current = sourceMask;
        setIsFallbackSource(raster.featureCount === 0);
        setOsmFeatureCount(raster.featureCount);
        initialDepths.fill(0);

        // 5. Initialize Physics Simulation Engine with High-to-Low Momentum
        const physics = new WaterPhysicsSimulation(
          { cols: COLS, rows: ROWS, dx, dy, manningN: parametersRef.current.roughness, gravity: 9.81, flowModel: parametersRef.current.flowModel, sourceMode: "headwaters" },
          sampledElevations,
          insideMask,
          sourceMask,
          initialDepths,
          pathMaskRef.current,
        );
        physicsSimRef.current = physics;

        // 6. Build Local Three.js Mesh Coordinates
        const positions = new Float32Array(totalCells * 3);
        for (let i = 0; i < totalCells; i++) {
          const lat = latList[i];
          const lng = lngList[i];
          const elev = sampledElevations[i];

          const posCartesian = Cesium.Cartesian3.fromDegrees(lng, lat, elev);
          const posThree = Cesium.Matrix4.multiplyByPoint(
            fixedToThree,
            posCartesian,
            new Cesium.Cartesian3()
          );

          positions[i * 3 + 0] = posThree.x;
          positions[i * 3 + 1] = posThree.y; // Clamped directly to terrain ground bed!
          positions[i * 3 + 2] = posThree.z;
        }

        gridMetaRef.current = {
          cols: COLS,
          rows: ROWS,
          dx,
          dy,
          south,
          west,
          north,
          east,
          positions,
        };
        peakDepthRef.current = new Float32Array(totalCells);

        // 7. Build Three.js Geometry & Mesh across the entire polygon area (sourceMask defines river body)
        buildThreeWaterMesh(COLS, ROWS, positions, sampledElevations, initialDepths, insideMask, sourceMask);
        graphRef.current?.dispose();
        graphRef.current = createFlowGraphOverlay(physics.state, positions, pathMaskRef.current);
        graphRef.current.group.visible = showGraphRef.current;
        sceneRef.current?.add(graphRef.current.group);
        const areaSqKm = (insideCellsCount * dx * dy) / 1_000_000;
        setGraphCounts({
          nodes: insideCellsCount,
          edges: physics.state.edges.length,
          displayedEdges: graphRef.current.displayedEdges,
          areaKm2: areaSqKm,
          spacingM: dx,
        });
        setIsReady(true);

        isRunningRef.current = false;
        isPausedRef.current = false;
        setIsRunning(false);
        setIsPaused(false);
        onRunningChange?.(false);
        onPauseChange?.(false);
        setControlsOpen(!controlsSuppressedRef.current);
        setStatusText(
          `Terrain ready • ${minElev.toFixed(0)}–${maxElev.toFixed(0)}m · Ready to start`
        );
        if (autoStart) startPlaybackRef.current();
        try {
          cesiumViewer.scene.requestRender();
        } catch (e) {}
      };

      setupSimulation().catch(error => {
        if (isMounted) setStatusText(`Unable to initialize water: ${error.message}`);
      });

      return () => {
        isMounted = false;
        abortController.abort();
      };
    }, [active, cesiumViewer, centerLat, centerLng, polygonKey]);

    // ─── 2. BUILD THREE.JS WATER MESH WITH SHADERMATERIAL ────────────────────
    const buildThreeWaterMesh = (
      cols: number,
      rows: number,
      positions: Float32Array,
      bedElevations: Float32Array,
      initialDepths: Float32Array,
      insideMask: Uint8Array,
      waterBodyMask: Uint8Array
    ) => {
      const scene = sceneRef.current;
      if (!scene) return;

      if (terrainMeshRef.current) {
        scene.remove(terrainMeshRef.current);
        terrainMeshRef.current.geometry.dispose();
        (terrainMeshRef.current.material as THREE.Material).dispose();
        terrainMeshRef.current = null;
      }
      // Remove existing mesh
      if (waterMeshRef.current) {
        scene.remove(waterMeshRef.current);
        waterMeshRef.current.geometry.dispose();
        waterMaterialRef.current?.dispose();
        waterMeshRef.current = null;
      }

      const totalCells = cols * rows;

      // Build Plane indices: include any triangle where AT LEAST ONE corner is inside
      // or is a water body. The fragment shader discards fragments with vInside < 0.99,
      // so boundary overdraw is invisible. This eliminates gaps at polygon boundaries
      // and narrow river channel cells where only 1-2 corners are inside the mask.
      const indices: number[] = [];
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c;
          const b = r * cols + (c + 1);
          const cIdx = (r + 1) * cols + c;
          const d = (r + 1) * cols + (c + 1);

          // Triangle 1: any corner inside or water body
          if (insideMask[a] || insideMask[b] || insideMask[cIdx] ||
              waterBodyMask[a] || waterBodyMask[b] || waterBodyMask[cIdx]) {
            indices.push(a, cIdx, b);
          }

          // Triangle 2: any corner inside or water body
          if (insideMask[b] || insideMask[cIdx] || insideMask[d] ||
              waterBodyMask[b] || waterBodyMask[cIdx] || waterBodyMask[d]) {
            indices.push(b, cIdx, d);
          }
        }
      }

      // Attributes
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      geometry.setAttribute("aDepth", new THREE.BufferAttribute(new Float32Array(initialDepths), 1));
      geometry.setAttribute("aVelocity", new THREE.BufferAttribute(new Float32Array(totalCells * 2), 2));
      geometry.setAttribute("aBedElevation", new THREE.BufferAttribute(new Float32Array(bedElevations), 1));
      geometry.setAttribute("aInside", new THREE.BufferAttribute(new Float32Array(insideMask), 1));
      geometry.setAttribute("aIsWaterBody", new THREE.BufferAttribute(new Float32Array(waterBodyMask), 1));
      const gridUvs = new Float32Array(totalCells * 2);
      for (let i = 0; i < totalCells; i++) {
        gridUvs[i * 2] = (i % cols) / (cols - 1);
        gridUvs[i * 2 + 1] = Math.floor(i / cols) / (rows - 1);
      }
      geometry.setAttribute("aGridUv", new THREE.BufferAttribute(gridUvs, 2));
      geometry.setIndex(indices);
      // Lighting normals are reconstructed in the fragment shader.
      for (const name of ["position", "aDepth", "aVelocity"]) (geometry.attributes[name] as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);

      // Depth-only terrain occludes water behind sampled ridges in the overlay.
      const terrainGeometry = new THREE.BufferGeometry();
      const terrainPositions = new Float32Array(positions);
      for (let i = 0; i < totalCells; i++) terrainPositions[i * 3 + 1] -= 0.005;
      terrainGeometry.setAttribute("position", new THREE.BufferAttribute(terrainPositions, 3));
      const terrainIndices: number[] = [];
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols;
        terrainIndices.push(a, d, b, b, d, d + 1);
      }
      terrainGeometry.setIndex(terrainIndices);
      const terrainMesh = new THREE.Mesh(
        terrainGeometry,
        new THREE.MeshBasicMaterial({
          colorWrite: false,
          side: THREE.DoubleSide,
          depthWrite: true,
        })
      );
      terrainMesh.renderOrder = -1;
      terrainMeshRef.current = terrainMesh;
      scene.add(terrainMesh);

      const container = canvasContainerRef.current;
      const res = new THREE.Vector2(container?.clientWidth || 800, container?.clientHeight || 600);

      const material = createWaterShaderMaterial(null, null, res);
      waterMaterialRef.current = material;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = "RealisticWaterSurface";
      mesh.frustumCulled = false;
      scene.add(mesh);
      waterMeshRef.current = mesh;
      handleReset();
      cesiumViewer.scene.requestRender();
    };

    // ─── 3. THREE.JS RENDERER & CESIUM POST-RENDER SYNCHRONIZATION ───────────
    useEffect(() => {
      const container = canvasContainerRef.current;
      if (!container || !active || !cesiumViewer || cesiumViewer.isDestroyed()) return;

      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;

      // 1. Scene & Camera
      const scene = new THREE.Scene();
      scene.background = null;
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(45, width / height, 1, 100000);
      cameraRef.current = camera;

      // 2. WebGL Renderer with Alpha & Logarithmic Depth
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        logarithmicDepthBuffer: true,
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;

      container.innerHTML = "";
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Reuse the matrix instead of allocating on every map frame.
      const cameraView = new THREE.Matrix4();
      // 3. Camera Sync function
      const syncCamera = () => {
        if (!cesiumViewer || cesiumViewer.isDestroyed() || !cameraRef.current || !enuTransformRef.current)
          return;

        const cCamera = cesiumViewer.camera;
        const threeFrame = enuTransformRef.current.threeFrame;
        const camera = cameraRef.current;

        // Multiply Cesium's camera view matrix by the Three.js coordinate frame.
        // This mathematically aligns Three.js clip space with Cesium's clip space to the sub-millimeter.
        const view = cameraView
          .fromArray(cCamera.viewMatrix)
          .multiply(threeFrame);

        camera.matrixAutoUpdate = false;
        camera.matrix.copy(view).invert();
        camera.updateMatrixWorld(true);
        camera.position.setFromMatrixPosition(camera.matrixWorld);

        if (cCamera.frustum) {
          if (cCamera.frustum.near !== undefined) camera.near = Math.max(0.1, cCamera.frustum.near);
          if (cCamera.frustum.far !== undefined) camera.far = Math.max(1000, cCamera.frustum.far);
        }

        camera.projectionMatrix.fromArray(cCamera.frustum.projectionMatrix);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      };

      const resize = new ResizeObserver(() => {
        renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
        cesiumViewer.scene.requestRender();
      });
      resize.observe(container);
      // Continuous RAF render loop drives Cesium frames when simulation is actively running
      let animFrameId: number | null = null;
      let requestedAt = 0;
      const animLoop = () => {
        const now = performance.now();
        if (!document.hidden && waterMeshRef.current) {
          const isActive = isRunningRef.current && !isPausedRef.current;
          const frameInterval = isActive ? 1000 / 30 - 1 : 1000;
          if (now - requestedAt >= frameInterval) {
            requestedAt = now;
            try {
              cesiumViewer.scene.requestRender();
            } catch (e) {}
          }
        }
        animFrameId = requestAnimationFrame(animLoop);
      };
      animFrameId = requestAnimationFrame(animLoop);

      // 4. Cesium postRender callback: updates physics and renders overlay
      let lastTime = performance.now();
      let lastTelemetryTime = 0;
      let physicsTime = 0;
      let frameTime = 16.7;
      let qualityCheck = performance.now();
      let simulatedSinceTelemetry = 0;
      let telemetryStartedAt = performance.now();
      let frameCount = 0;
      const onPostRender = () => {
        const now = performance.now();
        if (document.hidden) { lastTime = now; return; }
        const frameMs = now - lastTime;
        if (frameMs < 250) frameTime = frameTime * 0.95 + frameMs * 0.05;
        if (now - qualityCheck > 3000 && !document.hidden) {
          qualityCheck = now;
          const ratio = renderer.getPixelRatio();
          const next = frameTime > 42 ? Math.max(0.75, ratio - 0.25)
            : frameTime < 35 ? Math.min(window.devicePixelRatio, 1.5, ratio + 0.25) : ratio;
          if (next !== ratio) renderer.setPixelRatio(next);
        }
        const dt = Math.min(frameMs / 1000, 0.1);
        lastTime = now;

        const mat = waterMaterialRef.current;
        if (mat) {
          // Pause freezes surface detail as well as the hydraulic clock.
          if (isRunningRef.current && !isPausedRef.current) mat.uniforms.uTime.value += dt;
          mat.uniforms.uWaveHeight.value = waveIntensityRef.current;
          mat.uniforms.uRainIntensity.value = isRunningRef.current && !isPausedRef.current
            && physicsSimRef.current && physicsSimRef.current.state.elapsedSeconds < parametersRef.current.durationMinutes * 60
            ? rainfallRef.current / 300 : 0;
          renderer.getDrawingBufferSize(mat.uniforms.uResolution.value);
        }

        // Run Physics step if running and not paused
        const physics = physicsSimRef.current;
        const mesh = waterMeshRef.current;
        const gridMeta = gridMetaRef.current;

        if (isRunningRef.current && !isPausedRef.current) physicsTime += dt;
        else physicsTime = 0;
        if (physics && mesh && gridMeta && isRunningRef.current && !isPausedRef.current && physicsTime >= 1 / 60) {
          const currentParameters = parametersRef.current;
          physics.config.manningN = currentParameters.roughness;
          physics.config.flowModel = currentParameters.flowModel;
          // Starting speed at 1× advances at 2 simulated s/s for observable realistic flow.
          // 10× preset fast-forwards at 120 simulated s/s with expanded physics budget.
          const playbackMultiplier = floodPlaybackRate(speedRef.current);
          const stepTime = Math.min(0.1, physicsTime);
          const physicsBudgetMs = speedRef.current >= 10 ? 14 : speedRef.current >= 5 ? 10 : 6;
          physics.config.maxSubstepsPerFrame = speedRef.current >= 10 ? 20 : 12;
          const advanced = physics.advanceWithForcing(
            stepTime, playbackMultiplier,
            time => getFloodForcing(rainfallRef.current, sourceRiseRef.current, currentParameters, time),
            physicsBudgetMs,
          );
          simulatedSinceTelemetry += advanced;
          if (mat) mat.uniforms.uFlowTime.value = physics.state.elapsedSeconds;
          physicsTime = Math.min(0.1, Math.max(0, physicsTime - advanced / playbackMultiplier));

          const depths = physics.state.depth;

          // Update Geometry Buffers only when physics actually advanced
          if (advanced > 0) {
            const geo = mesh.geometry as THREE.BufferGeometry;
            const posAttr = geo.attributes.position as THREE.BufferAttribute;
            const depthAttr = geo.attributes.aDepth as THREE.BufferAttribute;
            const velAttr = geo.attributes.aVelocity as THREE.BufferAttribute;

            const basePositions = gridMeta.positions;
            const velX = physics.state.velocityX;
            const velY = physics.state.velocityY;

            const posArr = posAttr.array as Float32Array;
            const depthArr = depthAttr.array as Float32Array;
            const velArr = velAttr.array as Float32Array;
            const insideMask = insideMaskRef.current;
            const totalCells = physics.state.totalCells;
            const peaks = peakDepthRef.current;

            for (let i = 0; i < totalCells; i++) {
              const isInside = insideMask ? insideMask[i] : 1;
              const d = isInside ? depths[i] : 0.0;
              peaks[i] = physics.state.peakDepth[i];
              posArr[i * 3 + 1] = basePositions[i * 3 + 1] + d;
              depthArr[i] = d;
              velArr[i * 2 + 0] = isInside ? velX[i] : 0;
              velArr[i * 2 + 1] = isInside ? velY[i] : 0;
            }

            posAttr.needsUpdate = true;
            depthAttr.needsUpdate = true;
            velAttr.needsUpdate = true;
          }

          // Throttle React state telemetry to 2 Hz (every 500ms) — fewer re-renders
          if (now - lastTelemetryTime > 500) {
            lastTelemetryTime = now;
            setElapsedSeconds(Math.round(physics.state.elapsedSeconds));
            setSpreadAreaHectares(physics.state.floodedAreaHectares);
            setMaxDepthM(physics.state.maxDepthM);
            setWaterVolume(physics.state.totalVolumeM3);
            requestExposure();
            // Update graph overlay at 2Hz when visible — updating 10k edges each time is expensive
            if (showGraphRef.current) graphRef.current?.update(physics.state);
          }
        }

        frameCount++;
        if (now - telemetryStartedAt >= 1000) {
          const interval = (now - telemetryStartedAt) / 1000;
          setFps(Math.round(frameCount / interval));
          setEffectiveSpeed(simulatedSinceTelemetry / interval);
          setRenderScale(renderer.getPixelRatio());
          frameCount = 0;
          simulatedSinceTelemetry = 0;
          telemetryStartedAt = now;
        }

        // Toggle mesh visibility
        if (mesh) {
          mesh.visible = showWaterRef.current && Boolean(physics);
        }

        if (graphRef.current) graphRef.current.group.visible = showGraphRef.current;

        const isWaterVisible = showWaterRef.current && Boolean(mesh?.visible);
        const isGraphVisible = showGraphRef.current && Boolean(graphRef.current?.group.visible);

        // Always render in lockstep with Cesium postRender whenever visible to eliminate zoom mismatch
        if (isWaterVisible || isGraphVisible) {
          syncCamera();
          renderer.render(scene, camera);
        } else {
          renderer.clear();
        }
      };

      const removePostRenderListener = cesiumViewer.scene.postRender.addEventListener(onPostRender);

      return () => {
        if (animFrameId !== null) {
          cancelAnimationFrame(animFrameId);
        }
        graphRef.current?.dispose();
        graphRef.current = null;
        resize.disconnect();
        try {
          removePostRenderListener();
        } catch (e) {}

        if (physicsSimRef.current) {
          physicsSimRef.current.reset();
        }

        if (terrainMeshRef.current) {
          terrainMeshRef.current.geometry.dispose();
          (terrainMeshRef.current.material as THREE.Material).dispose();
          terrainMeshRef.current = null;
        }
        if (waterMeshRef.current) {
          if (sceneRef.current) {
            sceneRef.current.remove(waterMeshRef.current);
          }
          waterMeshRef.current.geometry.dispose();
          if (Array.isArray(waterMeshRef.current.material)) {
            waterMeshRef.current.material.forEach((m) => m.dispose());
          } else {
            waterMeshRef.current.material.dispose();
          }
          waterMeshRef.current = null;
        }
        waterwayTextureRef.current?.dispose();
        waterwayTextureRef.current = null;
        if (waterMaterialRef.current) {
          waterMaterialRef.current.dispose();
          waterMaterialRef.current = null;
        }
        if (rendererRef.current) {
          try {
            rendererRef.current.dispose();
            rendererRef.current.forceContextLoss?.();
            rendererRef.current.domElement.remove?.();
          } catch (e) {}
          rendererRef.current = null;
        }
        if (container) {
          container.innerHTML = "";
        }
        sceneRef.current = null;
        cameraRef.current = null;
      };
    }, [active, cesiumViewer]);

    useEffect(() => {
      showGraphRef.current = showGraph;
      if (graphRef.current) {
        graphRef.current.group.visible = showGraph;
      }
      if (showGraph && physicsSimRef.current) graphRef.current?.update(physicsSimRef.current.state);
      if (cesiumViewer && !cesiumViewer.isDestroyed()) cesiumViewer.scene.requestRender();
    }, [cesiumViewer, showWater, showGraph, isRunning, isPaused, waveIntensity]);

    // Notify parent when terrain initialization readiness changes
    useEffect(() => {
      onReadyChange?.(isReady);
    }, [isReady, onReadyChange]);

    useEffect(() => {
      const grid = gridMetaRef.current;
      const inside = insideMaskRef.current;
      const sim = physicsSimRef.current;
      if (!isReady || !grid || !inside || !sim) return;
      // OSM layers can finish after terrain sampling (including on fullscreen
      // remounts). Incorporate them without seeding water or losing live state.
      const sources: WaterSourceFeature[] = (riverFeatures || []).map((feature, index) => ({
        id: String(feature.properties?.id ?? index), name: feature.properties?.name ?? "Waterway",
        waterType: feature.properties?.waterway_type as WaterSourceFeature["waterType"],
        isPolygon: ["Polygon", "MultiPolygon"].includes(feature.geometry.type),
        geometry: feature.geometry, properties: feature.properties,
      }));
      const paths: WaterSourceFeature[] = (roadFeatures || []).map(feature => ({
        id: feature.properties.id, name: feature.properties.name, waterType: "stream", isPolygon: false,
        geometry: feature.geometry, properties: { width_m: 6 },
      }));
      const sourceRaster = rasterizeWaterSources(sources, grid, inside);
      const pathRaster = rasterizeWaterSources(paths, grid, inside);
      if (sim.updateMappedFeatures(sourceRaster.mask, pathRaster.mask)) {
        waterBodyMaskRef.current?.set(sourceRaster.mask);
        pathMaskRef.current.set(pathRaster.mask);
        graphRef.current?.update(sim.state);
      }
      const sourceAttribute = waterMeshRef.current?.geometry.getAttribute("aIsWaterBody") as THREE.BufferAttribute | undefined;
      if (sourceAttribute) { (sourceAttribute.array as Float32Array).set(sourceRaster.mask); sourceAttribute.needsUpdate = true; }
      waterwayTextureRef.current?.dispose();
      const waterwayMap = sourceRaster.featureCount ? createWaterwayDistanceTexture(sources, grid) : null;
      waterwayTextureRef.current = waterwayMap?.texture ?? null;
      const material = waterMaterialRef.current;
      if (material) {
        material.uniforms.uWaterwayDistance.value = waterwayMap?.texture ?? null;
        material.uniforms.uHasWaterwayDistance.value = waterwayMap ? 1 : 0;
        material.uniforms.uWaterwayDistanceRange.value = waterwayMap?.maxDistance ?? 1;
      }
      setOsmFeatureCount(sourceRaster.featureCount);
      setIsFallbackSource(sourceRaster.featureCount === 0);
      cesiumViewer?.scene.requestRender();
    }, [riverFeatures, roadFeatures, isReady, cesiumViewer]);

    useEffect(() => {
      const grid = gridMetaRef.current;
      const physics = physicsSimRef.current;
      if (!active || !isReady || !grid || !physics) {
        buildingSamplesRef.current = [];
        setBuildingExposure([]);
        return;
      }
      const worker = new Worker(new URL("./buildingExposure.worker.ts", import.meta.url), { type: "module" });
      exposureWorkerRef.current = worker;
      exposureBusyRef.current = false;
      setBuildingExposure([]);
      worker.onmessage = ({ data }) => {
        if (data.type === "indexed") {
          buildingSamplesRef.current = data.samples;
          requestExposure();
        } else {
          exposureBusyRef.current = false;
          if (data.revision === exposureRevisionRef.current) setBuildingExposure(data.exposures);
          if (exposureDirtyRef.current || data.revision !== exposureRevisionRef.current) requestExposure();
        }
      };
      worker.onerror = () => {
        exposureBusyRef.current = false;
        setForecastError("House assessment failed. Retry the calculation.");
      };
      const { cols, rows, west, east, south, north } = grid;
      worker.postMessage({ type: "index", buildings: buildingFeatures || [],
        grid: { cols, rows, west, east, south, north }, mask: physics.state.insideMask });
      return () => { worker.terminate(); exposureWorkerRef.current = null; exposureBusyRef.current = false; };

    }, [buildingFeatures, isReady, active, forecastRevision]);

    // Precompute from one frozen snapshot in a worker. Playback and visual-only
    // changes do not restart the calculation or rebuild the solver on the UI thread.
    useEffect(() => {
      const sim = physicsSimRef.current;
      if (!active || !isReady || !sim || completedReport) return;
      let cancelled = false;
      let worker: Worker | null = null;
      arrivalForecastRef.current = null;
      setArrivalForecast(null);
      exposureRevisionRef.current++;
      requestExposure();
      setForecastError(null);
      const input: ArrivalForecastInput = {
        config: { ...sim.config, manningN: parameters.roughness, flowModel: parameters.flowModel },
        bed: sim.state.bed,
        inside: sim.state.insideMask,
        sources: sim.state.isWaterway,
        paths: pathMaskRef.current,
        depth: sim.state.depth,
        initialSourceDepth: sim.state.initialSourceDepth,
        firstArrivalSeconds: sim.state.firstArrivalSeconds,
        velocityX: sim.state.velocityX,
        velocityY: sim.state.velocityY,
        discharges: sim.state.edges.map(edge => edge.discharge),
        elapsed: sim.state.elapsedSeconds,
        rainfall,
        sourceRise,
        parameters,
        horizon: Math.max(sim.state.elapsedSeconds + 3600, parameters.durationMinutes * 60),
      };
      const fail = () => {
        if (cancelled) return;
        worker?.terminate();
        setForecastError("Arrival estimates could not be prepared. Retry the calculation.");
      };
      try {
        worker = new Worker(new URL("./arrivalForecast.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<ArrivalForecastResult>) => {
          if (cancelled) return;
          const result = event.data;
          arrivalForecastRef.current = result;
          setArrivalForecast(result);
          requestExposure();
          if (result.complete) {
            worker?.terminate();
          }
        };
        worker.onerror = fail;
        worker.onmessageerror = fail;
        // Structured cloning freezes the forecast without detaching live buffers.
        worker.postMessage(input);
      } catch {
        fail();
      }
      return () => { cancelled = true; worker?.terminate(); };
    }, [active, isReady, forecastRevision, rainfall, sourceRise, parameters.durationMinutes,
      parameters.soilSaturation, parameters.infiltrationMmH, parameters.roughness,
      parameters.flowModel, parameters.floodIntensity, riverFeatures, roadFeatures, completedReport]);

    // ─── 4. IMPERATIVE CONTROLS ──────────────────────────────────────────────
    const handleStart = () => {
      if (!physicsSimRef.current || !waterMeshRef.current || isRunningRef.current) return;
      if (!simulationStartedAtRef.current) simulationStartedAtRef.current = new Date().toISOString();
      setCompletedReport(null);
      isRunningRef.current = true;
      isPausedRef.current = false;
      setIsRunning(true);
      setIsPaused(false);
      onRunningChange?.(true);
      onPauseChange?.(false);
      setStatusText("Rainfall and downhill runoff active");
      setControlsOpen(false);
      if (!cesiumViewer.isDestroyed()) cesiumViewer.scene.requestRender();
    };
    startPlaybackRef.current = handleStart;

    const handlePause = () => {
      isPausedRef.current = true;
      setIsPaused(true);
      onPauseChange?.(true);
      setStatusText("Paused");
      try {
        cesiumViewer.scene.requestRender();
      } catch (e) {}
    };

    const handleResume = () => {
      if (!isRunningRef.current) { handleStart(); return; }
      isRunningRef.current = true;
      isPausedRef.current = false;
      setIsPaused(false);
      onRunningChange?.(true);
      onPauseChange?.(false);
      setStatusText("Rainfall and downhill runoff active");
      try {
        cesiumViewer.scene.requestRender();
      } catch (e) {}
    };

    const handleApply = () => {
      if (!physicsSimRef.current || !waterMeshRef.current) return;
      parametersRef.current = parameters;
      rainfallRef.current = rainfall;
      sourceRiseRef.current = sourceRise;
      waveIntensityRef.current = waveIntensity;
      speedRef.current = speed;

      // Update physics configuration directly
      physicsSimRef.current.config.manningN = parameters.roughness;

      // If not running, start; if paused, resume
      if (!isRunningRef.current) {
        handleStart();
      } else if (isPausedRef.current) {
        handleResume();
      }

      setStatusText("Updated environment & scenario settings applied live");
      setControlsOpen(false);

      if (cesiumViewer && !cesiumViewer.isDestroyed()) {
        cesiumViewer.scene.requestRender();
      }
    };

    const handleReset = () => {
      cancelRoute();
      arrivalForecastRef.current = null;
      setForecastRevision(value => value + 1);
      simulationStartedAtRef.current = null;
      setCompletedReport(null);
      if (physicsSimRef.current) {
        physicsSimRef.current.reset();
        peakDepthRef.current.fill(0);
        setArrivalForecast(null);
        exposureRevisionRef.current++;
        requestExposure();
        setElapsedSeconds(0);
        setWaterVolume(0);
        graphRef.current?.update(physicsSimRef.current.state);
        setSpreadAreaHectares(physicsSimRef.current.state.floodedAreaHectares);
        setMaxDepthM(physicsSimRef.current.state.maxDepthM);

        const mesh = waterMeshRef.current;
        const gridMeta = gridMetaRef.current;
        if (mesh && gridMeta) {
          const geo = mesh.geometry as THREE.BufferGeometry;
          const posAttr = geo.attributes.position as THREE.BufferAttribute;
          const depthAttr = geo.attributes.aDepth as THREE.BufferAttribute;
          const velAttr = geo.attributes.aVelocity as THREE.BufferAttribute;

          for (let i = 0; i < physicsSimRef.current.state.totalCells; i++) {
            const isInside = insideMaskRef.current ? insideMaskRef.current[i] : 1;
            const d = isInside ? physicsSimRef.current.state.depth[i] : 0.0;
            posAttr.setY(i, gridMeta.positions[i * 3 + 1] + d);
            depthAttr.setX(i, d);
            velAttr.setXY(i, 0, 0);
          }

          posAttr.needsUpdate = true;
          depthAttr.needsUpdate = true;
          velAttr.needsUpdate = true;

        }
      }
      isRunningRef.current = false;
      isPausedRef.current = false;
      setIsRunning(false);
      setIsPaused(false);
      onRunningChange?.(false);
      onPauseChange?.(false);
      setControlsOpen(true);
      if (waterMaterialRef.current) {
        waterMaterialRef.current.uniforms.uTime.value = 0;
        waterMaterialRef.current.uniforms.uFlowTime.value = 0;
      }
      setStatusText("Reset to initial state");
      try {
        cesiumViewer.scene.requestRender();
      } catch (e) {}
    };

    const handleEndSimulation = async () => {
      isRunningRef.current = false;
      isPausedRef.current = true;
      setIsRunning(false);
      setIsPaused(true);
      onRunningChange?.(false);
      onPauseChange?.(false);

      const finalScenario: Record<string, unknown> = {
        model: parameters.flowModel,
        elapsedSeconds,
        centerLat,
        centerLng,
        polygon: stablePolygon,
        grid: gridResolutionText,
        rainfallMmH: rainfall,
        riverRiseM: sourceRise,
        ...parameters,
        maxDepthM,
        waterVolumeM3: waterVolume,
        floodedAreaHectares: spreadAreaHectares,
        areaName: (parameters as any).areaName || "Monitored Catchment Basin",
      };

      const stdReport = buildStandardFloodReport(finalScenario, buildingExposure, graphCounts);
      const runId = stdReport.cover.reportRef;
      const simReport = buildSimulationReport(
        runId,
        simulationStartedAtRef.current || new Date().toISOString(),
        finalScenario,
        buildingExposure,
        []
      );
      (simReport as any).standardReport = stdReport;

      setCompletedReport(simReport);
      setSaveStatus("Saving report...");
      toast.success("Simulation complete! Official 12-section flood report is available in the Reports page for download.");

      // 1. Save locally to localStorage so it is immediately visible in Reports page
      try {
        const localSaved = JSON.parse(localStorage.getItem("dt_saved_flood_reports") || "[]");
        const newEntry = {
          id: runId,
          title: `${finalScenario.areaName || "Monitored Catchment"} Flood Simulation`,
          report_type: "Flood Simulation",
          period: `Storm duration: ${parameters.durationMinutes} min`,
          zone_name: (finalScenario.areaName as string) || "Catchment Basin",
          status: "ready",
          size_kb: Math.round(JSON.stringify(simReport).length / 1024),
          simulation_report: simReport,
          created_at: new Date().toISOString(),
        };
        const filtered = [newEntry, ...localSaved.filter((r: any) => r.id !== runId)].slice(0, 20);
        localStorage.setItem("dt_saved_flood_reports", JSON.stringify(filtered));
      } catch (e) {
        console.warn("Could not cache report to localStorage", e);
      }

      // 2. Also save to backend
      try {
        const backendRunId = "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0");
        await apiPost("/reports/simulation", {
          title: `${finalScenario.areaName || "Monitored Basin"} Flood Simulation`,
          period: `Simulated: ${Math.round(elapsedSeconds)}s`,
          zone_name: (finalScenario.areaName as string) || "Catchment Basin",
          simulation_report: {
            ...simReport,
            runId: backendRunId,
          },
        });
        setSaveStatus("Saved to Reports database & local cache");
      } catch (err) {
        console.warn("Backend report save skipped, retained in local cache", err);
        setSaveStatus("Saved to Reports page library");
      }
    };

    const handleClose = () => {
      if (elapsedSeconds > 5 || waterVolume > 10) {
        handleEndSimulation();
        return;
      }
      isRunningRef.current = false;
      isPausedRef.current = false;
      setIsRunning(false);
      setIsPaused(false);
      onRunningChange?.(false);
      onPauseChange?.(false);
      if (physicsSimRef.current) {
        physicsSimRef.current.reset();
      }
      if (waterMaterialRef.current) {
        waterMaterialRef.current.uniforms.uTime.value = 0;
        waterMaterialRef.current.uniforms.uFlowTime.value = 0;
      }
      if (onClose) {
        onClose();
      }
      try {
        cesiumViewer.scene.requestRender();
      } catch (e) {}
    };

    useImperativeHandle(ref, () => ({
      getWaterRiskSnapshot: () => {
        const sim = physicsSimRef.current, grid = gridMetaRef.current;
        if (!active || !isReady || !sim || !grid) return null;
        // Borrow arrays for synchronous rasterization; callers must not mutate them.
        return { ...grid, elapsedSeconds: sim.state.elapsedSeconds,
          depth: sim.state.depth, velocityX: sim.state.velocityX, velocityY: sim.state.velocityY,
          inside: sim.state.insideMask, knownTerrain: knownTerrainRef.current };
      },
      calculateEvacuation: (origin, destination) => {
        cancelRoute();
        const sim = physicsSimRef.current, grid = gridMetaRef.current, forecast = arrivalForecastRef.current;
        if (!active || !isReady || !sim || !grid || !forecast) return Promise.resolve({ status: "error", message: "Terrain and arrival forecast are still loading. Retry when the simulation is ready." });
        return new Promise<EvacuationRouteResponse>(resolve => {
          const worker = new Worker(new URL("./evacuationPlanner.worker.ts", import.meta.url), { type: "module" });
          const timer = setTimeout(() => finish({ status: "error", message: "Route calculation timed out. Select a smaller area and retry." }), 20000);
          const finish = (result: EvacuationRouteResponse) => {
            clearTimeout(timer); worker.terminate();
            if (routeJobRef.current?.worker === worker) routeJobRef.current = null;
            resolve(result);
          };
          routeJobRef.current = { worker, finish };
          worker.onmessage = ({ data }) => finish(data);
          worker.onerror = () => finish({ status: "error", message: "Route worker failed. Please retry." });
          const { cols, rows, west, east, south, north, dx, dy } = grid;
          worker.postMessage({ grid: { cols, rows, west, east, south, north, dx, dy },
            bed: sim.state.bed, knownTerrain: knownTerrainRef.current, inside: sim.state.insideMask,
            depth: sim.state.depth, water: sim.state.isWaterway, arrivals: forecast.arrivals,
            forecastThrough: forecast.throughSeconds, elapsed: sim.state.elapsedSeconds,
            roads: roadFeaturesRef.current || [], origin, destination });
        });
      },
      openControls: () => setControlsOpen(true),
      closeControls: () => setControlsOpen(false),
      startSimulation: handleStart,
      pauseSimulation: handlePause,
      resumeSimulation: handleResume,
      resetSimulation: handleReset,
      setSourceRise: (r) => setSourceRise(r),
      setSpeed: (s) => setSpeed(clampFloodPlaybackSpeed(s)),
      setWaveIntensity: (w) => setWaveIntensity(w),
      toggleWater: (show) => setShowWater(show),
      toggleGraph: (show?: boolean) => {
        setShowGraph((current) => {
          const next = show !== undefined ? show : !current;
          showGraphRef.current = next;
          if (graphRef.current) {
            graphRef.current.group.visible = next;
          }
          if (cesiumViewer && !cesiumViewer.isDestroyed()) {
            cesiumViewer.scene.requestRender();
          }
          return next;
        });
      },
      endSimulation: handleEndSimulation,
      closeSimulation: handleClose,
    }));

    if (!active) return null;

    return (
      <>
        {/* Three.js Overlay Canvas Container */}
        <div
          ref={canvasContainerRef}
          className="absolute inset-0 pointer-events-none z-[12] overflow-hidden"
          style={{ width: "100%", height: "100%" }}
        />

        {/* 🌧️ Atmospheric Rain Overlay during Simulation */}
        <CesiumSelectedAreaRainOverlay
          viewer={cesiumViewer}
          polygonCoords={stablePolygon}
          active={Boolean(isRainVisible)}
          intensityMm={Math.max(60, rainfall || 150)}
          windSpeedKmh={parameters.windSpeedKmh}
          groundHeight={baseElevation}
          isFlatView={isFlatView}
          isPaused={isPaused}
        />

        {/* Sleek Loading HUD when initializing terrain and physics (hidden during rain auto-start: "while rain not load siluaion just start it") */}
        {!isReady && !autoStart && !isRainVisible && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] pointer-events-none transition-all duration-300">
            <div className="flex items-center gap-3.5 rounded-2xl border border-cyan-500/50 bg-slate-950/95 px-6 py-4 text-white shadow-2xl shadow-cyan-950/80">
              <Loader2 className="size-6 animate-spin text-cyan-400" />
              <div>
                <div className="text-sm font-bold text-cyan-100 flex items-center gap-2">
                  <CloudRain className="size-4 text-cyan-400" /> Flash Flood Digital Twin
                </div>
                <div className="text-xs text-cyan-300/90 font-mono mt-0.5">{statusText}</div>
              </div>
            </div>
          </div>
        )}

        {/* Billboard labels hovering over buildings in 3D Cesium view */}
        <BuildingArrivalLabels
          viewer={cesiumViewer}
          buildings={buildingFeatures || []}
          exposures={buildingExposure}
          elapsed={elapsedSeconds}
          forecast={arrivalForecast}
          selectedId={selectedHouseId}
          selectionEnabled={houseSelectionEnabled}
          onSelect={setSelectedHouseId}
          grid={gridMetaRef.current}
          bed={physicsSimRef.current?.state.bed}
        />

        <HouseArrivalPanel buildings={buildingExposure} elapsed={elapsedSeconds} forecast={arrivalForecast}
          selectedId={selectedHouseId} onSelect={setSelectedHouseId} error={forecastError} onRetry={() => setForecastRevision(value => value + 1)} />

        {/* Floating Control Panel HUD */}
        <FloodImpactReport
          buildings={buildingExposure}
          scenario={{
            model: parameters.flowModel,
            elapsedSeconds,
            centerLat,
            centerLng,
            polygon: stablePolygon,
            grid: gridResolutionText,
            rainfallMmH: rainfall,
            riverRiseM: sourceRise,
            ...parameters,
            maxDepthM,
            waterVolumeM3: waterVolume,
            floodedAreaHectares: spreadAreaHectares,
            areaName: (parameters as any).areaName || "Monitored Catchment Basin",
          }}
          graphCounts={graphCounts}
          completedReport={completedReport || undefined}
          saveStatus={saveStatus}
          onRetry={handleEndSimulation}
          onDismiss={() => setCompletedReport(null)}
        />
        <FlashFloodControlPanel
          isRunning={isRunning}
          isPaused={isPaused}
          showWater={showWater}
          sourceRise={sourceRise}
          speed={speed}
          waveIntensity={waveIntensity}
          statusText={statusText}
          isFallbackSource={isFallbackSource}
          osmFeatureCount={osmFeatureCount}
          gridResolution={gridResolutionText}
          elapsedSeconds={elapsedSeconds}
          spreadAreaHectares={spreadAreaHectares}
          maxDepthM={maxDepthM}
          isReady={isReady}
          rainfallMmH={rainfall}
          onRainfallChange={setRainfall}
          parameters={parameters}
          showGraph={showGraph}
          onToggleGraph={() => {
            setShowGraph(value => {
              const next = !value;
              showGraphRef.current = next;
              if (graphRef.current) {
                graphRef.current.group.visible = next;
              }
              if (cesiumViewer && !cesiumViewer.isDestroyed()) {
                cesiumViewer.scene.requestRender();
              }
              return next;
            });
          }}
          graphCounts={graphCounts}
          waterVolume={waterVolume}
          onApply={handleApply}
          onRestart={() => { handleReset(); handleStart(); }}
          onParametersChange={setParameters}
          open={controlsOpen}
          onOpenChange={setControlsOpen}
          fps={fps}
          effectiveSpeed={effectiveSpeed}
          renderScale={renderScale}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onReset={handleReset}
          onToggleVisibility={(v) => setShowWater(v)}
          showRain={isRainVisible}
          onToggleRain={handleToggleVisibleRain}
          onSourceRiseChange={(r) => setSourceRise(r)}
          onSpeedChange={(s) => setSpeed(clampFloodPlaybackSpeed(s))}
          onWaveIntensityChange={(w) => setWaveIntensity(w)}
          onClose={handleClose}
        />
      </>
    );
  }
);

ThreeWaterSimulation.displayName = "ThreeWaterSimulation";
export default ThreeWaterSimulation;

// ─── GEOMETRY HELPERS ────────────────────────────────────────────────────────
function isPointInPoly(lat: number, lng: number, poly: [number, number][]): boolean {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][1];
    const yi = poly[i][0];
    const xj = poly[j][1];
    const yj = poly[j][0];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function tagLineStringCells(
  coords: [number, number][],
  latList: number[],
  lngList: number[],
  cols: number,
  rows: number,
  insideMask: Uint8Array,
  sourceMask: Uint8Array,
  initialDepths: Float32Array
) {
  const channelCorridor = 0.00035; // ~35m channel corridor along waterway
  for (let s = 0; s < coords.length - 1; s++) {
    const [lng1, lat1] = coords[s];
    const [lng2, lat2] = coords[s + 1];

    const segLen = Math.hypot(lat2 - lat1, lng2 - lng1);
    const steps = Math.max(4, Math.ceil(segLen * 1200));
    for (let st = 0; st <= steps; st++) {
      const t = st / steps;
      const lat = lat1 + (lat2 - lat1) * t;
      const lng = lng1 + (lng2 - lng1) * t;

      for (let i = 0; i < latList.length; i++) {
        if (!insideMask[i]) continue;
        const d = Math.hypot(latList[i] - lat, lngList[i] - lng);
        if (d <= channelCorridor) {
          sourceMask[i] = 1;
          initialDepths[i] = Math.max(initialDepths[i], 1.8);
        }
      }
    }
  }
}

function tagPolygonCells(
  rings: [number, number][][],
  latList: number[],
  lngList: number[],
  cols: number,
  rows: number,
  insideMask: Uint8Array,
  sourceMask: Uint8Array,
  initialDepths: Float32Array
) {
  if (rings.length === 0) return;
  const outerRing = rings[0];
  const innerRings = rings.slice(1);

  for (let i = 0; i < latList.length; i++) {
    if (!insideMask[i]) continue;

    const lat = latList[i];
    const lng = lngList[i];

    // Inside outer ring
    if (isPointInPolyCoords(lng, lat, outerRing)) {
      // Must NOT be inside any inner hole ring
      let inHole = false;
      for (const hole of innerRings) {
        if (isPointInPolyCoords(lng, lat, hole)) {
          inHole = true;
          break;
        }
      }

      if (!inHole && insideMask[i]) {
        sourceMask[i] = 1;
        initialDepths[i] = Math.max(initialDepths[i], 2.2);
      }
    }
  }
}

function isPointInPolyCoords(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
