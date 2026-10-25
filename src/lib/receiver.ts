// Receiver (warehouse dock) projections of the shared dispatch state. Read-only.
import type { Decision, TripPlan } from "./sim.ts";
import { PORTS, fmtClock, fmtDur } from "./sim.ts";
import { LOG_TEXT, type DispatchState, type DispatchStatus, type EventSource } from "./dispatch.ts";

const ACCEPTED: DispatchStatus[] = ["confirmed", "en_route", "at_port", "crossed", "delivered"];

export function isRerouted(state: DispatchState): boolean {
  return !!state.decision && state.decision.action === "divert" && ACCEPTED.includes(state.status);
}

export interface ReceiverEta {
  /** The plan the truck is actually on, from the dock's point of view. */
  plan: TripPlan;
  /** ETA on the original route, when the load was rerouted. */
  previousEtaMin: number | null;
  rerouted: boolean;
  pendingReroute: boolean;
}

/**
 * Until the driver confirms, the load is on its booked (primary) route.
 * After confirmation, the dock sees the recommended route's ETA.
 */
export function receiverEta(state: DispatchState, live: Decision): ReceiverEta {
  const d = state.decision ?? live;
  const rerouted = isRerouted(state);
  const plan = rerouted && d.port ? d.plans[d.port] : d.primary;
  return {
    plan,
    previousEtaMin: rerouted ? d.primary.etaMin : null,
    rerouted,
    pendingReroute: state.status === "broadcasting" && d.action === "divert",
  };
}

export function receiverStatusLabel(state: DispatchState, live: Decision): string {
  const d = state.decision ?? live;
  const routed = PORTS[(isRerouted(state) && d.port) || d.primary.port].shortName;
  switch (state.status) {
    case "draft":
      return `Scheduled via ${routed}`;
    case "broadcasting":
      return d.action === "divert" ? "Reroute proposed · awaiting driver" : `Route update sent · via ${routed}`;
    case "confirmed":
      return d.action === "divert" ? `Rerouted via ${routed}` : `Confirmed via ${routed}`;
    case "en_route":
      return `En route via ${routed}`;
    case "at_port":
      return `At ${routed} port of entry`;
    case "crossed":
      return "Crossed into U.S. · inbound to dock";
    case "delivered":
      return "Arrived at dock";
    case "declined":
    case "no_response":
      return `On original route via ${routed} · dispatch following up`;
  }
}

export type Density = "low" | "moderate" | "severe";

/** Border crowd density from the queue wait: < 30 min low, 30–90 moderate, > 90 severe. */
export function crowdDensity(waitMin: number): Density {
  if (waitMin > 90) return "severe";
  if (waitMin >= 30) return "moderate";
  return "low";
}

export type CorridorStage = "pre_departure" | "origin" | "border" | "us_inbound" | "arrived";

/** Where the truck sits along the corridor, from the dispatch status. */
export function corridorStage(status: DispatchStatus): CorridorStage {
  switch (status) {
    case "en_route":
      return "origin";
    case "at_port":
      return "border";
    case "crossed":
      return "us_inbound";
    case "delivered":
      return "arrived";
    default:
      return "pre_departure";
  }
}

export interface ReceiverEntry {
  id: string;
  at: number;
  simMin: number;
  source: EventSource;
  text: string;
  detail?: string;
}

/** Translates dispatcher events into the receiver's route-exception timeline (newest first). */
export function receiverTimeline(state: DispatchState): ReceiverEntry[] {
  const d = state.decision;
  if (!d) {
    // Before dispatch acts, the only receiver-relevant events are the dock's own escalations.
    return state.events
      .filter((e) => e.text === LOG_TEXT.escalation)
      .map((e) => ({ id: `${e.id}`, at: e.at, simMin: e.simMin, source: e.source, text: "Dock reported load overdue. Escalated to priority dispatch." }));
  }
  const pName = PORTS[d.primary.port].shortName;
  const target = d.port ? d.plans[d.port] : d.primary;
  const tName = PORTS[target.port].shortName;
  const out: ReceiverEntry[] = [];

  for (const e of [...state.events].reverse()) {
    const base = { at: e.at, simMin: e.simMin, source: e.source };
    if (e.text === LOG_TEXT.bottleneck) {
      out.push({ ...base, id: `${e.id}`, text: `System detected ${fmtDur(d.primary.waitMin)} delay at ${pName}.` });
    } else if (e.text === LOG_TEXT.broadcast) {
      out.push({
        ...base,
        id: `${e.id}`,
        text: d.action === "divert" ? `Dispatch sent hands-free reroute alert to driver (${tName}).` : "Dispatch sent hands-free route update to driver.",
      });
    } else if (e.text === LOG_TEXT.confirm) {
      out.push({
        ...base,
        id: `${e.id}`,
        text: d.action === "divert" ? `Driver confirmed reroute to ${tName} by voice.` : `Driver confirmed route via ${tName} by voice.`,
      });
      out.push({
        ...base,
        id: `${e.id}-dock`,
        source: "sim",
        text: "Dock appointment updated automatically.",
        detail:
          d.action === "divert"
            ? `ETA ${fmtClock(d.primary.etaMin)} → ${fmtClock(target.etaMin)} (${fmtDur(d.savingsMin)} earlier).`
            : `ETA ${fmtClock(target.etaMin)}.`,
      });
    } else if (e.kind === "driver" || (e.kind === "warning" && e.text.includes("No verbal"))) {
      out.push({ ...base, id: `${e.id}`, text: `Reroute not confirmed. Load remains on ${pName}; dispatch is following up.` });
    } else if (e.text === LOG_TEXT.escalation) {
      out.push({ ...base, id: `${e.id}`, text: "Dock reported load overdue. Escalated to priority dispatch." });
    } else if (e.text.startsWith("Status: ")) {
      out.push({ ...base, id: `${e.id}`, text: e.text.replace(/^Status: (\w)/, (_, c: string) => c.toUpperCase()) });
    }
  }
  return out.reverse();
}
