# Auth HTTP contract (CLI ↔ backend)

All endpoints in this document are called **without** authentication unless noted.

## Start device authorization
- **POST** `/auth/device/authorize`
- **Body**: `{ clientId: 'opkg-cli', scope?: 'openid', deviceName?: 'opkg-cli' }`
- **Response**: `{ device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }`

## Poll for tokens
- **POST** `/auth/device/token`
- **Body**: `{ deviceCode }`
- **Success**: `{ access_token, refresh_token, token_type: 'bearer', expires_in }`
- **Error codes** (HTTP 400): `authorization_pending`, `slow_down`, `expired_token`, `access_denied`

## Refresh access token
- **POST** `/auth/refresh`
- **Body**: `{ refreshToken }`
- **Success**: `{ accessToken, refreshToken }`

## Logout
- **POST** `/auth/logout` (**bearer auth required**)
- **Body**: `{ refreshToken }`


