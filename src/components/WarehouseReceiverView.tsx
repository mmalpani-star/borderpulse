import type { Dispatch } from "react";
import { LANES, LOAD, PORTS, fmtClock, fmtDur, type Decision, type Scenario, type TripPlan } from "@/lib/sim";
import { isEscalated, type DispatchAction, type DispatchState, type DispatchStatus, type EventSource } from "@/lib/dispatch";
import {
  corridorStage,
  crowdDensity,
  receiverEta,
  receiverStatusLabel,
  receiverTimeline,
  type CorridorStage,
  type Density,
} from "@/lib/receiver";
import { Chip, PORT_COLOR, Panel, SimTag, Swatch, type Tone } from "./ui";

const SOURCE_BADGE: Record<EventSource, { label: string; cls: string } | null> = {
  live: { label: "LIVE", cls: "border-critical/60 text-critical" },
  sim: { label: "SIMULATED", cls: "border-warning/50 text-warning" },
  dispatcher: { label: "DISPATCH", cls: "border-line text-ink-2" },
  system: null,
};

function BoardField({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">{label}</div>
      <div className={`mt-1 truncate text-sm text-ink ${mono ? "tabular font-mono" : ""}`}>{children}</div>
    </div>
  );
}

const DENSITY: Record<Density, { label: string; tone: Tone; color: string }> = {
  low: { label: "Low", tone: "good", color: "var(--good)" },
  moderate: { label: "Moderate", tone: "warning", color: "var(--warning)" },
  severe: { label: "Severe", tone: "critical", color: "var(--critical)" },
};

const STAGE_TEXT: Record<CorridorStage, string> = {
  pre_departure: "Awaiting departure",
  origin: "Truck in origin transit",
  border: "Truck in border queue",
  us_inbound: "Truck on U.S. inbound leg",
  arrived: "Truck at dock",
};

