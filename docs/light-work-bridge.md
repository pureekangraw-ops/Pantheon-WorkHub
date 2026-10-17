# LIGHT work-access bridge

This optional Worker entrypoint allows Notion AI via the existing LIGHT BOOKMARK MCP Worker to
prepare tasks in the **same** PANTHEON WorkHub used by GO. It does not create another WorkHub,
share the GO Brain bearer, or grant full OwnerBridge access.

## Entry point and scope

Cloudflare Worker entrypoint: `LightBridge`, RPC method `lightCall`.

| Operation | Gate | Side effect |
|---|---|---|
| `list_tasks`, `show_task` | `LIGHT_BRIDGE_ENABLED=true` | Read-only |
| `factory_health`, `factory_job` | `LIGHT_BRIDGE_ENABLED=true` | Read-only |
| `create_task` | Both flags true | Creates queued task; no execution |
| `queue_factory` | Both flags true | Creates queued LOGIC trainee job; no dispatch |

Flags must be configured **on PANTHEON**:
- `LIGHT_BRIDGE_ENABLED=true` permits read-only LIGHT entrypoint requests.
- `LIGHT_BRIDGE_CREATE_ENABLED=true` additionally permits LIGHT to create and queue tasks.

Without these flags the entrypoint **fails closed**.
Requests accepted by this entrypoint contain a fixed `[LIGHT-BOOKMARK]` task-text prefix.
This distinguishes task origin in stored request text, but is **not** a cryptographically
verified actor field in the task event schema. Actor-origin audit enhancements remain
a future change; do not treat the prefix as identity proof.

This entrypoint has no methods for Factory dispatch/reconciliation, code writes,
merges, deploys, rollbacks, service configuration, or permission changes.
Passing `approved:true` is rejected before work execution.

PANTHEON itself retains its `WORKHUB_TOKEN`; LIGHT does not receive it.
The **LIGHT** Worker must bind `PANTHEON_LIGHT` to `phatheon-workhub`
with `entrypoint="LightBridge"`; never bind its `OwnerBridge` entrypoint.

## Review, tests and rollout

Run `node --test cloudflare/production/test/light-bridge.test.mjs`.
Review the scoped flag changes and task-provenance gap, and verify with a
synthetic task in a staging deployment before enabling production.
Changing the source code, opening a PR, or passing tests does not activate
the bridge in an existing production Worker.
