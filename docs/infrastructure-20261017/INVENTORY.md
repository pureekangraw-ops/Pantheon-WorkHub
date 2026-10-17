# Dependency inventory — 2026-10-17

Read-only configuration, module hashes, resource metadata and adaptive usage are attached as JSON. No credential values or customer records were exported. No resource is classified UNUSED merely from absent traffic.

## phatheon-workhub — ACTIVE

| Binding | Type | Target / disposition |
|---|---|---|
| DB | d1 | 22b59dc3-e07c-4ae7-b5b1-2646d3e8a975 |
| FACTORY | service | factory-district |
| FACTORY_PANTHEON_SECRET | secret_text | preserve existing configuration; secret values not read |
| PANTHEON_OAUTH_SIGNING_KEY | secret_text | preserve existing configuration; secret values not read |
| WORKHUB_TOKEN | secret_text | preserve existing configuration; secret values not read |

## factory-district — ACTIVE

| Binding | Type | Target / disposition |
|---|---|---|
| CF_VERSION_METADATA | version_metadata | preserve existing configuration; secret values not read |
| CLOUDFARE_SECRET | secret_text | preserve existing configuration; secret values not read |
| CLOUDFLARE_ACCOUNT_ID | secret_text | preserve existing configuration; secret values not read |
| GITHUB_SECRET | secret_text | preserve existing configuration; secret values not read |
| METROPOLIS_FACTORY_RAIL_SECRET | secret_text | preserve existing configuration; secret values not read |
| PANTHEON_FACTORY_RAIL_SECRET | secret_text | preserve existing configuration; secret values not read |
| RECORD_STORE | r2_bucket | factory |

## go-together — ACTIVE

| Binding | Type | Target / disposition |
|---|---|---|
| ACCESS_AUD | plain_text | preserve existing configuration; secret values not read |
| ACCESS_TEAM_DOMAIN | plain_text | preserve existing configuration; secret values not read |
| ASSETS | assets | preserve existing configuration; secret values not read |
| BRAIN_AUTH_MODE | plain_text | preserve existing configuration; secret values not read |
| BRAIN_OAUTH_SIGNING_KEY | secret_text | preserve existing configuration; secret values not read |
| BRAIN_OWNER_PASSCODE | secret_text | preserve existing configuration; secret values not read |
| DB | d1 | b236c05f-e07f-498b-a9d5-ccefe8be5f22 |
| OWNER_EMAIL | plain_text | preserve existing configuration; secret values not read |
| PANTHEON | service | phatheon-workhub |
| PANTHEON_OWNER | service | phatheon-workhub |

## light-bookmark — ACTIVE

| Binding | Type | Target / disposition |
|---|---|---|
| BOOKMARKS | d1 | 28abed4a-081a-4927-a3ac-2ac31aca3177 |
| LIGHT_BOOKMARK_TOKEN | secret_text | preserve existing configuration; secret values not read |
| PANTHEON | service | phatheon-workhub |

## yggmetro-web — ACTIVE

| Binding | Type | Target / disposition |
|---|---|---|
| GO_HUB | service | go-hub |
| OPENAI_API_KEY | secret_text | preserve existing configuration; secret values not read |
| STRIP_PRODUCTION | secret_text | preserve existing configuration; secret values not read |
| STRIP_SECRET | secret_text | preserve existing configuration; secret values not read |

## go-hub — ACTIVE / LEGACY migration target

