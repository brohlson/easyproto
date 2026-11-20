import electronPath from "electron";
import { _electron } from "playwright";

export function launchDesktop(options) {
  return _electron.launch({ executablePath: electronPath, ...options });
}
