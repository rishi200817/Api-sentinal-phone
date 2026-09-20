# API Sentinel — iQOO Hackathon Edition

> **Your API changed. Your documentation shouldn't fall behind.**

API Sentinel is **API change intelligence + contract drift detection + breaking-change
analysis + AI engineering assistance + safe documentation synchronization**. It watches
backend source code, detects API contract changes, explains their impact, updates OpenAPI
safely, validates the result, publishes live docs — and keeps developers in the loop from
their **phone**.

```
Developer changes code → GitHub push/webhook → Sentinel detects change → source analysis
→ deterministic diff → breaking-risk → impact → AI explanation → OpenAPI patch
→ validation → live docs → phone notification → ask/approve from anywhere
```

**No faked functionality.** Every button performs its action, every number is computed
from backend state, and every capability the environment can't provide is labeled
honestly with a working fallback.

---

## Product overview

| Surface | Purpose |
|---|---|
| `/` | Live product home: repo state, health, top change, Sentinel recommendation |
| `/dashboard/*` | Deep desktop analysis: overview, repos, changes, endpoints, impact, agent, docs, activity, phone console, settings |
| `/mobile/*` | Phone-first: home, changes, voice Ask, live docs, approvals, camera scan |
| `/docs/swagger`, `/docs/redoc` | Live documentation rendered from the actual published spec |
| `/demo` | Guided 3–5 minute demo script that executes the real pipeline |

## Architecture

```
src/
  app/                    Next.js App Router: pages + API routes
    api/                  health, repos, analyses, changes, endpoints, openapi,
                          sync, approvals, impact, activity, notifications,
                          agent, webhooks/github, settings, demo, overview, metrics
    dashboard/            desktop deep-analysis UI
    mobile/               phone-first UI (bottom nav, voice, camera, alerts)
    docs/                 Swagger UI (bundled) + Redoc (CDN w/ offline fallback)
    demo/                 guided demo script
  components/             shared UI (badges, timeline, chat, repo picker, nav)
  db/store.ts             embedded persistent store (typed, atomic writes, indexes)
  lib/sentinel/
    types.ts              shared typed domain objects (the contract of the engine)
    pipeline.ts           the orchestrator: fetch→…→publish→notify→audit
    parsers/              framework detect, express, fastapi, spring, incremental cache
    diff/                 deterministic contract diff engine
    impact/               breaking-risk classifier + consumer/impact analyzer
    openapi/              reader (yaml/json), minimal-patch writer, validator
    git/                  GitHub client, tarball extractor, webhook verification
    agent/                provider abstraction + grounded orchestrator
    local-ai/             open-source runtime transport (Ollama-compatible)
    notifications/        in-app notification center (server side)
    demo/                 deterministic fixture repositories (data only)
    security/             SSRF guards, signature verification, redaction,
                          prompt-injection armor
tests/                    vitest suite (parsers, diff, risk, openapi, webhook,
                          impact, incremental, full pipeline e2e)
```

The **deterministic engine is the source of truth** and is independently testable.
AI explains; it never decides facts.

## How detection works

1. **Change detection** — GitHub `push` webhook (HMAC-verified, deduplicated) or manual
   "Analyze now". The compare API identifies changed files; first scans and rescans use
   a full tarball snapshot.
2. **Safe scan** — `node_modules`, `.git`, `dist`, lockfiles, binaries, huge files are
   skipped with reasons. Tests/docs/examples are searched as *consumers only*, never
   treated as the contract. Repository code is **never executed** — static analysis only.
3. **Framework detection** — scored signals with explicit confidence; below threshold
   the UI shows `Unknown` with the reason.
4. **Route extraction** — per-framework parsers resolve mounts/prefixes, parameters,
   request/response shapes, and auth evidence into the normalized contract.
5. **Incremental parse** — per-file SHA cache: only changed files are re-scanned;
   assembly re-runs over merged models so cross-file mounts stay exact.
6. **Diff + risk** — field-level diffing, deterministic severity (`LOW→CRITICAL`) and
   verdicts (`non-breaking → likely-breaking`), never more certain than the evidence.
7. **Impact** — consumer search with tiers: verified reference, likely consumer,
   reference found, potentially affected.
8. **AI** — grounded summary/explanation from the analysis context.
9. **OpenAPI** — minimal patch of the repo's own spec (or last published, or fresh
   skeleton), dual-engine validation, publish **only if valid**.
10. **Notify + audit** — in-app notifications, optional browser alerts, full history.

## Supported frameworks

- **Express / Node.js** — `app`/`router` verbs, nested routers, mount prefixes,
  `:params`, middleware auth hints, `req.body`/`req.query`/`res.status` inference.
