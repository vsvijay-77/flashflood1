import React, { useEffect, useRef } from "react";

interface CesiumSelectedAreaRainOverlayProps {
  viewer: any; // Cesium.Viewer
  polygonCoords: [number, number][] | null;
  active: boolean;
  intensityMm?: number;
  windSpeedKmh?: number;
  groundHeight?: number;
  isFlatView?: boolean;
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

function isPointInPoly(lat: number, lng: number, poly: [number, number][]): boolean {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][1], yi = poly[i][0];
    const xj = poly[j][1], yj = poly[j][0];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export default function CesiumSelectedAreaRainOverlay({
  viewer,
  polygonCoords,
  active,
  intensityMm = 75,
  windSpeedKmh = 20,
  groundHeight = 293,
  isFlatView = false,
  className = "",
}: CesiumSelectedAreaRainOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const dropsRef = useRef<Drop[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const projectedPtsRef = useRef<{ x: number; y: number }[]>([]);
  const boundsRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number }>({
    minX: 0,
    maxX: 1000,
    minY: 0,
    maxY: 800,
  });
  const lastProjectTimeRef = useRef<number>(0);

  // Initialize drops - optimized lightweight pool (120 to 220 drops is plenty for high density)
  useEffect(() => {
    const totalDrops = Math.max(100, Math.min(240, Math.round(intensityMm * 2.2)));
    const drops: Drop[] = [];
    for (let i = 0; i < totalDrops; i++) {
      drops.push({
        x: Math.random(),
        y: -30 + Math.random() * 1000,
        speed: 18 + Math.random() * 16,
        length: 22 + Math.random() * 22,
        thickness: 1.4 + Math.random() * 1.0,
        alpha: 0.55 + Math.random() * 0.35,
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
    const windX = (windSpeedKmh / 20.0) * 3.2;

    const render = () => {
      animFrameIdRef.current = requestAnimationFrame(render);

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w <= 0 || h <= 0) return;

      // Use standard 1x pixel ratio for rain overlay to save massive GPU fillrate
      if (canvas.width !== Math.round(w) || canvas.height !== Math.round(h)) {
        canvas.width = Math.round(w);
        canvas.height = Math.round(h);
      }

      ctx.clearRect(0, 0, w, h);

      const Cesium = (window as any).Cesium;
      const hasViewer = viewer && !viewer.isDestroyed() && viewer.scene;
      const scene = hasViewer ? viewer.scene : null;

      // Throttled boundary projection: reproject at most every 60ms or when camera moves
      const now = performance.now();
      let standingInsideArea = isFlatView;

      if (now - lastProjectTimeRef.current > 60 && hasViewer && polygonCoords && polygonCoords.length >= 3) {
        lastProjectTimeRef.current = now;

        const toWindowCoords =
          Cesium?.SceneTransforms?.worldToWindowCoordinates ||
          Cesium?.SceneTransforms?.wgs84ToWindowCoordinates;

        if (toWindowCoords) {
          const pts: { x: number; y: number }[] = [];
          for (let i = 0; i < polygonCoords.length; i++) {
            const [lat, lng] = polygonCoords[i];
            try {
              const cart3 = Cesium.Cartesian3.fromDegrees(Number(lng), Number(lat), groundHeight);
              const win = toWindowCoords.call(Cesium.SceneTransforms, scene, cart3);
              if (win && !isNaN(win.x) && !isNaN(win.y)) {
                pts.push({ x: win.x, y: win.y });
              }
            } catch (e) {}
          }

          if (pts.length >= 3) {
            projectedPtsRef.current = pts;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < pts.length; i++) {
              if (pts[i].x < minX) minX = pts[i].x;
              if (pts[i].x > maxX) maxX = pts[i].x;
              if (pts[i].y < minY) minY = pts[i].y;
              if (pts[i].y > maxY) maxY = pts[i].y;
            }
            boundsRef.current = {
              minX: Math.max(-50, minX - 30),
              maxX: Math.min(w + 50, maxX + 30),
              minY: Math.max(0, minY),
              maxY: Math.min(h, maxY),
            };
          }
        }
      }

      const pts = projectedPtsRef.current;
      const { minX, maxX, minY, maxY } = boundsRef.current;
      const spanX = Math.max(40, maxX - minX);

      // ─── 1. ATMOSPHERIC TINT & PRECIPITATION CONE (NO shadowBlur, ultra-fast) ──
      if (pts.length >= 3 && !standingInsideArea) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();

        // Atmospheric precipitation tint on the ground boundary
        ctx.fillStyle = "rgba(14, 116, 144, 0.12)";
        ctx.fill();

        ctx.lineWidth = 1.8;
        ctx.strokeStyle = "rgba(56, 189, 248, 0.65)";
        ctx.stroke();

        ctx.restore();
      }

      // ─── 2. GROUND SPLASH RIPPLES (Batched in 1 path) ──────────────────────
      const ripples = ripplesRef.current;
      if (ripples.length > 0) {
        ctx.beginPath();
        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i];
          r.radius += 0.8;
          r.alpha -= 0.04;
          if (r.alpha <= 0 || r.radius >= r.maxRadius) {
            ripples.splice(i, 1);
            continue;
          }
          ctx.moveTo(r.x + r.radius * 1.8, r.y);
          ctx.ellipse(r.x, r.y, r.radius * 1.8, r.radius * 0.6, 0, 0, Math.PI * 2);
        }
        ctx.strokeStyle = "rgba(186, 230, 253, 0.4)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // ─── 3. FALLING RAIN STREAKS (Batched into a SINGLE draw call!) ─────────
      const drops = dropsRef.current;
      const groundImpactY = standingInsideArea ? h : (pts.length >= 3 ? maxY + 20 : h);

      ctx.beginPath();
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        d.y += d.speed;

        if (d.y >= groundImpactY || d.y >= h + 20) {
          if (ripples.length < 35 && Math.random() < 0.3) {
            const splashX = minX + d.normalizedU * spanX;
            const splashY = standingInsideArea ? h * 0.6 + Math.random() * (h * 0.35) : Math.max(minY, Math.min(maxY, d.y - 10));
            ripples.push({
              x: splashX,
              y: splashY,
              radius: 1.2,
              maxRadius: 7 + Math.random() * 8,
              alpha: 0.7,
            });
          }
          d.y = -30 - Math.random() * 50;
          d.normalizedU = Math.random();
        }

        const dropX = minX + d.normalizedU * spanX + (d.y / Math.max(1, h)) * windX;
        const dropY = d.y;
        const endX = dropX + windX * 0.6;
        const endY = dropY + d.length;

        ctx.moveTo(dropX, dropY);
        ctx.lineTo(endX, endY);
      }

      ctx.strokeStyle = "rgba(200, 235, 255, 0.65)";
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.stroke();
    };

    render();

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, viewer, polygonCoords, windSpeedKmh, groundHeight, isFlatView]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none z-[25] transition-opacity duration-300 ${
        active ? "opacity-100" : "opacity-0"
      } ${className}`}
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
