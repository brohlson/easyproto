import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { id, type RecentProject } from "../shared/model";
import type { Project } from "./project";

const record = z.strictObject({
  id,
  projectId: id,
  folder: z.string().refine(isAbsolute),
  name: z.string().min(1),
});
const index = z.strictObject({ projects: z.array(record) });

export class RecentProjects {
  #pending = Promise.resolve();

  constructor(
    private readonly path: string,
    private projects: z.infer<typeof record>[],
  ) {}

  static async load(path: string) {
    try {
      const { projects } = index.parse(JSON.parse(await readFile(path, "utf8")));
      return new RecentProjects(path, projects);
    } catch {
      return new RecentProjects(path, []);
    }
  }

  list(): RecentProject[] {
    return this.projects.map(({ id, name }) => ({ id, name }));
  }

  find(id: string) {
    return this.projects.find((entry) => entry.id === id);
  }

  remember(project: Project, findMoved = false) {
    const task = this.#pending.then(() => this.#remember(project, findMoved));
    this.#pending = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async #remember(project: Project, findMoved: boolean) {
    const folder = project.root;
    const { projectId } = project.snapshot.manifest;
    const previous = this.projects.find((entry) => entry.folder === folder);
    const entry = {
      id: previous?.projectId === projectId ? previous.id : randomUUID(),
      projectId,
      folder,
      name: project.name,
    };
    const candidates = this.projects.filter((entry) => entry.folder !== folder);
    const keep = await Promise.all(
      candidates.map(async (entry) => {
        if (!findMoved || entry.projectId !== projectId) return true;
        try {
          await lstat(entry.folder);
          return true;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code !== "ENOENT";
        }
      }),
    );
    this.projects = [entry, ...candidates.filter((_, index) => keep[index])];
    const data = JSON.stringify({ projects: this.projects }) + "\n";
    return this.#save(data);
  }

  async #save(data: string) {
    const pending = this.path + "." + randomUUID();
    try {
      await writeFile(pending, data, {
        flag: "wx",
        mode: 0o600,
        flush: true,
      });
      await rename(pending, this.path);
      return true;
    } catch {
      await rm(pending, { force: true }).catch(() => undefined);
      return false;
    }
  }
}
