import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const sourceRoot = new URL("../src/", import.meta.url);
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (/\.(?:ts|tsx|css)$/.test(entry.name) && !/\.(?:test|prototype)\./i.test(entry.name) && !/Prototype/.test(entry.name)) files.push(path);
  }
}

await collect(sourceRoot.pathname);
const findings = [];
for (const path of files) {
  const content = await readFile(path, "utf8");
  if (/Routes\s*&\s*Paths/i.test(content)) findings.push(`${path}: legacy Routes & Paths terminology`);
  if (/['"`]\/routes(?:[/?'"`]|$)/.test(content)) findings.push(`${path}: legacy /routes navigation`);
}

if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}

console.log(`Checked ${files.length} production source files: no legacy Routes & Paths surface remains.`);
