# opkg logout

## Command behavior
- **Syntax**: `opkg logout [--profile <name>]`
- **Profile**: optional; defaults to `default`.
- Requires stored OAuth tokens for the profile; **no-op** if none.

## Remote logout
- Send `POST /auth/logout` with bearer auth and body `{ refreshToken }`.

## Local clearing rules
- On success **or failure**, clear the local OAuth token fields for the profile.
- Keep any configured `api_key` intact.
- If profile resolves as direct API key usage (no OAuth session), exit with: “no OAuth session.”


