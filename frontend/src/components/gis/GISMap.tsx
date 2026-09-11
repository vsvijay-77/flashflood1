import { useEffect, useRef, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import type { CustomArea } from "@/lib/types";
import {
  calculatePolygonAreaSqMeters,
  formatArea,
  parseCustomAreaPolygon,
  generateCirclePolygon,
} from "@/lib/gisUtils";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  Ruler,
  CheckCircle2,
  Globe,
  ZoomIn,
  Trash2,
  HelpCircle,
  Activity,
  Search,
  MapPin,
  X,
  Loader2,
  Navigation,
  Maximize2,
  Minimize2,
  Plus,
  Layers,
  Sparkles,
  Map as MapIcon,
  Compass,
  FileText,
  CloudRain,
} from "lucide-react";
import SelectedAreaRainOverlay from "../simulation/SelectedAreaRainOverlay";

const RISK_COLORS: Record<string, { stroke: string; fill: string }> = {
  critical: { stroke: "#DC2626", fill: "#EF4444" },
  high: { stroke: "#EA580C", fill: "#F97316" },
  medium: { stroke: "#D97706", fill: "#F59E0B" },
  low: { stroke: "#059669", fill: "#10B981" },
};

export const INDIA_CENTER: [number, number] = [22.5937, 78.9629];
export const INDIA_DEFAULT_ZOOM = 5;
export const INDIA_MIN_ZOOM = 4;
export const INDIA_BOUNDS: L.LatLngBoundsLiteral = [
  [6.0, 68.0], // South-West (Kanyakumari / Lakshadweep / Gujarat)
  [37.5, 97.5], // North-East (Kashmir / Ladakh / Arunachal)
];

export interface GISLayerState {
  customAreas: boolean;
  satellite: boolean;
  areaLabels: boolean;
  boundaries: boolean;
  rainSimulation?: boolean;
  rivers?: boolean;
  paths?: boolean;
}

export const DEFAULT_LAYERS: GISLayerState = {
  customAreas: true,
  satellite: false,
  areaLabels: true,
  boundaries: true,
};

export interface GISMapProps {
  customAreas?: CustomArea[];
  selectedArea?: CustomArea | null;
  focusedArea?: CustomArea | null;
  layers?: GISLayerState;
  height?: string;
  onSelectArea?: (area: CustomArea | null) => void;
  drawMode?: boolean;
  onToggleDrawMode?: (active: boolean) => void;
  onAreaSelected?: (latlngs: L.LatLng[], calculatedAreaSqMeters: number) => void;
  onAreaCreated?: (newArea: CustomArea) => void;
  testId?: string;
  detailsPanel?: React.ReactNode;
  rainActive?: boolean;
  onToggleRain?: (active: boolean) => void;
  rainfallIntensity?: number;
  /** When true, the map is locked to the selected/focused area only — no India-wide view, no other areas rendered, no draw/search tools */
  singleAreaMode?: boolean;
}

/**
 * Interactive Geospatial GIS Map for Custom Monitored Areas.
 * Defaults to Full India view, constrained within India bounds (cannot zoom or pan out of India).
 */
