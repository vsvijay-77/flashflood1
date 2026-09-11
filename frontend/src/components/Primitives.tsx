import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RISK_STYLES, type RiskLevel } from "@/lib/types";

export function PageHeader({
  title,
  description,
  actions,
  testId,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      data-testid={testId ?? "page-header"}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "blue",
  testId,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: "blue" | "green" | "teal" | "amber" | "red";
  testId: string;
}) {
  const tones: Record<string, string> = {
    blue: "bg-[#0F4C81]/10 text-[#0F4C81]",
    green: "bg-[#2E7D32]/10 text-[#1B4D3E]",
    teal: "bg-[#0D9488]/10 text-[#0D9488]",
    amber: "bg-amber-500/10 text-amber-700",
    red: "bg-red-500/10 text-red-700",
  };
  return (
    <Card
      className="border-slate-200/80 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(15,76,129,0.10)]"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-slate-900" data-testid={`${testId}-value`}>
            {value}
          </p>
          {hint ? <p className="mt-1 truncate text-xs text-slate-500">{hint}</p> : null}
        </div>
        {icon ? <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", tones[tone])}>{icon}</span> : null}
      </div>
    </Card>
  );
}

export function RiskIndicator({ level, className, testId }: { level: RiskLevel; className?: string; testId?: string }) {
  const s = RISK_STYLES[level] ?? RISK_STYLES.low;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
        s.bg,
        s.text,
        className,
      )}
      data-testid={testId ?? `risk-indicator-${level}`}
    >
      <span className={cn("size-2 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function StatusPill({ status, testId }: { status: string; testId?: string }) {
  const map: Record<string, string> = {
    online: "bg-emerald-50 text-emerald-800 border-emerald-200",
    active: "bg-emerald-50 text-emerald-800 border-emerald-200",
    ready: "bg-emerald-50 text-emerald-800 border-emerald-200",
    resolved: "bg-emerald-50 text-emerald-800 border-emerald-200",
    offline: "bg-red-50 text-red-800 border-red-200",
    suspended: "bg-red-50 text-red-800 border-red-200",
    maintenance: "bg-amber-50 text-amber-800 border-amber-200",
    pending: "bg-amber-50 text-amber-800 border-amber-200",
    open: "bg-sky-50 text-sky-800 border-sky-200",
    acknowledged: "bg-sky-50 text-sky-800 border-sky-200",
    assigned: "bg-indigo-50 text-indigo-800 border-indigo-200",
  };
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize", map[status] ?? "bg-slate-50 text-slate-700 border-slate-200")}
      data-testid={testId ?? `status-pill-${status}`}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  testId,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId: string;
}) {
  return (
    <Card className={cn("border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.06)]", className)} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="p-6">{children}</div>
    </Card>
  );
}

export function EmptyState({ title, description, testId }: { title: string; description?: string; testId: string }) {
  return (
    <div
      className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center"
      data-testid={testId}
    >
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{description}</p> : null}
    </div>
  );
}

export function LoadingRows({ rows = 3, testId = "loading-rows" }: { rows?: number; testId?: string }) {
  return (
    <div className="space-y-3" data-testid={testId}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

export function LoadingSymbol({
  size = "md",
  label = "Loading data...",
  className,
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}) {
  const sizeMap = {
    sm: "size-5 border-2",
    md: "size-9 border-3",
    lg: "size-14 border-4",
  };
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 p-6", className)} role="status" aria-label={label}>
      <div className="relative flex items-center justify-center">
        <div className={cn("animate-spin rounded-full border-slate-200 border-t-emerald-500", sizeMap[size])} />
        <div className="absolute size-2.5 animate-ping rounded-full bg-emerald-500 opacity-75" />
      </div>
      {label ? <span className="text-xs font-semibold tracking-wide text-slate-500">{label}</span> : null}
    </div>
  );
}

export function LoadingOverlay({ message = "Loading module..." }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/25 backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white/95 px-8 py-7 shadow-2xl backdrop-blur-md">
        <div className="relative flex items-center justify-center">
          <div className="size-12 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-500" />
          <div className="absolute size-3 animate-ping rounded-full bg-emerald-500 opacity-75" />
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm font-bold text-slate-800">{message}</p>
          <p className="text-[11px] font-medium text-slate-500">Retrieving & caching environmental data</p>
        </div>
      </div>
    </div>
  );
}

