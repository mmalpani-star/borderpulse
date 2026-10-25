// Pure helpers for the Vapi integration (no secrets, safe to unit test).

export const VAPI_ENV = ["VAPI_API_KEY", "VAPI_ASSISTANT_ID", "VAPI_PHONE_NUMBER_ID", "DRIVER_PHONE_NUMBER"] as const;

export const CALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CONFIRM_RE = /\b(confirm|confirmed|confirming)\b/i;
export const DECLINE_RE = /\b(decline|declined|reject|rejected)\b/i;

/** Keeps only short string variables so the client cannot push arbitrary payloads to Vapi. */
export function sanitizeVariables(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input).slice(0, 16)) {
    if (/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k) && typeof v === "string") out[k] = v.slice(0, 600);
  }
  return Object.keys(out).length ? out : null;
}

interface VapiMessage {
  role?: string;
  message?: string;
  content?: string;
}

interface VapiCall {
  status?: string;
  endedReason?: string;
  transcript?: string;
  messages?: VapiMessage[];
  artifact?: { transcript?: string; messages?: VapiMessage[] };
}

/** Extracts what the driver (the "user" side of the call) said. */
export function driverUtterances(call: VapiCall): string[] {
  const msgs = call.artifact?.messages ?? call.messages ?? [];
  const fromMessages = msgs.filter((m) => m.role === "user").map((m) => m.message ?? m.content ?? "");
  if (fromMessages.length) return fromMessages;
  const transcript = call.artifact?.transcript ?? call.transcript ?? "";
  return transcript
    .split("\n")
    .filter((l) => /^\s*(user|customer)\s*:/i.test(l))
    .map((l) => l.replace(/^\s*\w+\s*:\s*/, ""));
}

export function summarizeCall(call: VapiCall) {
  const said = driverUtterances(call);
  return {
    status: call.status ?? "unknown",
    endedReason: call.endedReason ?? null,
    confirmed: said.some((t) => CONFIRM_RE.test(t)),
    declined: said.some((t) => DECLINE_RE.test(t)),
  };
}
