// BorderPulse simulation engine.
// Every number produced here is SIMULATED for the demo scenario. Nothing is
// pulled from CBP, Caltrans, or any live feed.

export type PortId = "otay" | "tecate" | "calexico" | "sanluis";

export const PORT_IDS: PortId[] = ["otay", "tecate", "calexico", "sanluis"];

export interface Port {
  id: PortId;
  name: string;
  shortName: string;
  /** Simulated commercial operating hours, minutes from midnight. */
  opens: number;
  closes: number;
}

export const PORTS: Record<PortId, Port> = {
  otay: { id: "otay", name: "Otay Mesa Commercial POE", shortName: "Otay Mesa", opens: 6 * 60, closes: 22 * 60 },
  tecate: { id: "tecate", name: "Tecate Commercial POE", shortName: "Tecate", opens: 8 * 60, closes: 16 * 60 },
  calexico: { id: "calexico", name: "Calexico East Commercial POE", shortName: "Calexico East", opens: 6 * 60, closes: 20 * 60 },
  sanluis: { id: "sanluis", name: "San Luis II Commercial POE", shortName: "San Luis", opens: 6 * 60, closes: 18 * 60 },
};

export interface Leg {
  /** Simulated drive time from origin to the port, minutes. */
  toPortMin: number;
  /** Simulated drive time from the port to the destination, minutes. */
  fromPortMin: number;
  via: string;
}

export interface Lane {
  origin: string;
  /** Short origin city label, e.g. for corridor displays. */
  originCity: string;
  destination: string;
  appointmentMin: number;
  legs: Record<PortId, Leg>;
}

/** One simulated load per primary route, with legs to every port. */
export const LANES: Record<PortId, Lane> = {
  otay: {
    origin: "El Florido Industrial Park, Tijuana",
    originCity: "Tijuana",
    destination: "Distribution center, El Cajon, CA",
    appointmentMin: 17 * 60 + 30,
    legs: {
      otay: { toPortMin: 28, fromPortMin: 34, via: "Blvd. Industrial → Otay Mesa → SR-905 → SR-125 → I-8" },
      tecate: { toPortMin: 55, fromPortMin: 46, via: "Fed. Hwy 2 → Tecate → SR-94 → SR-125 → I-8" },
      calexico: { toPortMin: 150, fromPortMin: 105, via: "Hwy 2D → Mexicali → Calexico East → SR-7 → I-8 W" },
      sanluis: { toPortMin: 205, fromPortMin: 170, via: "Hwy 2D → SLRC → San Luis II → US-95 → I-8 W" },
    },
  },
  tecate: {
    origin: "Tecate industrial zone, Baja California",
    originCity: "Tecate, B.C.",
    destination: "Distribution center, Santee, CA",
    appointmentMin: 16 * 60 + 30,
    legs: {
      tecate: { toPortMin: 12, fromPortMin: 44, via: "Blvd. Universidad → Tecate → SR-94 → SR-125 → SR-52" },
      otay: { toPortMin: 50, fromPortMin: 32, via: "Hwy 2 → Otay Mesa → SR-905 → SR-125 → SR-52" },
      calexico: { toPortMin: 110, fromPortMin: 100, via: "Hwy 2D → Calexico East → I-8 W → SR-67" },
      sanluis: { toPortMin: 165, fromPortMin: 165, via: "Hwy 2D → San Luis II → US-95 → I-8 W" },
    },
  },
  calexico: {
    origin: "Parque Industrial Mexicali, Mexicali",
    originCity: "Mexicali",
    destination: "Cold-storage DC, El Centro, CA",
    appointmentMin: 17 * 60,
    legs: {
      calexico: { toPortMin: 25, fromPortMin: 20, via: "Blvd. Lázaro Cárdenas → Calexico East → SR-7 → I-8" },
      sanluis: { toPortMin: 60, fromPortMin: 85, via: "Hwy 2 → San Luis II → US-95 → I-8 W" },
      tecate: { toPortMin: 110, fromPortMin: 120, via: "Hwy 2D → Tecate → SR-94 → I-8 E" },
      otay: { toPortMin: 150, fromPortMin: 125, via: "Hwy 2D → Otay Mesa → SR-125 → I-8 E" },
    },
  },
  sanluis: {
    origin: "Parque Industrial San Luis Río Colorado",
    originCity: "San Luis R.C.",
    destination: "Distribution center, Yuma, AZ",
    appointmentMin: 17 * 60,
    legs: {
      sanluis: { toPortMin: 15, fromPortMin: 35, via: "Av. Internacional → San Luis II → SR-195 → I-8" },
      calexico: { toPortMin: 65, fromPortMin: 70, via: "Hwy 2 → Calexico East → SR-7 → I-8 E" },
      tecate: { toPortMin: 170, fromPortMin: 190, via: "Hwy 2D → Tecate → SR-94 → I-8 E" },
      otay: { toPortMin: 210, fromPortMin: 200, via: "Hwy 2D → Otay Mesa → SR-125 → I-8 E" },
    },
  },
};

