import React, { useEffect, useMemo, useRef } from "react";
import L from "leaflet";

interface SelectedAreaRainOverlayProps {
  map: L.Map | null;
  polygonCoords: [number, number][] | null;
  active: boolean;
  intensityMm?: number;
  windSpeedKmh?: number;
  className?: string;
}

interface Drop {
  u: number; // Normalized horizontal position (0 to 1 across bounding box)
  v: number; // Normalized vertical position (0 to 1 across bounding box)
  speed: number;
  length: number;
  thickness: number;
  alpha: number;
}

interface Ripple {
  u: number;
  v: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

export default function SelectedAreaRainOverlay({
  map,
  polygonCoords,
  active,
  intensityMm = 75,
  windSpeedKmh = 20,
  className = "",
}: SelectedAreaRainOverlayProps) {
  const polygonKey = JSON.stringify(polygonCoords);
  const stablePolygon = useMemo<[number, number][] | null>(() => JSON.parse(polygonKey), [polygonKey]);
  polygonCoords = stablePolygon;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const dropsRef = useRef<Drop[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);

  // Initialize drops once with normalized positions
  useEffect(() => {
    const totalDrops = Math.max(0, Math.min(300, Math.round(intensityMm * 3)));
    const drops: Drop[] = [];
    for (let i = 0; i < totalDrops; i++) {
      drops.push({
        u: Math.random(),
        v: Math.random(),
        speed: 0.015 + Math.random() * 0.025, // Fall speed in normalized coords
        length: 16 + Math.random() * 18,      // Pixel length of rain streak
        thickness: 1.8 + Math.random() * 1.4, // Visible streak thickness
        alpha: 0.65 + Math.random() * 0.35,   // Brightness
      });
    }
    dropsRef.current = drops;
    ripplesRef.current = [];
  }, [intensityMm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active || !map || !polygonCoords || polygonCoords.length < 3) {
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

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0;
    let projected: L.Point[] = [];
    let projectionDirty = true;
    const markProjectionDirty = () => { projectionDirty = true; };
    // Synchronize canvas resolution with device pixel ratio
    const updateCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = 1;
      w = rect.width; h = rect.height;
      projectionDirty = true;
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    updateCanvasSize();

    // Wind drift offset in pixels
    const windX = (windSpeedKmh / 20.0) * 3.5;

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

      if (projectionDirty) {
        try {
          projected = polygonCoords.map(([lat, lng]) => map.latLngToContainerPoint(L.latLng(lat, lng)));
          projectionDirty = false;
        } catch { return; }
      }
      const pts = projected;

      if (pts.length < 3) return;

      // Compute bounding box in container pixel space
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      // If the polygon is extremely tiny (e.g. 1px when fully zoomed out), ensure minimum span for visibility
      let spanX = maxX - minX;
      let spanY = maxY - minY;
      if (spanX < 10) {
        const midX = (minX + maxX) / 2;
        minX = midX - 15;
        maxX = midX + 15;
        spanX = 30;
      }
      if (spanY < 10) {
        const midY = (minY + maxY) / 2;
        minY = midY - 15;
        maxY = midY + 15;
        spanY = 30;
      }

      // ─── 1. Clip strictly to the selected monitored area polygon ─────────────
      // Anything drawn beyond pts will be 100% clipped out
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
      ctx.clip();

      // ─── 3. Falling rain streaks (Normalized coords locked to polygon) ────────
      const drops = dropsRef.current;
      ctx.beginPath();
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];

        // Increment vertical progress
        d.v += d.speed * step;
        if (d.v >= 1.0) {
          // Spawn impact ripple at current surface position
          if (ripplesRef.current.length < 40 && Math.random() < 0.4) {
            ripplesRef.current.push({
              u: d.u,
              v: 0.98,
              radius: 1.5,
              maxRadius: 8 + Math.random() * 10,
              alpha: 0.8,
            });
          }
          d.v = 0;
          d.u = Math.random(); // Re-randomize horizontal position
        }

        // Project normalized (u, v) into current screen space starting slightly above
        const dropX = minX + d.u * spanX;
        const dropY = (minY - 30) + d.v * (spanY + 40);

        // Draw luminous rain streak with white-to-cyan gradient
        const endX = dropX + windX;
        const endY = dropY + d.length;

        ctx.moveTo(dropX, dropY);
        ctx.lineTo(endX, endY);
      }
      ctx.strokeStyle = "rgba(224, 242, 254, 0.65)";
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.stroke();

      // ─── 4. Water impact splash ripples ─────────────────────────────────────
      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.radius += 0.5 * step;
        r.alpha -= 0.04 * step;

        if (r.alpha <= 0 || r.radius >= r.maxRadius) {
          ripples.splice(i, 1);
          continue;
        }

        const ripX = minX + r.u * spanX;
        const ripY = (minY - 30) + r.v * (spanY + 40);

        ctx.beginPath();
        ctx.ellipse(ripX, ripY, r.radius * 1.6, r.radius * 0.7, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(186, 230, 253, ${r.alpha})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      ctx.restore();
    };

    animFrameIdRef.current = requestAnimationFrame(render);
    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(canvas);
    map.on("move zoom resize", markProjectionDirty);

    return () => {
      observer.disconnect();
      map.off("move zoom resize", markProjectionDirty);
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, map, polygonCoords, windSpeedKmh]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none z-[450] transition-opacity duration-300 ${
        active ? "opacity-100" : "opacity-0"
      } ${className}`}
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
