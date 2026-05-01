import { lookupState } from "@neuralnexus/ampapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmpClient } from "../amp-client.js";
import { withTrace, type Logger } from "../logger.js";
import { instanceIdField, jsonContent } from "./shared.js";

export function registerInstanceTools(
  server: McpServer,
  amp: AmpClient,
  log: Logger,
  allowWrites: boolean,
): void {
  server.registerTool(
    "amp_list_instances",
    {
      title: "List AMP instances",
      description:
        "Enumerate all instances managed by the AMP controller. Returns InstanceID, name, module type, running state, and parent target for each game-server instance.",
      inputSchema: {},
    },
    withTrace(log, "amp_list_instances", async () => {
      const instances = await amp.listInstances();
      return jsonContent(
        instances.map((i) => ({
          InstanceID: i.InstanceID,
          InstanceName: i.InstanceName,
          FriendlyName: i.FriendlyName,
          Module: i.Module,
          ModuleDisplayName: i.ModuleDisplayName,
          Running: i.Running,
          AppState: lookupState(i.AppState),
          Suspended: i.Suspended,
          Target: i.TargetFriendlyName,
        })),
      );
    }),
  );

  server.registerTool(
    "amp_get_instance_status",
    {
      title: "Get instance status",
      description:
        "Get state, uptime, and metrics (CPU, RAM, players) for a single AMP instance. Pass an InstanceID from amp_list_instances.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_get_instance_status", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) => {
        const status = await inst.Core.GetStatus();
        return jsonContent({ ...status, StateName: lookupState(status.State) });
      }),
    ),
  );

  server.registerTool(
    "amp_get_active_users",
    {
      title: "Get active users",
      description:
        "List currently connected users / players for one AMP instance. Returns a map of session UID to username.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_get_active_users", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) => jsonContent(await inst.Core.GetUserList())),
    ),
  );

  if (!allowWrites) return;

  server.registerTool(
    "amp_start_instance",
    {
      title: "Start instance",
      description: "Start a stopped AMP instance.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_start_instance", async ({ instanceId }) =>
      amp.withController(async (c) => jsonContent(await c.ADSModule.StartInstance(instanceId))),
    ),
  );

  server.registerTool(
    "amp_stop_instance",
    {
      title: "Stop instance",
      description: "Stop a running AMP instance gracefully.",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_stop_instance", async ({ instanceId }) =>
      amp.withController(async (c) => jsonContent(await c.ADSModule.StopInstance(instanceId))),
    ),
  );

  server.registerTool(
    "amp_restart_instance",
    {
      title: "Restart instance",
      description: "Restart an AMP instance (stop then start).",
      inputSchema: instanceIdField,
    },
    withTrace(log, "amp_restart_instance", async ({ instanceId }) =>
      amp.withController(async (c) => jsonContent(await c.ADSModule.RestartInstance(instanceId))),
    ),
  );
}
