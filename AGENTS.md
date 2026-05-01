# AGENTS.md — amp-mcp-server

Context for AI coding agents (Claude Code, etc.) working on this repository.

---

## RESUME HERE (2026-05-01 — Phases A–D in)

v0.1 source + packaging is complete and pushed to GitLab. State for the next agent:

- Remote: `https://gitlab.darkforge.app/weddins/amp-mcp-server.git` (origin)
- All source written: `src/index.ts`, `src/amp-client.ts`, `src/tools/{instances,console}.ts`
- Packaging: `Dockerfile`, `docker-compose.yml`, `README.md`, `LICENSE`, `.env.example`, `.gitignore`, `.dockerignore`
- `npm run build` is clean. HTTP smoke test passes locally (`tools/list` returns the expected 4 / 8 tools depending on `AMP_ALLOW_WRITES`).
- **NOT YET DONE**: end-to-end run against Will's live homelab AMP. That's the v0.1 acceptance gate.

**AMP client swap from the original plan**: `@cubecoders/ampapi` (official, but stale since 2020 and depends on the deprecated `request` library) was replaced with `@neuralnexus/ampapi@^1.0.19` (typed, maintained 2023–24, no transitive deps). The README and `package.json` now reflect this.

**zod v4 worked fine**: the SDK supports both v3 and v4 via `zod-compat.d.ts`. No downgrade needed.

**TS 6 note**: TypeScript 6 with `module: NodeNext` does not auto-include `@types/node` globals (`process` etc.) — `tsconfig.json` explicitly sets `lib: ["ES2022"]` and `types: ["node"]`.

---

## What this is

An MCP (Model Context Protocol) server that wraps **CubeCoders AMP** (Application Management Panel) so MCP clients — Claude Desktop, Claude Code, others — can list, inspect, and control AMP-managed game-server instances.

CubeCoders AMP is a paid, self-hosted game-server control panel. This project is **a client of AMP's public REST API**; no AMP source or binaries are redistributed. Users bring their own licensed AMP install.

## Why it exists

No MCP server existed for AMP as of 2026-05-01. Will runs AMP in his homelab. Building this gives Claude direct, structured access to start/stop game servers, send console commands, and read server state without screen-scraping the AMP web UI.

## Architecture

```
MCP client (Claude Desktop / Code)
        │  stdio  ── or ──  HTTP (stateless Streamable)
        ▼
   amp-mcp-server  ── REST/JSON ──▶  AMP install (homelab)
        │
        └─▶ @neuralnexus/ampapi  (typed AMP client; no transitive deps)
```

Transport is selected by the `MCP_TRANSPORT` env var:
- `stdio` (default) — for direct local use; the MCP client spawns `node dist/index.js`
- `http` — for Docker / remote deployment; server listens on `MCP_PORT` (default `3000`), `MCP_HOST` (default `127.0.0.1`)

The HTTP path uses **stateless** Streamable HTTP: per-request `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` and a fresh `McpServer` built via `buildServer()`. The shared `AmpClient` singleton holds the AMP session.

## Tools exposed

Read-only (always enabled):
- `amp_list_instances` — enumerate all AMP-managed instances
- `amp_get_instance_status` — state, uptime, players, CPU/RAM for one instance
- `amp_get_active_users` — connected players for an instance
- `amp_get_console_output` — recent console lines from an instance

Write tools (gated by `AMP_ALLOW_WRITES=true`):
- `amp_start_instance` / `amp_stop_instance` / `amp_restart_instance`
- `amp_send_console_command`

**Why gated**: write operations mutate live game-server state. Default-off prevents accidental destructive calls during early iteration; flip the env var when you trust the wiring.

## Repo layout

```
amp-mcp-server/
├── AGENTS.md              # this file
├── README.md              # human-facing quickstart
├── LICENSE                # MIT
├── package.json
├── tsconfig.json
├── .env.example           # documents required env vars
├── .gitignore
├── .dockerignore
├── Dockerfile             # multi-stage build, slim runtime
├── docker-compose.yml     # HTTP mode, env from .env
├── src/
│   ├── index.ts           # entrypoint: McpServer + transport switch
│   ├── amp-client.ts      # @cubecoders/ampapi auth + cached session
│   └── tools/
│       ├── instances.ts   # list/status/users + gated start/stop/restart
│       └── console.ts     # read + gated send-command
└── dist/                  # tsc output (gitignored)
```

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `AMP_URL` | yes | — | Base URL of AMP install, e.g. `https://amp.homelab.local` |
| `AMP_USERNAME` | yes | — | AMP admin username |
| `AMP_PASSWORD` | yes | — | AMP password (or remembered-token; see ampapi docs) |
| `AMP_ALLOW_WRITES` | no | `false` | Set `true` to enable start/stop/console-send tools |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` or `http` |
| `MCP_PORT` | no | `3000` | Port for HTTP transport (ignored in stdio mode) |

Copy `.env.example` → `.env` and fill in. Never commit `.env`.

## Build & run

```bash
npm install
npm run build              # tsc → dist/
npm start                  # runs dist/index.js (stdio by default)

