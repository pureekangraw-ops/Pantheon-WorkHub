# Capability-aware outcome routing — bounded draft

## Decision and observable behavior

Users may supply ordinary-language outcomes through the existing authenticated
`POST /v1/intent` with `{request, task_id?}`, or the paired GO `pantheon_request`
tool. This path reads existing task metadata or returns a plan/block. It does not
queue or execute writes. Explicit legacy intents remain backward compatible.
No arbitrary natural-language coverage is claimed. English phrases below and
four Thai aliases are deterministic; all other input is UNKNOWN.

| Request | Result |
| --- | --- |
| show my tasks / list tasks / แสดงรายการงาน | Existing owner-scoped task list |
| show this task / check this task status / ดูสถานะงาน | Read exact task_id; ask only if missing |
| what can you do? / ทำอะไรได้บ้าง | Shared intent contracts plus CODE/VISUAL/LOGIC gaps; connectivity NOT_CHECKED |
| save this request as a text artifact | Validated CREATE_TASK plan for D1 artifact containing the exact original request; explicit preparation still required |
| build a click-counter website / สร้างเว็บนับคลิก | UNSUPPORTED: website-to-edge-job adapter missing and PANTHEON CODE authority absent |
| render a static card | UNSUPPORTED: design adapter and PANTHEON VISUAL authority absent |
| place a LOGIC trainee | UNSUPPORTED in this natural-language path; existing explicit training workflow is unchanged |
| mixed commands, instructions to ignore policy, action IDs in prose | UNKNOWN; zero effects |

The existing parser's three contracts now share `intent-contract.mjs`; explicit
API and proposed actions use the same validator. This is not another Factory
runner registry. Factory still owns `createConfiguredMachinery`, adapter method
contracts, signed rail validation and Work Pass checks. PANTHEON does not infer
executable capabilities from health. Discovery reports source-declared limitations,
not observations about current provider availability.

## Source inventory and ownership

Inspected canonical main before implementation, with no AGENTS.md found in the
workspace repository trees. Baselines:

- PANTHEON `3085dc87c7bddaba64422b90b7193d086e43dc9e`
- Factory `c36934112824302cb33f1c4d1cc67ff202a00e01`
- GO `26bb165a86b963bbaa277c58dc63fa7e362e65f1`
- YGG storefront `cf53e4166da2f192150192860ab50ff3ab8f44aa`
- Metro browser `6aba0f5f7465af06e4202b8206614319ad1c69b1`

Canonical contracts take precedence over older prose. In particular Factory's
`docs/code-visual-runners.md` and `src/configured-machinery.mjs` declare bounded
CODE/VISUAL providers, while older GO shared rules mention LOGIC alone. The
PANTHEON credential remains restricted by Factory `src/rail-auth.mjs` to training
and the exact L1 exception. These are different facts, not contradictory evidence
that PANTHEON may execute arbitrary CODE.

| Owned surface | Existing source of truth / authority | Audit coverage and disposition |
| --- | --- | --- |
| PANTHEON intents / D1 task lifecycle | worker.js parseIntent, queue, runTask, inspect, recover; owner bearer | Implemented shared request contracts, bounded read/plan routing, hash/identity preservation. Existing writes and verification unchanged. |
| PANTHEON Factory queue/dispatch/readback | worker.js envelope, queueExistingFactoryJob, dispatchFactoryJob; l1-contract.mjs | Regression coverage retained; no new mapping/permission. Existing request-only queue remains explicitly LOGIC training. Exact L1 never rerun live. |
| Factory CODE | configured-machinery.mjs, code-contract.mjs, edge-providers.mjs; rail-auth.mjs | Source inspected, unchanged. Real bounded Worker-module patch runner, requiring input refs, source, patch and HTTP assertions plus EXECUTE:CODE/DEPLOY:CODE. No ordinary website authoring adapter. |
| Factory VISUAL | visual-contract.mjs, configured-machinery.mjs, edge-providers.mjs | Source/docs inspected, unchanged. Static-card HTML/PNG renderer, not arbitrary imagery or interactive website verification. |
| Factory LOGIC | logic-registry.mjs, dwarf-logic-trainee.mjs, rail-auth.mjs | Existing training capability only; never used as unsupported-outcome fallback. |
| GO MCP tools | worker/index.js tools registry, tool handlers, owner verification | Additive pantheon_request handler only; original text forwarded exactly. Existing task, Factory and Observatory paths remain separate. |
| GO Brain / provider metadata tools | same MCP registry and handlers; owner/auth/revision checks | Registry/dispatch inventory only. No new natural-language mutation routing or connector changes. |
| LIGHT bridge / Drive | light-bridge.mjs READ_TOOLS/WRITE_TOOLS/DRIVE_ARGS; enable flags, runDriveTool | Inspected existing namespaced allowlists; full existing bridge tests run. No outcome route exposed to LIGHT; no Drive calls. |
| YGG METRO storefront | src/index.js INTENTS/SCHEMA; src/request-workflow.js customer capability | Inspected current source. Model classification is customer intake, not OwnerBridge/Factory authority. No edits or customer data access. |
| Metro browser | Command.kt, CommandGuard.kt, BrowserCommandLedger/dispatcher | Source inventory: existing device/tab/capture/revision/epoch/TTL/authority checks. No edits, device commands or expanded browser authority. |
| Python WorkHub prototype | pantheon_workhub/tools.py and engine.py | Separate local artifact prototype; inspected, unchanged. Not a deployed runner or alternative authority source. |

