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
  normalizedU: number; // 0 to 1 across active column width
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

function getDensePerimeter(coords: [number, number][], samplesPerSegment = 8): [number, number][] {
  if (!coords || coords.length < 3) return [];
  const dense: [number, number][] = [];
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const [lat1, lng1] = coords[i];
    const [lat2, lng2] = coords[(i + 1) % n];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      dense.push([lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t]);
    }
  }
  return dense;
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

  // Initialize drops starting from the TOP of the screen
  useEffect(() => {
    const totalDrops = Math.max(220, Math.min(650, Math.round(intensityMm * 5.5)));
    const drops: Drop[] = [];
    for (let i = 0; i < totalDrops; i++) {
      drops.push({
        x: Math.random(),
        y: -40 + Math.random() * 1200, // Staggered vertically from top of screen
        speed: 16 + Math.random() * 18, // Fast, natural rainfall speed
        length: 22 + Math.random() * 26, // Long, visible streaks
        thickness: 1.6 + Math.random() * 1.4,
        alpha: 0.65 + Math.random() * 0.35,
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

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Wind drift offset in horizontal pixels per frame
    const windX = (windSpeedKmh / 20.0) * 3.8;

    const render = () => {
      animFrameIdRef.current = requestAnimationFrame(render);

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w <= 0 || h <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      ctx.clearRect(0, 0, w, h);

      const Cesium = (window as any).Cesium;
      const hasViewer = viewer && !viewer.isDestroyed() && viewer.scene;
      const scene = hasViewer ? viewer.scene : null;

      const toWindowCoords = Cesium?.SceneTransforms?.worldToWindowCoordinates ||
        Cesium?.SceneTransforms?.wgs84ToWindowCoordinates;

      // Determine if viewer is in Flat View or camera is standing inside the monitored area
      let standingInsideArea = isFlatView;
      if (!standingInsideArea && hasViewer && polygonCoords && polygonCoords.length >= 3) {
        try {
          const camPos = viewer.camera?.positionCartographic;
          if (camPos) {
            const camLat = Cesium.Math.toDegrees(camPos.latitude);
            const camLng = Cesium.Math.toDegrees(camPos.longitude);
            if (isPointInPoly(camLat, camLng, polygonCoords)) {
              standingInsideArea = true;
            }
          }
        } catch (e) {}
      }

      // ─── 1. COMPUTE BOUNDARIES & PROJECT POINTS ───────────────────────────
      const pts: { x: number; y: number }[] = [];
      let minX = 0;
      let maxX = w;
      let minY = 0;
      let maxY = h;

      if (!standingInsideArea && hasViewer && toWindowCoords && polygonCoords && polygonCoords.length >= 3) {
        const dense = getDensePerimeter(polygonCoords, 8);
        try {
          for (let i = 0; i < dense.length; i++) {
            const [lat, lng] = dense[i];
            const cart3 = Cesium.Cartesian3.fromDegrees(Number(lng), Number(lat), groundHeight);
            const win = toWindowCoords.call(Cesium.SceneTransforms, scene, cart3);
            if (
              win &&
              typeof win.x === "number" &&
              typeof win.y === "number" &&
              !isNaN(win.x) &&
              !isNaN(win.y)
            ) {
              pts.push({ x: win.x, y: win.y });
            }
          }
        } catch (e) {}

        if (pts.length >= 3) {
          minX = Infinity;
          maxX = -Infinity;
          minY = Infinity;
          maxY = -Infinity;

          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }

          // Expand rain column horizontally to cover entire precipitation shaft
          minX = Math.max(-60, minX - 40);
          maxX = Math.min(w + 60, maxX + 40);
        }
      }

      const spanX = Math.max(40, maxX - minX);

      // ─── 2. GROUND SPLASHES & ATMOSPHERIC WASH (Clipping inside layer) ──────
      if (pts.length >= 3 && !standingInsideArea) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
        ctx.clip();

        // Atmospheric precipitation tint strictly on the monitored ground layer
        ctx.fillStyle = "rgba(14, 116, 144, 0.18)";
        ctx.fill();

        // Glowing boundary line clearly outlining the precise selected cut
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
        ctx.shadowColor = "rgba(14, 165, 233, 0.6)";
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Ground splash ripples inside the layer
        const ripples = ripplesRef.current;
        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i];
          r.radius += 0.7;
          r.alpha -= 0.035;

          if (r.alpha <= 0 || r.radius >= r.maxRadius) {
            ripples.splice(i, 1);
            continue;
          }

          ctx.beginPath();
          ctx.ellipse(r.x, r.y, r.radius * 1.8, r.radius * 0.7, 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(186, 230, 253, ${r.alpha})`;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        ctx.restore();
      } else if (standingInsideArea) {
        // In Flat View: atmospheric mist across the ground horizon
        const horizonY = h * 0.45;
        const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
        groundGrad.addColorStop(0, "rgba(14, 116, 144, 0.0)");
        groundGrad.addColorStop(1, "rgba(14, 116, 144, 0.20)");
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, horizonY, w, h - horizonY);

        // Ground splash ripples in Flat View
        const ripples = ripplesRef.current;
        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i];
          r.radius += 0.8;
          r.alpha -= 0.035;

          if (r.alpha <= 0 || r.radius >= r.maxRadius) {
            ripples.splice(i, 1);
            continue;
          }

          ctx.beginPath();
          ctx.ellipse(r.x, r.y, r.radius * 2.0, r.radius * 0.6, 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(186, 230, 253, ${r.alpha * 0.9})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // ─── 3. FALLING RAIN STREAKS (Cascading FROM THE TOP OF THE SCREEN) ────
      const drops = dropsRef.current;
      const groundImpactY = standingInsideArea ? h : (pts.length >= 3 ? maxY + 30 : h);

      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];

        d.y += d.speed;

        // When drop impacts the ground plane: spawn splash ripple and reset to TOP OF SCREEN
        if (d.y >= groundImpactY || d.y >= h + 30) {
          if (ripplesRef.current.length < 60 && Math.random() < 0.4) {
            const splashX = minX + d.normalizedU * spanX;
            const splashY = standingInsideArea
              ? h * 0.55 + Math.random() * (h * 0.42)
              : Math.max(minY, Math.min(maxY, d.y - 10));

            ripplesRef.current.push({
              x: splashX,
              y: splashY,
              radius: 1.5,
              maxRadius: 8 + Math.random() * 12,
              alpha: 0.85,
            });
          }
          // Reset drop cleanly ABOVE THE TOP OF THE SCREEN
          d.y = -35 - Math.random() * 60;
          d.normalizedU = Math.random();
        }

        const dropX = minX + d.normalizedU * spanX + (d.y / h) * windX;
        const dropY = d.y;

        const endX = dropX + windX * 0.8;
        const endY = dropY + d.length;

        const grad = ctx.createLinearGradient(dropX, dropY, endX, endY);
        grad.addColorStop(0, "rgba(255, 255, 255, 0.05)");
        grad.addColorStop(0.5, `rgba(224, 242, 254, ${d.alpha * 0.9})`);
        grad.addColorStop(1, `rgba(56, 189, 248, ${d.alpha})`);

        ctx.beginPath();
        ctx.moveTo(dropX, dropY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = grad;
        ctx.lineWidth = d.thickness;
        ctx.lineCap = "round";
        ctx.stroke();
      }
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
