# PANTHEON Drive read capability for LIGHT

LIGHT-BOOKMARK invokes the PANTHEON LightBridge capability `pantheon.drive.read`. The OAuth client secret and refresh token stay exclusively in PANTHEON; no Google credentials are sent to LIGHT.

The capability is read-only and reads files visible to the Google account authorized in PANTHEON. It does not use a PANTHEON folder allowlist. Google OAuth remains the access boundary; the grant must include `https://www.googleapis.com/auth/drive.readonly` (or the broader `https://www.googleapis.com/auth/drive`). Google classifies `drive.readonly` as a restricted scope, so Google consent, app verification, or a security assessment may be required. A narrower per-file grant such as `drive.file` is not sufficient for account-wide reads. See [Google Drive API scopes](https://developers.google.com/drive/api/guides/about-auth).

`PANTHEON_DRIVE_READ_ENABLED` is a separate fail-closed feature flag. The bridge exposes only `light_drive_roots`, `light_drive_list`, and `light_drive_file`; it does not expose create, update, move, delete, sharing, or permission changes. LIGHT receives bounded metadata and up to 30,000 characters of supported text content per file; upstream response bodies are capped at 96 KB. Listing supports pagination and includes Shared Drives where Google allows them.

Before production rollout, verify the existing Google OAuth grant in staging and test a file outside the former HERMES Academy runs folder. Do not deploy until the grant is confirmed to include account-wide read scope. Never copy OAuth secrets into LIGHT or source control.
