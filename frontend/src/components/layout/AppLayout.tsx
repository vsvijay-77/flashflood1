import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, BarChart3, Bell, Boxes, ChevronLeft, FileText, Gauge, LayoutDashboard,
  LogOut, Map, Menu, Search, Settings, ShieldCheck, User as UserIcon, Users, Radio,
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
  { label: "Environmental Data", to: "/environmental", icon: Activity, allow: ["admin", "gov_officer", "field_officer"] },
  { label: "AI Risk Assessment", to: "/risk", icon: Gauge, allow: ["admin", "gov_officer"] },
  { label: "Alerts", to: "/alerts", icon: AlertTriangle, allow: ["admin", "gov_officer", "field_officer"] },
  { label: "Analytics", to: "/analytics", icon: BarChart3, allow: ["admin", "gov_officer"] },
  { label: "Reports", to: "/reports", icon: FileText, allow: ["admin", "gov_officer", "field_officer", "viewer"] },
];

const ADMIN_NAV: NavItem[] = [
  { label: "Sensor Management", to: "/sensors", icon: Radio, allow: ["admin"] },
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

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
