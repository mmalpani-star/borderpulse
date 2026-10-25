import { LANES, PORTS, PORT_IDS, fmtClock, fmtDur, type Decision, type TripPlan } from "@/lib/sim";
import { Chip, PORT_COLOR, Panel, SimTag, Swatch } from "./ui";

function appointmentChip(plan: TripPlan) {
  if (!plan.available) return <Chip tone="neutral">Unavailable</Chip>;
  const d = plan.appointmentDeltaMin;
  if (d > 0) return <Chip tone="critical">Late by {fmtDur(d)}</Chip>;
  if (d > -30) return <Chip tone="warning">On time, {fmtDur(-d)} buffer</Chip>;
  return <Chip tone="good">On time, {fmtDur(-d)} early</Chip>;
}

function RouteCard({ plan, role, scaleMax, recommended }: { plan: TripPlan; role: string; scaleMax: number; recommended: boolean }) {
  const port = PORTS[plan.port];
  const color = PORT_COLOR[plan.port];
  const segments = [
    { label: "Drive to port", min: plan.toPortMin, color: "var(--drive)" },
    { label: "Border wait", min: plan.waitMin, color },
    { label: "Drive to destination", min: plan.fromPortMin, color: "var(--drive)" },
  ];

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${recommended ? "border-good/60 bg-good/[0.06]" : "border-line bg-panel-2"} ${
        plan.available ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted">{role}</div>
          <div className="mt-0.5 flex items-center gap-2 text-sm font-semibold">
            <Swatch color={color} /> via {port.shortName}
          </div>
          <div className="mt-0.5 text-xs text-muted">{plan.via}</div>
        </div>
        {recommended && <Chip tone="good">Recommended</Chip>}
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-xs text-muted">Total trip time</div>
          <div className="tabular text-3xl font-semibold tracking-tight">{fmtDur(plan.totalMin)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">ETA at destination</div>
          <div className="tabular text-lg font-medium">{fmtClock(plan.etaMin)}</div>
        </div>
      </div>

      <div className="mt-3 flex h-3 gap-[2px] overflow-hidden" role="img" aria-label={segments.map((s) => `${s.label} ${fmtDur(s.min)}`).join(", ")}>
        {segments.map((s, i) => (
          <div
            key={s.label}
            style={{ width: `${(s.min / scaleMax) * 100}%`, background: s.color }}
            className={`${i === 0 ? "rounded-l" : ""} ${i === segments.length - 1 ? "rounded-r" : ""}`}
          />
        ))}
      </div>
      <dl className="tabular mt-2 grid grid-cols-3 gap-2 text-xs">
        {segments.map((s) => (
          <div key={s.label}>
            <dt className="text-muted">{s.label}</dt>
            <dd className="text-ink">{fmtDur(s.min)}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-ink-2">
        {appointmentChip(plan)}
        {plan.available ? <span>Arrives at port {fmtClock(plan.arrivePortMin)}</span> : <span>{plan.unavailableReason}</span>}
      </div>
    </div>
  );
}

export default function RouteCompare({ decision }: { decision: Decision }) {
  const liveData = decision.dataSource === "cbp";
  const { primary, alternative, plans } = decision;
  const lane = LANES[primary.port];
  const scaleMax = Math.max(primary.totalMin, alternative.totalMin);
  const ranked = [...PORT_IDS].sort((a, b) => Number(plans[b].available) - Number(plans[a].available) || plans[a].totalMin - plans[b].totalMin);

  return (
    <Panel
      title="Door-to-door comparison"
      subtitle={`${lane.origin} → ${lane.destination} · departing ${fmtClock(decision.computedAtSimMin)} · appointment ${fmtClock(lane.appointmentMin)}`}
      right={liveData ? <SimTag>CBP WAITS · SIMULATED DRIVE TIMES</SimTag> : <SimTag />}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <RouteCard plan={primary} role="Primary route" scaleMax={scaleMax} recommended={decision.port === primary.port} />
        <RouteCard plan={alternative} role="Best alternative" scaleMax={scaleMax} recommended={decision.port === alternative.port} />
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-line">
        <table className="tabular w-full min-w-[520px] text-left text-xs">
          <thead className="bg-panel-2 text-muted">
            <tr>
              <th className="px-3 py-1.5 font-medium">All ports</th>
              <th className="px-3 py-1.5 font-medium">Arrive at port</th>
              <th className="px-3 py-1.5 font-medium">Wait</th>
              <th className="px-3 py-1.5 font-medium">Door to door</th>
              <th className="px-3 py-1.5 font-medium">ETA</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => {
              const plan = plans[p];
              return (
                <tr key={p} className="border-t border-line text-ink-2">
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5 text-ink">
                      <Swatch color={PORT_COLOR[p]} /> {PORTS[p].shortName}
                      {p === primary.port && <span className="text-muted">(primary)</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{fmtClock(plan.arrivePortMin)}</td>
                  <td className="px-3 py-1.5">{plan.available ? fmtDur(plan.waitMin) : "—"}</td>
                  <td className="px-3 py-1.5 text-ink">{plan.available ? fmtDur(plan.totalMin) : "—"}</td>
                  <td className="px-3 py-1.5">{plan.available ? fmtClock(plan.etaMin) : "—"}</td>
                  <td className="px-3 py-1.5">{plan.available ? (decision.port === p ? "Recommended" : "Open") : "Closed at arrival"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Bars share one scale. Gray segments are drive time; colored segments are the border wait.{" "}
        {liveData
          ? "Waits are current CBP commercial delays applied at arrival; drive times are simulated."
          : "Drive times and waits are simulated values for this demo."}
      </p>
    </Panel>
  );
}
