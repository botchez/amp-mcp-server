# AGENTS.md — amp-mcp-server

Context for AI coding agents (Claude Code, Codex, etc.) working on this repository.

---

## Current state (v0.2.1, 2026-05-01)

- **What's running**: stable. v0.2.1 ships HTTP auth (bearer + OAuth 2.1), security hardening (host/origin allow-lists, rate limiting, unsafe-binding guard), and a `/health` liveness endpoint. v0.1 was already verified end-to-end against Will's live homelab AMP at `https://amp.darkforge.app`.
- **Hosting**: GitLab is primary (`https://gitlab.darkforge.app/weddins/amp-mcp-server`). A push mirror to GitHub (`https://github.com/eddinsw/amp-mcp-server`) is being set up so the public can see the code; PRs from outside contributors land on GitHub but merges happen on the GitLab side.
- **CI/CD**: GitLab CI builds + pushes Docker images to the GitLab registry on every push to `main` and on tags. No GitHub Actions.
- **Tests**: vitest with 23 passing unit tests covering auth middleware (bearer, OAuth, scope check, audience check, error paths). Integration smoke-tested manually for the security guards (rate limit, origin, host, unsafe-bind refuse).
- **Build**: `npm run build` clean. `npm test` clean.

The earlier `Phase A–D` framing is retired — that was v0.1 packaging. We're past it.

## What this is

An MCP (Model Context Protocol) server that wraps **CubeCoders AMP** (Application Management Panel) so MCP clients — Claude Desktop, Claude Code, Claude.ai, others — can list, inspect, and control AMP-managed game-server instances.

CubeCoders AMP is a paid, self-hosted game-server control panel. This project is **a client of AMP's public REST API**; no AMP source or binaries are redistributed. Users bring their own licensed AMP install.

## Why it exists

No MCP server existed for AMP. Will runs AMP in his homelab. Building this gives Claude direct, structured access to start/stop game servers, send console commands, take backups, and read server state without screen-scraping the AMP web UI.

## Architecture

```
MCP client (Claude.ai / Desktop / Code / custom)
        │  stdio  ── or ──  HTTP (stateless Streamable + bearer/OAuth)
        ▼
   amp-mcp-server
        │
        ├─ src/transports/{stdio,http}.ts   (transport entrypoints)
        ├─ src/server.ts                    (per-request McpServer factory)
        ├─ src/tools/{instances,console,operations}.ts (registered tools)
        ├─ src/auth/{bearer,oauth,shared}.ts (HTTP auth middleware)
        ├─ src/config.ts                    (zod-validated env loader)
        └─ src/amp-client.ts ── REST/JSON ──▶  AMP install (homelab)
                  └─▶ @neuralnexus/ampapi  (typed AMP client; native fetch, no transitive deps)
```

Transport selected by `MCP_TRANSPORT`:
- `stdio` (default) — MCP client spawns `node dist/index.js` as a subprocess. Trust boundary is the OS process.
- `http` — server listens on `MCP_HOST:MCP_PORT` (default `127.0.0.1:3000`). Stateless: per-request `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` and a fresh `McpServer` from `buildServer()`. The `AmpClient` singleton holds the AMP session.

HTTP middleware chain on `POST /mcp`: rate limiter → origin allow-list → auth → handler. `GET /health` lives outside that chain (no auth, no rate limit) for Docker/k8s liveness probes. `/.well-known/oauth-protected-resource` is mounted only when `MCP_AUTH_MODE=oauth`.

## Tools exposed

**Read-only (always enabled):**
- `amp_list_instances`, `amp_get_instance_status`, `amp_get_active_users`, `amp_get_console_output`
- `amp_get_host_status` — controller host metrics (separate from instance metrics)
- `amp_get_running_tasks`, `amp_get_update_info`, `amp_list_backups`

**Write (gated by `AMP_ALLOW_WRITES=true`):**
- `amp_start_instance`, `amp_stop_instance`, `amp_restart_instance`, `amp_sleep_instance` — lifecycle
- `amp_send_console_command`
- `amp_take_backup`, `amp_update_application` — long-running; poll via `amp_get_running_tasks`
- `amp_end_user_session` — universal kick across modules

