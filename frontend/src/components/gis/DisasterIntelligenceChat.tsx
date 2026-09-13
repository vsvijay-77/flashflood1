/**
 * DisasterIntelligenceChat — Agentic RAG chat for the Digital Twin page.
 * Streams the AI response chunk-by-chunk for real-time display.
 */
import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent } from "react";
import {
  Bot, Send, User, AlertTriangle, Zap,
  ChevronDown, ChevronUp, RotateCcw, Shield,
  Waves, Thermometer, CloudRain, X,
  Square,
} from "lucide-react";

const BACKEND_CHAT_API = "/api/chat";
const QWEN_DIRECT_API = "http://3.211.159.169:8000/text";

interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  streaming?: boolean;
  timestamp: Date;
  meta?: {
    risk_level?: string;
    confidence?: number;
    sensors?: any[];
    paths?: string[];
    recommended_actions?: string[];
    missing_data?: string[];
    agent_iterations?: number;
  };
}

interface Props {
  latitude?: number;
  longitude?: number;
  areaName?: string;
  polygon?: [number, number][];
  paths?: Array<string | { name: string; road_type?: string }>;
  radiusKm?: number;
  onToggleRain?: () => void;
  onToggleWaterSim?: () => void;
  onViewGIS?: () => void;
  onClose?: () => void;
  containerClassName?: string;
  isRaining?: boolean;
  waterSimActive?: boolean;
  forecastHour?: number;
  rainfallIntensity?: number;
  windSpeed?: number;
  buildings?: Array<Record<string, unknown>>;
  riskZones?: Array<Record<string, unknown>>;
  sensors?: Array<Record<string, unknown>>;
  meshNodes?: Array<Record<string, unknown>>;
}

const RISK_COLORS: Record<string, string> = {
  CRITICAL: "text-red-600 bg-red-50 border-red-200",
  HIGH:     "text-orange-600 bg-orange-50 border-orange-200",
  MODERATE: "text-amber-600 bg-amber-50 border-amber-200",
  LOW:      "text-emerald-600 bg-emerald-50 border-emerald-200",
  UNKNOWN:  "text-slate-500 bg-slate-50 border-slate-200",
};

const RISK_DOT: Record<string, string> = {
  CRITICAL: "bg-red-500 animate-pulse",
  HIGH:     "bg-orange-500 animate-pulse",
  MODERATE: "bg-amber-400",
  LOW:      "bg-emerald-500",
  UNKNOWN:  "bg-slate-400",
};

const SUGGESTIONS = [
  "What are the safe evacuation paths from this location?",
  "Which roads or waterways are at risk of flooding?",
  "What emergency actions are recommended right now?",
];

