# Easy Proto

Easy Proto is a macOS desktop canvas for reviewing HTML/CSS mockups made by a coding agent. Each artboard has its own browser viewport. Click an artboard to select it, Shift-click to toggle it in the selection, or drag a box from an empty canvas area to select every artboard it overlaps. Drag or press the arrow keys to move the selection. Use ⌘D to duplicate, ⌘C and ⌘V to copy and paste, and Delete to remove the selected boards. Each edit takes one undo step. Swipe with two fingers, scroll, or hold Space while dragging to pan. Pinch to zoom, and press Shift+0 to fit the canvas. Click an artboard’s dimensions to choose a viewport preset or **Arbitrary size**. Arbitrary size shows a bottom-right handle. Drag it to resize the HTML viewport, or focus it and use the arrow keys for 5 px steps and Shift for 20 px steps. Choosing a preset hides the handle. Use **Appearance** to choose System, Light, or Dark.

Use the current page name beside the project name to switch pages or choose **Add page**. Open a page’s settings menu and choose Rename, then press Enter to save or Escape to cancel. Select artboards and use **Move to page** in the footer to move them together. ⌘Z undoes a move, page creation, or rename, and ⇧⌘Z redoes it. Projects from earlier builds open on **Page 1**. The app remembers each page’s camera during the open session.

Click **Tokens** to manage shared design tokens. Search by name or type, then click a token name to edit it in its row. Use a token’s **Copy CSS** action and paste the reference into an artboard stylesheet, for example `body { background: var(--ep-color-brand); }`. Artboards using that reference pick up changes across all pages. Close Tokens to undo or redo with the canvas shortcuts. **JSON…** opens the source editor and the import and export actions. Importing fills a draft. **Save tokens** applies it to the project.

