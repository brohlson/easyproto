import { join } from "node:path";
import { _electron as electron } from "playwright";

const [, , bundle, profile] = process.argv;
const env = { ...process.env, EASY_PROTO_PROFILE: profile };
delete env.EASY_PROTO_TOKEN;
const app = await electron.launch({
  executablePath: join(bundle, "Contents/MacOS/Easy Proto"),
  env,
});
try {
  const window = await app.firstWindow({ timeout: 20000 });
  await window.getByRole("button", { name: "Create project" }).waitFor({ timeout: 20000 });
  console.log("Verified the packaged Home screen.");
} finally {
  await app.close();
}
