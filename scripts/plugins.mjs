import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// Keep the host's schema snapshot unchanged; the host remains the final admission boundary.
export async function loadPlugins(root) {
  const schema = JSON.parse(await readFile(join(root, "contract/v1.schema.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const entries = await readdir(join(root, "plugins"), { withFileTypes: true });
  const plugins = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (!entry.isDirectory()) continue;
    const relativePath = `plugins/${entry.name}/plugin.js`;
    const file = join(root, relativePath);
    const module = await import(pathToFileURL(file));
    // Normalize metadata as the host does before validating it as JSON.
    const meta = JSON.parse(JSON.stringify(module.meta));
    if (!validate(meta)) throw new Error(`${relativePath}: ${ajv.errorsText(validate.errors)}`);
    if (meta.key !== entry.name) throw new Error(`${relativePath}: directory must equal meta.key`);
    if (!/^[a-z][a-z0-9-]{0,29}$/.test(meta.key)) throw new Error(`${relativePath}: invalid plugin key`);
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(meta.version)) throw new Error(`${relativePath}: invalid version`);
    for (const hook of ["buildSubmitRequest", "parseSubmitResponse", "buildQueryRequest", "parseTaskResult"]) {
      if (typeof module[hook] !== "function") throw new Error(`${relativePath}: missing ${hook}`);
    }
    for (const [model, variants] of Object.entries(meta.modelVariants || {})) {
      if (!meta.models.includes(model) || variants.some((value) => value.trim() !== value || !value.trim()))
        throw new Error(`${relativePath}: invalid model variants`);
    }
    const profiled = new Set();
    for (const profile of meta.usageProfiles || []) {
      for (const model of profile.models) {
        if (!meta.models.includes(model) || profiled.has(model)) throw new Error(`${relativePath}: invalid usage profile membership`);
        profiled.add(model);
      }
    }
    plugins.push({ meta, relativePath, source: await readFile(file) });
  }
  if (!plugins.length) throw new Error("No plugins found");
  return plugins;
}
