"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  DEFAULT_SCENARIO,
  LANES,
  LOAD,
  PORTS,
  PORT_IDS,
  fmtClock,
  fmtDur,
  isOpen,
  recommend,
  waitAt,
  type Decision,
  type PortId,
  type Scenario,
} from "@/lib/sim";
import { dispatchReducer, initialDispatch, isEscalated, type CallMode } from "@/lib/dispatch";
import { pacificMinuteOfDay, type CbpResponse } from "@/lib/cbp";
import CallPanel, { useBroadcastRunner, type Act, type Capabilities } from "./CallPanel";
import RouteCompare from "./RouteCompare";
import Recommendation from "./Recommendation";
import StatusTracker from "./StatusTracker";
import WaitChart from "./WaitChart";
import WarehouseReceiverView from "./WarehouseReceiverView";
import { Chip, PORT_COLOR, SimTag, Swatch, type Tone } from "./ui";

type Profile = "dispatcher" | "warehouse";

const PROFILES: { id: Profile; label: string; short: string }[] = [
  { id: "dispatcher", label: "Dispatcher (Control Tower)", short: "Dispatcher" },
  { id: "warehouse", label: "Warehouse Receiver (Dock)", short: "Receiver" },
];

function ProfileSwitcher({ profile, setProfile }: { profile: Profile; setProfile: (p: Profile) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-bg p-0.5" role="radiogroup" aria-label="Profile">
      {PROFILES.map((p) => (
        <button
          key={p.id}
          role="radio"
          aria-checked={profile === p.id}
          aria-label={p.label}
          onClick={() => setProfile(p.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            profile === p.id ? "bg-otay/20 text-ink ring-1 ring-otay/50" : "text-muted hover:text-ink"
          }`}
        >
          <span className="hidden sm:inline">{p.label}</span>
          <span className="sm:hidden">{p.short}</span>
        </button>
      ))}
    </div>
  );
}

type DataSource = "cbp" | "model";

const CBP_POLL_MS = 60_000;

function DataSourceToggle({ source, setSource }: { source: DataSource; setSource: (s: DataSource) => void }) {
  const options: { id: DataSource; label: string }[] = [
    { id: "cbp", label: "CBP Live Telemetry" },
    { id: "model", label: "Deterministic Model" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-line bg-bg p-0.5" role="radiogroup" aria-label="Data source">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={source === o.id}
          onClick={() => setSource(o.id)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            source === o.id ? "bg-panel-2 text-ink ring-1 ring-line" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** CBP stamps are port-local wall-clock time ("10/24/2026" + "16:34:46"). */
function fmtCbpStamp(stamp: string): string {
  const d = new Date(stamp);
  return Number.isNaN(d.getTime())
    ? stamp
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Kpi({ label, value, sub, color, tone }: { label: string; value: string; sub: React.ReactNode; color?: string; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {color && <Swatch color={color} />}
        {label}
      </div>
      <div className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-ink-2">{tone ? <Chip tone={tone}>{sub}</Chip> : sub}</div>
    </div>
  );
}

export default function Dashboard() {
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);
  const [playing, setPlaying] = useState(false);
  const [state, dispatch] = useReducer(dispatchReducer, initialDispatch);
  const [mode, setMode] = useState<CallMode>("simulated");
  const [voiceOn, setVoiceOn] = useState(true);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [profile, setProfile] = useState<"dispatcher" | "warehouse">("dispatcher");
  const [dataSource, setDataSource] = useState<DataSource>("model");
  const [cbp, setCbp] = useState<CbpResponse | null>(null);
  const [cbpLoading, setCbpLoading] = useState(false);
  const [nowMin, setNowMin] = useState(() => pacificMinuteOfDay());

  const isLive = dataSource === "cbp";
  // Live mode departs "now" with CBP readings; model mode keeps the slider and bottleneck controls.
  const effective: Scenario = useMemo(
    () => (isLive && cbp ? { ...scenario, minuteOfDay: nowMin, bottleneck: false, live: cbp.ports } : scenario),
    [isLive, cbp, nowMin, scenario],
  );

  const simRef = useRef(effective.minuteOfDay);
  simRef.current = effective.minuteOfDay;

  const act: Act = useCallback(
    (a) => dispatch({ ...a, simMin: simRef.current, at: Date.now() } as Parameters<typeof dispatch>[0]),
    [],
  );
  const runner = useBroadcastRunner(act, voiceOn);

  useEffect(() => {
    const fallback: Capabilities = { configured: false, maskedTo: null };
    fetch("/api/dispatch")
      .then((r) => (r.ok ? r.json() : fallback))
      .then((c: Capabilities) => {
        setCaps(c);
        // Default to the real Vapi call whenever the server is configured for it.
        if (c.configured) setMode("live");
      })
      .catch(() => setCaps(fallback));
  }, []);

  // CBP feed: fetch on entering live mode, then poll; keep the live clock current.
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    const load = async () => {
      setCbpLoading(true);
      try {
        const res = await fetch("/api/cbp", { cache: "no-store" });
        const body = (await res.json()) as CbpResponse;
        if (!cancelled && body?.ports) setCbp(body);
      } catch {
        // Keep the last good reading; the badge shows when data is stale or from the model.
      } finally {
        if (!cancelled) setCbpLoading(false);
      }
    };
    void load();
    setNowMin(pacificMinuteOfDay());
    setPlaying(false);
    const poll = window.setInterval(load, CBP_POLL_MS);
    const tick = window.setInterval(() => setNowMin(pacificMinuteOfDay()), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [isLive]);

  // Sim clock: real time while playing (1 simulated minute per 60 real seconds).
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(
      () => setScenario((s) => (s.minuteOfDay >= 23 * 60 ? s : { ...s, minuteOfDay: s.minuteOfDay + 1 })),
      60_000,
    );
    return () => window.clearInterval(t);
  }, [playing]);

  // Stop the runner (timers, polling, speech) once the broadcast is resolved.
  const { stop } = runner;
  useEffect(() => {
    if (state.status !== "broadcasting") stop();
  }, [state.status, stop]);

  const live = useMemo(() => recommend(effective), [effective]);

  const startBroadcast = (decision: Decision = state.decision ?? live) => {
    act({ type: "start", decision, mode });
    runner.start(mode, decision);
  };

  const resetAll = () => {
    runner.stop();
    setPlaying(false);
    dispatch({ type: "reset" });
  };

  const primaryId = scenario.primary;
  const lane = LANES[primaryId];
  const reading = effective.live?.[primaryId];
  const primaryNow = reading ? (reading.delayMin ?? 0) : waitAt(primaryId, effective.minuteOfDay, effective.bottleneck);
  const primaryOpen = reading ? reading.open && reading.delayMin !== null : isOpen(primaryId, effective.minuteOfDay);
  const cbpLive = isLive && cbp?.source === "cbp";
  const liveDelays = effective.live
    ? Object.fromEntries(PORT_IDS.map((p) => [p, effective.live?.[p]?.open ? (effective.live[p]?.delayMin ?? null) : null]))
    : undefined;
  // Once dispatched, route KPIs follow the locked plan rather than re-planning from the current clock.
  const plan = state.decision ?? live;
  const alt = plan.alternative;
  const best = plan.port ? plan.plans[plan.port] : null;
  const pTone: Tone = primaryNow >= 150 ? "critical" : primaryNow >= 90 ? "serious" : primaryNow >= 45 ? "warning" : "good";
  const pLevel = primaryNow >= 150 ? "Severe congestion" : primaryNow >= 90 ? "Heavy congestion" : primaryNow >= 45 ? "Moderate" : "Light";
  const locked = state.status !== "draft";

  return (
    <div className="min-h-screen">
      {cbpLive ? (
        <div className="border-b border-good/30 bg-good/10 px-4 py-1.5 text-center text-xs text-ink">
          <span className="font-semibold text-good">Live CBP wait times.</span> Commercial delays come from U.S. CBP&apos;s public Border
          Wait Times feed. Drive times, the driver persona and the load are simulated. The driver call is real only in Live (Vapi) mode.
        </div>
      ) : (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-center text-xs text-ink">
          <span className="font-semibold text-warning">Demo · simulated border data.</span> Wait times, drive times, port hours, the
          bottleneck, the driver persona and the load are fictional. The driver call is real only in Live (Vapi) mode.
        </div>
      )}

      <header className="border-b border-line bg-panel/60">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-otay/15 text-otay" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M2 12h4l3-7 4 14 3-7h6" />
              </svg>
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight">BorderPulse</div>
              <div className="text-xs text-muted">Zero-touch cross-border dispatch · California–Baja–Arizona</div>
            </div>
            <ProfileSwitcher profile={profile} setProfile={setProfile} />
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <DataSourceToggle source={dataSource} setSource={setDataSource} />
              {isLive && (
                <span className="inline-flex items-center gap-1.5" aria-live="polite">
                  {cbpLive ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-good/40 bg-good/10 px-2 py-0.5 text-xs font-medium text-ink">
                      <span aria-hidden className="bp-pulse text-good">
                        ●
                      </span>
                      CBP Live Feed (Connected)
                    </span>
                  ) : cbp ? (
                    <Chip tone="warning" className="max-w-[240px] truncate">
                      CBP unreachable · model fallback
                    </Chip>
                  ) : (
                    <Chip tone="neutral">{cbpLoading ? "Connecting to CBP…" : "CBP not loaded"}</Chip>
                  )}
                  {cbpLive && cbp?.lastUpdated && (
                    <span className="tabular text-muted" title="CBP record time (port local)">
                      Updated {fmtCbpStamp(cbp.lastUpdated)} PT
                    </span>
                  )}
                </span>
              )}
            </div>
            {profile === "dispatcher" && (
            <label className="flex items-center gap-2" title={locked ? "Reset the dispatch to change the primary route" : undefined}>
              <span className="text-muted">Primary route</span>
              <span className="relative">
                <select
                  value={primaryId}
                  disabled={locked}
                  onChange={(e) => setScenario((s) => ({ ...s, primary: e.target.value as PortId }))}
                  className="appearance-none rounded-md border border-line bg-panel-2 py-1 pr-7 pl-6 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Primary active route"
                >
                  {PORT_IDS.map((p) => (
                    <option key={p} value={p}>
                      {PORTS[p].shortName}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2">
                  <Swatch color={PORT_COLOR[primaryId]} />
                </span>
                <span aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted">
                  ▾
                </span>
              </span>
            </label>
            )}
            <div className="flex items-center gap-2">
              <span className="text-muted">{isLive ? "Now (PT)" : "Sim clock"}</span>
              <span className="tabular rounded-md border border-line bg-panel-2 px-2 py-1 font-mono text-sm text-ink">
                {fmtClock(effective.minuteOfDay)}
              </span>
              {!isLive && (
                <button
                  onClick={() => setPlaying((p) => !p)}
                  className="rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-panel-2"
                  aria-pressed={playing}
                >
                  {playing ? "❚❚ Pause" : "▶ Play"}
                </button>
              )}
            </div>
            {profile === "dispatcher" && !isLive && (
            <>
            <label className="flex items-center gap-2">
              <span className="text-muted">Departure</span>
              <input
                type="range"
                min={5 * 60}
                max={23 * 60}
                step={5}
                value={scenario.minuteOfDay}
                onChange={(e) => setScenario((s) => ({ ...s, minuteOfDay: Number(e.target.value) }))}
                className="w-32"
                aria-label="Simulated departure time"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={scenario.bottleneck}
                onChange={(e) => setScenario((s) => ({ ...s, bottleneck: e.target.checked }))}
                className="accent-[var(--critical)]"
              />
              <span className="text-ink-2">Simulate bottleneck at {PORTS[primaryId].shortName}</span>
            </label>
            <button
              onClick={() => {
                resetAll();
                setScenario(DEFAULT_SCENARIO);
              }}
              className="rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-panel-2"
            >
              Reset demo
            </button>
            </>
            )}
          </div>
        </div>
      </header>

      <main key={profile} className="bp-fade mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
        {profile === "warehouse" ? (
          <WarehouseReceiverView state={state} scenario={effective} decision={live} dispatch={dispatch} />
        ) : (
        <>
        {isEscalated(state) && (
          <div role="alert" className="rounded-xl border-2 border-critical bg-critical p-4 text-center text-lg font-bold text-white">
            🚨 EMERGENCY ESCALATION: Receiving Dock Reported Load Overdue Past ETA.
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Load {LOAD.id} · {LOAD.unit} · {LOAD.driver}
            </h1>
            <p className="text-xs text-muted">
              {LOAD.cargo} · {lane.origin} → {lane.destination} · delivery appointment {fmtClock(lane.appointmentMin)}
            </p>
          </div>
          {cbpLive ? <Chip tone="good">CBP live waits · simulated load</Chip> : <SimTag>SIMULATED SCENARIO</SimTag>}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Current Wait"
            color={PORT_COLOR[primaryId]}
            value={primaryOpen ? fmtDur(primaryNow) : "Closed"}
            sub={
              primaryOpen
                ? `${PORTS[primaryId].shortName} · ${pLevel}`
                : reading
                  ? `${reading.source === "cbp" ? "CBP" : "Model"}: ${reading.status}`
                  : "Outside simulated hours"
            }
            tone={primaryOpen ? pTone : "neutral"}
          />
          <Kpi
            label="Best Alternative"
            color={PORT_COLOR[alt.port]}
            value={alt.available ? fmtDur(alt.waitMin) : "Closed"}
            sub={
              alt.available
                ? PORTS[alt.port].shortName
                : `${PORTS[alt.port].shortName} · closed`
            }
          />
          <Kpi
            label="Fastest Route"
            value={best ? fmtDur(best.totalMin) : "—"}
            sub={best ? `${PORTS[best.port].shortName} · ETA ${fmtClock(best.etaMin)}` : "No open port"}
          />
          <Kpi
            label="Appointment"
            value={best ? (best.appointmentDeltaMin > 0 ? `+${fmtDur(best.appointmentDeltaMin)}` : "On time") : "—"}
            sub={
              best
                ? best.appointmentDeltaMin > 0
                  ? "Late"
                  : `${fmtDur(-best.appointmentDeltaMin)} buffer`
                : "Hold at origin"
            }
            tone={best ? (best.appointmentDeltaMin > 0 ? "critical" : best.appointmentDeltaMin > -30 ? "warning" : "good") : "neutral"}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <WaitChart nowMin={effective.minuteOfDay} primary={primaryId} bottleneck={effective.bottleneck} live={liveDelays} />
          <Recommendation live={live} dispatch={state} liveCall={mode === "live"} onDispatch={() => startBroadcast(live)} />
        </div>

        <RouteCompare decision={state.decision ?? live} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <CallPanel
            state={state}
            act={act}
            caps={caps}
            mode={mode}
            setMode={setMode}
            voiceOn={voiceOn}
            setVoiceOn={setVoiceOn}
            lineIdx={runner.lineIdx}
            onRetry={() => startBroadcast()}
          />
          <StatusTracker state={state} onAdvance={() => act({ type: "advance" })} onReset={resetAll} />
        </div>
        </>
        )}
      </main>
    </div>
  );
}
