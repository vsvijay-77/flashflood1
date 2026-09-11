import { Activity, Battery, Wifi, Cpu } from "lucide-react";
import { Card } from "@/components/ui/card";

export function NetworkOverviewKPIs() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-4">
      <KPICard
        title="Active Master Nodes"
        value="12"
        status="🟢 100% Uptime"
        icon={<Cpu className="size-5" />}
      />
      <KPICard
        title="Active Slave Nodes"
        value="128"
        status="🟢 Network Healthy"
        icon={<Activity className="size-5" />}
      />
      <KPICard
        title="LoRaWAN Status"
        value="Strong"
        status="📡 -85 dBm Avg"
        icon={<Wifi className="size-5 text-emerald-500" />}
      />
      <KPICard
        title="Network Battery"
        value="82%"
        status="🔋 12 Nodes <40%"
        icon={<Battery className="size-5" />}
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
