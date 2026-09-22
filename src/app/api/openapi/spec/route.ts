import { NextResponse } from "next/server";
import { latestOpenApi } from "@/db/store";

export const dynamic = "force-dynamic";

/** Raw published spec (JSON) — consumed by Swagger UI / Redoc. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId");
  if (!repoId) {
    return NextResponse.json({ ok: false, error: "repoId is required." }, { status: 400 });
  }
  const current = latestOpenApi(repoId);
  if (!current) {
    return NextResponse.json({ ok: false, error: "No published spec yet." }, { status: 404 });
  }
  return NextResponse.json(current.spec, {
    headers: { "Cache-Control": "no-store" },
  });
}
