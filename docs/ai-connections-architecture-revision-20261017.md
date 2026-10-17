# PANTHEON AI Connections — Architecture Revision Proposal

**Status:** Proposal for review — documentation only; no runtime, permissions, secrets, or deployment changed.  
**Authority:** BIG owns access policy and approval boundaries.  
**Baseline:** `main` at `9cee6c2920c88acdfc98c78514108323731e5604` (2026-10-17 audit).  
**Scope:** Revise the PANTHEON master plan to make AI Connections provider-neutral, preserve existing systems, and establish evidence gates before implementation.

## Decision requested

Approve the direction and clarify the intended human audience before any access-control implementation:

- **Proposed default:** PANTHEON is shared among authenticated users whom BIG authorizes, with access granted per capability and task/resource scope. GO, LIGHT, HERMES, and other AI identities receive no automatic privilege.
- **Not enabled by this proposal:** anonymous/public access. “Anyone can use GO/PANTHEON” is interpreted as any authorized collaborator, not unauthenticated internet access. Public access needs a separate explicit decision and security design.
- **No execution authority granted:** this document does not authorize writing code, merge, deploy, rollback, or permission changes.

## Architecture principles

1. PANTHEON is the shared work hub and minimal source of task coordination—not the property or private workspace of one AI.
2. BIG is the highest authority for users, capability grants, and approval. An AI cannot grant or elevate its own access.
3. AI identity, knowledge source, runtime/model, and permission scope are distinct dimensions. Changing a provider or disabling one connection must not stop PANTHEON or other connections.
4. Each knowledge system remains authoritative for its own corpus: GO → GO Brain; LIGHT → LIGHT BOOK; HERMES/other → only the source explicitly configured and authorized for that connection.
5. Do not copy knowledge or conversation context between AI systems by default. PANTHEON may hold the minimum shared work record: task ID, owner, assignee/connection, approval, status, and evidence references.
6. Every result and action must identify its source/evidence. A connection is not “Connected” until its real authentication and intended route have been tested; reachability, model loading, inference, and authorization are separate states.
7. Keep existing interfaces and approval gates. No new database, agent, webhook, notification system, or repository unless a verified gap requires it and BIG approves the change.

## AI Connections page

Replace GO-only action/navigation language with **AI Connections**. Keep **AI Runtime** separate:

- **AI Connections** answers *which actor may work, using which knowledge source and capabilities?*
- **AI Runtime** answers *which model/endpoint is running, and did it respond?*

Each connection card/profile should show:

| Field | Required behavior |
|---|---|
| AI / provider name | GO, LIGHT, HERMES, or another adapter; identity does not imply authority |
| Connection type | Authenticated MCP, service adapter, or local OpenAI-compatible endpoint; name the actual transport |
| Knowledge source | Explicit source and link; GO Brain and LIGHT BOOK remain separate |
| Connection status | `UNKNOWN`, `AVAILABLE_UNTESTED`, `CONNECTED`, `DEGRADED`, `DISABLED`, or `UNAUTHORIZED`; only a successful end-to-end check earns `CONNECTED` |
| Capabilities | Per-capability allowlist and the last successful validation; never infer access from provider name |
| Permission scope | Authorized user/task/repository/resource scope, grantor (BIG), and approval requirement |
| Last activity / task history | Auditable task and evidence references; do not copy private prompts or knowledge into a shared history without authorization |
| Test connection | Non-destructive, provider-specific test; show endpoint reachability, auth, and knowledge/API readback separately |
| Disable / disconnect | Confirmation proportional to impact; isolate the selected connection without stopping others or the core |

Do not display an AI profile as connected merely because a Worker, MCP server, or model endpoint exists. A successful health response is not proof of task access, knowledge access, or permission to act.

## Connection profiles and permission model

Use a standard adapter contract around existing systems. Keep credentials in the existing secret/auth boundary; never store bearer tokens in the central task database or browser local storage. Profile metadata should reference a secret/auth handle, not contain secret values.

| Capability | Default rule |
|---|---|
| Read task / evidence | Only within the signed-in user's and connection's granted task scope |
| Read repository / review code | Per repository and task scope; read-only unless explicitly expanded |
| Create task | Per authorized user/connection scope |
| Write code | Explicit BIG-granted scope; branch and PR/MR only unless separately approved |
| Merge | BIG approval required; no AI self-approval |
| Deploy / rollback | BIG approval required for each applicable operation |
| Change permissions | BIG-only; never delegated to an AI connection |

Enforce the same policy at the PANTHEON server/adapter boundary, not only by hiding UI controls. Audit grant, revoke, connection test, task request, approval, execution, result, and readback with actor, scope, timestamp, outcome, and evidence reference. Where a legacy service cannot emit this audit record, show that gap rather than claiming end-to-end audit coverage.

