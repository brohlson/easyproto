import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";
import type { ChatAccountState } from "../shared/chat";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const tokenEndpoint = issuer + "/api/accounts/oauth/token";
const planScope = "chatgpt.tokens.use.direct";
const scope = "openid profile email offline_access resource.invoke " + planScope;
const callbackPath = "/auth/callback";
const clientId = z.string().regex(/^oaiapp_[\w-]{1,240}$/);
const tokenText = z.string().min(1).max(24_000);
const tokenReply = z.object({
  access_token: tokenText,
  refresh_token: tokenText.optional(),
  id_token: tokenText.optional(),
  expires_in: z.number().int().positive().max(31_536_000),
  token_type: z.string().regex(/^bearer$/i),
  scope: z.string().max(4096).optional(),
});
const credentials = z.object({
  access: tokenText,
  refresh: tokenText.optional(),
  expiry: z.number().int().positive(),
  scopes: z.array(z.string().max(120)).max(80),
});
const savedRecord = z.object({
  host: z.uuid(),
  registration: z
    .object({
      client: clientId,
      identity: z
        .object({ subject: z.string().min(1).max(512), email: z.string().max(320).optional() })
        .optional(),
      tokens: credentials.optional(),
      welcomed: z.boolean().optional(),
    })
    .optional(),
});
type Record = z.infer<typeof savedRecord>;
type Credentials = z.infer<typeof credentials>;

type Vault = { load(): Promise<string | undefined>; save(value: string): Promise<void> };
type Task = "connecting" | "signing-out";

function takesPlan(tokens: Credentials | undefined) {
  return tokens?.scopes.includes(planScope) && tokens.scopes.includes("resource.invoke");
}

function callbackMessage(response: ServerResponse, status: number, text: string) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(text);
}

async function authorize(
  host: string,
  client: string | undefined,
  reconsent: boolean,
  open: (url: string) => Promise<void>,
  signal: AbortSignal,
) {
  const [state, nonce, verifier] = Array.from({ length: 3 }, () =>
    randomBytes(32).toString("base64url"),
  );
  let origin = "";
  let settle!: (result: { code: string; client: string; response: ServerResponse } | Error) => void;
  const result = new Promise<Parameters<typeof settle>[0]>((resolve) => {
    settle = resolve;
  });
  let consumed = false;
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 15_000 },
    (request, response) => {
      const raw = request.url ?? "";
      if (
        request.method !== "GET" ||
        request.headers.host !== new URL(origin).host ||
        !raw.startsWith("/") ||
        raw.startsWith("//")
      )
        return callbackMessage(response, 400, "Invalid callback.");
      let url: URL;
      try {
        url = new URL(raw, origin);
      } catch {
        return callbackMessage(response, 400, "Invalid callback.");
      }
      if (url.origin !== origin || url.pathname !== callbackPath)
        return callbackMessage(response, 404, "Page unavailable.");
      const query = url.searchParams;
      if (consumed || query.getAll("state").length !== 1 || query.get("state") !== state)
        return callbackMessage(response, 400, "This sign-in attempt does not match.");
      consumed = true;
      if (query.has("error")) {
        callbackMessage(response, 400, "Authorization did not complete. Return to Easy Proto.");
        settle(new Error("ChatGPT sign-in was declined or unavailable."));
        return;
      }
      const issued = query.get("client_id") ?? client;
      const id = clientId.safeParse(issued);
      const code = query.get("code");
      if (
        !id.success ||
        (client && id.data !== client) ||
        query.getAll("client_id").length > 1 ||
        query.getAll("code").length !== 1 ||
        !code ||
        code.length > 4096
      ) {
        callbackMessage(
          response,
          400,
          "The sign-in response was incomplete. Return to Easy Proto.",
        );
        settle(new Error("ChatGPT returned an incomplete sign-in response."));
        return;
      }
      settle({ code, client: id.data, response });
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("Could not start the sign-in callback."));
      origin = "http://127.0.0.1:" + address.port;
      resolve();
    });
  });

  const cancel = () => settle(new Error("ChatGPT sign-in was cancelled or timed out."));
  signal.addEventListener("abort", cancel, { once: true });
  return {
    async receive() {
      signal.throwIfAborted();
      const redirect = origin + callbackPath;
      const url = new URL(issuer + "/api/accounts/authorize");
      url.search = new URLSearchParams({
        client_id: client ?? "dynamic_agent_client",
        response_type: "code",
        redirect_uri: redirect,
        scope,
        resource,
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        ext_agent_host_id: "urn:uuid:" + host,
      }).toString();
      if (!client) url.searchParams.set("agent_name_hint", "Easy Proto");
      if (reconsent) url.searchParams.set("prompt", "consent");
      await open(url.href);
      const outcome = await result;
      if (outcome instanceof Error) throw outcome;
      return { ...outcome, redirect, verifier, nonce };
    },
    close() {
      signal.removeEventListener("abort", cancel);
      server.close();
      server.closeAllConnections();
    },
  };
}

