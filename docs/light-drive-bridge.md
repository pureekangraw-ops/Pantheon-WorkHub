# PANTHEON Google Drive capabilities for LIGHT

LIGHT-BOOKMARK invokes PANTHEON LightBridge capabilities `pantheon.drive.read` and `pantheon.drive.write`. Google OAuth client secrets, refresh tokens, and access tokens stay exclusively in PANTHEON; they are never sent to LIGHT.

Access covers all files visible to the Google account authorized in PANTHEON; no folder allowlist is used. Read operations require the account-wide `https://www.googleapis.com/auth/drive.readonly` or broader `https://www.googleapis.com/auth/drive` scope. Write operations require `drive`. Google classifies these broad scopes as restricted, so user consent, app verification, or a security assessment may be required. A per-file `drive.file` scope is not sufficient for account-wide access. See [Google Drive API scopes](https://developers.google.com/drive/api/guides/about-auth).

`PANTHEON_DRIVE_READ_ENABLED` and `PANTHEON_DRIVE_WRITE_ENABLED` are separate fail-closed feature gates. LIGHT can read/list files and permissions, create text files/folders, update supported text files, rename, move, copy, add user/group/domain/anyone permissions, and update permission roles or link-discovery settings. Ownership transfer is not exposed.

No file-delete or permission-delete operation is implemented, and the bridge never sends an HTTP DELETE request to Google Drive. This is a tool-layer restriction: the full `drive` OAuth scope itself can manage all files, including deletion. Returned text and upstream bodies are bounded; listings and permission lists are paginated. Share operations can expose files externally and should only be invoked when the user explicitly requests sharing.

Before production rollout, verify the OAuth scope and refresh-token validity in staging, then test each write against a staging-safe file. Do not deploy until the grant is confirmed. Never copy OAuth secrets into LIGHT or source control.
