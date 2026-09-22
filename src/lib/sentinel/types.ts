/**
 * API Sentinel — shared typed domain objects.
 * The deterministic engine is the source of truth; AI may explain but never
 * override facts produced here.
 */

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type Framework = "express" | "fastapi" | "spring" | "unknown";

export type Confidence = "detected" | "inferred";

export type ChangeType =
  | "NEW_ENDPOINT"
  | "DELETED_ENDPOINT"
  | "MODIFIED_ENDPOINT"
  | "REQUEST_SCHEMA_CHANGED"
  | "RESPONSE_SCHEMA_CHANGED"
  | "PARAMETER_CHANGED"
  | "METHOD_CHANGED"
  | "AUTH_CHANGED"
  | "NO_CHANGE";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type BreakingVerdict =
  | "non-breaking"
  | "potentially-breaking"
  | "likely-breaking"
  | "unclear";

export interface ApiParam {
  name: string;
  /** OpenAPI-style location */
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  type: string;
  description?: string;
  /** Where this fact came from, e.g. "@PathVariable", "req.query", "Pydantic" */
  origin: string;
  confidence: Confidence;
}

export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  origin: string;
  confidence: Confidence;
  children?: SchemaField[];
}

export interface RequestBodyShape {
  contentType: string;
  fields: SchemaField[];
  /** true when a body is expected at all */
  present: boolean;
  origin: string;
  confidence: Confidence;
}

export interface ResponseShape {
  status: string;
  description?: string;
  fields: SchemaField[];
  origin: string;
  confidence: Confidence;
}

export interface AuthShape {
  required: boolean;
  schemes: string[];
  description?: string;
  origin: string;
  confidence: Confidence;
}

/** Normalized API contract — the common internal model for every endpoint. */
export interface EndpointContract {
  /** stable id: METHOD + normalized path */
  id: string;
  method: HttpMethod;
  /** OpenAPI-style path, e.g. /api/users/{id} */
  path: string;
  controller?: string;
  sourceFile: string;
  sourceLine: number;
  framework: Framework;
  pathParams: ApiParam[];
  queryParams: ApiParam[];
  requestBody?: RequestBodyShape;
  responses: ResponseShape[];
  auth: AuthShape;
  summary?: string;
  description?: string;
  confidence: Confidence;
}

export interface FieldChange {
  kind:
    | "field-added"
    | "field-removed"
    | "type-changed"
    | "required-changed"
    | "param-added"
    | "param-removed"
    | "param-changed"
    | "status-added"
    | "status-removed"
    | "auth-changed"
    | "method-changed";
  location: string;
  field?: string;
  before?: string;
  after?: string;
  breaking: BreakingVerdict;
  note: string;
}

export interface ApiChange {
  id: string;
  type: ChangeType;
  severity: Severity;
  breaking: BreakingVerdict;
  method: HttpMethod;
  path: string;
  summary: string;
  detail: string;
  fieldChanges: FieldChange[];
  before?: EndpointContract | null;
  after?: EndpointContract | null;
  recommendation: string;
  /** human-readable evidence pointers, e.g. "src/routes/auth.ts:42" */
  evidence: string[];
  synced: boolean;
  createdAt: string;
}

export interface FrameworkDetection {
  framework: Framework;
  confidence: number;
  reason: string;
  signals: string[];
}

export interface ParseFileResult {
  file: string;
  framework: Framework;
  endpoints: EndpointContract[];
  skipped: boolean;
  skipReason?: string;
  durationMs: number;
}

export interface ScanLimits {
  filesScanned: number;
  apiFilesAnalyzed: number;
  filesSkipped: string[];
  bytesScanned: number;
  truncated: boolean;
  /** test/doc/example files searched for consumers only (never the contract) */
  consumerOnlyFiles?: number;
}

export interface PipelineStage {
  stage: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt?: string;
  endedAt?: string;
  detail?: string;
}

export type AnalysisStatus =
  | "queued"
  | "fetching"
  | "scanning"
  | "parsing"
  | "extracting"
  | "comparing"
  | "impact-analysis"
  | "ai-analysis"
  | "generating"
  | "validating"
  | "publishing"
  | "completed"
  | "failed";

