import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { lookupState } from "@neuralnexus/ampapi";
import type { CommonAPI, MinecraftModule } from "@neuralnexus/ampapi";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AmpClient } from "../amp-client.js";
import { withTrace, type Logger } from "../logger.js";
import { jsonContent } from "./shared.js";

const instanceId = z.string().describe("Instance UUID, as returned by amp_list_instances");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cap enum lists so a 2,000-entry version list doesn't flood the context. */
function summarizeSetting(s: Record<string, any>, maxEnum = 30) {
  const entries = s.EnumValues && typeof s.EnumValues === "object" ? Object.entries(s.EnumValues) : [];
  return {
    Node: s.Node,
    Name: s.Name,
    Category: s.Category,
    CurrentValue: s.CurrentValue,
    ...(s.Description ? { Description: String(s.Description).slice(0, 200) } : {}),
    ...(entries.length
      ? {
          Options: Object.fromEntries(entries.slice(0, maxEnum)),
          ...(entries.length > maxEnum ? { OptionsTruncated: entries.length - maxEnum } : {}),
        }
      : {}),
    ...(s.EnumValuesAreDeferred
      ? { Note: "Options are loaded lazily by AMP and not listed here; set the value directly (match the format of CurrentValue)." }
      : {}),
    ...(s.RequiresRestart ? { RequiresRestart: true } : {}),
  };
}

/**
 * Poll an instance's task list until no task matching `match` remains, or
 * until `timeoutMs` elapses. Returns true if the tasks finished.
 */
async function waitForTasks(inst: CommonAPI, match: RegExp, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  await sleep(2000);
  while (Date.now() < deadline) {
    const tasks = await inst.Core.GetTasks();
    if (!tasks.some((t: any) => match.test(`${t.Name} ${t.Description ?? ""} ${t.Origin ?? ""}`))) return true;
    await sleep(3000);
  }
  return false;
}

function fileNameFromUrl(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  return decodeURIComponent(last);
}

