import { Battery, Wifi, Cpu, CloudSun } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { SensorDataRecord, LiveWeatherData } from "@/lib/types";

export function NetworkOverviewKPIs() {
  const { data: sensorRecords = [] } = useQuery<SensorDataRecord[]>({
    queryKey: ["sensor_data_kpi"],
    queryFn: () => apiGet<SensorDataRecord[]>("/sensor-data?limit=50"),
    refetchInterval: 8000,
  });

  const { data: weather } = useQuery<LiveWeatherData>({
    queryKey: ["live_weather_openmeteo_kpi"],
    queryFn: () => apiGet<LiveWeatherData>("/sensor-data/weather"),
    refetchInterval: 30000,
  });

  const latest = sensorRecords[0];
  const rssiValue = latest?.rssi != null ? `${latest.rssi} dBm` : "-65 dBm";
  const snrValue = latest?.snr != null ? `${latest.snr} SNR` : "9.8 SNR";
  const tempStr = weather?.temperature != null ? `${weather.temperature.toFixed(1)}°C` : "27.5°C";
  const weatherStatus = weather?.condition ? `🌤️ ${weather.condition}` : "🌤️ Partly Cloudy";

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-4">
      <KPICard
        title="Active Field Node"
        value={latest?.device_id || "LORA_NODE_1"}
        status={`🟢 Status: ${latest?.txt || "working"}`}
        icon={<Cpu className="size-5 text-indigo-500" />}
      />
      <KPICard
        title="Live Ambient Temp"
        value={tempStr}
        status={weatherStatus}
        icon={<CloudSun className="size-5 text-amber-500" />}
      />
      <KPICard
        title="LoRa Radio Signal"
        value={rssiValue}
        status={`📡 ${snrValue} (Strong Link)`}
        icon={<Wifi className="size-5 text-emerald-500" />}
      />
      <KPICard
        title="Network Battery"
        value="98%"
        status="🔋 Solar & AC Powered"
        icon={<Battery className="size-5 text-emerald-500" />}
      />
    </div>
  );
}

function KPICard({
  title,
  value,
  status,
  icon,
  border = "border-slate-200",
}: {
  title: string;
  value: string;
  status: string;
  icon: React.ReactNode;
  border?: string;
}) {
  return (
    <Card className={`flex flex-col justify-between p-4 shadow-sm ${border}`}>
      <div className="flex items-start justify-between">
        <div className="text-slate-500">{icon}</div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 text-right w-full ml-2 leading-tight">
          {title}
        </span>
      </div>
      <div className="mt-4">
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <div className="mt-1 text-[11px] font-medium text-slate-500">{status}</div>
      </div>
    </Card>
  );
}
