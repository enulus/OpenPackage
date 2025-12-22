# opkg login – Device Authorization Flow (RFC 8628)

## Goals
- Add `opkg login [--profile <name>]` using OAuth 2.0 Device Authorization Grant.
- Store bearer tokens per profile; keep API-key auth backward compatible.

## Command behavior
- **Syntax**: `opkg login [--profile <name>]`
- **Profile**: optional; defaults to `default`.
- **Flow**:
  1) Start device authorization → get `device_code`, `user_code`, `verification_uri`,
     `verification_uri_complete`, `expires_in`, `interval`.
  2) Print code and verification URL; best-effort open browser to
     `verification_uri_complete`.
  3) Poll token endpoint until success / denied / expired / timeout.
  4) On success, persist access/refresh tokens to the selected profile.
  5) On failure, print actionable error and exit non-zero.

## UX requirements
- Print **user code** and **verification URL**.
- Open browser best-effort; if it fails, user can manually visit the URL.
- Poll respecting `interval`; on `slow_down` add **+5s** each time.
- Time out when `expires_in` elapses; show: “Code expired. Please rerun opkg login.”
- Error messages:
  - `access_denied`: “Access denied. Please restart opkg login.”
  - `expired_token`: “Code expired. Please rerun opkg login.”

## Non-goals (future)
- Device-name flag, headless/no-browser flag.
- Multi-factor UX in CLI.


