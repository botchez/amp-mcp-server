// Smoke test for the stdio transport.
//
// Spawns `node dist/index.js` with no MCP_TRANSPORT (so it defaults to stdio),
// runs the MCP handshake, lists tools, and calls amp_list_instances.
//
// Requires the same AMP_URL / AMP_USERNAME / AMP_PASSWORD env vars in the
// parent shell that the production server needs.
//
// Usage (from project root):
//   node scripts/smoke-stdio.mjs

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const required = ["AMP_URL", "AMP_USERNAME", "AMP_PASSWORD"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`smoke-stdio: missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: {
    PATH: process.env.PATH ?? "",
    AMP_URL: process.env.AMP_URL,
    AMP_USERNAME: process.env.AMP_USERNAME,
    AMP_PASSWORD: process.env.AMP_PASSWORD,
    LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  },
  stderr: "inherit",
});

const client = new Client({ name: "amp-mcp-smoke-stdio", version: "0.0.1" });

try {
  console.error("[smoke] connecting via stdio...");
  await client.connect(transport);

  console.error("[smoke] listing tools...");
  const tools = await client.listTools();
  console.error(`[smoke] tools (${tools.tools.length}):`);
  for (const t of tools.tools) console.error(`  - ${t.name}`);

  console.error("[smoke] calling amp_list_instances...");
  const result = await client.callTool({ name: "amp_list_instances", arguments: {} });
  if (result.isError) {
    console.error("[smoke] amp_list_instances returned an error:");
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const text = result.content?.[0]?.text ?? "";
  const parsed = JSON.parse(text);
  console.error(`[smoke] got ${parsed.length} instance(s):`);
  for (const inst of parsed) {
    console.error(`  - ${inst.FriendlyName} [${inst.Module}] ${inst.AppState}`);
  }

  console.error("[smoke] OK");
} catch (err) {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
