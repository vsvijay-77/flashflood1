import React, { useState } from "react";
import {
  Sparkles,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Building2,
  Sun,
  Eye,
  CheckCircle2,
  Info,
  ChevronRight,
  Split,
  Image as ImageIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface DetectionScene {
  id: string;
  title: string;
  description: string;
  location: string;
  compareImg: string;
  boxesImg: string;
  stats: {
    total: number;
    buildings: number;
    solarPanels: number;
    avgConf: number;
    latencyMs: number;
  };
  sampleDetections: Array<{
    type: "building" | "photovoltaic panel";
    conf: number;
    bbox: string;
    area: string;
  }>;
}

const DETECTION_SCENES: DetectionScene[] = [
  {
    id: "urban_dense",
    title: "Dense Urban Rooftops & Buildings",
    description: "High-density residential and commercial settlement with building footprint detection and solar arrays.",
    location: "Latitude: 13.0495°N, Longitude: 80.1755°E (Zoom Level 19)",
    compareImg: "/satellite_detections/satellite_zoom_urban_dense_compare.png",
    boxesImg: "/satellite_detections/satellite_zoom_urban_dense_boxes.png",
    stats: {
      total: 55,
      buildings: 54,
      solarPanels: 1,
      avgConf: 36.4,
      latencyMs: 1313,
    },
    sampleDetections: [
      { type: "building", conf: 48.2, bbox: "[190.9, 498.0, 232.2, 542.0]", area: "1,820 px²" },
      { type: "building", conf: 40.0, bbox: "[700.3, 21.2, 762.1, 60.6]", area: "2,435 px²" },
      { type: "building", conf: 31.3, bbox: "[471.8, 565.2, 538.9, 597.1]", area: "2,140 px²" },
      { type: "photovoltaic panel", conf: 28.4, bbox: "[384.2, 112.5, 430.6, 178.4]", area: "2,950 px²" },
    ],
  },
  {
    id: "industrial_park",
    title: "Industrial Rooftops & Commercial Units",
    description: "Large industrial warehouses, factory sheds, and commercial structures isolated via YOLO segmentation masks.",
    location: "Latitude: 13.0550°N, Longitude: 80.1800°E (Zoom Level 19)",
    compareImg: "/satellite_detections/satellite_zoom_industrial_park_compare.png",
    boxesImg: "/satellite_detections/satellite_zoom_industrial_park_boxes.png",
    stats: {
      total: 19,
      buildings: 19,
      solarPanels: 0,
      avgConf: 42.1,
      latencyMs: 897,
    },
    sampleDetections: [
      { type: "building", conf: 52.4, bbox: "[312.4, 210.5, 450.8, 380.2]", area: "18,400 px²" },
      { type: "building", conf: 47.8, bbox: "[510.2, 115.0, 680.1, 290.4]", area: "21,250 px²" },
      { type: "building", conf: 39.5, bbox: "[120.6, 490.1, 260.4, 610.8]", area: "12,900 px²" },
    ],
  },
];

export const YoloSatelliteDetectionViewer: React.FC = () => {
  const [selectedSceneIndex, setSelectedSceneIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"compare" | "boxes">("compare");
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const scene = DETECTION_SCENES[selectedSceneIndex];
  const activeImage = viewMode === "compare" ? scene.compareImg : scene.boxesImg;

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-emerald-400 animate-pulse" />
            <h3 className="text-sm font-bold tracking-wide">YOLO Remote Sensing AI Model Output</h3>
            <span className="text-[10px] bg-sky-950 text-sky-300 border border-sky-600/40 px-2 py-0.5 rounded-full font-mono font-semibold">
              model.pt (YOLO26l-seg)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real satellite imagery evaluated with instance bounding boxes and segmentation contours.
          </p>
        </div>

        {/* Scene Switcher Buttons */}
        <div className="flex items-center gap-2">
          {DETECTION_SCENES.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => setSelectedSceneIndex(idx)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                selectedSceneIndex === idx
                  ? "bg-sky-600 text-white shadow-sm"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
              }`}
            >
              {s.title.split("&")[0].trim()}
            </button>
          ))}
        </div>
      </div>

      {/* Main Image Viewport */}
      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-950 shadow-md">
        {/* Floating Viewport Toolbar */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1.5 rounded-xl text-white shadow-xl">
          {/* View Mode Toggle */}
          <div className="inline-flex rounded-lg bg-slate-800 p-0.5">
            <button
              onClick={() => setViewMode("compare")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                viewMode === "compare" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"
              }`}
              title="Side-by-Side Comparison (Raw vs Detected)"
            >
              <Split className="size-3.5" />
              <span>Side-by-Side</span>
            </button>
            <button
              onClick={() => setViewMode("boxes")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                viewMode === "boxes" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"
              }`}
              title="Full Bounding Boxes View"
            >
              <ImageIcon className="size-3.5" />
              <span>Boxes Overlay</span>
            </button>
          </div>

          <div className="w-px h-5 bg-slate-700 mx-0.5" />

          {/* Zoom Buttons */}
          <button
            onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 2.5))}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 0.75))}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <button
            onClick={() => setZoomLevel(1)}
            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-300 cursor-pointer"
            title="Reset Zoom"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
        </div>

        {/* Floating Top Left Telemetry HUD */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2.5 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-3.5 py-2 rounded-xl text-white shadow-xl">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-cyan-400" />
            <span className="text-xs font-bold">{scene.title}</span>
          </div>
          <div className="text-[10px] text-slate-400 font-mono border-l border-slate-700 pl-2">
            {scene.location}
          </div>
        </div>

        {/* Image Container with Zoom & Scroll */}
        <div className="w-full h-[580px] overflow-auto flex items-center justify-center p-4 bg-slate-950">
          <div
            className="transition-transform duration-200 origin-center max-w-full"
            style={{ transform: `scale(${zoomLevel})` }}
          >
            <img
              src={activeImage}
              alt={scene.title}
              className="max-h-[520px] w-auto rounded-lg shadow-2xl border border-slate-800 select-none object-contain"
            />
          </div>
        </div>
      </div>

      {/* Stats and Telemetry Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3.5 border-slate-200 bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Detections</span>
            <Building2 className="size-4 text-sky-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-1 font-mono">{scene.stats.total}</p>
          <p className="text-[10px] text-emerald-600 font-medium mt-0.5">High-confidence objects</p>
        </Card>

        <Card className="p-3.5 border-slate-200 bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Buildings Detected</span>
            <div className="size-2.5 rounded-full bg-cyan-400" />
          </div>
          <p className="text-2xl font-bold text-cyan-600 mt-1 font-mono">{scene.stats.buildings}</p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">Rooftops & structures</p>
        </Card>

        <Card className="p-3.5 border-slate-200 bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Solar Panels</span>
            <Sun className="size-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-600 mt-1 font-mono">{scene.stats.solarPanels}</p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">Photovoltaic arrays</p>
        </Card>

        <Card className="p-3.5 border-slate-200 bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Inference Speed</span>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-1 font-mono">{scene.stats.latencyMs} ms</p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">960×960 native inference</p>
        </Card>
      </div>

      {/* Sample Bounding Box Telemetry Table */}
      <Card className="p-4 border-slate-200 bg-white">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3 flex items-center gap-1.5">
          <Info className="size-3.5 text-[#0F4C81]" />
          <span>Bounding Box $[X_1, Y_1, X_2, Y_2]$ & Mask Coordinates</span>
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-mono text-[11px]">
                <th className="pb-2 font-medium">Class</th>
                <th className="pb-2 font-medium">Confidence</th>
                <th className="pb-2 font-medium">Bounding Box (Pixels)</th>
                <th className="pb-2 font-medium">Mask Area</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {scene.sampleDetections.map((det, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="py-2 flex items-center gap-1.5">
                    <span
                      className={`size-2 rounded-full ${
                        det.type === "building" ? "bg-cyan-500" : "bg-amber-500"
                      }`}
                    />
                    <span className="font-sans font-semibold text-slate-800 capitalize">
                      {det.type}
                    </span>
                  </td>
                  <td className="py-2 text-slate-700 font-bold">{det.conf}%</td>
                  <td className="py-2 text-slate-500">{det.bbox}</td>
                  <td className="py-2 text-slate-600 font-semibold">{det.area}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default YoloSatelliteDetectionViewer;