export function registerProvisioningTools(
  server: McpServer,
  amp: AmpClient,
  log: Logger,
  allowWrites: boolean,
): void {
  // --- Read-only ---------------------------------------------------------

  server.registerTool(
    "amp_get_settings",
    {
      title: "Get instance settings",
      description:
        "Look up an instance's AMP settings (Java version, heap size, Minecraft server type/version, Forge version, difficulty, MOTD, ports, ...). " +
        "Pass `nodes` for exact setting nodes, or `query` to search node names, labels, descriptions and categories. " +
        "Returns each setting's Node (use it with amp_set_settings), current value and allowed options. " +
        "Game settings that map to server.properties live here: AMP rewrites server.properties from these on start, so edit settings rather than the file.",
      inputSchema: {
        instanceId,
        query: z.string().optional().describe("Case-insensitive search, e.g. 'forge', 'heap', 'difficulty'."),
        nodes: z.array(z.string()).optional().describe("Exact setting nodes, e.g. ['MinecraftModule.Minecraft.ServerType']."),
        limit: z.number().int().positive().max(100).optional().describe("Max settings returned for a query (default 40)."),
      },
    },
    withTrace(log, "amp_get_settings", async ({ instanceId, query, nodes, limit }) =>
      amp.withInstance(instanceId, async (inst) => {
        const spec = await inst.Core.GetSettingsSpec();
        const all = Object.values(spec).flat() as Record<string, any>[];
        let picked: Record<string, any>[];
        if (nodes?.length) {
          picked = nodes.map((n) => all.find((s) => s.Node === n) ?? { Node: n, Error: "No such node" });
        } else if (query) {
          const q = query.toLowerCase();
          picked = all.filter((s) =>
            [s.Node, s.Name, s.Description, s.Category].some((f) => String(f ?? "").toLowerCase().includes(q)),
          );
        } else {
          return jsonContent({
            totalSettings: all.length,
            categories: [...new Set(all.map((s) => s.Category))],
            hint: "Pass `query` or `nodes` to see settings.",
          });
        }
        const max = limit ?? 40;
        return jsonContent({
          matches: picked.length,
          settings: picked.slice(0, max).map((s) => ("Error" in s ? s : summarizeSetting(s))),
          ...(picked.length > max ? { truncated: picked.length - max } : {}),
        });
      }),
    ),
  );

  server.registerTool(
    "amp_list_files",
    {
      title: "List instance files",
      description:
        "List a directory in an instance's file manager. The root ('') is the game server's directory (e.g. the Minecraft folder holding mods/, config/, world/).",
      inputSchema: {
        instanceId,
        path: z.string().optional().describe("Directory relative to the instance root. Default: root."),
      },
    },
    withTrace(log, "amp_list_files", async ({ instanceId, path }) =>
      amp.withInstance(instanceId, async (inst) => {
        const entries = await inst.FileManagerPlugin.GetDirectoryListing(path ?? "");
        return jsonContent(
          entries.map((e: any) => ({
            name: e.Filename,
            dir: !!e.IsDirectory,
            ...(e.IsDirectory ? {} : { sizeBytes: e.SizeBytes }),
            modified: e.Modified,
          })),
        );
      }),
    ),
  );

  // --- Gated writes ------------------------------------------------------

  if (!allowWrites) return;

  server.registerTool(
    "amp_create_instance",
    {
      title: "Create instance",
      description:
        "Create a new AMP-managed instance (e.g. a Minecraft server) on the local controller. " +
        "Then configure it with amp_set_settings, install the game with amp_update_application, add content with amp_install_server_pack, and start it with amp_start_game_server. " +
        "AMP requires a local admin login for each instance; a random one is generated and NOT returned (sign in through the AMP panel as usual). " +
        "Pick a panel port that is not used by another instance or service.",
      inputSchema: {
        module: z.string().describe("AMP module name, e.g. 'Minecraft', 'GenericModule'."),
        instanceName: z
          .string()
          .regex(/^[A-Za-z0-9_-]+$/, "letters, digits, '-' and '_' only")
          .describe("Internal name, no spaces, e.g. 'DeceasedCraft01'."),
        friendlyName: z.string().optional().describe("Display name in the panel. Defaults to instanceName."),
        port: z.number().int().min(1024).max(65535).describe("Panel (web) port for this instance, e.g. 8082."),
        ipBinding: z.string().optional().describe("Bind address for the instance panel. Default '0.0.0.0'."),
        provisionSettings: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Settings applied at creation, e.g. {'MinecraftModule.Java.MaxHeapSizeMB':'8192','MinecraftModule.Minecraft.PortNumber':'25565'}.",
          ),
        startOnBoot: z.boolean().optional().describe("Start this instance when AMP starts. Default false."),
      },
    },
    withTrace(
      log,
      "amp_create_instance",
      async ({ module, instanceName, friendlyName, port, ipBinding, provisionSettings, startOnBoot }) =>
        amp.withController(async (c) => {
          const targets = await c.ADSModule.GetInstances();
          const target = targets[0];
          if (!target) throw new Error("No AMP target found on this controller.");
          const existing = targets.flatMap((t) => t.AvailableInstances);
          if (existing.some((i) => i.InstanceName.toLowerCase() === instanceName.toLowerCase())) {
            throw new Error(`An instance named '${instanceName}' already exists.`);
          }
          const newId = randomUUID();
          const task = await c.ADSModule.CreateInstance(
            target.InstanceId,
            newId as any,
            module,
            instanceName,
            friendlyName ?? instanceName,
            ipBinding ?? "0.0.0.0",
            port,
            "admin",
            randomBytes(24).toString("base64url"),
            provisionSettings ?? {},
            true,
            0,
            startOnBoot ?? false,
            "",
            1,
          );
          // Creation is asynchronous: wait for the instance to appear and come up.
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline) {
            await sleep(3000);
            const found = (await c.ADSModule.GetInstances())
              .flatMap((t) => t.AvailableInstances)
              .find((i) => i.InstanceID === newId);
            if (found?.Running) {
              return jsonContent({ ok: true, InstanceID: newId, InstanceName: instanceName, panelPort: port });
            }
          }
          return jsonContent({
            ok: false,
            InstanceID: newId,
            note: "Instance creation did not finish within 2 minutes; check amp_list_instances.",
            task,
          });
        }),
    ),
  );

  server.registerTool(
    "amp_set_settings",
    {
      title: "Set instance settings",
      description:
        "Change one or more AMP settings on an instance. Use amp_get_settings to find node names and allowed values; for enum settings pass the option KEY (e.g. ServerType Forge = '50'). " +
        "Settings marked RequiresRestart take effect on the next game-server start.",
      inputSchema: {
        instanceId,
        settings: z
          .record(z.string(), z.string())
          .describe("Map of setting node to new value, e.g. {'MinecraftModule.Game.Difficulty':'2'}."),
      },
    },
    withTrace(log, "amp_set_settings", async ({ instanceId, settings }) =>
      amp.withInstance(instanceId, async (inst) => {
        const results: Record<string, unknown> = {};
        for (const [node, value] of Object.entries(settings)) {
          try {
            const r = await inst.Core.SetConfig(node, value);
            results[node] = r.Status ? "ok" : `failed: ${r.Reason ?? "unknown reason"}`;
          } catch (err) {
            results[node] = `error: ${(err as Error).message.split("\n")[0]}`;
          }
        }
        return jsonContent(results);
      }),
    ),
  );

  server.registerTool(
    "amp_install_server_pack",
    {
      title: "Install server pack from URL",
      description:
        "Download a file (typically a modpack server-pack .zip) from a URL into an instance's game directory, optionally extract it there, and delete the archive. " +
        "Waits for the download and extraction to finish (up to `waitSeconds`). Install the mod loader first (amp_set_settings + amp_update_application); " +
        "the pack's own installer/run scripts are not needed under AMP. Check the result with amp_list_files.",
      inputSchema: {
        instanceId,
        url: z.string().url().describe("Direct download URL of the file (http/https)."),
        targetDirectory: z.string().optional().describe("Directory relative to the instance root. Default: root."),
        extract: z.boolean().optional().describe("Extract the archive after downloading. Default true."),
        deleteArchive: z.boolean().optional().describe("Delete the archive after extracting. Default true."),
        waitSeconds: z.number().int().positive().max(1800).optional().describe("Max seconds to wait per step. Default 900."),
      },
    },
    withTrace(log, "amp_install_server_pack", async ({ instanceId, url, targetDirectory, extract, deleteArchive, waitSeconds }) =>
      amp.withInstance(instanceId, async (inst) => {
        if (!/^https?:$/.test(new URL(url).protocol)) throw new Error("Only http(s) URLs are supported.");
        const dir = (targetDirectory ?? "").replace(/^\/+|\/+$/g, "");
        const fileName = fileNameFromUrl(url);
        if (!fileName) throw new Error("Could not determine a file name from the URL.");
        let archivePath = dir ? `${dir}/${fileName}` : fileName;
        const waitMs = (waitSeconds ?? 900) * 1000;
        const steps: string[] = [];

        // AMP refuses to download into a directory that doesn't exist.
        if (dir) {
          let cur = "";
          for (const part of dir.split("/")) {
            const parent = cur;
            cur = cur ? `${cur}/${part}` : part;
            const entries = await inst.FileManagerPlugin.GetDirectoryListing(parent);
            if (!entries.some((e: any) => e.IsDirectory && e.Filename === part)) {
              const r = await inst.FileManagerPlugin.CreateDirectory(cur);
              if (r && (r as any).Status === false) throw new Error(`Could not create ${cur}: ${(r as any).Reason}`);
              steps.push(`created ${cur}/`);
            }
          }
        }

        const dl = await inst.FileManagerPlugin.DownloadFileFromURL(url as any, dir);
        if (dl && (dl as any).Status === false) throw new Error(`Download refused: ${(dl as any).Reason}`);
        if (!(await waitForTasks(inst, /download/i, waitMs))) {
          return jsonContent({ ok: false, steps, note: "Download still running; poll amp_get_running_tasks. Extraction was not attempted." });
        }
        const listing = await inst.FileManagerPlugin.GetDirectoryListing(dir);
        const file = listing.find((e: any) => e.Filename === fileName);
        if (!file) throw new Error(`Download finished but ${archivePath} was not found; check amp_get_console_output.`);
        steps.push(`downloaded ${archivePath} (${file.SizeBytes} bytes)`);

        if (extract ?? true) {
          // AMP decides by extension and only extracts .zip.
          if (!/\.zip$/i.test(fileName)) {
            const zipName = `${fileName}.zip`;
            const rn = await inst.FileManagerPlugin.RenameFile(archivePath, zipName);
            if (rn && (rn as any).Status === false) throw new Error(`Could not rename to ${zipName}: ${(rn as any).Reason}`);
            archivePath = dir ? `${dir}/${zipName}` : zipName;
            steps.push(`renamed to ${zipName} so AMP will extract it`);
          }
          const ex = await inst.FileManagerPlugin.ExtractArchive(archivePath, dir);
          if (ex && (ex as any).Status === false) throw new Error(`Extract failed: ${(ex as any).Reason}`);
          if (!(await waitForTasks(inst, /extract|decompress|unzip/i, waitMs))) {
            return jsonContent({ ok: false, steps, note: "Extraction still running; poll amp_get_running_tasks." });
          }
          steps.push(`extracted into ${dir || "(root)"}`);
          if (deleteArchive ?? true) {
            await inst.FileManagerPlugin.TrashFile(archivePath);
            steps.push(`moved ${archivePath} to trash`);
          }
        }
        const after = await inst.FileManagerPlugin.GetDirectoryListing(dir);
        return jsonContent({ ok: true, steps, contents: after.map((e: any) => e.Filename + (e.IsDirectory ? "/" : "")) });
      }),
    ),
  );

  server.registerTool(
    "amp_accept_minecraft_eula",
    {
      title: "Accept Minecraft EULA",
      description:
        "Accept the Minecraft EULA (https://aka.ms/MinecraftEULA) for a Minecraft instance so the server can start. Only call this when the user has asked to run the server.",
      inputSchema: { instanceId },
    },
    withTrace(log, "amp_accept_minecraft_eula", async ({ instanceId }) =>
      amp.withInstance(instanceId, async (inst) => {
        const mc = (inst as CommonAPI & { MinecraftModule?: MinecraftModule }).MinecraftModule;
        if (!mc) throw new Error("This instance is not a Minecraft instance.");
        return jsonContent({ accepted: await mc.AcceptEULA() });
      }),
    ),
  );

  server.registerTool(
    "amp_start_game_server",
    {
      title: "Start game server",
      description:
        "Start the game server inside an instance (amp_start_instance only starts the instance's AMP process). " +
        "Optionally waits until the server reports Ready. Modded Minecraft can take several minutes on first boot.",
      inputSchema: {
        instanceId,
        waitSeconds: z.number().int().nonnegative().max(1800).optional().describe("Seconds to wait for Ready. 0 = don't wait. Default 600."),
      },
    },
    withTrace(log, "amp_start_game_server", async ({ instanceId, waitSeconds }) =>
      amp.withInstance(instanceId, async (inst) => {
        const r = await inst.Core.Start();
        if (r && (r as any).Status === false) throw new Error(`Start refused: ${(r as any).Reason}`);
        const started = Date.now();
        const deadline = started + (waitSeconds ?? 600) * 1000;
        let state = -1;
        while (Date.now() < deadline) {
          await sleep(5000);
          state = (await inst.Core.GetStatus()).State as number;
          if (state === 20) return jsonContent({ ok: true, state: lookupState(state) });
          // 80 AwaitingUserInput (e.g. EULA not accepted), >=100 failed;
          // 0 Stopped only counts once startup has had time to begin.
          if (state === 80 || state >= 100 || (state === 0 && Date.now() - started > 30_000)) break;
        }
        const mc = (inst as CommonAPI & { MinecraftModule?: MinecraftModule }).MinecraftModule;
        const failed = state === 0 || state >= 100;
        const reason = failed ? await mc?.GetFailureReason().catch(() => undefined) : undefined;
        return jsonContent({
          ok: false,
          state: lookupState(state as any) ?? state,
          ...(reason ? { failureReason: reason } : {}),
          note:
            state === 80
              ? "Server is waiting for user input; for Minecraft this usually means the EULA must be accepted (amp_accept_minecraft_eula)."
              : waitSeconds === 0
                ? "Not waiting; poll amp_get_instance_status."
                : "Not Ready yet; check amp_get_console_output and amp_get_instance_status.",
        });
      }),
    ),
  );
}
