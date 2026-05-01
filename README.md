# amp-mcp-server

An [MCP](https://modelcontextprotocol.io) server that wraps [CubeCoders AMP](https://cubecoders.com/AMP) so MCP clients (Claude Desktop, Claude Code, others) can list, inspect, and control AMP-managed game-server instances.

This project is a **client of AMP's public REST API** — no AMP source or binaries are redistributed. Bring your own licensed AMP install.

## Tools exposed

Read-only (always enabled):

- `amp_list_instances` — enumerate all AMP-managed instances
- `amp_get_instance_status` — state, uptime, CPU/RAM/players for one instance
- `amp_get_active_users` — connected users for one instance
- `amp_get_console_output` — recent console lines for one instance

Write tools (gated by `AMP_ALLOW_WRITES=true`):

- `amp_start_instance` / `amp_stop_instance` / `amp_restart_instance`
- `amp_send_console_command`

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
| `MCP_HOST` | no | `127.0.0.1` | HTTP bind host (HTTP transport only) |

Copy `.env.example` to `.env` and fill in real values. **Never commit `.env`.**

## Quick start — Docker (HTTP)

```bash
cp .env.example .env
# edit .env with your AMP credentials
docker compose up -d --build
docker compose logs -f
```

The server listens on `http://localhost:3000/mcp` (stateless Streamable HTTP transport).

Smoke check:

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

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
