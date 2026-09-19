import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, BarChart3, Bell, Boxes, ChevronLeft, FileText, Gauge, LayoutDashboard,
  LogOut, Map, Menu, Search, Settings, ShieldAlert, ShieldCheck, User as UserIcon, Users, Radio,
  X, RefreshCw, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiGet, apiPost } from "@/lib/api";
import { useSession, useSessionActions } from "@/lib/session";
import { ROLE_LABELS, type Notification, type NetworkStats, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  allow: Role[];
}

const MAIN_NAV: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, allow: ["admin", "gov_officer", "field_officer", "viewer"] },
  { label: "GIS Monitoring", to: "/gis", icon: Map, allow: ["admin", "gov_officer", "field_officer", "viewer"] },
  { label: "Digital Twin", to: "/digital-twin", icon: Boxes, allow: ["admin", "gov_officer"] },
  { label: "SOS Alerts", to: "/sos-alerts", icon: ShieldAlert, allow: ["admin", "gov_officer", "field_officer", "viewer"] },
  { label: "AI Risk Assessment", to: "/risk", icon: Gauge, allow: ["admin", "gov_officer"] },
  { label: "Alerts", to: "/alerts", icon: AlertTriangle, allow: ["admin", "gov_officer", "field_officer"] },
  { label: "Analytics", to: "/analytics", icon: BarChart3, allow: ["admin", "gov_officer"] },
  { label: "Reports", to: "/reports", icon: FileText, allow: ["admin", "gov_officer", "field_officer", "viewer"] },
];

const ADMIN_NAV: NavItem[] = [
  { label: "Users", to: "/users", icon: Users, allow: ["admin"] },
  { label: "System Settings", to: "/settings", icon: Settings, allow: ["admin"] },
];