/** Fictional driver persona and load shared by every lane. */
export const LOAD = {
  id: "BP-2047",
  driver: "Luis Ortega",
  unit: "Unit 4127",
  cargo: "Medical device components · 18 pallets",
};

/** Divert only when the alternative saves at least this many minutes. */
export const DIVERT_THRESHOLD_MIN = 20;

/** A current wait reading for one port (from CBP, or from this model as a fallback). */
export interface LiveWait {
  source: "cbp" | "model";
  /** Current commercial (standard lane) delay; null when the feed gives no number. */
  delayMin: number | null;
  /** Commercial lanes are processing trucks right now. */
  open: boolean;
  /** Operating hours, minutes from midnight. */
  opens: number;
  closes: number;
  /** Human-readable lane status, e.g. CBP "no delay" / "Lanes Closed". */
  status: string;
}

/** A current CBP delay at or above this is treated as a bottleneck at the primary port. */
export const LIVE_BOTTLENECK_MIN = 60;

export interface Scenario {
  minuteOfDay: number;
  /** The route the load is currently booked on. */
  primary: PortId;
  /** Simulated bottleneck (lane closures) at the primary port. */
  bottleneck: boolean;
  /** Live readings. When present for a port, they replace the model's wait curve and hours. */
  live?: Partial<Record<PortId, LiveWait>>;
}

export const DEFAULT_SCENARIO: Scenario = { minuteOfDay: 13 * 60 + 40, primary: "otay", bottleneck: true };

const bump = (h: number, center: number, width: number) =>
  Math.exp(-((h - center) ** 2) / (2 * width ** 2));

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function isOpen(port: PortId, minuteOfDay: number): boolean {
  const p = PORTS[port];
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return m >= p.opens && m < p.closes;
}

/** Simulated commercial wait (minutes) for a truck arriving at `minuteOfDay`. */
export function waitAt(port: PortId, minuteOfDay: number, bottleneck: boolean): number {
  const h = minuteOfDay / 60;
  let w: number;
  switch (port) {
    case "otay":
      w = 30 + 70 * bump(h, 9.5, 1.6) + 100 * bump(h, 15, 2.2);
      break;
    case "tecate":
      w = 10 + 18 * bump(h, 10.5, 1.8) + 14 * bump(h, 14, 1.4);
      break;
    case "calexico":
      w = 20 + 30 * bump(h, 10, 2) + 25 * bump(h, 15, 2);
      break;
    case "sanluis":
      w = 12 + 15 * bump(h, 9.5, 1.6) + 12 * bump(h, 14, 1.8);
      break;
  }
  // Simulated bottleneck: inspection lanes closed, effect between ~12:00 and ~19:00.
  if (bottleneck) w += 65 * sigmoid((h - 12) * 3) * sigmoid((19 - h) * 3);
  return Math.round(w);
}

