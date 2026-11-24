# Easy Proto

Easy Proto is a macOS desktop canvas for reviewing HTML/CSS mockups made by a coding agent. Each artboard has its own browser viewport. Click an artboard to select it, Shift-click to toggle it in the selection, or drag a box from an empty canvas area to select every artboard it overlaps. Drag or press the arrow keys to move the selection. Use ⌘D to duplicate, ⌘C and ⌘V to copy and paste, and Delete to remove the selected boards. Each edit takes one undo step. Swipe with two fingers, scroll, or hold Space while dragging to pan. Pinch to zoom, and press Shift+0 to fit the canvas. Click an artboard’s dimensions to choose a viewport preset or **Arbitrary size**. Arbitrary size shows a bottom-right handle. Drag it to resize the HTML viewport, or focus it and use the arrow keys for 5 px steps and Shift for 20 px steps. Choosing a preset hides the handle. Use **Appearance** to choose System, Light, or Dark.

Use the current page name beside the project name to switch pages or choose **Add page**. Open a page’s settings menu and choose Rename, then press Enter to save or Escape to cancel. Right-click an artboard for **Move to page**, **Rename**, and **Delete**. Right-clicking an unselected artboard selects it; right-clicking a selected artboard keeps the current selection and offers Move and Delete for the group. Multiple selected artboards also show **Move…** and **Delete** in the footer. Focus an artboard and press Shift+F10 to open its menu with the keyboard. Escape closes the menu and keeps the selection. ⌘Z undoes a move, deletion, page creation, or rename, and ⇧⌘Z redoes it. Projects from earlier builds open on **Page 1**. The app remembers each page’s camera during the open session.

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

### Update the installed Mac app

From the checkout, run:

```sh
./scripts/install-mac
```

The command builds your current working tree, checks the signature and Home screen in a temporary profile, then installs and opens `~/Applications/Easy Proto.app` with the Fold icon. If the installed copy is running, the command quits it just before replacing it. Your development window can stay open. Each copy has its own recent projects. Run the same command again whenever you want to try newer changes.

The installer uses the pinned Node and pnpm versions above, macOS Command Line Tools (Swift), and local ad-hoc signing.

### Releasing the Mac app

The [Release Mac app workflow](.github/workflows/release-mac.yml) accepts a stable `vX.Y.Z` tag on a commit from `main` with the matching version in `apps/desktop/package.json`. It builds and tests for Apple silicon, signs with Developer ID, notarizes the app and disk image, and publishes a DMG and update ZIP together in GitHub Releases.

Configure the `mac-release` GitHub environment for `v*` tags with a required reviewer and administrator bypass disabled. Review the tagged commit and confirm it is on `main` before approving access to the signing credentials. Add the base64 Developer ID Application PKCS#12 export as `MAC_CERTIFICATE`, its password as `MAC_CERTIFICATE_PASSWORD`, and the base64 App Store Connect team API key as `APPLE_NOTARY_KEY` with its `APPLE_NOTARY_KEY_ID` and `APPLE_NOTARY_ISSUER_ID`. Install the first signed release from the DMG. That version checks for updates and offers **Restart to Update** or **Later** after a verified download. Install a later signed release through this prompt before announcing the update channel.

Home shows the projects you have created or opened on this device. Click a row to reopen it, or use **Create project** and select an empty folder in the macOS picker. Click **Easy Proto** in the header to return Home. The footer’s **Settings** menu has project actions and **Appearance**. Use **Open project…** to add an existing project or find a folder that moved.

Double-click the project name or an artboard title to edit it. Enter or clicking away saves, and Escape cancels. You can also focus the name and press Enter to start editing. Project titles travel with their folders. Artboard titles and dimensions stay the same screen size as you zoom. Select an artboard and press **⌘D** to save an offset copy with its own editable HTML and CSS. The copy becomes selected.

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

## Try browser sharing

