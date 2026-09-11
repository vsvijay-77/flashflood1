import { useEffect, useRef, useState } from "react";
import "@google/model-viewer";
import { Download, Maximize2, Minimize2, RotateCcw, Play, Pause, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": any;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": any;
    }
  }
}

export interface DigitalTwinViewerProps {
  glbUrl: string;
  posterUrl?: string;
  title?: string;
  areaName?: string;
  height?: string;
  className?: string;
}

export function DigitalTwinViewer({
  glbUrl,
  posterUrl,
  title = "3D Digital Twin Terrain Model",
  areaName,
  height = "520px",
  className = "",
}: DigitalTwinViewerProps) {
  const viewerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);

    const el = viewerRef.current;
    if (!el) return;

    if (el.loaded || el.modelIsVisible) {
      setLoading(false);
    }

    const handleLoad = () => {
      setLoading(false);
      setLoadError(null);
    };

    const handleError = (e: any) => {
      console.warn("Model-viewer load event warning:", e);
      // Give it a brief grace period in case the model is still streaming
      setTimeout(() => {
        if (!viewerRef.current?.modelIsVisible && !viewerRef.current?.loaded) {
          setLoading(false);
          setLoadError("Unable to render 3D GLB model. Please try downloading or resetting.");
        } else {
          setLoading(false);
          setLoadError(null);
        }
      }, 2000);
    };

    el.addEventListener("load", handleLoad);
    el.addEventListener("error", handleError);

    // Safety timeout: dismiss spinner once binary is downloaded
    const timer = setTimeout(() => {
      setLoading(false);
    }, 3000);

    return () => {
      clearTimeout(timer);
      el.removeEventListener("load", handleLoad);
      el.removeEventListener("error", handleError);
    };
  }, [glbUrl]);

  const resetCamera = () => {
    if (viewerRef.current) {
      viewerRef.current.cameraOrbit = "0deg 75deg 105%";
      viewerRef.current.cameraTarget = "auto auto auto";
      viewerRef.current.fieldOfView = "auto";
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl ${className}`}
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 z-10 backdrop-blur-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex size-7 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-white truncate flex items-center gap-2">
              {title}
              {areaName && (
                <span className="text-[10px] font-semibold text-sky-400 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-800/60 truncate">
                  📍 {areaName}
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              Single GLB mesh reconstructed via Meshy Multi-Image-to-3D
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAutoRotate(!autoRotate)}
            className="h-7 px-2 text-slate-300 hover:text-white hover:bg-slate-800 text-[11px] gap-1 cursor-pointer"
            title={autoRotate ? "Pause Auto-Rotation" : "Start Auto-Rotation"}
          >
            {autoRotate ? <Pause className="size-3 text-amber-400" /> : <Play className="size-3 text-emerald-400" />}
            <span className="hidden sm:inline">{autoRotate ? "Pause" : "Rotate"}</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={resetCamera}
            className="h-7 px-2 text-slate-300 hover:text-white hover:bg-slate-800 text-[11px] gap-1 cursor-pointer"
            title="Reset Camera Angle"
          >
            <RotateCcw className="size-3" />
            <span className="hidden sm:inline">Reset</span>
          </Button>

          <a
            href={glbUrl}
            download="digital_twin_model.glb"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-[#0F4C81] hover:bg-[#0B3A61] text-white text-[11px] font-semibold transition-colors cursor-pointer"
            title="Download GLB 3D File"
          >
            <Download className="size-3" />
            <span className="hidden sm:inline">Download GLB</span>
          </a>

          <Button
            size="sm"
            variant="ghost"
            onClick={toggleFullscreen}
            className="h-7 w-7 p-0 text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {/* Main 3D Canvas Canvas */}
      <div className="relative flex-1 w-full h-full overflow-hidden bg-radial from-slate-900 via-slate-950 to-black">
        {/* Google Model-Viewer Element */}
        <model-viewer
          ref={viewerRef}
          src={glbUrl}
          poster={posterUrl}
          alt={title}
          auto-rotate={autoRotate ? "" : undefined}
          auto-rotate-delay="1000"
          rotation-per-second="25deg"
          camera-controls
          shadow-intensity="1.2"
          shadow-softness="0.8"
          exposure="1.1"
          style={{ width: "100%", height: "100%", outline: "none" }}
        >
          {/* Custom progress bar slot inside model-viewer */}
          <div
            slot="progress-bar"
            className="absolute top-0 left-0 w-full h-1 bg-sky-500/20"
          >
            <div className="h-full bg-sky-400 animate-pulse transition-all duration-300" />
          </div>
        </model-viewer>

        {/* Loading Overlay */}
        {loading && !loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 z-20 backdrop-blur-xs">
            <div className="size-10 rounded-full border-3 border-sky-400 border-t-transparent animate-spin mb-3" />
            <p className="text-xs font-semibold text-slate-200">Rendering 3D GLB Digital Twin…</p>
            <p className="text-[11px] text-slate-400 mt-1">Interactivity controls will be active once loaded</p>
          </div>
        )}

        {/* Load Error State */}
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-red-300 p-6 text-center z-20">
            <div className="text-3xl mb-2">⚠️</div>
            <p className="text-sm font-semibold text-red-200 mb-1">Unable to Display 3D Model</p>
            <p className="text-xs text-slate-400 max-w-md mb-4">{loadError}</p>
            <a
              href={glbUrl}
              download
              className="text-xs font-semibold px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white transition-colors"
            >
              Direct GLB Link
            </a>
          </div>
        )}

        {/* Bottom Floating Hint */}
        <div className="absolute bottom-3 left-3 pointer-events-none z-10 hidden sm:flex items-center gap-2 bg-slate-950/70 border border-slate-800/80 px-2.5 py-1 rounded-md text-[10px] text-slate-400 backdrop-blur-xs">
          <span>🖱️ Click & Drag to Orbit</span>
          <span>•</span>
          <span>Scroll to Zoom</span>
          <span>•</span>
          <span>Right-Click to Pan</span>
        </div>
      </div>
    </div>
  );
}
