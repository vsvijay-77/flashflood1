import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Droplets, Thermometer, Waves, Leaf, Activity } from "lucide-react";

// Mock Data
const trendData = [
  { time: "10:00", val1: 22, val2: 12, val3: 40, x: 2, y: -1, z: 9.8 },
  { time: "10:05", val1: 22.5, val2: 14, val3: 42, x: 3, y: 0, z: 9.7 },
  { time: "10:10", val1: 23, val2: 18, val3: 45, x: 1, y: -2, z: 9.9 },
  { time: "10:15", val1: 24, val2: 15, val3: 43, x: 4, y: 1, z: 9.6 },
  { time: "10:20", val1: 23.5, val2: 10, val3: 39, x: 2, y: 0, z: 9.8 },
];

export function LiveSensorMonitoring() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-900">Live Sensor Readings</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        
        {/* Temperature Sensor */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Temperature</CardTitle>
            <Thermometer className="size-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900">23.5°C</div>
                <p className="text-xs text-slate-500">Min: 18°C | Max: 32°C</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <Tooltip contentStyle={{ fontSize: '10px' }} />
                  <Line type="monotone" dataKey="val1" stroke="#f97316" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Rain Sensor */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Rain Sensor</CardTitle>
            <Droplets className="size-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900">12 mm/h</div>
                <p className="text-xs text-slate-500">Status: Active Rain</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <Tooltip contentStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="val2" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Water Level */}
        <Card className="shadow-sm border-amber-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Water Level</CardTitle>
            <Waves className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900">4.2m</div>
                <p className="text-xs font-semibold text-amber-600">Warning: &gt; 4.0m</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <Tooltip contentStyle={{ fontSize: '10px' }} />
                  <Area type="monotone" dataKey="val1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Soil Moisture */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Soil Moisture</CardTitle>
            <Leaf className="size-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900">42%</div>
                <p className="text-xs text-slate-500">Optimal: 35-60%</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <Tooltip contentStyle={{ fontSize: '10px' }} />
                  <Line type="monotone" dataKey="val3" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Tilt Sensor */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Tilt (Inclinometer)</CardTitle>
            <Activity className="size-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xl font-bold text-slate-900">2° | 0° | 9.8°</div>
                <p className="text-xs text-slate-500">Status: Stable</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <Tooltip contentStyle={{ fontSize: '10px' }} />
                  <Line type="monotone" dataKey="x" stroke="#a855f7" strokeWidth={1} dot={false} />
                  <Line type="monotone" dataKey="y" stroke="#3b82f6" strokeWidth={1} dot={false} />
                  <Line type="monotone" dataKey="z" stroke="#ec4899" strokeWidth={1} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