- **FastAPI / Python** — decorators, `APIRouter` + `include_router` prefixes,
  `Query`/`Body`/`Path`, Pydantic models (incl. inheritance), `response_model`,
  status codes, `Depends` auth.
- **Spring Boot / Java** — `@RestController`, class/method mappings,
  `@PathVariable`/`@RequestParam`/`@RequestBody`, DTOs (class + record),
  `ResponseEntity`, `@PreAuthorize`/`@Secured`/`@RolesAllowed`.

Unsupported constructs are **marked explicitly** (e.g. multi-path mappings,
reactive return types) instead of producing wrong routes.

## API contract model

Every endpoint normalizes to `EndpointContract`: `method`, `path` (OpenAPI style),
`controller`, `sourceFile`, `sourceLine`, `pathParams`, `queryParams`, `requestBody`,
`responses`, `auth`, `summary`, `description`, `confidence` — each fact carrying its
`origin` (`detected` vs `inferred`).

## Diff engine

Change types: `NEW_ENDPOINT`, `DELETED_ENDPOINT`, `MODIFIED_ENDPOINT`,
`REQUEST_SCHEMA_CHANGED`, `RESPONSE_SCHEMA_CHANGED`, `PARAMETER_CHANGED`,
`METHOD_CHANGED`, `AUTH_CHANGED`, `NO_CHANGE` — with granular field events
(added/removed/type-changed/required-changed/param/status/auth/method).

## Breaking-change logic

Deterministic matrix (see `src/lib/sentinel/impact/risk.ts`): new endpoints and
optional additions are low risk; required additions are potentially breaking;
removals, type changes, method changes, deletions, and auth removal escalate to
high/critical. Auth removal always demands mandatory review.

## AI architecture

Provider abstraction with honest status:

1. **Local / open-source** (`LocalAIProvider`) — Ollama-compatible runtime.
2. **Remote dev fallback** (`RemoteAIProvider`) — OpenAI-compatible endpoint.
3. **Deterministic grounded fallback** — template answers computed from real data.

Priority is local → remote → deterministic (configurable). The UI always shows which
provider answered. Repository content is wrapped as **untrusted data**; system
instructions outrank it (prompt-injection defense), and secrets are never revealed.

## Local AI architecture

`src/lib/local-ai/transport.ts` speaks the Ollama chat API (`/api/tags` probe,
`/api/chat` completion, `images[]` for vision models). No fictional NPU SDKs: if the
runtime is unreachable the UI shows **LOCAL MODEL: NOT CONNECTED** and falls back
deterministically. Point `SENTINEL_LOCAL_AI_URL` at any Ollama-compatible server
(phone, laptop bridge, or event-provided runtime) to go live.

## GitHub webhook setup

1. Deploy Sentinel and set a webhook secret (Settings → GitHub, or
   `GITHUB_WEBHOOK_SECRET`).
2. In GitHub → repository → Settings → Webhooks → Add webhook:
   - Payload URL: `https://<your-host>/api/webhooks/github`
   - Content type: `application/json`
   - Secret: the same value
   - Events: **Just the push event**
3. Push to the monitored branch. Deliveries appear in
   Repositories → webhook table with accept/reject/duplicate state.

Manual **Analyze now** and full rescans remain available alongside monitoring.

## OpenAPI generation

The writer **patches minimally**: it upserts only synced operations and preserves
`info`, `servers`, `tags`, security schemes, examples, and unrelated paths. Deletions
require explicit approval (`allowDelete`). Selective sync (`Sync this change`,
`Sync selected`) and policy-driven auto-sync (`manual` / `auto-safe` / `auto-all`)
are all supported.

## Validation

Two engines, both must pass:

1. Custom Sentinel structural checks (versions, required blocks, path-param
   consistency, duplicates, strict-mode summaries).
2. `@apidevtools/swagger-parser` (standards-compliant dereference + schema check).

Invalid specs are **rejected with exact errors** — nothing invalid is ever published.

## Swagger / Redoc

- `/docs/swagger?repo=<id>` — Swagger UI **bundled locally**, fed the live spec.
- `/docs/redoc?repo=<id>` — Redoc via CDN with an automatic **offline fallback**
  explorer rendering the same live data if the CDN is unreachable.

## Mobile experience

`/mobile` is a first-class surface: repository status, health ring, breaking-alert
hero, changes feed with one-tap sync, grounded Ask with **voice input**
(Web Speech API, graceful fallback) and read-aloud answers, live docs, approvals,
and notification opt-in. Bottom navigation: Home · Changes · Ask · Docs · More.

## Phone workflow

