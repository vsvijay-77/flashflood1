import { useState, useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Activity } from "lucide-react";

// Mock continuous data
const accelData = Array.from({ length: 60 }).map((_, i) => ({
  time: `10:${i.toString().padStart(2, "0")}`,
  x: Math.random() * 2 - 1,
  y: Math.random() * 2 - 1,
  z: 9.8 + (Math.random() * 0.5 - 0.25),
}));

/** Find all local maxima (peaks) for a given data key. A peak is a point
 *  whose value is strictly greater than both its immediate neighbors. */
function findPeaks(data: typeof accelData, key: "x" | "y" | "z") {
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

  const xPeaks = useMemo(() => findPeaks(accelData, "x"), []);
  const yPeaks = useMemo(() => findPeaks(accelData, "y"), []);
  const zPeaks = useMemo(() => findPeaks(accelData, "z"), []);

  const totalPeaks = xPeaks.length + yPeaks.length + zPeaks.length;

  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <Activity className="size-5 text-indigo-500" />
          <CardTitle className="text-lg font-semibold text-slate-900">Accelerometer – Real-Time Telemetry</CardTitle>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="size-2 rounded-full bg-black ring-2 ring-white" />
            {totalPeaks} Peaks Detected
          </span>
          <div className="flex gap-2">
            {["Live", "Last 1 Hour", "Last 24 Hours", "Last 7 Days"].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  range === r ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={accelData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} domain={[-2, 12]} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Line type="monotone" dataKey="x" name="X Axis" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="y" name="Y Axis" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="z" name="Z Axis" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />

              {/* X-axis peaks – black dots */}
              {xPeaks.map((p, i) => (
                <ReferenceDot
                  key={`xp-${i}`}
                  x={p.time}
                  y={p.value}
                  r={5}
                  fill="#000000"
                  stroke="#000000"
                  strokeWidth={2}
                />
              ))}

              {/* Y-axis peaks – black dots */}
              {yPeaks.map((p, i) => (
                <ReferenceDot
                  key={`yp-${i}`}
                  x={p.time}
                  y={p.value}
                  r={5}
                  fill="#000000"
                  stroke="#000000"
                  strokeWidth={2}
                />
              ))}

              {/* Z-axis peaks – black dots */}
              {zPeaks.map((p, i) => (
                <ReferenceDot
                  key={`zp-${i}`}
                  x={p.time}
                  y={p.value}
                  r={5}
                  fill="#000000"
                  stroke="#000000"
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-5">
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase text-slate-500">X Peaks</span>
            <span className="font-mono text-lg font-semibold text-slate-900">{xPeaks.length}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase text-slate-500">Y Peaks</span>
            <span className="font-mono text-lg font-semibold text-slate-900">{yPeaks.length}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase text-slate-500">Z Peaks</span>
            <span className="font-mono text-lg font-semibold text-slate-900">{zPeaks.length}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase text-slate-500">Vibration Intensity</span>
            <span className="text-lg font-semibold text-emerald-600">Normal</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase text-slate-500">Movement Anomaly</span>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
              <span className="size-2 rounded-full bg-emerald-500"></span> None Detected
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
