import { useState } from "react";
import { Server, Activity, Battery, Wifi, Cpu, MemoryStick, Clock, Search, Filter } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const MOCK_MASTER_NODES = [
  { id: "MN-DEL-01", location: "New Delhi HQ", signal: "-65 dBm", cpu: "12%", memory: "45%", network: "Connected", sync: "2 mins ago", battery: "100% (AC)", health: "Healthy" },
  { id: "MN-MUM-02", location: "Mumbai Hub", signal: "-72 dBm", cpu: "28%", memory: "60%", network: "Connected", sync: "5 mins ago", battery: "95% (Solar)", health: "Healthy" },
  { id: "MN-BLR-03", location: "Bangalore Edge", signal: "-88 dBm", cpu: "85%", memory: "92%", network: "Degraded", sync: "15 mins ago", battery: "40% (Batt)", health: "Warning" },
];

const MOCK_SLAVE_NODES = [
  { id: "SN-001", type: "Tilt Sensor", location: "Hill Sector A", signal: "-70 dBm", battery: "85%", health: "Healthy", lastSeen: "Just now" },
  { id: "SN-002", type: "Accelerometer", location: "Bridge 42", signal: "-60 dBm", battery: "92%", health: "Healthy", lastSeen: "1 min ago" },
  { id: "SN-003", type: "Rain Drop Sensor", location: "Valley Base", signal: "-95 dBm", battery: "35%", health: "Warning", lastSeen: "10 mins ago" },
  { id: "SN-004", type: "Temperature", location: "Forest Sector", signal: "-110 dBm", battery: "5%", health: "Critical", lastSeen: "45 mins ago" },
  { id: "SN-005", type: "Water Level", location: "River Delta", signal: "N/A", battery: "0%", health: "Offline", lastSeen: "2 days ago" },
  { id: "SN-006", type: "Soil Moisture", location: "Farm Zone", signal: "-80 dBm", battery: "78%", health: "Healthy", lastSeen: "5 mins ago" },
];

export function NodeHealthSection() {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredSlaves = MOCK_SLAVE_NODES.filter((n) => 
    n.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
    n.type.toLowerCase().includes(searchTerm.toLowerCase()) || 
    n.location.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Master Node Health</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MOCK_MASTER_NODES.map((node) => (
            <MasterNodeCard key={node.id} node={node} />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <h3 className="text-lg font-semibold text-slate-900">Slave Node Status</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-slate-400" />
              <Input 
                type="text" 
                placeholder="Search nodes..." 
                className="w-[200px] pl-9" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button variant="outline" size="icon">
              <Filter className="size-4" />
            </Button>
          </div>
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead>Node ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>Battery</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSlaves.map((node) => (
                <TableRow key={node.id}>
                  <TableCell className="font-mono text-xs font-semibold">{node.id}</TableCell>
                  <TableCell className="text-sm">{node.type}</TableCell>
                  <TableCell className="text-sm text-slate-600">{node.location}</TableCell>
                  <TableCell className="text-xs text-slate-500">{node.signal}</TableCell>
                  <TableCell className="text-xs">{node.battery}</TableCell>
                  <TableCell>
                    <HealthBadge status={node.health} />
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{node.lastSeen}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

function MasterNodeCard({ node }: { node: typeof MOCK_MASTER_NODES[0] }) {
  const getBorderColor = (health: string) => {
    switch (health) {
      case "Warning": return "border-amber-400";
      case "Critical": return "border-red-500";
      case "Offline": return "border-slate-400";
      default: return "border-emerald-500";
    }
  };

  return (
    <Card className={`border-t-4 shadow-sm ${getBorderColor(node.health)}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="font-mono text-sm font-bold text-slate-900">{node.id}</CardTitle>
            <p className="mt-1 text-xs text-slate-500">{node.location}</p>
          </div>
          <HealthBadge status={node.health} />
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-y-4 pt-4 text-sm">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><Wifi className="size-3.5" /> Signal</span>
          <span className="font-semibold text-slate-700">{node.signal}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><Activity className="size-3.5" /> Network</span>
          <span className="font-semibold text-slate-700">{node.network}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><Cpu className="size-3.5" /> CPU</span>
          <span className="font-semibold text-slate-700">{node.cpu}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><MemoryStick className="size-3.5" /> Memory</span>
          <span className="font-semibold text-slate-700">{node.memory}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><Battery className="size-3.5" /> Power</span>
          <span className="font-semibold text-slate-700">{node.battery}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-slate-500"><Clock className="size-3.5" /> Last Sync</span>
          <span className="font-semibold text-slate-700">{node.sync}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function HealthBadge({ status }: { status: string }) {
  let styles = "bg-slate-100 text-slate-700";
  let dot = "bg-slate-400";
  
  if (status === "Healthy") {
    styles = "bg-emerald-50 text-emerald-700 border-emerald-200/60";
    dot = "bg-emerald-500";
  } else if (status === "Warning") {
    styles = "bg-amber-50 text-amber-700 border-amber-200/60";
    dot = "bg-amber-500";
  } else if (status === "Critical") {
    styles = "bg-red-50 text-red-700 border-red-200/60";
    dot = "bg-red-500";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles}`}>
      <span className={`size-1.5 rounded-full ${dot}`}></span>
      {status}
    </span>
  );
}
