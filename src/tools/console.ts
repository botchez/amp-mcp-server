import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmpClient } from "../amp-client.js";

const writesEnabled = (): boolean => process.env.AMP_ALLOW_WRITES === "true";

export function registerConsoleTools(server: McpServer, amp: AmpClient): void {
  server.registerTool(
    "amp_get_console_output",
    {
      title: "Get console output",
      description:
        "Read recent console output for one AMP instance. AMP returns whatever buffer is currently held; pass `lines` to limit to the most recent N entries.",
      inputSchema: {
        instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
        lines: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe("Limit to the most recent N console entries (default: all returned by GetUpdates)."),
      },
    },
    async ({ instanceId, lines }) => {
      const inst = await amp.getInstance(instanceId);
      const updates = await inst.Core.GetUpdates();
      const entries = lines ? updates.ConsoleEntries.slice(-lines) : updates.ConsoleEntries;
      const text = entries
        .map((e) => `[${e.Timestamp}] [${e.Type}] ${e.Source}: ${e.Contents}`)
        .join("\n");
      return {
        content: [{ type: "text" as const, text: text || "(no console output)" }],
      };
    },
  );

  if (!writesEnabled()) return;

  server.registerTool(
    "amp_send_console_command",
    {
      title: "Send console command",
      description:
        "Send a command to one AMP instance's console (e.g. `say hello`, `op someuser`, `save-all`). Do NOT include a trailing newline.",
      inputSchema: {
        instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
        command: z.string().min(1).describe("Command text to send to the instance console."),
      },
    },
    async ({ instanceId, command }) => {
      const inst = await amp.getInstance(instanceId);
      await inst.Core.SendConsoleMessage(command);
      return {
        content: [{ type: "text" as const, text: `sent: ${command}` }],
      };
    },
  );
}
