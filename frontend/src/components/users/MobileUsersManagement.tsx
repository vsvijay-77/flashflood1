import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Smartphone,
  Phone,
  MessageSquare,
  AlertTriangle,
  Send,
  MapPin,
  ShieldAlert,
  Search,
  Copy,
  Users,
  BellRing,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EmptyState, LoadingRows } from "@/components/Primitives";
import { apiGet, apiPost } from "@/lib/api";
import { toast } from "sonner";
import type { MobileUser } from "@/lib/types";

export function MobileUsersManagement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  // Dialog states
  const [alertTargetUser, setAlertTargetUser] = useState<MobileUser | null>(null);
  const [isBroadcastAlert, setIsBroadcastAlert] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);

  const [callTargetUser, setCallTargetUser] = useState<MobileUser | null>(null);
  const [isCallOpen, setIsCallOpen] = useState(false);

  const [messageTargetUser, setMessageTargetUser] = useState<MobileUser | null>(null);
  const [isMessageOpen, setIsMessageOpen] = useState(false);

  // Form states for Alert
  const [alertType, setAlertType] = useState("FLASH_FLOOD_WARNING");
  const [severity, setSeverity] = useState("CRITICAL");
  const [alertTitle, setAlertTitle] = useState("CRITICAL FLASH FLOOD WARNING");
  const [alertMessage, setAlertMessage] = useState(
    "Urgent: Rapid water level rise detected near your sector. Move to designated high ground immediately."
  );
  const [sendSms, setSendSms] = useState(true);
  const [sendPush, setSendPush] = useState(true);

  // Form state for Message
  const [customMessage, setCustomMessage] = useState(
    "NDMA Advisory: Heavy rainfall detected in your sector. Please confirm if you and your family are safe."
  );

  // 1. Fetch mobile users from backend (/api/users/mobile)
  const {
    data: mobileUsers = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<MobileUser[]>({
    queryKey: ["mobile_users"],
    queryFn: () => apiGet<MobileUser[]>("/users/mobile"),
    refetchInterval: 12000,
  });

  // Filtered users
  const filteredUsers = useMemo(() => {
    if (!search.trim()) return mobileUsers;
    const q = search.toLowerCase();
    return mobileUsers.filter(
      (u) =>
        (u.full_name || "").toLowerCase().includes(q) ||
        (u.phone_number || "").toLowerCase().includes(q) ||
        (u.location_name || "").toLowerCase().includes(q)
    );
  }, [mobileUsers, search]);

  // Mutations
  const sendAlertMutation = useMutation({
    mutationFn: (payload: {
      user_id?: string | null;
      phone_number?: string | null;
      alert_type: string;
      severity: string;
      title: string;
      message: string;
      channels: string[];
    }) => apiPost<{ status: string; message: string }>("/users/mobile/send-alert", payload),
    onSuccess: (data) => {
      toast.success(data.message || "Emergency alert dispatched successfully!");
      setIsAlertOpen(false);
      queryClient.invalidateQueries({ queryKey: ["mobile_users"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to dispatch alert.");
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (payload: { user_id?: string; phone_number: string; message: string }) =>
      apiPost<{ status: string; message: string }>("/users/mobile/send-message", payload),
    onSuccess: (data) => {
      toast.success(data.message || "SMS message dispatched!");
      setIsMessageOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to send message.");
    },
  });

  // Handlers
  const handleOpenSendAlert = (user?: MobileUser) => {
    if (user) {
      setAlertTargetUser(user);
      setIsBroadcastAlert(false);
      setAlertTitle(`FLASH FLOOD WARNING — ${user.location_name || "Immediate Zone"}`);
      setAlertMessage(
        `Dear ${user.full_name}, critical runoff and rising waters detected near your area (${user.location_name || "sector"}). Please evacuate to higher ground immediately or contact emergency rescue.`
      );
    } else {
      setAlertTargetUser(null);
      setIsBroadcastAlert(true);
      setAlertTitle("ALL-SECTOR FLASH FLOOD EMERGENCY WARNING");
      setAlertMessage(
        "EMERGENCY BROADCAST: Flash flood alert active for monitored river basins. Low-lying areas must evacuate immediately. Dial emergency services if in distress."
      );
    }
    setIsAlertOpen(true);
  };

  const handleOpenCall = (user: MobileUser) => {
    setCallTargetUser(user);
    setIsCallOpen(true);
  };

  const handleOpenMessage = (user: MobileUser) => {
    setMessageTargetUser(user);
    setCustomMessage(
      `NDMA SAFETY CHECK for ${user.full_name}: Heavy rainfall active in your area (${user.location_name || "monitored zone"}). Please reply with \x27SAFE\x27 or call rescue if you need assistance.`
    );
    setIsMessageOpen(true);
  };

  const handleDispatchAlert = () => {
    const channels: string[] = [];
    if (sendSms) channels.push("sms");
    if (sendPush) channels.push("push");

    sendAlertMutation.mutate({
      user_id: isBroadcastAlert ? "all" : alertTargetUser?.id,
      phone_number: isBroadcastAlert ? null : alertTargetUser?.phone_number,
      alert_type: alertType,
      severity,
      title: alertTitle,
      message: alertMessage,
      channels: channels.length > 0 ? channels : ["sms"],
    });
  };

  const handleDispatchMessage = () => {
    if (!messageTargetUser?.phone_number) return;
    sendMessageMutation.mutate({
      user_id: messageTargetUser.id,
      phone_number: messageTargetUser.phone_number,
      message: customMessage,
    });
  };

  const handleInitiateCall = (phone: string, name: string) => {
    toast.info(`Dialing ${name} (${phone})…`);
    window.location.href = `tel:${phone}`;
  };

  const handleViewOnMap = (u: MobileUser) => {
    const lat = u.latitude != null ? Number(u.latitude) : 10.667;
    const lng = u.longitude != null ? Number(u.longitude) : 77.016;
    toast.info(`Centering GIS Digital Twin on ${u.full_name}\x27s location…`);
    navigate("/gis", {
      state: {
        focusCoordinates: [lat, lng],
        focusTitle: `Citizen: ${u.full_name} (${u.phone_number})`,
        focusSubtitle: u.location_name ? `Location: ${u.location_name}` : "Mobile Device GPS Fix",
      },
    });
  };

  // Preset message templates
  const applyAlertTemplate = (type: string) => {
    setAlertType(type);
    if (type === "FLASH_FLOOD_WARNING") {
      setSeverity("CRITICAL");
      setAlertTitle("CRITICAL FLASH FLOOD WARNING");
      setAlertMessage(
        "Urgent: Severe water rise detected near your sector. Move to designated high ground immediately."
      );
    } else if (type === "EVACUATION_ORDER") {
      setSeverity("CRITICAL");
      setAlertTitle("MANDATORY EVACUATION ORDER");
      setAlertMessage(
        "Immediate Evacuation: Floodwaters entering residential low-zones. Proceed along safe evacuation routes now."
      );
    } else if (type === "HEAVY_RAIN") {
      setSeverity("HIGH");
      setAlertTitle("EXTREME RAINFALL ADVISORY");
      setAlertMessage(
        "Severe rainfall exceeding 50mm/hr expected. Avoid river crossings, drainage channels, and basements."
      );
    } else if (type === "SAFE_ALL_CLEAR") {
      setSeverity("INFO");
      setAlertTitle("WEATHER ADVISORY — ALL CLEAR");
      setAlertMessage(
        "Water levels have returned to normal stages. Exercise caution when returning to affected structures."
      );
    }
  };

  const gpsLocatedCount = mobileUsers.filter((u) => u.latitude != null && u.longitude != null).length;

  return (
    <div className="space-y-6">
      {/* KPI Cards & Broadcast Header */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 shadow-sm border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Registered Mobile Citizens
            </span>
            <Smartphone className="size-5 text-indigo-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{mobileUsers.length}</div>
          <div className="text-xs text-slate-500 mt-1">Direct citizen mobile app users</div>
        </Card>

        <Card className="p-4 shadow-sm border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active GPS Locations
            </span>
            <MapPin className="size-5 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{gpsLocatedCount}</div>
          <div className="text-xs text-slate-500 mt-1">Precise live coordinates available</div>
        </Card>

        <Card className="p-4 shadow-sm border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Critical Alerts Enabled
            </span>
            <BellRing className="size-5 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {mobileUsers.filter((u) => u.preferences?.notificationPreferences?.criticalAlerts !== false).length}
          </div>
          <div className="text-xs text-slate-500 mt-1">Subscribed to push & SMS alerts</div>
        </Card>

        <Card className="p-4 shadow-sm border-rose-200 bg-rose-50/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Emergency Broadcast
            </span>
            <ShieldAlert className="size-5 text-rose-600" />
          </div>
          <div className="mt-2">
            <Button
              size="sm"
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-sm flex items-center justify-center gap-1.5"
              onClick={() => handleOpenSendAlert()}
            >
              <AlertTriangle className="size-3.5" />
              Broadcast Alert to All ({mobileUsers.length})
            </Button>
          </div>
        </Card>
      </div>

      {/* Main List Card */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="border-b border-slate-100 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Users className="size-5 text-indigo-600" />
                Mobile Citizen Users
                <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {filteredUsers.length} active
                </span>
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                Registered citizen devices receiving automated flood warnings and emergency response dispatch.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search name, phone, area…"
                  className="pl-8 h-8 text-xs w-full"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs text-slate-600 gap-1"
                onClick={() => refetch()}
                disabled={isRefetching}
              >
                <RefreshCw className={`size-3.5 ${isRefetching ? "animate-spin text-indigo-600" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6">
              <LoadingRows rows={3} />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8">
              <EmptyState
                testId="mobile-users-empty"
                title="No mobile users found"
                description={search ? "Try adjusting your search query." : "No citizen devices currently registered in Supabase mob_users."}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead className="font-semibold text-slate-700">Citizen User</TableHead>
                    <TableHead className="font-semibold text-slate-700">Phone & Contact</TableHead>
                    <TableHead className="font-semibold text-slate-700">Location</TableHead>
                    <TableHead className="font-semibold text-slate-700">Preferences</TableHead>
                    <TableHead className="font-semibold text-slate-700 text-right pr-6">
                      Options & Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => {
                    const hasCoordinates = u.latitude != null && u.longitude != null;
                    const initial = (u.full_name || "C").charAt(0).toUpperCase();

                    return (
                      <TableRow key={u.id} className="hover:bg-slate-50/80 transition-colors">
                        {/* Citizen info */}
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="size-9 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-sm shadow-xs border border-indigo-200">
                              {initial}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
                                {u.full_name || "Anonymous Citizen"}
                                {u.language && (
                                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                    {u.language}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                ID: {u.id.slice(0, 8)}…
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        {/* Phone */}
                        <TableCell>
                          <div className="font-mono text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                            <Phone className="size-3.5 text-emerald-600" />
                            {u.phone_number || "N/A"}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Registered: {new Date(u.created_at).toLocaleDateString()}
                          </div>
                        </TableCell>

                        {/* Location */}
                        <TableCell>
                          <div className="max-w-[240px]">
                            <div className="text-xs font-medium text-slate-800 flex items-center gap-1">
                              <MapPin className="size-3.5 text-rose-500 shrink-0" />
                              <span className="truncate">{u.location_name || "Location not provided"}</span>
                            </div>
                            {hasCoordinates ? (
                              <div className="mt-1 flex items-center gap-2">
                                <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {Number(u.latitude).toFixed(4)}°, {Number(u.longitude).toFixed(4)}°
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleViewOnMap(u)}
                                  className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                                >
                                  Map <ExternalLink className="size-2.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400">No GPS Fix</span>
                            )}
                          </div>
                        </TableCell>

                        {/* Preferences */}
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[180px]">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              ⚡ Flood Alerts
                            </span>
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              📱 SMS Fallback
                            </span>
                          </div>
                        </TableCell>

                        {/* Actions: Send Alert, Call, Message */}
                        <TableCell className="text-right pr-6">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {/* 1. Send Alert Option */}
                            <Button
                              variant="outline"
                              size="xs"
                              className="border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800 font-semibold gap-1 text-[11px] h-7 px-2 cursor-pointer"
                              onClick={() => handleOpenSendAlert(u)}
                            >
                              <AlertTriangle className="size-3 text-rose-600" />
                              Send Alert
                            </Button>

                            {/* 2. Call Option */}
                            <Button
                              variant="outline"
                              size="xs"
                              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 font-semibold gap-1 text-[11px] h-7 px-2 cursor-pointer"
                              onClick={() => handleOpenCall(u)}
                            >
                              <Phone className="size-3 text-emerald-600" />
                              Call
                            </Button>

                            {/* 3. Message Option */}
                            <Button
                              variant="outline"
                              size="xs"
                              className="border-sky-300 text-sky-700 hover:bg-sky-50 hover:text-sky-800 font-semibold gap-1 text-[11px] h-7 px-2 cursor-pointer"
                              onClick={() => handleOpenMessage(u)}
                            >
                              <MessageSquare className="size-3 text-sky-600" />
                              Message
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ======================= DIALOG: SEND EMERGENCY ALERT ======================= */}
      <Dialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <DialogContent className="max-w-lg bg-white p-6 rounded-xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="size-5 text-rose-600" />
              {isBroadcastAlert ? "Broadcast Alert to All Mobile Citizens" : `Send Alert to ${alertTargetUser?.full_name}`}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {isBroadcastAlert
                ? `This emergency alert will be dispatched simultaneously to all ${mobileUsers.length} registered citizen devices.`
                : `Target: ${alertTargetUser?.phone_number} · Location: ${alertTargetUser?.location_name || "General Area"}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Template Presets */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">Quick Alert Templates</label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={alertType === "FLASH_FLOOD_WARNING" ? "default" : "outline"}
                  size="xs"
                  className={`text-xs justify-start h-8 cursor-pointer ${alertType === "FLASH_FLOOD_WARNING" ? "bg-rose-600 text-white" : ""}`}
                  onClick={() => applyAlertTemplate("FLASH_FLOOD_WARNING")}
                >
                  🌊 Flash Flood Warning
                </Button>
                <Button
                  type="button"
                  variant={alertType === "EVACUATION_ORDER" ? "default" : "outline"}
                  size="xs"
                  className={`text-xs justify-start h-8 cursor-pointer ${alertType === "EVACUATION_ORDER" ? "bg-amber-600 text-white" : ""}`}
                  onClick={() => applyAlertTemplate("EVACUATION_ORDER")}
                >
                  🚨 Evacuation Order
                </Button>
                <Button
                  type="button"
                  variant={alertType === "HEAVY_RAIN" ? "default" : "outline"}
                  size="xs"
                  className={`text-xs justify-start h-8 cursor-pointer ${alertType === "HEAVY_RAIN" ? "bg-sky-600 text-white" : ""}`}
                  onClick={() => applyAlertTemplate("HEAVY_RAIN")}
                >
                  🌧️ Extreme Rainfall
                </Button>
                <Button
                  type="button"
                  variant={alertType === "SAFE_ALL_CLEAR" ? "default" : "outline"}
                  size="xs"
                  className={`text-xs justify-start h-8 cursor-pointer ${alertType === "SAFE_ALL_CLEAR" ? "bg-emerald-600 text-white" : ""}`}
                  onClick={() => applyAlertTemplate("SAFE_ALL_CLEAR")}
                >
                  🟢 Safe All-Clear
                </Button>
              </div>
            </div>

            {/* Severity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Severity Level</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="w-full rounded-md border border-slate-300 text-xs px-2.5 py-1.5 bg-white font-medium focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="CRITICAL">🚨 CRITICAL (Immediate Danger)</option>
                  <option value="HIGH">⚠️ HIGH (Prepare to Act)</option>
                  <option value="MEDIUM">🔶 MEDIUM (Advisory)</option>
                  <option value="INFO">ℹ️ INFO (Informational)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Delivery Channels</label>
                <div className="flex items-center gap-3 pt-1.5">
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendSms}
                      onChange={(e) => setSendSms(e.target.checked)}
                      className="rounded text-indigo-600"
                    />
                    SMS Gateway
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendPush}
                      onChange={(e) => setSendPush(e.target.checked)}
                      className="rounded text-indigo-600"
                    />
                    Push Notification
                  </label>
                </div>
              </div>
            </div>

            {/* Alert Title */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Alert Headline / Title</label>
              <Input
                value={alertTitle}
                onChange={(e) => setAlertTitle(e.target.value)}
                placeholder="Alert Headline"
                className="text-xs font-semibold"
              />
            </div>

            {/* Alert Message */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Alert Message Body
              </label>
              <Textarea
                rows={3}
                value={alertMessage}
                onChange={(e) => setAlertMessage(e.target.value)}
                placeholder="Type emergency alert body…"
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAlertOpen(false)}
              disabled={sendAlertMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold gap-1.5 cursor-pointer"
              onClick={handleDispatchAlert}
              disabled={sendAlertMutation.isPending || !alertTitle.trim() || !alertMessage.trim()}
            >
              <Send className="size-3.5" />
              {sendAlertMutation.isPending ? "Dispatching Alert…" : "Dispatch Alert Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================= DIALOG: CALL CITIZEN ======================= */}
      <Dialog open={isCallOpen} onOpenChange={setIsCallOpen}>
        <DialogContent className="max-w-md bg-white p-6 rounded-xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Phone className="size-5 text-emerald-600" />
              Emergency Call: {callTargetUser?.full_name}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Direct telephone contact with citizen device for immediate crisis verification.
            </DialogDescription>
          </DialogHeader>

          {callTargetUser && (
            <div className="space-y-4 py-3">
              <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-4 text-center">
                <div className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
                  Citizen Phone Number
                </div>
                <div className="font-mono text-2xl font-bold text-emerald-950 mt-1">
                  {callTargetUser.phone_number}
                </div>
                <div className="text-xs text-emerald-700 mt-1 font-medium">
                  {callTargetUser.full_name} · {callTargetUser.location_name || "Monitored Zone"}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
                <div className="font-semibold text-slate-800">Field Dispatch Protocol:</div>
                <p>1. Identify yourself as an Environmental Safety / NDMA Officer.</p>
                <p>2. Inquire if water levels are entering the dwelling or roadways.</p>
                <p>3. Guide citizen to the nearest elevated shelter or dispatch NDRF.</p>
              </div>
            </div>
          )}

          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (callTargetUser?.phone_number) {
                  navigator.clipboard.writeText(callTargetUser.phone_number);
                  toast.success("Phone number copied to clipboard!");
                }
              }}
              className="gap-1.5 text-xs cursor-pointer"
            >
              <Copy className="size-3.5" />
              Copy Number
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 text-xs cursor-pointer"
              onClick={() => {
                if (callTargetUser?.phone_number) {
                  handleInitiateCall(callTargetUser.phone_number, callTargetUser.full_name);
                  setIsCallOpen(false);
                }
              }}
            >
              <Phone className="size-3.5" />
              Call Now ({callTargetUser?.phone_number})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================= DIALOG: SEND MESSAGE / SMS ======================= */}
      <Dialog open={isMessageOpen} onOpenChange={setIsMessageOpen}>
        <DialogContent className="max-w-lg bg-white p-6 rounded-xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="size-5 text-sky-600" />
              Send Direct Message to {messageTargetUser?.full_name}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Recipient: {messageTargetUser?.phone_number} ({messageTargetUser?.full_name})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Quick Templates */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">Preset Quick Messages</label>
              <div className="space-y-1.5">
                <button
                  type="button"
                  className="w-full text-left text-xs p-2 rounded-md border border-slate-200 hover:bg-slate-50 transition cursor-pointer text-slate-700"
                  onClick={() =>
                    setCustomMessage(
                      `🚨 FLASH FLOOD ALERT for ${messageTargetUser?.full_name}: Water levels rising rapidly near your sector. Please evacuate to designated shelter immediately.`
                    )
                  }
                >
                  <span className="font-semibold block text-rose-700">🚨 Immediate Flood Evacuation</span>
                  Water levels rising rapidly near your sector. Evacuate immediately.
                </button>

                <button
                  type="button"
                  className="w-full text-left text-xs p-2 rounded-md border border-slate-200 hover:bg-slate-50 transition cursor-pointer text-slate-700"
                  onClick={() =>
                    setCustomMessage(
                      `🛡️ NDMA SAFETY STATUS CHECK: Extreme rainfall in ${messageTargetUser?.location_name || "your area"}. Please reply \x27SAFE\x27 or call 112 if in distress.`
                    )
                  }
                >
                  <span className="font-semibold block text-indigo-700">🛡️ Safety Status Verification</span>
                  Extreme rainfall in your area. Reply \x27SAFE\x27 or call 112.
                </button>

                <button
                  type="button"
                  className="w-full text-left text-xs p-2 rounded-md border border-slate-200 hover:bg-slate-50 transition cursor-pointer text-slate-700"
                  onClick={() =>
                    setCustomMessage(
                      `🚑 RESCUE DISPATCH: National Disaster Response Force (NDRF) rescue boat has been dispatched to coordinates near ${messageTargetUser?.location_name || "your location"}. Stay in a visible high place.`
                    )
                  }
                >
                  <span className="font-semibold block text-emerald-700">🚑 NDRF Rescue Dispatched</span>
                  Rescue boat has been dispatched to your coordinates. Stay visible.
                </button>
              </div>
            </div>

            {/* Custom Message */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Message Text</label>
              <Textarea
                rows={4}
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Type SMS text message…"
                className="text-xs font-sans"
              />
              <div className="flex justify-between items-center mt-1 text-[11px] text-slate-400">
                <span>Direct SMS gateway dispatch</span>
                <span>{customMessage.length} characters</span>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs cursor-pointer"
              onClick={() => {
                if (messageTargetUser?.phone_number) {
                  window.location.href = `sms:${messageTargetUser.phone_number}?body=${encodeURIComponent(customMessage)}`;
                }
              }}
            >
              Open in Native SMS App
            </Button>
            <Button
              size="sm"
              className="bg-sky-600 hover:bg-sky-700 text-white font-semibold gap-1.5 text-xs cursor-pointer"
              onClick={handleDispatchMessage}
              disabled={sendMessageMutation.isPending || !customMessage.trim()}
            >
              <Send className="size-3.5" />
              {sendMessageMutation.isPending ? "Sending SMS…" : "Send SMS"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
