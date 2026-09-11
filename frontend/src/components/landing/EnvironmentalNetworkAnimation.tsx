import { useState, useRef, useEffect } from "react";
import {
  CloudRain, Droplets, Thermometer, Waves, Wind, Mountain,
  Antenna, Server, ZoomIn, ZoomOut, Maximize, Minimize, Activity, 
  Battery, ShieldAlert, Network, Zap, Sun
} from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = "network" | "health" | "battery" | "sensor";
type Status = "healthy" | "warning" | "critical" | "offline";

interface MasterNodeSpec {
  id: string;
  label: string;
  x: number;
  y: number;
  status: Status;
}

interface NodeSpec {
  id: string;
  masterId: string;
  label: string;
  type: string;
  x: number;
  y: number;
  readings: { label: string; value: string }[];
  status: Status;
  battery: number;
  solar?: boolean;
  signal: number;
  icon: any;
  alertType?: string;
  riskLevel?: string;
}

const GATEWAY = { x: 400, y: 110 };

const MASTER_NODES: MasterNodeSpec[] = [
  { id: "m1", label: "Edge Node", x: 200, y: 220, status: "healthy" },
  { id: "m2", label: "Edge Node", x: 580, y: 260, status: "warning" },
  { id: "m3", label: "Edge Node", x: 380, y: 340, status: "healthy" },
];

const NODES: NodeSpec[] = [
  { 
    id: "n1", masterId: "m1", label: "ENV-IND-001", type: "Accelerometer", x: 80, y: 300, 
    readings: [{ label: "X", value: "0.12 g" }, { label: "Y", value: "0.08 g" }, { label: "Z", value: "9.81 g" }],
    status: "healthy", battery: 87, solar: true, signal: -72, icon: Activity 
  },
  { 
    id: "n2", masterId: "m1", label: "ENV-IND-002", type: "Rain Sensor", x: 150, y: 350, 
    readings: [{ label: "Rate", value: "12 mm/h" }, { label: "24h Total", value: "45 mm" }],
    status: "healthy", battery: 92, signal: -68, icon: CloudRain 
  },
  { 
    id: "n3", masterId: "m1", label: "ENV-IND-003", type: "Temperature", x: 260, y: 280, 
    readings: [{ label: "Temp", value: "24.2 °C" }, { label: "Humidity", value: "68%" }],
    status: "healthy", battery: 35, signal: -81, icon: Thermometer 
  },
  { 
    id: "n4", masterId: "m3", label: "ENV-IND-004", type: "Water Level", x: 300, y: 420, 
    readings: [{ label: "Level", value: "2.4 m" }, { label: "Threshold", value: "3.5 m" }],
    status: "healthy", battery: 100, solar: true, signal: -55, icon: Waves 
  },
  { 
    id: "n5", masterId: "m3", label: "ENV-IND-005", type: "Soil Moisture", x: 450, y: 390, 
    readings: [{ label: "Moisture", value: "64%" }, { label: "Temp", value: "21.1 °C" }],
    status: "healthy", battery: 78, signal: -62, icon: Droplets 
  },
  { 
    id: "n6", masterId: "m2", label: "ENV-IND-006", type: "Air Quality", x: 680, y: 330, 
    readings: [{ label: "AQI", value: "148" }, { label: "PM2.5", value: "54 µg/m³" }],
    status: "warning", battery: 55, solar: true, signal: -75, icon: Wind 
  },
  { 
    id: "n7", masterId: "m2", label: "ENV-IND-007", type: "Seismic Tilt", x: 500, y: 200, 
    readings: [{ label: "Tilt", value: "0.2°" }, { label: "Stability", value: "High" }],
    status: "healthy", battery: 12, signal: -92, icon: Mountain 
  },
  { 
    id: "n14", masterId: "m3", label: "ENV-IND-014", type: "Landslide Risk", x: 620, y: 440, 
    readings: [{ label: "Tilt", value: "18.4°" }, { label: "Acceleration", value: "HIGH" }],
    status: "critical", battery: 88, solar: true, signal: -64, icon: Mountain,
    alertType: "LANDSLIDE RISK DETECTED", riskLevel: "CRITICAL"
  },
];

const STATUS_COLORS = {
  healthy: "#22C55E",
  warning: "#EAB308",
  critical: "#EF4444",
  offline: "#64748B"
};

function getBatteryColor(pct: number) {
  if (pct >= 80) return "#22C55E";
  if (pct >= 40) return "#EAB308";
  return "#EF4444";
}