`AMP_ALLOW_WRITES=false` causes write tools to not be registered at all (not just to fail at call-time). This is the project-level kill switch and is rechecked per HTTP request because `McpServer` is rebuilt each call.

## Authentication (HTTP transport only)

Three modes via `MCP_AUTH_MODE`. Mutually exclusive. stdio ignores all of them.

- `none` (default): no auth. Safe for stdio + localhost-only HTTP. Server **refuses to start** in `MCP_HOST=0.0.0.0` + `none` + no `MCP_ALLOWED_HOSTS` mode unless `MCP_ALLOW_INSECURE=true` is set as an explicit override.
- `bearer`: static `Authorization: Bearer <token>` check. Multi-token via comma-separated `MCP_AUTH_TOKEN`. Constant-time compare via SHA-256 hash + `timingSafeEqual` (defends against length leak).
- `oauth`: OAuth 2.1 resource server. Validates JWTs via JWKS fetched from `MCP_OAUTH_ISSUER`. Publishes RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource`. Returns `WWW-Authenticate: Bearer ... resource_metadata="..."` on 401 per the MCP Authorization spec. Verified end-to-end against Duende IdentityServer (machine-to-machine + Authorization Code + PKCE).

OAuth mode is *resource server only* — operators bring their own authorization server (Keycloak, Duende, Auth0, Authentik, etc.). The README has a "How the pieces fit together" section explaining the resource-server / AS / client roles, the redirect-URI question (clients own the callback, not us), and the DCR-vs-manual deployment fork.

## Repo layout

```
amp-mcp-server/
├── AGENTS.md, README.md, LICENSE
├── package.json, package-lock.json, tsconfig.json
├── .env.example, .gitignore, .dockerignore
├── Dockerfile                # multi-stage; HEALTHCHECK uses node fetch (no curl in slim image)
├── docker-compose.yml        # publishes to host loopback by default; MCP_BIND env to override
├── .gitlab-ci.yml            # build + push image to GitLab registry on main / tags
├── src/
│   ├── index.ts              # entrypoint: loadConfig() + transport switch
│   ├── config.ts             # zod-validated env loader (AppConfig)
│   ├── server.ts             # buildServer() — per-request McpServer factory
│   ├── logger.ts             # pino, structured, stderr-only
│   ├── amp-client.ts         # AmpClient singleton, controller + per-instance login
│   ├── tools/
│   │   ├── shared.ts         # jsonContent helper, shared schemas
│   │   ├── instances.ts      # list/status/users + lifecycle (gated)
│   │   ├── console.ts        # read + send-command (gated)
│   │   └── operations.ts     # tasks, updates, backups, kick (some gated)
│   ├── auth/
│   │   ├── types.ts          # AuthMode discriminated union
│   │   ├── shared.ts         # extractBearer
│   │   ├── bearer.ts         # static-token middleware
│   │   ├── oauth.ts          # JWT validate + PRM mount + WWW-Authenticate
│   │   ├── index.ts          # loadAuthConfigFromEnv + middleware factory
│   │   └── *.test.ts         # vitest unit tests (23 across these three)
│   └── transports/
│       ├── stdio.ts          # StdioServerTransport wiring
│       └── http.ts           # Express app, middleware chain, /health, graceful shutdown
├── scripts/
│   ├── smoke-stdio.mjs       # spawns the binary, runs MCP handshake, list+call a tool
│   └── oauth-token.mjs       # one-shot Auth Code + PKCE helper for testing oauth mode
└── dist/                     # tsc output (gitignored)
```

## Environment variables

Full list lives in [.env.example](./.env.example) and the README. Categories: AMP connection, transport, network safety (`MCP_HOST`, `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS`, `MCP_TRUST_PROXY`, `MCP_ALLOW_INSECURE`), rate limiting (`MCP_RATE_LIMIT`, `MCP_RATE_WINDOW_MS`), auth (`MCP_AUTH_MODE` + per-mode vars), logging (`LOG_LEVEL`).

Defaults are safe (loopback bind, no auth — fine for stdio and localhost). Production exposure requires either `bearer`/`oauth` mode, or an explicit `MCP_ALLOWED_HOSTS` allow-list, or the `MCP_ALLOW_INSECURE=true` override.

## Build, test, run

```bash
npm install
npm run build              # tsc → dist/
npm test                   # vitest run

