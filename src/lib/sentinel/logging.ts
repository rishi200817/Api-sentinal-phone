/** Structured server logging. Never logs secrets. */
import { redactSecrets } from "./security/redact";

export interface LogFields {
  requestId?: string;
  analysisId?: string;
  repoId?: string;
  commitSha?: string;
  durationMs?: number;
  provider?: string;
  result?: string;
  [k: string]: unknown;
}

function emit(level: "info" | "warn" | "error", msg: string, fields: LogFields = {}) {
  const safe = JSON.parse(JSON.stringify(fields)) as LogFields;
  const clean = redactSecrets(safe);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...clean,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};

export function newRequestId(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}`;
}
