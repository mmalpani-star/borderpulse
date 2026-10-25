import { NextResponse } from "next/server";
import { CALL_ID_RE, VAPI_ENV, sanitizeVariables, summarizeCall } from "@/lib/vapi";

export const dynamic = "force-dynamic";

const VAPI_BASE = "https://api.vapi.ai";
const COOLDOWN_MS = 20_000;

// Guards against double-clicks placing two real calls. Per server instance.
const g = globalThis as unknown as { __bpLastCallAt?: number };

function missingEnv() {
  return VAPI_ENV.filter((k) => !process.env[k]);
}

async function vapiError(res: Response) {
  const data = (await res.json().catch(() => null)) as { message?: string | string[]; error?: string } | null;
  const msg = Array.isArray(data?.message) ? data.message.join("; ") : (data?.message ?? data?.error);
  return msg ? `Vapi call failed: ${msg}` : `Vapi call failed (HTTP ${res.status})`;
}

/** Places a real outbound call through Vapi to the server-configured DRIVER_PHONE_NUMBER. */
export async function POST(req: Request) {
  try {
    const missing = missingEnv();
    if (missing.length) {
      return NextResponse.json({ error: `Missing Vapi .env variables: ${missing.join(", ")}` }, { status: 500 });
    }

    const now = Date.now();
    if (g.__bpLastCallAt && now - g.__bpLastCallAt < COOLDOWN_MS) {
      return NextResponse.json({ error: "A call was just placed. Wait a few seconds before retrying." }, { status: 429 });
    }

    const body = (await req.json().catch(() => null)) as { variables?: unknown } | null;
    const variableValues = sanitizeVariables(body?.variables);

    g.__bpLastCallAt = now;
    const response = await fetch(`${VAPI_BASE}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId: process.env.VAPI_ASSISTANT_ID,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: { number: process.env.DRIVER_PHONE_NUMBER },
        ...(variableValues && { assistantOverrides: { variableValues } }),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      g.__bpLastCallAt = undefined;
      return NextResponse.json({ error: await vapiError(response) }, { status: response.status });
    }
    const call = (await response.json()) as { id?: string; status?: string };
    return NextResponse.json({ success: true, call: { id: call.id, status: call.status } });
  } catch {
    g.__bpLastCallAt = undefined;
    return NextResponse.json({ error: "Server Error" }, { status: 500 });
  }
}

/**
 * Without `id`: reports whether live calling is configured (never returns secrets).
 * With `id`: returns the Vapi call status and whether the driver said "Confirm".
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    const to = process.env.DRIVER_PHONE_NUMBER;
    return NextResponse.json({
      configured: missingEnv().length === 0,
      maskedTo: to ? `•••${to.slice(-4)}` : null,
    });
  }
  if (missingEnv().length) return NextResponse.json({ error: "Vapi is not configured" }, { status: 500 });
  if (!CALL_ID_RE.test(id)) return NextResponse.json({ error: "Invalid call id" }, { status: 400 });

  try {
    const res = await fetch(`${VAPI_BASE}/call/${id}`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return NextResponse.json({ error: await vapiError(res) }, { status: res.status });
    return NextResponse.json(summarizeCall(await res.json()));
  } catch {
    return NextResponse.json({ error: "Server Error" }, { status: 500 });
  }
}
