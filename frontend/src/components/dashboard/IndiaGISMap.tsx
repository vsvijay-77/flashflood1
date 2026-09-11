import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polygon, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { MapIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { calculatePolygonAreaSqMeters, formatArea, parseCustomAreaPolygon } from "@/lib/gisUtils";
import type { CustomArea } from "@/lib/types";

// Fix for leaflet markers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const INDIA_CENTER: [number, number] = [22.5937, 78.9629];
const INDIA_BOUNDS: L.LatLngBoundsLiteral = [
  [6.7535159, 68.162386],
  [37.069918, 97.395358],
];

function MapController() {
  const map = useMap();
  useEffect(() => {
    map.setMaxBounds(INDIA_BOUNDS);
    map.setMinZoom(4);
  }, [map]);
  return null;
}

export function IndiaGISMap() {
  const [customAreas, setCustomAreas] = useState<CustomArea[]>([]);

  useEffect(() => {
    supabase
      .from("custom_areas")
      .select("*")
      .then(({ data }) => {
        if (data) {
          const loaded: CustomArea[] = data.map((d: any) => {
            const polygonCoords = parseCustomAreaPolygon(d.shape, Number(d.lat), Number(d.lng));
            const areaSq = calculatePolygonAreaSqMeters(polygonCoords);

            return {
              id: d.id,
              name: d.name,
              district: d.district,
              type: d.area_type || "Forest",
              risk: d.risk_category || "Medium",
              priority: d.priority || "Normal",
              description: d.description || "",
              date: new Date(d.created_at).toLocaleDateString(),
              lat: Number(d.lat),
              lng: Number(d.lng),
              shape: d.shape || "Polygon",
              polygon: polygonCoords,
              areaSqMeters: areaSq,
            };
          });
          setCustomAreas(loaded);
        }
      });
  }, []);

  const getRiskColor = (risk: string) => {
    const r = risk?.toLowerCase();
    if (r === "critical") return "#ef4444";
    if (r === "high") return "#f97316";
    if (r === "low") return "#10b981";
    return "#f59e0b";
  };

  return (
    <Card className="w-full shadow-sm overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 bg-white z-10 relative">
        <div className="flex items-center gap-2">
          <MapIcon className="size-5 text-slate-700" />
          <CardTitle className="text-lg font-semibold text-slate-900">Custom Monitored Areas Map</CardTitle>
        </div>
      </CardHeader>
      <div className="h-[500px] w-full relative z-0">
        <MapContainer
          center={INDIA_CENTER}
          zoom={5}
          style={{ height: "100%", width: "100%", background: "#f8fafc" }}
          maxBounds={INDIA_BOUNDS}
          maxBoundsViscosity={1.0}
          minZoom={4}
          attributionControl={false}
        >
          <MapController />
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />

          {customAreas.map((area) => {
            const color = getRiskColor(area.risk);
            const areaFormatted = formatArea(area.areaSqMeters);

            if (!area.polygon || area.polygon.length < 3) return null;

            return (
              <Polygon
                key={area.id}
                positions={area.polygon}
                pathOptions={{
                  color: color,
                  fillColor: color,
                  fillOpacity: 0.25,
                  weight: 2,
                }}
              >
                <Popup className="rounded-lg">
                  <div className="text-sm p-1">
                    <div className="font-bold text-base mb-1">{area.name}</div>
                    <div className="text-slate-500 mb-2">{area.district} · {area.type}</div>
                    <div className="bg-slate-50 border border-slate-200 rounded p-2 mb-2">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Calculated Area</div>
                      <div className="font-bold text-[#0F4C81]">{areaFormatted.sqMetersFormatted}</div>
                      <div className="text-xs text-teal-700">{areaFormatted.sqKmFormatted}</div>
                    </div>
                    <div className="text-xs text-slate-600">
                      Risk Level: <strong style={{ color }}>{area.risk}</strong>
                    </div>
                  </div>
                </Popup>
              </Polygon>
            );
          })}
        </MapContainer>
      </div>
    </Card>
  );
}
