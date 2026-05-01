#!/usr/bin/env node
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AmpClient } from "./amp-client.js";
import { registerInstanceTools } from "./tools/instances.js";
import { registerConsoleTools } from "./tools/console.js";

const SERVER_INFO = { name: "amp-mcp-server", version: "0.1.1" };

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
      console.error("[amp-mcp-server] error handling /mcp request:", err);
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
    console.error(`[amp-mcp-server] HTTP listening on http://${host}:${port}/mcp`);
  });
}

const transport = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();

const start =
  transport === "http" ? startHttp : transport === "stdio" ? startStdio : null;

if (!start) {
  console.error(
    `[amp-mcp-server] unknown MCP_TRANSPORT: "${transport}". Expected "stdio" or "http".`,
  );
  process.exit(1);
}

start().catch((err) => {
  console.error("[amp-mcp-server] fatal:", err);
  process.exit(1);
});
