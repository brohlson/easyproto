# Easy Proto local sharing preview

The TanStack Router viewer serves one synthetic Field Notes revision on loopback. The pnpm workspace builds its client with Vite and shares Brand and Select with the desktop. The local Node server owns session, share, and per-artboard authorization. It serves private page data to the router under the same authorization used for direct navigation.

```sh
pnpm install --frozen-lockfile
pnpm web:dev
```

1. Open [the local preview](http://127.0.0.1:8787) and enter `owner@example.test`.
2. Open the link from the local inbox in the same browser and confirm sign-in.
3. Share **Project canvas**, or select **Today artboard** with **Phone** or **Overview artboard** with **Laptop**. Open the generated link in a private window, then choose **Open preview**. Drag to pan, use the zoom buttons to change the scale, or choose **Fit**.
4. Back in the original window, go to **Manage links** and revoke the link. Reload the private window to see access denied.

The local inbox simulates email, and the owner and guest links are usable on the same machine. The synthetic HTML artboards are checked in, served in sandboxed iframes, and kept at their saved viewport through fit and zoom. The prototype holds challenges, sessions and shares in memory and resets when you restart. It uses loopback HTTP and a same-origin fixture route. The production design calls for HTTPS, Workers, private R2 snapshots, D1 access, and transactional mail. Actual project export, passwords, and deployed-browser verification are still pending. See the [web sharing architecture](../docs/web-sharing-architecture.md).

## Check the workflow

With repo dependencies installed and Playwright Chromium available, run:

```sh
pnpm exec playwright install chromium
pnpm web:verify
```

The test starts its own disposable server and browser profiles. Save the canvas, phone and laptop screenshots with:

```sh
mkdir -p evidence/web-sharing
EASY_PROTO_WEB_EVIDENCE="$PWD/evidence/web-sharing" pnpm web:verify
```

`pnpm web:build` builds the static client and `pnpm web:start` starts Node with the last build. The browser checks cover same-browser single-use sign-in, sharing and revocation, the Fold favicon, and viewport identity in each device frame.

Set `EASY_PROTO_WEB_PORT` if port 8787 is already in use for the interactive demo.
