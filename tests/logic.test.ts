import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCENARIO, DIVERT_THRESHOLD_MIN, PORT_IDS, fmtClock, fmtDur, planTrip, recommend } from "../src/lib/sim.ts";
import {
  LOG_TEXT,
  ZERO_TOUCH_NOTICE,
  buildBroadcastScript,
  buildVapiVariables,
  dispatchReducer,
  initialDispatch,
  type DispatchAction,
  type DispatchState,
} from "../src/lib/dispatch.ts";
import { sanitizeVariables, summarizeCall } from "../src/lib/vapi.ts";

const t = { simMin: 800, at: 0 };

test("trip total = drive to port + wait + drive to destination", () => {
  const p = planTrip("otay", DEFAULT_SCENARIO);
  assert.equal(p.totalMin, p.toPortMin + p.waitMin + p.fromPortMin);
  assert.equal(p.etaMin, DEFAULT_SCENARIO.minuteOfDay + p.totalMin);
});

test("bottleneck only affects the selected primary port", () => {
  const on = recommend({ ...DEFAULT_SCENARIO, bottleneck: true });
  const off = recommend({ ...DEFAULT_SCENARIO, bottleneck: false });
  assert.ok(on.primary.waitMin > off.primary.waitMin);
  assert.equal(on.plans.tecate.waitMin, off.plans.tecate.waitMin);
});

test("default scenario (Otay Mesa bottleneck) recommends diverting to Tecate", () => {
  const d = recommend(DEFAULT_SCENARIO);
  assert.equal(d.action, "divert");
  assert.equal(d.port, "tecate");
  assert.ok(d.savingsMin >= DIVERT_THRESHOLD_MIN);
  assert.equal(d.savingsMin, d.primary.totalMin - d.alternative.totalMin);
});

test("every primary route produces a decision over all four ports", () => {
  for (const primary of PORT_IDS) {
    for (let m = 5 * 60; m <= 23 * 60; m += 15) {
      const d = recommend({ minuteOfDay: m, primary, bottleneck: true });
      assert.equal(d.primary.port, primary);
      assert.notEqual(d.alternative.port, primary);
      assert.equal(Object.keys(d.plans).length, 4);
      if (d.action === "divert" && d.primary.available) assert.ok(d.savingsMin >= DIVERT_THRESHOLD_MIN);
      if (d.alternative.available) {
        for (const p of PORT_IDS) {
          if (p !== primary && d.plans[p].available) assert.ok(d.alternative.totalMin <= d.plans[p].totalMin);
        }
      }
    }
  }
});

test("closed alternatives → stay; nothing open → hold", () => {
  assert.equal(recommend({ minuteOfDay: 19 * 60, primary: "otay", bottleneck: true }).action, "stay");
  assert.equal(recommend({ minuteOfDay: 22 * 60 + 30, primary: "otay", bottleneck: false }).action, "hold");
});

test("formatters", () => {
  assert.equal(fmtDur(125), "2h 05m");
  assert.equal(fmtDur(45), "45 min");
  assert.equal(fmtClock(0), "12:00 AM");
  assert.equal(fmtClock(13 * 60 + 5), "1:05 PM");
});

function run(actions: DispatchAction[], s: DispatchState = initialDispatch) {
  return actions.reduce(dispatchReducer, s);
}

test("zero-touch log sequence: bottleneck → broadcast → verbal confirm → manifest", () => {
  const decision = recommend(DEFAULT_SCENARIO);
  let s = run([
    { type: "start", decision, mode: "live", ...t },
    { type: "broadcast_sent", mode: "live", callId: "abc", ...t },
    { type: "call_phase", phase: "connected", ...t },
    { type: "confirm", source: "live", ...t },
  ]);
  const texts = [...s.events].reverse().map((e) => e.text);
  const order = [LOG_TEXT.bottleneck, LOG_TEXT.broadcast, LOG_TEXT.confirm, LOG_TEXT.manifest].map((x) => texts.indexOf(x));
  assert.ok(order.every((i) => i >= 0), "all four log lines present");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "in order");
  assert.equal(s.status, "confirmed");

  const byText = Object.fromEntries(s.events.map((e) => [e.text, e]));
  assert.equal(byText[LOG_TEXT.bottleneck].source, "sim");
  assert.equal(byText[LOG_TEXT.broadcast].source, "live");
  assert.ok(byText[LOG_TEXT.broadcast].detail?.includes(ZERO_TOUCH_NOTICE));
  assert.equal(byText[LOG_TEXT.confirm].source, "live");
  assert.equal(byText[LOG_TEXT.manifest].source, "sim", "manifest update is always labeled simulated");

  // Late events must not undo the confirmation.
  s = run([{ type: "no_response", ...t }, { type: "call_phase", phase: "ringing", ...t }], s);
  assert.equal(s.status, "confirmed");
  s = run([{ type: "advance", ...t }, { type: "advance", ...t }, { type: "advance", ...t }, { type: "advance", ...t }], s);
  assert.equal(s.status, "delivered");
});

