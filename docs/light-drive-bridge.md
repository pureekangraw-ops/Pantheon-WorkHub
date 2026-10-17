# Google Drive read access for LIGHT

The existing PANTHEON Worker is the sole OAuth holder for Google Drive.
Its `LightBridge` Cloudflare Service Binding exposes three **read-only**
operations to LIGHT-BOOKMARK: `light_drive_roots`, `light_drive_list`,
`light_drive_file`.

Existing PANTHEON secret names:
- `GOOGLE_ID_SECRET`: Google OAuth client ID
- `GOOGLE_SECRET`: OAuth client secret
- `GOOGLE_REFRESH_TOKEN`: refresh token

No values are committed or copied to LIGHT. Successful API usage still
depends on valid tokens and an existing Google OAuth grant with Drive read
scope. No token validity or scope has been confirmed by a live API call.

Configure only non-sensitive folder IDs in
`PANTHEON_DRIVE_ALLOWED_FOLDERS` (comma-delimited IDs). Current default root:
`1gmu8Mh8Uve9VX3bRjaPGF4qWmMHfCniz` (HERMES Academy runs).
Each file's ancestry must lead to an allowlisted root or access is denied.
Root and filename metadata are bounded, and file text is truncated to
30,000 characters with a 96 KB maximum upstream body.

No Drive write, delete, move, permission or sharing action is exposed.
LIGHT's existing task creation/Factory preparation permissions are
unchanged. GitHub/GitLab/Cloudflare integrations stay in Factory District;
this change does not migrate them into PANTHEON.

Review `node --test cloudflare/production/test/drive-read.test.mjs` and
test with LIGHT on a staging deployment and a permitted file before
production rollout. The Cloudflare Preview service-binding limitations
may require a dedicated staging Worker for end-to-end tests.
