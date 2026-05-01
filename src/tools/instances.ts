import { z } from "zod";
import { lookupState } from "@neuralnexus/ampapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmpClient } from "../amp-client.js";

const writesEnabled = (): boolean => process.env.AMP_ALLOW_WRITES === "true";

const instanceIdField = {
  instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
};

const jsonContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerInstanceTools(server: McpServer, amp: AmpClient): void {
  server.registerTool(
    "amp_list_instances",
    {
      title: "List AMP instances",
      description:
        "Enumerate all instances managed by the AMP controller. Returns InstanceID, name, module type, running state, and parent target for each game-server instance.",
      inputSchema: {},
    },
    async () => {
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
    },
  );

  server.registerTool(
    "amp_get_instance_status",
    {
      title: "Get instance status",
      description:
        "Get state, uptime, and metrics (CPU, RAM, players) for a single AMP instance. Pass an InstanceID from amp_list_instances.",
      inputSchema: instanceIdField,
    },
    async ({ instanceId }) => {
      const inst = await amp.getInstance(instanceId);
      const status = await inst.Core.GetStatus();
      return jsonContent({ ...status, StateName: lookupState(status.State) });
    },
  );

  server.registerTool(
    "amp_get_active_users",
    {
      title: "Get active users",
      description:
        "List currently connected users / players for one AMP instance. Returns a map of session UID to username.",
      inputSchema: instanceIdField,
    },
    async ({ instanceId }) => {
      const inst = await amp.getInstance(instanceId);
      const users = await inst.Core.GetUserList();
      return jsonContent(users);
    },
  );

  if (!writesEnabled()) return;

  server.registerTool(
    "amp_start_instance",
    {
      title: "Start instance",
      description: "Start a stopped AMP instance.",
      inputSchema: instanceIdField,
    },
    async ({ instanceId }) => {
      const controller = await amp.getController();
      const result = await controller.ADSModule.StartInstance(instanceId);
      return jsonContent(result);
    },
  );

  server.registerTool(
    "amp_stop_instance",
    {
      title: "Stop instance",
      description: "Stop a running AMP instance gracefully.",
      inputSchema: instanceIdField,
    },
    async ({ instanceId }) => {
      const controller = await amp.getController();
      const result = await controller.ADSModule.StopInstance(instanceId);
      return jsonContent(result);
    },
  );

  server.registerTool(
    "amp_restart_instance",
    {
      title: "Restart instance",
      description: "Restart an AMP instance (stop then start).",
      inputSchema: instanceIdField,
    },
    async ({ instanceId }) => {
      const controller = await amp.getController();
      const result = await controller.ADSModule.RestartInstance(instanceId);
      return jsonContent(result);
    },
  );
}
