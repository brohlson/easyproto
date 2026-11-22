# Architecture baseline

## Product

A macOS-first personal desktop app presents real HTML/CSS documents as artboards on an infinite canvas. A local coding agent uses MCP to create, inspect, capture, and revise them. Projects are portable folders on disk. Future sharing publishes read-only snapshots.

## Initial choices

| Area | Baseline |
| --- | --- |
| Desktop | Electron |
| UI | React, TypeScript, Vite |
| Canvas | React Flow behind an application-owned model |
| Artboards | Sandboxed HTML/CSS documents with local assets |
| Domain | Single serialized document command service, shared by UI and MCP |
| Storage | Versioned JSON manifest, HTML/CSS, assets, recovery history |
| MCP | Official TypeScript SDK; initial local transport selected for the actual coding agent |
| Capture | Same Chromium engine and controlled viewport/settings as preview |
| Packaging | Electron Forge |
| Future publishing | Cloudflare Worker, R2, read-only browser viewer |

## Boundaries

The trusted desktop backend owns filesystem operations, document commits, MCP authority, and capture orchestration. The UI uses a narrow bridge. Mockup content has no privileged application bridge. The preview asset handler resolves only authorized project assets. Both UI and MCP mutations pass through the same command service.

Canvas camera changes scale the presentation. Artboard width/height change the browser viewport and responsive layout. Keep transient camera/selection state separate from document history.

## Mutation contract

Use an application-level envelope containing `projectId`, `commandId`, `expectedRevision`, `operation`, and `arguments`. Persist the command outcome with its commit so a lost-reply retry can return the same result. Reject reuse of a command ID with different arguments. Define retention explicitly; never claim unbounded deduplication if records are pruned.

Distinguish committed, rendered, captured, conflicted, and failed outcomes. Capture and cache identities include source revision, viewport, referenced assets, and relevant renderer settings. Do not expose protocol transport sessions as the application's durable document identity.

## Persistence decision to resolve in Milestone 1

Choose a journal with explicit replay/rollback, or staged immutable revisions published through an atomic manifest pointer. Temporary-file-and-rename per file is insufficient for a multi-file command. Document the commit point, acknowledgement rule, recovery actions, and supported durability claims. Process-kill tests do not by themselves prove protection against every power-loss scenario.

## Scope boundaries

The first product supports arranging, resizing, duplicating, and previewing artboards. The agent edits their HTML/CSS. Arbitrary JavaScript, React/npm builds inside mockups, element-level visual layout editing, cloud sync, and collaboration each require an explicit later design decision.

## Open implementation choices

- Coding-agent runner and its supported local MCP transport/version.
- Project working name and eventual repository location.
- Durable commit strategy and command deduplication retention.
- Asset URL/origin design and export rewriting.
- Supported macOS/architecture matrix and measured performance workload.


## Easy Proto desktop slice

The project now uses the design recorded in [project commits](decisions/0002-project-commits.md) and [preview and MCP isolation](decisions/0003-preview-and-mcp.md). The desktop launches from the Vite build with Electron. Electron Forge packaging stays in Milestone 4. See the [current handoff](handoff.md) for verification and remaining gates.

## External agents

External agents use the authenticated loopback MCP endpoint to read, edit, and capture the active project. The client owns provider configuration, conversations, and tool approval. The desktop owns the canvas and the shared project command service.

## Browser sharing

The [browser sharing architecture](web-sharing-architecture.md) uses immutable read-only snapshots and distinguishes publisher sign-in from guest-link access. The [local prototype](../apps/web/README.md) uses React and TanStack Router. Its Node server retains access control for canvas and individual artboard links, device frames, magic-link sign-in, and revocation. The Electron and web applications live in `apps/desktop/` and `apps/web/`. Shared UI and Inter assets live in `packages/ui/`. The applications use one pnpm workspace, lockfile, and TypeScript base configuration.
