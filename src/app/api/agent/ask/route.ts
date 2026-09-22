import { addHistory, nowIso, uid } from "@/db/store";
import { askSentinel, buildContext } from "@/lib/sentinel/agent/orchestrator";
import { clampString, MAX_QUESTION_CHARS } from "@/lib/sentinel/security/guards";
import { fail, ok, readJson } from "../../_util";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Bad request.", 400);
  }
  const question = clampString(body.question, MAX_QUESTION_CHARS).trim();
  const repoId = typeof body.repoId === "string" ? body.repoId : undefined;
  const analysisId = typeof body.analysisId === "string" ? body.analysisId : undefined;
  let imageDataUrl: string | undefined;
  if (typeof body.imageDataUrl === "string" && body.imageDataUrl.startsWith("data:image/")) {
    if (body.imageDataUrl.length > 1_500_000) {
      return fail("Attached image is too large (1.5MB cap). Take a closer photo.", 413);
    }
    imageDataUrl = body.imageDataUrl;
  }
  if (!question && !imageDataUrl) return fail("A question is required.", 400);
  try {
    const ctx = buildContext(repoId, analysisId);
    const answer = await askSentinel(question || "What does this photo show about my API?", ctx, imageDataUrl);
    addHistory({
      id: uid("hist"),
      repoId,
      analysisId,
      kind: "agent-run",
      actor: "user",
      message: `Asked Sentinel: "${question.slice(0, 120)}" → answered via ${answer.providerKind}:${answer.provider} (${answer.latencyMs}ms).`,
      createdAt: nowIso(),
    });
    return ok({ answer });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Agent failed.", 500);
  }
}
