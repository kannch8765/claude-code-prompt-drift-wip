import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignoredDirectories = new Set([".git", "node_modules", "coverage"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute)));
    } else {
      files.push(absolute);
    }
  }

  return files;
}

const files = await walk(root);
const moduleFiles = files.filter((file) => file.endsWith(".mjs"));
const jsonFiles = files.filter((file) => file.endsWith(".json"));
const failures = [];

for (const file of moduleFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failures.push(`${relative(root, file)}\n${result.stderr}`);
  }
}

for (const file of jsonFiles) {
  try {
    JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    failures.push(`${relative(root, file)}\n${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`lint: ${moduleFiles.length} modules and ${jsonFiles.length} JSON files passed`);
}