- **Laptop**: connect GitHub, deep analysis, OpenAPI review, Swagger, publishing.
- **Phone**: monitor, receive alerts, ask by voice, review diffs, approve/reject.
- State is server-side: an approval on the phone instantly reflects on the laptop.

## Office Kit workflow

Sentinel is web-native: open the same deployment on laptop + phone and both stay in
sync. The Phone Console (`/dashboard/phone`) provides share/copy handoff for live
URLs. **No proprietary pairing is faked** — pairing status reads *not detected*
until a real bridge exists; if the event provides an Office Kit bridge, it carries
these same live URLs.

## Camera ("Scan API")

`/mobile/scan` captures a real photo (camera or upload), downscales it on-device,
and sends it to the agent **only when you tap Analyze**. With a vision-capable
local model (e.g. LLaVA via Ollama) or remote vision provider configured, Sentinel
transcribes visible API content and cross-checks it against the live spec.
Otherwise it says plainly that vision is unavailable — never a fake analysis.

## Environment variables

| Variable | Purpose |
|---|---|
| `SENTINEL_DATA_DIR` | Persistent store directory (default `./data`) |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub API token (private repos, rate limits) |
| `GITHUB_WEBHOOK_SECRET` | Webhook HMAC secret (all deliveries rejected without it) |
| `SENTINEL_LOCAL_AI_URL` | Local runtime base URL (default `http://localhost:11434`) |
| `SENTINEL_LOCAL_AI_MODEL` | Local model name (default `llama3.1`) |
| `SENTINEL_REMOTE_AI_URL` | Remote OpenAI-compatible base URL (optional) |
| `SENTINEL_REMOTE_AI_KEY` | Remote API key (optional) |
| `SENTINEL_REMOTE_AI_MODEL` | Remote model (default `gpt-4o-mini`) |
| `SENTINEL_AI_PROVIDER` | `auto`/`local`/`remote`/`deterministic` |

Settings UI mirrors these; secrets are write-only (set/not-set shown, values never
returned).

## Local setup

```bash
npm install
npm run dev        # http://localhost:3000
npm run seed       # optional: register demos + run baselines
```

Open `/demo` for the guided script, `/mobile` for the phone experience.

## Database setup

No external database required. The embedded store (`SENTINEL_DATA_DIR/sentinel.json`)
persists repositories, runs, changes, endpoints, OpenAPI versions, impact, webhooks,
notifications, history, approvals, and snapshots with atomic writes. For Postgres,
implement the `store.ts` interface — engine and routes are storage-agnostic.

## Deployment

- **Docker**: `docker build -t sentinel . && docker run -p 3000:3000 sentinel`
  (standalone output, persistent `/app/data`, healthcheck on `/api/health`).
- **Render**: `render.yaml` included (web service + 1GB disk, health check,
  secret env vars). No destructive migrations run on startup.

## Testing

```bash
npm run typecheck
npm run lint
npm test            # 44 tests: parsers, diff, risk, openapi, webhook,
                    # impact, incremental, full pipeline e2e
npm run build
```

The e2e test runs the demo FastAPI repo v1→v2 through the real pipeline and asserts:
2 changes, HIGH-risk `deviceId` request change, new `DELETE /api/users/{id}`,
impact findings, grounded AI summary, validated patch, publish, Swagger-ready spec,
history, notification, and a correct "What changed?" answer.

## Demo steps (3–5 min)

1. `/demo` → **Run the demo** (setup → baseline → push → alert → ask → patch → approve → verify).
2. Keep `/mobile` open on the phone — the alert lands live.
3. Ask by voice: *"Why is login breaking?"*
4. Review the diff + impact, approve the sync.
5. Open Swagger — synchronized docs. Ask: *"Is the API synchronized?"*

Fallbacks: demos run fully offline (fixtures + deterministic AI); with network,
connect any real GitHub repo; with a local model running, answers upgrade
transparently.

## Known limitations

- Static analysis only: dynamic route registration, decorators-as-variables, and
  heavily metaprogrammed routing may be missed (reported as unknown, never guessed).
- Webhook monitoring tracks the default branch only.
- Browser voice/notifications depend on device support (graceful fallback everywhere).
- Embedded store suits hackathon scale; swap in Postgres for multi-instance deploys.
- 512KB/file, 1200 analyzed files/repo, 120MB archive caps (all reported, never silent).

## Security

- Webhook HMAC-SHA256 verification (timing-safe), fail-closed without a secret.
- Outbound allowlist (GitHub + configured AI hosts only) — SSRF guard.
- Archive path-traversal rejection, size/file-count caps, no symlink following.
- No repository code execution, ever. Secrets redacted from logs; secret scanning
  on detection only.
- Repository content treated as untrusted data in every AI prompt.
- Input length limits, JSON size caps, ID validation on all routes.
