# Direct PANTHEON MCP Implementation Plan

Execution: native, explicitly requested by BIG. Use executing-plans.
Goal: expose existing PANTHEON directly as an authenticated ChatGPT App.
Spec: ../specs/2026-10-14-direct-pantheon-mcp-design.md
Architecture: adapt existing Go OAuth, isolate issuer/scope/ledger; bounded MCP tools call existing OwnerBridge.
Tech: Cloudflare Workers, D1, JavaScript, node:test.
Constraints: existing Worker/DB/Factory/Observatory retained; no secret output; no new owner principals.
Review focus: malformed JSON, oversized bodies, unknown fields, wrong OAuth resource, unsupported protocol versions.

## Task 1 — Direct MCP/OAuth
Files: production/mcp-router.mjs, mcp-oauth.mjs, oauth-ledger.mjs, direct-entrypoint.mjs; tests/direct-mcp.test.mjs; migrations/0001_pantheon_oauth.sql.
Interface: handleMcp(request,env,ctx) returns Response or null; direct entrypoint delegates null to existing workhub.
- [ ] Write tests for anonymous denial, metadata, OAuth login/PKCE/replay, catalog, real task queue/readback, invalid arguments and method negotiation.
- [ ] Run tests RED.
- [ ] Adapt Go OAuth with pantheon-owner, owner BIG and distinct issuer/key; implement bounded router.
- [ ] Run new and existing Node/Python suites GREEN.

## Task 2 — Release and connect
- [ ] Inspect live version, bindings and main module; reconcile live source differences.
- [ ] Add OAuth ledger tables and isolated signing secret; use existing owner token only for private owner login.
- [ ] Upload all modules with explicit binding inheritance; record rollback version.
- [ ] Verify deployment, public discovery and anonymous denial.
- [ ] Register App in supported host UI; owner enters credentials privately.
- [ ] Add verified App ID to existing Go package, preserve Brain and skills; read back.

Host registration pending if supported UI unavailable; never substitute a fabricated App ID.