## Connection-specific boundaries

### GO

- Identity: GO; knowledge source: GO Brain.
- GO Brain remains an independent knowledge system and is not a general PANTHEON status source.
- Existing GO-Together source documents owner-authenticated MCP access and a PANTHEON service binding. That is evidence of a bounded integration, not proof that arbitrary authorized collaborators can use every GO Brain operation through PANTHEON.
- Current PANTHEON OwnerBridge supports a small explicit operation set. Factory dispatch/reconcile requires `approved: true`; preserve and test that approval boundary.
- Do not make GO the default AI, owner, or privileged route in the revised UI.

### LIGHT

- Identity: LIGHT; knowledge source: LIGHT BOOK. Do not merge it with GO Brain.
- The discovered LIGHT-BOOK repository describes bookmark search/get as locator retrieval (Notion remains canonical) and `pantheon_health` as a read-only health bridge. Its PANTHEON service binding does not by itself grant task read, approval, or Factory dispatch.
- The connected Light bookmarks MCP exposes `search_bookmarks`, `get_bookmark`, and `save_bookmark`; it is not evidence of a general LIGHT model/provider API or a complete PANTHEON → LIGHT BOOK knowledge connector.
- Verify the exact PANTHEON-to-LIGHT knowledge/API route and actor scope before marking this profile connected. Reuse the existing source; do not create another bookmark/knowledge store.

### HERMES

- Identity: HERMES; runtime is configured independently under AI Runtime. Initial target: OlliteRT on Android, OpenAI-compatible `/v1`, intended model `HERMES Qwen2.5 1.5B WI8 CPU`.
- Keep endpoint reachability, `GET /v1/models`, model selection/loading, and `POST /v1/chat/completions` inference results separate. Record response time, HTTP status, and sanitized error detail.
- `localhost` refers to the device running the browser. Check CORS, HTTPS/mixed content, and network boundaries from that device; do not tunnel a local endpoint through Cloudflare by default.
- The current audit did not run an Android endpoint/inference test; do not mark HERMES ready or infer a root cause for the previously observed HTTP 500.

### Other AI providers

- Add through a versioned adapter contract and explicit profile configuration. No provider-specific assumption about GO Brain, LIGHT BOOK, or a shared knowledge corpus.
- Unknown capabilities stay unavailable until independently tested. Disconnecting one adapter must leave the core and other adapters functional.

## Verified capability audit (2026-10-17)

Statuses are scoped to the evidence below; they do not claim full production readiness.

| Area | Status | Evidence and limitation |
|---|---|---|
| PANTHEON repository baseline | **VERIFIED** | GitHub `Pantheon-WorkHub` main is `9cee6c2920c88acdfc98c78514108323731e5604`. Its README describes the Python HERMES V1.2 slice as local-only with no UI, network API, authentication provider, external connector, or model integration. This describes that prototype, not the separate live Worker. |
| PANTHEON live surface | **VERIFIED (surface only)** | `https://phatheon-workhub.pureekangraw.workers.dev/` responded with the WorkHub Preview UI and task/Factory controls during the audit. The label “Preview” is not proof that it is staging. No authorization bypass or write operation was attempted. |
| Production Worker configuration | **VERIFIED (configuration)** | Cloudflare readback showed the `phatheon-workhub` Worker, production entrypoint, D1 binding, and `FACTORY` service binding. A deployed version exists. The deploy metadata did not establish an exact Git commit SHA; deployed-source mapping is **UNKNOWN**. Do not equate a Worker Version UUID with a Git SHA. |
| PANTHEON → Factory boundary | **VERIFIED (code boundary)** | `cloudflare/production/owner-bridge.mjs` has a fixed operation allowlist; task intents are bounded; dispatch/reconcile require explicit `approved: true`. This is not evidence that the Factory machine runners are production-ready. |
| Factory source identity | **UNKNOWN / NEEDS RECONCILIATION** | GitLab `yggmetro-group1/factory-district` (project `87621354`) contains `imports/universal-workplace/` and configures static assets for `factory-district1`. GitHub `pureekangraw-ops/Factory-District` separately configures the `factory-district` Worker. These are distinct repositories/services; an exact commit-to-deployment mapping and the intended backend/source relationship have not been proven. |
| Universal Workplace vs PANTHEON | **VERIFIED (distinct surface)** | GitLab's `imports/universal-workplace/README.md` describes a local-first PWA using localStorage/manual handoff; its Wrangler config targets `factory-district1`. This is not the observed PANTHEON WorkHub UI and does not establish that PANTHEON lives in that GitLab subdirectory. |
| LIGHT BOOK source and binding | **VERIFIED (bounded)** | `pureekangraw-ops/LIGHT-BOOKMARK` source and Cloudflare readback show a `PANTHEON` service binding to `phatheon-workhub`; source describes the exposed operation as read-only `pantheon_health`. This is not a task/approval/dispatch connector. The current Light bookmarks MCP has locator tools, not a verified full LIGHT AI connection to PANTHEON. |
| GO Brain source and binding | **VERIFIED (owner-bounded)** | `pureekangraw-ops/Go-Together` documents owner-authenticated MCP and a PANTHEON binding. Current session has no GO Brain personal connection. Existing source/binding does not prove a shared user-facing GO profile or general PANTHEON task API. |
| GitHub/GitLab Review Queue in PANTHEON | **AVAILABLE BUT UNTESTED** | GitHub and GitLab connections are present to this assistant, but no authenticated PANTHEON-side PR/MR API route, authorization scope, or live queue readback was established. Do not show live counts or claim refresh works yet. |
| Cloudflare Infrastructure / Monitoring | **AVAILABLE BUT UNTESTED** | Worker and selected binding configuration was read. Full permission-verified access to versions, routes/domains, logs, metrics, D1/KV/R2, and Observatory correlation has not been proven. Do not substitute mock values or infer PR→commit→deploy relationships. |
| HERMES Android inference | **UNTESTED** | No local Android device endpoint was reachable/tested from this audit. CORS, HTTPS, model loading, inference, timing, and the previous HTTP 500 root cause remain **UNKNOWN**. |
| Shared multi-user authorization / complete audit trail | **UNTESTED** | Existing local CLI `--actor` is documented as an audit label, not authentication. A production-wide human identity, per-capability policy, and cross-service audit trail were not verified. |

