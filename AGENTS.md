# AGENTS.md — amp-mcp-server

Context for AI coding agents (Claude Code, etc.) working on this repository.

---

## RESUME HERE (2026-05-01 handoff)

A previous agent session scaffolded this repo from a vault working directory and handed off to you. State on handoff:

- `package.json` is final-form (don't regenerate)
- **Runtime deps installed**: `@modelcontextprotocol/sdk`, `zod` (v4 — see note below), `@cubecoders/ampapi`, `express`
- **Dev deps NOT installed** — first thing to do: `npm install -D typescript @types/node @types/express`
- No source files exist yet. No `tsconfig.json` yet. No git repo yet.
- The remote will be a self-hosted GitLab (URL/handle TBD with Will — ask him before `git remote add`).

Suggested order of work (matches Status checklist below): install dev deps → tsconfig → inspect ampapi types → write `amp-client.ts` → tools → index.ts → Docker assets → README/LICENSE/.env.example/.gitignore → `npm run build` → smoke test → git init → push.

**zod v4 caveat**: the MCP TypeScript quickstart uses zod v3. `npm install zod` pulled v4 here. If `McpServer.registerTool` schema definitions hit type errors, either downgrade (`npm install zod@3`) or adapt to v4's API. Check compat against `@modelcontextprotocol/sdk` v1.29.0 before downgrading.

---

## What this is

An MCP (Model Context Protocol) server that wraps **CubeCoders AMP** (Application Management Panel) so MCP clients — Claude Desktop, Claude Code, others — can list, inspect, and control AMP-managed game-server instances.

CubeCoders AMP is a paid, self-hosted game-server control panel. This project is **a client of AMP's public REST API**; no AMP source or binaries are redistributed. Users bring their own licensed AMP install.

## Why it exists

No MCP server existed for AMP as of 2026-05-01. Will runs AMP in his homelab. Building this gives Claude direct, structured access to start/stop game servers, send console commands, and read server state without screen-scraping the AMP web UI.

## Architecture

```
MCP client (Claude Desktop / Code)
        │  stdio  ── or ──  HTTP/SSE
        ▼
   amp-mcp-server  ── REST/JSON ──▶  AMP install (homelab)
        │
        └─▶ @cubecoders/ampapi  (official MIT Node client)
```

Transport is selected by the `MCP_TRANSPORT` env var:
- `stdio` (default) — for direct local use; the MCP client spawns `node dist/index.js`
- `http` — for Docker / remote deployment; server listens on `MCP_PORT` (default `3000`)

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
| `@cubecoders/ampapi` | Official MIT-licensed AMP client — handles auth, session refresh, request shape |
| `zod` | Tool input schemas |
| `express` | HTTP transport host |

Upstream caveat: `@cubecoders/ampapi` depends on the deprecated `request` library and ships a few moderate/critical npm-audit findings. These are server-side-only deps invoked against trusted AMP infrastructure, but worth tracking; if upstream switches off `request`, bump.

## Decisions log

- **Both transports, env-switched** — stdio for local Claude Desktop, HTTP for Docker. Avoids forcing a deployment style.
- **Write tools gated by env var, not per-call confirmation** — the MCP client (Claude) already confirms tool calls with the user; an extra layer would be redundant. Env var is the project-level kill switch.
- **MIT license** — matches `@cubecoders/ampapi` upstream; no friction for community contribution.
- **No tests in v0.1** — manual smoke via MCP Inspector + real AMP instance is the verification loop. Add Vitest once the API surface stabilizes.
- **No CI in v0.1** — repo is being developed against a self-hosted GitLab first; CI added when project moves to a public remote.

## Status

- [x] Folder + `package.json` (final form)
- [x] Runtime deps installed (`@modelcontextprotocol/sdk`, `zod`, `@cubecoders/ampapi`, `express`)
- [ ] Dev deps installed (`typescript`, `@types/node`, `@types/express`) — **start here**
- [ ] `tsconfig.json`
- [ ] `src/amp-client.ts`
- [ ] `src/tools/instances.ts`
- [ ] `src/tools/console.ts`
- [ ] `src/index.ts` (stdio + HTTP transport switch)
- [ ] `Dockerfile` + `docker-compose.yml` + `.dockerignore`
- [ ] `README.md`, `LICENSE` (MIT, holder = Will Eddins), `.gitignore`, `.env.example`
- [ ] `npm run build` clean
- [ ] MCP Inspector smoke test against real AMP install
- [ ] Docker build clean
- [ ] `git init` + first commit
- [ ] Pushed to GitLab remote (ask Will for URL + namespace)

## Out of scope (for now)

- Multi-AMP / multi-controller orchestration (one ADS at a time)
- Resources or prompts (tools only)
- Automated image publishing (GHCR / Docker Hub)
- Public GitHub mirror (may come later — code is OSS-ready)

## For future agents

- The `@cubecoders/ampapi` README only documents a few methods. The full API surface is exposed dynamically — the client's `initAsync()` populates method namespaces (`API.Core.*`, `API.ADSModule.*`, etc.) from the live AMP install. Inspect TypeScript types under `node_modules/@cubecoders/ampapi/` and use the live AMP install's `/API` endpoint for documentation.
- AMP has two login flavors: top-level **ADS controller** (sees all instances, can start/stop them) and **per-instance** (sees one game server's console, players, etc.). For per-instance ops, you typically obtain a sub-API via the controller. Confirm the exact pattern from the installed package's types before writing instance-scoped tools.
- The shared Bash shell on this dev box resets cwd to `G:\Obsidian\PersonalAssistant` after each command. Always prefix commands with `cd /d/Darkforge/amp-mcp-server &&` or use absolute paths.
