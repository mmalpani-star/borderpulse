import { fmtClock } from "@/lib/sim";
import { advanceLabel, routePortName, type DispatchState, type DispatchStatus, type EventKind, type EventSource } from "@/lib/dispatch";
import { Chip, Panel, type Tone } from "./ui";

const STATUS_META: Record<DispatchStatus, { label: string; tone: Tone }> = {
  draft: { label: "Not dispatched", tone: "neutral" },
  broadcasting: { label: "Broadcasting", tone: "info" },
  confirmed: { label: "Driver confirmed", tone: "good" },
  declined: { label: "Driver declined", tone: "critical" },
  no_response: { label: "No verbal confirm", tone: "serious" },
  en_route: { label: "En route", tone: "info" },
  at_port: { label: "At port", tone: "info" },
  crossed: { label: "Crossed into U.S.", tone: "info" },
  delivered: { label: "Delivered", tone: "good" },
};

/** Steps completed per status; confirmation completes both "Verbal confirm" and "Manifest updated". */
const DONE_COUNT: Record<DispatchStatus, number> = {
  draft: 0,
  broadcasting: 2,
  declined: 2,
  no_response: 2,
  confirmed: 4,
  en_route: 5,
  at_port: 6,
  crossed: 7,
  delivered: 8,
};

const KIND_DOT: Record<EventKind, string> = {
  detect: "bg-serious",
  call: "bg-otay",
  driver: "bg-good",
  dispatch: "bg-ink-2",
  warning: "bg-warning",
};

const SOURCE_BADGE: Record<EventSource, { label: string; cls: string } | null> = {
  live: { label: "LIVE", cls: "border-critical/60 text-critical" },
  sim: { label: "SIMULATED", cls: "border-warning/50 text-warning" },
  dispatcher: { label: "DISPATCHER", cls: "border-line text-ink-2" },
  system: null,
};

export default function StatusTracker({ state, onAdvance, onReset }: { state: DispatchState; onAdvance: () => void; onReset: () => void }) {
  const meta = STATUS_META[state.status];
  const port = routePortName(state);
  const failed = state.status === "declined" || state.status === "no_response";
  const doneCount = DONE_COUNT[state.status];
  const steps = [
    state.decision?.bottleneck === false ? "Decision locked" : "Bottleneck detected",
    "Bluetooth auto-broadcast sent",
    "Verbal 'Confirm' received",
    "Customs manifest updated (sim)",
    `En route to ${port}`,
    `At ${port}`,
    "Crossed",
    "Delivered",
  ];
  const next = advanceLabel(state);
  const clockLabel = (m: number) => (state.decision?.dataSource === "cbp" ? `${fmtClock(m)} PT` : `sim ${fmtClock(m)}`);

  return (
    <Panel
      title="Dispatch status"
      subtitle="Hands-free workflow. Post-confirmation movement is entered by the dispatcher (simulated progression)."
      right={<Chip tone={meta.tone}>{meta.label}</Chip>}
      className="flex flex-col"
    >
      <ol>
        {steps.map((label, i) => {
          const done = i < doneCount;
          const current = i === doneCount && state.status !== "draft" && !failed;
          const isFailed = failed && i === doneCount;
          return (
            <li key={label} className="flex items-center gap-3 py-1">
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                  isFailed
                    ? "border-critical bg-critical/20 text-critical"
                    : done
                      ? "border-good bg-good/20 text-good"
                      : current
                        ? "border-otay bg-otay/20 text-otay"
                        : "border-line text-muted"
                }`}
              >
                {isFailed ? "✕" : done ? "✓" : i + 1}
              </span>
              <span className={`text-sm ${done || current ? "text-ink" : "text-muted"}`}>
                {isFailed ? (state.status === "declined" ? "Driver declined verbally" : "No verbal 'Confirm'") : label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap gap-2">
        {next && (
          <button onClick={onAdvance} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-bg hover:bg-white">
            {next}
          </button>
        )}
        {state.status !== "draft" && (
          <button onClick={onReset} className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-2 hover:bg-panel-2">
            Reset dispatch
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Event log</h3>
        {state.events.length === 0 ? (
          <p className="text-sm text-muted">No events yet.</p>
        ) : (
          <ul className="max-h-72 space-y-2.5 overflow-auto pr-1" aria-live="polite">
            {state.events.map((e) => {
              const badge = SOURCE_BADGE[e.source];
              return (
                <li key={e.id} className="flex gap-2.5 text-xs">
                  <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[e.kind]}`} />
                  <div className="min-w-0">
                    <div className="tabular flex flex-wrap items-center gap-1.5 text-muted">
                      <span>
                        {clockLabel(e.simMin)} ·{" "}
                        {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      {badge && (
                        <span className={`rounded border px-1 py-px font-mono text-[9px] font-semibold tracking-wider ${badge.cls}`}>{badge.label}</span>
                      )}
                    </div>
                    <div className="text-ink">{e.text}</div>
                    {e.detail && <div className="text-muted">{e.detail}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
