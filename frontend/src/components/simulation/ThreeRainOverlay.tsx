import React, { useEffect, useRef } from "react";
import * as THREE from "three";

interface ThreeRainOverlayProps {
  active: boolean;
  intensityMm?: number;
  windSpeedKmh?: number;
  windAngleDeg?: number;
  clipPath?: string;
  className?: string;
}

const TOTAL_DROPS = 30000;

const calcDrawCount = (intensity: number) => {
  const ratio = Math.min(1.0, Math.max(0.0, (intensity - 10) / (150 - 10)));
  const drops = Math.round(1500 + ratio * (TOTAL_DROPS - 1500));
  return drops * 2;
};

export default function ThreeRainOverlay({
  active,
  intensityMm = 65,
  windSpeedKmh = 24,
  windAngleDeg = 45,
  clipPath,
  className = "",
}: ThreeRainOverlayProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const rainGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const uniformsRef = useRef<{
    uTime: { value: number };
    uHeight: { value: number };
    uWind: { value: THREE.Vector2 };
    uIntensity: { value: number };
  } | null>(null);

  // Synchronize uniforms and dynamic drop line count when intensity or wind changes
  useEffect(() => {
    if (uniformsRef.current) {
      const mult = Math.max(0.4, intensityMm / 35.0);
      uniformsRef.current.uIntensity.value = mult;

      const rad = (windAngleDeg * Math.PI) / 180;
      const windFactor = (windSpeedKmh / 50.0) * 0.85;
      uniformsRef.current.uWind.value.set(Math.cos(rad) * windFactor, Math.sin(rad) * windFactor);
    }

    if (rainGeoRef.current) {
      rainGeoRef.current.setDrawRange(0, calcDrawCount(intensityMm));
    }
  }, [intensityMm, windSpeedKmh, windAngleDeg]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let width = container.clientWidth || 800;
    let height = container.clientHeight || 500;

    // ─── 1. Scene with Transparent Background ──────────────────────────────
    const scene = new THREE.Scene();
    scene.background = null;

    // ─── 2. Camera (Looking directly ahead so rain falls straight from the top) ───
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 300);
    camera.position.set(0, 0, 52);
    camera.lookAt(0, 0, 0);

    // ─── 3. WebGLRenderer with Alpha (Zero-Lag Capped Pixel Ratio) ─────────
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
      precision: "mediump",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ─── 4. GPU-Accelerated Rain Streaks (Scaled dynamically by intensity) ───
    const BOX_WIDTH = 100;
    const BOX_HEIGHT = 70;
    const BOX_DEPTH = 60;

    const rainPositions = new Float32Array(TOTAL_DROPS * 2 * 3);
    const rainSpeeds = new Float32Array(TOTAL_DROPS * 2);
    const rainLengths = new Float32Array(TOTAL_DROPS * 2);
    const rainIsHead = new Float32Array(TOTAL_DROPS * 2);

    for (let i = 0; i < TOTAL_DROPS; i++) {
      const idx = i * 2;
      const x = (Math.random() - 0.5) * BOX_WIDTH;
      const y = (Math.random() - 0.5) * BOX_HEIGHT;
      const z = (Math.random() - 0.5) * BOX_DEPTH;

      const speed = 40.0 + Math.random() * 32.0;
      const length = 1.8 + Math.random() * 2.2;

      // Tail
      rainPositions[idx * 3 + 0] = x;
      rainPositions[idx * 3 + 1] = y;
      rainPositions[idx * 3 + 2] = z;
      rainSpeeds[idx] = speed;
      rainLengths[idx] = length;
      rainIsHead[idx] = 0.0;

      // Head
      rainPositions[(idx + 1) * 3 + 0] = x;
      rainPositions[(idx + 1) * 3 + 1] = y;
      rainPositions[(idx + 1) * 3 + 2] = z;
      rainSpeeds[idx + 1] = speed;
      rainLengths[idx + 1] = length;
      rainIsHead[idx + 1] = 1.0;
    }

    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    rainGeo.setAttribute("aSpeed", new THREE.BufferAttribute(rainSpeeds, 1));
    rainGeo.setAttribute("aLength", new THREE.BufferAttribute(rainLengths, 1));
    rainGeo.setAttribute("aIsHead", new THREE.BufferAttribute(rainIsHead, 1));

    // Initialize draw range based on current rain intensity
    rainGeo.setDrawRange(0, calcDrawCount(intensityMm));
    rainGeoRef.current = rainGeo;

    const uniforms = {
      uTime: { value: 0 },
      uHeight: { value: BOX_HEIGHT },
      uWind: { value: new THREE.Vector2(0.2, 0.2) },
      uIntensity: { value: Math.max(0.4, intensityMm / 35.0) },
    };
    uniformsRef.current = uniforms;

    const rainMat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uTime;
        uniform float uHeight;
        uniform vec2 uWind;
        uniform float uIntensity;

        attribute float aSpeed;
        attribute float aLength;
        attribute float aIsHead;

        varying float vAlpha;

        void main() {
          float t = uTime * aSpeed * (0.8 + 0.3 * uIntensity);
          // Cyclic modulo fall: falls continuously from the TOP (+uHeight*0.5) down to the bottom (-uHeight*0.5)
          float y = mod(position.y - t + (uHeight * 100.0), uHeight) - (uHeight * 0.5);
          float fallNorm = (uHeight * 0.5 - y) / uHeight;

          // Natural wind deflection
          vec3 pos = vec3(
            position.x + uWind.x * fallNorm * 12.0,
            y - (aIsHead * aLength),
            position.z
          );

          // Soft fade in at top of viewport, smooth disappearance at bottom, zero circular shapes
          float edgeFade = smoothstep(-uHeight * 0.5, -uHeight * 0.44, y) * smoothstep(uHeight * 0.5, uHeight * 0.44, y);
          vAlpha = edgeFade * (0.35 + 0.65 * aIsHead);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          // Luminous crystal-blue rain streaks
          gl_FragColor = vec4(0.80, 0.93, 1.0, vAlpha * 0.85);
        }
      `,
    });

    const rainLines = new THREE.LineSegments(rainGeo, rainMat);
    scene.add(rainLines);

    // ─── 5. High-Efficiency Animation Loop (Runs only when active) ───────────
    const startTime = performance.now();

    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);

      const elapsedTime = (performance.now() - startTime) / 1000;

      if (uniformsRef.current) {
        uniformsRef.current.uTime.value = elapsedTime;
      }

      renderer.render(scene, camera);
    };

    animate();

    // ─── 6. Resize Observer ──────────────────────────────────────────────────
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // ─── 7. Cleanup ──────────────────────────────────────────────────────────
    return () => {
      resizeObserver.disconnect();
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      rainGeo.dispose();
      rainMat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className={`absolute inset-0 pointer-events-none z-[15] overflow-hidden transition-opacity duration-300 ${
        active ? "opacity-100" : "opacity-0"
      } ${className}`}
      style={{
        pointerEvents: "none",
        clipPath: clipPath || undefined,
        WebkitClipPath: clipPath || undefined,
      }}
    />
  );
}
