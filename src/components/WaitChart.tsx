"use client";

import { useMemo, useState } from "react";
import { PORTS, PORT_IDS, daySeries, fmtClock, fmtDur, type PortId, type SeriesPoint } from "@/lib/sim";
import { PORT_COLOR, Panel, SimTag, Swatch } from "./ui";

const W = 720;
const H = 260;
const M = { top: 16, right: 96, bottom: 28, left: 40 };
const FROM = 5 * 60;
const TO = 23 * 60;

export default function WaitChart({
  nowMin,
  primary,
  bottleneck,
  live,
}: {
  nowMin: number;
  primary: PortId;
  bottleneck: boolean;
  /** Current CBP delays, drawn as dots at "Now" over the model baseline. */
  live?: Partial<Record<PortId, number | null>>;
}) {
  const data = useMemo(() => daySeries(primary, bottleneck, 10, FROM, TO), [primary, bottleneck]);
  const [hover, setHover] = useState<SeriesPoint | null>(null);
  const [showTable, setShowTable] = useState(false);

  const maxY = Math.max(
    60,
    Math.ceil(Math.max(...data.flatMap((d) => PORT_IDS.map((p) => d.values[p] ?? 0)), ...PORT_IDS.map((p) => live?.[p] ?? 0)) / 60) * 60,
  );
  const x = (m: number) => M.left + ((m - FROM) / (TO - FROM)) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - v / maxY) * (H - M.top - M.bottom);

  const path = (key: PortId) => {
    let d = "";
    let pen = false;
    for (const p of data) {
      const v = p.values[key];
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(p.minute).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const lastPoint = (key: PortId) => [...data].reverse().find((p) => p.values[key] != null)!;
  const yTicks = Array.from({ length: maxY / 60 + 1 }, (_, i) => i * 60);
  const xTicks = Array.from({ length: (TO - FROM) / 180 + 1 }, (_, i) => FROM + i * 180);
  const nowX = x(Math.min(TO, Math.max(FROM, nowMin)));
  // Live dots at "Now", with labels nudged apart when readings are close.
  const liveDots: { port: PortId; value: number; cx: number; cy: number; labelY: number }[] = [];
  for (const p of PORT_IDS) {
    const v = live?.[p];
    if (v == null) continue;
    const cy = y(Math.min(v, maxY));
    const overlapping = liveDots.filter((d) => Math.abs(d.cy - cy) < 8).length;
    liveDots.push({ port: p, value: v, cx: nowX + overlapping * 11, cy, labelY: 0 });
  }
  liveDots.sort((a, b) => b.cy - a.cy);
  liveDots.forEach((d, i) => (d.labelY = i === 0 ? d.cy : Math.min(d.cy, liveDots[i - 1].labelY - 13)));
  const labelX = Math.max(nowX, ...liveDots.map((d) => d.cx)) + 10;
  // Draw the primary route last so it sits on top.
  const order = [...PORT_IDS.filter((p) => p !== primary), primary];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const minute = FROM + ((px - M.left) / (W - M.left - M.right)) * (TO - FROM);
    const nearest = data.reduce((a, b) => (Math.abs(b.minute - minute) < Math.abs(a.minute - minute) ? b : a));
    setHover(nearest);
  }

  return (
    <Panel
      title={live ? "CBP live delay vs. model baseline" : "Commercial wait forecast"}
      subtitle={
        live
          ? "Dots: current CBP commercial delay. Faded lines: deterministic model baseline for context."
          : "Projected wait for a truck arriving at each hour. Gaps are simulated closed hours."
      }
      right={
        <div className="flex items-center gap-3">
          {live ? <SimTag>MODEL BASELINE</SimTag> : <SimTag />}
          <button onClick={() => setShowTable((s) => !s)} className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-panel-2">
            {showTable ? "Chart" : "Table"}
          </button>
        </div>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        {PORT_IDS.map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <Swatch color={PORT_COLOR[p]} /> {PORTS[p].shortName}
            {p === primary && <span className="text-muted">(primary{bottleneck ? ", bottleneck" : ""})</span>}
          </span>
        ))}
        {live && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2 border-ink bg-ink-2" /> CBP live reading
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-px border-l border-dashed border-ink-2" /> {live ? "Now" : "Now (sim clock)"}
        </span>
      </div>

      {showTable ? (
        <div className="max-h-[260px] overflow-auto rounded-md border border-line">
          <table className="tabular w-full text-left text-xs">
            <thead className="sticky top-0 bg-panel-2 text-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">Arrival</th>
                {PORT_IDS.map((p) => (
                  <th key={p} className="px-3 py-1.5 font-medium">
                    {PORTS[p].shortName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data
                .filter((d) => d.minute % 60 === 0)
                .map((d) => (
                  <tr key={d.minute} className="border-t border-line text-ink-2">
                    <td className="px-3 py-1.5">{fmtClock(d.minute)}</td>
                    {PORT_IDS.map((p) => (
                      <td key={p} className="px-3 py-1.5">
                        {d.values[p] == null ? "Closed" : fmtDur(d.values[p]!)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none select-none"
            role="img"
            aria-label="Simulated commercial wait time forecast for four ports across the day"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
                  {t === 0 ? "0" : `${t / 60}h`}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                {fmtClock(t).replace(":00", "")}
              </text>
            ))}

            {order.map((p) => (
              <path
                key={p}
                d={path(p)}
                fill="none"
                stroke={PORT_COLOR[p]}
                strokeWidth={p === primary ? 2.5 : 2}
                strokeOpacity={live ? 0.3 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {!live &&
              PORT_IDS.map((p) => {
              const pt = lastPoint(p);
              return (
                <text
                  key={p}
                  x={x(pt.minute) + 6}
                  y={y(pt.values[p]!) + 4}
                  fontSize={11}
                  fill="var(--ink-2)"
                  stroke="var(--panel)"
                  strokeWidth={4}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                >
                  {PORTS[p].shortName}
                </text>
              );
            })}

            <line x1={nowX} x2={nowX} y1={M.top} y2={H - M.bottom} stroke="var(--ink-2)" strokeDasharray="3 3" strokeWidth={1} />
            <text x={nowX + 4} y={M.top + 10} fontSize={11} fill="var(--ink-2)">
              Now
            </text>

            {live &&
              liveDots.map((d) => (
                <g key={d.port}>
                  <circle cx={d.cx} cy={d.cy} r={6} fill={PORT_COLOR[d.port]} stroke="var(--ink)" strokeWidth={2} />
                  <text
                    x={labelX}
                    y={d.labelY + 4}
                    fontSize={11}
                    fill="var(--ink)"
                    stroke="var(--panel)"
                    strokeWidth={4}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                  >
                    {PORTS[d.port].shortName} {fmtDur(d.value)}
                  </text>
                </g>
              ))}

            {hover && (
              <g pointerEvents="none">
                <line x1={x(hover.minute)} x2={x(hover.minute)} y1={M.top} y2={H - M.bottom} stroke="var(--muted)" strokeWidth={1} />
                {PORT_IDS.map((p) =>
                  hover.values[p] == null ? null : (
                    <circle key={p} cx={x(hover.minute)} cy={y(hover.values[p]!)} r={4.5} fill={PORT_COLOR[p]} stroke="var(--panel)" strokeWidth={2} />
                  ),
                )}
              </g>
            )}
          </svg>

          {hover && (
            <div
              className="pointer-events-none absolute top-2 rounded-md border border-line bg-panel-2/95 px-3 py-2 text-xs shadow-lg"
              style={{
                left: `${(x(hover.minute) / W) * 100}%`,
                transform: x(hover.minute) > W * 0.6 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
              }}
            >
              <div className="mb-1 font-medium text-ink">Arrive {fmtClock(hover.minute)}</div>
              {PORT_IDS.map((p) => (
                <div key={p} className="tabular flex items-center gap-2 text-ink-2">
                  <Swatch color={PORT_COLOR[p]} />
                  <span className="w-24">{PORTS[p].shortName}</span>
                  <span className="text-ink">{hover.values[p] == null ? "Closed" : fmtDur(hover.values[p]!)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
