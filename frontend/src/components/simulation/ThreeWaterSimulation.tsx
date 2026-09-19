import React, { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Loader2, CloudRain } from "lucide-react";
import * as THREE from "three";
import { WaterPhysicsSimulation } from "./waterPhysics";
import { createWaterShaderMaterial } from "./WaterShaders";
import type { OsmWaterQueryResult, WaterSourceFeature } from "@/services/osmWaterSourceService";
import { FlashFloodControlPanel } from "./FlashFloodControlPanel";
import { defaultFlashFloodParameters, runoffRainfall } from "./flashFloodParameters";
import CesiumSelectedAreaRainOverlay from "./CesiumSelectedAreaRainOverlay";
import { rasterizeWaterSources } from "./water/sourceRaster";
import { fetchWater, type WaterFootprint } from "./water/osmWater";
import type { RiverFeature, RoadFeature } from "@/lib/routingApi";
import { createFlowGraphOverlay } from "./flowGraphOverlay";
import { indexBuildings, assessBuildings, type BuildingExposure, type BuildingSample } from "./buildingExposure";
import { FloodImpactReport } from "./FloodImpactReport";
import { BuildingArrivalLabels } from "./BuildingArrivalLabels";
import { createArrivalForecast, advanceArrivalForecast, type ArrivalForecastInput, type ArrivalForecastResult } from "./arrivalForecast";
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
  onPauseChange?: (isPaused: boolean) => void;
  onRunningChange?: (isRunning: boolean) => void;
  onReadyChange?: (isReady: boolean) => void;
  showVisibleRain?: boolean;
  onToggleVisibleRain?: (show: boolean) => void;
  onClose?: () => void;
  debugMode?: boolean;
}

export interface ThreeWaterSimulationHandle {
  openControls: () => void;
  startSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  resetSimulation: () => void;
  setSourceRise: (rise: number) => void;
  setSpeed: (speed: number) => void;
  setWaveIntensity: (intensity: number) => void;
  toggleWater: (show: boolean) => void;
  toggleGraph?: (show?: boolean) => void;
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
      onPauseChange,
      onRunningChange,
      onReadyChange,
      showVisibleRain,
      onToggleVisibleRain,
      onClose,
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
    const sceneColorTextureRef = useRef<THREE.CanvasTexture | null>(null);

    // Physics Engine Ref
    const physicsSimRef = useRef<WaterPhysicsSimulation | null>(null);
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
    const peakDepthRef = useRef(new Float32Array());
    const [buildingExposure, setBuildingExposure] = useState<BuildingExposure[]>([]);
    const [arrivalForecast, setArrivalForecast] = useState<ArrivalForecastResult | null>(null);
    const arrivalForecastRef = useRef<ArrivalForecastResult | null>(null);
    arrivalForecastRef.current = arrivalForecast;

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
    const [sourceRise, setSourceRise] = useState<number>(1.2);
    const [speed, setSpeed] = useState<number>(1);
    const [waveIntensity, setWaveIntensity] = useState<number>(1.0);
    const [statusText, setStatusText] = useState<string>("Initializing terrain & water sources…");
    const [isFallbackSource, setIsFallbackSource] = useState<boolean>(false);
    const [osmFeatureCount, setOsmFeatureCount] = useState<number>(0);
    const [gridResolutionText, setGridResolutionText] = useState<string>("Initializing…");
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
    const [spreadAreaHectares, setSpreadAreaHectares] = useState<number>(0);
    const [maxDepthM, setMaxDepthM] = useState<number>(0);
    const [isReady, setIsReady] = useState(false);
    const [controlsOpen, setControlsOpen] = useState(true);
    const [parameters, setParameters] = useState({ ...defaultFlashFloodParameters, windSpeedKmh });
    const parametersRef = useRef(parameters);
    parametersRef.current = parameters;
    const [rainfall, setRainfall] = useState(rainfallMmH ?? 0);
    const [fps, setFps] = useState(0);
    const [effectiveSpeed, setEffectiveSpeed] = useState(0);
    const [renderScale, setRenderScale] = useState(1);
    const rainfallRef = useRef(rainfall);
    rainfallRef.current = rainfall;
    useEffect(() => setRainfall(rainfallMmH), [rainfallMmH]);
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

