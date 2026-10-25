import type { Decision } from "./sim.ts";
import { LOAD, PORTS, fmtClock, fmtDur } from "./sim.ts";

export type CallMode = "live" | "simulated";

export type CallPhase = "idle" | "placing" | "queued" | "ringing" | "connected" | "listening" | "ended" | "failed";

export type DispatchStatus =
  | "draft"
  | "broadcasting"
  | "confirmed"
  | "declined"
  | "no_response"
  | "en_route"
  | "at_port"
  | "crossed"
  | "delivered";

/** Where an event came from: a real API (live), the simulation, the dispatcher, or the console itself. */
export type EventSource = "live" | "sim" | "dispatcher" | "system";
export type EventKind = "detect" | "call" | "driver" | "dispatch" | "warning";

export interface DispatchEvent {
  id: number;
  at: number;
  simMin: number;
  kind: EventKind;
  source: EventSource;
  text: string;
  detail?: string;
}

export interface DispatchState {
  status: DispatchStatus;
  callPhase: CallPhase;
  callMode: CallMode | null;
  callId: string | null;
  decision: Decision | null;
  events: DispatchEvent[];
  nextId: number;
}

export const initialDispatch: DispatchState = {
  status: "draft",
  callPhase: "idle",
  callMode: null,
  callId: null,
  decision: null,
  events: [],
  nextId: 1,
};

export const ZERO_TOUCH_NOTICE = "Auto-answering Bluetooth broadcast dispatched — zero physical phone interaction required.";

export const LOG_TEXT = {
  bottleneck: "Bottleneck detected.",
  broadcast: "Auto-broadcast sent directly to driver's Bluetooth headset.",
  confirm: "Verbal 'Confirm' received from driver.",
  manifest: "Customs manifest updated automatically.",
  escalation: "EMERGENCY ESCALATION: Dock receiver flagged load as overdue. Priority dispatch notified.",
} as const;

export function isEscalated(state: DispatchState): boolean {
  return state.events.some((e) => e.text.includes("EMERGENCY ESCALATION"));
}

type Stamp = { simMin: number; at: number };
export type ResponseSource = "live" | "sim" | "dispatcher";

export type DispatchAction =
  | ({ type: "start"; decision: Decision; mode: CallMode } & Stamp)
  | ({ type: "broadcast_sent"; mode: CallMode; callId?: string } & Stamp)
  | ({ type: "call_phase"; phase: CallPhase; text?: string } & Stamp)
  | ({ type: "fallback"; reason: string } & Stamp)
  | ({ type: "confirm"; source: ResponseSource } & Stamp)
  | ({ type: "decline"; source: ResponseSource } & Stamp)
  | ({ type: "no_response"; text?: string } & Stamp)
  | ({ type: "advance" } & Stamp)
  | ({ type: "receiver_escalate" } & Stamp)
  | { type: "reset" };

/** Post-confirmation progression of a load. */
export const PROGRESSION: DispatchStatus[] = ["confirmed", "en_route", "at_port", "crossed", "delivered"];

export function nextStatus(s: DispatchStatus): DispatchStatus | null {
  const i = PROGRESSION.indexOf(s);
  return i >= 0 && i < PROGRESSION.length - 1 ? PROGRESSION[i + 1] : null;
}

export function routePortName(state: DispatchState): string {
  const port = state.decision?.port;
  return port ? PORTS[port].shortName : "port";
}

export function advanceLabel(state: DispatchState): string | null {
  const port = routePortName(state);
  switch (nextStatus(state.status)) {
    case "en_route":
      return `Mark en route to ${port}`;
    case "at_port":
      return `Mark arrived at ${port}`;
    case "crossed":
      return "Mark crossed into U.S.";
    case "delivered":
      return "Mark delivered";
    default:
      return null;
  }
}

function log(
  state: DispatchState,
  e: { kind: EventKind; source: EventSource; text: string; detail?: string },
  stamp: Stamp,
): DispatchState {
  return {
    ...state,
    events: [{ id: state.nextId, at: stamp.at, simMin: stamp.simMin, ...e }, ...state.events],
    nextId: state.nextId + 1,
  };
}

const PHASE_TEXT: Partial<Record<CallPhase, string>> = {
  queued: "Call queued with Vapi.",
  ringing: "Ringing driver's phone (auto-answer expected).",
  connected: "Connected: broadcast playing on driver's headset.",
  listening: "Listening for verbal 'Confirm'.",
  ended: "Call ended.",
  failed: "Call failed.",
};

const RESPONSE_DETAIL: Record<ResponseSource, string> = {
  live: "Detected in the live Vapi call transcript.",
  sim: "Simulated driver response.",
  dispatcher: "Recorded manually by dispatcher.",
};