test("no bottleneck → no 'Bottleneck detected.' line", () => {
  const decision = recommend({ ...DEFAULT_SCENARIO, bottleneck: false });
  const s = run([{ type: "start", decision, mode: "simulated", ...t }]);
  assert.ok(!s.events.some((e) => e.text === LOG_TEXT.bottleneck));
});

test("decline, no-response, retry and fallback paths", () => {
  const decision = recommend(DEFAULT_SCENARIO);
  const start: DispatchAction = { type: "start", decision, mode: "live", ...t };
  assert.equal(run([start, { type: "decline", source: "dispatcher", ...t }]).status, "declined");
  const nr = run([start, { type: "no_response", ...t }]);
  assert.equal(nr.status, "no_response");
  assert.equal(run([{ type: "confirm", source: "dispatcher", ...t }], nr).status, "confirmed");
  assert.equal(run([start], nr).status, "broadcasting");
  const fb = run([start, { type: "fallback", reason: "Missing Vapi .env variables", ...t }]);
  assert.equal(fb.callMode, "simulated");
  assert.equal(fb.events[0].kind, "warning");
});

test("broadcast script is production-style and hands-free", () => {
  const d = recommend(DEFAULT_SCENARIO);
  const script = buildBroadcastScript(d);
  assert.equal(script[0], "Priority dispatch alert for Luis Ortega, Unit 4127, Load BP-2047.");
  assert.equal(
    script[1],
    `Otay Mesa commercial wait has spiked to ${fmtDur(d.primary.waitMin)}. Automated recommendation is to reroute via Tecate port of entry. New estimated delivery arrival is ${fmtClock(d.alternative.etaMin)}, saving ${fmtDur(d.savingsMin)} door to door.`,
  );
  assert.equal(script[2], "Say 'Confirm' to reroute and update your customs manifest hands-free.");
  const lines = script.join(" ");
  assert.doesNotMatch(lines, /hackathon|simulat|demo/i);
  assert.doesNotMatch(lines, /press/i);
  const stay = buildBroadcastScript(recommend({ minuteOfDay: 19 * 60, primary: "otay", bottleneck: true }));
  assert.match(stay[1], /^Continue via Otay Mesa/);
  assert.match(stay[2], /Say 'Confirm'/);
  const vars = buildVapiVariables(d);
  assert.equal(vars.recommendedPort, "Tecate");
  assert.deepEqual(sanitizeVariables(vars), vars);
});

test("sanitizeVariables drops non-string and malformed keys", () => {
  assert.deepEqual(sanitizeVariables({ ok: "a", n: 1, "bad key": "x", __proto__x: "y" }), { ok: "a" });
  assert.equal(sanitizeVariables(null), null);
  assert.equal(sanitizeVariables({ n: 1 }), null);
});

test("summarizeCall detects the driver's verbal confirm, not the assistant's", () => {
  const assistantOnly = summarizeCall({ status: "in-progress", messages: [{ role: "bot", message: "Say confirm to accept." }] });
  assert.equal(assistantOnly.confirmed, false);
  const confirmed = summarizeCall({
    status: "ended",
    artifact: { messages: [{ role: "bot", message: "Say confirm." }, { role: "user", message: "Confirm." }] },
  });
  assert.equal(confirmed.confirmed, true);
  const fromTranscript = summarizeCall({ status: "ended", transcript: "AI: Say confirm.\nUser: Okay, confirmed." });
  assert.equal(fromTranscript.confirmed, true);
  assert.equal(summarizeCall({ status: "ended", transcript: "User: I decline." }).declined, true);
});

test("receiver view: ETA stays on booked route until the driver confirms, then updates", async () => {
  const { receiverEta, receiverStatusLabel, receiverTimeline } = await import("../src/lib/receiver.ts");
  const decision = recommend(DEFAULT_SCENARIO);

  const draft = receiverEta(initialDispatch, decision);
  assert.equal(draft.plan.port, "otay");
  assert.equal(draft.rerouted, false);
  assert.equal(receiverStatusLabel(initialDispatch, decision), "Scheduled via Otay Mesa");
  assert.deepEqual(receiverTimeline(initialDispatch), []);

  let s = run([
    { type: "start", decision, mode: "simulated", ...t },
    { type: "broadcast_sent", mode: "simulated", ...t },
  ]);
  assert.equal(receiverEta(s, decision).pendingReroute, true);
  assert.equal(receiverEta(s, decision).plan.port, "otay");

  s = run([{ type: "confirm", source: "sim", ...t }, { type: "advance", ...t }], s);
  const eta = receiverEta(s, decision);
  assert.equal(eta.rerouted, true);
  assert.equal(eta.plan.port, "tecate");
  assert.equal(eta.previousEtaMin, decision.primary.etaMin);
  assert.equal(receiverStatusLabel(s, decision), "En route via Tecate");

  const texts = receiverTimeline(s).map((e) => e.text).reverse();
  assert.deepEqual(texts, [
    `System detected ${fmtDur(decision.primary.waitMin)} delay at Otay Mesa.`,
    "Dispatch sent hands-free reroute alert to driver (Tecate).",
    "Driver confirmed reroute to Tecate by voice.",
    "Dock appointment updated automatically.",
    "En route to Tecate.",
  ]);
  const dock = receiverTimeline(s).find((e) => e.text.startsWith("Dock appointment"))!;
  assert.equal(dock.source, "sim", "dock appointment update is labeled simulated");
});

