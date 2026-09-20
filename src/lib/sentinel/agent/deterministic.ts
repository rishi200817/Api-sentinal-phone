/**
 * DeterministicProvider — always available, fully grounded.
 * Template-driven answers computed from real analyzed data. This is the
 * honest fallback: it never invents endpoints, fields, or results.
 */
import type {
  AgentAnswer,
  ApiChange,
  ProviderStatus,
  SentinelContext,
} from "../types";
import type { AIProvider } from "./providers";
import { BREAKING_LABEL, SEVERITY_LABEL } from "../impact/risk";
import { MATCH_KIND_LABEL } from "../impact/analyzer";

function evidenceFor(ctx: SentinelContext, change?: ApiChange): AgentAnswer["evidence"] {
  const ev: AgentAnswer["evidence"] = [];
  const list = change ? [change] : ctx.changes.slice(0, 5);
  for (const c of list) {
    ev.push({ label: "ENDPOINT", ref: `${c.method} ${c.path}` });
    for (const e of c.evidence.slice(0, 2)) ev.push({ label: "SOURCE", ref: e });
    for (const f of c.fieldChanges.slice(0, 3)) ev.push({ label: "CHANGE", ref: f.note });
  }
  if (ctx.validation) {
    ev.push({
      label: "VALIDATION",
      ref: ctx.validation.valid
        ? `PASSED · ${ctx.validation.operations} ops`
        : `FAILED · ${ctx.validation.errors.length} errors`,
    });
  }
  return ev.slice(0, 10);
}

const ACTIONS = [
  { id: "explain", label: "Explain" },
  { id: "impact", label: "Show impact" },
  { id: "migration", label: "Generate migration" },
  { id: "sync", label: "Review docs sync" },
];

export class DeterministicProvider implements AIProvider {
  id = "deterministic";
  kind = "deterministic" as const;
  label = "Deterministic grounded analysis";

  async status(): Promise<ProviderStatus> {
    return {
      id: this.id,
      kind: this.kind,
      connected: true,
      label: this.label,
      detail: "Built-in engine. Always available, grounded in analyzed data.",
    };
  }

  async explainChange(change: ApiChange, ctx: SentinelContext): Promise<string> {
    const parts: string[] = [];
    parts.push(
      `**${change.type}** on \`${change.method} ${change.path}\` — ${SEVERITY_LABEL[change.severity]} risk, ${BREAKING_LABEL[change.breaking]}.`
    );
    parts.push("");
    parts.push(change.detail);
    if (change.fieldChanges.length) {
      parts.push("");
      parts.push("Field-level evidence:");
      for (const f of change.fieldChanges) {
        parts.push(`- ${f.note} (${BREAKING_LABEL[f.breaking]})`);
      }
    }
    const impact = ctx.impact.filter((i) => i.changeId === change.id);
    if (impact.length) {
      parts.push("");
      parts.push(`Potential consumers (${impact.length}):`);
      for (const i of impact.slice(0, 8)) {
        parts.push(
          `- ${MATCH_KIND_LABEL[i.matchKind]}: \`${i.consumerFile}${i.consumerLine ? `:${i.consumerLine}` : ""}\` — ${i.note}`
        );
      }
    } else {
      parts.push("");
      parts.push("No consumer references were found in the scanned repository for this endpoint.");
    }
    parts.push("");
    parts.push(`Recommendation: ${change.recommendation}`);
    return parts.join("\n");
  }

