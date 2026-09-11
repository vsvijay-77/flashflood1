/**
 * DisasterIntelligenceChat — Agentic RAG chat for the Digital Twin page.
 * Streams the AI response chunk-by-chunk for real-time display.
 */
import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent } from "react";
import {
  Bot, Send, User, Loader2, AlertTriangle, Zap,
  ChevronDown, ChevronUp, RotateCcw, Shield,
  Waves, Thermometer, CloudRain,
} from "lucide-react";

const RAG_API = "http://localhost:8002";

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
    recommended_actions?: string[];
    missing_data?: string[];
    agent_iterations?: number;
  };
}

interface Props {
  latitude?: number;
  longitude?: number;
  areaName?: string;
  radiusKm?: number;
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
  "What is the current flood risk in this area?",
  "Which sensors have abnormal readings?",
  "What actions are recommended right now?",
];

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

function AssistantMessage({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = useState(false);
  const hasMeta =
    msg.meta &&
    (msg.meta.risk_level ||
      msg.meta.sensors?.length ||
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
            {msg.text}
            {msg.streaming && (
              <span className="inline-block w-0.5 h-3.5 bg-[#0F4C81] ml-0.5 align-middle animate-pulse" />
            )}
          </p>

          {/* Sensor chips */}
          {!msg.streaming && msg.meta?.sensors?.length ? (
            <SensorChips sensors={msg.meta.sensors} />
          ) : null}
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
  radiusKm = 20,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      text: `Hello! I'm your Disaster Intelligence Assistant.\n\nAsk me about flood risk, sensor readings, evacuation procedures, or area-specific conditions${areaName ? ` for ${areaName}` : ""}.`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

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

    // Placeholder streaming assistant bubble
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", text: "", streaming: true, timestamp: new Date() },
    ]);

    const payload: Record<string, any> = { query: text.trim(), radius_km: radiusKm };
    if (latitude != null) payload.latitude = latitude;
    if (longitude != null) payload.longitude = longitude;

    abortRef.current = new AbortController();

    try {
      // ── Stream the answer token-by-token ─────────────────────────────────
      const streamRes = await fetch(`${RAG_API}/query/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortRef.current.signal,
      });

      if (!streamRes.ok || !streamRes.body) {
        throw new Error(`Stream error ${streamRes.status}`);
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let lineBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        // SSE format: "data: <escaped-chunk>\n\n"
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? ""; // preserve uncompleted line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let rawPayload = line.slice(6);
          if (rawPayload.endsWith("\r")) rawPayload = rawPayload.slice(0, -1);
          if (!rawPayload || rawPayload === "[DONE]") continue;
          if (rawPayload.startsWith("[ERROR]")) continue;
          // Backend escapes real newlines as \\n — restore them (do NOT .trim() spaces!)
          const chunk = rawPayload.replace(/\\n/g, "\n");
          accumulated += chunk;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, text: accumulated } : m
            )
          );
          scrollToBottom();
        }
      }

      // ── Fetch structured metadata in parallel (risk, sensors, actions) ──
      // We call the non-streaming endpoint quietly for metadata only
      const metaRes = await fetch(`${RAG_API}/risk/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: latitude ?? 0,
          longitude: longitude ?? 0,
          radius_km: radiusKm,
        }),
      });

      let meta: Message["meta"] = {};
      if (metaRes.ok) {
        const data = await metaRes.json();
        meta = {
          risk_level: data.risk_level,
          confidence: data.confidence,
          recommended_actions: data.recommended_actions,
        };
      }

      // Fetch nearby sensors for chips
      if (latitude != null && longitude != null) {
        const sensorRes = await fetch(
          `${RAG_API}/sensors/nearby?latitude=${latitude}&longitude=${longitude}&radius_km=${radiusKm}`
        );
        if (sensorRes.ok) {
          const sensors = await sensorRes.json();
          meta.sensors = sensors;
        }
      }

      // Finalise — stop streaming cursor, attach metadata
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, meta, text: accumulated || m.text }
            : m
        )
      );
    } catch (err: any) {
      if (err?.name === "AbortError") return;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                role: "error" as const,
                streaming: false,
                text: `Could not connect to the intelligence service.\n${err?.message ?? ""}`,
              }
            : m
        )
      );
    } finally {
      setLoading(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
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
      className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col"
      style={{ height: "520px" }}
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
      </div>

      {/* ── Messages ── */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50/50">
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === "user" && (
              <div className="flex items-start gap-2.5 justify-end max-w-[85%] ml-auto">
                <div className="bg-[#0F4C81] text-white rounded-xl rounded-tr-sm px-4 py-2.5 shadow-sm">
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
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
              <AssistantMessage msg={msg} />
            )}

            {msg.role === "error" && !msg.streaming && (
              <div className="flex items-start gap-2 max-w-[88%]">
                <AlertTriangle className="size-4 text-red-500 shrink-0 mt-0.5" />
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  <p className="text-[12px] text-red-700 whitespace-pre-wrap">{msg.text}</p>
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
            disabled={loading}
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
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="shrink-0 size-10 rounded-xl bg-[#0F4C81] hover:bg-[#0B3A61] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-white transition-all active:scale-95 cursor-pointer shadow-sm"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5 ml-1">
          Disaster Intelligence · Sensor data may include demo readings
        </p>
      </div>
    </div>
  );
}