This is an audit coverage report, not certification that every tool now has
natural-language routing or that existing out-of-scope paths have no defects.
Only PANTHEON and GO require patches; broadening other owners needs a separate
compatible adapter and its own evidence. External connectors are not modified.

## Reusable adapter policy and trust boundary

1. Preserve request bytes, original task_id and stored request hash. Follow-up
   routing text is separate from original_request. Existing records are never
   rewritten by this route. plan_id is a deterministic identity digest, not a
   durable authorization token or executable plan handle.
2. Treat proposal objects as untrusted. `validateProposal` rejects extra fields,
   illegal statuses and actions outside `parseIntent`; callers cannot supply a
   proposal, scope, approval, URL, credential, or tool name in the outcome payload.
   No model is invoked. Future adapters must use their owner's real registry,
   contract and permission verifier, not merely import this request table.
3. Authenticate before task lookup. Action/task identity mismatch and stored
   request-hash corruption fail before effects. Existing tasks cannot be relabelled
   or converted to a new action by a plan.
4. Read actions use existing D1 reads. Prepare actions stop at PLANNED. Dispatch
   remains a separate existing authority boundary; no interpretation conveys
   approval. These plans cannot be submitted as authority or auto-executed.
5. READ means task metadata observed. completed=false/verified=false refer to
   the requested outcome, even when the returned historical task says COMPLETED.
   Artifact verification requires the existing artifact/receipt readback path.
6. Duplicate read/plan requests make no writes and return the same plan identity.
   Failures never trigger fallback to another tool or Factory retry. Existing
   dispatch uncertainty/reconciliation remains unchanged. No new timeout or
   cancellation policy is claimed; tests cover thrown timeout/failure responses.

## Local evidence and CI

All fixtures use in-memory SQLite and synthetic identities. No live task lookup,
Factory dispatch, provider render, remote artifact write, deployment, or customer
data was used. The local chain is a real invocation of source handlers backed by
local mocks, not proof of a live website or deployed D1.

Commands (Node 24):

```
node --test --test-isolation=none cloudflare/staging/observatory.test.mjs cloudflare/tests/*.test.mjs cloudflare/production/test/*.test.mjs
GO_CHECKOUT=/path/to/Go-Together node --test cloudflare/tests/intent-chain.integration.mjs
```

Paired GO command: `node --test --test-isolation=none tests/*.test.mjs`.
Observed before publication: PANTHEON 55/55, GO 50/50, local chain 1/1.
Regression cases cover positive routes, unknown/injection text, ambiguity,
CODE/VISUAL/LOGIC unsupported reasons, unauthorized requests, unchanged original
identity, duplicate plans, strict contract mismatch, timeout/failure, and metadata
versus artifact verification. Existing tests cover actual local artifact/readback,
Factory receipts, duplicate queueing and reconciliation. Independent review found
and fixed enum coercion and proposal-field passthrough; final review and immutable
CI results are reported with the Draft PRs.

## Precise GO acceptance handoff — not executed here

Do not merge or deploy this draft. GO performs live tests only after owner approval
of the concrete patch and target environment. Receiver-first rollout if approved;
no new credentials, permissions, DNS, payment or schema changes are needed.

1. Confirm deployed PANTHEON and GO source SHAs equal the separately approved
   commits. Check actual tool discovery lists pantheon_request and its closed
   schema. Connected/health READY is not execution evidence.
2. Use a fresh synthetic test task, never the existing exact L1 task. Call
   pantheon_request with `show my tasks`, then `show this task` and that task_id.
   Record task_id, original_request hash and metadata-only evidence. Do not log
   tokens, real customer requests or sensitive task lists.
3. Repeat the same request; compare plan_id and unchanged task/action identity.
   Ask `show this task` without an ID: expect only TASK_ID_REQUIRED clarification.
4. Ask `build a click-counter website` with the same task_id: expect
   WEBSITE_TO_EDGE_JOB_ADAPTER_MISSING plus missing PANTHEON CODE authority.
   Confirm no new task, Factory job, LOGIC substitution or changed tool/action.
   VISUAL and LOGIC requests must report their specific natural-route blocks.
5. Ask `what can you do?`: CODE/VISUAL/LOGIC entries must not claim execution,
   connectivity is NOT_CHECKED. Read health separately if needed and retain the
   distinction between registered, connected, authorized, executed and verified.
6. Submit extra approved/scope/proposal fields, anonymous calls and injection-like
   mixed requests: expect refusal/UNKNOWN and zero mutations. No attempts to gain
   authority or alter the old L1 task are acceptance steps.
7. Exercise read failure/timeout on local mocks only; verify no automatic write or
   fallback. For any future execution adapter, require exact input contract,
   source/artifact identity and independent destination readback before VERIFIED.

Missing follow-on work is explicit: owner-approved website-to-edge-job adaptation,
compatible CODE authority and result verification for an interactive webpage;
VISUAL input adaptation; and additional deterministic grammars. This draft does
not ask GO to create those capabilities or execute real Factory jobs.

Paired caller Draft PR: https://github.com/pureekangraw-ops/Go-Together/pull/9
at `c6ea2ede236a6650a265836a1c49ce473c9cb8f9`. The existing PANTHEON CI workflow
pins that source for the local chain fixture. Final independent source review
reran 55 PANTHEON tests, 50 GO tests, and the one chain test successfully and found
no remaining must-fix findings within this bounded scope. Review is not approval
to merge, deploy, broaden authority, or claim generic website execution.