  async answerQuestion(
    question: string,
    ctx: SentinelContext,
    imageDataUrl?: string
  ): Promise<Omit<AgentAnswer, "provider" | "providerKind" | "latencyMs">> {
    if (imageDataUrl) {
      return {
        answer:
          "I received your photo, but the deterministic engine cannot see images — no vision-capable model is connected. " +
          "Describe the endpoint, status code, or code shown (or connect a local vision model / remote vision provider in Settings), " +
          "and I'll analyze it against the live API data.\n\n" +
          (await this.answerQuestion(question || "What changed in my API?", ctx)).answer,
        grounded: true,
        evidence: evidenceFor(ctx),
        actions: ACTIONS,
      };
    }
    const q = question.toLowerCase();
    const changes = ctx.changes;
    const breaking = changes.filter(
      (c) => c.breaking === "likely-breaking" || c.severity === "HIGH" || c.severity === "CRITICAL"
    );

    let answer: string;
    if (!ctx.repo) {
      answer =
        "No repository is connected yet. Connect a GitHub repository or load the built-in demo repository, then run an analysis — I'll answer from the real results.";
    } else if (/(what changed|latest|recent|summary|overview)/.test(q)) {
      answer = this.describeChanges(changes, ctx);
    } else if (/(breaking|break|risk|danger)/.test(q)) {
      answer = this.describeBreaking(breaking, changes);
    } else if (/(new endpoint|added endpoint)/.test(q)) {
      const news = changes.filter((c) => c.type === "NEW_ENDPOINT");
      answer = news.length
        ? `New endpoints (${news.length}):\n` +
          news.map((c) => `- \`${c.method} ${c.path}\` — ${c.after?.sourceFile}:${c.after?.sourceLine}`).join("\n")
        : "The latest analysis detected no new endpoints.";
    } else if (/(impact|affect|consumer|who uses|which files)/.test(q)) {
      answer = this.describeImpact(ctx);
    } else if (/(valid|openapi.*(ok|good|state)|spec.*valid|is .* (sync|synchron)|synchroniz)/.test(q)) {
      answer = this.describeSync(ctx);
    } else if (/(login|auth)/.test(q)) {
      const rel = changes.filter((c) => /login|auth/i.test(c.path));
      answer = rel.length
        ? `Auth-related changes (${rel.length}):\n` +
          (await this.bullets(rel, ctx))
        : `No auth-path changes detected. Current endpoints matching 'auth': ` +
          (ctx.endpoints.filter((e) => /auth/i.test(e.path)).map((e) => `\`${e.method} ${e.path}\``).join(", ") || "none") +
          ".";
    } else if (/(migrat|upgrade|fix my|how do i (fix|update))/.test(q)) {
      const top = breaking[0] ?? changes[0];
      answer = top
        ? await this.generateMigration(top, ctx)
        : "No changes detected, so no migration is needed. The API surface is unchanged.";
    } else if (/(endpoint|route|api surface|how many)/.test(q)) {
      answer =
        `The repository exposes **${ctx.endpoints.length} endpoints**:\n` +
        ctx.endpoints
          .slice(0, 25)
          .map((e) => `- \`${e.method} ${e.path}\` (${e.framework}, ${e.sourceFile}:${e.sourceLine})`)
          .join("\n") +
        (ctx.endpoints.length > 25 ? `\n…and ${ctx.endpoints.length - 25} more.` : "");
    } else if (/(help|what can you)/.test(q)) {
      answer =
        "I can answer from the live analysis: what changed, breaking risks, new endpoints, impact/consumers, OpenAPI validation state, and migrations. Try “What changed in my API?” or “Show breaking changes.”";
    } else {
      // grounded generic: still answer from data
      answer = this.describeChanges(changes, ctx);
      if (changes.length) {
        answer +=
          `\n\nI answered with the latest detected changes because your question didn't match a specific category — ` +
          `ask about breaking changes, impact, endpoints, or sync state for a focused answer.`;
      }
    }

    return { answer, grounded: true, evidence: evidenceFor(ctx), actions: ACTIONS };
  }

