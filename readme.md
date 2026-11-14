# Easy Proto

Easy Proto is a macOS desktop canvas for reviewing HTML/CSS mockups made by a coding agent. Each artboard has its own browser viewport. Pan and zoom to compare boards, select one by clicking it, and move it by dragging or pressing the arrow keys after selection. Drag the selected artboard’s bottom-right handle to resize its HTML viewport. With the resize handle focused, use arrow keys to change its dimensions or Shift + arrow for larger steps. Use **Appearance** to choose System, Light, or Dark for the desktop.

## Install and run

Use Node 24.16.0 and pnpm 10.33.4. The following commands use nvm and Corepack to select the pinned versions.

```sh
nvm install
nvm use
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm exec install-electron --no
pnpm dev
```

The runtime installer comes from the pinned Electron npm package and fetches the matching official Electron release. `pnpm dev` builds and launches the development app. Rebuild or rerun it after source changes. For a build already on disk, use `pnpm start`.

Choose **New Project** in the toolbar, then create a folder in the macOS picker or select an existing empty folder. Choose **Open Project** and select a folder containing an Easy Proto project to reopen it. The toolbar shows the current folder and saved revision.

You can also launch with a chosen folder using `pnpm start "--project=$PWD/My prototype"` after building. Choose a new empty folder or an existing project. Without a path, the app reopens its default Untitled project in Electron's local app-data folder. Every successful move or MCP mutation saves automatically. Quit and reopen with the same path. Copy the entire folder, including `.easy-proto` and `assets`, to move the project.

## Connect Codex

In the same shell that will launch Codex, create a random token and save the non-secret configuration. The token stays in the shell environment.

```sh
export EASY_PROTO_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
codex mcp add easy-proto --url http://127.0.0.1:38645/mcp --bearer-token-env-var EASY_PROTO_TOKEN
pnpm build
pnpm start "--project=$PWD/My prototype" &
codex
```

The app must be running before Codex connects. Restart the client if it was already open. Approve Easy Proto tool calls when Codex prompts. Set `EASY_PROTO_PORT` and update the configured URL together to change the port. With no token, the desktop opens without an MCP endpoint. [Codex MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Ask Codex to get the Easy Proto context, create a 480 × 320 artboard next to the starter at canvas coordinates (620, 0), then capture it. Ask it to change the title and background and capture the new revision. Use **Fit View** to bring both boards into view. Drag a board and confirm the header shows the new saved revision. Quit and reopen using the same folder.

- `get_context` returns the current project ID, activation ID, revision and layouts. Include both `projectId` and `activationId` in every other tool call. Call `get_context` again after a project switch, reopen or restart. The same MCP connection can discover the newly selected project.
- `get_artboard` takes `projectId` and `artboardId` and returns source plus metadata.
- `create_artboard` takes `projectId`, a new UUID `commandId`, `expectedRevision` and `arguments` containing `name`, `x`, `y`, `width`, `height`, `html` and `css`.
- `update_artboard` takes the same envelope with `arguments: { artboardId, patch }`. Supply any subset of the layout and source fields.
- `capture_artboard` takes `projectId`, `artboardId` and the current `revision`. It returns PNG image content and metadata, including unresolved resources when present.

Place PNG, JPEG, GIF, WebP, AVIF, WOFF or WOFF2 files under the project's `assets/` folder before opening it. Reference them like `assets/logo.png` in HTML or CSS. Reopen after changing assets. Use the HTML and CSS tool arguments to update source. The [persistence decision](docs/decisions/0002-project-commits.md) explains retry and recovery behavior.

## Verify

Run `pnpm fmt` to format TypeScript and JavaScript with Oxfmt. Use `pnpm fmt:check` to check formatting and `pnpm lint` to run Oxlint. The full verification command includes both checks.

```sh
EASY_PROTO_EVIDENCE="$PWD/evidence" pnpm verify
```

The check launches Electron and a real SDK Streamable HTTP client on disposable local ports. Existing projects are outside the test scope. The command also checks interrupted saves and that switching projects revokes access through the old MCP activation, including across folder copies that share a project ID. See the [handoff](docs/handoff.md) and [review workflow](agents/codex-review.md).
