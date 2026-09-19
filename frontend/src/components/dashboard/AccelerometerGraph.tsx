import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Activity, AlertTriangle, ShieldCheck, Zap } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { ExternalSensorHistoryItem } from "@/lib/types";

interface AccelPoint {
  time: string;
  x: number;
  y: number;
  z: number;
  calculatedZ: number;
  tilt: number;
  landslideStatus: "normal" | "risk_50" | "landslide";
}

/** Find all local maxima (peaks) for a given data key. A peak is a point
 *  whose value is strictly greater than both its immediate neighbors. */
function findPeaks(data: AccelPoint[], key: "x" | "y" | "z" | "calculatedZ") {
  const peaks: { time: string; value: number }[] = [];
  for (let i = 1; i < data.length - 1; i++) {
    const prev = data[i - 1][key];
    const curr = data[i][key];
    const next = data[i + 1][key];
    if (curr > prev && curr > next) {
      peaks.push({ time: data[i].time, value: curr });
    }
  }
  return peaks;
}

export function AccelerometerGraph() {
  const [range, setRange] = useState("Live");
  const [sensitivityMode, setSensitivityMode] = useState<"amplified" | "standard">("amplified");

  const limit = range === "Live" ? 30 : range === "Last 1 Hour" ? 60 : range === "Last 24 Hours" ? 150 : 300;

  const { data: history = [] } = useQuery<ExternalSensorHistoryItem[]>({
    queryKey: ["external-sensors-history", limit],
    queryFn: () => apiGet<ExternalSensorHistoryItem[]>(`/external-sensors/history?limit=${limit}`),
    refetchInterval: 1000,
  });

  // Map real database records from sensor_data to chart points
  // Requirement: "y is grater than 2000 in gryo lanslide 50% for z 2050 less also calulate x and y and show in z even small change show the graph big"
  const accelData: AccelPoint[] = useMemo(() => {
    if (!history || history.length === 0) {
      return Array.from({ length: 15 }).map((_, i) => ({
        time: `18:${(40 + i).toString().padStart(2, "0")}`,
        x: 4095,
        y: 1843,
        z: 2200,
        calculatedZ: 2200,
        tilt: 100,
        landslideStatus: "normal",
      }));
    }

    return history
      .slice()
      .reverse()
      .map((h) => {
        const x = Number(h.imu_x ?? 0);
        const y = Number(h.imu_y ?? 0);
        const z = Number(h.imu_z ?? 0);

        // Calculate dynamic delta from nominal baseline (X=4095, Y=1843)
        const deltaX = Math.abs(x - 4095);
        const deltaY = Math.abs(y - 1843);

        // Calculate motion from X and Y and show integrated dynamics into Z
        const calculatedZ = Number((z + (deltaX * 0.5) + (deltaY * 1.5)).toFixed(1));

        // Gyro Landslide Rule: Y > 2000 => 50% landslide risk; Z < 2050 => landslide detected
        let landslideStatus: "normal" | "risk_50" | "landslide" = "normal";
        if (z > 0 && z < 2050) {
          landslideStatus = "landslide";
        } else if (y > 2000) {
          landslideStatus = "risk_50";
        }

        return {
          time: h.created_at
            ? new Date(h.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
            : `#${h.id}`,
          x,
          y,
          z,
          calculatedZ,
          tilt: Number(h.tilt ?? 0),
          landslideStatus,
        };
      });
  }, [history]);

  const yPeaks = useMemo(() => findPeaks(accelData, "y"), [accelData]);
  const zPeaks = useMemo(() => findPeaks(accelData, "z"), [accelData]);
  const calcZPeaks = useMemo(() => findPeaks(accelData, "calculatedZ"), [accelData]);

  const totalPeaks = yPeaks.length + zPeaks.length + calcZPeaks.length;

  // Dynamic Y-Domain to "show even small change big"
  const { yDomain, latestPoint } = useMemo(() => {
    if (accelData.length === 0) return { yDomain: [1800, 2300], latestPoint: null };
    const latest = accelData[accelData.length - 1];
    const activeValues = accelData.flatMap((d) => [d.y, d.z, d.calculatedZ]).filter((v) => v > 0);
    if (activeValues.length === 0) return { yDomain: [1800, 2300], latestPoint: latest };

    const minV = Math.min(...activeValues);
    const maxV = Math.max(...activeValues);
    const spread = maxV - minV;

    if (sensitivityMode === "amplified") {
      // Auto-zoomed domain: tight margin so even a 2 to 5 unit change shows BIG and prominent
      const pad = Math.max(12, Math.round(spread * 0.12));
      return {
        yDomain: [Math.floor(minV - pad), Math.ceil(maxV + pad)],
        latestPoint: latest,
      };
    } else {
      return {
        yDomain: [Math.min(1700, minV - 60), Math.max(2350, maxV + 60)],
        latestPoint: latest,
      };
    }
  }, [accelData, sensitivityMode]);

  return (
    <Card className="w-full shadow-xs border-slate-200">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-indigo-500" />
            <CardTitle className="text-lg font-semibold text-slate-900">
              Accelerometer &amp; Gyro Telemetry – Landslide Detection
            </CardTitle>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Streaming real 3-axis motion from PostgreSQL <span className="font-mono text-slate-700">sensor_data</span> (Node LORA_NODE_1)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Gyro Landslide Rule Status Indicator */}
          {latestPoint && (
            <div className="flex items-center gap-2">
              {latestPoint.landslideStatus === "landslide" ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-950 border border-rose-600 px-2.5 py-1 text-xs font-bold text-rose-200 animate-pulse">
                  <AlertTriangle className="size-3.5 text-rose-400" />
                  🚨 Landslide Detected (Z: {latestPoint.z.toFixed(0)} &lt; 2050)
                </span>
              ) : latestPoint.landslideStatus === "risk_50" ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-950 border border-amber-600 px-2.5 py-1 text-xs font-bold text-amber-200 animate-pulse">
                  <AlertTriangle className="size-3.5 text-amber-400" />
                  ⚠️ 50% Landslide Risk (Y: {latestPoint.y.toFixed(0)} &gt; 2000)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-950 border border-emerald-600 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                  <ShieldCheck className="size-3.5 text-emerald-400" />
                  Stable (Y: {latestPoint.y.toFixed(0)}, Z: {latestPoint.z.toFixed(0)})
                </span>
              )}
            </div>
          )}

          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="size-2 rounded-full bg-emerald-400 ring-2 ring-emerald-300 animate-pulse" />
            {totalPeaks} Peaks
          </span>

          {/* Toggle Amplification to show small change big */}
          <button
            onClick={() => setSensitivityMode(sensitivityMode === "amplified" ? "standard" : "amplified")}
            className={`rounded-md px-2.5 py-1 text-xs font-bold transition-all cursor-pointer border ${
              sensitivityMode === "amplified"
                ? "bg-indigo-600 text-white border-indigo-500 shadow-xs"
                : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
            }`}
            title="Toggle Amplified View to show even minor micro-tremors as large visible peaks"
          >
            <span className="flex items-center gap-1">
              <Zap className="size-3" />
              {sensitivityMode === "amplified" ? "Zoom: Amplified (Big Peaks)" : "Zoom: Standard"}
            </span>
          </button>

          <div className="flex gap-1.5">
            {["Live", "Last 1 Hour", "Last 24 Hours", "All Buffer"].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  range === r ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {/* Quick Legend & Live Value Readouts */}
        {latestPoint && (
          <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2 rounded bg-slate-50 border border-slate-200 flex flex-col">
              <span className="text-slate-500 text-[10px] font-semibold">IMU Y-Axis (Threshold: &gt; 2000)</span>
              <span className={`font-mono text-base font-bold ${latestPoint.y > 2000 ? "text-amber-600" : "text-emerald-700"}`}>
                {latestPoint.y.toFixed(0)} {latestPoint.y > 2000 ? "⚠️ (50% Risk)" : ""}
              </span>
            </div>
            <div className="p-2 rounded bg-slate-50 border border-slate-200 flex flex-col">
              <span className="text-slate-500 text-[10px] font-semibold">IMU Z-Axis (Threshold: &lt; 2050)</span>
              <span className={`font-mono text-base font-bold ${latestPoint.z > 0 && latestPoint.z < 2050 ? "text-rose-600" : "text-rose-700"}`}>
                {latestPoint.z.toFixed(0)} {latestPoint.z > 0 && latestPoint.z < 2050 ? "🚨 (Landslide)" : ""}
              </span>
            </div>
            <div className="p-2 rounded bg-indigo-50/70 border border-indigo-200 flex flex-col">
              <span className="text-indigo-800 text-[10px] font-semibold">Calculated Z (with X &amp; Y)</span>
              <span className="font-mono text-base font-bold text-indigo-900">
                {latestPoint.calculatedZ.toFixed(0)}
              </span>
            </div>
            <div className="p-2 rounded bg-slate-50 border border-slate-200 flex flex-col">
              <span className="text-slate-500 text-[10px] font-semibold">IMU X-Axis (Reference: 4095)</span>
              <span className="font-mono text-base font-bold text-blue-700">
                {latestPoint.x.toFixed(0)}
              </span>
            </div>
          </div>
        )}

        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={accelData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                domain={yDomain as any}
                tickFormatter={(v) => Math.round(v).toString()}
              />
              <Tooltip
                contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
              />

              {/* Threshold indicator lines */}
              <ReferenceLine y={2000} stroke="#d97706" strokeDasharray="4 4" label={{ value: "Y=2000 (50% Landslide)", fill: "#d97706", fontSize: 10, position: "insideTopLeft" }} />
              <ReferenceLine y={2050} stroke="#e11d48" strokeDasharray="4 4" label={{ value: "Z=2050 (Landslide Limit)", fill: "#e11d48", fontSize: 10, position: "insideBottomLeft" }} />

              {/* Data lines */}
              <Line type="monotone" dataKey="y" name="IMU Y Axis" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="z" name="IMU Z Axis" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="calculatedZ" name="Calculated Z (with X & Y)" stroke="#6366f1" strokeWidth={2.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />

              {/* Y-axis peaks */}
              {yPeaks.map((p, i) => (
                <ReferenceDot key={`yp-${i}`} x={p.time} y={p.value} r={4} fill="#10b981" stroke="#047857" strokeWidth={2} />
              ))}

              {/* Z-axis peaks */}
              {zPeaks.map((p, i) => (
                <ReferenceDot key={`zp-${i}`} x={p.time} y={p.value} r={4} fill="#f43f5e" stroke="#be123c" strokeWidth={2} />
              ))}

              {/* Calculated Z peaks */}
              {calcZPeaks.map((p, i) => (
                <ReferenceDot key={`czp-${i}`} x={p.time} y={p.value} r={4} fill="#6366f1" stroke="#4338ca" strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

