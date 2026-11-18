import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  agentId,
  agentKey,
  agentName,
  type AgentAction,
  type AgentProfile,
  type AgentProfilesState,
} from "../shared/agents";
import { ChatGPTAccount } from "./chatgpt";
import { type ChatProvider } from "./chat";
import { proposeProjectChange, qualifyCodex, type CodexSettings } from "./codex";
import { claudeModel, proposeClaude } from "./claude";

export const demoAgentId = "local-demo";
export const keyAgentId = "codex-experiment";
const profileSchema = z.discriminatedUnion("kind", [
  z.object({
    id: agentId,
    name: agentName,
    kind: z.literal("codex"),
    record: z.string().max(160_000),
  }),
  z.object({
    id: agentId,
    name: agentName,
    kind: z.literal("claude"),
    key: agentKey.optional(),
    model: z
      .string()
      .regex(/^[\w.-]{1,120}$/)
      .optional(),
  }),
]);
const documentSchema = z.object({
  version: z.literal(1),
  host: z.uuid(),
  profiles: z.array(profileSchema),
});
const legacySchema = z.object({ host: z.uuid(), registration: z.unknown().optional() });
type Saved = z.infer<typeof profileSchema>;
type Document = z.infer<typeof documentSchema>;
type Store = {
  read(): Promise<string | undefined>;
  write(document: string): Promise<void>;
  legacy?(): Promise<string | undefined>;
  finishMigration?(): Promise<void>;
};
type Options = {
  codex?: string;
  claude?: string;
  demo?: boolean;
  experimental?: CodexSettings;
  open(url: string): Promise<void>;
  verifyCodex?: typeof qualifyCodex;
  request?: typeof fetch;
};

export class AgentProfiles {
  readonly #accounts = new Map<string, ChatGPTAccount>();
  #queue = Promise.resolve();
  #busy = false;
  #cancel?: () => void;
  #document: Document;

  private constructor(
    document: Document,
    private readonly store: Store,
    private readonly options: Options,
  ) {
    this.#document = document;
  }

  static async load(store: Store, options: Options) {
    const raw = await store.read();
    const document: Document = raw
      ? documentSchema.parse(JSON.parse(raw))
      : { version: 1, host: randomUUID(), profiles: [] };
    const legacy = raw ? undefined : await store.legacy?.();
    if (legacy) {
      const previous = legacySchema.parse(JSON.parse(legacy));
      document.host = previous.host;
      if (previous.registration)
        document.profiles.push({ id: randomUUID(), name: "Codex", kind: "codex", record: legacy });
    }
    const registry = new AgentProfiles(document, store, options);
    for (const profile of document.profiles) {
      if (profile.kind === "codex")
        registry.#accounts.set(profile.id, await registry.#openAccount(profile.id, profile.record));
    }
    if (legacy) await store.write(JSON.stringify(document));
    if (raw || legacy) await store.finishMigration?.().catch(() => undefined);
    return registry;
  }

  get defaultAgent() {
    if (this.options.experimental) return keyAgentId;
    if (this.options.demo) return demoAgentId;
    return this.status.profiles.find(({ state }) => state === "connected")?.id;
  }

  get status(): AgentProfilesState {
    const profiles = this.#document.profiles
      .filter(({ kind }) => kind === "codex" || Boolean(this.options.claude))
      .map<AgentProfile>((profile) => {
        if (profile.kind === "claude")
          return {
            id: profile.id,
            name: profile.name,
            kind: "claude",
            state:
              !profile.key || !profile.model
                ? "reconnect"
                : this.options.claude
                  ? "connected"
                  : "runtime-unavailable",
          };
        const status = this.#accounts.get(profile.id)?.status;
        return {
          id: profile.id,
          name: profile.name,
          kind: "codex",
          state: !status?.plan
            ? "reconnect"
            : this.options.codex
              ? "connected"
              : "runtime-unavailable",
          account: status?.email,
          welcome: status?.welcome,
          message: status?.message,
        };
      });
    if (this.options.experimental)
      profiles.push({ id: keyAgentId, name: "Codex · API key", kind: "codex", state: "connected" });
    if (this.options.demo)
      profiles.push({ id: demoAgentId, name: "Local demo", kind: "codex", state: "connected" });
    return {
      profiles,
      codexInstalled: Boolean(this.options.codex),
      claudeInstalled: Boolean(this.options.claude),
    };
  }

