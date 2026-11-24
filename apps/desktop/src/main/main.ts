import { resolve } from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import { start } from "./app/start";

const projectOption = process.argv
  .find((arg) => arg.startsWith("--project="))
  ?.slice("--project=".length);
const launchDirectory = process.env.INIT_CWD ?? process.cwd();
const testProfile = process.env.EASY_PROTO_PROFILE;
if (testProfile) app.setPath("userData", resolve(launchDirectory, testProfile));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () =>
    BrowserWindow.getAllWindows()
      .find((window) => window.isVisible())
      ?.focus(),
  );
  app.on("window-all-closed", () => app.quit());
  app
    .whenReady()
    .then(() => start({ projectOption, launchDirectory, testProfile }))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown startup error.";
      console.error("Easy Proto startup failed:", message);
      if (!testProfile) dialog.showErrorBox("Easy Proto could not start", message);
      app.exit(1);
    });
}
