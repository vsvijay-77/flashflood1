import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Activity, Radio } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { ExternalSensorHistoryItem } from "@/lib/types";

interface AccelPoint {
  time: string;
  x: number;
  y: number;
  z: number;
  tilt: number;
}

/** Find all local maxima (peaks) for a given data key. A peak is a point
 *  whose value is strictly greater than both its immediate neighbors. */
function findPeaks(data: AccelPoint[], key: "x" | "y" | "z") {
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

  const limit = range === "Live" ? 30 : range === "Last 1 Hour" ? 60 : range === "Last 24 Hours" ? 150 : 300;

  const { data: history = [], isLoading } = useQuery<ExternalSensorHistoryItem[]>({
    queryKey: ["external-sensors-history", limit],
    queryFn: () => apiGet<ExternalSensorHistoryItem[]>(`/external-sensors/history?limit=${limit}`),
    refetchInterval: 1000,
  });

  // Map real database records from sensor_data to chart points
  const accelData: AccelPoint[] = useMemo(() => {
    if (!history || history.length === 0) {
      return Array.from({ length: 15 }).map((_, i) => ({
        time: `18:${(40 + i).toString().padStart(2, "0")}`,
        x: 0,
        y: 0,
        z: 9.8,
        tilt: 0,
      }));
    }

    return history
      .slice()
      .reverse()
      .map((h) => ({
        time: h.created_at
          ? new Date(h.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
          : `#${h.id}`,
        x: Number(h.imu_x ?? 0),
        y: Number(h.imu_y ?? 0),
        z: Number(h.imu_z ?? 0),
        tilt: Number(h.tilt ?? 0),
      }));
  }, [history]);

  const xPeaks = useMemo(() => findPeaks(accelData, "x"), [accelData]);
  const yPeaks = useMemo(() => findPeaks(accelData, "y"), [accelData]);
  const zPeaks = useMemo(() => findPeaks(accelData, "z"), [accelData]);

  const totalPeaks = xPeaks.length + yPeaks.length + zPeaks.length;

  return (
    <Card className="w-full shadow-xs border-slate-200">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-indigo-500" />
            <CardTitle className="text-lg font-semibold text-slate-900">
              Accelerometer &amp; IMU – Real-Time Telemetry
            </CardTitle>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Streaming real 3-axis motion records from PostgreSQL <span className="font-mono text-slate-700">sensor_data</span> (Node LORA_NODE_1)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="size-2 rounded-full bg-emerald-400 ring-2 ring-emerald-300 animate-pulse" />
            {totalPeaks} Peaks Detected
          </span>
          <div className="flex gap-1.5">
            {["Live", "Last 1 Hour", "Last 24 Hours", "All Buffer"].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  range === r ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={accelData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} domain={[-5, 15]} />
              <Tooltip
                contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
              />
              <Line type="monotone" dataKey="x" name="IMU X Axis" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="y" name="IMU Y Axis" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="z" name="IMU Z Axis" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />

              {/* X-axis peaks */}
              {xPeaks.map((p, i) => (
                <ReferenceDot key={`xp-${i}`} x={p.time} y={p.value} r={4} fill="#3b82f6" stroke="#1d4ed8" strokeWidth={2} />
              ))}

              {/* Y-axis peaks */}
              {yPeaks.map((p, i) => (
                <ReferenceDot key={`yp-${i}`} x={p.time} y={p.value} r={4} fill="#10b981" stroke="#047857" strokeWidth={2} />
              ))}

              {/* Z-axis peaks */}
              {zPeaks.map((p, i) => (
                <ReferenceDot key={`zp-${i}`} x={p.time} y={p.value} r={4} fill="#f43f5e" stroke="#be123c" strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