| Binding | Type | Target / disposition |
|---|---|---|
| ASSETS | assets | preserve existing configuration; secret values not read |
| BROWSER | browser | preserve existing configuration; secret values not read |
| BROWSER_POLICY | json | preserve existing configuration; secret values not read |
| CLOUDFLARE_ACCOUNT_ID | secret_text | preserve existing configuration; secret values not read |
| CLOUDFLARE_RUNTIME_API_TOKEN | secret_text | preserve existing configuration; secret values not read |
| COUNTER_HANDOFF_AGENT_URL | plain_text | preserve existing configuration; secret values not read |
| FACTORY_EYE_SESSIONS | durable_object_namespace | 1816cd3431b343e0a679645071115b65 |
| GITHUB_TOKEN | secret_text | preserve existing configuration; secret values not read |
| GO_HUB_BROADCAST_STATE | durable_object_namespace | 10aa2a62910c4558a9dc08003f21e0bd |
| GO_HUB_CARD_ACCESS_V2 | plain_text | preserve existing configuration; secret values not read |
| GO_HUB_CENTRE_OBJECTS | r2_bucket | hubcentre |
| GO_HUB_CENTRE_STATE | durable_object_namespace | 885a932240d24c79bda54c0ef38032e3 |
| GO_HUB_COUNTER_DISPATCH_STATE | durable_object_namespace | 2f8a94b9681c45b9a448a25db4be568f |
| GO_HUB_COUNTER_INBOX | durable_object_namespace | bb63383d28104d728820c9b6627d13b3 |
| GO_HUB_COUNTER_STATE | durable_object_namespace | dcbb914683b8460fa44ff86f07c03876 |
| GO_HUB_FACTORY_STATE | durable_object_namespace | a1874e7a33964cb7804b7e3332acb1ba |
| GO_HUB_GLOBAL_AUDIT | durable_object_namespace | 94020d8ad5114b25a73fdcccb828b009 |
| GO_HUB_MAINTENANCE_STATE | durable_object_namespace | 813a36c56ddf46d4b262408ef5c19be6 |
| GOHUB_MASTER_KEY | secret_text | preserve existing configuration; secret values not read |
| GOHUB_NOTION_CLIENT_SECRET | secret_text | preserve existing configuration; secret values not read |
| GO_HUB_NOTION_LIGHT_STATE | durable_object_namespace | 5d902fd236624787add0f7c48c0b86a0 |
| GOHUB_OFFICE_PASSCODE | secret_text | preserve existing configuration; secret values not read |
| GO_HUB_OFFICE_PASSKEY | durable_object_namespace | 34aef7e6eb4d46659f261a8ef405af27 |
| GO_HUB_OFFICE_RATE_LIMIT | durable_object_namespace | 6ed505250e1b4f66a10e8c0bc9640c64 |
| GOHUB_OFFICE_SESSION_KEY | secret_text | preserve existing configuration; secret values not read |
| GOHUB_OWNER_PASSCODE | secret_text | preserve existing configuration; secret values not read |
| GO_HUB_PIXIE_MONITOR_STATE | durable_object_namespace | d87f91397d744d48ad19a9ff3e593b8c |
| GOOGLE_ACCESS_TOKEN | secret_text | preserve existing configuration; secret values not read |
| GOOGLE_CLIENT_ID | secret_text | preserve existing configuration; secret values not read |
| GOOGLE_CLIENT_SECRET | secret_text | preserve existing configuration; secret values not read |
| GOOGLE_DRIVE_ROOT_FOLDER_ID | secret_text | preserve existing configuration; secret values not read |
| GOOGLE_REFRESH_TOKEN | secret_text | preserve existing configuration; secret values not read |
| HEPHAESTUS | durable_object_namespace | dd0787a48dc642e1affb685e8bf7e210 |
| LIGHT_BELL_PAGE_ID | plain_text | preserve existing configuration; secret values not read |
| LIGHTHOUSE_CONTROL_PORT_SESSIONS | durable_object_namespace | 1044959d62a74ec8b83282903a0fcc77 |
| linear-API | secret_text | preserve existing configuration; secret values not read |
| LINEAR_TEAM_KEY | plain_text | preserve existing configuration; secret values not read |
| MIRROR_REFRESH_AGENT_URL | plain_text | preserve existing configuration; secret values not read |
| NOTION_CATALOG_DATA_SOURCE_ID | secret_text | preserve existing configuration; secret values not read |
| NOTION_KNOWLEDGE_DATA_SOURCE_ID | secret_text | preserve existing configuration; secret values not read |
| NOTION_TOKEN | secret_text | preserve existing configuration; secret values not read |
| OFFICE_ASSETS | r2_bucket | ygg-office-assets |
| OLYMPUS_SERVICE | service | preserve existing configuration; secret values not read |

## go-local-memory-mcp — UNKNOWN external callers

| Binding | Type | Target / disposition |
|---|---|---|
| MEMORY | kv_namespace | 1c580291330645d481d28fde7c2966d9 |

## greenhouse-transport — ACTIVE with broken legacy binding

