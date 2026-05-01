import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

// stderr always — stdout is reserved for the MCP JSON-RPC stream when
// MCP_TRANSPORT=stdio. Anything written to stdout will corrupt the
// protocol stream.
const useTransport = process.env.NODE_ENV !== "production" && process.stderr.isTTY;

export const logger = useTransport
  ? pino({
      level,
      base: { name: "amp-mcp-server" },
      timestamp: pino.stdTimeFunctions.isoTime,
      transport: {
        target: "pino-pretty",
        options: {
          destination: 2,
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    })
  : pino(
      {
        level,
        base: { name: "amp-mcp-server" },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.destination(2),
    );
