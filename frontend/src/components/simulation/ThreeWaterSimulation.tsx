import React, { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
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
      rainfallMmH = 100,
      windSpeedKmh = 20,
      isFlatView = false,
      onPauseChange,
      onRunningChange,
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

    // Physics Engine Ref
    const physicsSimRef = useRef<WaterPhysicsSimulation | null>(null);
    const insideMaskRef = useRef<Uint8Array | null>(null);
    const waterBodyMaskRef = useRef<Uint8Array | null>(null);
    const pathMaskRef = useRef<Uint8Array>(new Uint8Array());
    const graphRef = useRef<ReturnType<typeof createFlowGraphOverlay> | null>(null);
    const [showGraph, setShowGraph] = useState(false);
    const showGraphRef = useRef(showGraph);
    showGraphRef.current = showGraph;
    const [graphCounts, setGraphCounts] = useState({ nodes: 0, edges: 0, displayedEdges: 0 });
    const [waterVolume, setWaterVolume] = useState(0);
    const buildingSamplesRef = useRef<BuildingSample[]>([]);
    const peakDepthRef = useRef(new Float32Array());
    const [buildingExposure, setBuildingExposure] = useState<BuildingExposure[]>([]);
    const [arrivalForecast, setArrivalForecast] = useState<ArrivalForecastResult | null>(null);
    const arrivalForecastRef = useRef<ArrivalForecastResult | null>(null);
    arrivalForecastRef.current = arrivalForecast;

    // Local-inertial & ENU coordinate frame refs
    const effectiveCenterElevRef = useRef<number>(baseElevation);
    const enuTransformRef = useRef<{
      fixedToEnu: any;
      enuToFixed: any;
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
    const [speed, setSpeed] = useState<number>(15);
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
    const [rainfall, setRainfall] = useState(rainfallMmH);
    const [fps, setFps] = useState(0);
    const [effectiveSpeed, setEffectiveSpeed] = useState(0);
    const [renderScale, setRenderScale] = useState(1);
    const rainfallRef = useRef(rainfallMmH);
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
          const h = cesiumViewer.scene.globe.getHeight(centerCarto);
          if (h !== undefined && !isNaN(h) && h > -50) centerElev = h;
        } catch (e) {}
        effectiveCenterElevRef.current = centerElev;

        // Establish Local East-North-Up (ENU) Transform
        const centerCartesian = Cesium.Cartesian3.fromDegrees(centerLng, centerLat, centerElev);
        const enuToFixed = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);
        const fixedToEnu = Cesium.Matrix4.inverse(enuToFixed, new Cesium.Matrix4());
        enuTransformRef.current = { fixedToEnu, enuToFixed, centerCartesian };

        // Grid resolution: target ~10 - 14 meter cell spacing
        const radLat = (centerLat * Math.PI) / 180;
        const metersPerLat = 111132.92 - 559.82 * Math.cos(2 * radLat);
        const metersPerLng = 111412.84 * Math.cos(radLat);

        const totalWidthM = (east - west) * metersPerLng;
        const totalHeightM = (north - south) * metersPerLat;
        if (!(totalWidthM > 0 && totalHeightM > 0)) throw new Error("Select an area with nonzero width and height.");

        const spacing = Math.max(16, totalWidthM / 79, totalHeightM / 79);
        const COLS = Math.max(2, Math.round(totalWidthM / spacing) + 1);
        const ROWS = Math.max(2, Math.round(totalHeightM / spacing) + 1);
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

        // Sample terrain elevation with fast-path:
        // 1. Immediately read heights from already loaded globe terrain tiles (takes ~0ms)
        const sampledElevations = new Float32Array(COLS * ROWS).fill(NaN);
        const unmeasuredIndices: number[] = [];
        const unmeasuredCartos: any[] = [];

        for (let i = 0; i < cartographics.length; i++) {
          const h = cesiumViewer.scene.globe.getHeight(cartographics[i]);
          if (Number.isFinite(h) && h > -200) {
            sampledElevations[i] = h;
          } else {
            unmeasuredIndices.push(i);
            unmeasuredCartos.push(cartographics[i]);
          }
        }

        // 2. Only fetch terrain tiles for points that were not already loaded in memory
        if (
          unmeasuredCartos.length > 0 &&
          cesiumViewer.terrainProvider &&
          !(cesiumViewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)
        ) {
          try {
            const terrainSignal = AbortSignal.any([abortController.signal, AbortSignal.timeout(8000)]);
            const results: any[] = await new Promise((resolve, reject) => {
              const abort = () => reject(new Error("Terrain sampling timed out"));
              terrainSignal.addEventListener("abort", abort, { once: true });
              Promise.resolve(Cesium.sampleTerrainMostDetailed(cesiumViewer.terrainProvider, unmeasuredCartos, true))
                .then(resolve, reject)
                .finally(() => terrainSignal.removeEventListener("abort", abort));
            });
            for (let j = 0; j < results.length; j++) {
              const h = results[j]?.height;
              if (Number.isFinite(h)) {
                sampledElevations[unmeasuredIndices[j]] = h;
              }
            }
          } catch (e) {
            console.warn("[WaterSim] Falling back to approximate heights:", e);
          }
        }

        if (!isMounted) return;

        // 3. Complete any remaining unmeasured points with center elevation
        for (let i = 0; i < sampledElevations.length; i++) {
          if (!Number.isFinite(sampledElevations[i])) {
            sampledElevations[i] = centerElev;
          }
        }

        // 2. Fetch OSM Water Sources with fallbacks & caching
        setStatusText("Querying OpenStreetMap water bodies…");
        let osmResult: OsmWaterQueryResult = {
          features: [],
          isFallback: true,
          attribution: "© OpenStreetMap contributors",
          cached: false,
        };

        try {
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
              isFallback: false, cached: true, attribution: "© OpenStreetMap contributors",
            };
          } else {
            const footprints = await Promise.race([
              fetchWater([south, west, north, east], abortController.signal),
              new Promise<WaterFootprint[]>((resolve) => setTimeout(() => resolve([]), 2500))
            ]);
            osmResult = {
              features: footprints.map((footprint, index) => ({
                id: String(index), name: "Mapped water", waterType: footprint.rings ? "water" : "stream",
                isPolygon: Boolean(footprint.rings), properties: { width_m: footprint.width },
                geometry: footprint.rings ? { type: "Polygon", coordinates: footprint.rings } : { type: "LineString", coordinates: footprint.line },
              })),
              isFallback: footprints.length === 0, cached: false, attribution: "© OpenStreetMap contributors",
            };
          }
        } catch (err) {
          console.warn("[WaterSim] OSM fetch error:", err);
        }

        if (!isMounted) return;

        // 3. Calculate Elevation Relief and Mark Polygon Masks
        const totalCells = COLS * ROWS;
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

        // Tag OSM water sources into grid strictly inside the selected polygon
        let waterFeatureCount = 0;
        const waterFeatures = osmResult.features || [];

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

        waterBodyMaskRef.current = sourceMask;
        setIsFallbackSource(waterFeatureCount === 0);
        setOsmFeatureCount(raster.featureCount);

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

        // 6. Build Local ENU Three.js Mesh Coordinates
        const positions = new Float32Array(totalCells * 3);
        for (let i = 0; i < totalCells; i++) {
          const lat = latList[i];
          const lng = lngList[i];
          const elev = sampledElevations[i];

          const posCartesian = Cesium.Cartesian3.fromDegrees(lng, lat, elev);
          const posENU = Cesium.Matrix4.multiplyByPoint(
            fixedToEnu,
            posCartesian,
            new Cesium.Cartesian3()
          );

          // Map ENU (East: X, North: Y, Up: Z) to Three.js (X: East, Y: Up, Z: -North)
          positions[i * 3 + 0] = posENU.x;
          positions[i * 3 + 1] = posENU.z + 0.12; // Slight initial lift
          positions[i * 3 + 2] = -posENU.y;
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

        // 7. Build Three.js Geometry & Mesh across the entire polygon area
        buildThreeWaterMesh(COLS, ROWS, positions, sampledElevations, initialDepths, insideMask, sourceMask);
        graphRef.current?.dispose();
        graphRef.current = createFlowGraphOverlay(physics.state, positions, pathMaskRef.current);
        graphRef.current.group.visible = showGraphRef.current;
        sceneRef.current?.add(graphRef.current.group);
        setGraphCounts({ nodes: insideCellsCount, edges: physics.state.edges.length, displayedEdges: graphRef.current.displayedEdges });
        setIsReady(true);
        // Open the simulation settings panel first — user clicks Start to begin
        setIsRunning(false);
        setIsPaused(false);
        setControlsOpen(true);
        onRunningChange?.(false);
        onPauseChange?.(true);

        setStatusText(
          `Terrain ready • ${minElev.toFixed(0)}–${maxElev.toFixed(0)}m (${relief.toFixed(0)}m relief) · Configure settings and click Start`
        );
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

      // Build Plane indices: create triangles for ALL cells strictly inside the polygon area so water can flow downhill
      const indices: number[] = [];
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c;
          const b = r * cols + (c + 1);
          const cIdx = (r + 1) * cols + c;
          const d = (r + 1) * cols + (c + 1);

          // Triangle 1: inside boundary polygon
          if (insideMask[a] && insideMask[b] && insideMask[cIdx]) {
            indices.push(a, cIdx, b);
          }

          // Triangle 2: inside boundary polygon
          if (insideMask[b] && insideMask[cIdx] && insideMask[d]) {
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
      for (let i = 0; i < totalCells; i++) terrainPositions[i * 3 + 1] -= 0.12;
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

      // 3. Camera Sync function
      const syncCamera = () => {
        if (!cesiumViewer || cesiumViewer.isDestroyed() || !cameraRef.current || !enuTransformRef.current)
          return;

        const cCamera = cesiumViewer.camera;
        const fixedToEnu = enuTransformRef.current.fixedToEnu;

        // Camera position and vectors in ENU
        const camPosENU = Cesium.Matrix4.multiplyByPoint(
          fixedToEnu,
          cCamera.positionWC,
          new Cesium.Cartesian3()
        );
        const camDirENU = Cesium.Matrix4.multiplyByPointAsVector(
          fixedToEnu,
          cCamera.directionWC,
          new Cesium.Cartesian3()
        );
        const camUpENU = Cesium.Matrix4.multiplyByPointAsVector(
          fixedToEnu,
          cCamera.upWC,
          new Cesium.Cartesian3()
        );

        // Map ENU (East: X, North: Y, Up: Z) to Three.js (X: East, Y: Up, Z: -North)
        camera.position.set(camPosENU.x, camPosENU.z, -camPosENU.y);
        const lookTarget = new THREE.Vector3(
          camPosENU.x + camDirENU.x,
          camPosENU.z + camDirENU.z,
          -(camPosENU.y + camDirENU.y)
        );
        camera.up.set(camUpENU.x, camUpENU.z, -camUpENU.y);
        camera.lookAt(lookTarget);

        camera.projectionMatrix.fromArray(Array.from(cCamera.frustum.projectionMatrix) as number[]);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        camera.updateMatrixWorld(true);
      };

      const resize = new ResizeObserver(() => {
        renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
        cesiumViewer.scene.requestRender();
      });
      resize.observe(container);
      // Share Cesium's update clock; no second animation loop for water.
      let requestedAt = 0;
      const removeFrameRequest = cesiumViewer.scene.preUpdate.addEventListener(() => {
        const now = performance.now();
        if (document.hidden || !waterMeshRef.current || now - requestedAt < 1000 / 60 - 1) return;
        if (isRunningRef.current && !isPausedRef.current) {
          requestedAt = now;
          cesiumViewer.scene.requestRender();
        }
      });

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
          const next = frameTime > 28 ? Math.max(0.75, ratio - 0.25)
            : frameTime < 18 ? Math.min(window.devicePixelRatio, 1.5, ratio + 0.25) : ratio;
          if (next !== ratio) renderer.setPixelRatio(next);
        }
        const dt = Math.min(frameMs / 1000, 0.1);
        lastTime = now;

        const mat = waterMaterialRef.current;
        if (mat) {
          if (isRunningRef.current && !isPausedRef.current) mat.uniforms.uTime.value += dt;
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
        if (physics && mesh && gridMeta && isRunningRef.current && !isPausedRef.current && physicsTime >= 1 / 30) {
          const currentParameters = parametersRef.current;
          physics.config.manningN = currentParameters.roughness;
          physics.config.flowModel = currentParameters.flowModel;
          const secondsUntilStormEnds = currentParameters.durationMinutes * 60 - physics.state.elapsedSeconds;
          const stepTime = secondsUntilStormEnds > 0 ? Math.min(physicsTime, secondsUntilStormEnds / speedRef.current) : physicsTime;
          const runoff = runoffRainfall(rainfallRef.current, currentParameters, physics.state.elapsedSeconds);
          // Wind speed (m/s) boosts effective rainfall by 0–25%: high winds drive rain at an angle,
          // concentrating more precipitation into the catchment (linear, capped at 20 m/s / 72 km/h).
          const windMs = Math.max(0, currentParameters.windSpeedKmh) / 3.6;
          const windMultiplier = 1 + Math.min(1, windMs / 20) * 0.25;
          // Effective runoff scales directly with rainfall after infiltration; no artificial floor
          // so light rain produces light flooding and zero rain produces zero new water injection.
          const effectiveRunoff = runoff * windMultiplier;
          // River rise scales proportionally with user-selected sourceRise and active runoff
          const effectiveSourceRise = sourceRiseRef.current * (0.6 + 0.4 * Math.min(2, effectiveRunoff / 50));
          const advanced = physics.advance(stepTime, speedRef.current, effectiveSourceRise, effectiveRunoff, 6);
          simulatedSinceTelemetry += advanced;
          if (mat) mat.uniforms.uFlowTime.value = physics.state.elapsedSeconds;
          physicsTime = 0;

          // Update Geometry Buffers
          const geo = mesh.geometry as THREE.BufferGeometry;
          const posAttr = geo.attributes.position as THREE.BufferAttribute;
          const depthAttr = geo.attributes.aDepth as THREE.BufferAttribute;
          const velAttr = geo.attributes.aVelocity as THREE.BufferAttribute;

          const basePositions = gridMeta.positions;
          const depths = physics.state.depth;
          const velX = physics.state.velocityX;
          const velY = physics.state.velocityY;

          for (let i = 0; i < physics.state.totalCells; i++) {
            const isInside = insideMaskRef.current ? insideMaskRef.current[i] : 1;
            const d = isInside ? depths[i] : 0.0;
            peakDepthRef.current[i] = Math.max(peakDepthRef.current[i], d);
            // Elevate vertex Y (upward in Three.js coordinate system) by water depth
            posAttr.setY(i, basePositions[i * 3 + 1] + d);
            depthAttr.setX(i, d);
            velAttr.setXY(i, isInside ? velX[i] : 0, isInside ? velY[i] : 0);
          }

          posAttr.needsUpdate = true;
          depthAttr.needsUpdate = true;
          velAttr.needsUpdate = true;


          // Throttle React state telemetry updates to ~4 Hz
          if (now - lastTelemetryTime > 250) {
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
        if (!showWaterRef.current && !showGraphRef.current) { renderer.clear(); return; }
        // Sync camera and render
        syncCamera();
        renderer.render(scene, camera);
      };

      const removePostRenderListener = cesiumViewer.scene.postRender.addEventListener(onPostRender);

      return () => {
        removeFrameRequest();
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
      if (showGraph && physicsSimRef.current) graphRef.current?.update(physicsSimRef.current.state);
      if (cesiumViewer && !cesiumViewer.isDestroyed()) cesiumViewer.scene.requestRender();
    }, [cesiumViewer, showWater, showGraph, isRunning, isPaused, waveIntensity]);

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
          const result = advanceArrivalForecast(forecastSim, input, 80);
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
      setIsRunning(true);
      setIsPaused(false);
      onRunningChange?.(true);
      onPauseChange?.(false);
      setStatusText("Rainfall and downhill runoff active");
      setControlsOpen(false);
    };

    const handlePause = () => {
      setIsPaused(true);
      onPauseChange?.(true);
      setStatusText("Paused");
    };

    const handleResume = () => {
      setIsPaused(false);
      onRunningChange?.(true);
      onPauseChange?.(false);
      setStatusText("Rainfall and downhill runoff active");
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
    };

    const handleClose = () => {
      setIsRunning(false);
      setIsPaused(false);
      onRunningChange?.(false);
      onPauseChange?.(false);
      if (physicsSimRef.current) {
        physicsSimRef.current.reset();
      }
      if (onClose) {
        onClose();
      }
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
      closeSimulation: handleClose,
    }));

    if (!active) return null;

    return (
      <>
        {/* Three.js Overlay Canvas Container */}
        <div
          ref={canvasContainerRef}
          className="absolute inset-0 pointer-events-none z-15 overflow-hidden"
          style={{ width: "100%", height: "100%" }}
        />

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
          onToggleGraph={() => setShowGraph(value => !value)}
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
