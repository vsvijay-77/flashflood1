import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Droplets, Thermometer, Waves, Leaf, Activity, Radio, CloudRain } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { SensorDataRecord, LiveWeatherData } from "@/lib/types";

export function LiveSensorMonitoring() {
  // 1. Fetch live IoT records from PostgreSQL sensor_data table
  const { data: sensorRecords = [], isLoading: isSensorLoading } = useQuery<SensorDataRecord[]>({
    queryKey: ["sensor_data_records"],
    queryFn: () => apiGet<SensorDataRecord[]>("/sensor-data?limit=30"),
    refetchInterval: 5000, // poll every 5 seconds for live sensor updates
  });

  // 2. Fetch reliable weather observation from Open-Meteo API
  const { data: weather, isLoading: isWeatherLoading } = useQuery<LiveWeatherData>({
    queryKey: ["live_weather_openmeteo"],
    queryFn: () => apiGet<LiveWeatherData>("/sensor-data/weather"),
    refetchInterval: 30000, // poll every 30 seconds
  });

  // Latest IoT telemetry record
  const latestSensor = sensorRecords[0];

  // Prepare trend data reversed chronologically (oldest to newest)
  const trendData = useMemo(() => {
    if (!sensorRecords || sensorRecords.length === 0) {
      return [
        { time: "10:00", rainfall: 0, water_level: 0, soil_moisture: 0, x: 0, y: 0, z: 9.8, tilt: 0, rssi: -65 },
        { time: "10:05", rainfall: 0, water_level: 0, soil_moisture: 0, x: 0, y: 0, z: 9.8, tilt: 0, rssi: -65 },
      ];
    }
    return [...sensorRecords].reverse().map((r, i) => {
      let tLabel = `#${r.id}`;
      if (r.created_at) {
        try {
          const d = new Date(r.created_at);
          tLabel = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        } catch {
          tLabel = `#${r.id}`;
        }
      }
      return {
        time: tLabel,
        rainfall: Number(r.rainfall ?? 0),
        water_level: Number(r.water_level ?? 0),
        soil_moisture: Number(r.soil_moisture ?? 0),
        x: Number(r.imu_x ?? 0),
        y: Number(r.imu_y ?? 0),
        z: Number(r.imu_z ?? 0) || (r.tilt ? Number(r.tilt) : 0),
        tilt: Number(r.tilt ?? 0),
        rssi: Number(r.rssi ?? 0),
      };
    });
  }, [sensorRecords]);

  // Reliable weather values
  const currentTemp = weather?.temperature != null ? `${weather.temperature.toFixed(1)}°C` : "27.5°C";
  const tempCondition = weather?.condition || "Partly Cloudy";
  const weatherHumidity = weather?.humidity != null ? `${weather.humidity}%` : "68%";
  const weatherRain = weather?.precipitation != null ? `${weather.precipitation} mm` : "0 mm";

  // Live IoT sensor values
  const liveSoilMoisture = latestSensor ? `${latestSensor.soil_moisture.toFixed(1)}%` : "0.0%";
  const liveWaterLevel = latestSensor ? `${latestSensor.water_level.toFixed(1)} m` : "0.0 m";
  const liveRainfall = latestSensor ? `${latestSensor.rainfall.toFixed(1)} mm/h` : "0.0 mm/h";
  const liveTilt = latestSensor
    ? `${latestSensor.imu_x?.toFixed(1) ?? 0}° | ${latestSensor.imu_y?.toFixed(1) ?? 0}° | ${latestSensor.imu_z?.toFixed(1) ?? 0}°`
    : "0° | 0° | 0°";
  const activeDevice = latestSensor?.device_id || "LORA_NODE_1";
  const statusTxt = latestSensor?.txt || "active";

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            Live Field & Environmental Telemetry
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live DB Synced
            </span>
          </h3>
          <p className="text-xs text-slate-500">
            Node: <code className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded">{activeDevice}</code> ·
            Status: <span className="font-semibold text-emerald-700 uppercase">{statusTxt}</span> ·
            Telemetry from PostgreSQL <code className="font-mono text-[11px] text-slate-600 bg-slate-100 px-1 py-0.5 rounded">sensor_data</code> & Weather via Open-Meteo API.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* Temperature Sensor (From Open-Meteo Weather API) */}
        <Card className="shadow-sm border-orange-200/80 bg-orange-50/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">Temperature (Weather API)</CardTitle>
            <Thermometer className="size-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900">{currentTemp}</div>
                <p className="text-xs text-slate-500">{tempCondition} · Humidity: {weatherHumidity}</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weather?.hourly || []}>
                  <Tooltip contentStyle={{ fontSize: "10px" }} />
                  <Line type="monotone" dataKey="temperature" name="Temp °C" stroke="#f97316" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Rain Sensor (From PostgreSQL sensor_data) */}
        <Card className="shadow-sm border-blue-200/80 bg-blue-50/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">Rainfall (Sensor)</CardTitle>
            <Droplets className="size-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900">{liveRainfall}</div>
                <p className="text-xs text-slate-500">Weather Rain: {weatherRain}</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <Tooltip contentStyle={{ fontSize: "10px" }} />
                  <Bar dataKey="rainfall" name="Rain mm/h" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Water Level (From PostgreSQL sensor_data) */}
        <Card className="shadow-sm border-amber-200/80 bg-amber-50/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">Water Level</CardTitle>
            <Waves className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900">{liveWaterLevel}</div>
                <p className="text-xs font-semibold text-amber-600">Threshold: &gt; 4.0m</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <Tooltip contentStyle={{ fontSize: "10px" }} />
                  <Area type="monotone" dataKey="water_level" name="Level (m)" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Soil Moisture (From PostgreSQL sensor_data) */}
        <Card className="shadow-sm border-emerald-200/80 bg-emerald-50/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">Soil Moisture</CardTitle>
            <Leaf className="size-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-slate-900">{liveSoilMoisture}</div>
                <p className="text-xs text-slate-500">Optimal: 35% - 60%</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <Tooltip contentStyle={{ fontSize: "10px" }} />
                  <Line type="monotone" dataKey="soil_moisture" name="Soil Moisture %" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Tilt / Inclinometer Sensor (From PostgreSQL sensor_data) */}
        <Card className="shadow-sm border-purple-200/80 bg-purple-50/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">Tilt & IMU (X|Y|Z)</CardTitle>
            <Activity className="size-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-lg font-bold text-slate-900 tracking-tight">{liveTilt}</div>
                <p className="text-xs text-slate-500">Tilt: {latestSensor?.tilt ?? 0}° · Status: {latestSensor?.txt || "Stable"}</p>
              </div>
            </div>
            <div className="mt-4 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <Tooltip contentStyle={{ fontSize: "10px" }} />
                  <Line type="monotone" dataKey="tilt" name="Tilt Angle °" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2.5, fill: "#f59e0b" }} />
                  <Line type="monotone" dataKey="x" stroke="#a855f7" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="y" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="z" stroke="#ec4899" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
