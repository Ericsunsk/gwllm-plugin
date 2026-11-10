import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildIndex } from "./build-index.mjs";
import { loadPlugins } from "./plugins.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  options: {
    revision: { type: "string" },
    output: { type: "string", default: ".release/marketplace" },
    remote: { type: "string", default: "https://github.com/Ericsunsk/gwllm-plugin.git" },
  },
});
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const revision = values.revision || git("rev-parse", "HEAD");
if (!/^[a-f0-9]{40}$/.test(revision) || git("rev-parse", "HEAD") !== revision) throw new Error("Check out the exact release commit first");
if (git("status", "--porcelain", "--", "plugins", "contract", "scripts", "package.json", "package-lock.json"))
  throw new Error("Commit release inputs before publication");
const plugins = await loadPlugins(root);
for (const plugin of plugins) {
  const committed = execFileSync("git", ["show", `${revision}:${plugin.relativePath}`], { cwd: root });
  if (!committed.equals(plugin.source)) throw new Error(`Source differs from commit: ${plugin.relativePath}`);
}
const directory = resolve(root, values.output);
await mkdir(directory, { recursive: true });
if ((await readdir(directory)).length) throw new Error("Release output directory must be empty");
const branch = git("ls-remote", "--heads", values.remote, "refs/heads/marketplace");
git("-C", directory, "init", "--initial-branch=marketplace");
git("-C", directory, "remote", "add", "origin", values.remote);
let previous = null;
if (branch) {
  git("-C", directory, "fetch", "--depth=1", "origin", "marketplace");
  git("-C", directory, "checkout", "-B", "marketplace", "FETCH_HEAD");
  previous = JSON.parse(await readFile(join(directory, "index.json"), "utf8"));
}
const index = buildIndex(plugins, previous, "Ericsunsk/gwllm-plugin", revision);
await writeFile(join(directory, "index.json"), JSON.stringify(index, null, 2) + "\n");
for (const file of ["LICENSE", "NOTICE"]) await copyFile(join(root, file), join(directory, file));
git("-C", directory, "add", "index.json", "LICENSE", "NOTICE");
if (!previous || git("-C", directory, "diff", "--cached", "--name-only")) {
  git(
    "-C",
    directory,
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    `Publish plugins from ${revision}`
  );
}
console.log(`Prepared marketplace at ${directory}; push HEAD:refs/heads/marketplace without force`);
