"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Decision } from "@/lib/sim";
import { LOAD } from "@/lib/sim";
import {
  ZERO_TOUCH_NOTICE,
  buildBroadcastScript,
  buildVapiVariables,
  toSpeech,
  type CallMode,
  type CallPhase,
  type DispatchAction,
  type DispatchState,
} from "@/lib/dispatch";
import { Chip, Panel, SimTag } from "./ui";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Act = (a: DistributiveOmit<Exclude<DispatchAction, { type: "reset" }>, "simMin" | "at">) => void;

export interface Capabilities {
  configured: boolean;
  maskedTo: string | null;
}

const NO_RESPONSE_MS = 45_000;
const POLL_MS = 2500;

const VAPI_PHASE: Record<string, CallPhase> = {
  scheduled: "queued",
  queued: "queued",
  ringing: "ringing",
  "in-progress": "connected",
  forwarding: "connected",
  ended: "ended",
};

/** Drives a broadcast through its phases. Live mode calls /api/dispatch (Vapi); simulated mode is timer-based. */
export function useBroadcastRunner(act: Act, voiceOn: boolean) {
  const timers = useRef<number[]>([]);
  const poll = useRef<number | null>(null);
  const runId = useRef(0);
  const [lineIdx, setLineIdx] = useState(-1);

  const stop = useCallback(() => {
    runId.current++;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (poll.current) window.clearInterval(poll.current);
    poll.current = null;
    setLineIdx(-1);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const later = (ms: number, fn: () => void) => {
    const id = runId.current;
    timers.current.push(window.setTimeout(() => id === runId.current && fn(), ms));
  };

  const speakLines = (lines: string[], done: () => void) => {
    const id = runId.current;
    const synth = voiceOn && typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
    const voice =
      synth?.getVoices().find((v) => v.lang === "en-US" && /Samantha|Google US|Jenny|Aria/i.test(v.name)) ??
      synth?.getVoices().find((v) => v.lang.startsWith("en"));

    const step = (i: number) => {
      if (id !== runId.current) return;
      if (i >= lines.length) {
        setLineIdx(-1);
        done();
        return;
      }
      setLineIdx(i);
      let advanced = false;
      const next = () => {
        if (advanced) return;
        advanced = true;
        step(i + 1);
      };
      const words = lines[i].split(/\s+/).length;
      // Timer guard: browsers sometimes never fire `onend`, so the demo never stalls.
      later(synth ? words * 420 + 2500 : Math.max(1800, words * 300), next);
      if (synth) {
        const u = new SpeechSynthesisUtterance(toSpeech(lines[i]));
        if (voice) u.voice = voice;
        u.rate = 1.03;
        u.onend = next;
        u.onerror = next;
        synth.speak(u);
      }
    };
    synth?.cancel();
    step(0);
  };

  const runSimulated = (lines: string[]) => {
    act({ type: "broadcast_sent", mode: "simulated" });
    later(1200, () => act({ type: "call_phase", phase: "ringing" }));
    later(2600, () => {
      act({ type: "call_phase", phase: "connected", text: "Auto-answered on driver's Bluetooth headset (simulated)." });
      later(400, () =>
        speakLines(lines, () => {
          act({ type: "call_phase", phase: "listening" });
          later(NO_RESPONSE_MS, () => act({ type: "no_response" }));
        }),
      );
    });
  };

  const runLive = async (decision: Decision, lines: string[]) => {
    const id = runId.current;
    let callId: string;
    try {
      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: buildVapiVariables(decision) }),
      });
      const data = (await res.json().catch(() => ({}))) as { call?: { id?: string }; error?: string };
      if (!res.ok || !data.call?.id) throw new Error(data.error ?? `HTTP ${res.status}`);
      callId = data.call.id;
    } catch (err) {
      if (id !== runId.current) return;
      act({ type: "fallback", reason: err instanceof Error ? err.message : "network error" });
      runSimulated(lines);
      return;
    }
    if (id !== runId.current) return;
    act({ type: "broadcast_sent", mode: "live", callId });

    poll.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/dispatch?id=${callId}`, { cache: "no-store" });
        if (!res.ok || id !== runId.current) return;
        const s = (await res.json()) as { status: string; endedReason: string | null; confirmed: boolean; declined: boolean };
        if (id !== runId.current) return;
        if (s.confirmed) {
          act({ type: "confirm", source: "live" });
          stop();
          return;
        }
        if (s.declined) {
          act({ type: "decline", source: "live" });
          stop();
          return;
        }
        const phase = VAPI_PHASE[s.status];
        if (phase === "ended") {
          act({
            type: "no_response",
            text: `Call ended${s.endedReason ? ` (${s.endedReason})` : ""}. No verbal 'Confirm' found in transcript.`,
          });
          stop();
        } else if (phase) {
          act({ type: "call_phase", phase });
        }
      } catch {
        // Transient network error: keep polling.
      }
    }, POLL_MS);
  };

  const start = (mode: CallMode, decision: Decision) => {
    stop();
    const lines = buildBroadcastScript(decision);
    if (mode === "live") void runLive(decision, lines);
    else runSimulated(lines);
  };

  useEffect(() => stop, [stop]);

  return { start, stop, lineIdx };
}

const STEPS: { label: string; reached: (s: DispatchState) => boolean }[] = [
  { label: "Broadcast", reached: (s) => s.callPhase !== "idle" },
  { label: "Ringing", reached: (s) => ["ringing", "connected", "listening", "ended"].includes(s.callPhase) || s.status === "confirmed" },
  { label: "Auto-answer", reached: (s) => ["connected", "listening"].includes(s.callPhase) || s.status === "confirmed" },
  { label: "Verbal confirm", reached: (s) => ["confirmed", "en_route", "at_port", "crossed", "delivered"].includes(s.status) },
];

export default function CallPanel({
  state,
  act,
  caps,
  mode,
  setMode,
  voiceOn,
  setVoiceOn,
  lineIdx,
  onRetry,
}: {
  state: DispatchState;
  act: Act;
  caps: Capabilities | null;
  mode: CallMode;
  setMode: (m: CallMode) => void;
  voiceOn: boolean;
  setVoiceOn: (v: boolean) => void;
  lineIdx: number;
  onRetry: () => void;
}) {
  const lines = state.decision ? buildBroadcastScript(state.decision) : [];
  const effectiveMode = state.callMode ?? mode;
  const isLive = effectiveMode === "live";
  const active = state.status === "broadcasting";
  const open = state.status === "broadcasting" || state.status === "no_response";
  const simListening = !isLive && active && state.callPhase === "listening";
  const canRetry = state.status === "declined" || state.status === "no_response";
  const failed = state.status === "no_response" || state.status === "declined";
  const firstOpenStep = STEPS.findIndex((st) => !st.reached(state));

  return (
    <Panel
      title="Zero-touch driver broadcast"
      subtitle={ZERO_TOUCH_NOTICE}
      right={
        isLive ? (
          <span className="inline-flex items-center rounded border border-critical/60 bg-critical/10 px-1.5 py-px font-mono text-[10px] font-semibold tracking-wider text-critical">
            LIVE · VAPI OUTBOUND CALL
          </span>
        ) : (
          <SimTag>SIMULATED FALLBACK · NO CALL PLACED</SimTag>
        )
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_250px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Broadcast mode">
              {(["live", "simulated"] as const).map((m) => {
                const disabled = m === "live" && !caps?.configured;
                return (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={mode === m}
                    disabled={disabled || active}
                    onClick={() => setMode(m)}
                    title={
                      disabled
                        ? "Set VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID and DRIVER_PHONE_NUMBER in .env.local"
                        : m === "live"
                          ? `Real outbound call via Vapi to ${caps?.maskedTo ?? "the configured driver number"}`
                          : "Simulated broadcast; no phone call is placed"
                    }
                    className={`rounded px-2.5 py-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      mode === m ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {m === "live" ? "Live (Vapi)" : "Simulated"}
                  </button>
                );
              })}
            </div>
            {!isLive && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-2">
                <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} className="accent-[var(--otay)]" />
                Play simulated broadcast aloud
              </label>
            )}
            {caps && !caps.configured && <span className="text-muted">Vapi not configured; simulated broadcast only.</span>}
            {caps?.configured && <span className="text-muted">Live target: {caps.maskedTo}</span>}
          </div>

          <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Broadcast progress">
            {STEPS.map((st, i) => {
              const done = st.reached(state);
              const current = active && i === firstOpenStep;
              const bad = failed && i === firstOpenStep;
              return (
                <li key={st.label} className="min-w-0">
                  <div className={`h-1 rounded-full ${bad ? "bg-critical" : current ? "bp-pulse bg-otay" : done ? "bg-otay" : "bg-line"}`} />
                  <div className={`mt-1 truncate text-[11px] ${current || done ? "text-ink" : "text-muted"}`}>{st.label}</div>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 rounded-lg border border-line bg-bg/60 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted">
              <span>{isLive ? "Broadcast context sent to Vapi assistant" : "Simulated broadcast script"}</span>
              {state.decision && <span>From locked decision</span>}
            </div>
            {lines.length === 0 ? (
              <p className="text-sm text-muted">No broadcast yet. Press &ldquo;Dispatch &amp; call driver&rdquo; to start.</p>
            ) : (
              <div className="space-y-2 text-sm leading-relaxed">
                {lines.map((l, i) => (
                  <p key={i} className={`rounded px-2 py-1 transition-colors ${lineIdx === i ? "bg-otay/15 text-ink" : "text-ink-2"}`}>
                    {l}
                  </p>
                ))}
                {isLive && (
                  <p className="px-2 text-xs text-muted">
                    Your Vapi assistant speaks its own configured script. These values are passed as template variables (e.g.{" "}
                    <code>{"{{broadcast}}"}</code>, <code>{"{{recommendedPort}}"}</code>).
                  </p>
                )}
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            Zero-touch assumes auto-answer is enabled on the driver&apos;s phone or Bluetooth headset. Vapi places a standard outbound
            phone call.
          </p>
        </div>

        {/* Driver headset mock */}
        <div className="rounded-[22px] border border-line bg-bg p-3">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-muted">Driver Bluetooth headset</div>
            <div className="mt-3 flex justify-center" aria-hidden>
              <svg viewBox="0 0 48 48" className={`h-12 w-12 ${active ? "text-otay" : "text-muted"}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M10 28v-4a14 14 0 0 1 28 0v4" />
                <rect x="6" y="27" width="8" height="12" rx="3" />
                <rect x="34" y="27" width="8" height="12" rx="3" />
                <path d="M38 39c0 4-4 5-10 5" />
              </svg>
            </div>
            <div className="mt-2 text-sm font-semibold">{LOAD.driver}</div>
            <div className="text-xs text-muted">{LOAD.unit} · hands on wheel</div>
            <div className="mt-3">
              {state.callPhase === "idle" && <Chip tone="neutral">Standby</Chip>}
              {(state.callPhase === "placing" || state.callPhase === "queued") && (
                <Chip tone="info" className="bp-pulse">
                  Placing call…
                </Chip>
              )}
              {state.callPhase === "ringing" && (
                <Chip tone="info" className="bp-pulse">
                  Auto-answering…
                </Chip>
              )}
              {state.callPhase === "connected" && <Chip tone="info">Broadcast playing</Chip>}
              {state.callPhase === "listening" && <Chip tone="warning">Listening for &ldquo;Confirm&rdquo;</Chip>}
              {state.callPhase === "ended" && state.status === "confirmed" && <Chip tone="good">Confirmed hands-free</Chip>}
              {state.callPhase === "ended" && state.status !== "confirmed" && <Chip tone="neutral">Call ended</Chip>}
              {state.callPhase === "failed" && <Chip tone="critical">Call failed</Chip>}
              {state.callPhase !== "ended" && state.status === "confirmed" && <Chip tone="good">Confirmed hands-free</Chip>}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {!isLive && (
              <>
                <button
                  disabled={!simListening}
                  onClick={() => act({ type: "confirm", source: "sim" })}
                  className="w-full rounded-xl border border-good/50 bg-good/15 px-2 py-2.5 text-xs font-medium transition hover:bg-good/25 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Simulate driver saying &ldquo;Confirm&rdquo;
                </button>
                <button
                  disabled={!simListening}
                  onClick={() => act({ type: "decline", source: "sim" })}
                  className="w-full rounded-xl border border-critical/50 bg-critical/10 px-2 py-2 text-xs font-medium transition hover:bg-critical/20 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Simulate verbal decline
                </button>
              </>
            )}
            {isLive && (
              <>
                <button
                  disabled={!open}
                  onClick={() => act({ type: "confirm", source: "dispatcher" })}
                  className="w-full rounded-xl border border-good/50 bg-good/15 px-2 py-2.5 text-xs font-medium transition hover:bg-good/25 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Record verbal &ldquo;Confirm&rdquo; manually
                </button>
                <button
                  disabled={!open}
                  onClick={() => act({ type: "decline", source: "dispatcher" })}
                  className="w-full rounded-xl border border-critical/50 bg-critical/10 px-2 py-2 text-xs font-medium transition hover:bg-critical/20 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Record verbal decline manually
                </button>
              </>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] text-muted">
            {isLive
              ? "The driver's spoken “Confirm” is detected automatically from the Vapi transcript. Manual entry is a dispatcher-side backup."
              : "The driver never touches the phone. These buttons stand in for the driver's voice."}
          </p>

          {canRetry && (
            <button onClick={onRetry} className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink hover:bg-panel-2">
              Re-send broadcast
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}
