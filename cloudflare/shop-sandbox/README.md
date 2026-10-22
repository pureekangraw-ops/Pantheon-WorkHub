# Isolated Shop Sandbox platform bridge

`ShopSandboxBridge.shop_orders_read({cursor?})` is a named Cloudflare Worker RPC
entrypoint. A configured service binding is its authority. Public/default HTTP and
named HTTP fetch return 404. No caller-name header, shared admin token or individual
AI account grants access. Only `SHOP_COMMERCE_READ` targets
`yggmetro-shop-sandbox` / `ShopCommerceRead`; no DB, secret, Factory or request
mutation binding is present. The projection excludes PII, storage keys, owner
hashes and payment credentials. It accepts only test orders and truthful unknown
receipt evidence; a keyset cursor is pagination metadata, not an identity.

This isolated module does not change production OwnerBridge, LightBridge or either
platform caller. Current go-together/light-bookmark service bindings point at
production phatheon-workhub. An authenticated team entry route into this isolated
bridge still needs a separately approved narrow caller addition; deployment alone
must not be reported as team-access acceptance. Do not repoint existing bindings or
add public unauthenticated routes for testing. Do not copy platform credentials.

Use the adjacent explicit sandbox config for preparation. No migrations are
needed. Production release, caller changes and finance operations remain outside
this approval. Cloudflare documentation:
https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
