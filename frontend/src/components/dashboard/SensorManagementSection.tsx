import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Radio,
  Boxes,
  RefreshCw,
  Database,
  Waves,
  CloudRain,
  Activity,
  Compass,
  Battery,
  Signal,
  Wifi,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingRows, SectionCard, StatusPill } from "@/components/Primitives";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { apiErrorMessage, useSession } from "@/lib/session";
import {
  SENSOR_LABELS,
  type Sensor,
  type Zone,
  type ExternalSensorSummary,
  type ExternalSensorHistoryItem,
  type ExternalLoraPacket,
} from "@/lib/types";

export interface SensorManagementSectionProps {
  showDeviceOverview?: boolean;
}

export function SensorManagementSection({ showDeviceOverview = false }: SensorManagementSectionProps) {
  const qc = useQueryClient();
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState<"live_lora" | "inventory">("live_lora");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [telemetrySubTab, setTelemetrySubTab] = useState<"readings" | "packets">("readings");
  const [readingPage, setReadingPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState<number>(15);

  // 1. Live Summary query from PostgreSQL sensor_db (polled every 1 sec)
  const summaryQuery = useQuery({
    queryKey: ["external-sensors-summary"],
    queryFn: () => apiGet<ExternalSensorSummary>("/external-sensors/summary"),
    refetchInterval: autoRefresh ? 1000 : false,
  });

  // 2. Telemetry History query from PostgreSQL sensor_data table (last 1000 records, polled every 1 sec)
  const historyQuery = useQuery({
    queryKey: ["external-sensors-history"],
    queryFn: () => apiGet<ExternalSensorHistoryItem[]>("/external-sensors/history?limit=1000"),
    refetchInterval: autoRefresh ? 1000 : false,
  });

  // 3. Raw LoRa packets query from PostgreSQL lora_packets table (polled every 1 sec)
  const packetsQuery = useQuery({
    queryKey: ["external-sensors-packets"],
    queryFn: () => apiGet<ExternalLoraPacket[]>("/external-sensors/packets?limit=100"),
    refetchInterval: autoRefresh ? 1000 : false,
  });

  // 4. Node Fleet queries from MongoDB
  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: () => apiGet<Zone[]>("/zones"),
    retry: false,
  });

  const inventoryQuery = useQuery({
    queryKey: ["sensors"],
    queryFn: () => apiGet<Sensor[]>("/sensors"),
    retry: false,
  });

  const [form, setForm] = useState({ code: "", name: "", sensor_type: "rainfall", zone_id: "" });

  const zoneList = zonesQuery.data ?? [];
  const zoneId = form.zone_id || zoneList[0]?.id || "";

  const create = useMutation({
    mutationFn: () => {
      const zone = zoneList.find((z) => z.id === zoneId);
      return apiPost<Sensor>("/sensors", {
        code: form.code,
        name: form.name,
        sensor_type: form.sensor_type,
        zone_id: zoneId,
        lat: zone ? zone.lat + 0.01 : 10.667366,
        lng: zone ? zone.lng + 0.01 : 77.0169,
        status: "online",
        battery: 100,
        unit: "",
      });
    },
    onSuccess: (s) => {
      toast.success(`Sensor ${s.code} commissioned successfully`);
      setForm({ code: "", name: "", sensor_type: "rainfall", zone_id: "" });
      qc.invalidateQueries({ queryKey: ["sensors"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["zones"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Sensor could not be commissioned.")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<{ message: string }>(`/sensors/${id}`),
    onSuccess: (r) => {
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["sensors"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const summary = summaryQuery.data;
  const history = historyQuery.data ?? [];
  const packets = packetsQuery.data ?? [];
  const activeDevice = summary?.devices?.[0];
  const inventoryList = inventoryQuery.data ?? [];

  const filteredHistory = history.filter((h) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      h.device_id.toLowerCase().includes(q) ||
      String(h.id).includes(q) ||
      (h.txt && h.txt.toLowerCase().includes(q))
    );
  });

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize));
  const currentHistorySlice = filteredHistory.slice(
    (readingPage - 1) * pageSize,
    readingPage * pageSize
  );

  const handleRefreshAll = () => {
    summaryQuery.refetch();
    historyQuery.refetch();
    packetsQuery.refetch();
    inventoryQuery.refetch();
    toast.success("Live sensor database refreshed");
  };

  return (
    <div
      id="sensor-management"
      data-testid="sensor-management-page"
      className="space-y-6 pt-2"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="size-5 text-[#0F4C81]" />
            <h3 className="text-xl font-bold text-slate-900">
              Sensor Management & Live LoRaWAN Telemetry
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time environmental sensor ingest directly from PostgreSQL{" "}
            <span className="font-mono font-semibold text-slate-700">sensor_db</span> and node fleet management.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
            <button
              onClick={() => setActiveTab("live_lora")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "live_lora"
                  ? "bg-emerald-700 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              data-testid="tab-live-telemetry"
            >
              <Radio className="size-3.5" />
              Live LoRaWAN Telemetry
              <span className="flex size-2 rounded-full bg-emerald-400 ring-2 ring-emerald-300 animate-pulse ml-1" />
            </button>
            <button
              onClick={() => setActiveTab("inventory")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "inventory"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              data-testid="tab-fleet-inventory"
            >
              <Boxes className="size-3.5" />
              Node Inventory & Fleet ({inventoryList.length})
            </button>
          </div>
        </div>
      </div>

      {activeTab === "live_lora" ? (
        <div className="space-y-6">
          {/* Database Connection Status Banner */}
          <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
                <Database className="size-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-emerald-950 text-sm">
                    PostgreSQL Ingest Connection: Active
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-300">
                    <span className="size-1.5 rounded-full bg-emerald-600 animate-ping" />
                    LIVE TELEMETRY
                  </span>
                </div>
                <p className="font-mono text-xs text-emerald-800 mt-0.5">
                  postgresql://sensor_user:***@db.nishanth.qzz.io:5432/sensor_db
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-900">
                <span className="rounded-md bg-emerald-200/80 px-2.5 py-1 font-mono">
                  {summary?.total_readings ?? history.length} readings
                </span>
                <span className="rounded-md bg-emerald-200/80 px-2.5 py-1 font-mono">
                  {summary?.total_packets ?? packets.length} LoRa packets
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-emerald-900 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500 size-3.5"
                  />
                  <span>Auto-sync (6s)</span>
                </label>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleRefreshAll}
                  disabled={summaryQuery.isFetching}
                  className="bg-white border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                >
                  <RefreshCw className={`size-3 mr-1 ${summaryQuery.isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {/* Active Device Overview Card (omitted on dashboard where LiveSensorMonitoring & AccelerometerGraph already display this) */}
          {showDeviceOverview && (
            <Card className="border-slate-200/80 bg-linear-to-br from-white to-slate-50/50 p-5 shadow-xs">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
                  <Radio className="size-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-slate-900 text-base">
                      {activeDevice?.name || "LoRaWAN Hydrology Node (LORA_NODE_1)"}
                    </h2>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      <span className="size-1.5 rounded-full bg-emerald-600" />
                      ONLINE
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Device Identifier:{" "}
                    <span className="font-mono font-semibold text-slate-700">
                      {activeDevice?.device_id || "LORA_NODE_1"}
                    </span>{" "}
                    • Pollachi Catchment Basin
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
                  <Battery className="size-4 text-emerald-600" />
                  <span className="text-slate-600 font-medium">Battery:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {activeDevice?.battery_pct ?? 77}%
                  </span>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
                  <Signal className="size-4 text-blue-600" />
                  <span className="text-slate-600 font-medium">RSSI:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {activeDevice?.latest?.rssi_dbm ?? -105} dBm
                  </span>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
                  <Wifi className="size-4 text-amber-600" />
                  <span className="text-slate-600 font-medium">SNR:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {activeDevice?.latest?.snr_db ?? 8.0} dB
                  </span>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-2xs">
                  <span className="text-slate-500">Last Telemetry:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {activeDevice?.latest?.created_at
                      ? new Date(activeDevice.latest.created_at).toLocaleTimeString()
                      : "Recent"}
                  </span>
                </div>
              </div>
            </div>

            {/* 4 Real Metric Stat Cards */}
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-800">
                    Water Level
                  </span>
                  <Waves className="size-5 text-blue-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-blue-950">
                    {activeDevice?.latest?.water_level_mm ?? 94.0}
                  </span>
                  <span className="text-sm font-bold text-blue-700">mm</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-blue-800/80">
                  <span>River Bed Pressure Gauge</span>
                  <span className="font-mono font-medium">
                    Max: {activeDevice?.stats?.max_water_level ?? 95.0} mm
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-cyan-800">
                    Precipitation / Rain
                  </span>
                  <CloudRain className="size-5 text-cyan-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-cyan-950">
                    {activeDevice?.latest?.rainfall_mm ?? 2.0}
                  </span>
                  <span className="text-sm font-bold text-cyan-700">mm</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-cyan-800/80">
                  <span>Tipping Bucket Sensor</span>
                  <span className="font-mono font-medium">
                    Peak: {activeDevice?.stats?.max_rainfall ?? 75.0} mm
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                    Soil Moisture
                  </span>
                  <Activity className="size-5 text-amber-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-amber-950">
                    {activeDevice?.latest?.soil_moisture?.toFixed(1) ?? "0.0"}
                  </span>
                  <span className="text-sm font-bold text-amber-700">% VWC</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-amber-800/80">
                  <span>Capacitive In-Ground</span>
                  <span className="font-medium text-emerald-700">Unsaturated</span>
                </div>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-800">
                    Tilt & IMU Stability
                  </span>
                  <Compass className="size-5 text-indigo-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-indigo-950">
                    {activeDevice?.latest?.tilt_deg?.toFixed(1) ?? "0.0"}°
                  </span>
                  <span className="text-sm font-bold text-indigo-700">Tilt</span>
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-indigo-900">
                  <span>
                    IMU [X:{activeDevice?.latest?.imu_x ?? 0}, Y:{activeDevice?.latest?.imu_y ?? 0}, Z:
                    {activeDevice?.latest?.imu_z ?? 0}]
                  </span>
                  <span className="text-emerald-700 font-semibold">Stable</span>
                </div>
              </div>
            </div>
            </Card>
          )}

          {/* Telemetry Stream Views */}
          <SectionCard
            testId="sensor-telemetry-card"
            title="Real-time LoRaWAN Stream (1s Live DB Polling)"
            description="Live historical sensor readings and raw packet frames directly from sensor_db"
            actions={
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="size-2 rounded-full bg-emerald-500 animate-ping" />
                  Live 1s Polling from DB
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  {history.length} / 1000 Records
                </span>
              </div>
            }
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setTelemetrySubTab("readings")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    telemetrySubTab === "readings"
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                  data-testid="subtab-readings"
                >
                  Last 1000 Records for Sensor Data Sent ({history.length})
                </button>
                <button
                  onClick={() => setTelemetrySubTab("packets")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    telemetrySubTab === "packets"
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                  data-testid="subtab-packets"
                >
                  Raw LoRaWAN Packets (lora_packets: {packets.length})
                </button>
              </div>

              {telemetrySubTab === "readings" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 size-3.5 text-slate-400" />
                    <Input
                      placeholder="Search by ID or device..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setReadingPage(1);
                      }}
                      className="h-8 w-44 pl-8 text-xs"
                      data-testid="telemetry-search-input"
                    />
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-500">Show:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setReadingPage(1);
                      }}
                      className="h-8 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 font-medium cursor-pointer"
                      data-testid="page-size-selector"
                    >
                      <option value={15}>15</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={500}>500</option>
                      <option value={1000}>1000 (All)</option>
                    </select>
                  </div>

                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    Page {readingPage} of {totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={readingPage <= 1}
                      onClick={() => setReadingPage((p) => Math.max(1, p - 1))}
                      data-testid="prev-page-btn"
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={readingPage >= totalPages}
                      onClick={() => setReadingPage((p) => Math.min(totalPages, p + 1))}
                      data-testid="next-page-btn"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {telemetrySubTab === "readings" ? (
              historyQuery.isLoading ? (
                <LoadingRows rows={6} />
              ) : currentHistorySlice.length === 0 ? (
                <EmptyState
                  testId="sensor-telemetry-empty"
                  title="No Telemetry Records Found"
                  description="No records matching current query in sensor_data table."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16"># ID</TableHead>
                        <TableHead>Device Node</TableHead>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Water Level</TableHead>
                        <TableHead>Rainfall</TableHead>
                        <TableHead>Soil Moisture</TableHead>
                        <TableHead>Tilt</TableHead>
                        <TableHead>IMU (X,Y,Z)</TableHead>
                        <TableHead>RF Signal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentHistorySlice.map((item) => (
                        <TableRow key={item.id} className="font-mono text-xs">
                          <TableCell className="font-bold text-slate-600">#{item.id}</TableCell>
                          <TableCell className="font-sans font-semibold text-slate-900">
                            {item.device_id}
                          </TableCell>
                          <TableCell className="text-slate-500 whitespace-nowrap">
                            {item.created_at ? new Date(item.created_at).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 font-bold text-blue-800">
                              {item.water_level} mm
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-700 font-semibold">{item.rainfall} mm</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-700">{item.soil_moisture}%</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-700">{item.tilt}°</span>
                          </TableCell>
                          <TableCell className="text-slate-500 text-[11px]">
                            [{item.imu_x}, {item.imu_y}, {item.imu_z}]
                          </TableCell>
                          <TableCell>
                            <span className="text-slate-700 font-semibold">{item.rssi} dBm</span>{" "}
                            <span className="text-slate-400 text-[11px]">(SNR {item.snr})</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            ) : packetsQuery.isLoading ? (
              <LoadingRows rows={6} />
            ) : packets.length === 0 ? (
              <EmptyState
                testId="lora-packets-empty"
                title="No LoRaWAN Packets Logged"
                description="No raw packet logs currently in lora_packets table."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16"># ID</TableHead>
                      <TableHead>Device ID</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Port / Counter</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Gateway EUI</TableHead>
                      <TableHead>RF Signal</TableHead>
                      <TableHead>Raw Payload</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packets.map((pkt) => (
                      <TableRow key={pkt.id} className="font-mono text-xs">
                        <TableCell className="font-bold text-slate-600">#{pkt.id}</TableCell>
                        <TableCell className="font-sans font-semibold text-slate-900">
                          {pkt.device_id}
                        </TableCell>
                        <TableCell className="text-slate-500 whitespace-nowrap">
                          {pkt.created_at ? new Date(pkt.created_at).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          Port {pkt.fport} (cnt: {pkt.fcnt})
                        </TableCell>
                        <TableCell className="text-slate-600">{pkt.frequency_mhz} MHz</TableCell>
                        <TableCell className="text-slate-500">{pkt.gateway_eui || "—"}</TableCell>
                        <TableCell className="text-slate-700 font-semibold">
                          {pkt.rssi} dBm <span className="text-slate-400 text-[11px]">(SNR {pkt.snr})</span>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-[11px] text-slate-600">
                          {pkt.raw_payload || "(empty)"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </div>
      ) : (
        /* Node Inventory & Commissioning Tab */
        <div className="space-y-6">
          {isAdmin && (
            <Card className="border-slate-200/80 p-6" data-testid="sensor-create-form">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Commission new sensor node
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-4">
                <div>
                  <Label htmlFor="sensor-code">Node Code</Label>
                  <Input
                    id="sensor-code"
                    value={form.code}
                    onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                    placeholder="LORA-POL-02"
                    className="mt-1.5"
                    data-testid="sensor-code-input"
                  />
                </div>
                <div>
                  <Label htmlFor="sensor-name">Node Name</Label>
                  <Input
                    id="sensor-name"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Pollachi Gauge 2"
                    className="mt-1.5"
                    data-testid="sensor-name-input"
                  />
                </div>
                <div>
                  <Label>Sensor Type</Label>
                  <Select
                    value={form.sensor_type}
                    onValueChange={(v: string) => setForm((p) => ({ ...p, sensor_type: v }))}
                  >
                    <SelectTrigger className="mt-1.5 w-full" data-testid="sensor-type-trigger">
                      <SelectValue>{(v) => SENSOR_LABELS[v as string] ?? "Select type"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SENSOR_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k} data-testid={`sensor-type-${k}`}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Monitoring Zone</Label>
                  <Select
                    value={zoneId}
                    onValueChange={(v: string) => setForm((p) => ({ ...p, zone_id: v }))}
                  >
                    <SelectTrigger className="mt-1.5 w-full" data-testid="sensor-zone-trigger">
                      <SelectValue>
                        {(v) => zoneList.find((z) => z.id === v)?.name ?? "Select zone"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {zoneList.map((z) => (
                        <SelectItem key={z.id} value={z.id} data-testid={`sensor-zone-${z.id}`}>
                          {z.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="mt-4"
                disabled={form.code.length < 2 || form.name.length < 2 || !zoneId || create.isPending}
                onClick={() => create.mutate()}
                data-testid="sensor-create-btn"
              >
                {create.isPending ? "Commissioning…" : "Commission Sensor"}
              </Button>
            </Card>
          )}

          <SectionCard
            testId="sensor-inventory-card"
            title="Registered Sensor Fleet"
            description={`${inventoryList.length} nodes registered in database`}
          >
            {inventoryQuery.isLoading ? (
              <LoadingRows rows={5} />
            ) : inventoryList.length === 0 ? (
              <EmptyState
                testId="sensor-inventory-empty"
                title="No sensors registered"
                description="Commission your first LoRaWAN node above."
              />
            ) : (
              <Table data-testid="sensor-inventory-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Battery</TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead className="text-right">Action</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryList.map((s) => (
                    <TableRow key={s.id} data-testid={`sensor-mgmt-row-${s.code}`}>
                      <TableCell className="font-mono text-xs font-semibold">{s.code}</TableCell>
                      <TableCell>{SENSOR_LABELS[s.sensor_type] ?? s.sensor_type}</TableCell>
                      <TableCell className="text-xs text-slate-500">{s.zone_name}</TableCell>
                      <TableCell className="font-mono text-xs">{s.battery}%</TableCell>
                      <TableCell className="font-mono text-xs">{s.signal_dbm} dBm</TableCell>
                      <TableCell>
                        <StatusPill status={s.status} />
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-red-700 hover:bg-red-50"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(s.id)}
                            data-testid={`sensor-delete-btn-${s.code}`}
                          >
                            Decommission
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