test("receiver view: declined reroute keeps the original route", async () => {
  const { receiverEta, receiverStatusLabel, receiverTimeline } = await import("../src/lib/receiver.ts");
  const decision = recommend(DEFAULT_SCENARIO);
  const s = run([
    { type: "start", decision, mode: "simulated", ...t },
    { type: "decline", source: "sim", ...t },
  ]);
  assert.equal(receiverEta(s, decision).plan.port, "otay");
  assert.match(receiverStatusLabel(s, decision), /^On original route via Otay Mesa/);
  assert.match(receiverTimeline(s)[0].text, /^Reroute not confirmed/);
});

test("CBP: parses the four commercial crossings from a real feed sample", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseCbp, buildCbpResponse, CBP_PORTS } = await import("../src/lib/cbp.ts");
  const feed = JSON.parse(readFileSync(new URL("./fixtures/cbp-bwtnew-sample.json", import.meta.url), "utf8"));
  const r = parseCbp(feed);

  assert.equal(r.otay?.portNumber, "250602", "uses the commercial crossing, not passenger 250601");
  assert.equal(r.otay?.delayMin, 5);
  assert.equal(r.otay?.open, true);
  assert.equal(r.otay?.lanesOpen, 2);
  assert.equal(r.otay?.maxLanes, 10);
  assert.equal(r.otay?.updateTime, "At 3:00 pm PDT");
  assert.deepEqual([r.otay?.opens, r.otay?.closes], [6 * 60, 22 * 60]);

  assert.equal(r.tecate?.status, "Lanes Closed");
  assert.equal(r.tecate?.open, false);
  assert.equal(r.tecate?.delayMin, null);
  assert.equal(r.calexico?.portNumber, CBP_PORTS.calexico);
  assert.equal(r.calexico?.open, false);
  assert.equal(r.sanluis?.delayMin, 5);
  assert.deepEqual([r.sanluis?.opens, r.sanluis?.closes], [9 * 60, 17 * 60]);

  const res = buildCbpResponse(feed, new Date("2026-10-24T23:35:00Z"));
  assert.equal(res.source, "cbp");
  assert.equal(res.lastUpdated, "10/24/2026 16:34:46", "uses a Pacific-clock port, not San Luis's local stamp");
  assert.deepEqual([res.ports.sanluis.opens, res.ports.sanluis.closes], [8 * 60, 16 * 60], "San Luis hours shifted to Pacific");
  assert.deepEqual([res.ports.otay.opens, res.ports.otay.closes], [6 * 60, 22 * 60]);
  assert.ok(Object.values(res.ports).every((p) => p.source === "cbp"));
});

test("CBP: missing ports and failed feeds fall back to labeled model readings", async () => {
  const { buildCbpResponse, modelResponse, parseCbp } = await import("../src/lib/cbp.ts");
  assert.deepEqual(parseCbp("<html>not json</html>"), {});
  const partial = buildCbpResponse([{ port_number: "250501", port_status: "Open", hours: "6 am-10 pm", commercial_vehicle_lanes: { standard_lanes: { operational_status: "delay", delay_minutes: "40" } } }], new Date());
  assert.equal(partial.source, "cbp");
  assert.equal(partial.ports.tecate.source, "cbp");
  assert.equal(partial.ports.tecate.delayMin, 40);
  assert.equal(partial.ports.otay.source, "model");
  const none = buildCbpResponse([], new Date());
  assert.equal(none.source, "model");
  const failed = modelResponse(new Date(), "CBP HTTP 503");
  assert.equal(failed.source, "model");
  assert.equal(failed.error, "CBP HTTP 503");
});

test("CBP: hours parser", async () => {
  const { parseHours } = await import("../src/lib/cbp.ts");
  assert.deepEqual(parseHours("24 hrs/day"), { opens: 0, closes: 1440 });
  assert.deepEqual(parseHours("6 am-10 pm"), { opens: 360, closes: 1320 });
  assert.deepEqual(parseHours("9:30 am-5 pm"), { opens: 570, closes: 1020 });
  assert.deepEqual(parseHours("12 pm-12 am"), { opens: 720, closes: 1440 });
  assert.equal(parseHours("Closed"), null);
});

