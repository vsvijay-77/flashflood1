import { useEffect, useRef, useState, type RefObject } from "react";
import type { ThreeWaterSimulationHandle } from "../simulation/ThreeWaterSimulation";
import { waterRiskPixels } from "../simulation/waterRisk";

declare const Cesium: any;

export default function SimulationRiskHeatmap({ viewer, simulation, areaKey, opacity }: {
  viewer: any;
  simulation: RefObject<ThreeWaterSimulationHandle | null>;
  areaKey: string;
  opacity: number;
}) {
  const layerRef = useRef<any>(null);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const [status, setStatus] = useState("Waiting for simulation terrain and water…");

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    let disposed = false, busy = false;
    let renderedPixels: Uint8ClampedArray | null = null;
    const canvas = document.createElement("canvas");
    const clearLayer = () => {
      if (layerRef.current && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layerRef.current, true);
        viewer.scene.requestRender();
      }
      layerRef.current = null;
      renderedPixels = null;
    };
    const update = async () => {
      if (disposed || busy || viewer.isDestroyed()) return;
      const snapshot = simulation.current?.getWaterRiskSnapshot();
      if (!snapshot) { clearLayer(); setStatus("Waiting for simulation terrain and water…"); return; }
      busy = true;
      try {
        // Reuse the existing hydraulic grid at 4 Hz for responsive water propagation
        const { pixels, wetCells, unknownCells } = waterRiskPixels(snapshot);
        const message = `Modeled water · ${(snapshot.elapsedSeconds / 60).toFixed(1)} min · ${wetCells ? "depth + flow intensity" : "no wet cells on assessed terrain"}${unknownCells ? ` · ${unknownCells} cells unassessed` : ""}`;
        if (!wetCells) {
          clearLayer();
          setStatus(message);
          return;
        }

        // Compare every cell: sparse checks can miss a moving flood edge or
        // changing intensity when the number of wet cells stays the same.
        if (renderedPixels?.length === pixels.length && pixels.every((value, i) => value === renderedPixels![i])) {
          setStatus(message);
          return;
        }

        canvas.width = snapshot.cols;
        canvas.height = snapshot.rows;
        const ctx = canvas.getContext("2d")!;
        const raster = ctx.createImageData(snapshot.cols, snapshot.rows);
        raster.data.set(pixels);
        ctx.putImageData(raster, 0, 0);

        const dataUrl = canvas.toDataURL("image/png");
        const provider = await Cesium.SingleTileImageryProvider.fromUrl(dataUrl, {
          rectangle: Cesium.Rectangle.fromDegrees(snapshot.west, snapshot.south, snapshot.east, snapshot.north),
          credit: "Modeled water depth and flow; not observed inundation",
        });
        if (disposed || viewer.isDestroyed()) return;
        const next = viewer.imageryLayers.addImageryProvider(provider);
        next.alpha = opacityRef.current;
        next.minificationFilter = Cesium.TextureMinificationFilter.NEAREST;
        next.magnificationFilter = Cesium.TextureMagnificationFilter.NEAREST;
        const previous = layerRef.current;
        layerRef.current = next;
        renderedPixels = pixels;
        if (previous) viewer.imageryLayers.remove(previous, true);
        viewer.imageryLayers.raiseToTop(next);
        viewer.scene.requestRender();
        setStatus(message);
      } catch {
        clearLayer();
        if (!disposed) setStatus("Water heatmap could not render. Retrying…");
      } finally { busy = false; }
    };
    void update();
    const timer = window.setInterval(() => { void update(); }, 250);
    return () => { disposed = true; clearInterval(timer); clearLayer(); };
  }, [viewer, simulation, areaKey]);

  useEffect(() => {
    if (layerRef.current && viewer && !viewer.isDestroyed()) {
      layerRef.current.alpha = opacity;
      viewer.scene.requestRender();
    }
  }, [viewer, opacity]);

  return <div role="status" className="absolute top-28 left-3 z-30 max-w-72 rounded-lg bg-slate-950/95 p-3 text-xs text-cyan-100">{status}</div>;
}
