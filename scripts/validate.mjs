import { fileURLToPath } from "node:url";
import { loadPlugins } from "./plugins.mjs";

const plugins = await loadPlugins(fileURLToPath(new URL("../", import.meta.url)));
for (const { meta } of plugins) console.log(`Validated ${meta.key}@${meta.version} (${meta.models.length} models)`);
