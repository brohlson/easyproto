import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createArtboardInput,
  artboardUpdate,
  batchUpdateInput,
  projectName,
  envelope,
  guardedUndoInput,
  id,
  revision,
  type Command,
} from "../../shared/model";
import { tokenByteLimit } from "../../shared/token-types";
import { activityLeaseMs, type ArtboardActivity } from "../previews/activity";
import { Project, ProjectError } from "../document/project";
import { reviewSheet, thumbnail } from "../previews/review-sheet";
import type { Preview } from "../previews/preview";

const host = "127.0.0.1";
const maxBody = 3 * 1024 * 1024;
const projectScope = { projectId: id, activationId: id };

export type ActiveProject = {
  project: Project;
  activationId: string;
  activePageId?: string;
  signal: AbortSignal;
  activity: ArtboardActivity;
  retire: () => void;
};

function result(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function tools(
  current: () => ActiveProject | undefined,
  preview: Preview,
  changed: () => void,
  checkWritable: () => void,
) {
  const server = new McpServer({ name: "easy-proto", version: "0.1.0" });
  const scoped = { ...projectScope, artboardId: id };
  function active(projectId: string, activationId: string) {
    const scope = current();
    if (
      !scope ||
      scope.activationId !== activationId ||
      scope.project.snapshot.manifest.projectId !== projectId
    ) {
      throw new ProjectError(
        "PROJECT_SCOPE",
        "The project selection changed. Call get_context for the open project.",
      );
    }
    return scope;
  }

  function getArtboard(projectId: string, activationId: string, artboardId: string) {
    const scope = active(projectId, activationId);
    const snapshot = scope.project.snapshot;
    const board = snapshot.manifest.artboards.find((item) => item.id === artboardId);
    if (!board) throw new ProjectError("ARTBOARD_NOT_FOUND", "The artboard does not exist.");
    return { scope, snapshot, board };
  }

  async function commit({ activationId, ...command }: Command & { activationId: string }) {
    const { project, activity } = active(command.projectId, activationId);
    checkWritable();
    let targets: string[] = [];
    if (command.operation === "update_artboard") targets = [command.arguments.artboardId];
    if (command.operation === "update_artboards")
      targets = command.arguments.updates.map((update) => update.artboardId);
    const beforeRevision = project.snapshot.manifest.revision;
    const saved = await project.execute(
      command,
      targets.length ? () => activity.begin(targets) : undefined,
    );
    if (current()?.project === project) {
      if (
        command.operation === "create_artboard" &&
        saved.revision > beforeRevision &&
        "artboard" in saved
      )
        activity.begin([saved.artboard.id])();
      activity.pruneLeases((id) => project.snapshot.sources.has(id));
      changed();
    }
    if (command.operation === "update_artboards" && "artboard" in saved) {
      const artboards = saved.artboards ?? [saved.artboard];
      return result({
        ...saved,
        artboards,
        changedArtboardIds: artboards.map((board) => board.id),
      });
    }
    return result(saved);
  }

  async function call<T extends CallToolResult>(handler: () => T | Promise<T>) {
    try {
      return await handler();
    } catch (error) {
      const failure =
        error instanceof ProjectError
          ? {
              code: error.code,
              message: error.message,
              ...(error.currentRevision === undefined
                ? {}
                : { currentRevision: error.currentRevision }),
            }
          : { code: "OPERATION_FAILED", message: "Easy Proto could not complete the operation." };
      return { ...result(failure), isError: true };
    }
  }

  server.registerTool(
    "get_context",
    {
      description:
        "Discover the only authorized open project, its current committed revision and artboards.",
      inputSchema: {},
    },
    () =>
      call(() => {
        const scope = current();
        if (!scope) throw new ProjectError("NO_PROJECT", "Open a project in Easy Proto.");
        const { project, activationId } = scope;
        const { schemaVersion, projectId, revision, artboards } = project.snapshot.manifest;
        return result({
          schemaVersion,
          projectId,
          activationId,
          revision,
          name: project.name,
          assetDigest: project.assetDigest,
          tokenDigest: project.snapshot.tokens?.stamp.documentDigest,
          ...project.pageLayout,
          activePageId: project.pageLayout.pages.some((page) => page.id === scope.activePageId)
            ? scope.activePageId
            : project.pageLayout.defaultPageId,
          artboards,
        });
      }),
  );

  server.registerTool(
    "get_tokens",
    {
      description: "Read the committed project-wide DTCG document and generated CSS.",
      inputSchema: projectScope,
    },
    ({ projectId, activationId }) =>
      call(() => result(active(projectId, activationId).project.tokenView)),
  );

  server.registerTool(
    "replace_project_tokens",
    {
      description: "Validate and replace the complete project-wide DTCG token document.",
      inputSchema: envelope.extend({
        activationId: id,
        document: z.string().max(tokenByteLimit),
      }).shape,
    },
    ({ document, ...identity }) =>
      call(() =>
        commit({ ...identity, operation: "replace_project_tokens", arguments: { document } }),
      ),
  );

  server.registerTool(
    "get_artboard",
    {
      description: "Read the current committed HTML, CSS and layout for an artboard.",
      inputSchema: scoped,
    },
    ({ projectId, activationId, artboardId }) =>
      call(() => {
        const { snapshot, board } = getArtboard(projectId, activationId, artboardId);
        return result({
          projectId,
          revision: snapshot.manifest.revision,
          artboard: board,
          ...snapshot.sources.get(board.id),
        });
      }),
  );

  server.registerTool(
    "create_artboard",
    {
      description:
        "Commit a new HTML/CSS artboard on the specified page or the project default. Reuse the same command ID and arguments only when retrying.",
      inputSchema: envelope.extend({ activationId: id, arguments: createArtboardInput }),
    },
    (request) => call(() => commit({ ...request, operation: "create_artboard" })),
  );

  server.registerTool(
    "update_artboard",
    {
      description: "Commit a patch to HTML, CSS or layout at the expected project revision.",
      inputSchema: envelope.extend({
        activationId: id,
        arguments: artboardUpdate,
      }),
    },
    (request) => call(() => commit({ ...request, operation: "update_artboard" })),
  );

  server.registerTool(
    "update_artboards",
    {
      description:
        "Atomically patch up to 50 explicit artboards at one expected project revision. Returns changed IDs and board metadata in document order. One canvas Undo restores the whole batch. Retry with the original command ID and arguments.",
      inputSchema: envelope.extend({ activationId: id, arguments: batchUpdateInput }),
    },
    (request) => call(() => commit({ ...request, operation: "update_artboards" })),
  );

  server.registerTool(
    "undo",
    {
      description:
        "Undo the most recent undoable edit in this project session. Supply its original command ID as arguments.targetCommandId, the current expectedRevision, and a fresh commandId for this undo request.",
      inputSchema: envelope.extend({ activationId: id, arguments: guardedUndoInput }),
    },
    (request) => call(() => commit({ ...request, operation: "undo" })),
  );

  server.registerTool(
    "create_page",
    {
      description:
        "Create a page and return its page ID and committed revision. Use the ID as pageId when creating artboards.",
      inputSchema: envelope.extend({
        activationId: id,
        arguments: z.strictObject({ name: projectName }),
      }),
    },
    (request) => call(() => commit({ ...request, operation: "create_page" })),
  );

  server.registerTool(
    "rename_page",
    {
      description: "Rename a page at the expected project revision.",
      inputSchema: envelope.extend({
        activationId: id,
        arguments: z.strictObject({ pageId: id, name: projectName }),
      }),
    },
    (request) => call(() => commit({ ...request, operation: "rename_page" })),
  );

  server.registerTool(
    "delete_page",
    {
      description:
        "Delete a page and all its artboards in one undoable revision. The final page cannot be deleted.",
      inputSchema: envelope.extend({
        activationId: id,
        arguments: z.strictObject({ pageId: id }),
      }),
    },
    (request) => call(() => commit({ ...request, operation: "delete_page" })),
  );

  server.registerTool(
    "set_artboard_activity",
    {
      description:
        "Show Agent working on an artboard before drafting changes. Generate a UUID for activityId, renew working with the same ID before the lease expires, then send idle with that ID when done. Activity is temporary and does not save a revision.",
      inputSchema: { ...scoped, activityId: id, status: z.enum(["working", "idle"]) },
    },
    ({ projectId, activationId, artboardId, activityId, status }) =>
      call(() => {
        const { scope } = getArtboard(projectId, activationId, artboardId);
        const working = scope.activity.set(artboardId, activityId, status === "working");
        return result({
          artboardId,
          activityId,
          working,
          ...(status === "working" && { expiresInMs: activityLeaseMs }),
        });
      }),
  );

  server.registerTool(
    "capture_artboard",
    {
      description:
        "Capture a PNG of the requested current project revision at the artboard CSS viewport. Reports unresolved render dependencies.",
      inputSchema: { ...scoped, revision },
    },
    (request) =>
      call(async () => {
        const { scope, snapshot, board } = getArtboard(
          request.projectId,
          request.activationId,
          request.artboardId,
        );
        if (snapshot.manifest.revision !== request.revision) {
          throw new ProjectError(
            "REVISION_CONFLICT",
            "Capture requires the current committed revision.",
            snapshot.manifest.revision,
          );
        }
        const { details, png } = await scope.activity
          .run(board.id, () => preview.capture(scope.project, snapshot, board, scope.signal))
          .finally(() => {
            active(request.projectId, request.activationId);
          });
        return {
          structuredContent: details,
          content: [
            { type: "text" as const, text: JSON.stringify(details) },
            { type: "image" as const, mimeType: "image/png", data: png.toString("base64") },
          ],
        };
      }),
  );
  server.registerTool(
    "capture_artboards",
    {
      description:
        "Capture an ordered review sheet of up to 12 artboards at one revision. Reports boards with unresolved fonts or assets. Optionally append full-resolution PNGs in the same order.",
      inputSchema: {
        ...projectScope,
        revision,
        artboardIds: z
          .array(id)
          .min(1)
          .max(12)
          .refine((ids) => new Set(ids).size === ids.length, "Use unique artboard IDs."),
        includeFullResolution: z.boolean().default(false),
      },
    },
    (request) =>
      call(async () => {
        const scope = active(request.projectId, request.activationId);
        const snapshot = scope.project.snapshot;
        if (snapshot.manifest.revision !== request.revision)
          throw new ProjectError(
            "REVISION_CONFLICT",
            "Capture requires the current committed revision.",
            snapshot.manifest.revision,
          );
        const boards = request.artboardIds.map((id) => {
          const board = snapshot.manifest.artboards.find((item) => item.id === id);
          if (!board)
            throw new ProjectError("ARTBOARD_NOT_FOUND", `Artboard ${id} does not exist.`);
          return board;
        });
        const captures = [];
        const tiles = [];
        const warnings = [];
        const originals: CallToolResult["content"] = [];
        let totalBytes = 0;
        const finishActivity = scope.activity.begin(boards.map(({ id }) => id));
        try {
          for (const board of boards) {
            const { details, png } = await preview.capture(
              scope.project,
              snapshot,
              board,
              scope.signal,
            );
            const warning = details.unresolved.length > 0;
            if (warning)
              warnings.push({
                artboardId: board.id,
                name: board.name,
                unresolved: details.unresolved,
              });
            captures.push({ name: board.name, ...details });
            tiles.push({
              name: board.name,
              warning,
              image: thumbnail(png, board.width, board.height),
            });
            if (request.includeFullResolution) {
              totalBytes += png.length;
              if (totalBytes > 8 * 1024 * 1024)
                throw new ProjectError(
                  "CAPTURE_LIMIT",
                  "Full-resolution PNGs exceed 8 MiB. Request fewer originals or omit includeFullResolution.",
                );
              originals.push({
                type: "image",
                mimeType: "image/png",
                data: png.toString("base64"),
              });
            }
          }
          const sheet = await reviewSheet(tiles, scope.signal);
          const data = {
            status: warnings.length ? "captured_with_warnings" : "captured",
            warnings,
            projectId: request.projectId,
            revision: request.revision,
            captures,
          };
          return {
            structuredContent: data,
            content: [
              { type: "text" as const, text: JSON.stringify(data) },
              { type: "image" as const, mimeType: "image/png", data: sheet },
              ...originals,
            ],
          };
        } finally {
          finishActivity();
          active(request.projectId, request.activationId);
        }
      }),
  );
  return server;
}

function jsonError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }));
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maxBody)
      throw new ProjectError("BODY_LIMIT", "Request body exceeds the size limit.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}

export async function listen(
  current: () => ActiveProject | undefined,
  preview: Preview,
  changed: () => void,
  checkWritable: () => void,
  port: number,
  token: string,
) {
  const expectedAuth = Buffer.from("Bearer " + token);
  let authority = "";
  const http = createServer(
    { maxHeaderSize: 16 * 1024, requestTimeout: 10_000, headersTimeout: 5000 },
    (request, response) => {
      void serve(request, response).catch(() => {
        if (!response.headersSent) jsonError(response, 500, "MCP request failed.");
        else if (!response.writableEnded) response.end();
      });
    },
  );
  http.maxConnections = 48;

  async function serve(request: IncomingMessage, response: ServerResponse) {
    const headers = request.headersDistinct;
    if (headers.host?.length !== 1 || headers.host[0] !== authority || headers.origin) {
      jsonError(response, 403, "Unexpected Host or Origin.");
      return;
    }
    const auth = Buffer.from(headers.authorization?.[0] ?? "");
    if (
      headers.authorization?.length !== 1 ||
      auth.length !== expectedAuth.length ||
      !timingSafeEqual(auth, expectedAuth)
    ) {
      jsonError(response, 401, "A valid local bearer token is required.");
      return;
    }
    if (request.url !== "/mcp") {
      jsonError(response, 404, "MCP is available at /mcp.");
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      jsonError(response, 405, "This endpoint supports stateless MCP POST requests.");
      return;
    }
    if (
      request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json"
    ) {
      jsonError(response, 415, "Use application/json.");
      return;
    }
    let body: unknown;
    try {
      body = await readBody(request);
    } catch (error) {
      const over = error instanceof ProjectError && error.code === "BODY_LIMIT";
      if (over) response.setHeader("Connection", "close");
      jsonError(response, over ? 413 : 400, "Invalid or oversized JSON body.");
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = tools(current, preview, changed, checkWritable);
    response.on("close", () => {
      void server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  }

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => {
      const address = http.address();
      if (!address || typeof address === "string") {
        reject(new Error("MCP did not bind to a TCP address."));
        return;
      }
      authority = `${host}:${address.port}`;
      resolve();
    });
  });
  return {
    url: `http://${authority}/mcp`,
    stop: () => {
      http.close();
      http.closeAllConnections();
    },
  };
}
