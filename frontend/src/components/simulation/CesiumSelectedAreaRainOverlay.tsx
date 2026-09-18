import React, { useEffect, useMemo, useRef } from "react";

interface CesiumSelectedAreaRainOverlayProps {
  viewer: any; // Cesium.Viewer
  polygonCoords: [number, number][] | null;
  active: boolean;
  intensityMm?: number;
  windSpeedKmh?: number;
  groundHeight?: number;
  isFlatView?: boolean;
  isPaused?: boolean;
  className?: string;
}

interface Drop {
  x: number;
  y: number;
  speed: number;
  length: number;
  thickness: number;
  alpha: number;
  normalizedU: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

export default function CesiumSelectedAreaRainOverlay({
  viewer,
  polygonCoords,
  active,
  intensityMm = 75,
  windSpeedKmh = 20,
  groundHeight = 293,
  isFlatView = false,
  isPaused = false,
  className = "",
}: CesiumSelectedAreaRainOverlayProps) {
  const polygonKey = JSON.stringify(polygonCoords);
  const stablePolygon = useMemo<[number, number][] | null>(() => JSON.parse(polygonKey), [polygonKey]);
  polygonCoords = stablePolygon;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const dropsRef = useRef<Drop[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const projectedPtsRef = useRef<{ x: number; y: number }[]>([]);
  const lastProjectTimeRef = useRef<number>(0);
  const isPausedRef = useRef<boolean>(isPaused);
  isPausedRef.current = isPaused;

  // Initialize drops - multi-layered pool for full view coverage (foreground & background)
  useEffect(() => {
    const totalDrops = Math.max(120, Math.min(260, Math.round(intensityMm * 2.2)));
    const drops: Drop[] = [];
    for (let i = 0; i < totalDrops; i++) {
      const isForeground = Math.random() < 0.42;
      drops.push({
        x: Math.random(),
        y: -40 + Math.random() * 1200,
        speed: isForeground ? 28 + Math.random() * 18 : 18 + Math.random() * 14,
        length: isForeground ? 32 + Math.random() * 24 : 20 + Math.random() * 16,
        thickness: isForeground ? 2.0 + Math.random() * 0.8 : 1.2 + Math.random() * 0.6,
        alpha: isForeground ? 0.80 + Math.random() * 0.20 : 0.45 + Math.random() * 0.25,
        normalizedU: Math.random(),
      });
    }
    dropsRef.current = drops;
    ripplesRef.current = [];
  }, [intensityMm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Wind drift offset in horizontal pixels per frame
    const windX = (windSpeedKmh / 20.0) * (isFlatView ? 4.2 : 3.2);

    let w = 0, h = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.round(rect.width); h = Math.round(rect.height);
      canvas.width = w; canvas.height = h;
      lastProjectTimeRef.current = 0;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas); resize();
    projectedPtsRef.current = [];
    let lastFrame = performance.now();

    const render = (now: number) => {
      animFrameIdRef.current = requestAnimationFrame(render);
      if (document.hidden) { lastFrame = now; return; }
      const elapsed = now - lastFrame;
      if (elapsed < 1000 / 60 - 1) return;

      // When simulation is paused, step is 0: drops freeze in place, ripples maintain radius/alpha
      const step = isPausedRef.current ? 0 : Math.min(elapsed, 50) / (1000 / 60);
      lastFrame = now;
      if (w <= 0 || h <= 0) return;

      ctx.clearRect(0, 0, w, h);

      const Cesium = (window as any).Cesium;

      // Inspect camera altitude to scale visibility and determine clipping
      let cameraAltitude = 6500;
      if (viewer && !viewer.isDestroyed() && Cesium && viewer.camera?.positionCartographic) {
        cameraAltitude = viewer.camera.positionCartographic.height;
      }

      // Close-up threshold: under 14,000m (all normal 3D digital twin viewing distances and flat view)
      // the camera is directly inside the rain atmosphere.
      const isCloseUp = cameraAltitude < 14000 || isFlatView;

      // Close proximity factor from 0.0 (high altitude >= 7000m) to 1.0 (close up <= 1500m)
      const closeFactor = Math.max(0, Math.min(1, (7000 - cameraAltitude) / 5500));

      // Only perform 2D screen clipping if we are far away in high orbit (> 14 km altitude)
      // AND all boundary polygon vertices are in front of the camera on screen.
      // When zooming in close, the camera is inside the area, so rain must cover the full screen!
      const shouldClipToFootprint = !isCloseUp && Boolean(polygonCoords && polygonCoords.length >= 3);
      let hasValidClip = false;

      if (shouldClipToFootprint && viewer && !viewer.isDestroyed() && Cesium && polygonCoords) {
        lastProjectTimeRef.current = now;
        projectedPtsRef.current = polygonCoords.map(([latitude, longitude]) => {
          const cartographic = Cesium.Cartographic.fromDegrees(longitude, latitude);
          const elevation = viewer.scene.globe.getHeight(cartographic) ?? groundHeight;
          return Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, Cesium.Cartesian3.fromDegrees(longitude, latitude, elevation));
        }).filter((point: any) => point && Number.isFinite(point.x) && Number.isFinite(point.y));

        hasValidClip = projectedPtsRef.current.length >= 3 && projectedPtsRef.current.length === polygonCoords.length;
      }

      ctx.save();
      if (shouldClipToFootprint && hasValidClip) {
        ctx.beginPath();
        projectedPtsRef.current.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
        ctx.closePath();
        ctx.clip();
      }

      // FULL VIEW: Rain spans screen width and height
      const minX = -60;
      const maxX = w + 60;
      const spanX = maxX - minX;

      // Atmospheric rain mist wash during active rainfall
      if (intensityMm > 15) {
        const mistAlpha = Math.min(0.15, (intensityMm / 100) * (0.07 + closeFactor * 0.06));
        const mistGrad = ctx.createLinearGradient(0, 0, 0, h);
        mistGrad.addColorStop(0, `rgba(186, 220, 248, ${mistAlpha * 0.4})`);
        mistGrad.addColorStop(0.7, `rgba(145, 190, 230, ${mistAlpha})`);
        mistGrad.addColorStop(1, `rgba(120, 165, 210, ${mistAlpha * 0.5})`);
        ctx.fillStyle = mistGrad;
        ctx.fillRect(0, 0, w, h);
      }

      // ─── 2. GROUND SPLASH RIPPLES ─────────
      const ripples = ripplesRef.current;
      if (ripples.length > 0) {
        ctx.beginPath();
        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i];
          if (step > 0) {
            r.radius += (isFlatView ? 1.3 : 1.0 + closeFactor * 0.6) * step;
            r.alpha -= (isFlatView ? 0.030 : 0.032) * step;
            if (r.alpha <= 0 || r.radius >= r.maxRadius) {
              ripples.splice(i, 1);
              continue;
            }
          }
          const rx = r.radius * (isFlatView ? 2.6 : 2.0);
          const ry = r.radius * (isFlatView ? 0.60 : 0.65);
          ctx.moveTo(r.x + rx, r.y);
          ctx.ellipse(r.x, r.y, rx, ry, 0, 0, Math.PI * 2);
        }
        ctx.strokeStyle = isFlatView
          ? "rgba(225, 248, 255, 0.75)"
          : `rgba(220, 245, 255, ${0.55 + closeFactor * 0.35})`;
        ctx.lineWidth = isFlatView ? 1.6 : 1.3 + closeFactor * 0.8;
        ctx.stroke();
      }

      // ─── 3. FALLING RAIN STREAKS ─────────
      const drops = dropsRef.current;
      const groundImpactY = h + 25;

      // Background rain layer (fine streaks)
      ctx.beginPath();
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.thickness > 1.3) continue; // Skip foreground

