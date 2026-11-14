import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { boardInput, boardPatch, envelope, id, revision, type Command } from "../shared/model";
import { activityLeaseMs, type ArtboardActivity } from "./activity";
import { Project, ProjectError } from "./project";
import type { Preview } from "./preview";

const host = "127.0.0.1";
const maxBody = 3 * 1024 * 1024;
const projectScope = { projectId: id, activationId: id };

export type ActiveProject = {
  project: Project;
  activationId: string;
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
    const execute = () => project.execute(command);
    const saved =
      command.operation === "update_artboard"
        ? await activity.run(command.arguments.artboardId, execute)
        : await execute();
    if (current()?.project === project) changed();
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
          artboards,
        });
      }),
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
        "Commit a new HTML/CSS artboard. Reuse the same command ID and arguments only when retrying.",
      inputSchema: envelope.extend({ activationId: id, arguments: boardInput }),
    },
    (request) => call(() => commit({ ...request, operation: "create_artboard" })),
  );

  server.registerTool(
    "update_artboard",
    {
      description: "Commit a patch to HTML, CSS or layout at the expected project revision.",
      inputSchema: envelope.extend({
        activationId: id,
        arguments: z.strictObject({ artboardId: id, patch: boardPatch }),
      }),
    },
    (request) => call(() => commit({ ...request, operation: "update_artboard" })),
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
