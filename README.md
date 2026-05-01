# amp-mcp-server

An [MCP](https://modelcontextprotocol.io) server that wraps [CubeCoders AMP](https://cubecoders.com/AMP) so MCP clients (Claude Desktop, Claude Code, others) can list, inspect, and control AMP-managed game-server instances.

This project is a **client of AMP's public REST API** — no AMP source or binaries are redistributed. Bring your own licensed AMP install.

## Tools exposed

Read-only (always enabled):

- `amp_list_instances` — enumerate all AMP-managed instances
- `amp_get_instance_status` — state, uptime, CPU/RAM/players for one instance
- `amp_get_active_users` — connected users for one instance
- `amp_get_console_output` — recent console lines for one instance
- `amp_get_host_status` — state, uptime, CPU/RAM for the AMP controller host itself
- `amp_get_running_tasks` — currently-running tasks on one instance (with progress %)
- `amp_get_update_info` — pending game-server updates for one instance
- `amp_list_backups` — local backups for one instance

Write tools (gated by `AMP_ALLOW_WRITES=true`):

- `amp_start_instance` / `amp_stop_instance` / `amp_restart_instance` — instance lifecycle
- `amp_sleep_instance` — soft shutdown (resumable faster than Stop; module-dependent)
- `amp_send_console_command` — send a command to one instance's console
- `amp_take_backup` — trigger a backup (poll completion via `amp_get_running_tasks`)
- `amp_update_application` — apply a pending game-server update (long-running)
- `amp_end_user_session` — disconnect a user session (universal kick across modules)

Default-off prevents accidental destructive calls.

## Environment

| Var | Required | Default | Purpose |
|---|---|---|---|
| `AMP_URL` | yes | — | Base URL of your AMP install, e.g. `https://amp.example.local` |
| `AMP_USERNAME` | yes | — | AMP admin username |
| `AMP_PASSWORD` | yes | — | AMP password (or remembered-token) |
| `AMP_ALLOW_WRITES` | no | `false` | Set `true` to enable mutating tools |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` (subprocess use) or `http` (Docker / remote) |
| `MCP_PORT` | no | `3000` | HTTP listen port (HTTP transport only) |
| `MCP_HOST` | no | `127.0.0.1` | HTTP bind host (HTTP transport only). Docker image overrides to `0.0.0.0`. |
| `MCP_ALLOWED_HOSTS` | no | — | Comma-separated `Host` header allow-list (DNS rebinding protection). Required when `MCP_HOST` is `0.0.0.0`/`::` and `MCP_AUTH_MODE=none`. |
| `MCP_ALLOWED_ORIGINS` | no | — | Comma-separated `Origin` allow-list. Requests with a mismatching `Origin` get 403; requests with no `Origin` (server-to-server) are allowed. |
| `MCP_TRUST_PROXY` | no | — | Forwarded to Express `trust proxy`. Set when behind nginx/Caddy so `req.ip` is the real client. |
| `MCP_ALLOW_INSECURE` | no | `false` | Override the startup guard that refuses `0.0.0.0` + `none` auth + no host allow-list. |
| `MCP_RATE_LIMIT` | no | `120` | Max requests per window on `/mcp`. Set `0` to disable. |
| `MCP_RATE_WINDOW_MS` | no | `60000` | Rate-limit window length in milliseconds. |
| `MCP_AUTH_MODE` | no | `none` | `none` / `bearer` / `oauth` — see [Authentication](#authentication) |
| `MCP_PUBLIC_URL` | when `oauth` | — | Canonical external URL of this server (resource id + JWT audience) |
| `MCP_AUTH_TOKEN` | when `bearer` | — | Comma-separated list of accepted bearer tokens |
| `MCP_OAUTH_ISSUER` | when `oauth` | — | OAuth 2.1 authorization server issuer URL |
| `MCP_OAUTH_AUDIENCE` | no | `MCP_PUBLIC_URL` | Override expected JWT `aud` claim |
| `MCP_OAUTH_JWKS_URL` | no | OIDC-discovered | Override JWKS URL (skips OIDC discovery) |
| `MCP_OAUTH_REQUIRED_SCOPES` | no | — | Comma-separated scopes required on every request |
| `LOG_LEVEL` | no | `info` | pino log level: `trace` / `debug` / `info` / `warn` / `error` / `fatal`. All logs go to stderr. |

Copy `.env.example` to `.env` and fill in real values. **Never commit `.env`.**

## Quick start — Docker (HTTP)

```bash
cp .env.example .env
# edit .env with your AMP credentials
docker compose up -d --build
docker compose logs -f
```

The server listens on `http://127.0.0.1:3000/mcp` (stateless Streamable HTTP transport). The compose file publishes the port to host loopback only; to expose it externally, set `MCP_BIND=0.0.0.0` in `.env` **and** enable auth (`MCP_AUTH_MODE=bearer`/`oauth`) or set `MCP_ALLOWED_HOSTS` — the server refuses to start in `0.0.0.0` + no-auth + no-allowlist mode unless `MCP_ALLOW_INSECURE=true`.

Smoke check:

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The HTTP transport also exposes `GET /health` (returns `{"status":"ok"}`) for Docker/k8s liveness probes — bypasses auth, rate limiting, and origin checks. The Dockerfile has a built-in `HEALTHCHECK` that hits this endpoint.

## Quick start — local Node (stdio or HTTP)

Requires Node 20+.

```bash
npm install
npm run build

# stdio (for an MCP client to spawn as a subprocess)
AMP_URL=... AMP_USERNAME=... AMP_PASSWORD=... npm start

# HTTP (local)
MCP_TRANSPORT=http AMP_URL=... AMP_USERNAME=... AMP_PASSWORD=... npm start
```

Inspect tools interactively:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Authentication

The HTTP transport supports three auth modes, selected by `MCP_AUTH_MODE`. **stdio transport ignores all of these** — its trust boundary is the OS process, and your MCP client passes credentials via the env block in its config.

| Mode | When to use | What it does |
|---|---|---|
| `none` (default) | stdio, or HTTP bound to `127.0.0.1` / private network only (Tailscale, WireGuard, LAN) | No auth at all. Network-layer trust is the only thing keeping callers out. |
| `bearer` | Exposing HTTP to one or two clients you control (e.g. a personal cloud VM) | Static `Authorization: Bearer <token>` check. Constant-time compare. |
| `oauth` | Public/multi-user deployments, or any client that expects spec-compliant MCP auth (e.g. Claude.ai connecting to a remote MCP server) | OAuth 2.1 resource server. Validates JWTs issued by your authorization server. Publishes RFC 9728 Protected Resource Metadata. |

These modes are mutually exclusive — pick one. None of them replace `AMP_ALLOW_WRITES`; that flag still controls whether the write tools are registered at all.

### Bearer mode

```bash
MCP_AUTH_MODE=bearer
MCP_AUTH_TOKEN=$(openssl rand -hex 32)
```

Clients call `/mcp` with `Authorization: Bearer <token>`. Multiple tokens are accepted as a comma-separated list (one per client, easy revocation by removing the entry and restarting). Missing/invalid tokens get `401` with `WWW-Authenticate: Bearer realm="mcp"`.

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### OAuth 2.1 mode

This server acts as an **OAuth 2.1 resource server** — it validates access tokens but does **not** issue them. You bring your own authorization server (Keycloak, Auth0, Authentik, Duende, Okta, etc.).

#### How the pieces fit together

OAuth involves three roles. `amp-mcp-server` is only one of them:

- **Resource server** — *`amp-mcp-server` itself.* Validates incoming JWTs, serves tools. **Has no callback URL and never participates in the redirect flow.** Lives at `MCP_PUBLIC_URL`.
- **Authorization server (AS)** — *something else you run* (Keycloak, Duende, Auth0, Authentik, …). Issues tokens after a user logs in. Lives at `MCP_OAUTH_ISSUER`.
- **MCP client** — *Claude.ai, Claude Desktop, a custom CLI tool, etc.* Drives the user-login flow against the AS, receives a token, sends it to the resource server. **Each client owns its own redirect/callback URL.**

The flow when a user adds your MCP server to a client like Claude.ai:

```
user
 │
 ▼
MCP client ── (1) fetch PRM ─────► amp-mcp-server   (resource server)
   │           (says "use AS_X")
   │
   │ (2) Auth Code + PKCE ──────► AS   (Keycloak / Duende / etc.)
   │     user logs in + consents
   │     AS redirects to the *client's* callback
   │
   └── (3) bearer JWT ─────────► amp-mcp-server
```

So the redirect URI you configure at your AS is **not** `https://your-mcp-server/callback` — it's whatever URL the *client* needs. For Claude.ai it's something on `claude.ai`; for a desktop or CLI tool it's typically a loopback URL like `http://127.0.0.1:8765/callback` (RFC 8252).

This means a deployment decision:

- **A few known clients** → pre-register each in your AS admin UI (one client entry per consumer, with *that consumer's* callback URL). Fine if it's just you adding one or two MCP clients.
- **Many or unknown clients** → enable **Dynamic Client Registration (RFC 7591)** on your AS so clients register themselves at runtime. The MCP Authorization spec recommends DCR for public deployments. Keycloak, Duende, Auth0, and Authentik all support it as an opt-in feature.

`amp-mcp-server` itself doesn't care which path you pick — it only sees the resulting bearer JWT.

#### Required env

```bash
MCP_AUTH_MODE=oauth
MCP_PUBLIC_URL=https://amp-mcp.example.com   # exact URL clients hit; used as JWT audience
MCP_OAUTH_ISSUER=https://auth.example.com/realms/amp
# Optional:
MCP_OAUTH_REQUIRED_SCOPES=mcp:read,mcp:write
```

The exact shape of `MCP_OAUTH_ISSUER` depends on which authorization server you're using — it must match the `iss` claim that the AS puts in tokens it issues:

| AS | Typical issuer URL |
|---|---|
| Keycloak | `https://auth.example.com/realms/<realm>` (a *realm* is a Keycloak tenant — its own users/clients/roles) |
| Duende IdentityServer | `https://auth.example.com` (bare, no path) |
| Auth0 | `https://<tenant>.auth0.com/` |
| Authentik | `https://authentik.example.com/application/o/<slug>/` |
| Okta | `https://<org>.okta.com/oauth2/<server-id>` |

When in doubt, fetch `<issuer>/.well-known/openid-configuration` and check the `issuer` field — that's the canonical value to use here.

The server publishes a Protected Resource Metadata document at:

```
GET /.well-known/oauth-protected-resource
```

so that compliant MCP clients can discover the authorization server automatically. On `/mcp` calls without a valid token, the server returns `401` with:

```
WWW-Authenticate: Bearer realm="mcp", resource_metadata="https://amp-mcp.example.com/.well-known/oauth-protected-resource"
```

JWT validation requires:

- valid signature (JWKS fetched from the AS)
- `iss` matches `MCP_OAUTH_ISSUER`
- `aud` includes `MCP_OAUTH_AUDIENCE` (default: `MCP_PUBLIC_URL`)
- `exp` is in the future
- all `MCP_OAUTH_REQUIRED_SCOPES` (if set) are present in the `scope` or `scp` claim

> **Important:** `MCP_PUBLIC_URL` must match exactly what clients call. Audience-mismatch is the most common misconfig — if clients get 401s after appearing to authenticate successfully, check that the AS issued the token for *this* URL.

#### Quickstart with Keycloak

```bash
docker run -d --name kc -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:latest start-dev
```

In the Keycloak admin UI:
1. Create a realm (e.g. `amp`).
2. Create a client `amp-mcp-test`, client type `OpenID Connect`, public, with PKCE; standard flow enabled.
3. Create a user, set a password.
4. Add a client scope `mcp:read`, mapped as a default scope.
5. Set the client's "Valid post logout redirect URIs" / "Valid redirect URIs" to whatever your MCP client expects (e.g. Claude.ai's callback).

Run amp-mcp-server with:

```bash
MCP_TRANSPORT=http \
MCP_AUTH_MODE=oauth \
MCP_PUBLIC_URL=http://localhost:3000 \
MCP_OAUTH_ISSUER=http://localhost:8080/realms/amp \
MCP_OAUTH_AUDIENCE=http://localhost:3000 \
AMP_URL=... AMP_USERNAME=... AMP_PASSWORD=... \
npm start
```

Verify the PRM endpoint:

```bash
curl http://localhost:3000/.well-known/oauth-protected-resource
```

Verify the 401 challenge:

```bash
curl -i -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# expect: 401 + WWW-Authenticate: Bearer realm="mcp", resource_metadata="..."
```

For end-to-end testing with the real Auth Code + PKCE browser-login flow (the same flow Claude.ai and other compliant MCP clients use), this repo ships a one-shot helper at [scripts/oauth-token.mjs](scripts/oauth-token.mjs):

```bash
# Configure a public client at your AS with redirect_uri http://127.0.0.1:8765/callback,
# PKCE required, and the scope(s) you want. Then:
TOKEN=$(node scripts/oauth-token.mjs \
  --issuer http://localhost:8080/realms/amp \
  --client-id amp-mcp-test \
  --scope "openid mcp:read")
# Open the printed URL in your browser, log in, and the script captures the
# token and prints it to stdout.

curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

For quicker non-interactive checks against a Machine-to-Machine client, you can also use the `client_credentials` grant directly:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/realms/amp/protocol/openid-connect/token \
  -d 'grant_type=client_credentials' \
  -d 'client_id=<m2m-client-id>' \
  -d 'client_secret=<secret>' \
  -d 'scope=mcp:read' | jq -r .access_token)
```

## Wiring into Claude Desktop

stdio (local Node):

```json
{
  "mcpServers": {
    "amp": {
      "command": "node",
      "args": ["/absolute/path/to/amp-mcp-server/dist/index.js"],
      "env": {
        "AMP_URL": "https://amp.example.local",
        "AMP_USERNAME": "admin",
        "AMP_PASSWORD": "..."
      }
    }
  }
}
```

HTTP (Docker / remote):

```json
{
  "mcpServers": {
    "amp": { "url": "http://localhost:3000/mcp" }
  }
}
```

## Architecture

```
MCP client (Claude Desktop / Code)
        │  stdio  ── or ──  HTTP (stateless Streamable)
        ▼
   amp-mcp-server  ── REST/JSON ──▶  AMP install
        │
        └─▶ @neuralnexus/ampapi  (typed AMP client; no transitive deps)
```

The HTTP transport runs in **stateless** mode: each request gets a fresh `StreamableHTTPServerTransport` and `McpServer` so write-tool gating reflects the current `AMP_ALLOW_WRITES` value. Auth state on the `AmpClient` (the AMP session) is shared across requests as a singleton.

## License

MIT — see [LICENSE](./LICENSE).

The bundled AMP client `@neuralnexus/ampapi` is dual-licensed GPL-3.0 / MIT and is used here under MIT.
