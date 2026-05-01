import { z } from "zod";

export const writesEnabled = (): boolean => process.env.AMP_ALLOW_WRITES === "true";

export const instanceIdField = {
  instanceId: z.string().describe("Instance UUID, as returned by amp_list_instances"),
};

export const jsonContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});
