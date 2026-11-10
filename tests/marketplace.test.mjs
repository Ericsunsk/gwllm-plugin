import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildIndex } from "../scripts/build-index.mjs";
import { meta } from "../plugins/video-generation/plugin.js";

const source = await readFile(new URL("../plugins/video-generation/plugin.js", import.meta.url));
const plugin = { meta, source, relativePath: "plugins/video-generation/plugin.js" };
const repository = "Ericsunsk/gwllm-plugin";
const revision = "a".repeat(40);

test("index v1 derives actual metadata and SHA256 with same-origin immutable commit paths", () => {
  const index = buildIndex([plugin], null, repository, revision);
  assert.equal(index.indexVersion, 1);
  assert.deepEqual(index.plugins[0].models, meta.models);
  assert.deepEqual(index.plugins[0].protocols, meta.protocols);
  assert.equal(index.plugins[0].latest, meta.version);
  const version = index.plugins[0].versions[0];
  assert.equal(version.sha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(version.kind, "task");
  assert.equal(version.minApiVersion, 1);
  const url = new URL(version.path, `https://raw.githubusercontent.com/${repository}/marketplace/index.json`);
  assert.equal(url.origin, "https://raw.githubusercontent.com");
  assert.equal(url.pathname, `/${repository}/${revision}/plugins/video-generation/plugin.js`);
});

test("republication preserves every path and hash and rejects a modified released version", () => {
  const previous = buildIndex([plugin], null, repository, revision);
  assert.deepEqual(buildIndex([plugin], previous, repository, "b".repeat(40)), previous);
  assert.throws(() => buildIndex([{ ...plugin, source: Buffer.concat([source, Buffer.from("\n")]) }], previous, repository, revision), /bump meta.version/);
  assert.throws(() => buildIndex([plugin], null, repository, "main"), /full commit SHA/);
});

test("a new version keeps historical releases unchanged and rollback is an activation choice", () => {
  const previous = buildIndex([plugin], null, repository, revision);
  const oldVersion = structuredClone(previous.plugins[0].versions[0]);
  const updated = { ...plugin, meta: { ...meta, version: "2.1.0" }, source: Buffer.from("new version") };
  const next = buildIndex([updated], previous, repository, "b".repeat(40));
  assert.equal(next.plugins[0].latest, "2.1.0");
  assert.equal(next.plugins[0].versions.length, 2);
  assert.deepEqual(next.plugins[0].versions[1], oldVersion);
  assert.deepEqual(buildIndex([plugin], next, repository, revision), next);
  assert.deepEqual(previous.plugins[0].versions, [oldVersion]);
});
