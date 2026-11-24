# Easy Proto local web preview

The landing page collects waitlist emails in local Cloudflare D1. A read-only page canvas at `/p/<id>` renders the selected page’s sanitized HTML and CSS in opaque, scriptless iframes. Syncing a page again updates its existing URL. Visitors can pan, zoom, and fit the page.

## Source layout

- `src/pages/` contains the Next.js Pages Router entry points for the homepage and shared viewer. Feature components keep their CSS Modules colocated. Both viewers use `src/canvas/` for pan and zoom.
- `worker/index.ts` owns request dispatch and error handling. The Worker serves the static Next.js export and handles waitlist signup, desktop publishing, and authorized access to previews and artifacts. Access to the viewer shell goes through the same share checks as before.
- `demo/` contains the standalone Vite entry, Node server, and HTML artboards for the legacy demo.

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

The local Worker serves the Next.js export built at startup. Run `pnpm --filter @easy-proto/web site:build` after changing the site. The production build uses Next.js static export with webpack so the site runs under the Worker's existing same-origin script policy. The Next.js build requires no Cloudflare bindings or credentials.

The launcher creates private `.local/web-preview.json` and ignored `apps/web/.dev.vars` with matching publisher capabilities. Existing matching configuration is preserved; mismatched keys are refused. The development desktop reads this configuration or the `EASY_PROTO_WEB_ORIGIN`/`EASY_PROTO_WEB_TOKEN` environment variables. Only HTTP loopback origins are accepted. The capability never reaches renderer code, preview links, or project files.

Local D1/R2 state persists in `apps/web/.cloudflare/state`. The development registry stays in `.local/cloudflare-registry`. Polling supports environments with restricted file watchers; set `CHOKIDAR_USEPOLLING=0` to prefer native watching. The configured D1 UUID is a local identifier; a hosted deployment needs its own resource and authentication configuration.

Vite's file endpoint denies private local settings, `.dev.vars`, Cloudflare state, Next.js build internals, working mockups, managed project history, and `.easyproto` files, alongside Vite's standard credential-file exclusions. The regression check uses disposable fixtures and confirms public UI assets remain available.

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

See the [sharing architecture](../../docs/web-sharing-architecture.md) for the single-owner hosted slice and later multi-owner work.

## Hosted sharing

The hosted deployment supports one trusted desktop publisher per environment. The desktop main process reads the local profile's `web-preview.json` with `mode` set to `hosted`, an Easy Proto HTTPS `origin`, and the environment's private publisher `token`. A disposable development session can instead use `EASY_PROTO_WEB_HOSTED_ORIGIN` and `EASY_PROTO_WEB_HOSTED_TOKEN`. Keep the publisher token in a user-only file or secret store. The renderer only receives the share URL and, when requested, a newly generated guest password.

Hosted shares support stable links, live artboards, and optional generated access passwords. Changing access takes effect on the next sync and invalidates previous guest and artifact grants. A retry of the same sync returns the original result and password. Send passwords separately from the share URL. Hosted artboards use an artifact-only hostname. The viewer issues short-lived, board-scoped URLs that allow iframe HTML and its resource requests without cookies on the artifact hostname.

Use separate D1 databases, private Standard R2 buckets, and Worker secrets for staging and production. Apply the migrations in order. Package a built Worker with `node apps/web/scripts/package-hosted.mjs staging <database-uuid>` or use `production` for the apex. The command returns a temporary directory for the pinned `cf deploy --prebuilt --no-provision` command. Supply `HOSTED_PUBLISH_TOKEN` and `SHARE_KEY` with a private JSON secrets file. Attach the viewer and artifact Custom Domains, disable the workers.dev and version preview aliases, and verify that the artifact host cannot serve the viewer or publish routes.

The [Deploy web workflow](../../.github/workflows/deploy-web.yml) runs on web-related changes to `main` or by manual dispatch from `main`. It verifies the build, uploads a checksummed artifact, deploys to staging, and checks the live Next.js build ID, origin isolation, and interactive homepage. Approve the `web-production` job in GitHub to deploy the same artifact. Each job packages the downloaded bytes with its environment's bindings. The live checks use read-only requests so routine deploys preserve the staging upload budget.

Set `CLOUDFLARE_ACCOUNT_ID` as a repository variable, then set `WEB_DATABASE_ID` and the scoped `CLOUDFLARE_API_TOKEN` secret on each of the `web-staging` and `web-production` GitHub environments. Allow only `main` and require a reviewer on `web-production`. The pinned CLI inherits the existing Workers' runtime secrets. Apply any new database migration separately before promoting code that requires it. Keep the previous Worker version available for rollback.

Each environment allows ten upload attempts per UTC day, at most 5 MiB, eight artboards and 25 files per upload, and up to 5,000 authorized artifact reads per UTC day. The Worker reserves storage before writing to R2 and stops accepting uploads at 250 MiB of cumulative reservations per environment. Reservations are conservative and can include failed uploads. Storage accounting is not reset automatically, and no snapshot deletion is scheduled. If the cap is reached, reconcile the reservations and private bucket contents while publishing is disabled before adjusting the balance. These limits cover this app's operations. They do not cap other activity in the Cloudflare account.

Use `node scripts/verify-hosted-sharing.mjs <viewer-origin> <private-secrets-file>` after a desktop build to publish a disposable page from the actual Electron interface and verify the guest view in Chromium and WebKit. Run the verifier against staging before promoting. Keep a known-good hosted revision available for rollback. A build from before hosted access should only be restored with both hosted routes disabled.