        if (step > 0) {
          d.y += d.speed * step;
        }
        const dropX = minX + d.normalizedU * spanX + (d.y / Math.max(1, h)) * windX;
        const dropY = d.y;

        if (step > 0 && d.y >= groundImpactY) {
          if (ripples.length < 75 && Math.random() < (isFlatView ? 0.40 : 0.30 + closeFactor * 0.20)) {
            const splashX = Math.max(15, Math.min(w - 15, dropX));
            const splashY = isFlatView
              ? (h * 0.50 + Math.random() * (h * 0.45))
              : Math.max(h * 0.35, Math.min(h - 10, d.y - 10));
            ripples.push({
              x: splashX,
              y: splashY,
              radius: 1.2,
              maxRadius: 8 + closeFactor * 8 + Math.random() * 6,
              alpha: 0.65 + closeFactor * 0.25,
            });
          }
          d.y = -30 - Math.random() * 50;
          d.normalizedU = Math.random();
        }

        const dropLen = d.length * (1 + closeFactor * 0.4);
        const endX = dropX + windX * 0.65;
        const endY = dropY + dropLen;

        ctx.moveTo(dropX, dropY);
        ctx.lineTo(endX, endY);
      }
      ctx.strokeStyle = isFlatView
        ? "rgba(210, 240, 255, 0.65)"
        : `rgba(205, 235, 255, ${0.50 + closeFactor * 0.28})`;
      ctx.lineWidth = isFlatView ? 1.4 : 1.1 + closeFactor * 0.6;
      ctx.lineCap = "round";
      ctx.stroke();

      // Foreground rain layer (crisp, brighter, clearly visible up close)
      ctx.beginPath();
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.thickness <= 1.3) continue; // Foreground only

        if (step > 0) {
          d.y += d.speed * step;
        }
        const dropX = minX + d.normalizedU * spanX + (d.y / Math.max(1, h)) * windX;
        const dropY = d.y;

        if (step > 0 && d.y >= groundImpactY) {
          if (ripples.length < 75 && Math.random() < (isFlatView ? 0.48 : 0.38 + closeFactor * 0.25)) {
            const splashX = Math.max(15, Math.min(w - 15, dropX));
            const splashY = isFlatView
              ? (h * 0.50 + Math.random() * (h * 0.45))
              : Math.max(h * 0.35, Math.min(h - 10, d.y - 10));
            ripples.push({
              x: splashX,
              y: splashY,
              radius: 1.5,
              maxRadius: 10 + closeFactor * 10 + Math.random() * 8,
              alpha: 0.75 + closeFactor * 0.20,
            });
          }
          d.y = -30 - Math.random() * 50;
          d.normalizedU = Math.random();
        }

        const dropLen = d.length * (1 + closeFactor * 0.55);
        const endX = dropX + windX * 0.70;
        const endY = dropY + dropLen;

        ctx.moveTo(dropX, dropY);
        ctx.lineTo(endX, endY);
      }
      ctx.strokeStyle = isFlatView
        ? "rgba(240, 252, 255, 0.92)"
        : `rgba(235, 250, 255, ${0.72 + closeFactor * 0.24})`;
      ctx.lineWidth = isFlatView ? 2.2 : 1.6 + closeFactor * 1.0;
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.restore();
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      observer.disconnect();
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, intensityMm, windSpeedKmh, isFlatView, viewer, polygonCoords, groundHeight]);

  return (
    <canvas
      ref={canvasRef}
      id="rain-overlay-canvas"
      data-testid="rain-overlay-canvas"
      data-active={active}
      data-paused={isPaused}
      className={`absolute inset-0 pointer-events-none z-[25] transition-opacity duration-300 ${
        active ? "opacity-100" : "opacity-0"
      } ${className}`}
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
