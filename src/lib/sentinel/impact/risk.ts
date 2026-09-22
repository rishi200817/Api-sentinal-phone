/**
 * Deterministic breaking-risk classifier.
 * Pure function: (change type + field changes) -> severity + verdict.
 * Never claims more certainty than the evidence supports.
 */
import type {
  ApiChange,
  ChangeType,
  FieldChange,
  Severity,
} from "../types";

export function classifyChange(
  type: ChangeType,
  fieldChanges: FieldChange[]
): { severity: Severity; breaking: ApiChange["breaking"] } {
  const kinds = new Set(fieldChanges.map((f) => f.kind));
  const worstField = worst(fieldChanges.map((f) => f.breaking));

  switch (type) {
    case "NEW_ENDPOINT":
      return { severity: "LOW", breaking: "non-breaking" };
    case "DELETED_ENDPOINT":
      return { severity: "CRITICAL", breaking: "likely-breaking" };
    case "METHOD_CHANGED":
      return { severity: "CRITICAL", breaking: "likely-breaking" };
    case "REQUEST_SCHEMA_CHANGED": {
      if (kinds.has("field-removed")) {
        // required field removed vs optional removed
        const reqRemoved = fieldChanges.some(
          (f) => f.kind === "field-removed" && (f.before ?? "").includes("required")
        );
        return reqRemoved
          ? { severity: "HIGH", breaking: "potentially-breaking" }
          : { severity: "MEDIUM", breaking: "potentially-breaking" };
      }
      if (kinds.has("type-changed"))
        return { severity: "HIGH", breaking: "likely-breaking" };
      const reqAdded = fieldChanges.some(
        (f) => f.kind === "field-added" && (f.after ?? "").includes("required")
      );
      if (reqAdded) return { severity: "HIGH", breaking: "potentially-breaking" };
      if (kinds.has("required-changed")) {
        const tightened = fieldChanges.some(
          (f) => f.kind === "required-changed" && f.after === "required"
        );
        return tightened
          ? { severity: "HIGH", breaking: "potentially-breaking" }
          : { severity: "LOW", breaking: "non-breaking" };
      }
      if (kinds.has("field-added"))
        return { severity: "LOW", breaking: "non-breaking" };
      return { severity: "MEDIUM", breaking: worstField };
    }
    case "RESPONSE_SCHEMA_CHANGED": {
      if (kinds.has("field-removed") || kinds.has("type-changed"))
        return { severity: "HIGH", breaking: "likely-breaking" };
      if (kinds.has("status-removed"))
        return { severity: "MEDIUM", breaking: "potentially-breaking" };
      return { severity: "LOW", breaking: "non-breaking" };
    }
    case "PARAMETER_CHANGED": {
      if (kinds.has("param-removed"))
        return { severity: "HIGH", breaking: "likely-breaking" };
      const reqAdded = fieldChanges.some(
        (f) => f.kind === "param-added" && (f.after ?? "").includes("required")
      );
      if (reqAdded) return { severity: "HIGH", breaking: "potentially-breaking" };
      if (kinds.has("param-changed"))
        return { severity: "MEDIUM", breaking: "potentially-breaking" };
      return { severity: "LOW", breaking: "non-breaking" };
    }
    case "AUTH_CHANGED": {
      const removed = fieldChanges.some(
        (f) => f.kind === "auth-changed" && f.after === "no auth"
      );
      if (removed) return { severity: "CRITICAL", breaking: "likely-breaking" };
      return { severity: "HIGH", breaking: "potentially-breaking" };
    }
    case "MODIFIED_ENDPOINT":
      return { severity: "MEDIUM", breaking: "unclear" };
    case "NO_CHANGE":
      return { severity: "LOW", breaking: "non-breaking" };
  }
}

function worst(
  verdicts: ApiChange["breaking"][]
): ApiChange["breaking"] {
  const order = {
    "non-breaking": 0,
    "potentially-breaking": 1,
    unclear: 2,
    "likely-breaking": 3,
  };
  let best: ApiChange["breaking"] = "non-breaking";
  for (const v of verdicts) {
    if (order[v] > order[best]) best = v;
  }
  return best;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const BREAKING_LABEL: Record<ApiChange["breaking"], string> = {
  "non-breaking": "Non-breaking",
  "potentially-breaking": "Potentially breaking",
  "likely-breaking": "Likely breaking",
  unclear: "Unclear",
};
