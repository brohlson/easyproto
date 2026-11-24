# Easy Proto local web preview

The landing page collects waitlist emails in local Cloudflare D1. A read-only page canvas at `/p/<id>` renders the selected page’s sanitized HTML and CSS in opaque, scriptless iframes. Syncing a page again updates its existing URL. Visitors can pan, zoom, and fit the page.

## Source layout

- `src/app.tsx` connects routes to the landing page, shared viewer, and legacy demo. Each feature keeps its own styles. Both viewers use `src/canvas/` for pan and zoom.
- `worker/index.ts` owns request dispatch and error handling. The adjacent modules own waitlist signup, desktop publishing, public previews and artifacts, and the site shell.
- `demo/` contains the standalone Node server and HTML artboards for the legacy demo. The Worker continues to serve the current sharing workflow.

## Start locally

Use the repository’s pinned Node and pnpm toolchain:

```sh
pnpm install --frozen-lockfile
pnpm local:dev
```

This initializes D1, starts the Worker at `http://127.0.0.1:8787`, builds the desktop, and launches a development copy with a separate profile. The default project is a preserved working copy of the tracked EasyProtoMocks checkpoint under `.local/Mockups`. To open an existing project:

```sh
pnpm local:dev -- --project=mocks/.workspace/EasyProtoMocks.easyproto
```

Project paths are resolved from the repository root. Folders and `.easyproto` files work. Closing the development desktop stops the launcher’s web server. The installed Mac app is separate.

To run only the website:

```sh
pnpm local:setup
pnpm web:dev
```

If a standalone server is already using port 8787, stop it before starting `local:dev`.

The launcher creates private `.local/web-preview.json` and ignored `apps/web/.dev.vars` with matching publisher capabilities. Existing matching configuration is preserved; mismatched keys are refused. The development desktop reads this configuration or the `EASY_PROTO_WEB_ORIGIN`/`EASY_PROTO_WEB_TOKEN` environment variables. Only HTTP loopback origins are accepted. The capability never reaches renderer code, preview links, or project files.

Local D1/R2 state persists in `apps/web/.cloudflare/state`. The development registry stays in `.local/cloudflare-registry`. Polling supports environments with restricted file watchers; set `CHOKIDAR_USEPOLLING=0` to prefer native watching. The configured D1 UUID is a local identifier; a hosted deployment needs its own resource and authentication configuration.

Vite's file endpoint denies private local settings, `.dev.vars`, Cloudflare state, working mockups, managed project history, and `.easyproto` files, alongside Vite's standard credential-file exclusions. The regression check uses disposable fixtures and confirms public UI assets remain available.

## Export the current page

1. Choose **Settings → Export page to web preview…**.
2. Check the page name and artboard count; choose **Sync page**.
3. Use **Open preview** or **Copy link**.
4. Sync again to update the same link; use **Refresh preview** in the browser.

The export pins one committed revision and sends only the selected page’s sanitized preview documents, CSS, token CSS, and board-declared image/font assets. It excludes other pages, canonical project files, command history, local paths, and credentials. Unresolved dependencies stop the sync. Project edits during validation cannot mix source revisions. **Cancel export** aborts pending validation/upload work, as does retiring the project.

Limits are 50 artboards, 256 assets per artboard, 8 MiB per asset, and 32 MiB per multipart upload. The Worker rechecks sanitized HTML, member types, sizes, and SHA-256 digests, writes board-scoped R2 members, and publishes the pointer atomically in D1. Failed or stale uploads preserve the previous preview. Previously published artifact URLs remain pinned. Empty pages need an artboard before export.

The canvas embeds each saved viewport with `sandbox=""` and a response-level policy that blocks scripts, connections, forms, navigation, nested frames, and cross-board assets. Camera zoom never changes the iframe’s CSS viewport. It supports negative coordinates. With the canvas focused, arrows pan, `+`/`−` zoom, and `0`/Home fit.

## Designs and verification

Editable HTML studies are in `mocks/web-sync/`: `landing.html`, `viewer.html`, and `export.html`. The native macOS check synced the three-artboard **Home & settings** page twice, retained the same URL, and refreshed the read-only canvas successfully in Chrome. [Native check](../../evidence/web-page-sync/native-ui.md)

```sh
pnpm web:verify
pnpm desktop:verify
```

Worker tests use real SQLite queries and an R2 adapter. Desktop tests cover scoped, pinned exports, cancellation, and safe link construction. A live localhost smoke run also exercised the actual Worker with simulated D1/R2; its synthetic rows and images were removed afterward. [Smoke evidence](../../evidence/web-page-sync/local-http.json)

If Playwright cannot resolve Electron from the monorepo, run native checks with `NODE_PATH="$PWD/apps/desktop/node_modules" pnpm desktop:verify` from the repository root. This only supplies the installed desktop dependency path; it does not bypass runtime permissions.

The earlier login/share/revoke prototype is preserved separately:

```sh
pnpm --filter @easy-proto/web demo:build
pnpm --filter @easy-proto/web demo:start
```

Open `http://127.0.0.1:8787/demo` and sign in with `owner@example.test` using the local inbox. This Node demo uses ephemeral sessions and synthetic sandboxed HTML fixtures. `web:verify` retains its HTTP and Chromium tests after the new Worker checks. Playwright Chromium must be installed for the browser portion.

Hosted publisher identity/ownership, real resources, waitlist abuse controls, retention/revocation, and the production pipeline are the next scope. See [sharing architecture](../../docs/web-sharing-architecture.md).
