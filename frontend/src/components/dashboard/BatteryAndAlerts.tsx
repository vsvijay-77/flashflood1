import { AlertTriangle, Battery, BatteryCharging, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const MOCK_ALERTS = [
  { id: 1, severity: "Critical", node: "SN-004", sensor: "Temperature", location: "Forest Sector", time: "10 mins ago", title: "High Temperature Detected (45°C)" },
  { id: 2, severity: "Warning", node: "SN-002", sensor: "Accelerometer", location: "Bridge 42", time: "25 mins ago", title: "Abnormal Vibration Detected" },
  { id: 3, severity: "Warning", node: "SN-003", sensor: "Rain Drop", location: "Valley Base", time: "1 hour ago", title: "Heavy Rainfall Intensity" },
];

export function BatteryAndAlerts() {
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
                    <span className="font-mono text-xs font-bold">MN-DEL-01</span>
                    <BatteryCharging className="size-4 text-emerald-500" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">100%</div>
                  <div className="text-xs text-slate-500">AC Power Connected</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold">MN-MUM-02</span>
                    <Battery className="size-4 text-emerald-500" />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">95%</div>
                  <div className="text-xs text-slate-500">Solar Charging Active</div>
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

      {/* Active Alerts Panel */}
      <Card className="shadow-sm border-red-200">
        <CardHeader className="border-b border-red-100 pb-4 bg-red-50/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-red-500" />
            <CardTitle className="text-lg font-semibold text-slate-900">Active Network Alerts</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          <ul className="divide-y divide-slate-100">
            {MOCK_ALERTS.map((alert) => (
              <li key={alert.id} className="p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        alert.severity === 'Critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {alert.severity}
                      </span>
                      <span className="text-xs text-slate-500">{alert.time}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                      <span className="font-mono">{alert.node}</span>
                      <span>•</span>
                      <span>{alert.sensor}</span>
                      <span>•</span>
                      <span>{alert.location}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs">View</Button>
                    <Button size="sm" className="h-7 text-xs bg-slate-900">Ack</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
