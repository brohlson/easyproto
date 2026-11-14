# Easy Proto

Easy Proto is a macOS desktop canvas for reviewing HTML/CSS mockups made by a coding agent. Each artboard has its own browser viewport. Pan and zoom to compare boards, select one by clicking it, and move it by dragging or pressing the arrow keys after selection. Click an artboard’s dimensions to choose a phone, tablet, or desktop viewport preset. Scroll or pinch to zoom, and press Shift+0 to fit the canvas. Use **Appearance** to choose System, Light, or Dark for the desktop.

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

Home shows the projects you have created or opened on this device. Click a row to reopen it, or use **Create project** and select an empty folder in the macOS picker. Use **Settings** for **Home**, **Open project…**, and **Appearance**. Use **Open project…** to add an existing project or find a folder that moved.

Double-click the project name or an artboard title to edit it. Enter or clicking away saves, and Escape cancels. You can also focus the name and press Enter to start editing. Project titles travel with their folders. Artboard titles, dimensions, and activity labels stay the same screen size as you zoom.

You can launch straight into a folder with `pnpm start "--project=$PWD/My prototype"` after building. Use an empty folder or an existing project. Without a path, the app starts at Home. Changes save automatically. Copy the entire project folder, including `.easy-proto` and `assets`, to move it.

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

Ask Codex to get the Easy Proto context, create a 480 × 320 artboard next to the starter at canvas coordinates (620, 0), then capture it. Ask it to change the title and background and capture the new revision. Press Shift+0 to bring both boards into view. Drag a board, return Home, and reopen the project to see the saved position.

- `get_context` returns the selected project's name, ID, activation ID, revision and layouts. Home returns `NO_PROJECT` and revokes the previous activation. Include both `projectId` and `activationId` in every other tool call. Call `get_context` again after a project switch, reopen or restart. The same MCP connection can discover the newly selected project.
- `get_artboard` takes `projectId` and `artboardId` and returns source plus metadata.
- `create_artboard` takes `projectId`, a new UUID `commandId`, `expectedRevision` and `arguments` containing `name`, `x`, `y`, `width`, `height`, `html` and `css`.
- `update_artboard` takes the same envelope with `arguments: { artboardId, patch }`. Supply any subset of the layout and source fields.
- `capture_artboard` takes `projectId`, `artboardId` and the current `revision`. It returns PNG image content and metadata, including unresolved resources when present.
- `set_artboard_activity` takes `projectId`, `activationId`, `artboardId`, a caller-generated UUID as `activityId`, and `status` of `working` or `idle`. Send `working` before drafting changes to an existing board. Renew with the same ID before the two-minute lease expires and send `idle` with that ID when done. The tool returns the board's combined `working` state, including other active work.

The canvas shows **Agent working** with three animated dots and gently pulses the affected artboard's opacity during an explicit activity lease or an in-flight MCP update or capture. With reduced motion enabled, the dots stay still and the artboard stays fully opaque. An agent must report activity to cover time spent drafting between calls. Overlapping activities clear independently. Switching projects drops the previous activation's activity, including when reopening the same folder. Activity never changes the project revision, saves to disk, or appears in captured artboard images.

Place PNG, JPEG, GIF, WebP, AVIF, WOFF or WOFF2 files under the project's `assets/` folder before opening it. Reference them like `assets/logo.png` in HTML or CSS. Reopen after changing assets. Use the HTML and CSS tool arguments to update source. The [persistence decision](docs/decisions/0002-project-commits.md) explains retry and recovery behavior.

## Verify

Run `pnpm fmt` to format TypeScript and JavaScript with Oxfmt. Use `pnpm fmt:check` to check formatting and `pnpm lint` to run Oxlint. The full verification command includes both checks.

```sh
EASY_PROTO_EVIDENCE="$PWD/evidence" pnpm verify
```

The check launches Electron and a real SDK Streamable HTTP client on disposable local ports. Existing projects are outside the test scope. The command also checks interrupted saves and that switching projects revokes access through the old MCP activation, including across folder copies that share a project ID. See the [handoff](docs/handoff.md) and [review workflow](agents/codex-review.md).