function CorridorBar({ plan, status, originCity }: { plan: TripPlan; status: DispatchStatus; originCity: string }) {
  const density = plan.available ? crowdDensity(plan.waitMin) : null;
  const d = density ? DENSITY[density] : null;
  const stage = corridorStage(status);
  const total = Math.max(1, plan.toPortMin + plan.waitMin + plan.fromPortMin);
  const segments: { key: CorridorStage; label: string; min: number; color: string }[] = [
    { key: "origin", label: `Origin transit (${originCity})`, min: plan.toPortMin, color: "var(--drive)" },
    { key: "border", label: `Border queue · ${PORTS[plan.port].shortName}`, min: plan.waitMin, color: d?.color ?? "var(--line)" },
    { key: "us_inbound", label: "U.S. inbound", min: plan.fromPortMin, color: "var(--drive)" },
  ];

  return (
    <div className="border-t border-line px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[11px] tracking-[0.2em] text-muted uppercase">Active corridor congestion</div>
        <div className="flex items-center gap-2 text-xs text-ink-2">
          <span>Border crowd density</span>
          {d ? <Chip tone={d.tone}>{d.label} · {fmtDur(plan.waitMin)}</Chip> : <Chip tone="neutral">Port closed</Chip>}
        </div>
      </div>
      <div className="flex gap-[2px]" role="img" aria-label={`${segments.map((s) => `${s.label} ${fmtDur(s.min)}`).join(", ")}. ${STAGE_TEXT[stage]}.`}>
        {segments.map((s, i) => {
          const here = stage === s.key;
          const passed = stage === "arrived" || segments.findIndex((x) => x.key === stage) > i;
          return (
            <div key={s.key} className="min-w-0" style={{ width: `${Math.max(22, (s.min / total) * 100)}%` }}>
              <div
                className={`relative h-3 ${i === 0 ? "rounded-l" : ""} ${i === segments.length - 1 ? "rounded-r" : ""} ${
                  here ? "ring-2 ring-ink ring-offset-2 ring-offset-panel" : ""
                }`}
                style={{ background: s.color, opacity: passed ? 0.45 : 1 }}
              >
                {here && (
                  <span aria-hidden className="bp-pulse absolute top-1/2 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" />
                )}
              </div>
              <div className={`mt-1.5 truncate text-[11px] ${here ? "font-semibold text-ink" : "text-muted"}`} title={s.label}>
                {s.label}
              </div>
              <div className="tabular font-mono text-[11px] text-ink-2">{fmtDur(s.min)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-ink-2">
        <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-ink align-middle" />
        {STAGE_TEXT[stage]}
      </div>
    </div>
  );
}

export default function WarehouseReceiverView({
  state,
  scenario,
  decision,
  dispatch,
}: {
  state: DispatchState;
  scenario: Scenario;
  decision: Decision;
  dispatch: Dispatch<DispatchAction>;
}) {
  const lane = LANES[(state.decision ?? decision).primary.port];
  const eta = receiverEta(state, decision);
  const { plan } = eta;
  const delta = plan.appointmentDeltaMin;
  const delivered = state.status === "delivered";
  const windowTone: Tone = !plan.available ? "neutral" : delta > 0 ? "critical" : delta > -30 ? "warning" : "good";
  const windowText = !plan.available
    ? "Route closed at arrival"
    : delta > 0
      ? `Late by ${fmtDur(delta)}`
      : `On time · ${fmtDur(-delta)} buffer`;
  const timeline = receiverTimeline(state);
  const routePort = PORTS[plan.port];
  const overdue = plan.available && !delivered && scenario.minuteOfDay >= plan.etaMin;
  const escalated = isEscalated(state);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Inbound dock board · {lane.destination}</h1>
          <p className="text-xs text-muted">
            Receiver view. Updates automatically from dispatch · {(state.decision ?? decision).dataSource === "cbp" ? "now" : "sim clock"}{" "}
            {fmtClock(scenario.minuteOfDay)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone="neutral">No driver contact</Chip>
          {(state.decision ?? decision).dataSource === "cbp" ? <Chip tone="good">CBP live waits</Chip> : <SimTag>SIMULATED SCENARIO</SimTag>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Arrival board */}
        <section className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line bg-panel-2 px-5 py-2 font-mono text-[11px] tracking-[0.2em] text-muted uppercase">
            <span>Arrivals · Dock receiving</span>
            <span className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${delivered ? "bg-good" : "bp-pulse bg-otay"}`} aria-hidden />
              {delivered ? "Arrived" : "Tracking"}
            </span>
          </div>

          <div className="grid gap-6 p-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
            <div>
              <div className="font-mono text-[11px] tracking-[0.2em] text-muted uppercase">
                {delivered ? "Arrived" : "Expected arrival"}
              </div>
              <div
                className="tabular font-mono text-6xl leading-none font-semibold tracking-tight text-ink sm:text-7xl xl:text-8xl"
                aria-live="polite"
              >
                {plan.available ? fmtClock(plan.etaMin) : "--:--"}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip tone={windowTone}>{windowText}</Chip>
                <span className="text-xs text-muted">Appointment {fmtClock(lane.appointmentMin)}</span>
              </div>
            </div>

            <div className="space-y-3">
              {eta.rerouted && eta.previousEtaMin !== null && (
                <div className="rounded-lg border border-good/50 bg-good/[0.08] p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span aria-hidden className="text-good">
                      ↻
                    </span>
                    ETA updated to protect the delivery window
                  </div>
                  <div className="tabular mt-1 font-mono text-sm text-ink-2">
                    <span className="text-muted line-through">{fmtClock(eta.previousEtaMin)}</span>
                    <span className="mx-2 text-muted">→</span>
                    <span className="text-ink">{fmtClock(plan.etaMin)}</span>
                    <span className="ml-2 text-xs text-muted">
                      via {routePort.shortName}, {fmtDur((state.decision ?? decision).savingsMin)} earlier
                    </span>
                  </div>
                </div>
              )}
              {eta.pendingReroute && (
                <div className="rounded-lg border border-warning/50 bg-warning/[0.08] p-3 text-sm text-ink">
                  <span className="font-semibold">Reroute pending.</span>{" "}
                  <span className="text-ink-2">
                    Dispatch proposed {PORTS[(state.decision ?? decision).alternative.port].shortName}. Waiting for the driver&apos;s voice
                    confirmation; ETA will update automatically.
                  </span>
                </div>
              )}
              {!eta.rerouted && !eta.pendingReroute && (
                <div className="rounded-lg border border-line bg-panel-2 p-3 text-sm text-ink-2">
                  {state.status === "draft"
                    ? `On booked route via ${routePort.shortName}. Any route exception from dispatch will appear here.`
                    : receiverStatusLabel(state, decision)}
                </div>
              )}

            </div>
          </div>

          <CorridorBar plan={plan} status={state.status} originCity={lane.originCity} />

          <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line px-5 py-4 md:grid-cols-4">
            <BoardField label="Load" mono>
              {LOAD.id}
            </BoardField>
            <BoardField label="Carrier unit" mono>
              {LOAD.unit}
            </BoardField>
            <BoardField label="Cargo">{LOAD.cargo}</BoardField>
            <BoardField label="Origin">{lane.origin}</BoardField>
            <BoardField label="Status">
              <span className="inline-flex items-center gap-1.5">
                <Swatch color={PORT_COLOR[plan.port]} />
                {receiverStatusLabel(state, decision)}
              </span>
            </BoardField>
            <BoardField label="Port of entry">{routePort.name}</BoardField>
            <BoardField label="Border wait" mono>
              {plan.available ? fmtDur(plan.waitMin) : "Closed"}
            </BoardField>
            <BoardField label="Departed" mono>
              {fmtClock(plan.departMin)}
            </BoardField>
          </div>
        </section>

        <div className="space-y-4">
          {overdue && (
            <section
              className={`rounded-xl border-2 p-4 ${escalated ? "border-warning/60 bg-warning/[0.07]" : "border-critical/70 bg-critical/[0.10]"}`}
              role="alert"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base font-bold ${
                    escalated ? "bg-warning/20 text-warning" : "bp-pulse bg-critical/25 text-critical"
                  }`}
                >
                  !
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-ink">Dock Exception: Load Overdue</h2>
                  <p className="tabular mt-1 text-xs text-ink-2">
                    Truck has not arrived by the expected ETA ({fmtClock(plan.etaMin)}).
                  </p>
                  <button
                    onClick={() => dispatch({ type: "receiver_escalate", simMin: scenario.minuteOfDay, at: Date.now() })}
                    disabled={escalated}
                    className="mt-3 w-full rounded-lg bg-critical px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-ink-2 disabled:ring-1 disabled:ring-warning/50"
                  >
                    {escalated ? "Escalation Active" : "Report Overdue to Dispatch"}
                  </button>
                  <p className="mt-2 text-[11px] text-muted">
                    {escalated
                      ? "Priority dispatch has been notified. The driver is not contacted from the dock."
                      : "Notifies dispatch only. The driver is not contacted from the dock."}
                  </p>
                </div>
              </div>
            </section>
          )}
          <Panel title="Route exception log" subtitle="Why this load's route or ETA changed. Read-only." right={<Chip tone="neutral">Auto-updating</Chip>}>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted">No route exceptions. The load is on its booked route.</p>
            ) : (
              <ol className="relative max-h-80 space-y-3 overflow-auto border-l border-line pl-4" aria-live="polite">
                {timeline.map((e) => {
                  const badge = SOURCE_BADGE[e.source];
                  return (
                    <li key={e.id} className="relative text-xs">
                      <span aria-hidden className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full border border-line bg-panel-2" />
                      <div className="tabular flex flex-wrap items-center gap-1.5 text-muted">
                        <span>
                          {(state.decision ?? decision).dataSource === "cbp" ? `${fmtClock(e.simMin)} PT` : `sim ${fmtClock(e.simMin)}`} ·{" "}
                          {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                        {badge && (
                          <span className={`rounded border px-1 py-px font-mono text-[9px] font-semibold tracking-wider ${badge.cls}`}>
                            {badge.label}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-ink">{e.text}</div>
                      {e.detail && <div className="tabular text-muted">{e.detail}</div>}
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          <section className="rounded-xl border border-line bg-panel p-4">
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </span>
              <div>
                <h2 className="text-sm font-semibold text-ink">Monitor only: no driver contact from the dock</h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-2">
                  Receivers can&apos;t call or message the driver from this console; exceptions go to dispatch. All driver communication runs through dispatch&apos;s
                  hands-free voice channel, keeping drivers off hand-held phones (FMCSA, 49 CFR 392.82). The ETA, status and appointment
                  update automatically as dispatch and the driver act.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
