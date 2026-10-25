// U.S. CBP Border Wait Times ingestion. Pure functions; the network call lives in /api/cbp.
import type { LiveWait, PortId } from "./sim.ts";
import { PORTS, PORT_IDS, isOpen, waitAt } from "./sim.ts";

/** Public CBP Border Wait Times JSON feed (the same data that backs bwt.cbp.gov). */
export const CBP_URL = "https://bwt.cbp.gov/api/bwtnew";

/** CBP port numbers for each port's COMMERCIAL crossing (verified against the live feed). */
export const CBP_PORTS: Record<PortId, string> = {
  otay: "250602", // Otay Mesa · Commercial (250601 is the passenger crossing)
  tecate: "250501", // Tecate
  calexico: "250301", // Calexico · East
  sanluis: "260802", // San Luis · San Luis II
};

export interface CbpReading extends LiveWait {
  port: PortId;
  portNumber: string | null;
  crossing: string;
  hours: string;
  /** FAST lane delay, when CBP reports one. */
  fastDelayMin: number | null;
  lanesOpen: number | null;
  maxLanes: number | null;
  /** CBP's own lane update label, e.g. "At 3:00 pm PDT". */
  updateTime: string | null;
  /** CBP record date/time (port local time). */
  cbpDate: string | null;
  cbpTime: string | null;
}

export interface CbpResponse {
  /** "cbp" when at least one port came from the live feed; "model" when the whole feed failed. */
  source: "cbp" | "model";
  fetchedAt: string;
  /** Latest CBP record timestamp across the four ports (port local time), if any. */
  lastUpdated: string | null;
  ports: Record<PortId, CbpReading>;
  error?: string;
}

const toInt = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const clock = (h: string, m: string | undefined, ampm: string) => ((Number(h) % 12) + (ampm.toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(m ?? 0);

/** Parses CBP hours like "6 am-10 pm", "9:30 am-5 pm" or "24 hrs/day". */
export function parseHours(hours: string): { opens: number; closes: number } | null {
  if (/24\s*hrs/i.test(hours)) return { opens: 0, closes: 1440 };
  const m = hours.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  const closes = clock(m[4], m[5], m[6]);
  // "12 am" as a closing time means end of day.
  return { opens: clock(m[1], m[2], m[3]), closes: closes === 0 ? 1440 : closes };
}

interface CbpLane {
  operational_status?: string;
  delay_minutes?: string;
  lanes_open?: string;
  update_time?: string;
}

interface CbpRecord {
  port_number?: string;
  port_name?: string;
  crossing_name?: string;
  hours?: string;
  port_status?: string;
  date?: string;
  time?: string;
  commercial_vehicle_lanes?: { maximum_lanes?: string; standard_lanes?: CbpLane; FAST_lanes?: CbpLane };
}

export function readingFromRecord(port: PortId, r: CbpRecord): CbpReading {
  const cv = r.commercial_vehicle_lanes ?? {};
  const std = cv.standard_lanes ?? {};
  const fast = cv.FAST_lanes ?? {};
  const status = (std.operational_status || "N/A").trim();
  const hours = parseHours(r.hours ?? "") ?? { opens: PORTS[port].opens, closes: PORTS[port].closes };
  const delayMin = toInt(std.delay_minutes);
  return {
    port,
    source: "cbp",
    portNumber: r.port_number ?? null,
    crossing: [r.port_name, r.crossing_name].filter(Boolean).join(" · "),
    hours: r.hours ?? "",
    // CBP marks processing lanes as "no delay" or "delay"; anything else (Lanes Closed, Update Pending, N/A) is not usable.
    open: r.port_status === "Open" && /^(no )?delay$/i.test(status),
    delayMin,
    status,
    opens: hours.opens,
    closes: hours.closes,
    fastDelayMin: toInt(fast.delay_minutes),
    lanesOpen: toInt(std.lanes_open),
    maxLanes: toInt(cv.maximum_lanes),
    updateTime: std.update_time?.trim() || null,
    cbpDate: r.date ?? null,
    cbpTime: r.time ?? null,
  };
}

/** Picks our four commercial crossings out of the full CBP feed. */
export function parseCbp(feed: unknown): Partial<Record<PortId, CbpReading>> {
  if (!Array.isArray(feed)) return {};
  const out: Partial<Record<PortId, CbpReading>> = {};
  for (const port of PORT_IDS) {
    const rec = feed.find((r): r is CbpRecord => !!r && typeof r === "object" && (r as CbpRecord).port_number === CBP_PORTS[port]);
    if (rec) out[port] = readingFromRecord(port, rec);
  }
  return out;
}

/** Fallback reading from the deterministic model, clearly marked as model data. */
export function modelReading(port: PortId, minuteOfDay: number): CbpReading {
  const open = isOpen(port, minuteOfDay);
  return {
    port,
    source: "model",
    portNumber: CBP_PORTS[port],
    crossing: PORTS[port].name,
    hours: "",
    open,
    delayMin: open ? waitAt(port, minuteOfDay, false) : null,
    status: open ? "Simulated" : "Simulated: closed",
    opens: PORTS[port].opens,
    closes: PORTS[port].closes,
    fastDelayMin: null,
    lanesOpen: null,
    maxLanes: null,
    updateTime: null,
    cbpDate: null,
    cbpTime: null,
  };
}

/** Current minute of day in the San Diego–Baja region (all four ports share Pacific-equivalent time in DST). */
export function pacificMinuteOfDay(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * CBP stamps each record in its port's local clock (e.g. San Luis reads an hour ahead of the
 * California ports). Returns that clock's offset from Pacific, rounded to whole hours.
 */
export function clockOffsetMin(cbpTime: string | null, pacificMinute: number): number {
  const m = cbpTime?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  let diff = Number(m[1]) * 60 + Number(m[2]) - pacificMinute;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return Math.round(diff / 60) * 60;
}

/** Builds the API response: live readings where available, model readings for anything missing. */
export function buildCbpResponse(feed: unknown, now: Date): CbpResponse {
  const minute = pacificMinuteOfDay(now);
  const parsed = parseCbp(feed);
  // Express every port's operating hours in Pacific time so arrival checks share one clock.
  const offsets: Partial<Record<PortId, number>> = {};
  for (const r of Object.values(parsed)) {
    const off = clockOffsetMin(r.cbpTime, minute);
    offsets[r.port] = off;
    if (off !== 0 && !(r.opens === 0 && r.closes === 1440)) {
      r.opens -= off;
      r.closes -= off;
    }
  }
  const ports = Object.fromEntries(PORT_IDS.map((p) => [p, parsed[p] ?? modelReading(p, minute)])) as Record<PortId, CbpReading>;
  // Report the freshest timestamp from a port on Pacific time, so it reads as Pacific.
  const stamps = Object.values(parsed)
    .filter((r) => r.cbpDate && r.cbpTime && offsets[r.port] === 0)
    .map((r) => `${r.cbpDate} ${r.cbpTime}`)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  const live = Object.keys(parsed).length > 0;
  return {
    source: live ? "cbp" : "model",
    fetchedAt: now.toISOString(),
    lastUpdated: stamps[0] ?? null,
    ports,
    ...(live ? {} : { error: "No matching ports in CBP feed" }),
  };
}

export function modelResponse(now: Date, error: string): CbpResponse {
  const minute = pacificMinuteOfDay(now);
  return {
    source: "model",
    fetchedAt: now.toISOString(),
    lastUpdated: null,
    ports: Object.fromEntries(PORT_IDS.map((p) => [p, modelReading(p, minute)])) as Record<PortId, CbpReading>,
    error,
  };
}
