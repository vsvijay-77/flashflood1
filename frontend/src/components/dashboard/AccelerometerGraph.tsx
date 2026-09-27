import { useState, useMemo, useEffect } from "react";
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
  isMoving: boolean;
}

/** Find all local maxima (peaks) for a given data key. */
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
  const [sensitivityMode, setSensitivityMode] = useState<"amplified" | "standard">("standard");

  const limit = range === "Live" ? 30 : range === "Last 1 Hour" ? 60 : range === "Last 24 Hours" ? 150 : 300;

  const { data: history = [] } = useQuery<ExternalSensorHistoryItem[]>({
    queryKey: ["external-sensors-history", limit],
    queryFn: () => apiGet<ExternalSensorHistoryItem[]>(`/external-sensors/history?limit=${limit}`),
    refetchInterval: 3000,
  });

  // Map real database records from sensor_data to steady chart points
  const accelData: AccelPoint[] = useMemo(() => {
    if (!history || history.length === 0) {
      return Array.from({ length: 15 }).map((_, i) => ({
        time: `18:${(40 + i).toString().padStart(2, "0")}`,
        x: -10,
        y: -10,
        z: -10,
        calculatedZ: -10,
        tilt: 100,
        landslideStatus: "normal",
        isMoving: false,
      }));
    }

    return history
      .slice()
      .reverse()
      .map((h) => {
        const rawX = Number(h.imu_x ?? 0);
        const rawY = Number(h.imu_y ?? 0);
        const rawZ = Number(h.imu_z ?? 0);

        const isAllAround10 = rawX >= 7 && rawY >= 7 && rawZ >= 7;
        const isLegacyAdcLandslide = rawY > 2000 || (rawZ > 0 && rawZ < 2050);
        const isMoving = isAllAround10 || isLegacyAdcLandslide;
        const isStaticNegative = rawX <= -5 && rawY <= -5 && rawZ <= -5;

        let landslideStatus: "normal" | "risk_50" | "landslide" = "normal";
        if (isMoving && !isStaticNegative) {
          landslideStatus = "landslide";
        } else if (rawY > 2000) {
          landslideStatus = "risk_50";
        }

        // Static steady sensor readings - no artificial tremor/oscillation
        const x = Number(rawX.toFixed(1));
        const y = Number(rawY.toFixed(1));
        const z = Number(rawZ.toFixed(1));

        // Combined 3-axis motion indicator
        const calculatedZ = Math.abs(rawX) < 100
          ? Number(((x + y + z) / 3.0).toFixed(1))
          : Number((z + (Math.abs(x - 4095) * 0.5) + (Math.abs(y - 1843) * 1.5)).toFixed(1));

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
          isMoving,
        };
      });
  }, [history]);

  const xPeaks = useMemo(() => findPeaks(accelData, "x"), [accelData]);
  const yPeaks = useMemo(() => findPeaks(accelData, "y"), [accelData]);
  const zPeaks = useMemo(() => findPeaks(accelData, "z"), [accelData]);
  const calcZPeaks = useMemo(() => findPeaks(accelData, "calculatedZ"), [accelData]);

  const totalPeaks = xPeaks.length + yPeaks.length + zPeaks.length + calcZPeaks.length;

  // Dynamic Y-Domain to clearly show movement between -10 and +10
  const { yDomain, latestPoint } = useMemo(() => {
    if (accelData.length === 0) return { yDomain: [-15, 15], latestPoint: null };
    const latest = accelData[accelData.length - 1];
    const activeValues = accelData.flatMap((d) => [d.x, d.y, d.z, d.calculatedZ]).filter((v) => Number.isFinite(v));
    if (activeValues.length === 0) return { yDomain: [-15, 15], latestPoint: latest };

    const minV = Math.min(...activeValues);
    const maxV = Math.max(...activeValues);
    const spread = Math.max(8, maxV - minV);

    if (sensitivityMode === "amplified") {
      const pad = Math.max(3, Math.round(spread * 0.18));
      return {
        yDomain: [Math.floor(minV - pad), Math.ceil(maxV + pad)],
        latestPoint: latest,
      };
    } else {
      return {
        yDomain: [Math.min(-15, Math.floor(minV - 4)), Math.max(15, Math.ceil(maxV + 4))],
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
              Accelerometer &amp; IMU Telemetry – Landslide Motion Tracker
            </CardTitle>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Streaming real 3-axis motion from PostgreSQL <span className="font-mono text-slate-700">sensor_data</span> (Node LORA_NODE_1)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* IMU Landslide & Movement Status Indicator */}
          {latestPoint && (
            <div className="flex items-center gap-2">
              {latestPoint.landslideStatus === "landslide" ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-950 border border-rose-600 px-2.5 py-1 text-xs font-bold text-rose-200 animate-pulse">
                  <AlertTriangle className="size-3.5 text-rose-400" />
                  🚨 Movement Detected (All ~10) – Landslide Active
                </span>
              ) : latestPoint.x <= -5 && latestPoint.y <= -5 && latestPoint.z <= -5 ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-950 border border-emerald-600 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                  <ShieldCheck className="size-3.5 text-emerald-400" />
                  🛡️ No Movement (All ~-10) – No Landslide
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-950 border border-emerald-600 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                  <ShieldCheck className="size-3.5 text-emerald-400" />
                  Stable [X:{latestPoint.x.toFixed(1)}, Y:{latestPoint.y.toFixed(1)}, Z:{latestPoint.z.toFixed(1)}]
                </span>
              )}
            </div>
          )}

          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="size-2 rounded-full bg-emerald-400 ring-2 ring-emerald-300 animate-pulse" />
            {totalPeaks} Peaks
          </span>

          {/* Toggle Amplification */}
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
              {sensitivityMode === "amplified" ? "Zoom: Amplified (Waveform)" : "Zoom: Standard"}
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
            <div className="p-2 rounded bg-cyan-50/70 border border-cyan-200 flex flex-col">
              <span className="text-cyan-800 text-[10px] font-semibold">IMU X-Axis (~10 Movement / -10 Static)</span>
              <span className={`font-mono text-base font-bold ${latestPoint.x >= 7 ? "text-rose-600" : latestPoint.x <= -5 ? "text-emerald-700" : "text-cyan-800"}`}>
                {latestPoint.x.toFixed(1)} m/s²
              </span>
            </div>
            <div className="p-2 rounded bg-emerald-50/70 border border-emerald-200 flex flex-col">
              <span className="text-emerald-800 text-[10px] font-semibold">IMU Y-Axis (~10 Movement / -10 Static)</span>
              <span className={`font-mono text-base font-bold ${latestPoint.y >= 7 ? "text-rose-600" : latestPoint.y <= -5 ? "text-emerald-700" : "text-emerald-800"}`}>
                {latestPoint.y.toFixed(1)} m/s²
              </span>
            </div>
            <div className="p-2 rounded bg-rose-50/70 border border-rose-200 flex flex-col">
              <span className="text-rose-800 text-[10px] font-semibold">IMU Z-Axis (~10 Movement / -10 Static)</span>
              <span className={`font-mono text-base font-bold ${latestPoint.z >= 7 ? "text-rose-600" : latestPoint.z <= -5 ? "text-emerald-700" : "text-rose-800"}`}>
                {latestPoint.z.toFixed(1)} m/s²
              </span>
            </div>
            <div className="p-2 rounded bg-indigo-50/70 border border-indigo-200 flex flex-col">
              <span className="text-indigo-800 text-[10px] font-semibold">Combined 3-Axis Motion Status</span>
              <span className={`font-mono text-base font-bold ${latestPoint.isMoving ? "text-rose-600 animate-pulse" : "text-emerald-700"}`}>
                {latestPoint.isMoving ? "🚨 Movement Detected" : "🛡️ No Movement"}
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
              <ReferenceLine y={10} stroke="#e11d48" strokeDasharray="4 4" label={{ value: "+10: Movement Detected (Landslide Trigger)", fill: "#e11d48", fontSize: 10, position: "insideTopLeft" }} />
              <ReferenceLine y={-10} stroke="#059669" strokeDasharray="4 4" label={{ value: "-10: Baseline (No Movement / Static)", fill: "#059669", fontSize: 10, position: "insideBottomLeft" }} />

              {/* Data lines - static, no jitter or bouncing */}
              <Line type="monotone" dataKey="x" name="IMU X Axis" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="y" name="IMU Y Axis" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="z" name="IMU Z Axis" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="calculatedZ" name="Combined 3-Axis Motion" stroke="#6366f1" strokeWidth={2.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />

              {/* Peaks */}
              {xPeaks.map((p, i) => (
                <ReferenceDot key={`xp-${i}`} x={p.time} y={p.value} r={3} fill="#06b6d4" stroke="#0891b2" strokeWidth={1.5} />
              ))}
              {yPeaks.map((p, i) => (
                <ReferenceDot key={`yp-${i}`} x={p.time} y={p.value} r={3} fill="#10b981" stroke="#047857" strokeWidth={1.5} />
              ))}
              {zPeaks.map((p, i) => (
                <ReferenceDot key={`zp-${i}`} x={p.time} y={p.value} r={3} fill="#f43f5e" stroke="#be123c" strokeWidth={1.5} />
              ))}
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