export interface TripPlan {
  port: PortId;
  departMin: number;
  toPortMin: number;
  waitMin: number;
  fromPortMin: number;
  totalMin: number;
  arrivePortMin: number;
  etaMin: number;
  via: string;
  available: boolean;
  unavailableReason?: string;
  /** Positive = minutes late for appointment, negative = minutes early. */
  appointmentDeltaMin: number;
}

function withinHours(minuteOfDay: number, opens: number, closes: number): boolean {
  return minuteOfDay >= opens && minuteOfDay < closes;
}

export function planTrip(port: PortId, scenario: Scenario): TripPlan {
  const { minuteOfDay: departMin, primary, bottleneck } = scenario;
  const lane = LANES[primary];
  const leg = lane.legs[port];
  const p = PORTS[port];
  const arrivePortMin = departMin + leg.toPortMin;
  const live = scenario.live?.[port];

  let available: boolean;
  let waitMin: number;
  let unavailableReason: string | undefined;
  if (live) {
    // Live readings are current delays, applied as the wait at arrival (CBP publishes no forecast).
    waitMin = live.delayMin ?? 0;
    const label = live.source === "cbp" ? "CBP" : "Model";
    if (!live.open || live.delayMin === null) {
      available = false;
      unavailableReason = `${label}: ${live.status}`;
    } else if (!withinHours(arrivePortMin, live.opens, live.closes)) {
      available = false;
      unavailableReason = `Closed at arrival (${fmtClock(arrivePortMin)}); ${label} hours ${fmtClock(live.opens)}–${fmtClock(live.closes)}`;
    } else {
      available = true;
    }
  } else {
    available = isOpen(port, arrivePortMin);
    waitMin = waitAt(port, arrivePortMin, bottleneck && port === primary);
    unavailableReason = available
      ? undefined
      : `Closed at arrival (${fmtClock(arrivePortMin)}); simulated hours ${fmtClock(p.opens)}–${fmtClock(p.closes)}`;
  }

  const totalMin = leg.toPortMin + waitMin + leg.fromPortMin;
  const etaMin = departMin + totalMin;
  return {
    port,
    departMin,
    toPortMin: leg.toPortMin,
    waitMin,
    fromPortMin: leg.fromPortMin,
    totalMin,
    arrivePortMin,
    etaMin,
    via: leg.via,
    available,
    unavailableReason,
    appointmentDeltaMin: etaMin - lane.appointmentMin,
  };
}

export type Action = "divert" | "stay" | "hold";
export type Confidence = "high" | "medium" | "low";

export interface Decision {
  action: Action;
  /** Recommended port, or null when holding. */
  port: PortId | null;
  headline: string;
  savingsMin: number;
  confidence: Confidence;
  reasons: string[];
  primary: TripPlan;
  /** Best alternative to the primary route (open if any alternative is open). */
  alternative: TripPlan;
  plans: Record<PortId, TripPlan>;
  bottleneck: boolean;
  /** Where the primary port's wait came from. */
  dataSource: "cbp" | "model";
  computedAtSimMin: number;
}