# HTTP mode locally
MCP_TRANSPORT=http npm start

# Inspector smoke test (stdio)
npx @modelcontextprotocol/inspector node dist/index.js
```

## Docker

```bash
# Build image
docker compose build

# Run (HTTP mode on port 3000)
docker compose up -d

# Logs
docker compose logs -f
```

The compose file reads from `.env` and exposes `MCP_PORT`. Container runs as non-root.

## Claude Desktop wiring

stdio (local node):
```json
{
  "mcpServers": {
    "amp": {
      "command": "node",
      "args": ["D:\\Darkforge\\amp-mcp-server\\dist\\index.js"],
      "env": {
        "AMP_URL": "...",
        "AMP_USERNAME": "...",
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

## Key dependencies

| Package | Why |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server framework, transports, schema helpers |
| `@neuralnexus/ampapi` | Typed community AMP client (auto-generated from AMP's `GetAPISpec`); dual GPL-3.0 / MIT, used here under MIT |
| `zod` | Tool input schemas (v4; SDK 1.29 supports both v3/v4) |
| `express` | HTTP transport host |

`@neuralnexus/ampapi` has no transitive runtime deps (uses native `fetch`), so the original `@cubecoders/ampapi` audit caveat about the deprecated `request` library is gone.

## Decisions log

- **HTTP-first, stateless** — `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`, fresh transport + `McpServer` per request via `buildServer()`. stdio retained as a small env-switch branch.
- **Both transports, env-switched** — stdio for local Claude Desktop subprocess use, HTTP for Docker / remote.
- **Write tools gated by env var, not per-call confirmation** — the MCP client already confirms tool calls with the user; an extra layer would be redundant. Env var is the project-level kill switch. Re-evaluated per request because `McpServer` is rebuilt each call.
- **MIT license**.
- **`@neuralnexus/ampapi` over `@cubecoders/ampapi`** — typed, maintained 2023–24, no `request` dep. See "Key dependencies" above.
- **No tests in v0.1** — manual smoke via MCP Inspector + real AMP instance is the verification loop. Add Vitest once the API surface stabilizes.
- **No CI in v0.1** — self-hosted GitLab first; CI added if/when the project moves to a public remote.

## Status

- [x] Folder + `package.json` + runtime deps
- [x] Dev deps installed (`typescript`, `@types/node`, `@types/express`)
- [x] `tsconfig.json`
- [x] `src/amp-client.ts`
- [x] `src/tools/instances.ts`
- [x] `src/tools/console.ts`
- [x] `src/index.ts` (stdio + HTTP transport switch)
- [x] `Dockerfile` + `docker-compose.yml` + `.dockerignore`
- [x] `README.md`, `LICENSE` (MIT, holder = Will Eddins), `.gitignore`, `.env.example`
- [x] `npm run build` clean
- [x] HTTP smoke test (`tools/list` returns 4 / 8 tools depending on `AMP_ALLOW_WRITES`)
- [x] `git init`, commits pushed to GitLab `origin/main`
- [ ] **Live homelab end-to-end** — `amp_list_instances` + a guarded `amp_send_console_command` against a non-prod instance. **This is the v0.1 acceptance gate.**
- [ ] Docker `compose build && compose up -d` against the homelab

## v0.2 candidates

- Package as an AMP Generic Module template — wrap the Docker image via `Meta.SpecificDockerImage` so AMP itself can install/manage this MCP server. Wiki: https://github.com/CubeCoders/AMP/wiki/Configuring-the-'Generic'-AMP-module ; community templates: https://github.com/CubeCoders/AMPTemplates.
- `SIGTERM` handler for graceful HTTP shutdown (current behavior: process exits, in-flight responses dropped).
- Possible C# port using `ModelContextProtocol.AspNetCore` — needs an `ampapi-csharp` codegen against `p0t4t0sandwich/ampapi-spec` first.

## Out of scope (still)

- Multi-AMP / multi-controller orchestration (one ADS at a time)
- Resources or prompts (tools only)
- Automated image publishing (GHCR / Docker Hub)
- Public GitHub mirror

## For future agents

- AMP method names + signatures live in `node_modules/@neuralnexus/ampapi/dist/lib/` — fully typed. `IADSInstance`, `Instance`, `Status`, `Updates`, `ConsoleEntry`, `ActionResult<T>` are all exported. The `UUID` type is a strict template-literal alias `${string}-${string}-${string}-${string}-${string}`; pass user-supplied strings as `string` (not `UUID`) to satisfy the public API signatures.
- AMP has two login flavors: top-level **ADS controller** (sees all instances, can start/stop them) and **per-instance** (sees one game server's console, players). The sub-API pattern is `controller.InstanceLogin<CommonAPI>(instanceId, moduleName)` — `AmpClient.getInstance(id)` in [src/amp-client.ts](src/amp-client.ts) auto-detects the module name from `ADSModule.GetInstances()`.
- The shared Bash shell on this dev box resets cwd to `G:\Obsidian\PersonalAssistant` after each command. PowerShell tool keeps cwd; for git use absolute paths or `git -C` if reaching for Bash.