Run `pnpm local:dev` to initialize local Cloudflare storage and launch the web app with a development desktop. Open [the local landing page](http://127.0.0.1:8787), then choose **Settings → Export page to web preview… → Sync page** in the desktop. Each page receives a stable `/p/<id>` URL. Syncing again updates that link with a saved, read-only canvas snapshot. Local D1 stores waitlist emails and share metadata. Local R2 stores the sanitized HTML, CSS, and declared assets.

For just the website, run `pnpm local:setup` followed by `pnpm web:dev`. The [web walkthrough](apps/web/README.md) covers setup, choosing an existing project, preview limits, checks, and the standalone legacy demo. The workspace keeps Electron in `apps/desktop/`, Next.js and the Worker in `apps/web/`, UI in `packages/ui/`, and the page snapshot contract in `packages/preview/`.

## Connect an external agent

Use an MCP client that supports Streamable HTTP and bearer authentication. Configure the client with the local endpoint and the token from the shell that launches Easy Proto. Open a project in the desktop to give the client access to its canvas. The example below uses Codex.

In the same shell that will launch Codex, create a random token and save the non-secret configuration. The token stays in the shell environment.

```sh
export EASY_PROTO_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
codex mcp add easy-proto --url http://127.0.0.1:38645/mcp --bearer-token-env-var EASY_PROTO_TOKEN
pnpm build
pnpm start "--project=$PWD/My prototype" &
codex
```

### Open the installed app from Finder or the Dock

The installed Mac app reads its optional local MCP settings at launch from `~/Library/Application Support/Easy Proto/local-mcp.json`. Use a fixed port and the same bearer token as your client. Once configured, open Easy Proto normally and select a project on Home. The client can connect on Home and gains project context when you open a project. Quit Easy Proto to stop the endpoint.

For a first-time setup, with the matching token and port already available in your shell, run this once. It creates a file readable only by your account and stops if the file already exists.

```sh
node --input-type=module <<'JS'
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const token = process.env.EASY_PROTO_TOKEN;
const port = Number(process.env.EASY_PROTO_PORT ?? 38645);
if (!/^[A-Za-z0-9_-]{43,128}$/.test(token ?? "") || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Set the matching MCP token and a fixed port first.");
const profile = join(homedir(), "Library", "Application Support", "Easy Proto");
await mkdir(profile, { recursive: true, mode: 0o700 });
await writeFile(join(profile, "local-mcp.json"), JSON.stringify({ token, port }), { flag: "wx", mode: 0o600 });
JS
```

The file stays outside the app bundle and project folders, so rebuilding the app preserves the connection. Move the file out of that directory and relaunch to disable automatic startup. Development runs, disposable profiles, and explicit environment configuration retain the Terminal workflow. If another process holds the configured port, Easy Proto reports the issue and opens the canvas with MCP offline. Restart the client if it needs to rediscover a newly registered server.

Ask Codex to get the Easy Proto context, create a 480 × 320 artboard next to the starter at canvas coordinates (620, 0), then capture it. Ask it to change the title and background and capture the new revision. Press Shift+0 to bring both boards into view. Drag a board, return Home, and reopen the project to see the saved position.

- `get_context` returns the selected project's name, ID, activation ID, revision, pages, the default page ID, the canvas selection (`activePageId`) and artboards across all pages. Legacy artboards without a `pageId` belong to the default page. Home returns `NO_PROJECT` and revokes the previous activation. Include both `projectId` and `activationId` in every other tool call. Call `get_context` again after a project switch, reopen or restart. The same MCP connection can discover the newly selected project.
- `get_artboard` takes `projectId` and `artboardId` and returns source plus metadata.
- `get_tokens` takes `projectId` and `activationId` and returns the committed JSON document, CSS, resolved rows, revision and token digests when present.
- `replace_project_tokens` takes `projectId`, `activationId`, `commandId`, `expectedRevision` and `document`, a complete DTCG JSON string. Use the revision returned by `get_tokens`. Every artboard can refer to the published variables.
- `create_page` and `rename_page` take the same command envelope as artboard writes. Pass `arguments: { name }` to create or `arguments: { pageId, name }` to rename. Both return `page.id` and the committed `revision`. Pass that ID to subsequent artboard creates.
Projects have no fixed artboard count. Batch sizes below apply to individual MCP requests.

- `create_artboard` takes `projectId`, a new UUID `commandId`, `expectedRevision` and `arguments` containing `name`, `x`, `y`, `width`, `height`, `html` and `css`. Include `pageId` in `arguments` to choose the destination. With no destination, it uses the project's default page.
- `update_artboard` takes the same envelope with `arguments: { artboardId, patch }`. Supply any subset of the layout and source fields.
- `update_artboards` accepts the same envelope and `arguments: { updates: [{ artboardId, patch }, ...] }`. Supply 1–50 unique IDs with individual patches. The existing 3 MiB request limit applies to the entire JSON request. A successful batch publishes one revision, manages activity on the targets, and returns `changedArtboardIds` and `artboards` in document order. Unchanged targets are omitted. An entirely unchanged batch returns `ARTBOARDS_UNCHANGED`. A stale revision or missing target rejects the whole request. Retry a lost reply with the original command ID and arguments. Press ⌘Z once on the canvas to undo the batch during the same project session.
- `undo` takes the current `expectedRevision`, a fresh `commandId` for the Undo, and `arguments: { targetCommandId }` containing the original edit’s command ID. Only the next undoable edit in the open project session can be reversed. An intervening edit returns `REVISION_CONFLICT` for a stale revision or `UNDO_CONFLICT` for a different target at the current revision. Both include `currentRevision`. Retry a lost reply using the exact same Undo request.
- `capture_artboard` takes `projectId`, `artboardId` and the current `revision`. It returns PNG image content and metadata, including token digests and unresolved resources when present.
- `capture_artboards` takes the same project scope, current `revision` and an ordered list of 1–12 unique `artboardIds`. It returns one labeled PNG review sheet, capture metadata in request order, and a top-level `warnings` list identifying boards with unresolved resources. Set `includeFullResolution: true` to append the original PNGs in order (8 MiB combined limit). Use smaller batches for large originals.
- `set_artboard_activity` takes `projectId`, `activationId`, `artboardId`, a caller-generated UUID as `activityId`, and `status` of `working` or `idle`. Send `working` before drafting changes to an existing board. Renew with the same ID before the two-minute lease expires and send `idle` with that ID when done. The tool returns the board's combined `working` state, including other active work.

When MCP work begins, the canvas opens the target page and frames the affected artboards. A centered **Edge runner** Fold mark and **Agent working** label appear over a soft, theme-aware scrim. The treatment stays visible for at least 1.2 seconds, then fades out without delaying the saved edit. It covers explicit activity leases, new artboards, and in-flight MCP updates and captures. Batched work frames targets on the first affected page in document order. Lease renewals do not recenter the canvas or pull you back after you change pages. Active dragging, text editing, dialogs, and menus take precedence over automatic following.

The indicator stays a consistent screen size where the artboard has room, and scales down to fit small artboards. Reduced motion disables the runner, fading, and animated camera movement. An agent must report activity to cover time spent drafting between calls. Overlapping activities clear independently. Switching projects drops the previous activation's activity, including when reopening the same folder. Activity never changes the project revision, saves to disk, or appears in captured artboard images. The tool's returned `working` value reports actual work; the brief visual hold may outlast it.

Place PNG, JPEG, GIF, WebP, AVIF, WOFF or WOFF2 files under the project's `assets/` folder before opening it. Reference them like `assets/logo.png` in HTML or CSS. Reopen after changing assets. Use the HTML and CSS tool arguments to update source. The [persistence decision](docs/decisions/0002-project-commits.md) explains retry and recovery behavior.

## Update the desktop design system

Open EasyProtoMocks and use its MCP tools to update the `desktop` token group. With the app's bearer token and port in your environment, run `pnpm tokens:sync`, then `pnpm build`. See the [desktop token guidance](docs/design-guidance.md#desktop-tokens).

## Verify

Run `pnpm fmt` to format TypeScript and JavaScript with Oxfmt. Use `pnpm fmt:check` to check formatting and `pnpm lint` to run Oxlint. The full verification command includes both checks.

```sh
EASY_PROTO_EVIDENCE="$PWD/evidence" pnpm verify
```

The check launches Electron and a real SDK Streamable HTTP client on disposable local ports. Existing projects are outside the test scope. The command also checks interrupted saves and that switching projects revokes access through the old MCP activation, including across folder copies that share a project ID. See the [handoff](docs/handoff.md) and [review workflow](agents/codex-review.md).