    // ─── 1. INITIALIZE TERRAIN & OSM WATER BODIES ────────────────────────────
    useEffect(() => {
      if (!active || !cesiumViewer || cesiumViewer.isDestroyed()) return;

      const abortController = new AbortController();
      let isMounted = true;
      setIsRunning(false);
      setIsPaused(false);
      setIsReady(false);
      setControlsOpen(true);
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

        const maxGridAxis = 180;
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
            cartographics.push(Cesium.Cartographic.fromDegrees(lng, lat));
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

        // If no mapped waterways exist in the area, establish natural valley stream sources along lowest depressions
        if (waterFeatureCount === 0) {
          const elevThreshold = minElev + relief * 0.15;
          for (let i = 0; i < totalCells; i++) {
            if (insideMask[i] && sampledElevations[i] <= elevThreshold) {
              sourceMask[i] = 1;
              waterFeatureCount++;
            }
          }
          if (waterFeatureCount === 0) {
            const candidates = Array.from({ length: totalCells }, (_, i) => i)
              .filter(i => insideMask[i])
              .sort((a, b) => sampledElevations[a] - sampledElevations[b]);
            for (let k = 0; k < Math.min(16, candidates.length); k++) {
              sourceMask[candidates[k]] = 1;
              waterFeatureCount++;
            }
          }
        }

        waterBodyMaskRef.current = sourceMask;
        setIsFallbackSource(raster.featureCount === 0);
        setOsmFeatureCount(waterFeatureCount);

        // The precise Cesium river vectors remain the resting-water view.  The
        // hydraulic mesh starts dry so its coarse cells never paint a broad cyan
        // sheet over mapped channels before there is a real flood depth.
        for (let i = 0; i < totalCells; i++) {
          initialDepths[i] = 0.0;
        }

        // 5. Initialize Physics Simulation Engine with High-to-Low Momentum
        const physics = new WaterPhysicsSimulation(
          { cols: COLS, rows: ROWS, dx, dy, manningN: parametersRef.current.roughness, gravity: 9.81, flowModel: parametersRef.current.flowModel },
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

        // Ready state: load water on river channel without premature flood
        // Simulation starts when the user clicks Play or triggers simulation
        isRunningRef.current = false;
        isPausedRef.current = false;
        setIsRunning(false);
        setIsPaused(false);
        setControlsOpen(false);   // show quick toolbar
        onRunningChange?.(false);
        onPauseChange?.(false);

        setStatusText(
          `Ready • ${minElev.toFixed(0)}–${maxElev.toFixed(0)}m (${relief.toFixed(0)}m relief) · River loaded · Click Play to start flood simulation`
        );
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
    }, [active, cesiumViewer, centerLat, centerLng, polygonCoords]);

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
      const terrainMesh = new THREE.Mesh(terrainGeometry, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
      terrainMesh.frustumCulled = false;
      scene.add(terrainMesh);
      terrainMeshRef.current = terrainMesh;

      const container = canvasContainerRef.current;
      const res = new THREE.Vector2(container?.clientWidth || 800, container?.clientHeight || 600);

      sceneColorTextureRef.current?.dispose();
      const sceneTexture = new THREE.CanvasTexture(cesiumViewer.scene.canvas);
      sceneTexture.colorSpace = THREE.SRGBColorSpace;
      sceneTexture.minFilter = THREE.LinearFilter;
      sceneTexture.magFilter = THREE.LinearFilter;
      sceneColorTextureRef.current = sceneTexture;

      const material = createWaterShaderMaterial(sceneTexture, null, res);
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

      // 3. Camera Sync function
      const syncCamera = () => {
        if (!cesiumViewer || cesiumViewer.isDestroyed() || !cameraRef.current || !enuTransformRef.current)
          return;

        const cCamera = cesiumViewer.camera;
        const threeFrame = enuTransformRef.current.threeFrame;
        const camera = cameraRef.current;

        // Multiply Cesium's camera view matrix by the Three.js coordinate frame.
        // This mathematically aligns Three.js clip space with Cesium's clip space to the sub-millimeter.
        const view = new THREE.Matrix4()
          .fromArray(Array.from(cCamera.viewMatrix) as number[])
          .multiply(threeFrame);

        camera.matrixAutoUpdate = false;
        camera.matrix.copy(view).invert();
        camera.updateMatrixWorld(true);
        camera.position.setFromMatrixPosition(camera.matrixWorld);

        camera.projectionMatrix.fromArray(Array.from(cCamera.frustum.projectionMatrix) as number[]);
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
          // Fluid, responsive 35 FPS render rate: eliminates GPU fill-rate exhaustion & micro-stutters
          const frameInterval = isActive ? 1000 / 35 - 1 : 1000;
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
      // Dirty flag: only call renderer.render() when water or camera actually changed.
      // Skips redundant GPU draws during flat-view navigation (huge perf win).
      let renderDirty = true;
      let lastCamPosX = 0, lastCamPosY = 0, lastCamPosZ = 0;
      let lastCamDirX = 0, lastCamDirY = 0;

      const onPostRender = () => {
        const now = performance.now();
        if (document.hidden) { lastTime = now; return; }
        const frameMs = now - lastTime;
        if (frameMs < 250) frameTime = frameTime * 0.95 + frameMs * 0.05;
        if (now - qualityCheck > 3000 && !document.hidden) {
          qualityCheck = now;
          const ratio = renderer.getPixelRatio();
          const next = frameTime > 28 ? Math.max(0.75, ratio - 0.25)
            : frameTime < 18 ? Math.min(window.devicePixelRatio, 1.5, ratio + 0.25) : ratio;
          if (next !== ratio) renderer.setPixelRatio(next);
        }
        const dt = Math.min(frameMs / 1000, 0.1);
        lastTime = now;

        const mat = waterMaterialRef.current;
        if (mat) {
          if (sceneColorTextureRef.current) sceneColorTextureRef.current.needsUpdate = true;
          // Wave animation: base rate=1.0 so water always looks alive at 1x
          // Scales with speed when simulation is running (faster spread = faster waves)
          const waveRate = isRunningRef.current && !isPausedRef.current
            ? Math.max(1.0, speedRef.current * 0.5)
            : 0.8; // gentle ambient wave even when idle
          mat.uniforms.uTime.value += dt * waveRate;
          mat.uniforms.uWaveHeight.value = waveIntensityRef.current;
          mat.uniforms.uRainIntensity.value = isRunningRef.current && physicsSimRef.current && physicsSimRef.current.state.elapsedSeconds < parametersRef.current.durationMinutes * 60 ? rainfallRef.current / 300 : 0;
          renderer.getDrawingBufferSize(mat.uniforms.uResolution.value);
        }

        // Run Physics step if running and not paused
        const physics = physicsSimRef.current;
        const mesh = waterMeshRef.current;
        const gridMeta = gridMetaRef.current;

        if (isRunningRef.current && !isPausedRef.current) physicsTime += dt;
        else physicsTime = 0;
        if (physics && mesh && gridMeta && isRunningRef.current && !isPausedRef.current && physicsTime >= 1 / 35) {
          const currentParameters = parametersRef.current;
          physics.config.manningN = currentParameters.roughness;
          // Hydrograph with soft-start:
          // Even if parameters are maxed out, initial expansion starts very gently from the 10px river thread
          // and expands m² by m² outward over time.
          const stormDurationSec = Math.max(120, currentParameters.durationMinutes * 60);
          const elapsedSec = physics.state.elapsedSeconds;
          const secondsUntilStormEnds = stormDurationSec - elapsedSec;
          // Every playback option gets a 30× speed boost relative to the original scale.
          // 1× now delivers what previously required selecting 30× (30 × 1.5 = 45).
          // Water expands visibly fast so zoom-level changes are immediately apparent.
          const playbackMultiplier = speedRef.current * 45;
          // Advance exactly in display-time chunks so 1x evolves smoothly and
          // 60x reaches the extreme scenario within seconds.
          const safeDt = Math.min(1 / 35, physicsTime);
          const stepTime = secondsUntilStormEnds > 0 ? Math.min(safeDt, secondsUntilStormEnds / playbackMultiplier) : safeDt;

          const stormPhase = elapsedSec / stormDurationSec;
          // Smooth-in factor: 2-second ramp (at 45× multiplier, this equals 90 simulated seconds)
          const softStartFactor = Math.min(1.0, elapsedSec / 2.0);
          const softStart = softStartFactor * softStartFactor * (3.0 - 2.0 * softStartFactor);

          let timeRiseFactor = 0.0;
          if (stormPhase < 0.40) {
            timeRiseFactor = Math.sin((stormPhase / 0.40) * (Math.PI / 2)) * softStart;
          } else if (stormPhase < 0.80) {
            timeRiseFactor = 1.0;
          } else if (stormPhase < 1.0) {
            timeRiseFactor = Math.cos(((stormPhase - 0.80) / 0.20) * (Math.PI / 2));
          } else {
            timeRiseFactor = 0.0;
          }

          const runoff = runoffRainfall(rainfallRef.current, currentParameters, elapsedSec) * timeRiseFactor;
          const windMs = Math.max(0, currentParameters.windSpeedKmh) / 3.6;
          const windMultiplier = 1 + Math.min(1, windMs / 20) * 0.25;
          const effectiveRunoff = runoff * windMultiplier;
          const intensityScale = Math.max(0, (currentParameters.floodIntensity ?? 100)) / 100;
          const effectiveSourceRise = sourceRiseRef.current * intensityScale * timeRiseFactor;

          // The controls' extreme corner represents a basin-wide cloudburst,
          // not merely a stronger river source. This intentionally inundates
          // the selected area after the normal hydrograph ramps in, while all
          // ordinary combinations remain terrain-routed shallow-water flow.
          const isExtremeInundation =
            currentParameters.floodIntensity >= 195 &&
            rainfallRef.current >= 295 &&
            sourceRiseRef.current >= 9.5;
          const basinCloudburstMmH = isExtremeInundation ? 25000 * timeRiseFactor : 0;
          const appliedRunoff = Math.max(effectiveRunoff * intensityScale, basinCloudburstMmH);

          // Playback rate is proportional across every speed option.
          // Do not drop simulated time when a high playback setting needs
          // several CFL substeps. 1x and 60x now run the same model at their
          // selected ratio, rather than making 60x silently fall behind.
          const advanced = physics.advance(stepTime, playbackMultiplier, effectiveSourceRise, appliedRunoff);
          simulatedSinceTelemetry += advanced;
          if (mat) mat.uniforms.uFlowTime.value = physics.state.elapsedSeconds;
          physicsTime = Math.max(0, physicsTime - advanced / playbackMultiplier);

          // Update Geometry Buffers
          const geo = mesh.geometry as THREE.BufferGeometry;
          const posAttr = geo.attributes.position as THREE.BufferAttribute;
          const depthAttr = geo.attributes.aDepth as THREE.BufferAttribute;
          const velAttr = geo.attributes.aVelocity as THREE.BufferAttribute;

          const basePositions = gridMeta.positions;
          const depths = physics.state.depth;
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
            if (d > peaks[i]) peaks[i] = d;
            posArr[i * 3 + 1] = basePositions[i * 3 + 1] + d;
            depthArr[i] = d;
            velArr[i * 2 + 0] = isInside ? velX[i] : 0;
            velArr[i * 2 + 1] = isInside ? velY[i] : 0;
          }

          posAttr.needsUpdate = true;
          depthAttr.needsUpdate = true;
          velAttr.needsUpdate = true;
          renderDirty = true; // physics changed water geometry — must redraw

          // Throttle React state telemetry to 2 Hz (every 500ms) — fewer re-renders
          if (now - lastTelemetryTime > 500) {
            lastTelemetryTime = now;
            setElapsedSeconds(Math.round(physics.state.elapsedSeconds));
            setSpreadAreaHectares(physics.state.floodedAreaHectares);
            setMaxDepthM(physics.state.maxDepthM);
            setWaterVolume(physics.state.totalVolumeM3);
            setBuildingExposure(
              assessBuildings(
                buildingSamplesRef.current,
                depths,
                peakDepthRef.current,
                physics.state.firstArrivalSeconds,
                arrivalForecastRef.current?.arrivals
              )
            );
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

        // Check if camera moved since last frame — if so, must re-render
        const cCam = cesiumViewer.camera;
        const cp = cCam.position;
        const cd = cCam.direction;
        const camMoved = Math.abs(cp.x - lastCamPosX) + Math.abs(cp.y - lastCamPosY) + Math.abs(cp.z - lastCamPosZ) > 0.01
          || Math.abs(cd.x - lastCamDirX) + Math.abs(cd.y - lastCamDirY) > 0.0001;
        if (camMoved) {
          lastCamPosX = cp.x; lastCamPosY = cp.y; lastCamPosZ = cp.z;
          lastCamDirX = cd.x; lastCamDirY = cd.y;
          renderDirty = true;
        }
        // Wave animation runs even when paused — mark dirty so water ripples stay alive
        if (mat && (isRunningRef.current || showWaterRef.current)) renderDirty = true;

        // Toggle mesh visibility
        if (mesh) {
          mesh.visible = showWaterRef.current && Boolean(physics);
        }

        if (graphRef.current) graphRef.current.group.visible = showGraphRef.current;
        if (!showWaterRef.current && !showGraphRef.current) { renderer.clear(); renderDirty = false; return; }

        // Only pay GPU cost when something actually changed
        if (renderDirty) {
          syncCamera();
          renderer.render(scene, camera);
          renderDirty = false;
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
        if (waterMaterialRef.current) {
          waterMaterialRef.current.dispose();
          waterMaterialRef.current = null;
        }
        sceneColorTextureRef.current?.dispose();
        sceneColorTextureRef.current = null;
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
      if (!isReady || !grid || !inside || !physicsSimRef.current) return;
      const features: WaterSourceFeature[] = (roadFeatures || []).map(feature => ({
        id: feature.properties.id, name: feature.properties.name, waterType: "stream", isPolygon: false,
        geometry: feature.geometry, properties: { width_m: 6 },
      }));
      pathMaskRef.current.set(rasterizeWaterSources(features, grid, inside).mask);
      graphRef.current?.update(physicsSimRef.current.state);
      cesiumViewer?.scene.requestRender();
    }, [roadFeatures, isReady, cesiumViewer]);

    useEffect(() => {
      const grid = gridMetaRef.current;
      const physics = physicsSimRef.current;
      if (!active || !isReady || !grid || !physics) {
        buildingSamplesRef.current = [];
        setBuildingExposure([]);
        return;
      }
      buildingSamplesRef.current = indexBuildings(buildingFeatures || [], grid, physics.state.insideMask);
      setBuildingExposure(
        assessBuildings(
          buildingSamplesRef.current,
          physics.state.depth,
          peakDepthRef.current,
          physics.state.firstArrivalSeconds,
          arrivalForecastRef.current?.arrivals
        )
      );
    }, [buildingFeatures, isReady, active]);

    // Periodic arrival forecast rollout for building ETA estimation
    useEffect(() => {
      const physics = physicsSimRef.current;
      const grid = gridMetaRef.current;
      if (!active || !isReady || !physics || !grid) return;

      let cancelled = false;
      const computeForecast = () => {
        if (cancelled || !physicsSimRef.current) return;
        try {
          const sim = physicsSimRef.current;
          const input: ArrivalForecastInput = {
            config: sim.config,
            bed: sim.state.bed,
            inside: sim.state.insideMask,
            sources: sim.state.isSource,
            paths: pathMaskRef.current,
            depth: new Float32Array(sim.state.depth),
            discharges: sim.state.edges.map((e) => e.discharge),
            elapsed: sim.state.elapsedSeconds,
            rainfall,
            sourceRise,
            parameters,
            horizon: Math.max(sim.state.elapsedSeconds + 1800, parameters.durationMinutes * 60),
          };
          const forecastSim = createArrivalForecast(input);
          const result = advanceArrivalForecast(forecastSim, input, 4);
          if (!cancelled) {
            arrivalForecastRef.current = result;
            setArrivalForecast(result);
            if (physicsSimRef.current) {
              setBuildingExposure(
                assessBuildings(
                  buildingSamplesRef.current,
                  physicsSimRef.current.state.depth,
                  peakDepthRef.current,
                  physicsSimRef.current.state.firstArrivalSeconds,
                  result.arrivals
                )
              );
            }
          }
        } catch (e) {
          console.warn("Building arrival forecast rollout failed:", e);
        }
      };

      const timer = window.setTimeout(computeForecast, 200);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [active, isReady, isRunning, Math.floor(elapsedSeconds / 10), rainfall, sourceRise, parameters]);

    // ─── 4. IMPERATIVE CONTROLS ──────────────────────────────────────────────
    const handleStart = () => {
      if (!physicsSimRef.current || !waterMeshRef.current) return;
      isRunningRef.current = true;
      isPausedRef.current = false;
      setIsRunning(true);
      setIsPaused(false);
      onRunningChange?.(true);
      onPauseChange?.(false);
      setStatusText("Rainfall and downhill runoff active");
      setControlsOpen(false);
      try {
        cesiumViewer.scene.requestRender();
      } catch (e) {}
    };

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

    const handleReset = () => {
      if (physicsSimRef.current) {
        physicsSimRef.current.reset();
        peakDepthRef.current.fill(0);
        setArrivalForecast(null);
        setBuildingExposure(
          assessBuildings(
            buildingSamplesRef.current,
            physicsSimRef.current.state.depth,
            peakDepthRef.current,
            physicsSimRef.current.state.firstArrivalSeconds,
            undefined
          )
        );
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

    const handleClose = () => {
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
      openControls: () => setControlsOpen(true),
      startSimulation: handleStart,
      pauseSimulation: handlePause,
      resumeSimulation: handleResume,
      resetSimulation: handleReset,
      setSourceRise: (r) => setSourceRise(r),
      setSpeed: (s) => setSpeed(s),
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

        {/* Sleek Loading HUD when initializing terrain and physics */}
        {!isReady && (
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
        />

        {/* Floating Control Panel HUD */}
        <FloodImpactReport buildings={buildingExposure} scenario={{ model: parameters.flowModel, elapsedSeconds, centerLat, centerLng, polygon: stablePolygon, grid: gridResolutionText, rainfallMmH: rainfall, riverRiseM: sourceRise, ...parameters, maxDepthM, waterVolumeM3: waterVolume, floodedAreaHectares: spreadAreaHectares }} />
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
          showRain={showVisibleRain}
          onToggleRain={onToggleVisibleRain}
          onSourceRiseChange={(r) => setSourceRise(r)}
          onSpeedChange={(s) => setSpeed(s)}
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
