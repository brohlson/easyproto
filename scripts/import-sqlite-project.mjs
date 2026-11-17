import { Project } from "../dist/project.js";

const [source, destination, ...rest] = process.argv.slice(2);
if (!source || !destination || rest.length) {
  console.error("Usage: pnpm project:import-sqlite <folder> <destination.easyproto>");
  process.exitCode = 1;
} else {
  try {
    const path = await Project.importFolder(source, destination);
    const project = await Project.open(path, undefined, "open");
    const { revision, artboards, commands } = project.snapshot.manifest;
    console.log(
      `Imported ${project.name} at revision ${revision} with ${artboards.length} artboards and ${commands.length} command receipts.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error && error.message ? error.message : "Could not import the project.",
    );
    process.exitCode = 1;
  }
}
