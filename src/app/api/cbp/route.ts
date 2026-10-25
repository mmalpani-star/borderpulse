import { NextResponse } from "next/server";
import { CBP_URL, buildCbpResponse, modelResponse, type CbpResponse } from "@/lib/cbp";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
const FAILURE_TTL_MS = 15_000;

// One upstream request per minute per server instance, however many dashboards poll.
const g = globalThis as unknown as { __bpCbp?: { at: number; ttl: number; body: CbpResponse } };

export async function GET() {
  const now = Date.now();
  const cached = g.__bpCbp;
  if (cached && now - cached.at < cached.ttl) return respond(cached.body);

  let body: CbpResponse;
  let ttl = TTL_MS;
  try {
    // CBP_FEED_URL lets you point at a mirror or saved snapshot (e.g. for offline demos).
    const res = await fetch(process.env.CBP_FEED_URL || CBP_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(res.status === 429 ? "CBP rate-limited the request" : `CBP HTTP ${res.status}`);
    body = buildCbpResponse(await res.json(), new Date(now));
    if (body.source === "model") ttl = FAILURE_TTL_MS;
  } catch (err) {
    body = modelResponse(new Date(now), err instanceof Error ? err.message : "CBP unreachable");
    ttl = FAILURE_TTL_MS;
  }
  g.__bpCbp = { at: now, ttl, body };
  return respond(body);
}

function respond(body: CbpResponse) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": body.source === "cbp" ? "public, s-maxage=60, stale-while-revalidate=120" : "no-store",
    },
  });
}
