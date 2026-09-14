import React, { useEffect, useMemo, useRef } from "react";

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
  const polygonKey = JSON.stringify(polygonCoords);
  const stablePolygon = useMemo<[number, number][] | null>(() => JSON.parse(polygonKey), [polygonKey]);
  polygonCoords = stablePolygon;
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

  // Initialize drops - multi-layered pool for full view coverage (foreground & background)
  useEffect(() => {
    const totalDrops = Math.max(160, Math.min(480, Math.round(intensityMm * 4.2)));
    const drops: Drop[] = [];
    for (let i = 0; i < totalDrops; i++) {
      const isForeground = Math.random() < 0.35;
      drops.push({
        x: Math.random(),
        y: -40 + Math.random() * 1200,
        speed: isForeground ? 24 + Math.random() * 16 : 16 + Math.random() * 12,
        length: isForeground ? 28 + Math.random() * 22 : 16 + Math.random() * 14,
        thickness: isForeground ? 1.6 + Math.random() * 0.9 : 1.0 + Math.random() * 0.6,
        alpha: isForeground ? 0.70 + Math.random() * 0.25 : 0.35 + Math.random() * 0.25,
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
      const step = Math.min(elapsed, 50) / (1000 / 60);
      lastFrame = now;
      if (w <= 0 || h <= 0) return;

      ctx.clearRect(0, 0, w, h);

      // FULL VIEW: Rain spans 100% of screen width and height from -60 to w + 60
      // This eliminates any cutoff on the right side in Flat View and 3D View
      const minX = -60;
      const maxX = w + 60;
      const spanX = maxX - minX;

      // Subtle atmospheric rain mist wash during active rainfall
      if (intensityMm > 20) {
        const mistAlpha = Math.min(0.08, (intensityMm / 100) * 0.08);
        const mistGrad = ctx.createLinearGradient(0, 0, 0, h);
        mistGrad.addColorStop(0, `rgba(186, 220, 248, ${mistAlpha * 0.5})`);
        mistGrad.addColorStop(0.7, `rgba(145, 190, 230, ${mistAlpha})`);
        mistGrad.addColorStop(1, `rgba(120, 165, 210, ${mistAlpha * 0.3})`);
        ctx.fillStyle = mistGrad;
        ctx.fillRect(0, 0, w, h);
      }

      // ─── 2. GROUND SPLASH RIPPLES (Batched across full view floor) ─────────
      const ripples = ripplesRef.current;
      if (ripples.length > 0) {
        ctx.beginPath();
        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i];
          r.radius += 0.9 * step;
          r.alpha -= 0.035 * step;
          if (r.alpha <= 0 || r.radius >= r.maxRadius) {
            ripples.splice(i, 1);
            continue;
          }
          const rx = r.radius * (isFlatView ? 2.4 : 1.8);
          const ry = r.radius * (isFlatView ? 0.55 : 0.6);
          ctx.moveTo(r.x + rx, r.y);
          ctx.ellipse(r.x, r.y, rx, ry, 0, 0, Math.PI * 2);
        }
        ctx.strokeStyle = "rgba(195, 235, 255, 0.45)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // ─── 3. FALLING RAIN STREAKS (Batched into Foreground & Background layers) ─
      const drops = dropsRef.current;
      const groundImpactY = isFlatView ? (h * 0.75 + Math.random() * (h * 0.25)) : (h + 20);

      // Background rain layer
      ctx.beginPath();
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.thickness > 1.3) continue; // Skip foreground

        d.y += d.speed * step;
        const dropX = minX + d.normalizedU * spanX + (d.y / Math.max(1, h)) * windX;
        const dropY = d.y;

        if (d.y >= groundImpactY || d.y >= h + 20) {
          if (ripples.length < 45 && Math.random() < 0.25) {
            const splashX = Math.max(15, Math.min(w - 15, dropX));
            const splashY = isFlatView
              ? (h * 0.58 + Math.random() * (h * 0.38))
              : Math.max(h * 0.4, Math.min(h - 10, d.y - 10));
            ripples.push({
              x: splashX,
              y: splashY,
              radius: 1.2,
              maxRadius: 6 + Math.random() * 7,
              alpha: 0.6,
            });
          }
          d.y = -30 - Math.random() * 50;
          d.normalizedU = Math.random();
        }

        const endX = dropX + windX * 0.65;
        const endY = dropY + d.length;

        ctx.moveTo(dropX, dropY);
        ctx.lineTo(endX, endY);
      }
      ctx.strokeStyle = "rgba(190, 225, 250, 0.45)";
      ctx.lineWidth = 1.0;
      ctx.lineCap = "round";
      ctx.stroke();

      // Foreground rain layer (crisp, brighter, full view coverage)
      ctx.beginPath();
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        if (d.thickness <= 1.3) continue; // Foreground only

        d.y += d.speed * step;
        const dropX = minX + d.normalizedU * spanX + (d.y / Math.max(1, h)) * windX;
        const dropY = d.y;

        if (d.y >= groundImpactY || d.y >= h + 20) {
          if (ripples.length < 45 && Math.random() < 0.35) {
            const splashX = Math.max(15, Math.min(w - 15, dropX));
            const splashY = isFlatView
              ? (h * 0.58 + Math.random() * (h * 0.38))
              : Math.max(h * 0.4, Math.min(h - 10, d.y - 10));
            ripples.push({
              x: splashX,
              y: splashY,
              radius: 1.4,
              maxRadius: 8 + Math.random() * 9,
              alpha: 0.75,
            });
          }
          d.y = -30 - Math.random() * 50;
          d.normalizedU = Math.random();
        }

        const endX = dropX + windX * 0.70;
        const endY = dropY + d.length;

        ctx.moveTo(dropX, dropY);
        ctx.lineTo(endX, endY);
      }
      ctx.strokeStyle = "rgba(220, 245, 255, 0.75)";
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.stroke();
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
  }, [active, windSpeedKmh, isFlatView]);

  return (
    <canvas
      ref={canvasRef}
      id="rain-overlay-canvas"
      data-testid="rain-overlay-canvas"
      className={`absolute inset-0 pointer-events-none z-[25] transition-opacity duration-300 ${
        active ? "opacity-100" : "opacity-0"
      } ${className}`}
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
