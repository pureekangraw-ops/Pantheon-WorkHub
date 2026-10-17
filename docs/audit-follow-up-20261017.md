# Capability Audit — evidence follow-up (2026-10-17)

Scope: read-only repository/service inspection and local tests. No merge, deploy, rollback, permission change, or production write was performed. This supplements [PR #12](https://github.com/pureekangraw-ops/Pantheon-WorkHub/pull/12).

## Verified

### PANTHEON PR #12

- PR #12 is open and marked draft. Before this follow-up, it changed one documentation file only (139 additions); this follow-up adds a second documentation file. No application code was changed. Head before this audit update: `9391fc1d532bb55a6774eb0366542271e7bb4fb2`; base `main`: `9cee6c2920c88acdfc98c78514108323731e5604`.
- The earlier head's Cloudflare Workers Builds check failed on 2026-10-17, but its available result did not include build logs, so the cause is **unknown**. After this documentation-only follow-up, a new check started at `2026-10-17T06:25:16Z` and was still **in progress** at last read; it is not a passing result. No production deployment was performed as part of this audit. [PR #12 checks](https://github.com/pureekangraw-ops/Pantheon-WorkHub/pull/12/checks)

### Factory repository and deployment mapping

- GitHub `pureekangraw-ops/Factory-District` at `6f1aaa10b1e34be8b95d54dda9ae5362424aad60` configures the Worker name `factory-district`. A live, read-only `GET /health` returned both `sourceSha` and `runtimeSha` as that exact commit. This verifies the current `factory-district` runtime-to-commit mapping; it does **not** make the Worker version UUID a Git SHA. [Source commit](https://github.com/pureekangraw-ops/Factory-District/commit/6f1aaa10b1e34be8b95d54dda9ae5362424aad60) · [Runtime health readback](https://factory-district.pureekangraw.workers.dev/health)
- Runtime response: overall service `READY`; `LOGIC` `READY`; `CODE` and `VISUAL` `UNKNOWN` with `MACHINE_NOT_REGISTERED`. Service readiness is not evidence that all production machinery is operational.
- GitLab `yggmetro-group1/factory-district` is a distinct project containing the Universal Workplace PWA at `imports/universal-workplace/`; its Wrangler configuration names `factory-district1` and serves that directory. GitLab main commit `aaf7855cf53b7a672a1cb5d93ac0f6d811a2f454` was followed about 32 seconds later by the Cloudflare `factory-district1` deployment record. This is a **probable mapping, not exact SHA verification**: the Worker metadata did not expose a source SHA. Its pipeline (`2957656789`) reports success but `jobs: []`, so that status is not test evidence. [GitLab commit](https://gitlab.com/yggmetro-group1/factory-district/-/commit/aaf7855cf53b7a672a1cb5d93ac0f6d811a2f454) · [Pipeline](https://gitlab.com/yggmetro-group1/factory-district/-/pipelines/2957656789)

### LIGHT BOOK API contract

- Inspected `LIGHT-BOOKMARK` main at `dd11118c29a99e32d7f0aea581df7533b944d3da`. Its source defines authenticated `POST /mcp` using `LIGHT_BOOKMARK_TOKEN`, and a read-only `pantheon_health` tool backed by a `PANTHEON` service binding that requests `/health`; it is not a task-execution API. [Source commit](https://github.com/pureekangraw-ops/LIGHT-BOOKMARK/commit/dd11118c29a99e32d7f0aea581df7533b944d3da)
- The connected Light Bookmarks MCP currently exposes bookmark search/get/save tools; the PANTHEON health route was not verified through that live connection. Local tests validate the source contract with mocks, not a live service-binding connection.

### HERMES local interface

- GitLab main source implements a loopback-only local endpoint: normalized base URL ends in `/v1`, then the UI requests `/models` and `/chat/completions` (equivalent to `/v1/models` and `/v1/chat/completions`). The browser tests check loopback restrictions, omission of credentials/referrer, prompt-only submission, and surfaced API errors. [GitLab source commit](https://gitlab.com/yggmetro-group1/factory-district/-/commit/f382f8970f87346f8762ff30db64d41534d74f8f)
- Local static contract tests passed. No Android device or live HERMES endpoint was available; model loading, inference success, response timing, and the previously observed HTTP 500 root cause remain **unverified**.

## Local test evidence (no production calls)

| Repository/source | Command | Result | Scope |
|---|---|---:|---|
| Pantheon-WorkHub `9cee6c2920c88acdfc98c78514108323731e5604` | `python -m unittest discover -s tests -v` | 5 passed | Local unit tests |
| Factory-District `6f1aaa10b1e34be8b95d54dda9ae5362424aad60` | `npm test` | 94 passed | In-process unit/contract/integration tests using local Worker/storage adapters and mocks |
| Factory-District same commit | `npm run check` | passed | JavaScript syntax checks |
| LIGHT-BOOKMARK `dd11118c29a99e32d7f0aea581df7533b944d3da` | `npm test` | 8 passed | Local tests with mocked service binding/in-memory D1 |
| GitLab Universal Workplace HERMES test at main | `node --test imports/universal-workplace/tests/hermes-local.test.mjs` | 5 passed | Static/browser contract checks; no device inference |

These are local test results, not end-to-end integration proof across live GitHub, GitLab, Cloudflare, PANTHEON, LIGHT BOOK, or an Android runtime. No live-mutating integration test was run.

## Still unknown / blocked

- Exact deployed source SHA for GitLab `factory-district1`; only config and timing correlate it with the GitLab project.
- Live LIGHT BOOK → PANTHEON service-binding health response.
- HERMES inference on Android and root cause of the earlier HTTP 500.
- End-to-end integration across real services and credentials.
- Root cause for the failed earlier PR #12 Cloudflare check; logs were unavailable, and the refreshed check is still in progress.
- The initial GitHub/GitLab permission findings were supplied by BIG as preliminary baseline and were not independently re-audited here.

## Status

**RED for deployment readiness.** The Factory GitHub runtime has an exact commit readback and the local test suites pass, but the items above remain unverified. Keep PR #12 unmerged; no deployment or permission change is authorized by this audit.