### Sources checked

- [PANTHEON WorkHub README](https://github.com/pureekangraw-ops/Pantheon-WorkHub/blob/9cee6c2920c88acdfc98c78514108323731e5604/README.md)
- [PANTHEON production OwnerBridge](https://github.com/pureekangraw-ops/Pantheon-WorkHub/blob/9cee6c2920c88acdfc98c78514108323731e5604/cloudflare/production/owner-bridge.mjs)
- [PANTHEON live Worker surface](https://phatheon-workhub.pureekangraw.workers.dev/)
- [GitLab Factory-District project](https://gitlab.com/yggmetro-group1/factory-district) and [Universal Workplace README](https://gitlab.com/yggmetro-group1/factory-district/-/blob/main/imports/universal-workplace/README.md)
- [GitHub Factory-District repository](https://github.com/pureekangraw-ops/Factory-District)
- [LIGHT-BOOKMARK repository](https://github.com/pureekangraw-ops/LIGHT-BOOKMARK)
- [GO-Together repository](https://github.com/pureekangraw-ops/Go-Together)

## Proposed implementation order and gates

1. **Capability audit (remaining):** establish the exact production commit/source for each Worker; test permission-scoped read APIs; reconcile GitHub/GitLab Factory identity; document D1/KV/R2/Observatory access; identify the authoritative shared-user auth boundary. No mutation during audit.
2. **AI Connections foundation:** define adapter/profile contract, BIG-controlled grants, server-side policy checks, audit events, and isolated disable behavior. Add contract and permission tests before any live connector.
3. **Read-only dashboard and Review Queue:** integrate real PR/MR sources only after PANTHEON-side auth and scopes are proven. Provide explicit loading, empty, error, and unauthorized states; retain origin links and evidence.
4. **Infrastructure/Monitoring:** enable each read-only capability only after its Cloudflare permission and data source are verified. Correlate deployments to commits only with explicit evidence.
5. **AI Runtime:** test the local Android endpoint from the target device; report reachability/model/inference independently. No public tunnel.
6. **Factory actions:** retain the OwnerBridge allowlist and BIG approval boundary. Do not expose write/dispatch/merge/deploy/rollback or permission-changing actions until separately authorized and tested.

Before production use, require: adapter contract tests; per-capability allow/deny tests; cross-knowledge isolation tests; unauthorized/expired credential tests; disconnect/failure isolation tests; readback and audit assertions; responsive UI checks; then a BIG-reviewed PR and explicit deployment approval. No test or production readiness is claimed by this documentation-only proposal.

## Non-goals for this revision

- No code/UI rewrite, migration, schema change, Worker edit, secret change, OAuth grant, permission change, webhook, public tunnel, merge, or deployment.
- No claim that GO Brain and LIGHT BOOK are already connected to PANTHEON as task-capable AI profiles.
- No claim that Factory production runners, a live PR/MR queue, Cloudflare metrics/logs, or HERMES inference are verified.
- No new source of truth or parallel knowledge database.