test("live readings drive the decision engine and the bottleneck log", () => {
  const base = { source: "cbp" as const, opens: 0, closes: 1440, status: "delay" };
  const scenario = {
    minuteOfDay: 10 * 60,
    primary: "otay" as const,
    bottleneck: false,
    live: {
      otay: { ...base, open: true, delayMin: 150 },
      tecate: { ...base, open: true, delayMin: 10 },
      calexico: { ...base, open: false, delayMin: null, status: "Lanes Closed" },
      sanluis: { ...base, open: true, delayMin: 5 },
    },
  };
  const d = recommend(scenario);
  assert.equal(d.dataSource, "cbp");
  assert.equal(d.bottleneck, true, "CBP delay ≥ 60 min counts as a bottleneck");
  assert.equal(d.primary.waitMin, 150);
  assert.equal(d.plans.calexico.available, false);
  assert.equal(d.plans.calexico.unavailableReason, "CBP: Lanes Closed");
  assert.equal(d.action, "divert");
  assert.equal(d.port, "tecate");

  const s = run([{ type: "start", decision: d, mode: "simulated", ...t }]);
  const bottleneck = s.events.find((e) => e.text === LOG_TEXT.bottleneck)!;
  assert.equal(bottleneck.source, "live");
  assert.match(bottleneck.detail!, /^CBP reports 2h 30m/);

  const calm = recommend({ ...scenario, live: { ...scenario.live, otay: { ...base, open: true, delayMin: 5 } } });
  assert.equal(calm.bottleneck, false);
  assert.equal(calm.action, "stay");
});

test("receiver_escalate appends the emergency event without changing load status", async () => {
  const { isEscalated } = await import("../src/lib/dispatch.ts");
  const decision = recommend(DEFAULT_SCENARIO);
  const enRoute = run([
    { type: "start", decision, mode: "simulated", ...t },
    { type: "confirm", source: "sim", ...t },
    { type: "advance", ...t },
  ]);
  assert.equal(enRoute.status, "en_route");
  assert.equal(isEscalated(enRoute), false);

  const escalated = run([{ type: "receiver_escalate", simMin: 900, at: 123 }], enRoute);
  assert.equal(escalated.status, "en_route", "status unchanged");
  assert.equal(escalated.callPhase, enRoute.callPhase);
  assert.equal(escalated.decision, enRoute.decision);
  assert.equal(escalated.events.length, enRoute.events.length + 1);
  const ev = escalated.events[0];
  assert.equal(ev.text, "EMERGENCY ESCALATION: Dock receiver flagged load as overdue. Priority dispatch notified.");
  assert.equal(ev.kind, "dispatch");
  assert.equal(ev.source, "system");
  assert.equal(ev.simMin, 900);
  assert.equal(ev.at, 123);
  assert.equal(isEscalated(escalated), true);

  // A second report is a no-op; progression still works afterwards.
  const again = run([{ type: "receiver_escalate", ...t }], escalated);
  assert.equal(again, escalated);
  assert.equal(run([{ type: "advance", ...t }], escalated).status, "at_port");
  // Works before dispatch too, and reset clears it.
  const draft = run([{ type: "receiver_escalate", ...t }]);
  assert.equal(draft.status, "draft");
  assert.equal(isEscalated(run([{ type: "reset" }], draft)), false);
});

test("receiver: escalation shows in the exception log; corridor density and stage mapping", async () => {
  const { receiverTimeline, crowdDensity, corridorStage } = await import("../src/lib/receiver.ts");
  const decision = recommend(DEFAULT_SCENARIO);
  const s = run([{ type: "start", decision, mode: "simulated", ...t }, { type: "receiver_escalate", ...t }]);
  assert.equal(receiverTimeline(s)[0].text, "Dock reported load overdue. Escalated to priority dispatch.");
  const before = run([{ type: "receiver_escalate", ...t }]);
  assert.equal(receiverTimeline(before).length, 1, "escalation before dispatch still appears for the dock");

  assert.equal(crowdDensity(0), "low");
  assert.equal(crowdDensity(29), "low");
  assert.equal(crowdDensity(30), "moderate");
  assert.equal(crowdDensity(90), "moderate");
  assert.equal(crowdDensity(91), "severe");

  assert.equal(corridorStage("draft"), "pre_departure");
  assert.equal(corridorStage("confirmed"), "pre_departure");
  assert.equal(corridorStage("en_route"), "origin");
  assert.equal(corridorStage("at_port"), "border");
  assert.equal(corridorStage("crossed"), "us_inbound");
  assert.equal(corridorStage("delivered"), "arrived");
});