export default function GISMap({
  customAreas = [],
  selectedArea = null,
  focusedArea = null,
  layers = DEFAULT_LAYERS,
  height = "100%",
  onSelectArea,
  drawMode = false,
  onToggleDrawMode,
  onAreaSelected,
  onAreaCreated,
  testId = "gis-map",
  detailsPanel,
  rainActive,
  onToggleRain,
  rainfallIntensity = 75,
  singleAreaMode = false,
}: GISMapProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const drawLayer = useRef<L.LayerGroup | null>(null);
  const searchLayer = useRef<L.LayerGroup | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const selectRef = useRef(onSelectArea);
  selectRef.current = onSelectArea;
  const onAreaSelectedRef = useRef(onAreaSelected);
  onAreaSelectedRef.current = onAreaSelected;
  const onAreaCreatedRef = useRef(onAreaCreated);
  onAreaCreatedRef.current = onAreaCreated;


  // Drawing state synchronization (supports both sidebar controls and in-map toolbar in fullscreen)
  const [internalDrawMode, setInternalDrawMode] = useState(false);
  const isDrawActive = drawMode !== undefined ? (drawMode || internalDrawMode) : internalDrawMode;

  const toggleDraw = (val?: boolean) => {
    const next = typeof val === "boolean" ? val : !isDrawActive;
    setInternalDrawMode(next);
    onToggleDrawMode?.(next);
  };

  // Internal satellite override (allows toggling in fullscreen mode)
  const [internalSatellite, setInternalSatellite] = useState<boolean | null>(null);
  const isSatelliteActive = internalSatellite !== null ? internalSatellite : !!layers.satellite;

  // Internal rain state synchronization (supports map toolbar button and layer toggles)
  const [internalRain, setInternalRain] = useState(false);
  const isRain = rainActive !== undefined ? rainActive : (layers.rainSimulation ?? internalRain);

  const toggleRain = (val?: boolean) => {
    const next = typeof val === "boolean" ? val : !isRain;
    setInternalRain(next);
    onToggleRain?.(next);
  };

  // Coords strictly locked to currently selected area
  const selectedAreaCoords: [number, number][] | null = useMemo(() => {
    if (!selectedArea) return null;
    if (selectedArea.polygon && selectedArea.polygon.length >= 3) {
      return selectedArea.polygon;
    }
    return parseCustomAreaPolygon(selectedArea.shape, Number(selectedArea.lat), Number(selectedArea.lng));
  }, [selectedArea]);

  // Map Search State (Accepts Latitude/Longitude or Place Names)
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    id: string;
    title: string;
    subtitle?: string;
    lat: number;
    lng: number;
    bbox?: [number, number, number, number];
    isArea?: boolean;
    areaObj?: CustomArea;
    isCoord?: boolean;
  }[]>([]);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);

  // Automatically open details tab when an area is selected
  useEffect(() => {
    if (selectedArea) {
      setDetailsOpen(true);
    }
  }, [selectedArea]);

  // Fullscreen change listener with Leaflet invalidateSize
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs =
        !!document.fullscreenElement ||
        !!(document as any).webkitFullscreenElement ||
        !!(document as any).mozFullScreenElement;
      setIsFullscreen(isFs);
      setTimeout(() => {
        if (map.current) {
          map.current.invalidateSize();
        }
      }, 150);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    const elem = containerRef.current;
    if (!elem) return;

    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(() => setIsFullscreen(true));
      } else if ((elem as any).webkitRequestFullscreen) {
        (elem as any).webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => setIsFullscreen(false));
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    }
  };

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Parse direct latitude and longitude input (e.g. "22.4727, 81.0598", "22.4727 81.0598")
  const parseCoordinates = (input: string): [number, number] | null => {
    const trimmed = input.trim();
    const regex = /^\s*([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*$/;
    const match = trimmed.match(regex);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return [lat, lng];
      }
    }
    return null;
  };

  // Perform search query (handles both place names and coordinates)
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    const coordMatch = parseCoordinates(trimmed);
    const results: typeof searchResults = [];

    // 1. If it's a coordinate match, add as primary suggestion
    if (coordMatch) {
      results.push({
        id: "coord-direct",
        title: `${coordMatch[0].toFixed(5)}, ${coordMatch[1].toFixed(5)}`,
        subtitle: "Geographic Coordinates (Latitude, Longitude)",
        lat: coordMatch[0],
        lng: coordMatch[1],
        isCoord: true,
      });
    }

    // 2. Search locally registered custom monitored areas by name or district
    const matchingAreas = customAreas
      .filter(
        (a) =>
          a.name.toLowerCase().includes(trimmed.toLowerCase()) ||
          a.district.toLowerCase().includes(trimmed.toLowerCase())
      )
      .map((a) => ({
        id: `area-${a.id}`,
        title: a.name,
        subtitle: `Monitored Area · ${a.district} (${formatArea(a.areaSqMeters).brief})`,
        lat: a.lat,
        lng: a.lng,
        isArea: true,
        areaObj: a,
      }));

    results.push(...matchingAreas);

    // 3. Debounced Geocoding search for place names via Nominatim
    if (trimmed.length >= 2 && !coordMatch) {
      setIsSearching(true);
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&limit=5&addressdetails=1`,
            { headers: { "Accept-Language": "en" } }
          );
          if (res.ok) {
            const data = await res.json();
            const places = data.map((item: any) => {
              const parts = (item.display_name || "").split(",");
              const title = parts[0]?.trim() || item.name || "Location";
              const subtitle = parts.slice(1, 4).map((p: string) => p.trim()).join(", ");
              return {
                id: `place-${item.place_id}`,
                title,
                subtitle,
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                bbox: item.boundingbox
                  ? [
                      parseFloat(item.boundingbox[0]),
                      parseFloat(item.boundingbox[2]),
                      parseFloat(item.boundingbox[1]),
                      parseFloat(item.boundingbox[3]),
                    ] as [number, number, number, number]
                  : undefined,
                isArea: false,
              };
            });

            setSearchResults((prev) => {
              const base = prev.filter((r) => r.isCoord || r.isArea);
              return [...base, ...places];
            });
          }
        } catch (e) {
          console.error("Geocoding search error:", e);
        } finally {
          setIsSearching(false);
        }
      }, 350);

      setSearchResults(results);
      setSearchOpen(true);
      return () => clearTimeout(timer);
    } else {
      setSearchResults(results);
      setSearchOpen(results.length > 0);
    }
  }, [searchQuery, customAreas]);

  // Live drawing metrics
  const [liveMetrics, setLiveMetrics] = useState<{ count: number; sqMeters: number }>({
    count: 0,
    sqMeters: 0,
  });

  // Confirmation modal state after points are connected
  const [confirmingPolygon, setConfirmingPolygon] = useState<{
    latlngs: L.LatLng[];
    sqMeters: number;
  } | null>(null);
  const [confirmForm, setConfirmForm] = useState({
    name: "",
    district: "Western Ghats",
    type: "River Basin",
    risk: "Medium",
    priority: "Normal (Hourly)",
    description: "",
  });
  const [isSavingArea, setIsSavingArea] = useState(false);

  // Area boundary drawing state
  const vertices = useRef<L.LatLng[]>([]);
  const vertexMarkers = useRef<L.CircleMarker[]>([]);
  const polyline = useRef<L.Polyline | null>(null);
  const previewLine = useRef<L.Polyline | null>(null);
  const closingLine = useRef<L.Polyline | null>(null);
  const polygonFill = useRef<L.Polygon | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

  // ─── Map init: area-locked in singleAreaMode, Full India by default ──────────
  useEffect(() => {
    if (!holder.current || map.current) return;

    // In singleAreaMode, compute tight bounds from the focused/selected area polygon
    const areaForInit = focusedArea || selectedArea;
    let initCenter: [number, number] = INDIA_CENTER;
    let initZoom = INDIA_DEFAULT_ZOOM;
    let initMaxBounds: L.LatLngBoundsLiteral = INDIA_BOUNDS;
    let initMinZoom = INDIA_MIN_ZOOM;

    if (singleAreaMode && areaForInit) {
      const coords =
        areaForInit.polygon && areaForInit.polygon.length >= 3
          ? areaForInit.polygon
          : parseCustomAreaPolygon(areaForInit.shape, Number(areaForInit.lat), Number(areaForInit.lng));
      if (coords.length >= 3) {
        const lats = coords.map(([la]) => la);
        const lngs = coords.map(([, lo]) => lo);
        const pad = 0.01; // ~1km padding around the area
        initMaxBounds = [
          [Math.min(...lats) - pad, Math.min(...lngs) - pad],
          [Math.max(...lats) + pad, Math.max(...lngs) + pad],
        ];
        initCenter = [
          (Math.min(...lats) + Math.max(...lats)) / 2,
          (Math.min(...lngs) + Math.max(...lngs)) / 2,
        ];
        initZoom = 15;
        initMinZoom = 13;
      } else if (areaForInit.lat && areaForInit.lng) {
        initCenter = [Number(areaForInit.lat), Number(areaForInit.lng)];
        initZoom = 15;
        initMinZoom = 13;
      }
    }

    const instance = L.map(holder.current, {
      center: initCenter,
      zoom: initZoom,
      minZoom: initMinZoom,
      maxBounds: initMaxBounds,
      maxBoundsViscosity: 1.0,
      zoomControl: false,
      attributionControl: false,
    });
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    map.current = instance;
    setMapInstance(instance);
    overlay.current = L.layerGroup().addTo(instance);
    drawLayer.current = L.layerGroup().addTo(instance);
    searchLayer.current = L.layerGroup().addTo(instance);

    // In singleAreaMode, immediately fit to the area's polygon bounds
    if (singleAreaMode && areaForInit) {
      const coords =
        areaForInit.polygon && areaForInit.polygon.length >= 3
          ? areaForInit.polygon
          : parseCustomAreaPolygon(areaForInit.shape, Number(areaForInit.lat), Number(areaForInit.lng));
      if (coords.length >= 3) {
        const bounds = L.latLngBounds(coords.map((c) => L.latLng(c[0], c[1])));
        instance.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 });
      }
    }

    return () => {
      instance.remove();
      map.current = null;
      setMapInstance(null);
      overlay.current = null;
      drawLayer.current = null;
      searchLayer.current = null;
      tiles.current = null;
    };
  }, []);

  // ─── Reset to Full India view helper ────────────────────────────────────────
  const resetToIndiaView = () => {
    if (!map.current) return;
    map.current.flyTo(INDIA_CENTER, INDIA_DEFAULT_ZOOM, {
      duration: 1.2,
    });
  };

  // ─── Zoom into marked area land tightly to eliminate outer area ──────────────
  const zoomToAreaLand = (area: CustomArea) => {
    if (!map.current || !area) return;
    const coords =
      area.polygon && area.polygon.length >= 3
        ? area.polygon
        : parseCustomAreaPolygon(area.shape, Number(area.lat), Number(area.lng));

    if (coords.length >= 3) {
      const bounds = L.latLngBounds(coords.map((c) => L.latLng(c[0], c[1])));
      map.current.flyToBounds(bounds, {
        padding: [6, 6],
        maxZoom: 19,
        duration: 0.9,
      });
    } else if (area.lat && area.lng) {
      map.current.flyTo([Number(area.lat), Number(area.lng)], 18, {
        duration: 0.9,
      });
    }
  };

  const startDrawingAt = (startLatLng: L.LatLng) => {
    if (searchLayer.current) searchLayer.current.clearLayers();
    toggleDraw(true);
    setTimeout(() => {
      if (!drawLayer.current) return;
      clearDraw();
      vertices.current = [startLatLng];
      const marker = L.circleMarker(startLatLng, {
        radius: 9,
        color: "#059669",
        weight: 2.5,
        fillColor: "#34D399",
        fillOpacity: 1,
        interactive: false,
      }).addTo(drawLayer.current);
      vertexMarkers.current = [marker];
      setLiveMetrics({ count: 1, sqMeters: 0 });
      toast.info("Point placed! Click more points around the area to outline the boundary.");
    }, 120);
  };

  // ─── Click anywhere on map to select place & drop action pin ────────────────
  const handleMapClickPlace = async (latlng: L.LatLng) => {
    if (!map.current || !searchLayer.current) return;
    searchLayer.current.clearLayers();

    const pinIcon = L.divIcon({
      className: "",
      html: `
        <div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;transform:translate(-50%,-100%);">
          <div style="width:28px;height:28px;background:#0F4C81;border:2.5px solid #FFFFFF;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 4px 12px rgba(15,76,129,0.45);display:flex;align-items:center;justify-content:center;">
            <div style="width:8px;height:8px;background:#FFFFFF;border-radius:50%;transform:rotate(45deg);"></div>
          </div>
          <div style="position:absolute;bottom:-3px;left:50%;transform:translateX(-50%);width:14px;height:4px;background:rgba(0,0,0,0.3);border-radius:50%;filter:blur(1px);"></div>
        </div>
      `,
      iconSize: [0, 0],
    });

    const marker = L.marker(latlng, { icon: pinIcon }).addTo(searchLayer.current);

    let title = "Selected Location";
    let subtitle = "";

    const renderPopup = (t: string, st: string) => {
      const popupHtml = `
        <div style="font-family:'IBM Plex Sans',sans-serif;min-width:230px;padding:3px;">
          <div style="font-size:13px;font-weight:700;color:#0F172A;margin-bottom:2px;">📍 ${t}</div>
          ${st ? `<div style="font-size:11px;color:#64748B;margin-bottom:6px;">${st}</div>` : ""}
          <div style="background:#F1F5F9;border-radius:4px;padding:4px 6px;font-family:monospace;font-size:11px;color:#0F4C81;margin-bottom:8px;">
            ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <button id="inspect-draw-btn" style="width:100%;background:#F8FAFC;color:#334155;border:1px solid #CBD5E1;border-radius:5px;padding:6px 8px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">
              ✏️ Measure Area From Here
            </button>
            <button id="inspect-dismiss-btn" style="width:100%;background:transparent;color:#94A3B8;border:none;padding:2px 8px;font-size:10px;cursor:pointer;">
              ✕ Dismiss
            </button>
          </div>
        </div>
      `;
      marker.bindPopup(popupHtml).openPopup();

      marker.on("popupopen", () => {
        const drawBtn = document.getElementById("inspect-draw-btn");
        if (drawBtn) {
          drawBtn.onclick = () => {
            startDrawingAt(latlng);
          };
        }
        const dismissBtn = document.getElementById("inspect-dismiss-btn");
        if (dismissBtn) {
          dismissBtn.onclick = () => {
            if (searchLayer.current) searchLayer.current.clearLayers();
          };
        }
      });
    };

    renderPopup(title, subtitle);

    // Asynchronously reverse geocode via Nominatim
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&zoom=14&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      );
      if (res.ok) {
        const data = await res.json();
        const parts = (data.display_name || "").split(",");
        title = parts[0]?.trim() || data.name || "Selected Location";
        subtitle = parts.slice(1, 4).map((p: string) => p.trim()).join(", ");
        renderPopup(title, subtitle);
      }
    } catch {
      // Keep coordinates
    }
  };

  // ─── Select location from search (coordinates or place) ─────────────────────
  const handleSelectLocation = (result: (typeof searchResults)[0]) => {
    if (!map.current) return;
    setSearchOpen(false);
    setSearchQuery(result.title);

    // If selecting a registered area, select and zoom to it directly
    if (result.isArea && result.areaObj) {
      selectRef.current?.(result.areaObj);
      zoomToAreaLand(result.areaObj);
      return;
    }

    // Clear previous search pin
    if (searchLayer.current) {
      searchLayer.current.clearLayers();
    }

    const targetLatLng: [number, number] = [result.lat, result.lng];

    // Fly smoothly to target
    if (result.bbox) {
      const southWest = L.latLng(result.bbox[0], result.bbox[1]);
      const northEast = L.latLng(result.bbox[2], result.bbox[3]);
      map.current.flyToBounds(L.latLngBounds(southWest, northEast), {
        maxZoom: 16,
        duration: 1.2,
      });
    } else {
      map.current.flyTo(targetLatLng, 16, { duration: 1.2 });
    }

    // Drop clean search pin marker with location details
    if (searchLayer.current) {
      const pinIcon = L.divIcon({
        className: "",
        html: `
          <div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;transform:translate(-50%,-100%);">
            <div style="width:28px;height:28px;background:#0F4C81;border:2.5px solid #FFFFFF;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 4px 12px rgba(15,76,129,0.45);display:flex;align-items:center;justify-content:center;">
              <div style="width:8px;height:8px;background:#FFFFFF;border-radius:50%;transform:rotate(45deg);"></div>
            </div>
            <div style="position:absolute;bottom:-3px;left:50%;transform:translateX(-50%);width:14px;height:4px;background:rgba(0,0,0,0.3);border-radius:50%;filter:blur(1px);"></div>
          </div>
        `,
        iconSize: [0, 0],
      });

      const marker = L.marker(targetLatLng, { icon: pinIcon }).addTo(searchLayer.current);

      const popupHtml = `
        <div style="font-family:'IBM Plex Sans',sans-serif;min-width:230px;padding:4px 2px;">
          <div style="font-size:13px;font-weight:700;color:#0F172A;line-height:1.3;">📍 ${result.title}</div>
          ${result.subtitle ? `<div style="font-size:11px;color:#64748B;margin-top:2px;">${result.subtitle}</div>` : ""}
          <div style="margin-top:6px;padding:4px 8px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-family:monospace;font-size:11px;font-weight:600;color:#0F4C81;">
            ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}
          </div>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;">
            <button id="search-pin-draw-btn" style="width:100%;background:#F1F5F9;color:#334155;border:1px solid #CBD5E1;border-radius:5px;padding:5px 8px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;">
              ✏️ Measure Area From Here
            </button>
          </div>
        </div>
      `;
      marker.bindPopup(popupHtml).openPopup();

      marker.on("popupopen", () => {
        const drawBtn = document.getElementById("search-pin-draw-btn");
        if (drawBtn) {
          drawBtn.onclick = () => {
            startDrawingAt(L.latLng(result.lat, result.lng));
          };
        }
      });
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchOpen(false);
    if (searchLayer.current) {
      searchLayer.current.clearLayers();
    }
  };

  // Fly to focused or selected area tightly
  useEffect(() => {
    if (focusedArea && map.current) {
      zoomToAreaLand(focusedArea);
    }
  }, [focusedArea]);

  useEffect(() => {
    if (selectedArea && map.current) {
      zoomToAreaLand(selectedArea);
    }
  }, [selectedArea]);

  // ─── Helper: clear all drawing layers ───────────────────────────────────────
  const clearDraw = () => {
    if (!drawLayer.current) return;
    drawLayer.current.clearLayers();
    vertices.current = [];
    vertexMarkers.current = [];
    polyline.current = null;
    previewLine.current = null;
    closingLine.current = null;
    polygonFill.current = null;
    setLiveMetrics({ count: 0, sqMeters: 0 });
    setConfirmingPolygon(null);
  };

  // ─── Finish boundary and open confirmation tab (Works in Fullscreen) ─────────
  const handleFinishBoundary = () => {
    const verts = [...vertices.current];
    if (verts.length < 3) {
      toast.error("Please place at least 3 points to outline a monitored area");
      return;
    }
    const areaSq = calculatePolygonAreaSqMeters(verts);
    setConfirmForm({
      name: `Monitored Zone ${customAreas.length + 1}`,
      district: "Western Ghats",
      type: "River Basin",
      risk: "Medium",
      priority: "Normal (Hourly)",
      description: "",
    });
    setConfirmingPolygon({
      latlngs: verts,
      sqMeters: areaSq,
    });
  };

  // ─── Confirm & Save Area to Database (Visible in Fullscreen Mode) ───────────
  const handleConfirmAndSaveArea = async () => {
    if (!confirmingPolygon) return;
    const { latlngs, sqMeters } = confirmingPolygon;
    const areaName = confirmForm.name.trim() || `Monitored Zone ${customAreas.length + 1}`;
    setIsSavingArea(true);

    try {
      const coordsArray: [number, number][] = latlngs.map((p) => [p.lat, p.lng]);
      const centerLat = latlngs.reduce((s, p) => s + p.lat, 0) / latlngs.length;
      const centerLng = latlngs.reduce((s, p) => s + p.lng, 0) / latlngs.length;

      let lats = latlngs.map((p) => p.lat);
      let lngs = latlngs.map((p) => p.lng);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ];

      const serializedShape = `Polygon:${JSON.stringify(coordsArray)}`;

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id || null;

      const { data, error } = await supabase
        .from("custom_areas")
        .insert({
          name: areaName,
          district: confirmForm.district || "Western Ghats",
          area_type: confirmForm.type,
          risk_category: confirmForm.risk,
          priority: confirmForm.priority,
          description: confirmForm.description || "Custom monitoring boundary",
          lat: Number(centerLat.toFixed(4)),
          lng: Number(centerLng.toFixed(4)),
          shape: serializedShape,
          user_id: userId,
        })
        .select()
        .single();

      if (error) {
        console.warn("Supabase area insert warning:", error);
      }

      const newArea: CustomArea = {
        id: data?.id || crypto.randomUUID(),
        name: areaName,
        district: confirmForm.district || "Western Ghats",
        type: confirmForm.type,
        risk: confirmForm.risk,
        priority: confirmForm.priority,
        description: confirmForm.description,
        bounds,
        date: new Date().toLocaleDateString(),
        lat: Number(centerLat.toFixed(4)),
        lng: Number(centerLng.toFixed(4)),
        shape: "Polygon",
        polygon: coordsArray,
        areaSqMeters: sqMeters,
        user_id: userId || undefined,
      };

      if (onAreaCreatedRef.current) {
        onAreaCreatedRef.current(newArea);
      }

      setConfirmingPolygon(null);
      clearDraw();
      toast.success(`Monitored Area "${areaName}" confirmed & saved (${formatArea(sqMeters).combined})`);
    } catch (err: any) {
      console.error("Failed to save monitored area:", err);
      toast.info(`Area measurement confirmed: ${formatArea(sqMeters).combined}`);
      setConfirmingPolygon(null);
      clearDraw();
    } finally {
      setIsSavingArea(false);
    }
  };

  // ─── Redraw the live boundary preview ────────────────────────────────────────
  const redrawPreview = () => {
    const dl = drawLayer.current;
    if (!dl) return;
    const verts = vertices.current;

    // Calculate current live area in sq meters
    const currentAreaSqMeters = verts.length >= 3 ? calculatePolygonAreaSqMeters(verts) : 0;
    setLiveMetrics({
      count: verts.length,
      sqMeters: currentAreaSqMeters,
    });

    // Update / create connecting polyline between placed vertices (1 -> 2 -> 3 -> 4...)
    if (polyline.current) {
      if (verts.length >= 2) {
        polyline.current.setLatLngs(verts);
      } else {
        dl.removeLayer(polyline.current);
        polyline.current = null;
      }
    } else if (verts.length >= 2) {
      polyline.current = L.polyline(verts, {
        color: "#0284C7",
        weight: 2.5,
        dashArray: "6 4",
        opacity: 0.9,
      }).addTo(dl);
    }
  };

  // ─── Delete last placed vertex ───────────────────────────────────────────────
  const deleteLastVertex = () => {
    if (!drawLayer.current || vertices.current.length === 0) return;
    vertices.current.pop();
    const lastMarker = vertexMarkers.current.pop();
    if (lastMarker && drawLayer.current) {
      drawLayer.current.removeLayer(lastMarker);
    }
    if (vertices.current.length === 0) {
      clearDraw();
    } else {
      if (vertices.current.length < 2 && polyline.current) {
        drawLayer.current.removeLayer(polyline.current);
        polyline.current = null;
      }
      if (vertices.current.length < 3) {
        if (closingLine.current) {
          drawLayer.current.removeLayer(closingLine.current);
          closingLine.current = null;
        }
        if (polygonFill.current) {
          drawLayer.current.removeLayer(polygonFill.current);
          polygonFill.current = null;
        }
      }
      redrawPreview();
    }
  };

  // ─── drawMode cursor + reset + keyboard shortcut (Backspace / Delete) ────────
  useEffect(() => {
    if (!map.current) return;
    const container = map.current.getContainer();
    if (isDrawActive) {
      container.style.cursor = "crosshair";
    } else {
      container.style.cursor = "";
      clearDraw();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isDrawActive && (e.key === "Backspace" || e.key === "Delete")) {
        deleteLastVertex();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isDrawActive]);

  // ─── Click-to-place-vertex drawing & Map click-to-deselect ───────────────────
  useEffect(() => {
    const instance = map.current;
    const dl = drawLayer.current;
    if (!instance || !dl) return;

    const CLOSE_THRESHOLD_PX = 14;

    const isNearFirstVertex = (clickPx: L.Point): boolean => {
      if (vertices.current.length < 3) return false;
      const firstPx = instance.latLngToContainerPoint(vertices.current[0]);
      return clickPx.distanceTo(firstPx) <= CLOSE_THRESHOLD_PX;
    };

    // Ask confirmation after points are connected
    const finishPolygon = () => {
      handleFinishBoundary();
    };

    const onClick = (e: L.LeafletMouseEvent) => {
      if (!isDrawActive) {
        // Normal click: do nothing — no pin drop on map click
        return;
      }

      if (isNearFirstVertex(e.containerPoint)) {
        finishPolygon();
        return;
      }

      const latlng = e.latlng;
      vertices.current.push(latlng);

      const isFirst = vertices.current.length === 1;

      const marker = L.circleMarker(latlng, {
        radius: isFirst ? 9 : 6,
        color: isFirst ? "#059669" : "#0284C7",
        weight: 2.5,
        fillColor: isFirst ? "#34D399" : "#BAE6FD",
        fillOpacity: 1,
        interactive: false,
      }).addTo(dl);

      vertexMarkers.current.push(marker);
      redrawPreview();
    };

    const onDblClick = (e: L.LeafletMouseEvent) => {
      if (!isDrawActive) return;
      L.DomEvent.stopPropagation(e);
      if (vertices.current.length > 1) {
        vertices.current.pop();
        const lastMarker = vertexMarkers.current.pop();
        if (lastMarker && drawLayer.current) drawLayer.current.removeLayer(lastMarker);
      }
      finishPolygon();
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!isDrawActive || vertices.current.length === 0) return;
      const last = vertices.current[vertices.current.length - 1];
      if (previewLine.current) {
        previewLine.current.setLatLngs([last, e.latlng]);
      } else {
        previewLine.current = L.polyline([last, e.latlng], {
          color: "#0284C7",
          weight: 1.5,
          dashArray: "4 4",
          opacity: 0.7,
          interactive: false,
        }).addTo(dl);
      }
    };

    instance.on("click", onClick);
    instance.on("dblclick", onDblClick);
    instance.on("mousemove", onMouseMove);

    return () => {
      instance.off("click", onClick);
      instance.off("dblclick", onDblClick);
      instance.off("mousemove", onMouseMove);
    };
  }, [isDrawActive]);

  // ─── Tile layer ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;
    if (tiles.current) tiles.current.remove();
    const url = isSatelliteActive
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    tiles.current = L.tileLayer(url, {
      maxZoom: 18,
      attribution: isSatelliteActive ? "Imagery © Esri" : "© OpenStreetMap contributors",
    }).addTo(map.current);
  }, [isSatelliteActive, layers.satellite]);

  // ─── Custom Monitored Areas overlay (Full India view by default) ────────────
  useEffect(() => {
    const group = overlay.current;
    const instance = map.current;
    if (!group || !instance) return;
    group.clearLayers();



    if (layers.customAreas) {
      // In singleAreaMode, only render the selected/focused area — skip all others
      const areasToRender = singleAreaMode
        ? customAreas.filter((a) => a.id === (focusedArea?.id || selectedArea?.id))
        : customAreas;
      areasToRender.forEach((area) => {
        const coords =
          area.polygon && area.polygon.length >= 3
            ? area.polygon
            : parseCustomAreaPolygon(area.shape, Number(area.lat), Number(area.lng));

        if (coords.length < 3) return;

        const isSelected = selectedArea?.id === area.id;
        const areaSq =
          area.areaSqMeters && area.areaSqMeters > 0
            ? area.areaSqMeters
            : calculatePolygonAreaSqMeters(coords);

        const areaFormatted = formatArea(areaSq);
        const riskKey = area.risk?.toLowerCase() || "medium";
        const theme = RISK_COLORS[riskKey] ?? RISK_COLORS.medium;

        const latlngs = coords.map((c) => L.latLng(c[0], c[1]));

        const poly = L.polygon(latlngs, {
          color: isSelected ? "#0F4C81" : theme.stroke,
          weight: isSelected ? 3 : 2,
          fillColor: isSelected ? "#0284C7" : theme.fill,
          fillOpacity: isSelected ? 0.35 : 0.22,
          dashArray: isSelected ? undefined : "5 4",
        });

        // Hover Tooltip with calculated area
        if (layers.areaLabels) {
          poly.bindTooltip(
            `<div style="font-family:'IBM Plex Sans',sans-serif;padding:2px 4px;">
              <div style="font-weight:700;font-size:12px;color:#0F172A;">${area.name}</div>
              <div style="font-size:10px;font-weight:600;color:#0F4C81;margin-top:1px;">Area: ${areaFormatted.sqMetersFormatted}</div>
              <div style="font-size:9px;color:#64748B;">(${areaFormatted.sqKmFormatted})</div>
            </div>`,
            { sticky: true, className: "custom-area-leaflet-tooltip" }
          );
        }

        // Detailed Popup with "Zoom to Land" action
        const popupContent = `
          <div style="font-family:'IBM Plex Sans',sans-serif;min-width:240px;padding:3px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <strong style="font-size:14px;color:#0F172A;">${area.name}</strong>
              <span style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:${theme.stroke};color:#ffffff;">${area.risk}</span>
            </div>
            <div style="font-size:11px;color:#64748B;margin-bottom:8px;">${area.district} · ${area.type}</div>
            
            <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:8px;margin-bottom:8px;">
              <div style="font-size:10px;color:#64748B;text-transform:uppercase;font-weight:600;letter-spacing:0.04em;">Enclosed Surface Area</div>
              <div style="font-size:13px;font-weight:700;color:#0F4C81;margin-top:2px;">${areaFormatted.sqMetersFormatted}</div>
              <div style="font-size:11px;color:#0D9488;font-weight:600;">${areaFormatted.sqKmFormatted}</div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;color:#334155;margin-bottom:4px;">
              <div>Priority: <b>${area.priority}</b></div>
              <div>Nodes: <b>${coords.length} pts</b></div>
            </div>
            <div style="font-size:11px;color:#475569;margin-bottom:6px;">Center: <b>${area.lat.toFixed(4)}, ${area.lng.toFixed(4)}</b></div>
            <div style="border-top:1px solid #F1F5F9;padding-top:6px;display:flex;flex-direction:column;gap:4px;">
              <button id="popup-zoom-btn-${area.id}" style="width:100%;background:#0F4C81;color:#fff;border:none;border-radius:4px;padding:5px 8px;font-size:11px;font-weight:600;cursor:pointer;">
                🔍 Zoom to Land View
              </button>
              <button id="popup-details-btn-${area.id}" style="width:100%;background:#0284C7;color:#fff;border:none;border-radius:4px;padding:5px 8px;font-size:11px;font-weight:600;cursor:pointer;">
                📋 View Area Details Tab
              </button>
            </div>
          </div>
        `;
        poly.bindPopup(popupContent);

        poly.on("popupopen", () => {
          const btn = document.getElementById(`popup-zoom-btn-${area.id}`);
          if (btn) {
            btn.onclick = () => {
              zoomToAreaLand(area);
              selectRef.current?.(area);
            };
          }
          const dBtn = document.getElementById(`popup-details-btn-${area.id}`);
          if (dBtn) {
            dBtn.onclick = () => {
              selectRef.current?.(area);
              setDetailsOpen(true);
            };
          }
        });

        poly.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          selectRef.current?.(area);
        });

        group.addLayer(poly);

        // Center badge label
        if (layers.boundaries) {
          group.addLayer(
            L.marker([area.lat, area.lng], {
              icon: L.divIcon({
                className: "",
                html: `<div style="white-space:nowrap;transform:translate(-50%,-120%);background:#0B2545;color:#fff;font:600 10px/1.3 'IBM Plex Sans',sans-serif;padding:3px 7px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.25);cursor:pointer;">
                  ${area.name} <span style="color:#7DD3FC;font-size:9px;font-weight:500;">(${areaFormatted.brief})</span>
                </div>`,
                iconSize: [0, 0],
              }),
              interactive: true,
            }).on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              zoomToAreaLand(area);
              selectRef.current?.(area);
            })
          );
        }
      });
    }
  }, [customAreas, selectedArea, layers.customAreas, layers.areaLabels, layers.boundaries]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${isFullscreen ? "fixed inset-0 z-[99999] bg-slate-900" : "h-full"}`}
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      <div ref={holder} style={{ height: "100%", width: "100%" }} className="z-0 rounded-lg" data-testid={testId} />

      {/* 🌧️ Selected Area Rain Simulation Overlay (Restricted 100% strictly inside selected boundary) */}
      <SelectedAreaRainOverlay
        map={mapInstance || map.current}
        polygonCoords={selectedAreaCoords}
        active={Boolean(isRain && selectedArea && selectedAreaCoords && selectedAreaCoords.length >= 3)}
        intensityMm={rainfallIntensity ?? 75}
        windSpeedKmh={20}
      />


      {/* 🔍 Floating Location & Area Search Bar Overlay — hidden in singleAreaMode */}
      {!singleAreaMode && (
      <div className="absolute top-3 left-3 z-[1000] w-72 sm:w-80 pointer-events-auto">
        <div className="relative flex items-center bg-white/95 backdrop-blur-md border border-slate-300 rounded-xl shadow-xl transition-all focus-within:ring-2 focus-within:ring-[#0F4C81] focus-within:border-[#0F4C81]">
          <Search className="size-4 text-slate-400 ml-3 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setSearchOpen(true);
            }}
            placeholder="Search place, city, district or lat, lng..."
            className="w-full py-2 pl-2 pr-8 text-xs text-slate-800 placeholder-slate-400 bg-transparent focus:outline-none font-medium"
          />
          {isSearching ? (
            <Loader2 className="size-3.5 text-sky-600 animate-spin absolute right-3" />
          ) : searchQuery ? (
            <button
              type="button"
              onClick={handleClearSearch}
              className="p-1 text-slate-400 hover:text-slate-600 absolute right-2.5 rounded-full cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {/* Search Results Dropdown */}
        {searchOpen && searchResults.length > 0 && (
          <div className="absolute top-full mt-1.5 left-0 w-full bg-white/98 backdrop-blur-md border border-slate-200 rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto divide-y divide-slate-100 animate-in fade-in-50 zoom-in-95 duration-150 z-[1001]">
            {searchResults.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectLocation(item)}
                className="w-full p-2.5 text-left hover:bg-slate-50 flex items-start gap-2.5 transition-colors cursor-pointer group"
              >
                <div className={`size-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                  item.isArea
                    ? "bg-amber-50 text-amber-600 border border-amber-200"
                    : item.isCoord
                    ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                    : "bg-sky-50 text-sky-600 border border-sky-200"
                }`}>
                  {item.isArea ? (
                    <MapIcon className="size-3.5" />
                  ) : item.isCoord ? (
                    <Globe className="size-3.5" />
                  ) : (
                    <MapPin className="size-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-800 group-hover:text-[#0F4C81] truncate">
                    {item.title}
                  </div>
                  {item.subtitle && (
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">
                      {item.subtitle}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Map Control Buttons: always visible */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
        {/* Fullscreen Button */}
        <button
          onClick={toggleFullscreen}
          className={`flex items-center gap-1.5 font-semibold text-xs px-3 py-1.5 rounded-md shadow-md border backdrop-blur-sm transition-all hover:shadow-lg active:scale-95 cursor-pointer ${
            isFullscreen
              ? "bg-purple-600 hover:bg-purple-700 text-white border-purple-400"
              : "bg-white/95 hover:bg-white text-slate-800 border-slate-300"
          }`}
          title={isFullscreen ? "Exit Fullscreen (Esc)" : "Enter Fullscreen Mode"}
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="size-3.5 text-purple-200" />
              <span>Exit Fullscreen</span>
            </>
          ) : (
            <>
              <Maximize2 className="size-3.5 text-[#0F4C81]" />
              <span>Full Screen</span>
            </>
          )}
        </button>

        {/* Draw Area Button — hidden in singleAreaMode */}
        {!singleAreaMode && (
        <button
          onClick={() => toggleDraw()}
          className={`flex items-center gap-1.5 font-semibold text-xs px-3 py-1.5 rounded-md shadow-md border backdrop-blur-sm transition-all hover:shadow-lg active:scale-95 cursor-pointer ${
            isDrawActive
              ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-400"
              : "bg-white/95 hover:bg-white text-slate-800 border-slate-300"
          }`}
          title={isDrawActive ? "Cancel drawing mode" : "Draw monitoring area on map"}
        >
          <Ruler className="size-3.5" />
          <span>{isDrawActive ? "Cancel Draw" : "Draw Area"}</span>
        </button>
        )}
      </div>

      {/* ─── Monitored Area Details Tab (100% Consistent in Fullscreen & Normal Mode) ─── */}
      {isFullscreen && detailsPanel && detailsOpen && (
        <div className="absolute top-3 right-3 bottom-3 w-[330px] sm:w-[350px] z-[1001] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col pointer-events-auto animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="size-2 rounded-full bg-[#0F4C81] shrink-0" />
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider truncate">
                {selectedArea ? selectedArea.name : "Monitored Area"} Details
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDetailsOpen(false)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer shrink-0"
              title="Close Details Tab"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {detailsPanel}
          </div>
        </div>
      )}

      {/* Live drawing HUD with real-time area calculation & Delete Point button */}
      {isDrawActive && !confirmingPolygon && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 backdrop-blur-md text-white px-4 py-3 rounded-lg shadow-xl border border-slate-700/60 max-w-sm pointer-events-auto">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
              <Ruler className="size-4 animate-pulse" />
              <span>Boundary Drawing</span>
            </div>
            {liveMetrics.count > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteLastVertex();
                }}
                className="flex items-center gap-1 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-[11px] font-bold px-2.5 py-1 rounded shadow-xs cursor-pointer transition-colors"
                title="Delete last added point (or press Backspace)"
              >
                <Trash2 className="size-3.5" />
                <span>Delete Point</span>
              </button>
            )}
          </div>
          <div className="text-xs text-slate-300">
            Boundary points: <span className="font-bold text-white">{liveMetrics.count}</span>
          </div>
          {liveMetrics.count >= 3 ? (
            <div className="mt-2 pt-2 border-t border-slate-700/80">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Live Calculated Area</div>
                  <div className="text-sm font-bold text-emerald-400 font-mono">
                    {formatArea(liveMetrics.sqMeters).combined}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleFinishBoundary}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded shadow-md cursor-pointer flex items-center gap-1.5 transition-all active:scale-95"
                  title="Connect points and open confirmation tab"
                >
                  <CheckCircle2 className="size-3.5" />
                  <span>Confirm Area</span>
                </button>
              </div>
              <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-1.5">
                <CheckCircle2 className="size-3 text-emerald-400" />
                Click first point, double-click, or click "Confirm Area" above
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 mt-1 italic">
              Click points on map to outline area boundary
            </div>
          )}
        </div>
      )}

      {/* ─── Confirmation & Save Tab (100% Visible in Fullscreen & Normal Mode) ─── */}
      {confirmingPolygon && (
        <div className="absolute inset-0 z-[10000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 animate-in fade-in zoom-in-95 duration-150 text-left">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center text-[#0F4C81] shrink-0">
                  <CheckCircle2 className="size-5 text-[#0F4C81]" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-base leading-tight">Confirm Monitored Area</h4>
                  <p className="text-xs text-slate-500">Review boundary details and confirm custom area</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmingPolygon(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Surface Area Banner */}
            <div className="bg-gradient-to-r from-sky-50 to-cyan-50/70 border border-sky-100 rounded-xl p-3.5 my-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-sky-800">
                    Enclosed Surface Area
                  </div>
                  <div className="text-lg font-black text-[#0F4C81] font-mono mt-0.5">
                    {formatArea(confirmingPolygon.sqMeters).sqMetersFormatted}
                  </div>
                  <div className="text-xs font-semibold text-teal-700">
                    Metric: {formatArea(confirmingPolygon.sqMeters).sqKmFormatted}
                  </div>
                </div>
                <div className="text-right">
                  <span className="inline-block text-[11px] font-semibold bg-white/90 border border-sky-200 text-sky-900 px-2.5 py-1 rounded-full shadow-2xs">
                    {confirmingPolygon.latlngs.length} Coordinate Points
                  </span>
                </div>
              </div>
            </div>

            {/* Form Fields for Area Customization */}
            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Area Name *</label>
                  <input
                    type="text"
                    value={confirmForm.name}
                    onChange={(e) => setConfirmForm({ ...confirmForm, name: e.target.value })}
                    placeholder="e.g. Aliyar Basin Zone"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F4C81] focus:ring-1 focus:ring-[#0F4C81]/20 font-medium text-slate-800"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">District / Region</label>
                  <input
                    type="text"
                    value={confirmForm.district}
                    onChange={(e) => setConfirmForm({ ...confirmForm, district: e.target.value })}
                    placeholder="e.g. Coimbatore / Nilgiris"
                    className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-[#0F4C81] focus:ring-1 focus:ring-[#0F4C81]/20 text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">Area Type</label>
                  <select
                    value={confirmForm.type}
                    onChange={(e) => setConfirmForm({ ...confirmForm, type: e.target.value })}
                    className="w-full text-xs px-2 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F4C81] text-slate-800 cursor-pointer"
                  >
                    <option>River Basin</option>
                    <option>Forest</option>
                    <option>Urban</option>
                    <option>Mountain Pass</option>
                    <option>Agricultural</option>
                    <option>Coastal</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">Risk Category</label>
                  <select
                    value={confirmForm.risk}
                    onChange={(e) => setConfirmForm({ ...confirmForm, risk: e.target.value })}
                    className="w-full text-xs px-2 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F4C81] text-slate-800 cursor-pointer"
                  >
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                    <option>Critical</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">Priority</label>
                  <select
                    value={confirmForm.priority}
                    onChange={(e) => setConfirmForm({ ...confirmForm, priority: e.target.value })}
                    className="w-full text-xs px-2 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-[#0F4C81] text-slate-800 cursor-pointer"
                  >
                    <option>Normal (Hourly)</option>
                    <option>Elevated (15 mins)</option>
                    <option>Maximum (Real-time)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmingPolygon(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Back / Edit Points
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const { latlngs, sqMeters } = confirmingPolygon;
                    setConfirmingPolygon(null);
                    clearDraw();
                    onAreaSelectedRef.current?.(latlngs, sqMeters);
                    toast.success(`Boundary measured: ${formatArea(sqMeters).combined}`);
                  }}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Just Measure
                </button>

                <button
                  type="button"
                  disabled={isSavingArea}
                  onClick={handleConfirmAndSaveArea}
                  className="px-4 py-2 text-xs font-bold text-white bg-[#0F4C81] hover:bg-[#0B3A61] rounded-lg shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSavingArea ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Saving Area...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-3.5" />
                      <span>Confirm & Save Area</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
