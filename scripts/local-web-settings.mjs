import { chmod, stat } from "node:fs/promises";

export async function enforcePrivateMode(path, mode) {
  await chmod(path, mode);
  const actual = (await stat(path)).mode & 0o777;
  if (actual !== mode)
    throw new Error(`Local preview settings permissions must be ${mode.toString(8)}.`);
}
