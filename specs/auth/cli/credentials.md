# Credentials storage & auth selection

This spec defines how the CLI stores per-profile credentials and selects request auth.

## Storage model
- Extend `ProfileCredentials` to include:
  - `access_token`
  - `refresh_token`
  - `expires_at`
  - `token_type`
- Credentials are persisted in the existing profile credentials INI.
- Preserve existing `api_key` fields when writing OAuth tokens.
- If profile is missing, create a credentials entry when saving tokens.

## `expires_at` derivation
- Derive `expires_at` from `Date.now() + expires_in*1000` or JWT `exp`.

## Header selection (per request)
1) If a **non-expired** access token exists:
   - Send `Authorization: Bearer <token>`.
2) Else if access token is expired and a refresh token exists:
   - Call `POST /auth/refresh`, persist new token pair, then use bearer auth.
3) Else if `api_key` exists:
   - Send `X-API-Key: <key>`.
4) Else:
   - Instruct user to run `opkg login` or configure an API key.

## Refresh failure behavior
- If refresh fails:
  - Fallback to `X-API-Key` if present.
  - Otherwise require login (`opkg login`).

## Browser open fallback (login UX)
- Platform-specific open (best-effort; ignore failures):
  - macOS: `open`
  - Windows: `start`
  - Linux: `xdg-open`


