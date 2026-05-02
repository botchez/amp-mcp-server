# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-05-01

### Added
- `GET /health` liveness endpoint, bypasses auth, rate limiting, and origin checks
- Dockerfile `HEALTHCHECK` directive using a Node `fetch` one-liner (no curl dependency in the slim image)

## [0.2.0] - 2026-05-01

### Added
- **HTTP authentication** via `MCP_AUTH_MODE`:
  - `bearer` — static `Authorization: Bearer <token>` check, constant-time compare via SHA-256 + `timingSafeEqual`, multi-token via comma list
  - `oauth` — OAuth 2.1 resource server: JWT validation via JWKS, OIDC discovery, RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource`, RFC 8707 audience check, optional scope gating, `WWW-Authenticate: Bearer ... resource_metadata="..."` 401 challenge per the MCP Authorization spec
- `scripts/oauth-token.mjs` — one-shot Auth Code + PKCE helper for testing OAuth mode end-to-end
- Rate limiting on `/mcp` (`MCP_RATE_LIMIT`, `MCP_RATE_WINDOW_MS`)
- `Origin` header allow-list (`MCP_ALLOWED_ORIGINS`) for browser-client guard
- `Host` header allow-list (`MCP_ALLOWED_HOSTS`) for DNS-rebinding protection
- `MCP_TRUST_PROXY` for accurate `req.ip` behind reverse proxies
- Startup safety guard: refuses `0.0.0.0` + `MCP_AUTH_MODE=none` + no `MCP_ALLOWED_HOSTS` unless `MCP_ALLOW_INSECURE=true`
- vitest test suite — 23 tests covering auth middleware behavior

### Changed
- Refactored into `src/transports/{stdio,http}.ts`, `src/server.ts`, `src/config.ts`, `src/auth/`
- Per-request `sub` claim added to logger context in OAuth mode
- README rewritten with new sections explaining OAuth roles (resource server / AS / client) and the redirect-URI question, plus a Keycloak quickstart and a real-AS issuer-shape table

## [0.1.4]

### Added
- Eight new tools: `amp_get_host_status`, `amp_get_running_tasks`, `amp_get_update_info`, `amp_list_backups`, `amp_take_backup`, `amp_update_application`, `amp_end_user_session`, `amp_sleep_instance`

## [0.1.3]

### Added
- Per-request `reqId` and tool-call tracing in structured logs

## [0.1.2]

### Changed
- Structured logging via `pino` (stderr-only — stdout is reserved for stdio MCP traffic)

## [0.1.1]

### Added
- GitLab CI config for shell-executor runner, builds + pushes Docker images to the GitLab registry

### Fixed
- Post-acceptance polish following first homelab end-to-end run

## [0.1.0]

### Added
- Initial release: stdio + HTTP transports, AMP client wrapping, 4 read tools + 4 write tools (write gated by `AMP_ALLOW_WRITES`)
