/** Shared API route helpers: envelopes, errors, safe JSON parsing. */
import { NextResponse } from "next/server";
import { MAX_JSON_BYTES } from "@/lib/sentinel/security/guards";
import { newRequestId } from "@/lib/sentinel/logging";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data, requestId: newRequestId() }, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error: message, requestId: newRequestId(), ...extra },
    { status }
  );
}

export async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_JSON_BYTES) throw new Error("Request body too large.");
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new Error("Request body too large.");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Invalid JSON body.");
  }
}