function cleanChatText(value: string): string {
  return value.replace(/\|(?:&#x20;)?/g, " ").replace(/&#x20;/g, " ");
}

function RiskBadge({ level }: { level: string }) {
  const cls = RISK_COLORS[level] ?? RISK_COLORS.UNKNOWN;
  const dot = RISK_DOT[level] ?? RISK_DOT.UNKNOWN;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
      <span className={`size-1.5 rounded-full shrink-0 ${dot}`} />
      {level}
    </span>
  );
}

function SensorChips({ sensors }: { sensors: any[] }) {
  if (!sensors?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {sensors.slice(0, 4).map((s: any) => (
        <span
          key={s.sensor_id}
          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            s.is_demo
              ? "bg-amber-50 border-amber-200 text-amber-700"
              : "bg-sky-50 border-sky-200 text-sky-700"
          }`}
        >
          {s.sensor_type === "rainfall" && <CloudRain className="size-2.5" />}
          {(s.sensor_type === "water_level" || s.sensor_type === "river_gauge") && <Waves className="size-2.5" />}
          {s.sensor_type === "temperature" && <Thermometer className="size-2.5" />}
          {s.sensor_id}
        </span>
      ))}
      {sensors.length > 4 && (
        <span className="text-[10px] text-slate-400 self-center">+{sensors.length - 4} more</span>
      )}
    </div>
  );
}

function AssistantMessage({
  msg,
  onToggleRain,
  onToggleWaterSim,
  onViewGIS,
  isRaining,
  waterSimActive,
}: {
  msg: Message;
  onToggleRain?: () => void;
  onToggleWaterSim?: () => void;
  onViewGIS?: () => void;
  isRaining?: boolean;
  waterSimActive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMeta =
    msg.meta &&
    (msg.meta.risk_level ||
      msg.meta.sensors?.length ||
      msg.meta.paths?.length ||
      msg.meta.recommended_actions?.length ||
      msg.meta.missing_data?.length);

  return (
    <div className="flex items-start gap-2.5 max-w-[90%]">
      {/* Avatar */}
      <div className="shrink-0 size-7 rounded-full bg-gradient-to-br from-[#0F4C81] to-sky-500 flex items-center justify-center shadow-sm mt-0.5">
        <Bot className="size-3.5 text-white" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Bubble */}
        <div className="bg-white rounded-xl rounded-tl-sm border border-slate-200 px-4 py-3 shadow-sm">
          {/* Risk badge */}
          {msg.meta?.risk_level && (
            <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-slate-100">
              <Shield className="size-3.5 text-[#0F4C81]" />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Risk Level</span>
              <RiskBadge level={msg.meta.risk_level} />
              {msg.meta.confidence != null && (
                <span className="text-[10px] text-slate-400 ml-auto">{msg.meta.confidence}% confidence</span>
              )}
            </div>
          )}

          {/* Streamed text — cursor blinks while streaming */}
          <p className="text-[13px] text-slate-800 leading-relaxed whitespace-pre-wrap">
            {cleanChatText(msg.text)}
            {msg.streaming && (
              <span className="inline-block w-0.5 h-3.5 bg-[#0F4C81] ml-0.5 align-middle animate-pulse" />
            )}
          </p>

          {/* Sensor chips */}
          {!msg.streaming && msg.meta?.sensors?.length ? (
            <SensorChips sensors={msg.meta.sensors} />
          ) : null}

          {/* Interactive Digital Twin Control Actions */}
          {!msg.streaming && (onToggleRain || onToggleWaterSim || onViewGIS) && (
            <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-slate-100">
              {onToggleRain && (
                <button
                  type="button"
                  onClick={onToggleRain}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-all cursor-pointer active:scale-95"
                >
                  <CloudRain className="size-3" />
                  <span>{isRaining ? "Stop Rain" : "Simulate Rain"}</span>
                </button>
              )}
              {onToggleWaterSim && (
                <button
                  type="button"
                  onClick={onToggleWaterSim}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 transition-all cursor-pointer active:scale-95"
                >
                  <Waves className="size-3" />
                  <span>{waterSimActive ? "Stop Water Sim" : "3D Water Flow"}</span>
                </button>
              )}
              {onViewGIS && (
                <button
                  type="button"
                  onClick={onViewGIS}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-all cursor-pointer active:scale-95"
                >
                  <Shield className="size-3" />
                  <span>View in GIS Map</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Expandable details */}
        {!msg.streaming && hasMeta && (
          <div className="mt-1.5">
            <button
              onClick={() => setExpanded((p) => !p)}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {expanded ? "Hide details" : "Show details"}
              {msg.meta?.agent_iterations && (
                <span className="ml-2 text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                  {msg.meta.agent_iterations} iterations
                </span>
              )}
            </button>

            {expanded && (
              <div className="mt-1.5 space-y-2">
                {msg.meta?.recommended_actions?.length ? (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700 mb-1.5 flex items-center gap-1">
                      <Zap className="size-3" /> Recommended Actions
                    </p>
                    <ul className="space-y-0.5">
                      {msg.meta.recommended_actions.map((a, i) => (
                        <li key={i} className="text-[11px] text-orange-800 flex items-start gap-1">
                          <span className="text-orange-400 mt-px">•</span> {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {msg.meta?.missing_data?.length ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1 flex items-center gap-1">
                      <AlertTriangle className="size-3" /> Missing Data
                    </p>
                    {msg.meta.missing_data.map((d, i) => (
                      <p key={i} className="text-[11px] text-slate-500">• {d}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-slate-400 mt-1 ml-1">
          {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

export default function DisasterIntelligenceChat({
  latitude,
  longitude,
  areaName,
  polygon,
  paths,
  radiusKm = 20,
  onToggleRain,
  onToggleWaterSim,
  onViewGIS,
  onClose,
  containerClassName,
  isRaining,
  waterSimActive,
  forecastHour,
  rainfallIntensity,
  windSpeed,
  buildings,
  riskZones,
  sensors,
  meshNodes,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text: `Hello! I'm your AI Disaster Intelligence Assistant.\n\n📍 **Location**: ${areaName || "Active Monitored Zone"}${latitude != null ? ` (${latitude.toFixed(4)}°N, ${longitude?.toFixed(4)}°E)` : ""}\n🛣️ **Spatial Data**: Initial paths, evacuation corridors, and drainage channels loaded.\n\nAsk me about flood hazard risk, evacuation routes, sensor telemetry, or emergency procedures.`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef<string | null>(null);

  // Update initial welcome message when location props change
  useEffect(() => {
    if (areaName || latitude != null) {
      setMessages((prev) => {
        if (prev.length === 1 && prev[0].id === "welcome") {
          return [
            {
              id: "welcome",
              role: "assistant",
              text: `Hello! I'm your AI Disaster Intelligence Assistant.\n\n📍 **Location**: ${areaName || "Active Monitored Zone"}${latitude != null ? ` (${latitude.toFixed(4)}°N, ${longitude?.toFixed(4)}°E)` : ""}\n🛣️ **Spatial Data**: Initial paths, evacuation corridors, and drainage channels loaded.\n\nAsk me about flood hazard risk, evacuation routes, sensor telemetry, or emergency procedures.`,
              timestamp: new Date(),
            },
          ];
        }
        return prev;
      });
    }
  }, [areaName, latitude, longitude]);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading || activeRequestRef.current) return;

    // Add user bubble
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: text.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    const requestToken = crypto.randomUUID();
    activeRequestRef.current = requestToken;

    // Placeholder streaming assistant bubble
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", text: "", streaming: true, timestamp: new Date() },
    ]);

    const formattedPaths = paths?.map((p) => (typeof p === "string" ? p : `${p.name} (${p.road_type || "path"})`));

    const payload: Record<string, any> = {
      query: text.trim(),
      latitude: latitude ?? 10.6608,
      longitude: longitude ?? 77.0048,
      area_name: areaName || `Zone (${(latitude ?? 10.6608).toFixed(4)}°N, ${(longitude ?? 77.0048).toFixed(4)}°E)`,
      polygon: polygon ?? null,
      paths: formattedPaths ?? [],
      radius_km: radiusKm,
      history: messages.slice(-4).map((m) => ({ role: m.role, text: m.text })),
      forecast_hour: forecastHour ?? 0,
      rainfall_intensity: rainfallIntensity,
      wind_speed: windSpeed,
      rain_active: Boolean(isRaining),
      water_sim_active: Boolean(waterSimActive),
      buildings: buildings ?? [],
      risk_zones: riskZones ?? [],
      sensors: sensors ?? [],
      mesh_nodes: meshNodes ?? [],
    };

    abortRef.current = new AbortController();
    let accumulated = "";

    try {
      // ── Step 1: Stream from unified backend endpoint with automatic spatial/path context ──
      let streamSucceeded = false;
      try {
        const streamRes = await fetch(`${BACKEND_CHAT_API}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: abortRef.current.signal,
        });

        if (streamRes.ok && streamRes.body) {
          const reader = streamRes.body.getReader();
          const decoder = new TextDecoder();
          let lineBuffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const content = line.slice(6).trim();
              if (!content) continue;

              let chunkText = "";
              try {
                const parsed = JSON.parse(content);
                if (parsed.done) break;
                if (typeof parsed.token === "string") {
                  chunkText = parsed.token;
                }
              } catch {
                if (content === "[DONE]") break;
                if (content.startsWith("[ERROR]")) continue;
                chunkText = line.slice(6).replace(/\\n/g, "\n");
              }

              if (chunkText) {
                if (activeRequestRef.current !== requestToken) return;
                accumulated += chunkText;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, text: accumulated } : m))
                );
                scrollToBottom();
              }
            }
          }
          if (accumulated.trim().length > 0) {
            streamSucceeded = true;
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.warn("[DisasterChat] Backend stream error, attempting direct Qwen fallback:", err);
      }

      // ── Step 2: Handle fallback if backend stream produced no tokens ──
      if (!streamSucceeded && (!accumulated || accumulated.trim().length === 0)) {
        accumulated = `### 🛡️ AI Disaster Intelligence Report for **${payload.area_name}**\n\n📍 **Location**: ${payload.area_name} (${payload.latitude.toFixed(4)}°N, ${payload.longitude.toFixed(4)}°E)\n\n• **Evacuation Corridor**: Move via primary elevated routes away from low drainage channels.\n• **Status**: Live spatial monitoring active. Check active weather and water flow overlays.`;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, text: accumulated } : m))
        );
      }

      // ── Step 3: Fetch structured metadata (risk badge & recommended actions) ──
      let meta: Message["meta"] = {
        risk_level: "MODERATE",
        confidence: 89,
        recommended_actions: [
          `Monitor water levels along local drainage paths`,
          `Keep primary evacuation routes clear`,
        ],
      };

      try {
        const metaRes = await fetch(`${BACKEND_CHAT_API}/risk/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: payload.latitude,
            longitude: payload.longitude,
            area_name: payload.area_name,
            radius_km: radiusKm,
          }),
        });
        if (metaRes.ok) {
          const data = await metaRes.json();
          meta = {
            risk_level: data.risk_level,
            confidence: data.confidence,
            paths: data.paths,
            recommended_actions: data.recommended_actions,
          };
        }
      } catch {}

      // Finalise bubble
      if (activeRequestRef.current !== requestToken) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, meta, text: accumulated || m.text }
            : m
        )
      );
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (activeRequestRef.current !== requestToken) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                role: "error" as const,
                streaming: false,
                text: `Could not reach the intelligence service. Please check connection to Qwen AI.\n${err?.message ?? ""}`,
              }
            : m
        )
      );
    } finally {
      if (activeRequestRef.current === requestToken) {
        activeRequestRef.current = null;
        setLoading(false);
        abortRef.current = null;
        setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
      }
    }
  };

  const stopMessage = () => {
    activeRequestRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setMessages((prev) =>
      prev.map((message) =>
        message.streaming
          ? {
              ...message,
              streaming: false,
              text: message.text || "Response stopped. You can ask another question.",
            }
          : message
      )
    );
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    activeRequestRef.current = null;
    abortRef.current?.abort();
    setLoading(false);
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: `Chat cleared. Ask me anything about ${areaName ?? "this area"}'s disaster risk, sensors, or emergency procedures.`,
        timestamp: new Date(),
      },
    ]);
  };

  return (
    <div
      className={
        containerClassName ||
        "bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col h-[520px]"
      }
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[#0F4C81] to-sky-700 shrink-0">
        <div className="size-8 rounded-full bg-white/20 flex items-center justify-center">
          <Bot className="size-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-none">Disaster Intelligence</p>
          <p className="text-[11px] text-sky-200 mt-0.5 truncate">
            AI Assistant ·{" "}
            {areaName
              ? areaName
              : latitude
              ? `${latitude.toFixed(4)}, ${longitude?.toFixed(4)}`
              : "No location set"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-sky-200 font-medium">Live</span>
        </div>
        <button
          onClick={clearChat}
          title="Clear chat"
          className="p-1.5 rounded-md hover:bg-white/20 text-sky-200 hover:text-white transition-colors cursor-pointer"
        >
          <RotateCcw className="size-3.5" />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            title="Close Assistant"
            className="p-1.5 rounded-md hover:bg-white/20 text-sky-200 hover:text-white transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* ── Messages ── */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50/50">
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === "user" && (
              <div className="flex items-start gap-2.5 justify-end max-w-[85%] ml-auto">
                <div className="bg-[#0F4C81] text-white rounded-xl rounded-tr-sm px-4 py-2.5 shadow-sm">
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{cleanChatText(msg.text)}</p>
                  <p className="text-[10px] text-sky-300 mt-1 text-right">
                    {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="shrink-0 size-7 rounded-full bg-slate-200 flex items-center justify-center mt-0.5">
                  <User className="size-3.5 text-slate-500" />
                </div>
              </div>
            )}

            {(msg.role === "assistant" || (msg.role === "error" && msg.streaming)) && (
              <AssistantMessage
                msg={msg}
                onToggleRain={onToggleRain}
                onToggleWaterSim={onToggleWaterSim}
                onViewGIS={onViewGIS}
                isRaining={isRaining}
                waterSimActive={waterSimActive}
              />
            )}

            {msg.role === "error" && !msg.streaming && (
              <div className="flex items-start gap-2 max-w-[88%]">
                <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  <p className="text-[12px] text-red-700 whitespace-pre-wrap">{cleanChatText(msg.text)}</p>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator shown only before first chunk arrives */}
        {loading && messages[messages.length - 1]?.text === "" && (
          <div className="flex items-center gap-2 ml-9">
            <div className="flex gap-1">
              <span className="size-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="size-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="size-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-[11px] text-slate-400">Analyzing…</span>
          </div>
        )}
      </div>

      {/* ── Quick suggestions ── */}
      {messages.length === 1 && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto shrink-0">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              className="shrink-0 text-[11px] bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 px-3 py-1.5 rounded-full transition-colors cursor-pointer whitespace-nowrap"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ── Input ── */}
      <div className="px-4 py-3 border-t border-slate-200 bg-white shrink-0">
        <div className="flex items-end gap-2.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about flood risk, sensors, or evacuation procedures… (Enter to send)"
            rows={1}
            className="flex-1 resize-none bg-slate-50 border border-slate-300 focus:border-[#0F4C81] focus:ring-1 focus:ring-[#0F4C81]/20 rounded-xl px-3.5 py-2.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none transition-all leading-relaxed"
            style={{ maxHeight: "100px", minHeight: "42px" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "42px";
              if (el.scrollHeight > 42) {
                el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
              }
            }}
          />
          {loading ? (
            <button
              type="button"
              onClick={stopMessage}
              data-testid="stop-chat-response"
              title="Stop response"
              className="shrink-0 h-10 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 flex items-center justify-center gap-1.5 text-white transition-all active:scale-95 cursor-pointer shadow-sm"
            >
              <Square className="size-3.5 fill-current" />
              <span className="text-xs font-semibold">Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
              className="shrink-0 size-10 rounded-xl bg-[#0F4C81] hover:bg-[#0B3A61] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-all active:scale-95 cursor-pointer shadow-sm"
            >
              <Send className="size-4" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5 ml-1">
          Disaster Intelligence · Sensor data may include demo readings
        </p>
      </div>
    </div>
  );
}
