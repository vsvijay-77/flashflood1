import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import {
  CloudRain,
  Waves,
  Droplets,
  Thermometer,
  Compass,
  Radio,
  Activity,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Clock,
  Layers,
  Trash2,
  AlertTriangle,
  X,
  Check,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface LoRaTransmissionRecord {
  id: number;
  packet_id: number;
  device_id: string;
  rain_sensor: number;
  water_level: number;
  soil_moisture: number;
  temperature: number;
  humidity: number;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  tilt_x: number;
  tilt_y: number;
  flood_status: string;
  lora_status: string;
  raw_payload?: Record<string, any>;
  created_at: string;
}

export function LiveLoRaTelemetrySection() {
  const queryClient = useQueryClient();
  const [pulseCount, setPulseCount] = useState(0);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Poll every 1 second (1000ms) from Supabase table `lora_transmissions`
  const { data: transmissions = [], isFetching } = useQuery<LoRaTransmissionRecord[]>({
    queryKey: ["lora-transmissions-live-1s"],
    queryFn: async () => {
      // 1. Try fetching directly from Supabase
      try {
        const { data, error } = await supabase
          .from("lora_transmissions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20);
        if (!error && data && data.length > 0) {
          return data as LoRaTransmissionRecord[];
        }
      } catch (err) {
        console.warn("Supabase client fetch warning:", err);
      }

      // 2. Fallback to backend API
      try {
        const res = await apiGet<{ transmissions: LoRaTransmissionRecord[] }>("/lora/transmissions?limit=20");
        return res?.transmissions || [];
      } catch {
        return [];
      }
    },
    refetchInterval: 1000, // 1-second live polling interval
    refetchIntervalInBackground: true,
    staleTime: 500,
  });

  // Total count in database
  const { data: totalDbCount = 0 } = useQuery<number>({
    queryKey: ["lora-total-db-count"],
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from("lora_transmissions")
          .select("*", { count: "exact", head: true });
        if (!error && count != null) return count;
      } catch {}
      return transmissions.length;
    },
    refetchInterval: 3000,
  });

  // Supabase Realtime channel for sub-second push updates
  useEffect(() => {
    try {
      const channel = supabase
        .channel("lora_live_stream")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "lora_transmissions" },
          () => {
            setPulseCount((c) => c + 1);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } catch {
      // ignore if realtime ws blocked
    }
  }, []);

  const latest = transmissions[0];
  const isFloodNormal = (latest?.flood_status || "NORMAL").toUpperCase() === "NORMAL";

  const timeFormatted = latest?.created_at
    ? new Date(latest.created_at).toLocaleTimeString()
    : "Syncing...";

  // Handler to delete past 100 records from Supabase
  const handleDeletePast100 = async (mode: "oldest" | "latest" = "oldest") => {
    setIsDeleting(true);
    try {
      let deletedCount = 0;

      // 1. Try via backend endpoint
      try {
        const res = await apiPost<{ deleted_count?: number }>(
          `/lora/transmissions/delete-past?count=100&mode=${mode}`,
          {}
        );
        deletedCount = res?.deleted_count ?? 0;
      } catch {
        // 2. Fallback direct client Supabase deletion
        const { data: records, error: fetchErr } = await supabase
          .from("lora_transmissions")
          .select("id")
          .order("created_at", { ascending: mode === "oldest" })
          .limit(100);

        if (!fetchErr && records && records.length > 0) {
          const ids = records.map((r: any) => r.id);
          const { error: delErr } = await supabase
            .from("lora_transmissions")
            .delete()
            .in("id", ids);

          if (!delErr) {
            deletedCount = ids.length;
          }
        }
      }

      toast.success(
        deletedCount > 0
          ? `Deleted past ${deletedCount} records from Supabase database!`
          : "Database table is clean (no records to delete)."
      );

      // Instantly refresh all live queries
      queryClient.invalidateQueries({ queryKey: ["lora-transmissions-live-1s"] });
      queryClient.invalidateQueries({ queryKey: ["lora-total-db-count"] });
      queryClient.invalidateQueries({ queryKey: ["lora-live-sensor-data-1s"] });
      queryClient.invalidateQueries({ queryKey: ["lora-accel-history-1s"] });
      setShowDeleteModal(false);
    } catch (err: any) {
      toast.error(`Failed to delete data: ${err?.message || "Unknown error"}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="live-lora-telemetry-section">
      {/* Confirmation Modal for Deleting Past 100 Data */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-rose-50 border-b border-rose-100 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-rose-100 text-rose-700 rounded-lg">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-rose-950">Confirm Database Record Deletion</h4>
                  <p className="text-[11px] text-rose-700">Database table: public.lora_transmissions</p>
                </div>
              </div>
              <button
                onClick={() => !isDeleting && setShowDeleteModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
                disabled={isDeleting}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                This will delete up to <strong>100 past records</strong> from your database.
                Current database count: <strong>{totalDbCount} records</strong>.
              </p>

              <div className="space-y-2 pt-1">
                <Button
                  variant="destructive"
                  className="w-full text-xs font-bold justify-center h-9 cursor-pointer"
                  disabled={isDeleting}
                  onClick={() => handleDeletePast100("oldest")}
                  data-testid="confirm-delete-oldest-100-btn"
                >
                  <Trash2 className="size-3.5 mr-2" />
                  {isDeleting ? "Deleting..." : "Delete Oldest 100 Records (Recommended)"}
                </Button>

                <Button
                  variant="outline"
                  className="w-full text-xs text-rose-700 border-rose-200 hover:bg-rose-50 justify-center h-9 cursor-pointer"
                  disabled={isDeleting}
                  onClick={() => handleDeletePast100("latest")}
                  data-testid="confirm-delete-latest-100-btn"
                >
                  <Trash2 className="size-3.5 mr-2" />
                  {isDeleting ? "Deleting..." : "Delete Most Recent 100 Records"}
                </Button>

                <Button
                  variant="ghost"
                  className="w-full text-xs text-slate-500 h-8 cursor-pointer"
                  disabled={isDeleting}
                  onClick={() => setShowDeleteModal(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header with Live 1s Badge and Delete Past 100 Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-slate-900 via-[#0B2545] to-slate-900 border border-slate-800 rounded-xl p-4 text-white shadow-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="relative flex size-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full size-3 bg-emerald-500"></span>
            </span>
            <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Radio className="size-5 text-cyan-400 animate-pulse" />
              LoRa Field Telemetry Station
            </h3>
            <span className="rounded-full bg-emerald-500/20 border border-emerald-400/30 px-2 py-0.5 text-[11px] font-mono font-bold text-emerald-300">
              LIVE 1s REFRESH
            </span>
          </div>
          <p className="text-xs text-slate-300">
            Real-time LoRa SX1278 packet stream received via Raspberry Pi 5 &amp; Arduino Mega.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <div className="bg-white/10 px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-1.5">
            <Clock className="size-3.5 text-cyan-300" />
            <span className="text-slate-300">Packet:</span>
            <strong className="text-white">#{latest?.packet_id ?? "—"}</strong>
          </div>
          <div className="bg-white/10 px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-1.5">
            <RefreshCw className={`size-3.5 text-emerald-400 ${isFetching ? "animate-spin" : ""}`} />
            <span className="text-slate-300">Last:</span>
            <strong className="text-emerald-300">{timeFormatted}</strong>
          </div>
          <div className="bg-white/10 px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-1.5">
            <Layers className="size-3.5 text-sky-300" />
            <span className="text-slate-300">Total in DB:</span>
            <strong className="text-sky-300">{totalDbCount}</strong>
          </div>

          {/* Delete Past 100 Data Button in Header */}
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setShowDeleteModal(true)}
            data-testid="header-delete-past-100-btn"
            className="h-8 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs cursor-pointer px-3"
          >
            <Trash2 className="size-3.5 mr-1" />
            Delete Past 100 Data
          </Button>
        </div>
      </div>

      {/* 12 Key Sensor Readings Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* 1. Rain Sensor */}
        <Card className="border-slate-200 shadow-xs hover:border-blue-300 transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Rain Sensor</span>
              <CloudRain className="size-4 text-blue-500" />
            </div>
            <div className="text-xl font-bold font-mono text-slate-900">
              {latest?.rain_sensor ?? "685"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Raw Sensor Value</span>
          </CardContent>
        </Card>

        {/* 2. Water Level */}
        <Card className="border-slate-200 shadow-xs hover:border-cyan-300 transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Water Level</span>
              <Waves className="size-4 text-cyan-600" />
            </div>
            <div className="text-xl font-bold font-mono text-cyan-700">
              {latest?.water_level ?? "1"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Stage Level Marker</span>
          </CardContent>
        </Card>

        {/* 3. Soil Moisture */}
        <Card className="border-slate-200 shadow-xs hover:border-emerald-300 transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Soil Moisture</span>
              <Droplets className="size-4 text-emerald-600" />
            </div>
            <div className="text-xl font-bold font-mono text-emerald-700">
              {latest?.soil_moisture ?? "94"}%
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Saturation Level</span>
          </CardContent>
        </Card>

        {/* 4. Temperature */}
        <Card className="border-slate-200 shadow-xs hover:border-amber-300 transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Temperature</span>
              <Thermometer className="size-4 text-amber-500" />
            </div>
            <div className="text-xl font-bold font-mono text-amber-600">
              {latest?.temperature != null ? `${latest.temperature.toFixed(1)}°C` : "27.8°C"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Ambient Ambient</span>
          </CardContent>
        </Card>

        {/* 5. Humidity */}
        <Card className="border-slate-200 shadow-xs hover:border-sky-300 transition-colors">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Humidity</span>
              <Droplets className="size-4 text-sky-500" />
            </div>
            <div className="text-xl font-bold font-mono text-sky-700">
              {latest?.humidity != null ? `${latest.humidity.toFixed(1)}%` : "56.1%"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Relative Humidity</span>
          </CardContent>
        </Card>

        {/* 6. Flood Status */}
        <Card className={`border shadow-xs ${isFloodNormal ? "bg-emerald-50/50 border-emerald-200" : "bg-rose-50/50 border-rose-300"}`}>
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Flood Status</span>
              {isFloodNormal ? <ShieldCheck className="size-4 text-emerald-600" /> : <ShieldAlert className="size-4 text-rose-600" />}
            </div>
            <div className={`text-base font-bold font-mono ${isFloodNormal ? "text-emerald-700" : "text-rose-700 font-extrabold"}`}>
              {latest?.flood_status ?? "NORMAL"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Hazard Risk State</span>
          </CardContent>
        </Card>

        {/* 7. Acceleration X */}
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Acceleration X</span>
              <Activity className="size-4 text-indigo-500" />
            </div>
            <div className="text-lg font-bold font-mono text-indigo-900">
              {latest?.accel_x != null ? `${latest.accel_x.toFixed(2)}` : "9.81"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">m/s² (X-axis)</span>
          </CardContent>
        </Card>

        {/* 8. Acceleration Y */}
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Acceleration Y</span>
              <Activity className="size-4 text-indigo-500" />
            </div>
            <div className="text-lg font-bold font-mono text-indigo-900">
              {latest?.accel_y != null ? `${latest.accel_y.toFixed(2)}` : "0.90"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">m/s² (Y-axis)</span>
          </CardContent>
        </Card>

        {/* 9. Acceleration Z */}
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Acceleration Z</span>
              <Activity className="size-4 text-indigo-500" />
            </div>
            <div className="text-lg font-bold font-mono text-indigo-900">
              {latest?.accel_z != null ? `${latest.accel_z.toFixed(2)}` : "0.66"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">m/s² (Z-axis)</span>
          </CardContent>
        </Card>

        {/* 10. Tilt X */}
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Tilt X</span>
              <Compass className="size-4 text-purple-500" />
            </div>
            <div className="text-lg font-bold font-mono text-purple-900">
              {latest?.tilt_x != null ? `${latest.tilt_x.toFixed(2)}°` : "5.23°"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Roll Inclination</span>
          </CardContent>
        </Card>

        {/* 11. Tilt Y */}
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">Tilt Y</span>
              <Compass className="size-4 text-purple-500" />
            </div>
            <div className="text-lg font-bold font-mono text-purple-900">
              {latest?.tilt_y != null ? `${latest.tilt_y.toFixed(2)}°` : "-86.17°"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Pitch Inclination</span>
          </CardContent>
        </Card>

        {/* 12. LoRa Status */}
        <Card className="border-emerald-200 bg-emerald-50/40 shadow-xs">
          <CardContent className="p-3.5">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-medium">LoRa Link</span>
              <Radio className="size-4 text-emerald-600" />
            </div>
            <div className="text-base font-bold font-mono text-emerald-800 flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              {latest?.lora_status ?? "READY"}
            </div>
            <span className="text-[10px] text-slate-500 font-mono">SX1278 433MHz</span>
          </CardContent>
        </Card>
      </div>

      {/* Live LoRa Transmission History Table with Delete Past 100 Action */}
      <Card className="border-slate-200 shadow-sm overflow-hidden" data-testid="lora-transmissions-table-card">
        <CardHeader className="bg-slate-50/80 px-4 py-3 border-b border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers className="size-4 text-slate-600" />
                Live LoRa Transmissions Table (Supabase DB Stream)
              </CardTitle>
              <p className="text-[11px] text-slate-500">
                Incoming sensor packets recorded by Raspberry Pi 5 receiver with real-time updates every 1s.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded bg-slate-200 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                Auto-refresh: 1s
              </span>

              {/* Delete Past 100 Button */}
              <Button
                size="xs"
                variant="outline"
                onClick={() => setShowDeleteModal(true)}
                data-testid="table-delete-past-100-btn"
                className="h-7 text-xs border-rose-300 text-rose-700 hover:bg-rose-50 cursor-pointer font-semibold"
              >
                <Trash2 className="size-3 mr-1 text-rose-600" />
                Delete Past 100 Data
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-100/70 text-[11px]">
                <TableHead className="font-bold">Packet ID</TableHead>
                <TableHead className="font-bold">Timestamp</TableHead>
                <TableHead className="font-bold">Rain Sensor</TableHead>
                <TableHead className="font-bold">Water Level</TableHead>
                <TableHead className="font-bold">Soil Moisture</TableHead>
                <TableHead className="font-bold">Temp (°C)</TableHead>
                <TableHead className="font-bold">Humidity (%)</TableHead>
                <TableHead className="font-bold">Accel [X, Y, Z]</TableHead>
                <TableHead className="font-bold">Tilt [X, Y]</TableHead>
                <TableHead className="font-bold">Flood Status</TableHead>
                <TableHead className="font-bold text-right">LoRa Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transmissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-8 text-xs text-slate-500 italic">
                    Waiting for incoming LoRa transmissions from field node...
                  </TableCell>
                </TableRow>
              ) : (
                transmissions.map((t, idx) => {
                  const isNormal = (t.flood_status || "NORMAL").toUpperCase() === "NORMAL";
                  return (
                    <TableRow
                      key={t.id || idx}
                      className={idx === 0 ? "bg-cyan-50/50 font-medium transition-colors" : "hover:bg-slate-50"}
                    >
                      <TableCell className="font-mono text-xs font-bold text-slate-900">
                        #{t.packet_id}
                        {idx === 0 && (
                          <span className="ml-1.5 inline-block text-[9px] font-bold text-cyan-700 bg-cyan-100 px-1 rounded">
                            LATEST
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 font-mono whitespace-nowrap">
                        {t.created_at ? new Date(t.created_at).toLocaleTimeString() : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-blue-700 font-semibold">
                        {t.rain_sensor}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-cyan-800 font-semibold">
                        {t.water_level}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-emerald-700 font-semibold">
                        {t.soil_moisture}%
                      </TableCell>
                      <TableCell className="font-mono text-xs text-amber-700">
                        {t.temperature?.toFixed(1) ?? "—"}°C
                      </TableCell>
                      <TableCell className="font-mono text-xs text-sky-700">
                        {t.humidity?.toFixed(1) ?? "—"}%
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        [{t.accel_x?.toFixed(2)}, {t.accel_y?.toFixed(2)}, {t.accel_z?.toFixed(2)}]
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        [{t.tilt_x?.toFixed(1)}°, {t.tilt_y?.toFixed(1)}°]
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            isNormal ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800 animate-pulse"
                          }`}
                        >
                          {t.flood_status || "NORMAL"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-700 font-semibold">
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                          {t.lora_status || "READY"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
