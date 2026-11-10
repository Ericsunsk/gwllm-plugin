import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadPlugins } from "./plugins.mjs";

export function buildIndex(plugins, previous, repository, revision) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid GitHub repository");
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Release revision must be a full commit SHA");
  if (previous && (previous.indexVersion !== 1 || !Array.isArray(previous.plugins))) throw new Error("Invalid previous marketplace index");
  const previousEntries = new Map((previous?.plugins || []).map((plugin) => [plugin.key, plugin]));
  const entries = new Map(
    (previous?.plugins || []).map((plugin) => [plugin.key, { ...plugin, versions: plugin.versions.filter((version) => version.version === plugin.latest) }])
  );
  for (const { meta, source, relativePath } of plugins) {
    const sha256 = createHash("sha256").update(source).digest("hex");
    const existing = previousEntries.get(meta.key);
    const released = existing?.versions.find((version) => version.version === meta.version);
    if (released && released.sha256 !== sha256) throw new Error(`${meta.key}@${meta.version} was already released with different source; bump meta.version`);
    // Keep the current release's immutable reference while removing every older version.
    const version = released || {
      version: meta.version,
      path: `https://raw.githubusercontent.com/${repository}/${revision}/${relativePath}`,
      sha256,
      minApiVersion: meta.apiVersion,
      kind: "task",
      ...(meta.allowedHosts ? { allowedHosts: meta.allowedHosts } : {}),
      ...(meta.baseUrl ? { baseUrl: meta.baseUrl } : {}),
      ...(meta.auth ? { auth: typeof meta.auth === "string" ? meta.auth : meta.auth.type } : {}),
    };
    const display = {};
    for (const key of ["key", "name", "icon", "description", "models", "protocols", "channelTypes", "sortPriority", "website"]) {
      if (meta[key] !== undefined) display[key] = meta[key];
    }
    entries.set(meta.key, { ...display, latest: meta.version, versions: [version] });
  }
  return {
    indexVersion: 1,
    name: "gwllm-plugin",
    plugins: [...entries.values()].sort((a, b) => a.key.localeCompare(b.key, "en")),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      revision: { type: "string" },
      previous: { type: "string" },
      output: { type: "string" },
      repository: { type: "string", default: "Ericsunsk/gwllm-plugin" },
    },
  });
  if (!values.revision || !values.output)
    throw new Error("Usage: npm run index -- --revision <40-character SHA> --output <index.json> [--previous <index.json>]");
  const previous = values.previous ? JSON.parse(await readFile(values.previous, "utf8")) : null;
  const plugins = await loadPlugins(fileURLToPath(new URL("../", import.meta.url)));
  await writeFile(values.output, JSON.stringify(buildIndex(plugins, previous, values.repository, values.revision), null, 2) + "\n");
}