  #update(update: (profiles: Saved[]) => Saved[]) {
    const operation = this.#queue.then(async () => {
      const next = { ...this.#document, profiles: update(this.#document.profiles) };
      await this.store.write(JSON.stringify(next));
      this.#document = next;
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  #patch(id: string, update: (profile: Saved) => Saved) {
    return this.#update((profiles) =>
      profiles.map((profile) => (profile.id === id ? update(profile) : profile)),
    );
  }

  #find(id: string) {
    const profile = this.#document.profiles.find((entry) => entry.id === id);
    if (!profile || (profile.kind === "claude" && !this.options.claude))
      throw new Error("That agent is no longer available.");
    return profile;
  }

  async #openAccount(id: string, initial?: string, pending?: (value: string) => void) {
    return ChatGPTAccount.load(
      {
        load: async () => initial,
        save: async (value) => {
          if (this.#document.profiles.some((profile) => profile.id === id))
            await this.#patch(id, (profile) =>
              profile.kind === "codex" ? { ...profile, record: value } : profile,
            );
          else pending?.(value);
        },
      },
      this.options.request,
      this.#document.host,
    );
  }

  cancel() {
    this.#cancel?.();
  }

  async action(input: AgentAction) {
    if (input.action === "status") return this.status;
    if (input.action === "cancel") {
      this.cancel();
      return this.status;
    }
    if (this.#busy) throw new Error("Finish the current agent setup first.");
    this.#busy = true;
    try {
      if (input.action === "connect") {
        await this.#connect(input);
      } else {
        const profile = this.#find(input.id);
        const account = this.#accounts.get(profile.id);
        if (input.action === "rename")
          await this.#patch(input.id, (entry) => ({ ...entry, name: input.name }));
        else if (input.action === "disconnect") {
          if (profile.kind === "claude")
            await this.#patch(input.id, (entry) => ({
              ...entry,
              key: undefined,
              model: undefined,
            }));
          else await account?.signOut();
        } else if (input.action === "welcome") await account?.welcomeSeen();
        else if (input.action === "usage" && profile.kind === "codex")
          await this.options.open("https://chatgpt.com/settings/usage");
      }
      return this.status;
    } finally {
      this.#busy = false;
      this.#cancel = undefined;
    }
  }

  async #connect(input: Extract<AgentAction, { action: "connect" }>) {
    const previous = input.id ? this.#find(input.id) : undefined;
    if (previous && previous.kind !== input.kind)
      throw new Error("Choose the agent’s original provider.");
    const id = previous?.id ?? randomUUID();
    if (input.kind === "claude") {
      if (!this.options.claude)
        throw new Error("Claude is unavailable in this version of Easy Proto.");
      if (!input.key) throw new Error("Enter an Anthropic API key.");
      const lifetime = new AbortController();
      this.#cancel = () => lifetime.abort();
      const model = await claudeModel(input.key, lifetime.signal, this.options.request).catch(
        (error) => {
          if (lifetime.signal.aborted) throw new Error("Connection cancelled.");
          if (error instanceof Error && error.constructor === Error) throw error;
          throw new Error("Could not verify the Anthropic API key.");
        },
      );
      lifetime.signal.throwIfAborted();
      const saved = { id, name: input.name, kind: "claude" as const, key: input.key, model };
      if (previous) await this.#patch(id, () => saved);
      else await this.#update((profiles) => [...profiles, saved]);
      return;
    }
    if (input.key) throw new Error("Use Continue with ChatGPT for Codex.");
    const executable = this.options.codex;
    if (!executable) throw new Error("Install Codex to connect this agent.");
    let record: string | undefined;
    const account =
      this.#accounts.get(id) ??
      (await this.#openAccount(id, undefined, (value) => {
        record = value;
      }));
    this.#cancel = () => account.cancelSignIn();
    try {
      await account.signIn(this.options.open, async () => {
        await (this.options.verifyCodex ?? qualifyCodex)(executable).catch(() => {
          throw new Error("Install a Codex build verified for Easy Proto.");
        });
      });
      if (previous) await this.#patch(id, (entry) => ({ ...entry, name: input.name }));
      else if (record && account.status.connected) {
        const saved = { id, name: input.name, kind: "codex" as const, record };
        await this.#update((profiles) => [...profiles, saved]);
        this.#accounts.set(id, account);
        record = undefined;
      }
    } catch (error) {
      if (!previous && account.status.connected) await account.signOut().catch(() => undefined);
      throw error;
    }
  }

  provider(id: string): ChatProvider | undefined {
    if (id === demoAgentId && this.options.demo) return;
    if (id === keyAgentId && this.options.experimental) {
      const settings = this.options.experimental;
      return {
        backend: "codex",
        runProject: (input, signal) => proposeProjectChange(settings, input, signal),
      };
    }
    const profile = this.#find(id);
    if (profile.kind === "claude" && profile.key && profile.model && this.options.claude) {
      const settings = { executable: this.options.claude, key: profile.key, model: profile.model };
      return { backend: "claude", run: (input, signal) => proposeClaude(settings, input, signal) };
    }
    const executable = this.options.codex;
    const account = this.#accounts.get(id);
    if (profile.kind === "codex" && executable && account?.enabled)
      return {
        backend: "chatgpt",
        runProject: async (input, signal) => {
          const authorized = await account.provider(signal);
          signal.throwIfAborted();
          return proposeProjectChange(
            { ...authorized, executable, credential: "chatgpt" },
            input,
            signal,
          );
        },
      };
    throw new Error("Reconnect this agent from Home before sending a message.");
  }
}
