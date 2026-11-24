import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, autoUpdater, dialog, type BrowserWindow } from "electron";

export function startUpdates(
  window: BrowserWindow,
  testProfile: string | undefined,
  restart: (install: () => void) => Promise<void>,
  onError: () => void,
) {
  if (
    !app.isPackaged ||
    testProfile ||
    process.platform !== "darwin" ||
    process.arch !== "arm64" ||
    !existsSync(join(process.resourcesPath, "easy-proto-release"))
  )
    return;

  let checking = false;
  let downloaded = false;
  let installing = false;
  function failed() {
    checking = false;
    const installationFailed = installing;
    installing = false;
    onError();
    console.warn("Easy Proto could not check for or install an update.");
    if (installationFailed && !window.isDestroyed())
      void dialog
        .showMessageBox(window, {
          type: "warning",
          title: "Easy Proto",
          message: "Easy Proto couldn’t install the update",
          detail: "You can continue working and try again after reopening Easy Proto.",
          buttons: ["OK"],
        })
        .catch(() => {});
  }
  autoUpdater.on("error", failed);
  autoUpdater.on("update-not-available", () => {
    checking = false;
  });
  autoUpdater.once("update-downloaded", () => {
    downloaded = true;
    if (window.isDestroyed()) return;
    void dialog
      .showMessageBox(window, {
        type: "info",
        title: "Easy Proto",
        message: "An Easy Proto update is ready",
        detail: "Restart Easy Proto to install it.",
        buttons: ["Restart to Update", "Later"],
        defaultId: 1,
        cancelId: 1,
      })
      .then(async ({ response }) => {
        if (response === 0 && !window.isDestroyed()) {
          installing = true;
          await restart(() => autoUpdater.quitAndInstall());
        }
      })
      .catch(failed);
  });

  try {
    autoUpdater.setFeedURL({
      url: `https://update.electronjs.org/brohlson/easyproto/darwin-arm64/${app.getVersion()}`,
    });
  } catch {
    failed();
    return;
  }

  const check = () => {
    if (checking || downloaded || window.isDestroyed()) return;
    checking = true;
    try {
      autoUpdater.checkForUpdates();
    } catch {
      failed();
    }
  };
  const first = setTimeout(check, 15_000);
  const periodic = setInterval(check, 4 * 60 * 60 * 1000);
  window.once("closed", () => {
    clearTimeout(first);
    clearInterval(periodic);
  });
}
