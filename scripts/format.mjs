import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignoredDirectories = new Set([".git", "node_modules", "coverage"]);
const textExtensions = new Set([".json", ".md", ".mjs", ".txt", ".yml", ".yaml"]);
const specialTextFiles = new Set([".editorconfig", ".gitignore", "LICENSE"]);

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

const files = (await walk(root)).filter(
  (file) => textExtensions.has(extname(file)) || specialTextFiles.has(basename(file)),
);
const failures = [];

for (const file of files) {
  const relativePath = relative(root, file);
  const content = await readFile(file, "utf8");

  if (content.includes("\r")) {
    failures.push(`${relativePath}: contains CR line endings`);
  }

  if (!content.endsWith("\n")) {
    failures.push(`${relativePath}: missing final newline`);
  }

  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      failures.push(`${relativePath}:${index + 1}: trailing whitespace`);
    }
  });

  if (file.endsWith(".json")) {
    try {
      const canonical = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
      if (canonical !== content) {
        failures.push(`${relativePath}: JSON is not canonical two-space format`);
      }
    } catch {
      // JSON syntax is reported by the lint command.
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`format: ${files.length} text files passed`);
}
