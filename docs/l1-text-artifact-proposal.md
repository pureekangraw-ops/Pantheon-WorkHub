# Approved exact-task L1 implementation

The owner approved the bounded capability on 2026-10-22. The paired Factory candidate implements CREATE_L1_TEXT_ARTIFACT / EXECUTE:TEXT_ARTIFACT:L1 exclusively for task_d6c9e93a42fd4f339bb47d941428dd08 and request hash de0038fe8be999fe6a1c725156cd9684ac4887127ef783a659148ccdf36d0b24. There is no generic execution or LOGIC trainee substitution.

This worker statically binds that exact task/hash to the new Factory intent, preserving the existing task/action and request. No schema migration, credentials, account permissions, Drive integration or new task creation is required. Local run/recover/retry cannot execute the reserved task. D1 atomically claims dispatch; Factory atomically stores its artifact and receipt in one immutable existing-private-R2 record. Only verified authenticated readback of actual content can complete the task. Owner GET requires fresh Factory readback; a stored receipt alone is insufficient.

Failure before the Factory record exists leaves NEEDS_RECONCILIATION. Reconcile is read-only; a subsequent explicitly approved dispatch can resume after authenticated RECEIPT_NOT_FOUND. A late original request and the retry still share one conditional-create key, so only one artifact can persist. Successful retries reuse the winning timestamp and bytes. No evidence is deleted or overwritten.

Release is parent-controlled: Factory first, PANTHEON second, GO caller last. No production execution is established by local tests or PR CI. The tiny artifact stays in the existing private Factory store; later Drive archival is separate.

Run cross-repository local integration after checking out all candidates:

    GO_CHECKOUT=/path/to/Go-Together FACTORY_CHECKOUT=/path/to/Factory-District node --test cloudflare/tests/l1-chain.integration.mjs

This exercises the actual three worker modules with in-memory D1/R2. It is separate from repository CI, which runs the local contract/lifecycle suites without fetching private sibling checkouts.