This version supports sRGB colors, dimensions in px or rem, numbers, font-family stacks, numeric font weights, durations in ms or s, and whole-token aliases such as `{color.brand}`. Names use lowercase dot-separated paths, for example `space.page-gutter`. Easy Proto saves the DTCG JSON and Style Dictionary CSS together inside the project folder. [Supported format and recovery](docs/decisions/0002-project-commits.md#project-tokens)

## Install and run

Use Node 24.16.0 and pnpm 10.33.4. The following commands use nvm and Corepack to select the pinned versions.

```sh
nvm install
nvm use
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm --filter @easy-proto/desktop exec install-electron --no
pnpm dev
```

The runtime installer comes from the pinned Electron npm package and fetches the matching official Electron release. `pnpm dev` builds and launches the desktop app. Rebuild or rerun it after source changes. For a build already on disk, use `pnpm start`.

Home shows the projects you have created or opened on this device. Click a row to reopen it, or use **Create project** and select an empty folder in the macOS picker. Click **Easy Proto** in the header to return Home. The footer’s **Settings** menu has project actions and **Appearance**. Use **Open project…** to add an existing project or find a folder that moved.

Double-click the project name or an artboard title to edit it. Enter or clicking away saves, and Escape cancels. You can also focus the name and press Enter to start editing. Project titles travel with their folders. Artboard titles, dimensions, and activity labels stay the same screen size as you zoom. Select an artboard and press **⌘D** to save an offset copy with its own editable HTML and CSS. The copy becomes selected.

Open the Pages picker and hover or focus a page row to show its settings icon. Open it to choose Rename or Delete. Deleting a page with artboards asks for confirmation. **⌘Z** restores the page and its artboards in one step, and **⇧⌘Z** deletes them again. Keep at least one page in each project.

Use **⌘C** and **⌘V** to copy and paste an artboard within the open project. Press **Delete** to remove the selected artboard. **⌘Z** undoes the latest artboard change, and **⇧⌘Z** redoes it. Undo and redo save their results, and the history resets when you leave or reopen the project. Text fields keep their usual editing shortcuts.

You can launch straight into a folder with `pnpm start "--project=$PWD/My prototype"` after building. Use an empty folder or an existing project. Without a path, the app starts at Home. Changes save automatically. Copy the entire project folder, including `.easy-proto` and `assets`, to move it.

### Save a portable copy

With a project open, choose **Settings → Save a Copy…** and pick a new filename. Use **Open project…** to open the resulting `.easyproto` file, even after moving it. The original stays open when you save, and each file can be edited independently. The copy contains the saved artboards, pages, tokens, and loaded project assets. Choose a new filename if one already exists.

### Try a SQLite project

With the source project closed, import its current revision into a new editable file.

```sh
pnpm build
pnpm project:import-sqlite "mocks/.workspace/EasyProtoMocks" "mocks/.workspace/EasyProtoMocks.easyproto"
pnpm start "--project=$PWD/mocks/.workspace/EasyProtoMocks.easyproto"
```

On macOS, you can also choose the file from **Open project** in Settings. The source folder and its historical snapshots remain available. New projects still start as folders. [SQLite pilot and recovery](docs/decisions/0006-sqlite-project-pilot.md)

## Try the chat drawer

On **Home → Agents**, click **Log in with ChatGPT** and approve eligible plan usage in your browser. Easy Proto names each new connection automatically. Click an existing connection on Home to rename it, reconnect, disconnect, or manage usage.

The desktop uses the installed Codex CLI. Qualified macOS builds are `0.169.0` and `0.167.0-alpha.4.1`. Set `EASY_PROTO_CODEX_BIN` to the absolute executable path if needed.

Open a project and open **Chat**. Try “Create a page called Explorations” or “Change the headline on Field notes”. OpenAI receives your message, recent chat, and project details. If Codex needs an artboard’s HTML/CSS, Chat asks you to approve that read. Review each edit with **Apply change** or **Discard**. **Undo edit** uses the project’s undo history. For a request with dependent changes, apply the first proposal and ask chat to continue. [Project chat details](docs/chat-architecture.md#project-wide-chat)

Run `pnpm desktop:build` and `pnpm desktop:verify:chatgpt-live` to exercise a real Codex turn in a disposable Electron profile. Complete browser sign-in from the test window. The check requests a new page, tests Apply and Undo, then disconnects. To test against a local synthetic provider with the installed Codex runtime, run `EASY_PROTO_CHECK_CODEX_BIN="$(command -v codex)" pnpm verify`.

## Try browser sharing

Run `pnpm web:dev` and open [the local sharing prototype](http://127.0.0.1:8787). The pnpm workspace contains Electron in `apps/desktop/`, TanStack Router in `apps/web/`, and the shared Brand, Select, and Inter assets in `packages/ui/`. Run `pnpm build` to build both apps or `pnpm desktop:build` and `pnpm web:build` individually. The [web walkthrough](apps/web/README.md) covers the demo account, canvas and artboard links, and revocation.

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

- `get_context` returns the selected project's name, ID, activation ID, revision, pages, default page ID and artboards across all pages. Legacy artboards without a `pageId` belong to the default page. Home returns `NO_PROJECT` and revokes the previous activation. Include both `projectId` and `activationId` in every other tool call. Call `get_context` again after a project switch, reopen or restart. The same MCP connection can discover the newly selected project.
- `get_artboard` takes `projectId` and `artboardId` and returns source plus metadata.
- `get_tokens` takes `projectId` and `activationId` and returns the committed JSON document, CSS, resolved rows, revision and token digests when present.
- `replace_project_tokens` takes `projectId`, `activationId`, `commandId`, `expectedRevision` and `document`, a complete DTCG JSON string. Use the revision returned by `get_tokens`. Every artboard can refer to the published variables.
- `create_artboard` takes `projectId`, a new UUID `commandId`, `expectedRevision` and `arguments` containing `name`, `x`, `y`, `width`, `height`, `html` and `css`. Include `pageId` in `arguments` to choose the destination. With no destination, it uses the project's default page.
- `update_artboard` takes the same envelope with `arguments: { artboardId, patch }`. Supply any subset of the layout and source fields.
- `capture_artboard` takes `projectId`, `artboardId` and the current `revision`. It returns PNG image content and metadata, including token digests and unresolved resources when present.
- `set_artboard_activity` takes `projectId`, `activationId`, `artboardId`, a caller-generated UUID as `activityId`, and `status` of `working` or `idle`. Send `working` before drafting changes to an existing board. Renew with the same ID before the two-minute lease expires and send `idle` with that ID when done. The tool returns the board's combined `working` state, including other active work.

The canvas shows **Agent working** with three animated dots and gently pulses the affected artboard's opacity during an explicit activity lease or an in-flight MCP update or capture. With reduced motion enabled, the dots stay still and the artboard stays fully opaque. An agent must report activity to cover time spent drafting between calls. Overlapping activities clear independently. Switching projects drops the previous activation's activity, including when reopening the same folder. Activity never changes the project revision, saves to disk, or appears in captured artboard images.

Place PNG, JPEG, GIF, WebP, AVIF, WOFF or WOFF2 files under the project's `assets/` folder before opening it. Reference them like `assets/logo.png` in HTML or CSS. Reopen after changing assets. Use the HTML and CSS tool arguments to update source. The [persistence decision](docs/decisions/0002-project-commits.md) explains retry and recovery behavior.

## Update the desktop design system

Open EasyProtoMocks and use its MCP tools to update the `desktop` token group. With the app's bearer token and port in your environment, run `pnpm tokens:sync`, then `pnpm build`. See the [desktop token guidance](docs/design-guidance.md#desktop-tokens).

## Verify

Run `pnpm fmt` to format TypeScript and JavaScript with Oxfmt. Use `pnpm fmt:check` to check formatting and `pnpm lint` to run Oxlint. The full verification command includes both checks.

```sh
EASY_PROTO_EVIDENCE="$PWD/evidence" pnpm verify
```

The check launches Electron and a real SDK Streamable HTTP client on disposable local ports. Existing projects are outside the test scope. The command also checks interrupted saves and that switching projects revokes access through the old MCP activation, including across folder copies that share a project ID. See the [handoff](docs/handoff.md) and [review workflow](agents/codex-review.md).