export function recommend(scenario: Scenario): Decision {
  const plans = Object.fromEntries(PORT_IDS.map((p) => [p, planTrip(p, scenario)])) as Record<PortId, TripPlan>;
  const primary = plans[scenario.primary];
  const alts = PORT_IDS.filter((p) => p !== scenario.primary)
    .map((p) => plans[p])
    .sort((a, b) => Number(b.available) - Number(a.available) || a.totalMin - b.totalMin);
  const alternative = alts[0];
  const savingsMin = primary.totalMin - alternative.totalMin;
  const pName = PORTS[primary.port].shortName;
  const aName = PORTS[alternative.port].shortName;
  const appt = LANES[scenario.primary].appointmentMin;
  const livePrimary = scenario.live?.[scenario.primary];
  const dataSource: Decision["dataSource"] = livePrimary?.source === "cbp" ? "cbp" : "model";
  const bottleneck = livePrimary
    ? livePrimary.open && (livePrimary.delayMin ?? 0) >= LIVE_BOTTLENECK_MIN
    : scenario.bottleneck;
  const base = { primary, alternative, plans, savingsMin, bottleneck, dataSource, computedAtSimMin: scenario.minuteOfDay };

  if (!primary.available && !alternative.available) {
    return {
      ...base,
      action: "hold",
      port: null,
      headline: "Hold at origin",
      confidence: "high",
      reasons: ["No simulated commercial port is open at the projected arrival time."],
    };
  }
  if (!alternative.available) {
    return {
      ...base,
      action: "stay",
      port: primary.port,
      headline: `Stay on ${pName}`,
      confidence: "high",
      reasons: ["No alternative port is open at its projected arrival time.", `${pName} is the only open option.`],
    };
  }
  if (!primary.available) {
    return {
      ...base,
      action: "divert",
      port: alternative.port,
      headline: `Divert to ${aName}`,
      confidence: "high",
      reasons: [`${pName} unavailable: ${primary.unavailableReason}.`, `${aName} is the fastest open alternative.`],
    };
  }

  const extraDrive = alternative.toPortMin + alternative.fromPortMin - (primary.toPortMin + primary.fromPortMin);
  const waitGap = primary.waitMin - alternative.waitMin;

  if (savingsMin >= DIVERT_THRESHOLD_MIN) {
    const reasons = [
      `${pName} wait forecast ${fmtDur(primary.waitMin)} vs. ${fmtDur(alternative.waitMin)} at ${aName} (${fmtDur(waitGap)} less waiting).`,
      extraDrive > 0
        ? `${aName} adds ${fmtDur(extraDrive)} of driving, still a net saving of ${fmtDur(savingsMin)}.`
        : `${aName} is also ${fmtDur(-extraDrive)} shorter to drive.`,
    ];
    if (primary.appointmentDeltaMin > 0 && alternative.appointmentDeltaMin <= 0)
      reasons.push(`Makes the ${fmtClock(appt)} appointment; ${pName} misses it by ${fmtDur(primary.appointmentDeltaMin)}.`);
    const closeBuffer = PORTS[alternative.port].closes - alternative.arrivePortMin;
    if (closeBuffer < 60) reasons.push(`Caution: arrives only ${fmtDur(closeBuffer)} before ${aName}'s simulated close.`);
    return {
      ...base,
      action: "divert",
      port: alternative.port,
      headline: `Divert to ${aName}`,
      confidence: savingsMin >= 45 && closeBuffer >= 60 ? "high" : "medium",
      reasons,
    };
  }

  return {
    ...base,
    action: "stay",
    port: primary.port,
    headline: `Stay on ${pName}`,
    confidence: savingsMin <= 0 ? "high" : "low",
    reasons: [
      savingsMin <= 0
        ? `${pName} is faster than the best alternative (${aName}) by ${fmtDur(-savingsMin)} door to door.`
        : `${aName} saves only ${fmtDur(savingsMin)}, below the ${DIVERT_THRESHOLD_MIN} min divert threshold.`,
      extraDrive > 0
        ? `${aName}'s extra ${fmtDur(extraDrive)} of driving outweighs the wait difference.`
        : `Wait at ${aName} offsets its shorter drive.`,
    ],
  };
}

export interface SeriesPoint {
  minute: number;
  values: Record<PortId, number | null>;
}

export function daySeries(primary: PortId, bottleneck: boolean, step = 10, from = 5 * 60, to = 23 * 60): SeriesPoint[] {
  const pts: SeriesPoint[] = [];
  for (let m = from; m <= to; m += step) {
    const values = Object.fromEntries(
      PORT_IDS.map((p) => [p, isOpen(p, m) ? waitAt(p, m, bottleneck && p === primary) : null]),
    ) as Record<PortId, number | null>;
    pts.push({ minute: m, values });
  }
  return pts;
}

export function fmtDur(min: number): string {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return `${h}h ${String(r).padStart(2, "0")}m`;
}

export function fmtClock(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}
