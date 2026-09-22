import { NextResponse } from "next/server";
import { store } from "@/db/store";

export const dynamic = "force-dynamic";

export async function GET() {
  // Availability probe only — never leaks secrets or data.
  return NextResponse.json({
    ok: true,
    service: "api-sentinel",
    version: "1.0.0",
    time: new Date().toISOString(),
    store: store.isMemoryOnly() ? "memory" : "persistent",
  });
}