| Binding | Type | Target / disposition |
|---|---|---|
| METROPOLIS_GREENHOUSE_RAIL_SECRET | secret_text | preserve existing configuration; secret values not read |
| METROPOLIS_SERVICE | service | preserve existing configuration; secret values not read |
| PIXIE_DB | d1 | 0c9fda05-2b91-4b31-9f5f-25e8b7235251 |
| PIXIE_DELIVERY_QUEUE | queue | preserve existing configuration; secret values not read |

## observatory-web — ACTIVE independent evidence UI

| Binding | Type | Target / disposition |
|---|---|---|

## pantheon-workhub-staging — DUPLICATE staging / missing bindings

| Binding | Type | Target / disposition |
|---|---|---|

## ygph-metropolis — UNKNOWN legacy interpretation service

| Binding | Type | Target / disposition |
|---|---|---|
| ASSETS | assets | preserve existing configuration; secret values not read |
| INTERPRETER_PROVIDER_ENABLED | plain_text | preserve existing configuration; secret values not read |
| INTERPRET_RATE_LIMITER | ratelimit | 926082601 |
| OPENAI_API_KEY | secret_text | preserve existing configuration; secret values not read |

## Persistent Durable Objects

All namespaces are preserved. Only brief/work/event/budget records have replacement code; export, identity reconciliation, import and reverse migration have NOT been executed. Auth/passkey, Google/Notion, audit, monitor, rate-limit and browser capabilities need separate owners and retention decisions. Empty preview namespaces still require approval before deletion.

| Namespace | Objects | With data | Disposition |
|---|---:|---:|---|
| go-hub_HephaestusForeman | 1 | 1 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubFactoryState | 198 | 160 | PRESERVE; owner-approved migration/retention pending |
| go-hub_ObserverSessionRegistry | 1 | 0 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubCentreState | 492 | 461 | PRESERVE; owner-approved migration/retention pending |
| go-hub_LighthouseControlPortSessionRegistry | 1 | 1 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubGlobalAuditLog | 1 | 1 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubCounterState | 242 | 240 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubCounterDispatchState | 240 | 240 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubNotionLightState | 1 | 1 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubCounterInboxState | 3 | 3 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubMaintenanceState | 1 | 1 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubBroadcastState | 1 | 0 | PRESERVE; owner-approved migration/retention pending |
| go-hub_GoHubPixieMonitorState | 1 | 1 | PRESERVE; owner-approved migration/retention pending |
| go-hub_FactoryEyeSessionRegistry | 1 | 1 | PRESERVE; owner-approved migration/retention pending |
| go-hub_OfficeRateLimitState | 6 | 6 | PRESERVE; owner-approved migration/retention pending |
| go-hub_pixie-visual-full-spec-v1-living-scene_HandoffLedger | 0 | 0 | PRESERVE; owner-approved migration/retention pending |
| go-hub_OfficePasskeyState | 1 | 1 | PRESERVE; owner-approved migration/retention pending |
| go-hub_lab-retrieval-resolver-20261003_HandoffLedger | 0 | 0 | PRESERVE; owner-approved migration/retention pending |
| go-hub_pixie-arsenal-contract-v1_HandoffLedger | 0 | 0 | PRESERVE; owner-approved migration/retention pending |
| go-hub_fix-pixie-visual-crew-runtime-migration-20261003_HandoffLedger | 0 | 0 | PRESERVE; owner-approved migration/retention pending |

## External callers and storage gaps

GO Hub source includes GitHub, Notion, Linear, Google OAuth/Drive/Docs/Gmail, Browser Rendering, ChatGPT registration and legacy Olympus candidates. Source references are not proof of traffic. External OAuth registrations, webhooks, MCP clients, bookmarks and scheduled callers remain UNKNOWN until owner/provider inventories and logs are reconciled.

GO_HUB_CENTRE_OBJECTS points to missing R2 bucket `hubcentre` (API error 10006). Do not create an empty replacement and call data recovered. OFFICE_ASSETS is `ygg-office-assets`; Factory uses `factory`. Preserve `ygg-shop` and preview buckets. Greenhouse has the active */2-minute cron, PIXIE D1 and delivery/deadletter queues; its deleted METROPOLIS service target is RED. GO Hub OLYMPUS_SERVICE is also deleted. DO alarms operate independently of Worker cron.

GO memory KV is independent. Staging has no live bindings despite separate D1 resources. Observatory map assets contact OpenStreetMap/unpkg independently; no capture was made automatic.
