#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AmpClient } from "./amp-client.js";
import { registerInstanceTools } from "./tools/instances.js";
import { registerConsoleTools } from "./tools/console.js";
import { registerOperationsTools } from "./tools/operations.js";
import { logger, type Logger } from "./logger.js";
import { createAuthMiddleware, loadAuthConfigFromEnv, mountAuthRoutes } from "./auth/index.js";

// Read package.json once at startup so SERVER_INFO.version doesn't drift.
// Resolved via import.meta.url to work both from src/ (tsx) and dist/.
const pkgUrl = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { name: string; version: string };
const SERVER_INFO = { name: pkg.name, version: pkg.version };

const amp = AmpClient.fromEnv();

function buildServer(log: Logger = logger): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerInstanceTools(server, amp, log);
  registerConsoleTools(server, amp, log);
  registerOperationsTools(server, amp, log);
  return server;
}

async function startStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("stdio transport connected");
}

const ANY_HOSTS = new Set(["0.0.0.0", "::"]);

function parseAllowedHosts(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

// Origin header validation. MCP HTTP transport spec calls for explicit
// Origin checks on POSTs from browser-based clients. We allow same-origin
// requests (no Origin), and reject mismatches when an allow-list is set.
function originValidation(allowed: string[] | null): RequestHandler {
  if (!allowed) return (_req, _res, next) => next();
  const set = new Set(allowed);
  return (req, res, next) => {
    const origin = req.header("origin");
    if (!origin || set.has(origin)) {
      next();
      return;
    }
    res.status(403).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: `Forbidden: origin not allowed` },
      id: null,
    });
  };
}

async function startHttp(): Promise<void> {
  const port = Number.parseInt(process.env.MCP_PORT ?? "3000", 10);
  const host = process.env.MCP_HOST ?? "127.0.0.1";
  const allowedHosts = parseAllowedHosts(process.env.MCP_ALLOWED_HOSTS);
  const allowedOrigins = parseAllowedHosts(process.env.MCP_ALLOWED_ORIGINS) ?? null;

  const authConfig = await loadAuthConfigFromEnv();
  const allowInsecure = process.env.MCP_ALLOW_INSECURE === "true";

  // Refuse to bind to all interfaces with no auth and no host validation —
  // that's the "default-exposed" footgun. Explicit opt-out via MCP_ALLOW_INSECURE.
  if (
    ANY_HOSTS.has(host) &&
    authConfig.mode === "none" &&
    !allowedHosts &&
    !allowInsecure
  ) {
    logger.fatal(
      { host },
      "refusing to start: MCP_HOST binds to all interfaces with MCP_AUTH_MODE=none and no MCP_ALLOWED_HOSTS. Set MCP_AUTH_MODE=bearer|oauth, restrict MCP_HOST to 127.0.0.1, set MCP_ALLOWED_HOSTS, or override with MCP_ALLOW_INSECURE=true.",
    );
    process.exit(1);
  }

  const app = createMcpExpressApp(allowedHosts ? { host, allowedHosts } : { host });

  if (process.env.MCP_TRUST_PROXY) {
    app.set("trust proxy", process.env.MCP_TRUST_PROXY);
  }

  logger.info({ authMode: authConfig.mode }, "auth configured");
  mountAuthRoutes(app, authConfig);
  const authMiddleware = createAuthMiddleware(authConfig, logger);
  const originMiddleware = originValidation(allowedOrigins);

  // Rate-limit /mcp. Defaults are generous for an interactive MCP client
  // (Claude Desktop) but cap a runaway tool-calling loop. Disable with
  // MCP_RATE_LIMIT=0; tune via MCP_RATE_LIMIT (req/window) and
  // MCP_RATE_WINDOW_MS (window length).
  const rateMax = Number.parseInt(process.env.MCP_RATE_LIMIT ?? "120", 10);
  const rateWindow = Number.parseInt(process.env.MCP_RATE_WINDOW_MS ?? "60000", 10);
  const mcpLimiter: RequestHandler =
    rateMax > 0
      ? rateLimit({
          windowMs: rateWindow,
          limit: rateMax,
          standardHeaders: "draft-7",
          legacyHeaders: false,
          message: {
            jsonrpc: "2.0",
            error: { code: -32000, message: "Too many requests" },
            id: null,
          },
        })
      : (_req, _res, next) => next();

  app.post("/mcp", mcpLimiter, originMiddleware, authMiddleware, async (req: Request, res: Response) => {
    const reqId = randomUUID();
    const sub = (res.locals as { auth?: { sub?: string } }).auth?.sub;
    const reqLog = logger.child(sub ? { reqId, sub } : { reqId });
    reqLog.debug("incoming /mcp POST");
    const server = buildServer(reqLog);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    // Cleanup MUST be wired up before any operation that can throw, so we
    // don't leak the transport/server when handleRequest or connect fails.
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      void transport.close();
      void server.close();
    };
    res.on("close", cleanup);

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      reqLog.error({ err }, "error handling /mcp request");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
      cleanup();
    }
  });

  const reject405 = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method Not Allowed (stateless mode)" },
      id: null,
    });
  };
  app.get("/mcp", reject405);
  app.delete("/mcp", reject405);

  const httpServer = app.listen(port, host, () => {
    logger.info({ host, port, url: `http://${host}:${port}/mcp` }, "HTTP transport listening");
  });

  // Graceful shutdown: stop accepting new connections, let in-flight finish.
  // SIGTERM = container stop; SIGINT = Ctrl-C.
  const shutdown = (sig: string): void => {
    logger.info({ sig }, "shutdown signal received");
    httpServer.close((err) => {
      if (err) {
        logger.error({ err }, "error during HTTP server close");
        process.exit(1);
      }
      process.exit(0);
    });
    // Hard timeout so we don't hang forever on a stuck connection.
    setTimeout(() => {
      logger.warn("graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

const transport = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();

const start =
  transport === "http" ? startHttp : transport === "stdio" ? startStdio : null;

if (!start) {
  logger.error({ transport }, 'unknown MCP_TRANSPORT (expected "stdio" or "http")');
  process.exit(1);
}

start().catch((err) => {
  logger.fatal({ err }, "fatal startup error");
  process.exit(1);
});
