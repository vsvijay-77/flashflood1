import React, { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { WaterPhysicsSimulation } from "./waterPhysics";
import { createWaterShaderMaterial } from "./WaterShaders";
import { fetchOsmWaterSources, type OsmWaterQueryResult, type WaterSourceFeature } from "@/services/osmWaterSourceService";
import { WaterSimulationControlPanel } from "./WaterSimulationControlPanel";

declare const Cesium: any;

export interface ThreeWaterSimulationProps {
  cesiumViewer: any;
  centerLat: number;
  centerLng: number;
  baseElevation?: number;
  polygonCoords?: [number, number][] | null;
  active: boolean;
  onClose?: () => void;
  debugMode?: boolean;
}

export interface ThreeWaterSimulationHandle {
  startSimulation: () => void;
  pauseSimulation: () => void;
  resumeSimulation: () => void;
  resetSimulation: () => void;
  setSourceRise: (rise: number) => void;
  setSpeed: (speed: number) => void;
  setWaveIntensity: (intensity: number) => void;
  toggleWater: (show: boolean) => void;
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
    const [speed, setSpeed] = useState<number>(10);
    const [waveIntensity, setWaveIntensity] = useState<number>(1.0);
    const [statusText, setStatusText] = useState<string>("Initializing terrain & water sources…");
    const [isFallbackSource, setIsFallbackSource] = useState<boolean>(false);
    const [osmFeatureCount, setOsmFeatureCount] = useState<number>(0);
    const [gridResolutionText, setGridResolutionText] = useState<string>("Initializing…");
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
    const [spreadAreaHectares, setSpreadAreaHectares] = useState<number>(0);
    const [maxDepthM, setMaxDepthM] = useState<number>(0);

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
      physicsSimRef.current = null;

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

        const spacing = Math.max(12, totalWidthM / 95, totalHeightM / 95);
        const COLS = Math.max(2, Math.round(totalWidthM / spacing) + 1);
        const ROWS = Math.max(2, Math.round(totalHeightM / spacing) + 1);
        const dx = totalWidthM / (COLS - 1);

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

        // Sample terrain elevation using Cesium.sampleTerrainMostDetailed
        let sampledElevations = new Float32Array(COLS * ROWS);
        try {
          if (cesiumViewer.terrainProvider) {
            const terrainSignal = AbortSignal.any([abortController.signal, AbortSignal.timeout(30000)]);
            const results: any[] = await new Promise((resolve, reject) => {
              const abort = () => reject(new Error("Terrain sampling timed out"));
              terrainSignal.addEventListener("abort", abort, { once: true });
              Promise.resolve(Cesium.sampleTerrainMostDetailed(cesiumViewer.terrainProvider, cartographics))
                .then(resolve, reject).finally(() => terrainSignal.removeEventListener("abort", abort));
            });
            for (let i = 0; i < results.length; i++) {
              const h = results[i]?.height;
              sampledElevations[i] = h !== undefined && !isNaN(h) && h > -50 ? h : centerElev;
            }
          } else {
            for (let i = 0; i < cartographics.length; i++) {
              const h = cesiumViewer.scene.globe.getHeight(cartographics[i]);
              sampledElevations[i] = h !== undefined && !isNaN(h) && h > -50 ? h : centerElev;
            }
          }
        } catch (e) {
          if (!isMounted) return;
          console.warn("[WaterSim] Falling back to globe height:", e);
          for (let i = 0; i < cartographics.length; i++) {
            const h = cesiumViewer.scene.globe.getHeight(cartographics[i]);
            sampledElevations[i] = h !== undefined && !isNaN(h) && h > -50 ? h : centerElev;
          }
        }

        if (!isMounted) return;

        // 2. Fetch OSM Water Sources with fallbacks & caching
        setStatusText("Querying OpenStreetMap water bodies…");
        let osmResult: OsmWaterQueryResult = {
          features: [],
          isFallback: true,
          attribution: "© OpenStreetMap contributors",
          cached: false,
        };

        try {
          osmResult = await fetchOsmWaterSources(
            { south, west, north, east },
            abortController.signal
          );
        } catch (err) {
          console.warn("[WaterSim] OSM fetch error:", err);
        }

        if (!isMounted) return;

        // 3. Calculate Elevation Relief and Mark Polygon Masks
        const totalCells = COLS * ROWS;
        const insideMask = new Uint8Array(totalCells);
        const sourceMask = new Uint8Array(totalCells);
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

        for (const feat of waterFeatures) {
          const geom = feat.geometry;
          if (!geom) continue;

          if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
            tagLineStringCells(geom.coordinates, latList, lngList, COLS, ROWS, insideMask, sourceMask, initialDepths);
          } else if (geom.type === "MultiLineString" && Array.isArray(geom.coordinates)) {
            for (const line of geom.coordinates) {
              tagLineStringCells(line, latList, lngList, COLS, ROWS, insideMask, sourceMask, initialDepths);
            }
          } else if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
            tagPolygonCells(geom.coordinates, latList, lngList, COLS, ROWS, insideMask, sourceMask, initialDepths);
          } else if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
            for (const poly of geom.coordinates) {
              tagPolygonCells(poly, latList, lngList, COLS, ROWS, insideMask, sourceMask, initialDepths);
            }
          }
        }

        // Count OSM water cells
        for (let i = 0; i < totalCells; i++) {
          if (insideMask[i] && sourceMask[i]) {
            waterFeatureCount++;
          }
        }

        // OSM sources take precedence; an unmapped area gets a small scenario
        // inflow near its highest terrain, rather than flooding every hilltop.
        let highSourceCount = 0;
        if (waterFeatureCount === 0 && insideCellsCount > 0) {
          const candidates = Array.from({ length: totalCells }, (_, i) => i)
            .filter(i => insideMask[i]).sort((a, b) => sampledElevations[b] - sampledElevations[a]);
          const count = Math.max(1, Math.ceil(candidates.length * 0.01));
          for (const i of candidates.slice(0, count)) {
            sourceMask[i] = 1;
            initialDepths[i] = 1.5;
            highSourceCount++;
          }
        }

        waterBodyMaskRef.current = sourceMask;
        setIsFallbackSource(waterFeatureCount === 0);
        setOsmFeatureCount(waterFeatureCount || highSourceCount);

        // 5. Initialize Physics Simulation Engine with High-to-Low Momentum
        const physics = new WaterPhysicsSimulation(
          { cols: COLS, rows: ROWS, dx, manningN: 0.035, gravity: 9.81 },
          sampledElevations,
          insideMask,
          sourceMask,
          initialDepths
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
          south,
          west,
          north,
          east,
          positions,
        };

        // 7. Build Three.js Geometry & Mesh across the entire polygon area
        buildThreeWaterMesh(COLS, ROWS, positions, sampledElevations, initialDepths, insideMask, sourceMask);

        setStatusText(
          `Ready • Slope: ${minElev.toFixed(0)}m → ${maxElev.toFixed(0)}m (${relief.toFixed(0)}m drop, ${highSourceCount} high-inflow cells)`
        );
      };

      setupSimulation().catch(error => {
        if (isMounted) setStatusText(`Unable to initialize water: ${error.message}`);
      });

      return () => {
        isMounted = false;
        abortController.abort();
      };
    }, [active, cesiumViewer, centerLat, centerLng, baseElevation, polygonCoords]);

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

      // Live Cesium canvas texture for screen-space refraction
      if (cesiumViewer?.scene?.canvas && !sceneColorTextureRef.current) {
        const tex = new THREE.CanvasTexture(cesiumViewer.scene.canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        sceneColorTextureRef.current = tex;
      }

      const container = canvasContainerRef.current;
      const res = new THREE.Vector2(container?.clientWidth || 800, container?.clientHeight || 600);

      const material = createWaterShaderMaterial(sceneColorTextureRef.current, null, res);
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
        if (showWaterRef.current || (isRunningRef.current && !isPausedRef.current)) {
          requestedAt = now;
          cesiumViewer.scene.requestRender();
        }
      });

      // 4. Cesium postRender callback: updates physics and renders overlay
      let lastTime = performance.now();
      let lastTelemetryTime = 0;
      let textureTime = 0;
      let physicsTime = 0;
      let frameTime = 16.7;
      let qualityCheck = performance.now();

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
          mat.uniforms.uTime.value += dt * 0.4;
          mat.uniforms.uWaveHeight.value = waveIntensityRef.current;
          renderer.getDrawingBufferSize(mat.uniforms.uResolution.value);

          // Update Cesium canvas texture for screen-space refraction
          if (sceneColorTextureRef.current && showWaterRef.current && now - textureTime >= 1000 / 30) {
            textureTime = now;
            sceneColorTextureRef.current.needsUpdate = true;
          }
        }

        // Run Physics step if running and not paused
        const physics = physicsSimRef.current;
        const mesh = waterMeshRef.current;
        const gridMeta = gridMetaRef.current;

        if (isRunningRef.current && !isPausedRef.current) physicsTime += dt;
        else physicsTime = 0;
        if (physics && mesh && gridMeta && isRunningRef.current && !isPausedRef.current && physicsTime >= 1 / 30) {
          physics.advance(physicsTime, speedRef.current, sourceRiseRef.current);
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
          }
        }

        // Toggle mesh visibility
        if (mesh) {
          mesh.visible = showWaterRef.current;
        }

        if (!showWaterRef.current) { renderer.clear(); return; }
        // Sync camera and render
        syncCamera();
        renderer.render(scene, camera);
      };

      const removePostRenderListener = cesiumViewer.scene.postRender.addEventListener(onPostRender);

      return () => {
        removeFrameRequest();
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
        if (sceneColorTextureRef.current) {
          sceneColorTextureRef.current.dispose();
          sceneColorTextureRef.current = null;
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
      if (cesiumViewer && !cesiumViewer.isDestroyed()) cesiumViewer.scene.requestRender();
    }, [cesiumViewer, showWater, isRunning, isPaused, waveIntensity]);

    // ─── 4. IMPERATIVE CONTROLS ──────────────────────────────────────────────
    const handleStart = () => {
      if (!physicsSimRef.current || !waterMeshRef.current) return;
      setIsRunning(true);
      setIsPaused(false);
      setStatusText(isFallbackSource ? "Simulating (Fallback Source)" : "Simulating (OSM Water Sources)");
    };

    const handlePause = () => {
      setIsPaused(true);
      setStatusText("Paused");
    };

    const handleResume = () => {
      setIsPaused(false);
      setStatusText(isFallbackSource ? "Simulating (Fallback Source)" : "Simulating (OSM Water Sources)");
    };

    const handleReset = () => {
      if (physicsSimRef.current) {
        physicsSimRef.current.reset();
        setElapsedSeconds(0);
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
      setStatusText("Reset to initial state");
    };

    const handleClose = () => {
      setIsRunning(false);
      setIsPaused(false);
      if (physicsSimRef.current) {
        physicsSimRef.current.reset();
      }
      if (onClose) {
        onClose();
      }
    };

    useImperativeHandle(ref, () => ({
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

        {/* Floating Control Panel HUD */}
        <WaterSimulationControlPanel
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
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onReset={handleReset}
          onToggleVisibility={(v) => setShowWater(v)}
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