# stdio (Claude Desktop subprocess)
AMP_URL=... AMP_USERNAME=... AMP_PASSWORD=... npm start

# HTTP locally
MCP_TRANSPORT=http AMP_URL=... AMP_USERNAME=... AMP_PASSWORD=... npm start

# stdio smoke (real handshake against the binary)
node scripts/smoke-stdio.mjs

# OAuth helper (drives Auth Code + PKCE for testing oauth mode end-to-end)
node scripts/oauth-token.mjs --issuer https://auth.example --client-id mcp-test --scope "openid mcp:read"
```

## Docker

```bash
docker compose up -d --build
docker compose logs -f
```

The compose file publishes port to host loopback by default; set `MCP_BIND=0.0.0.0` in `.env` to expose externally. The Dockerfile sets `MCP_HOST=0.0.0.0` (required inside the container so the published port works), so out-of-the-box the safety guard requires you to set `MCP_AUTH_MODE` or `MCP_ALLOWED_HOSTS` before the container starts.

The Dockerfile has a `HEALTHCHECK` that calls `GET /health` via a Node `fetch` one-liner (avoids needing curl in the slim image).

## Claude Desktop wiring

stdio (local node):
```json
{
  "mcpServers": {
    "amp": {
      "command": "node",
      "args": ["D:\\Darkforge\\amp-mcp-server\\dist\\index.js"],
      "env": { "AMP_URL": "...", "AMP_USERNAME": "...", "AMP_PASSWORD": "..." }
    }
  }
}
```

HTTP with bearer:
```json
{
  "mcpServers": {
    "amp": {
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Key dependencies

| Package | Why |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server framework, transports, schema helpers |
| `@neuralnexus/ampapi` | Typed community AMP client; dual GPL-3.0 / MIT, used here under MIT |
| `zod` | Tool input schemas + env validation (v4) |
| `express` | HTTP transport host |
| `express-rate-limit` | Rate limiter for `/mcp` |
| `jose` | JWT validation + JWKS for OAuth resource-server mode |
| `pino` (+ `pino-pretty` dev-only) | Structured logging to stderr |
| `vitest` (+ `supertest`) | Test framework, dev-only |

`@neuralnexus/ampapi` has no transitive runtime deps (uses native `fetch`).

## Decisions log

- **HTTP-first, stateless** — `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`, fresh transport + `McpServer` per request. stdio retained as a small env-switch branch.
- **Both transports, env-switched** — stdio for local Claude Desktop subprocess use, HTTP for Docker / remote.
- **Write tools gated by env var, not per-call confirmation** — the MCP client already confirms tool calls with the user. Env var is the project-level kill switch. Re-evaluated per request because `McpServer` is rebuilt each call.
- **MIT license**.
- **`@neuralnexus/ampapi` over `@cubecoders/ampapi`** — typed, maintained, no `request` dep.
- **Three auth modes, one at a time** — `none` / `bearer` / `oauth` via `MCP_AUTH_MODE`. Default `none` so existing deployments don't break. Mutually exclusive at runtime.
- **OAuth = resource-server only** — operators bring their own AS. We don't embed an authorization server, login UI, or user database. JWT validation only; no introspection (defer until needed).
- **stdio ignores all auth config** — the OS process boundary is the only meaningful trust boundary there.
- **Unsafe-binding refused at startup** — `0.0.0.0` + `MCP_AUTH_MODE=none` + no `MCP_ALLOWED_HOSTS` exits 1 with a clear log unless `MCP_ALLOW_INSECURE=true`. Saves an inevitable foot-gun.
- **Bearer middleware order: limiter → origin → auth** — failed-auth requests still consume rate-limit budget. Intentional: it makes credential-stuffing attacks expensive. Side effect: a flood of bad-auth from one IP locks out legitimate clients sharing that IP. Acceptable trade for a homelab/SMB-scale deployment.
- **`MCP_PUBLIC_URL` is mandatory in oauth mode** — used as both the resource identifier in PRM and the expected JWT `aud`. Mismatches here are the #1 OAuth misconfig.
- **`/health` outside the middleware chain** — no auth, no rate limit, no origin check. Docker/k8s healthchecks have to reach it without ceremony.
- **Liveness only at `/health`, no readiness probe** — readiness would require an AMP roundtrip on every probe (latency + log noise). The MCP server can be "up" while AMP is briefly unreachable. Add `/ready` if/when we need it.
- **`pino` to stderr only** — stdout is reserved for the MCP JSON-RPC stream in stdio mode. Anything on stdout corrupts the protocol.
- **vitest, not jest** — native ESM, native TypeScript, faster cold start, no transformer config. Test files live next to source as `*.test.ts`.

## v0.3 candidates

- **Per-tool scope gating in oauth mode** — e.g., require scope `mcp:write` for write tools instead of (or in addition to) the global `AMP_ALLOW_WRITES`. Lets operators run a single shared instance where one OAuth client gets read-only and another gets full control. Currently the global flag is the only knob.
- **DPoP** (RFC 9449) — token binding to a client-held key. ~150 lines + a `jti` replay cache. Worth it if this ever goes public-internet; overkill for homelab.
- **Token introspection** (RFC 7662) for opaque tokens, as an alternative to JWT validation. Adds a round-trip and a client-credentials secret.
- **`/ready` endpoint** that does an AMP ping — only if Docker/k8s readiness becomes useful for the deployment topology.
- **AMP Generic Module template** — wrap the Docker image so AMP can install/manage this MCP server itself. https://github.com/CubeCoders/AMP/wiki/Configuring-the-'Generic'-AMP-module
- **Possible C# port** using `ModelContextProtocol.AspNetCore` — needs an `ampapi-csharp` codegen against `p0t4t0sandwich/ampapi-spec` first.

## Out of scope

- Multi-AMP / multi-controller orchestration (one ADS at a time)
- Resources or prompts (tools only)
- Acting as an OAuth authorization server (login UI, user DB, token issuance)
- Multi-tenant deployments

## For future agents

- AMP method names + signatures live in `node_modules/@neuralnexus/ampapi/dist/lib/` — fully typed. `IADSInstance`, `Instance`, `Status`, `Updates`, `ConsoleEntry`, `ActionResult<T>` are exported. The `UUID` type is a strict template-literal alias `${string}-${string}-${string}-${string}-${string}`; pass user-supplied strings as `string` (not `UUID`) to satisfy the public API signatures.
- AMP has two login flavors: the **ADS controller** (sees all instances, can start/stop them) and **per-instance** (sees one game server's console, players). Pattern: `controller.InstanceLogin<CommonAPI>(instanceId, moduleName)`. `AmpClient.getInstance(id)` in [src/amp-client.ts](src/amp-client.ts) auto-detects the module name from `ADSModule.GetInstances()`.
- The shared Bash shell on this dev box resets cwd to `G:\Obsidian\PersonalAssistant` after each command. PowerShell tool keeps cwd; for git, use absolute paths or `git -C` if reaching for Bash.
- Don't put MCP middleware before the auth check that can leak information about whether the route exists vs. is unauthorized (currently the order is fine: rate-limiter → origin → auth, all return generic JSON-RPC errors).
- TypeScript 6 with `module: NodeNext` doesn't auto-include `@types/node` globals — `tsconfig.json` explicitly sets `lib: ["ES2022"]` and `types: ["node"]`.
- Tests cover the auth surface but not the AMP-client integration. To add regression tests for the AMP API, mock `@neuralnexus/ampapi` rather than calling AMP for real (preserves test isolation + speed).
