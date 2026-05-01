#!/usr/bin/env node
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AmpClient } from "./amp-client.js";
import { registerInstanceTools } from "./tools/instances.js";
import { registerConsoleTools } from "./tools/console.js";
import { logger } from "./logger.js";

const SERVER_INFO = { name: "amp-mcp-server", version: "0.1.2" };

const amp = AmpClient.fromEnv();

function buildServer(): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerInstanceTools(server, amp);
  registerConsoleTools(server, amp);
  return server;
}

async function startStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("stdio transport connected");
}

async function startHttp(): Promise<void> {
  const port = Number.parseInt(process.env.MCP_PORT ?? "3000", 10);
  const host = process.env.MCP_HOST ?? "127.0.0.1";
  const app = createMcpExpressApp({ host });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = buildServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (err) {
      logger.error({ err }, "error handling /mcp request");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
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

  app.listen(port, host, () => {
    logger.info({ host, port, url: `http://${host}:${port}/mcp` }, "HTTP transport listening");
  });
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