  private describeChanges(changes: ApiChange[], ctx: SentinelContext): string {
    if (!changes.length) {
      return `No API contract changes detected${ctx.analysis ? ` in analysis \`${ctx.analysis.id}\`` : ""}. The API surface matches the previous snapshot (${ctx.endpoints.length} endpoints).`;
    }
    const bySev = (s: string) => changes.filter((c) => c.severity === s).length;
    return (
      `Detected **${changes.length} change${changes.length === 1 ? "" : "s"}** ` +
      `(Critical ${bySev("CRITICAL")} · High ${bySev("HIGH")} · Medium ${bySev("MEDIUM")} · Low ${bySev("LOW")}):\n` +
      changes
        .slice(0, 12)
        .map((c) => `- [${c.severity}] \`${c.method} ${c.path}\` — ${c.type}: ${c.detail.slice(0, 180)}`)
        .join("\n")
    );
  }

  private describeBreaking(breaking: ApiChange[], all: ApiChange[]): string {
    if (!all.length) return "No changes detected, so there is nothing breaking. The API surface is stable.";
    if (!breaking.length) {
      return `No breaking-risk changes. All ${all.length} detected change${all.length === 1 ? " is" : "s are"} non-breaking or low risk.`;
    }
    return (
      `**${breaking.length} breaking-risk change${breaking.length === 1 ? "" : "s"}:**\n` +
      breaking
        .map(
          (c) =>
            `- [${c.severity}/${BREAKING_LABEL[c.breaking]}] \`${c.method} ${c.path}\` — ${c.detail.slice(0, 220)}\n  Recommendation: ${c.recommendation}`
        )
        .join("\n")
    );
  }

  private describeImpact(ctx: SentinelContext): string {
    if (!ctx.impact.length) {
      return ctx.changes.length
        ? "Impact analysis ran and found no consumer references in the scanned repository for the changed endpoints."
        : "No changes to analyze impact for. Run an analysis first.";
    }
    const lines = [`Found **${ctx.impact.length} potential consumer references**:`];
    for (const i of ctx.impact.slice(0, 15)) {
      lines.push(
        `- ${MATCH_KIND_LABEL[i.matchKind]}: \`${i.consumerFile}${i.consumerLine ? `:${i.consumerLine}` : ""}\` — ${i.note}\n  \`${i.snippet.slice(0, 140)}\``
      );
    }
    lines.push(
      "\nThese are reference findings, not proof of breakage — review each call site against the schema change."
    );
    return lines.join("\n");
  }

  private describeSync(ctx: SentinelContext): string {
    const v = ctx.validation;
    const h = ctx.health;
    const parts: string[] = [];
    if (!v) {
      parts.push("No OpenAPI validation has run yet for this repository.");
    } else if (v.valid) {
      parts.push(
        `Yes — OpenAPI validation **PASSED** (${v.specVersion ?? "3.x"}, ${v.operations} operations, ${v.warnings.length} warnings) via ${v.engine.join(" + ")}.`
      );
    } else {
      parts.push(`No — OpenAPI validation **FAILED** with ${v.errors.length} error(s):`);
      for (const e of v.errors.slice(0, 6)) parts.push(`- ${e.path}: ${e.message}`);
      parts.push("Resolve these before publishing — Sentinel will not publish an invalid spec.");
    }
    if (h) {
      parts.push(
        `\nDocumentation health: **${h.score}%** — ${h.documented}/${h.totalEndpoints} endpoints documented, ${h.outOfSync} out of sync, ${h.breakingOpen} breaking-risk open.`
      );
    }
    const unsynced = ctx.changes.filter((c) => !c.synced);
    if (unsynced.length) {
      parts.push(`\n${unsynced.length} detected change(s) are not yet synced to OpenAPI. Review them in API Changes.`);
    } else if (ctx.changes.length) {
      parts.push("\nAll detected changes are synced to the published specification.");
    }
    return parts.join("\n");
  }

  private async bullets(changes: ApiChange[], ctx: SentinelContext): Promise<string> {
    void ctx;
    return changes
      .map((c) => `- [${c.severity}] \`${c.method} ${c.path}\` — ${c.detail.slice(0, 200)}`)
      .join("\n");
  }

  async generateMigration(change: ApiChange, ctx: SentinelContext): Promise<string> {
    void ctx;
    const lines: string[] = [];
    lines.push(`## Migration: \`${change.method} ${change.path}\``);
    lines.push("");
    lines.push(`Change: **${change.type}** (${SEVERITY_LABEL[change.severity]}, ${BREAKING_LABEL[change.breaking]})`);
    lines.push("");
    const reqAdded = change.fieldChanges.filter((f) => f.kind === "field-added");
    const reqRemoved = change.fieldChanges.filter((f) => f.kind === "field-removed");
    if (reqAdded.length) {
      lines.push("### 1. Send the new required fields");
      lines.push("```json");
      lines.push("{");
      for (const f of reqAdded) {
        lines.push(`  "${f.field}": "<${(f.after ?? "value").split(",")[0]}>"${f === reqAdded[reqAdded.length - 1] ? "" : ","}`);
      }
      lines.push("}");
      lines.push("```");
    }
    if (reqRemoved.length) {
      lines.push("### 2. Stop depending on removed fields");
      for (const f of reqRemoved) lines.push(`- Remove usage of \`${f.field}\` (${f.location}).`);
      lines.push("");
    }
    if (change.type === "DELETED_ENDPOINT" || change.type === "METHOD_CHANGED") {
      lines.push("### 2. Update every call site");
      lines.push(`- \`${change.method} ${change.path}\` no longer behaves as before — update clients before upgrading.`);
      lines.push("");
    }
    if (!reqAdded.length && !reqRemoved.length && change.fieldChanges.length) {
      lines.push("### Steps");
      for (const f of change.fieldChanges) lines.push(`- ${f.note}`);
      lines.push("");
    }
    lines.push(`Recommendation: ${change.recommendation}`);
    return lines.join("\n");
  }

  async summarize(text: string, ctx: SentinelContext): Promise<string> {
    void ctx;
    const first = text.split("\n").filter(Boolean).slice(0, 4).join(" ");
    return first.length > 600 ? first.slice(0, 600) + "…" : first;
  }

  async generateDescription(change: ApiChange, ctx: SentinelContext): Promise<string> {
    void ctx;
    const e = change.after ?? change.before;
    if (!e) return `${change.method} ${change.path}`;
    const bits = [
      `${e.method} ${e.path}.`,
      e.requestBody?.fields.length
        ? `Accepts ${e.requestBody.fields.map((f) => f.name).join(", ")}.`
        : null,
      e.auth.required ? "Requires authentication." : "No authentication required.",
    ].filter(Boolean);
    return bits.join(" ");
  }
}
