import type { PortId } from "@/lib/sim";
import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "info";

const TONE: Record<Tone, { cls: string; icon: string }> = {
  good: { cls: "border-good/40 bg-good/10 text-ink", icon: "✓" },
  warning: { cls: "border-warning/40 bg-warning/10 text-ink", icon: "!" },
  serious: { cls: "border-serious/40 bg-serious/10 text-ink", icon: "▲" },
  critical: { cls: "border-critical/50 bg-critical/10 text-ink", icon: "✕" },
  neutral: { cls: "border-line bg-panel-2 text-ink-2", icon: "•" },
  info: { cls: "border-otay/40 bg-otay/10 text-ink", icon: "i" },
};

const ICON_COLOR: Record<Tone, string> = {
  good: "text-good",
  warning: "text-warning",
  serious: "text-serious",
  critical: "text-critical",
  neutral: "text-muted",
  info: "text-otay",
};

/** Status chip: always icon + label so color never carries meaning alone. */
export function Chip({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[tone].cls} ${className}`}>
      <span aria-hidden className={`font-bold ${ICON_COLOR[tone]}`}>
        {TONE[tone].icon}
      </span>
      {children}
    </span>
  );
}

export function SimTag({ children = "SIMULATED" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-warning/50 bg-warning/10 px-1.5 py-px font-mono text-[10px] font-semibold tracking-wider text-warning">
      {children}
    </span>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />;
}

export const PORT_COLOR: Record<PortId, string> = {
  otay: "var(--otay)",
  tecate: "var(--tecate)",
  calexico: "var(--calexico)",
  sanluis: "var(--sanluis)",
};