function SidebarLinks({ items, role, onNavigate, collapsed }: { items: NavItem[]; role: Role; onNavigate: () => void; collapsed: boolean }) {
  return (
    <>
      {items
        .filter((i) => i.allow.includes(role))
        .map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                isActive ? "bg-[#133E68] text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
              )
            }
            data-testid={`sidebar-link-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <item.icon className="size-4.5 shrink-0" />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </NavLink>
        ))}
    </>
  );
}

function NotificationMenu() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => apiGet<Notification[]>("/notifications"), retry: false });
  const list = data ?? [];
  const unread = list.filter((n) => !n.read).length;
  const readAll = useMutation({
    mutationFn: () => apiPost<{ message: string }>("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="relative" data-testid="notification-bell-btn" aria-label="Notifications">
            <Bell className="size-5" />
            {unread > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-red-600 font-mono text-[9px] font-bold text-white" data-testid="notification-unread-count">
                {unread}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-0" data-testid="notification-menu">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Notifications</p>
          <Button variant="ghost" size="xs" onClick={() => readAll.mutate()} data-testid="notifications-mark-read-btn">Mark all read</Button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {list.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-500" data-testid="notifications-empty">No notifications yet.</p>
          ) : (
            list.map((n) => (
              <div key={n.id} className={cn("border-b border-slate-50 px-4 py-3", !n.read && "bg-sky-50/50")} data-testid={`notification-item-${n.id}`}>
                <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">{n.kind.replace(/_/g, " ")}</p>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function AppLayout() {
  const { user } = useSession();
  const { endSession } = useSessionActions();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");

  // ─── 🚨 CROSS-TAB DISASTER ALERT NOTIFICATION ───
  const [crossTabAlert, setCrossTabAlert] = useState<any>(() => {
    try {
      const stored = localStorage.getItem("dt_live_disaster_alert");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [isCrossTabAlertDismissed, setIsCrossTabAlertDismissed] = useState(false);
  const [showDbAlertsModalInLayout, setShowDbAlertsModalInLayout] = useState(false);
  const [dbAlertsInLayout, setDbAlertsInLayout] = useState<any[]>([]);
  const [loadingDbAlertsInLayout, setLoadingDbAlertsInLayout] = useState(false);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "dt_live_disaster_alert") {
        if (e.newValue) {
          try {
            setCrossTabAlert(JSON.parse(e.newValue));
            setIsCrossTabAlertDismissed(false);
          } catch {}
        } else {
          setCrossTabAlert(null);
        }
      }
    };
    const handleCustom = (e: any) => {
      if (e.detail) {
        setCrossTabAlert(e.detail);
        setIsCrossTabAlertDismissed(false);
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("dt_disaster_alert", handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("dt_disaster_alert", handleCustom);
    };
  }, []);

  const fetchDbAlertsLayout = async () => {
    setLoadingDbAlertsInLayout(true);
    try {
      const res = await fetch("/api/external-sensors/alerts?limit=50");
      if (res.ok) {
        const data = await res.json();
        setDbAlertsInLayout(data || []);
      }
    } catch {}
    setLoadingDbAlertsInLayout(false);
  };

  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => apiGet<NetworkStats>("/stats"), retry: false });
  const role: Role = user?.role ?? "viewer";

  const crumbLabel =
    [...MAIN_NAV, ...ADMIN_NAV].find((i) => location.pathname.startsWith(i.to))?.label ??
    (location.pathname === "/profile" ? "Profile" : "Overview");

  const logout = async () => {
    await endSession();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-[#F7F9FC]">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-[#1E3A5F] bg-[#0B2545] transition-[width,transform] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          collapsed ? "lg:w-[76px]" : "lg:w-64",
          mobileOpen ? "w-64 translate-x-0" : "w-64 -translate-x-full",
        )}
        data-testid="app-sidebar"
      >
        <div className={cn("flex items-center border-b border-white/10 py-4", collapsed ? "flex-col gap-4 px-2" : "justify-between px-4")}>
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-white" data-testid="sidebar-logo">
              <ShieldCheck className="size-5" />
            </Link>
            {!collapsed ? (
              <span className="min-w-0 leading-none">
                <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-sky-300">Environmental</span>
                <span className="block truncate text-[12px] font-bold uppercase tracking-[0.12em] text-white">Intelligence</span>
              </span>
            ) : null}
          </div>
          
          <Button variant="ghost" size="icon-sm" className={cn("text-slate-300 hover:bg-white/5 hover:text-white shrink-0", collapsed && "mx-auto")} onClick={() => setCollapsed((v) => !v)} data-testid="sidebar-collapse-btn">
            <ChevronLeft className={cn("size-4 transition-transform duration-200", collapsed && "rotate-180")} />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" data-testid="sidebar-nav">
          <SidebarLinks items={MAIN_NAV} role={role} onNavigate={() => setMobileOpen(false)} collapsed={collapsed} />
          {role === "admin" ? (
            <>
              <p className={cn("mt-5 px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500", collapsed && "text-center")}>
                {collapsed ? "•••" : "Admin Section"}
              </p>
              <SidebarLinks items={ADMIN_NAV} role={role} onNavigate={() => setMobileOpen(false)} collapsed={collapsed} />
            </>
          ) : null}
        </nav>

        <div className="border-t border-white/10 px-3 py-3">
          {!collapsed ? (
            <div className="mb-2 rounded-lg bg-white/5 px-3 py-2" data-testid="sidebar-zone-counter">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">Operational zones</p>
              <p className="font-mono text-lg font-bold text-white">{stats?.monitoring_zones ?? "—"}</p>
            </div>
          ) : null}
        </div>
      </aside>

      {mobileOpen ? <button className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="sidebar-backdrop" /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-md sm:px-6" data-testid="app-header">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} data-testid="header-mobile-menu-btn" aria-label="Open navigation">
              <Menu className="size-5" />
            </Button>

            <nav className="hidden shrink-0 items-center gap-2 text-sm sm:flex" data-testid="header-breadcrumb">
              <Link to="/dashboard" className="text-slate-500 hover:text-[#0F4C81]">Platform</Link>
              <span className="text-slate-300">/</span>
              <span className="truncate font-semibold text-slate-900">{crumbLabel}</span>
            </nav>

            {/* Search owns the flexible middle column; the control cluster below is pushed
                right by ml-auto. Only one element in this row may claim ml-auto, otherwise
                the search box drifts against the hazard badge at some breakpoints. */}
            <div className="relative mx-4 hidden w-full max-w-sm flex-1 md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sensors, zones, alerts…"
                className="h-9 w-full pl-9"
                data-testid="header-search-input"
              />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2" data-testid="header-controls">
              <span className="hidden rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-amber-800 lg:inline" data-testid="header-hazard-level">
                NATIONAL HAZARD: {stats?.national_hazard_level ?? "—"}
              </span>

              <NotificationMenu />

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="sm" className="gap-2" data-testid="user-profile-menu-btn">
                      <span className="grid size-7 place-items-center rounded-full bg-[#0F4C81] font-mono text-[11px] font-bold text-white">
                        {(user?.first_name?.[0] ?? "?") + (user?.last_name?.[0] ?? "")}
                      </span>
                      <span className="hidden text-left leading-tight sm:block">
                        <span className="block text-xs font-semibold text-slate-900">{user ? `${user.first_name} ${user.last_name}` : "Officer"}</span>
                        <span className="block text-[10px] uppercase tracking-wider text-slate-500">{ROLE_LABELS[role]}</span>
                      </span>
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-56" data-testid="user-profile-menu">
                  <DropdownMenuItem onClick={() => navigate("/profile")} data-testid="menu-profile-link">
                    <UserIcon className="mr-2 size-4" /> My Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/settings")} data-testid="menu-settings-link">
                    <Settings className="mr-2 size-4" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={logout} data-testid="menu-logout-btn">
                    <LogOut className="mr-2 size-4" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Global Cross-Tab Disaster Alert Banner */}
        {crossTabAlert && !isCrossTabAlertDismissed && (
          <div
            data-testid="cross-tab-disaster-banner"
            className="border-b-2 border-red-500 bg-red-950 px-4 py-2.5 text-white shadow-lg flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 z-30"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-8 rounded-lg bg-red-600/30 border border-red-400 flex items-center justify-center shrink-0 animate-pulse">
                <AlertTriangle className="size-4 text-red-300" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-xs text-red-200 uppercase tracking-wider">
                    🚨 {crossTabAlert.title}
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white uppercase">
                    {crossTabAlert.severity || "CRITICAL"}
                  </span>
                  <span className="text-xs text-red-300 font-mono">
                    {crossTabAlert.timestamp}
                  </span>
                </div>
                <p className="text-xs text-red-100 font-medium truncate sm:whitespace-normal">
                  {crossTabAlert.message}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  fetchDbAlertsLayout();
                  setShowDbAlertsModalInLayout(true);
                }}
                className="bg-slate-900/80 hover:bg-slate-800 text-cyan-300 border-cyan-500/50 hover:text-white text-xs font-semibold cursor-pointer"
              >
                <span>DB Alerts</span>
              </Button>
              <button
                type="button"
                onClick={() => setIsCrossTabAlertDismissed(true)}
                className="size-7 rounded-lg bg-red-900/60 hover:bg-red-800 text-red-200 hover:text-white flex items-center justify-center transition-colors cursor-pointer border border-red-700/50"
                title="Dismiss Alert (X)"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      {/* 📋 DATABASE DISASTER ALERTS MODAL IN APPLAYOUT */}
      {showDbAlertsModalInLayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-red-500/60 rounded-2xl max-w-3xl w-full max-h-[85vh] shadow-2xl text-white flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-xl bg-red-950 border border-red-500/50 flex items-center justify-center text-red-400 shadow-sm">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-red-300">
                    Database Disaster Alerts Log (PostgreSQL)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Audit log of all flash flood & landslide alerts logged in database
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchDbAlertsLayout}
                  disabled={loadingDbAlertsInLayout}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  title="Refresh from Database"
                >
                  <RefreshCw className={`size-3.5 ${loadingDbAlertsInLayout ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setShowDbAlertsModalInLayout(false)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
                  title="Close"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {loadingDbAlertsInLayout ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
                  <Loader2 className="size-6 animate-spin text-red-400" />
                  <span className="text-xs">Fetching alerts from PostgreSQL...</span>
                </div>
              ) : dbAlertsInLayout.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  No disaster alerts recorded in the database yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                  {dbAlertsInLayout.map((alert: any) => (
                    <div key={alert.id} className="p-3.5 bg-slate-950/40 hover:bg-slate-950/70 transition-colors flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                              alert.disaster_type === "flash_flood"
                                ? "bg-blue-950 text-blue-300 border-blue-700"
                                : "bg-amber-950 text-amber-300 border-amber-700"
                            }`}
                          >
                            {alert.disaster_type === "flash_flood" ? "🌊 Flash Flood" : "⛰️ Landslide"}
                          </span>
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-900/60 text-red-200 border border-red-800">
                            {alert.alert_level || "CRITICAL"}
                          </span>
                          <span className="text-xs font-mono text-cyan-300 font-semibold">
                            Node: {alert.sensor_id}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {alert.triggered_at ? new Date(alert.triggered_at).toLocaleString() : "Recently"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-200 font-medium">
                        {alert.message}
                      </p>
                      <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400 pt-0.5">
                        <span>Zone: {alert.zone_name || "Basin Area"}</span>
                        <span>Soil Moisture: {alert.soil_moisture ?? 0}%</span>
                        <span>Water Level: {alert.water_level_mm ?? 0} mm</span>
                        <span>Tilt: {alert.tilt ?? 0}°</span>
                        <span>IMU: {alert.imu_mag ?? 0}g</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
              <span>Total records stored: <strong className="text-white font-mono">{dbAlertsInLayout.length}</strong></span>
              <button
                type="button"
                onClick={() => setShowDbAlertsModalInLayout(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