export class ChatGPTAccount {
  #record: Record;
  #task?: Task;
  #writes = Promise.resolve();
  #blocked = false;
  #attempt?: AbortController;
  #refresh?: Promise<Credentials>;
  #note?: string;
  readonly #keys: ReturnType<typeof createRemoteJWKSet>;

  private constructor(
    record: Record,
    private readonly vault: Vault,
    private readonly request: typeof fetch,
  ) {
    this.#record = record;
    this.#keys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks.json"), {
      timeoutDuration: 8000,
      [customFetch]: (url, options) => this.request(url, { ...options, redirect: "error" }),
    });
  }

  static async load(vault: Vault, request: typeof fetch = fetch, host: string = randomUUID()) {
    const raw = await vault.load();
    return new ChatGPTAccount(raw ? savedRecord.parse(JSON.parse(raw)) : { host }, vault, request);
  }

  get enabled() {
    return !this.#blocked && !this.#task && Boolean(takesPlan(this.#record.registration?.tokens));
  }

  get status(): Omit<ChatAccountState, "available"> {
    const current = this.#record.registration;
    return {
      connected: Boolean(current?.tokens),
      plan: !this.#blocked && Boolean(takesPlan(current?.tokens)),
      email: current?.tokens ? current.identity?.email : undefined,
      welcome: Boolean(takesPlan(current?.tokens) && !current?.welcomed),
      pending: this.#task,
      message: this.#note,
    };
  }

  #save(update: (record: Record) => Record) {
    const write = this.#writes.then(async () => {
      const next = update(this.#record);
      await this.vault.save(JSON.stringify(next));
      this.#record = next;
    });
    this.#writes = write.catch(() => undefined);
    return write;
  }

  async signIn(open: (url: string) => Promise<void>, verifyRuntime?: () => Promise<void>) {
    if (this.#task) throw new Error("A ChatGPT account action is already running.");
    if (this.#blocked) throw new Error("Finish disconnecting the existing ChatGPT account first.");
    if (this.enabled) return;
    this.#task = "connecting";
    this.#note = undefined;
    const controller = new AbortController();
    this.#attempt = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5 * 60_000)]);
    let listener: Awaited<ReturnType<typeof authorize>> | undefined;
    let browser: ServerResponse | undefined;
    try {
      await verifyRuntime?.();
      signal.throwIfAborted();
      const previous = this.#record.registration;
      await this.#save((record) => record);
      listener = await authorize(
        this.#record.host,
        previous?.client,
        Boolean(previous?.tokens),
        open,
        signal,
      );
      const callback = await listener.receive();
      browser = callback.response;
      if (!previous)
        await this.#save((record) => ({ ...record, registration: { client: callback.client } }));
      const data = await this.#exchange(
        {
          grant_type: "authorization_code",
          client_id: callback.client,
          code: callback.code,
          code_verifier: callback.verifier,
          redirect_uri: callback.redirect,
          resource,
        },
        signal,
      );
      if (!data.id_token) throw new Error("ChatGPT did not verify the account.");
      const { payload } = await jwtVerify(data.id_token, this.#keys, {
        issuer,
        audience: callback.client,
        requiredClaims: ["sub", "iat", "exp", "nonce"],
        clockTolerance: 5,
      });
      const subject = payload.sub;
      if (
        payload.nonce !== callback.nonce ||
        !subject ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== callback.client)
      )
        throw new Error("ChatGPT did not verify the account.");
      if (previous?.identity && previous.identity.subject !== subject)
        throw new Error("Continue with the ChatGPT account previously connected to Easy Proto.");
      signal.throwIfAborted();
      const tokens = this.#tokens(data);
      await this.#save((record) => ({
        ...record,
        registration: {
          client: callback.client,
          identity: {
            subject,
            email: typeof payload.email === "string" ? payload.email.slice(0, 320) : undefined,
          },
          tokens,
          welcomed: previous?.welcomed,
        },
      }));
      if (!takesPlan(tokens)) this.#note = "Enable ChatGPT plan usage to send Codex messages.";
      callbackMessage(browser, 200, "ChatGPT sign-in completed. Return to Easy Proto.");
    } catch (error) {
      if (browser)
        callbackMessage(browser, 400, "ChatGPT sign-in could not complete. Return to Easy Proto.");
      if (signal.aborted) throw new Error("ChatGPT sign-in was cancelled or timed out.");
      if (error instanceof Error && error.constructor === Error) throw error;
      throw new Error("ChatGPT sign-in could not be verified. Try again.");
    } finally {
      listener?.close();
      this.#attempt = undefined;
      this.#task = undefined;
    }
  }

  cancelSignIn() {
    this.#attempt?.abort();
  }

  async #exchange(fields: { [field: string]: string }, signal: AbortSignal) {
    const response = await this.request(tokenEndpoint, {
      method: "POST",
      body: new URLSearchParams(fields),
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(10_000), signal]),
    });
    if (!response.ok) throw new Error("ChatGPT did not accept this authorization. Sign in again.");
    return tokenReply.parse(await response.json());
  }

  #tokens(data: z.infer<typeof tokenReply>, previous?: Credentials): Credentials {
    return credentials.parse({
      access: data.access_token,
      refresh: data.refresh_token ?? previous?.refresh,
      expiry: Date.now() + data.expires_in * 1000,
      scopes:
        data.scope !== undefined
          ? data.scope.trim().split(/\s+/).filter(Boolean)
          : (previous?.scopes ?? []),
    });
  }

  async #renew() {
    const current = this.#record.registration;
    if (!current?.tokens?.refresh) throw new Error("Sign in with ChatGPT again to continue.");
    const data = await this.#exchange(
      {
        grant_type: "refresh_token",
        client_id: current.client,
        refresh_token: current.tokens.refresh,
        resource,
      },
      AbortSignal.timeout(10_000),
    );
    const tokens = this.#tokens(data, current.tokens);
    await this.#save((record) => ({
      ...record,
      registration: { ...record.registration!, tokens },
    }));
    return tokens;
  }

  async provider(signal: AbortSignal) {
    if (!this.enabled) throw new Error("Enable ChatGPT plan usage first.");
    let tokens = this.#record.registration!.tokens!;
    if (Date.now() + 90_000 >= tokens.expiry) {
      this.#refresh ??= this.#renew().finally(() => {
        this.#refresh = undefined;
      });
      tokens = await this.#refresh;
    }
    signal.throwIfAborted();
    if (!this.enabled || !takesPlan(tokens)) throw new Error("Enable ChatGPT plan usage first.");
    const response = await this.request(resource + "/models", {
      headers: { Authorization: "Bearer " + tokens.access },
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (response.status === 401 || response.status === 403)
      throw new Error("ChatGPT plan access expired. Sign out and connect again.");
    if (!response.ok) throw new Error("ChatGPT models are temporarily unavailable.");
    const catalog = z
      .object({
        models: z.array(
          z.object({ slug: z.string().regex(/^[\w.-]{1,80}$/), visibility: z.string() }),
        ),
      })
      .parse(await response.json());
    const visible = catalog.models.filter(({ visibility }) => visibility === "list");
    const model = visible.find(({ slug }) => slug === "gpt-5.4-mini") ?? visible[0];
    if (!model) throw new Error("No eligible models are available on this ChatGPT plan.");
    signal.throwIfAborted();
    if (!this.enabled) throw new Error("ChatGPT is disconnected.");
    return { key: tokens.access, model: model.slug, baseUrl: resource };
  }

  async welcomeSeen() {
    if (!this.#task && this.status.welcome)
      await this.#save((record) => ({
        ...record,
        registration: { ...record.registration!, welcomed: true },
      }));
  }

  async signOut() {
    if (this.#task) throw new Error("A ChatGPT account action is already running.");
    this.#task = "signing-out";
    this.#blocked = true;
    this.#note = undefined;
    try {
      await this.#refresh?.catch(() => undefined);
      const current = this.#record.registration;
      if (current?.tokens?.refresh && !(await this.#revoke(current.client, current.tokens.refresh)))
        this.#note =
          "Disconnected from Easy Proto. Manage usage to disconnect any remaining ChatGPT session.";
      if (current?.tokens)
        await this.#save((record) => ({
          ...record,
          registration: { ...record.registration!, tokens: undefined },
        }));
      this.#blocked = false;
    } finally {
      this.#task = undefined;
    }
  }

  async #revoke(client: string, refresh: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const metadata = await this.request(issuer + "/.well-known/openid-configuration", {
          redirect: "error",
          signal: AbortSignal.timeout(4000),
        });
        if (!metadata.ok) continue;
        const url = new URL((await metadata.json()).revocation_endpoint);
        if (url.origin !== issuer || url.username || url.password || url.hash) return false;
        const result = await this.request(url, {
          method: "POST",
          body: new URLSearchParams({
            token: refresh,
            token_type_hint: "refresh_token",
            client_id: client,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(4000),
        });
        if (result.ok) return true;
        if (result.status < 500) return false;
      } catch {
        // Retry the renewable-session revocation before clearing local credentials.
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
  }
}