export interface AnalysisRun {
  id: string;
  repoId: string;
  trigger: "manual" | "webhook" | "demo" | "poll" | "rescan";
  status: AnalysisStatus;
  stages: PipelineStage[];
  baseSha?: string | null;
  headSha?: string | null;
  changedFiles: string[];
  relevantFiles: string[];
  ignoredFiles: { file: string; reason: string }[];
  endpoints: EndpointContract[];
  previousEndpointCount?: number;
  changeIds: string[];
  framework?: FrameworkDetection;
  scanLimits?: ScanLimits;
  aiSummary?: string;
  aiProvider?: string;
  validation?: ValidationResult;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  specVersion?: string;
  operations: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  engine: string[];
  durationMs: number;
}

export interface OpenApiVersion {
  id: string;
  repoId: string;
  version: number;
  spec: Record<string, unknown>;
  specJson: string;
  validation: ValidationResult;
  source: "generated" | "patched" | "imported";
  analysisId?: string;
  changeIds: string[];
  createdAt: string;
}

export interface ImpactFinding {
  id: string;
  changeId: string;
  consumerFile: string;
  consumerLine?: number;
  matchKind:
    | "verified-reference"
    | "likely-consumer"
    | "reference-found"
    | "potential";
  snippet: string;
  note: string;
}

export interface Repository {
  id: string;
  name: string;
  owner: string;
  repo: string;
  url: string;
  defaultBranch: string;
  provider: "github" | "demo";
  status: "connected" | "error" | "disconnected";
  statusMessage?: string;
  lastSha?: string | null;
  lastAnalysisId?: string | null;
  webhookEnabled: boolean;
  webhookSecretSet: boolean;
  autoSyncPolicy: "manual" | "auto-safe" | "auto-all";
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEvent {
  id: string;
  repoId?: string;
  deliveryId: string;
  event: string;
  valid: boolean;
  rejectReason?: string;
  beforeSha?: string;
  afterSha?: string;
  branch?: string;
  changedFiles: string[];
  analysisId?: string;
  duplicate: boolean;
  receivedAt: string;
}

export interface SentinelNotification {
  id: string;
  repoId?: string;
  kind: "breaking" | "change" | "validation" | "sync" | "system";
  title: string;
  body: string;
  changeIds: string[];
  analysisId?: string;
  read: boolean;
  createdAt: string;
}

export interface HistoryEvent {
  id: string;
  repoId?: string;
  analysisId?: string;
  kind: string;
  actor: string;
  message: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface Approval {
  id: string;
  repoId: string;
  analysisId: string;
  changeIds: string[];
  status: "pending" | "approved" | "rejected";
  patchPreview?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentAnswer {
  answer: string;
  provider: string;
  providerKind: "local" | "remote" | "deterministic";
  grounded: boolean;
  evidence: { label: string; ref: string }[];
  latencyMs: number;
  actions: { id: string; label: string }[];
}

export interface ProviderStatus {
  id: string;
  kind: "local" | "remote" | "deterministic";
  connected: boolean;
  label: string;
  detail: string;
  latencyMs?: number;
}

export interface HealthScore {
  score: number;
  documented: number;
  totalEndpoints: number;
  outOfSync: number;
  breakingOpen: number;
  validation: "PASSED" | "FAILED" | "UNKNOWN";
  lastSyncAt?: string;
  breakdown: { label: string; value: string; ok: boolean }[];
}

export interface AppSettings {
  githubTokenSet: boolean;
  defaultBranch: string;
  webhookSecretSet: boolean;
  aiProviderPreference: "auto" | "local" | "remote" | "deterministic";
  localAiUrl: string;
  localAiModel: string;
  remoteAiUrl: string;
  remoteAiModel: string;
  remoteAiKeySet: boolean;
  autoSyncPolicy: "manual" | "auto-safe" | "auto-all";
  notificationsEnabled: boolean;
  demoMode: boolean;
  openapiStrictness: "strict" | "standard";
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** scrypt hash (absent for OAuth-only accounts). Never sent to the browser. */
  passwordHash?: string;
  githubId?: string;
  avatarUrl?: string;
  createdAt: string;
}

/** User shape safe to expose to the browser (no password hash). */
export interface SafeUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  providers: ("password" | "github")[];
  createdAt: string;
}

export interface AuthSession {
  /** sha256 hex of the opaque session token (the token itself is never stored). */
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface OAuthState {
  state: string;
  provider: string;
  next: string;
  createdAt: string;
  expiresAt: string;
}

export interface SentinelContext {
  repo?: Repository;
  analysis?: AnalysisRun | null;
  endpoints: EndpointContract[];
  changes: ApiChange[];
  openapi?: OpenApiVersion | null;
  validation?: ValidationResult | null;
  impact: ImpactFinding[];
  health?: HealthScore;
  history: HistoryEvent[];
}