function curveTo(x1: number, y1: number, x2: number, y2: number) {
  const midX = (x1 + x2) / 2;
  const midY = Math.min(y1, y2) - 40;
  return `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;
}

export default function EnvironmentalNetworkAnimation() {
  const [viewMode, setViewMode] = useState<ViewMode>("network");
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div 
      ref={containerRef}
      className={cn(
        "relative flex w-full flex-col overflow-hidden bg-[#0C2340] ein-animated font-sans text-slate-100",
        isFullscreen ? "h-screen rounded-none" : "min-h-[600px] rounded-xl border border-[#1E3A5F] shadow-2xl"
      )}
      data-testid="environmental-network-topology"
    >
      {/* Top Header */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between border-b border-[#1E3A5F]/60 bg-[#0C2340]/80 px-4 py-3 backdrop-blur-sm">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-300">
          Environmental Monitoring Network Topology
        </span>
        <span className="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
          </span>
          Live Streaming
        </span>
      </div>

      {/* Main SVG Visualization */}
      <div className="relative flex-1 cursor-grab overflow-hidden active:cursor-grabbing">
        <div 
          className="absolute inset-0 transition-transform duration-300 ease-out"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
        >
          <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet" className="block h-full w-full">
            <defs>
              <linearGradient id="hillFar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#12456F" />
                <stop offset="100%" stopColor="#0C2340" />
              </linearGradient>
              <linearGradient id="hillNear" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1B4D3E" />
                <stop offset="100%" stopColor="#0E3327" />
              </linearGradient>
              <pattern id="geoGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1E3A5F" strokeWidth="0.8" opacity="0.6" />
                <path d="M 0 40 L 40 40 L 40 0" fill="none" stroke="#1E3A5F" strokeWidth="0.4" opacity="0.3" />
              </pattern>
              
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Background Grid */}
            <rect width="800" height="600" fill="url(#geoGrid)" />

            {/* Terrain Layers */}
            <path d="M0 340 L120 230 L250 290 L380 180 L520 260 L680 160 L800 240 L800 600 L0 600 Z" fill="url(#hillFar)" opacity="0.9" />
            
            {/* GIS Contour Lines */}
            {[260, 310, 360, 410, 460].map((y, i) => (
              <path
                key={y}
                d={`M0 ${y} C 180 ${y - 40}, 320 ${y + 30}, 480 ${y - 20} S 680 ${y + 40}, 800 ${y - 10}`}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="0.8"
                opacity={0.15 + i * 0.04}
              />
            ))}

            <path d="M0 440 L160 340 L320 400 L480 300 L640 380 L800 320 L800 600 L0 600 Z" fill="url(#hillNear)" opacity="0.95" />

            {/* Master Node Connections */}
            {MASTER_NODES.map((master, i) => (
              <g key={`master-link-${master.id}`}>
                <path d={curveTo(master.x, master.y, GATEWAY.x, GATEWAY.y + 20)} fill="none" stroke="#38BDF8" strokeWidth="1.5" opacity="0.4" />
                <path
                  d={curveTo(master.x, master.y, GATEWAY.x, GATEWAY.y + 20)}
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="4 150"
                  style={{ animation: `ein-packet 2s linear ${i * 0.5}s infinite` }}
                />
              </g>
            ))}

            {/* Sensor Node Connections */}
            {NODES.map((node, i) => {
              const master = MASTER_NODES.find(m => m.id === node.masterId)!;
              const isAlert = node.status === 'critical';
              return (
                <g key={`node-link-${node.id}`}>
                  <path 
                    d={curveTo(node.x, node.y, master.x, master.y)} 
                    fill="none" 
                    stroke={isAlert ? "#EF4444" : "#2DD4BF"} 
                    strokeWidth={isAlert ? "2" : "1"} 
                    opacity={isAlert ? "0.8" : "0.3"} 
                  />
                  <path
                    d={curveTo(node.x, node.y, master.x, master.y)}
                    fill="none"
                    stroke={isAlert ? "#EF4444" : "#2DD4BF"}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray="4 100"
                    style={{ animation: `ein-packet 2.5s linear ${i * 0.2}s infinite` }}
                  />
                </g>
              );
            })}

            {/* Sensor Nodes */}
            {NODES.map((node) => {
              const color = 
                viewMode === "health" ? STATUS_COLORS[node.status] : 
                viewMode === "battery" ? getBatteryColor(node.battery) : 
                node.status === "critical" ? STATUS_COLORS.critical : "#06B6D4";
              

              return (
                <g 
                  key={node.id} 
                >
                  {node.status === "critical" && (
                    <circle cx={node.x} cy={node.y} r="20" fill="none" stroke="#EF4444" strokeWidth="1.5" className="animate-ping" />
                  )}
                  <circle cx={node.x} cy={node.y} r="14" fill="#0B2545" stroke={color} strokeWidth="1.5" />
                  <foreignObject x={node.x - 9} y={node.y - 9} width="18" height="18">
                    <div className="flex h-full w-full items-center justify-center text-white" style={{ color }}>
                      <node.icon size={12} strokeWidth={2.5} />
                    </div>
                  </foreignObject>

                  {/* Battery or Health small indicator */}
                  {viewMode === "battery" && (
                    <g transform={`translate(${node.x + 10}, ${node.y - 14})`}>
                      <rect x="0" y="0" width="18" height="10" rx="2" fill="#0B2545" stroke={getBatteryColor(node.battery)} strokeWidth="1" />
                      <text x="9" y="8" textAnchor="middle" fill={getBatteryColor(node.battery)} fontSize="8" fontWeight="bold">{node.battery}</text>
                    </g>
                  )}
                  {viewMode === "health" && (
                    <circle cx={node.x + 12} cy={node.y - 12} r="4" fill={STATUS_COLORS[node.status]} stroke="#0B2545" strokeWidth="1.5" />
                  )}
                  
                  {/* Alert Label */}
                  {node.alertType && viewMode !== "battery" && (
                    <g transform={`translate(${node.x}, ${node.y + 24})`}>
                      <rect x="-60" y="-8" width="120" height="16" rx="4" fill="#EF4444" opacity="0.9" />
                      <text x="0" y="3" textAnchor="middle" fill="#FFFFFF" fontSize="8" fontWeight="bold" letterSpacing="0.5">
                        {node.alertType}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Master Nodes */}
            {MASTER_NODES.map((master) => {
              const color = viewMode === "health" ? STATUS_COLORS[master.status] : "#8B5CF6";
              
              return (
                <g 
                  key={master.id}
                >
                  <rect x={master.x - 20} y={master.y - 20} width="40" height="40" rx="8" fill="#1E1B4B" stroke={color} strokeWidth="2" filter="url(#glow)" />
                  <foreignObject x={master.x - 12} y={master.y - 12} width="24" height="24">
                    <div className="flex h-full w-full items-center justify-center" style={{ color }}>
                      <Server size={16} strokeWidth={2} />
                    </div>
                  </foreignObject>
                  <text x={master.x} y={master.y + 32} textAnchor="middle" fill="#E2E8F0" fontSize="9" fontWeight="bold" letterSpacing="0.5">
                    {master.label}
                  </text>
                </g>
              );
            })}

            {/* LoRaWAN Gateway */}
            <g data-testid="hero-lorawan-gateway">
              {[0, 1, 2].map((i) => (
                <circle
                  key={i}
                  cx={GATEWAY.x}
                  cy={GATEWAY.y}
                  r="24"
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth="1.5"
                  opacity="0.6"
                  style={{ animation: `ein-wave 3s ease-out ${i * 1}s infinite` }}
                />
              ))}
              <line x1={GATEWAY.x} y1={GATEWAY.y + 24} x2={GATEWAY.x} y2={GATEWAY.y + 70} stroke="#1E5A8A" strokeWidth="4" />
              <circle cx={GATEWAY.x} cy={GATEWAY.y} r="28" fill="#0B2545" stroke="#38BDF8" strokeWidth="2" filter="url(#glow)" />
              <Antenna x={GATEWAY.x - 16} y={GATEWAY.y - 16} width={32} height={32} color="#BAE6FD" strokeWidth={2} />
              
              <rect x={GATEWAY.x - 64} y={GATEWAY.y - 64} width="128" height="20" rx="10" fill="#0EA5E9" opacity="0.2" />
              <text x={GATEWAY.x} y={GATEWAY.y - 50} textAnchor="middle" fill="#E0F2FE" fontSize="10" fontWeight="bold" letterSpacing="1.2">
                LoRaWAN GATEWAY
              </text>
            </g>

            {/* Gateway to Cloud to GIS */}
            <g>
              {/* Uplink to Cloud */}
              <path d={`M${GATEWAY.x} ${GATEWAY.y + 70} L${GATEWAY.x} ${GATEWAY.y + 110}`} stroke="#38BDF8" strokeWidth="2" strokeDasharray="6 8" style={{ animation: "ein-packet 1.5s linear infinite" }} />
              
              {/* Cloud Server */}
              <rect x={GATEWAY.x - 90} y={GATEWAY.y + 110} width="180" height="34" rx="8" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" filter="url(#glow)" />
              <text x={GATEWAY.x} y={GATEWAY.y + 131} textAnchor="middle" fill="#F8FAFC" fontSize="11" fontWeight="bold" letterSpacing="1">
                NETWORK / CLOUD SERVER
              </text>

              {/* Link to GIS */}
              <path d={`M${GATEWAY.x} ${GATEWAY.y + 144} L${GATEWAY.x} ${GATEWAY.y + 420}`} stroke="#10B981" strokeWidth="2" strokeDasharray="6 8" style={{ animation: "ein-packet 1.5s linear 0.75s infinite" }} />
              
              {/* GIS Platform */}
              <rect x={GATEWAY.x - 110} y={GATEWAY.y + 420} width="220" height="38" rx="8" fill="#064E3B" stroke="#10B981" strokeWidth="2" filter="url(#glow)" />
              <text x={GATEWAY.x} y={GATEWAY.y + 443} textAnchor="middle" fill="#FFFFFF" fontSize="12" fontWeight="bold" letterSpacing="1.5">
                GIS + AI INTELLIGENCE
              </text>
            </g>
          </svg>
        </div>

        {/* Network Status KPI Panel */}
        <div className="absolute left-4 top-14 hidden rounded-md border border-slate-700/50 bg-[#0F172A]/90 p-2.5 shadow-xl backdrop-blur-md sm:block w-[180px] z-10 pointer-events-none">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Network Status</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-slate-300">Active Nodes</span>
              <span className="font-mono font-bold text-white">24 / 26</span>
            </div>
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-slate-300">Master Nodes</span>
              <span className="font-mono font-bold text-white">03 / 03</span>
            </div>
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-slate-300">Gateway Status</span>
              <span className="font-mono font-bold text-emerald-400">ONLINE</span>
            </div>
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-slate-300">Packets / Min</span>
              <span className="font-mono font-bold text-white">1,248</span>
            </div>
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-slate-300">Avg Battery</span>
              <span className="font-mono font-bold text-emerald-400">82%</span>
            </div>
          </div>
        </div>


      </div>

      {/* Interactive Controls panel */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2">
        <div className="flex flex-col rounded-lg border border-slate-700 bg-[#0F172A]/90 p-1 shadow-xl backdrop-blur-md self-end">
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 2.5))} className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded" title="Zoom In"><ZoomIn size={18} /></button>
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.5))} className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded" title="Zoom Out"><ZoomOut size={18} /></button>
          <button onClick={() => setZoom(1)} className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded font-mono text-xs font-bold" title="Reset Zoom">1x</button>
          <div className="my-1 h-px w-full bg-slate-700" />
          <button onClick={toggleFullscreen} className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded" title="Toggle Fullscreen">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>

        <div className="flex rounded-lg border border-slate-700 bg-[#0F172A]/90 p-1 shadow-xl backdrop-blur-md">
          <button 
            onClick={() => setViewMode("network")} 
            className={cn("flex items-center gap-2 rounded px-3 py-2 text-xs font-bold transition-colors", viewMode === "network" ? "bg-sky-500 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white")}
          >
            <Network size={14} /> <span className="hidden sm:inline">Network</span>
          </button>
          <button 
            onClick={() => setViewMode("health")} 
            className={cn("flex items-center gap-2 rounded px-3 py-2 text-xs font-bold transition-colors", viewMode === "health" ? "bg-emerald-500 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white")}
          >
            <ShieldAlert size={14} /> <span className="hidden sm:inline">Health</span>
          </button>
          <button 
            onClick={() => setViewMode("battery")} 
            className={cn("flex items-center gap-2 rounded px-3 py-2 text-xs font-bold transition-colors", viewMode === "battery" ? "bg-amber-500 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white")}
          >
            <Battery size={14} /> <span className="hidden sm:inline">Battery</span>
          </button>
          <button 
            onClick={() => setViewMode("sensor")} 
            className={cn("flex items-center gap-2 rounded px-3 py-2 text-xs font-bold transition-colors", viewMode === "sensor" ? "bg-indigo-500 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white")}
          >
            <Activity size={14} /> <span className="hidden sm:inline">Sensor</span>
          </button>
        </div>
      </div>
    </div>
  );
}
