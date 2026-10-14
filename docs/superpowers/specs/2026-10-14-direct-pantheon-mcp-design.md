# Direct PANTHEON MCP App

Status: design prepared for BIG review; implementation not started.

## Outcome
Connect ChatGPT directly to the existing PANTHEON WorkHub as an App, then add the verified App ID to the existing Go plugin. Keep GO Brain as the memory App. No duplicate WorkHub, Factory, database or AI principal.

## Current source
Base: Pantheon-WorkHub main 324d7411ee14f05438da0792eb5cef9e5f9636cc. Existing production worker exposes WorkHub/Factory/Observatory HTTP routes and an internal OwnerBridge. It does not implement a public MCP transport. Go-Together worker/mcp-oauth.mjs provides the reference OAuth flow; its Brain-specific scope and presentation must not be copied unchanged.

## Architecture
Add a production MCP router at /mcp to the existing Worker. Preserve the current HTTP handler for other paths and preserve OwnerBridge exports. Implement authenticated JSON-RPC initialize, ping, tools/list and tools/call using Streamable HTTP with JSON responses and explicit protocol negotiation. Reject unsupported methods and invalid arguments without executing actions.

The direct router reuses ownerBridgeCall and the existing WorkHub handler for bounded operations. It never routes through GO Brain. Existing WORKHUB_TOKEN stays server-side and existing Factory/Observatory bindings remain intact.

## Authentication
Adapt Go's OAuth authorization-code flow with S256 PKCE, approved ChatGPT client metadata/callbacks, exact redirect matching, resource/audience and issuer checks, code single use, rotating refresh tokens with replay revocation, and owner attempt throttling. Use PANTHEON-specific issuer, pantheon-owner scope and signing secret; do not accept Brain tokens. BIG is the owner principal; do not create separate GO/LIGHT owner accounts. Use additive OAuth ledger tables in the existing D1 database. No credentials in source, plugin archives, Brain or logs. Owner completes login/consent in the supported connection UI.

## Tools
Expose pantheon_health, pantheon_tasks, pantheon_command and pantheon_factory with the existing contracts. create_task and queue_factory only queue; dispatch/reconcile require an existing validated task_id and explicit approved:true. Human authorization remains required. Add no arbitrary shell, deploy or generic proxy tool.

Observatory snapshot reading is outside this change; preserve its existing routes. Existing Observatory availability must not be represented as a new MCP capability.

## Delivery
Implement and test on feature/direct-pantheon-mcp. Verify current deployed configuration before deployment; preserve all existing bindings, secrets, D1 identity and data. Record previous deployment for rollback. Apply only additive ledger schema. Publish on the existing Worker after checks. Register the direct endpoint through ChatGPT's supported App connection UI; this session's Plugin Creator tools cannot register an external App. Once the App ID is returned, overlay Go's .app.json and synchronized manifest versions while preserving the Brain App, prompts, skills and audience.

## Verification
Run protocol, authorization, PKCE, audience/scope, replay, rate-limit, schema and invalid-argument tests. Run existing WorkHub, OwnerBridge and Observatory tests. Verify public OAuth metadata and anonymous /mcp rejection on the deployed endpoint. Complete actual ChatGPT initialize/tools-list and read-only health/tasks calls. For a user-authorized sample task, correlate returned task_id with exact readback; never dispatch Factory just to test authentication. Verify Go App binding by package readback, then test tool availability in the intended host.

## Completion criteria
BUILT means source and package changes exist. TESTED means observed checks pass. VERIFIED requires direct ChatGPT PANTHEON calls and Go dependency readback. Registration or login blockers must be reported as pending, not success. Roll back the Worker version if live checks regress; additive OAuth tables can remain unused without changing existing data.
