import { z } from "zod";

export const agentKind = z.enum(["codex", "claude"]);
export const agentName = z.string().trim().min(1).max(42);
export const agentId = z.string().uuid();
export const agentKey = z
  .string()
  .trim()
  .min(8)
  .max(256)
  .regex(/^[!-~]+$/);

export const agentAction = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({
    action: z.literal("connect"),
    id: agentId.optional(),
    kind: agentKind,
    name: agentName,
    key: agentKey.optional(),
  }),
  z.strictObject({ action: z.literal("rename"), id: agentId, name: agentName }),
  z.strictObject({ action: z.literal("disconnect"), id: agentId }),
  z.strictObject({ action: z.literal("usage"), id: agentId }),
  z.strictObject({ action: z.literal("welcome"), id: agentId }),
]);

export type AgentAction = z.infer<typeof agentAction>;
export type AgentKind = z.infer<typeof agentKind>;
export type AgentProfile = {
  id: string;
  name: string;
  kind: AgentKind;
  state: "connected" | "reconnect" | "runtime-unavailable";
  account?: string;
  welcome?: boolean;
  message?: string;
};
export type AgentProfilesState = {
  profiles: AgentProfile[];
  codexInstalled: boolean;
  claudeInstalled: boolean;
  message?: string;
};
