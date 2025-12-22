# Auth specs

This directory documents how `opkg` authenticates to OpenPackage APIs.

## Auth modes
- **OAuth (recommended)**: Device Authorization Grant (RFC 8628) via `opkg login`.
- **API key (backward compatible)**: Used when no valid OAuth access token is available.

## Specs
- **General**
  - [`auth-http-contract.md`](./auth-http-contract.md): Backend endpoints used by CLI auth.
- **CLI**
  - [`cli/login.md`](./cli/login.md): Device authorization flow and UX.
  - [`cli/credentials.md`](./cli/credentials.md): Local credential storage and header selection/refresh rules.
  - [`cli/logout.md`](./cli/logout.md): Logout behavior and local token clearing.


