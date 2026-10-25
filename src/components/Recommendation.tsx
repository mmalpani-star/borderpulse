import { DIVERT_THRESHOLD_MIN, PORTS, fmtClock, fmtDur, type Decision } from "@/lib/sim";
import { ZERO_TOUCH_NOTICE, type DispatchState } from "@/lib/dispatch";
import { Chip, PORT_COLOR, Panel, type Tone } from "./ui";

const CONF_TONE: Record<Decision["confidence"], Tone> = { high: "good", medium: "warning", low: "serious" };

export default function Recommendation({
  live,
  dispatch,
  liveCall,
  onDispatch,
}: {
  live: Decision;
  dispatch: DispatchState;
  liveCall: boolean;
  onDispatch: () => void;
}) {
  const locked = dispatch.decision;
  const shown = locked ?? live;
  const drifted = locked && (locked.action !== live.action || Math.abs(locked.savingsMin - live.savingsMin) >= 15);
  const pName = PORTS[shown.primary.port].shortName;
  const aName = PORTS[shown.alternative.port].shortName;

  return (
    <Panel
      title="Recommended dispatch"
      subtitle={
        locked
          ? `Locked at dispatch, ${locked.dataSource === "cbp" ? "" : "sim "}${fmtClock(locked.computedAtSimMin)}`
          : live.dataSource === "cbp"
            ? "Updates with each CBP feed refresh"
            : "Updates live with the scenario"
      }
      right={<Chip tone={CONF_TONE[shown.confidence]}>{shown.confidence} confidence</Chip>}
      className="flex flex-col"
    >
      <div className="text-2xl font-semibold tracking-tight" style={{ color: shown.port ? PORT_COLOR[shown.port] : "var(--warning)" }}>
        {shown.headline}
      </div>
      <div className="tabular mt-1 text-sm text-ink-2">
        {shown.action === "divert" && shown.savingsMin > 0 && (
          <>
            Saves {fmtDur(shown.savingsMin)} door to door vs. {pName}
          </>
        )}
        {shown.action === "stay" && !shown.alternative.available && <>Only open option at arrival</>}
        {shown.action === "stay" && shown.alternative.available && shown.savingsMin <= 0 && (
          <>
            Fastest option by {fmtDur(-shown.savingsMin)} over {aName}
          </>
        )}
        {shown.action === "stay" && shown.alternative.available && shown.savingsMin > 0 && (
          <>
            {aName} would save only {fmtDur(shown.savingsMin)}
          </>
        )}
        {shown.action === "hold" && <>No simulated port open at arrival</>}
      </div>

      <ul className="mt-4 space-y-2 text-sm text-ink-2">
        {shown.reasons.map((r) => (
          <li key={r} className="flex gap-2">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />
            <span>{r}</span>
          </li>
        ))}
      </ul>

      {drifted && (
        <div className="mt-4">
          <Chip tone="warning">Conditions changed: live recommendation is now &ldquo;{live.headline}&rdquo;</Chip>
        </div>
      )}

      <div className="mt-5">
        {dispatch.status === "draft" ? (
          <button
            onClick={onDispatch}
            disabled={shown.action === "hold"}
            title={ZERO_TOUCH_NOTICE}
            className="w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-bg transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Dispatch &amp; call driver {liveCall ? "· LIVE" : "· simulated"}
          </button>
        ) : (
          <p className="text-xs text-muted">
            {dispatch.status === "broadcasting" ? "Broadcast in progress." : "Dispatch locked."} Track it in the broadcast panel and status
            tracker below.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-2">{ZERO_TOUCH_NOTICE}</p>
        <p className="mt-2 text-xs text-muted">
          Rule: divert only if the best open alternative saves ≥ {DIVERT_THRESHOLD_MIN} min door to door.{" "}
          {shown.dataSource === "cbp" ? "Waits from CBP; drive times simulated." : "Forecasts are simulated."}
        </p>
      </div>
    </Panel>
  );
}
