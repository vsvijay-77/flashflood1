import { AlertTriangle, Battery, BatteryCharging, Phone, MapPin, User, CheckCircle, Clock, ShieldAlert, RefreshCw, Map, Radio } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiGet, apiPatch } from "@/lib/api";
import { toast } from "sonner";
import type { SensorDataRecord } from "@/lib/types";

export interface MobileSosRequest {
  id: string;
  user_id?: string;
  full_name?: string;
  phone_number?: string;
  language?: string;
  location_name?: string;
  latitude?: number;
  longitude?: number;
  location_accuracy_m?: number;
  location_captured_at?: string;
  emergency_type?: string;
  description?: string;
  status: string;
  created_at: string;
  location_source?: string;
}

export function BatteryAndAlerts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: sosAlerts = [], isLoading, isRefetching, refetch } = useQuery<MobileSosRequest[]>({
    queryKey: ["sos_alerts"],
    queryFn: () => apiGet<MobileSosRequest[]>("/alerts/sos"),
    refetchInterval: 10000, // auto-refresh every 10 seconds for real-time SOS monitoring
  });

  const { data: sensorRecords = [] } = useQuery<SensorDataRecord[]>({
    queryKey: ["sensor_data_battery"],
    queryFn: () => apiGet<SensorDataRecord[]>("/sensor-data?limit=10"),
    refetchInterval: 8000,
  });

  const latestNode = sensorRecords[0];

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiPatch(`/alerts/sos/${id}/status`, { status }),
    onSuccess: (_, variables) => {
      toast.success(`SOS request status updated to ${variables.status}`);
      queryClient.invalidateQueries({ queryKey: ["sos_alerts"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update SOS status");
    },
  });

  const handleMoveToMap = (sos: MobileSosRequest) => {
    const lat = sos.latitude != null ? Number(sos.latitude) : 10.66;
    const lng = sos.longitude != null ? Number(sos.longitude) : 77.00;
    const title = `${sos.emergency_type || "EMERGENCY"} — ${sos.full_name || "Citizen"}`;
    const subtitle = sos.location_name ? `Location: ${sos.location_name} · Phone: ${sos.phone_number || "N/A"}` : `Phone: ${sos.phone_number || "N/A"}`;

    toast.info(`Centering map on ${sos.full_name || "citizen"}'s distress location…`);
    navigate("/gis", {
      state: {
        focusCoordinates: [lat, lng],
        focusTitle: title,
        focusSubtitle: subtitle,
      },
    });
  };

  const activeSosCount = sosAlerts.filter((s) => (s.status || "").toUpperCase() !== "RESOLVED").length;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Battery Status Panel */}
      <Card className="shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <Battery className="size-5 text-slate-700" />
            <CardTitle className="text-lg font-semibold text-slate-900">Network Battery Health</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-6 h-full">
            {/* Master Node Battery (Left) */}
            <div className="flex flex-col">
              <h4 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wider">Master Nodes Battery</h4>
              <div className="flex flex-col gap-4 flex-1">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Radio className="size-3.5 text-sky-600" />
                      {latestNode?.device_id || "LORA_NODE_1"}
                    </span>
                    <BatteryCharging className="size-4 text-emerald-500" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">98%</div>
                  <div className="text-xs text-slate-500">
                    Signal: {latestNode?.rssi ?? -65} dBm · {latestNode?.txt || "Active"}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold">MN-GATEWAY-01</span>
                    <Battery className="size-4 text-emerald-500" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">100%</div>
                  <div className="text-xs text-slate-500">AC + Solar Buffer</div>
                </div>
              </div>
            </div>

            {/* Slave Node Health (Right) */}
            <div className="flex flex-col">
              <h4 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wider">Slave Node Health</h4>
              <div className="space-y-4 flex-1 flex flex-col justify-center">
                <div className="flex items-center gap-3">
                  <div className="w-16 text-xs font-medium text-emerald-600">Healthy</div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: "85%" }}></div>
                  </div>
                  <div className="w-12 text-right text-xs font-medium text-slate-600">85%</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-16 text-xs font-medium text-amber-500">Moderate</div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500" style={{ width: "10%" }}></div>
                  </div>
                  <div className="w-12 text-right text-xs font-medium text-slate-600">10%</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-16 text-xs font-medium text-red-500">Low</div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-red-500" style={{ width: "5%" }}></div>
                  </div>
                  <div className="w-12 text-right text-xs font-medium text-slate-600">5%</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile SOS Alerts Panel (From Supabase mob_sos_requests) */}
      <Card className="shadow-sm border-red-200">
        <CardHeader className="border-b border-red-100 pb-4 bg-red-50/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-red-600 animate-pulse" />
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg font-bold text-slate-900">Mobile SOS Alerts</CardTitle>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white">
                  {activeSosCount} Active
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="h-8 px-2 text-slate-500 hover:text-slate-800"
              title="Refresh SOS Alerts"
            >
              <RefreshCw className={`size-3.5 ${isRefetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-slate-500">
              <span className="inline-block size-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin mr-2" />
              Loading emergency requests...
            </div>
          ) : sosAlerts.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle className="size-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-800">No Active SOS Requests</p>
              <p className="text-xs text-slate-500 mt-0.5">All mobile emergency calls are currently clear or resolved.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
              {sosAlerts.map((sos) => {
                const statusUpper = (sos.status || "RECEIVED").toUpperCase();
                const isResolved = statusUpper === "RESOLVED";
                const isAck = statusUpper === "ACKNOWLEDGED" || statusUpper === "IN_PROGRESS";

                return (
                  <li
                    key={sos.id}
                    className={`p-4 transition-colors ${
                      isResolved
                        ? "bg-slate-50/50 opacity-70"
                        : "hover:bg-red-50/40 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                              isResolved
                                ? "bg-slate-200 text-slate-700"
                                : isAck
                                ? "bg-amber-100 text-amber-800 border border-amber-200"
                                : "bg-red-100 text-red-700 border border-red-200 animate-pulse"
                            }`}
                          >
                            {sos.emergency_type || "EMERGENCY"}
                          </span>

                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              isResolved
                                ? "bg-emerald-100 text-emerald-700"
                                : isAck
                                ? "bg-blue-100 text-blue-700"
                                : "bg-rose-100 text-rose-700 font-bold"
                            }`}
                          >
                            {statusUpper}
                          </span>

                          <span className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Clock className="size-3" />
                            {sos.created_at ? new Date(sos.created_at).toLocaleString() : "Just now"}
                          </span>
                        </div>

                        {/* Caller Info */}
                        <div className="flex items-center gap-3 text-sm text-slate-800 font-medium mt-1">
                          <span className="flex items-center gap-1.5 font-bold text-slate-900">
                            <User className="size-3.5 text-slate-500" />
                            {sos.full_name || "Anonymous Caller"}
                          </span>
                          {sos.phone_number && (
                            <a
                              href={`tel:${sos.phone_number}`}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:underline font-mono"
                            >
                              <Phone className="size-3" />
                              {sos.phone_number}
                            </a>
                          )}
                        </div>

                        {/* Location */}
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                          <button
                            type="button"
                            onClick={() => handleMoveToMap(sos)}
                            className="flex items-center gap-1 text-xs text-left group hover:text-[#0F4C81] cursor-pointer"
                            title="Click to view on GIS Map"
                          >
                            <MapPin className="size-3 text-red-500 shrink-0 group-hover:scale-125 transition-transform" />
                            <span className="truncate group-hover:underline font-semibold text-slate-800 group-hover:text-[#0F4C81]">
                              {sos.location_name || (sos.latitude ? `${sos.latitude.toFixed(4)}, ${sos.longitude?.toFixed(4)}` : "Location provided")}
                            </span>
                            {sos.location_accuracy_m && (
                              <span className="text-[10px] text-slate-400 font-normal">
                                (±{Math.round(sos.location_accuracy_m)}m)
                              </span>
                            )}
                          </button>
                        </div>

                        {/* Description */}
                        {sos.description && (
                          <p className="mt-1.5 text-xs text-slate-600 italic line-clamp-2 bg-slate-50 rounded px-2 py-1 border border-slate-100">
                            "{sos.description}"
                          </p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-sky-300 text-sky-800 hover:bg-sky-50 gap-1"
                          onClick={() => handleMoveToMap(sos)}
                          title="Locate distress on GIS Map"
                        >
                          <Map className="size-3 text-sky-600" />
                          Map
                        </Button>

                        {!isResolved && (
                          <>
                            {statusUpper !== "ACKNOWLEDGED" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
                                disabled={updateStatusMutation.isPending}
                                onClick={() =>
                                  updateStatusMutation.mutate({ id: sos.id, status: "ACKNOWLEDGED" })
                                }
                              >
                                Ack
                              </Button>
                            )}
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={updateStatusMutation.isPending}
                              onClick={() =>
                                updateStatusMutation.mutate({ id: sos.id, status: "RESOLVED" })
                              }
                            >
                              Resolve
                            </Button>
                          </>
                        )}
                        {isResolved && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[11px] text-slate-400 hover:text-slate-700"
                            disabled={updateStatusMutation.isPending}
                            onClick={() =>
                              updateStatusMutation.mutate({ id: sos.id, status: "RECEIVED" })
                            }
                          >
                            Reopen
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