export function dispatchReducer(state: DispatchState, action: DispatchAction): DispatchState {
  switch (action.type) {
    case "start": {
      const d = action.decision;
      let s: DispatchState = {
        ...initialDispatch,
        events: state.events,
        nextId: state.nextId,
        status: "broadcasting",
        callPhase: "placing",
        callMode: action.mode,
        decision: d,
      };
      if (d.bottleneck) {
        s = log(
          s,
          {
            kind: "detect",
            source: d.dataSource === "cbp" ? "live" : "sim",
            text: LOG_TEXT.bottleneck,
            detail:
              d.dataSource === "cbp"
                ? `CBP reports ${fmtDur(d.primary.waitMin)} commercial delay at ${PORTS[d.primary.port].shortName}.`
                : `${PORTS[d.primary.port].shortName} wait forecast ${fmtDur(d.primary.waitMin)} at arrival.`,
          },
          action,
        );
      }
      return log(
        s,
        {
          kind: "dispatch",
          source: "system",
          text: `Decision locked: ${d.headline}.`,
          detail: d.dataSource === "cbp" ? `CBP data as of ${fmtClock(action.simMin)} PT.` : `Sim clock ${fmtClock(action.simMin)}.`,
        },
        action,
      );
    }
    case "broadcast_sent":
      return log(
        { ...state, callPhase: "queued", callId: action.callId ?? null },
        {
          kind: "call",
          source: action.mode === "live" ? "live" : "sim",
          text: LOG_TEXT.broadcast,
          detail:
            ZERO_TOUCH_NOTICE + (action.mode === "live" ? ` Vapi call ${action.callId ?? ""}`.trimEnd() : " No phone call placed."),
        },
        action,
      );
    case "call_phase": {
      if (state.status !== "broadcasting" || state.callPhase === action.phase) return state;
      const text = action.text ?? PHASE_TEXT[action.phase];
      const s = { ...state, callPhase: action.phase };
      return text
        ? log(s, { kind: action.phase === "failed" ? "warning" : "call", source: state.callMode === "live" ? "live" : "sim", text }, action)
        : s;
    }
    case "fallback":
      return log(
        { ...state, callMode: "simulated", callId: null, callPhase: "placing" },
        { kind: "warning", source: "system", text: "Live Vapi call unavailable. Falling back to SIMULATED broadcast.", detail: action.reason },
        action,
      );
    case "confirm": {
      if (state.status !== "broadcasting" && state.status !== "no_response") return state;
      const s = log(
        { ...state, status: "confirmed", callPhase: state.callMode === "live" ? state.callPhase : "ended" },
        { kind: "driver", source: action.source, text: LOG_TEXT.confirm, detail: RESPONSE_DETAIL[action.source] },
        action,
      );
      return log(
        s,
        {
          kind: "dispatch",
          source: "sim",
          text: LOG_TEXT.manifest,
          detail: `Route updated to ${routePortName(s)}. Simulated: no customs system is connected in this demo.`,
        },
        action,
      );
    }
    case "decline":
      if (state.status !== "broadcasting" && state.status !== "no_response") return state;
      return log(
        { ...state, status: "declined", callPhase: state.callMode === "live" ? state.callPhase : "ended" },
        { kind: "driver", source: action.source, text: "Driver verbally declined. Dispatcher follow-up required.", detail: RESPONSE_DETAIL[action.source] },
        action,
      );
    case "no_response":
      if (state.status !== "broadcasting") return state;
      return log(
        { ...state, status: "no_response", callPhase: "ended" },
        { kind: "warning", source: state.callMode === "live" ? "live" : "sim", text: action.text ?? "No verbal 'Confirm' received before timeout." },
        action,
      );
    case "advance": {
      const next = nextStatus(state.status);
      if (!next) return state;
      const label = advanceLabel(state)?.replace(/^Mark /, "") ?? next;
      return log(
        { ...state, status: next },
        { kind: "dispatch", source: "dispatcher", text: `Status: ${label.replace(/\.$/, "")}.` },
        action,
      );
    }
    case "receiver_escalate":
      // Logged for dispatch; the load's status is deliberately left unchanged.
      if (isEscalated(state)) return state;
      return log(state, { kind: "dispatch", source: "system", text: LOG_TEXT.escalation }, action);
    case "reset":
      return initialDispatch;
  }
}

/** The broadcast read to the driver. */
export function buildBroadcastScript(decision: Decision): string[] {
  const { primary, alternative } = decision;
  const pName = PORTS[primary.port].shortName;
  const intro = `Priority dispatch alert for ${LOAD.driver}, ${LOAD.unit}, Load ${LOAD.id}.`;
  if (decision.action === "divert") {
    return [
      intro,
      `${pName} commercial wait has spiked to ${fmtDur(primary.waitMin)}. Automated recommendation is to reroute via ${PORTS[alternative.port].shortName} port of entry. New estimated delivery arrival is ${fmtClock(alternative.etaMin)}, saving ${fmtDur(decision.savingsMin)} door to door.`,
      "Say 'Confirm' to reroute and update your customs manifest hands-free.",
    ];
  }
  const body =
    decision.action === "stay"
      ? `Continue via ${pName} port of entry. Commercial wait is ${fmtDur(primary.waitMin)}. Estimated delivery arrival is ${fmtClock(primary.etaMin)}.`
      : "Hold at origin. No commercial port of entry is open at your projected arrival time.";
  return [intro, body, "Say 'Confirm' to acknowledge hands-free."];
}

/** Template variables sent to the Vapi assistant (usable as {{name}} in its prompt or first message). */
export function buildVapiVariables(decision: Decision): Record<string, string> {
  const rec = decision.port ? decision.plans[decision.port] : decision.primary;
  return {
    driverName: LOAD.driver,
    unit: LOAD.unit,
    loadId: LOAD.id,
    action: decision.action,
    headline: decision.headline,
    primaryPort: PORTS[decision.primary.port].shortName,
    primaryWait: fmtDur(decision.primary.waitMin),
    recommendedPort: decision.port ? PORTS[decision.port].shortName : "none",
    recommendedWait: fmtDur(rec.waitMin),
    savings: fmtDur(Math.max(0, decision.savingsMin)),
    eta: fmtClock(rec.etaMin),
    broadcast: buildBroadcastScript(decision).join(" "),
  };
}

/** Spoken-friendly version: expands "2h 05m" to words for text-to-speech. */
export function toSpeech(text: string): string {
  return text
    .replace(/(\d+)h (\d+)m/g, (_, h, m) => `${Number(h)} hour${h === "1" ? "" : "s"} ${Number(m)} minutes`)
    .replace(/(\d+) min\b/g, "$1 minutes")
    .replace(/POE/g, "port of entry");
}
