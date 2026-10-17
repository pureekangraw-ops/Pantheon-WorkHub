# PANTHEON AI Connections — implementation follow-up

**Date:** 2026-10-17 (Asia/Bangkok)  
**Scope:** Evidence update for the initial AI Connections / AI Runtime UI slice on PR #12. This is not production authorization.

## Implemented safely

- Added Dashboard, Review Queue, AI Connections, and AI Runtime views to the existing PANTHEON WorkHub page.
- GO and LIGHT cards now distinguish repository-described API contracts from live PANTHEON connectivity. Both remain `SOURCE CONTRACT · LIVE UNKNOWN`.
- Review Queue stays disabled because no PANTHEON-side PR/MR API route and scoped credentials were verified.
- Local HERMES testing remains direct to loopback only; it does not route endpoint URLs, prompts, or responses through Cloudflare.
- Tests assert that profile status is not promoted to `CONNECTED` without a live test.

## Source contracts re-read

### GO / GO Brain

The Go-Together README at [commit `5832b09ae867a6039eb2e831915d755815c48e85`](https://github.com/pureekangraw-ops/Go-Together/blob/5832b09ae867a6039eb2e831915d755815c48e85/README.md) describes a separate GO Brain MCP OAuth boundary. Its fixed identity is BIG authorizing GO with `brain-owner` scope; listed memory tools include search, retrieve, list, save, edit, status, history, and summarize. This is GO Brain's own scope, not a PANTHEON task/approval grant or evidence that PANTHEON can call those tools.

### LIGHT / LIGHT BOOK

The LIGHT-BOOKMARK README and Worker source at [commit `dd11118c29a99e32d7f0aea581df7533b944d3da`](https://github.com/pureekangraw-ops/LIGHT-BOOKMARK/tree/dd11118c29a99e32d7f0aea581df7533b944d3da) describe authenticated Streamable HTTP MCP at `/mcp`, protected by `LIGHT_BOOKMARK_TOKEN`. `search_bookmarks` and `get_bookmark` retrieve Notion pointers; `save_bookmark` is an explicit pointer upsert; Notion remains canonical. The `PANTHEON` Service Binding is used only by `pantheon_health` to call PANTHEON `/health` and returns allowlisted health status. It does not grant task reads, approvals, or Factory dispatch. The current session's Light bookmarks tools do not prove the separate Worker's current deployment, secret, D1 binding, or PANTHEON health readback.

## Shared-user authorization boundary — still blocked

The PANTHEON Worker source still checks a single configured `WORKHUB_TOKEN` for protected HTTP routes. It does not identify individual human collaborators or enforce per-user/per-task grants; task events use the `cloud-owner` actor label. Therefore the new “shared hub” UI does not make access multi-user, and must not be described as “anyone can use it” in the public/anonymous sense.

Implementing collaborator login and BIG-controlled grants requires an explicit identity source and authorization boundary. No OAuth provider, user directory, invite flow, or permission store has been verified for PANTHEON. Do not reuse GO Brain's owner OAuth or LIGHT BOOK's bearer token as PANTHEON user identity, and do not change Cloudflare Access, secrets, or production bindings as a substitute.

## Status

- UI and local safety tests: **PASS**.
- GO Brain and LIGHT BOOK repository contracts: **SOURCE-VERIFIED**.
- GO/LIGHT live integration to PANTHEON, human multi-user auth, per-capability enforcement, and cross-service audit trail: **UNKNOWN / NOT VERIFIED**.
- No merge, deployment, OAuth grant, secret change, or permission change was performed.
