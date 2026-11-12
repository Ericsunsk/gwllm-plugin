import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../scripts/build-index.mjs";
import { loadPlugins } from "../scripts/plugins.mjs";
import * as plugin from "../plugins/openai-video/plugin.js";

const base = { baseUrl: "https://upstream.example", apiKey: "test-key", model: "seedance-2.0", upstreamModel: "provider/mapped-id" };
const image = "https://cdn.example/reference.png";
const surfaces = {
  video: (value, model = base.model) => plugin.protocols.openai_video.decodeRequest({ model, body: { kind: "json", value } }),
  multipart: (value, model = base.model, files = []) =>
    plugin.protocols.openai_video.decodeRequest({
      model,
      body: {
        kind: "multipart",
        fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, [key === "metadata" ? JSON.stringify(entry) : String(entry)]])),
        files,
      },
    }),
  responses: (value, model = base.model) => plugin.protocols.openai_responses.decodeRequest({ model, body: { kind: "json", value } }),
};

test("OpenAI Video manifest and local index coexist with Video Generation without taking native routes or legacy channels", async () => {
  const plugins = await loadPlugins(fileURLToPath(new URL("../", import.meta.url)));
  assert.deepEqual(
    plugins.map(({ meta }) => meta.key),
    ["openai-video", "video-generation"]
  );
  assert.equal(plugin.meta.version, "1.0.3");
  assert.equal(plugin.meta.icon, "OpenAI");
  assert.equal(plugin.meta.routes, undefined);
  assert.equal(plugin.meta.channelTypes, undefined);
  assert.deepEqual(plugin.meta.protocols, [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"]);
  assert.deepEqual(plugin.meta.models, ["minimax-h3", "seedance-2.0", "seedance-2.0-fast", "seedance-2.0-mini", "seedance-2.5", "veo-3.1", "wan-3.0"]);
  const revision = "a".repeat(40);
  const index = buildIndex(plugins, null, "Ericsunsk/gwllm-plugin", revision);
  const entry = index.plugins.find(({ key }) => key === "openai-video");
  const source = await readFile(new URL("../plugins/openai-video/plugin.js", import.meta.url));
  assert.deepEqual(entry.models, plugin.meta.models);
  assert.equal(entry.versions[0].sha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(entry.versions[0].path, `https://raw.githubusercontent.com/Ericsunsk/gwllm-plugin/${revision}/plugins/openai-video/plugin.js`);
});

test("model definitions expose canonical names, resolution variants and complete matching usage profiles", () => {
  assert.deepEqual(plugin.meta.modelVariants, Object.fromEntries(plugin.meta.models.map((model) => [model, ["480p", "720p", "768p", "1080p", "1440p", "4k"]])));
  for (const model of plugin.meta.models) {
    const profile = plugin.meta.usageProfiles.find((entry) => entry.models.includes(model));
    assert.deepEqual(profile.schema.resolution.enum, plugin.meta.modelVariants[model]);
    assert.equal(profile.schema.resolution.modelVariant, true);
    assert.deepEqual(Object.keys(profile.schema.resolution.enumLabels), plugin.meta.modelVariants[model]);
    assert.equal(profile.schema.seconds.unit, "second");
    assert.equal(profile.schema.seconds.description.en, "Video generation unit price");
    const defaultResolution = model === "minimax-h3" ? "768p" : "720p";
    assert.equal(profile.examples[0].facts.resolution, defaultResolution);
    for (const decode of Object.values(surfaces)) {
      const defaults = decode({ prompt: "p" }, model);
      assert.equal(defaults.modelVariant, defaultResolution);
      const ctx = { ...base, model, requestBody: defaults.requestBody };
      assert.equal(plugin.buildSubmitRequest(ctx).body.size, model === "minimax-h3" ? "1280x768" : "1280x720");
      assert.deepEqual(plugin.extractUsage(ctx), profile.examples[0].facts);
    }
    for (const resolution of plugin.meta.modelVariants[model]) {
      const intent = surfaces.video({ prompt: "p", resolution, seconds: 6 }, model.toUpperCase());
      assert.equal(intent.model, model);
      assert.equal(intent.modelVariant, resolution);
      const ctx = { ...base, model: intent.model, requestBody: intent.requestBody };
      assert.equal(plugin.buildSubmitRequest(ctx).body.model, base.upstreamModel);
      assert.deepEqual(plugin.extractUsage(ctx), { seconds: 6, resolution });
    }
  }
  assert.equal(surfaces.video({ prompt: "p", size: "1080p" }, "seedance-2.0-fast").modelVariant, "1080p");
  assert.throws(() => surfaces.video({ prompt: "p" }, "unknown"), /Unsupported.*model/);
});

test("public model IDs reject old Wan spelling and never normalize mapped upstream identifiers", () => {
  assert.equal(plugin.meta.author.name, "QuantumNous");
  for (const decode of Object.values(surfaces)) {
    assert.throws(() => decode({ prompt: "p" }, "wan3.0"), /Unsupported.*model/);
    const intent = decode({ prompt: "p" }, "MINIMAX-H3");
    assert.equal(intent.model, "minimax-h3");
    const upstreamModel = "Vendor/MiniMax-H3_Wan3.0";
    assert.equal(plugin.buildSubmitRequest({ ...base, model: intent.model, upstreamModel, requestBody: intent.requestBody }).body.model, upstreamModel);
    assert.equal(decode({ prompt: "p" }, "wan-3.0").model, "wan-3.0");
  }
});

test("Wan 3.0 shares resolution candidates across JSON, multipart and Responses and rejects unsupported sizes", () => {
  assert.deepEqual(plugin.meta.modelVariants["wan-3.0"], ["480p", "720p", "768p", "1080p", "1440p", "4k"]);
  const profile = plugin.meta.usageProfiles.find((entry) => entry.models.includes("wan-3.0"));
  assert.deepEqual(profile.schema.resolution.enum, ["480p", "720p", "768p", "1080p", "1440p", "4k"]);
  assert.deepEqual(Object.keys(profile.schema.resolution.enumLabels), ["480p", "720p", "768p", "1080p", "1440p", "4k"]);
  assert.ok(plugin.meta.modelVariants["minimax-h3"].includes("1440p"));
  assert.ok(plugin.meta.modelVariants["seedance-2.5"].includes("1440p"));
  for (const decode of Object.values(surfaces)) {
    assert.equal(decode({ prompt: "p" }, "wan-3.0").modelVariant, "720p");
    for (const size of ["8K", "7680x4320", "4320x7680"]) {
      assert.throws(() => decode({ prompt: "p", size }, "wan-3.0"), /[Uu]nsupported video (size|resolution)/);
    }
    for (const [size, expectedSize] of [
      ["480P", "854x480"],
      ["854x480", "854x480"],
      ["480x854", "480x854"],
    ]) {
      const intent = decode({ prompt: "p", size }, "wan-3.0");
      const ctx = { ...base, model: intent.model, requestBody: intent.requestBody };
      const request = plugin.buildSubmitRequest(ctx);
      assert.equal(intent.modelVariant, "480p");
      assert.equal(request.body.model, base.upstreamModel);
      assert.equal(request.body.size, expectedSize);
      assert.deepEqual(plugin.extractUsage(ctx), { seconds: 5, resolution: "480p" });
      assert.deepEqual(plugin.extractUsageOnComplete(ctx, {}, request.body), { seconds: 5, resolution: "480p" });
    }
  }
  const wan = { ...base, model: "wan-3.0", requestBody: { prompt: "p", size: "8k" } };
  assert.throws(() => plugin.buildSubmitRequest(wan), /[Uu]nsupported video (size|resolution)/);
  assert.throws(() => plugin.extractUsage(wan), /[Uu]nsupported video (size|resolution)/);
  assert.equal(plugin.extractUsageOnComplete(wan, {}, { size: "7680x4320" }), null);
});

test("Seedance 2.5 accepts shared 1440p, and Veo 3.1 routes and bills 4k consistently", () => {
  for (const decode of Object.values(surfaces)) {
    assert.equal(decode({ prompt: "p", size: "1440p" }, "seedance-2.5").modelVariant, "1440p");
    const defaults = decode({ prompt: "p" }, "veo-3.1");
    assert.equal(defaults.modelVariant, "720p");
    assert.equal(defaults.requestBody.seconds, 5);
    for (const [size, expectedSize] of [
      ["4K", "3840x2160"],
      ["3840x2160", "3840x2160"],
      ["2160x3840", "2160x3840"],
    ]) {
      const intent = decode({ prompt: "p", size, seconds: 8 }, "veo-3.1");
      const ctx = { ...base, model: intent.model, requestBody: intent.requestBody };
      assert.equal(intent.modelVariant, "4k");
      assert.deepEqual(plugin.buildSubmitRequest(ctx).body, { model: base.upstreamModel, prompt: "p", seconds: 8, size: expectedSize });
      assert.deepEqual(plugin.extractUsage(ctx), { seconds: 8, resolution: "4k" });
      assert.deepEqual(plugin.extractUsageOnComplete(ctx, {}, { seconds: 8, size }), { seconds: 8, resolution: "4k" });
    }
  }
  const seedance = { ...base, model: "seedance-2.5", requestBody: { prompt: "p", size: "8k" } };
  assert.throws(() => plugin.buildSubmitRequest(seedance), /[Uu]nsupported video (size|resolution)/);
  assert.throws(() => plugin.extractUsage(seedance), /[Uu]nsupported video (size|resolution)/);
  assert.equal(plugin.extractUsageOnComplete(seedance, {}, { size: "7680x4320" }), null);
});

for (const [name, decode] of Object.entries(surfaces)) {
  test(`${name}: emitted dimensions, mapped model and billed duration derive from the same normalized request`, () => {
    for (const [input, resolution, size] of [
      ["720P", "720p", "1280x720"],
      ["720x1280", "720p", "720x1280"],
      ["854x480", "480p", "854x480"],
      ["1080x1920", "1080p", "1080x1920"],
      ["4K", "4k", "3840x2160"],
    ]) {
      const value = { prompt: "p", size: input, resolution, duration: 8, input_reference: image, metadata: { note: "kept", seed: 0 } };
      const intent = decode(value);
      const ctx = { ...base, requestBody: intent.requestBody };
      const request = plugin.buildSubmitRequest(ctx);
      assert.equal(intent.modelVariant, resolution);
      assert.equal(intent.action, "image_to_video");
      assert.equal(request.url, "https://upstream.example/v1/videos");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.Authorization, "Bearer test-key");
      assert.deepEqual(request.body, { model: base.upstreamModel, prompt: "p", seconds: 8, size, input_reference: image, metadata: { note: "kept", seed: 0 } });
      assert.deepEqual(plugin.extractUsage(ctx), { seconds: 8, resolution });
      assert.deepEqual(plugin.extractUsageOnComplete(base, {}, request.body), { seconds: 8, resolution });
    }
    const defaultIntent = decode({ prompt: "p" });
    assert.deepEqual(defaultIntent.requestBody, { model: base.model, prompt: "p", seconds: 5, size: "1280x720" });
    for (const seconds of [1, 3600]) assert.equal(decode({ prompt: "p", seconds }).requestBody.seconds, seconds);
    assert.equal(decode({ prompt: "p", seconds: 8, duration: 8 }).requestBody.seconds, 8);
    assert.throws(() => decode({ prompt: "p", seconds: 8, duration: 9 }), /must match/);
    assert.throws(() => decode({ prompt: "p", size: "1920x1080", resolution: "720p" }), /must match/);
    assert.throws(() => decode({ prompt: "p", size: "1000x720" }), /Unsupported video size/);
    for (const seconds of [0, -1, 3601, 1.5, "NaN", "", Infinity, null, true, [], {}]) {
      assert.throws(() => decode({ prompt: "p", seconds }), /duration must be an integer/);
    }
    for (const key of ["seconds", "duration", "size", "resolution", "n", "quality", "count", "batch_size"]) {
      assert.throws(() => decode({ prompt: "p", metadata: { [key]: "999999" } }), /Unsupported generation parameter in metadata/);
    }
    for (const key of ["n", "quality", "count", "batch_size"]) assert.throws(() => decode({ prompt: "p", [key]: 2 }), /Unsupported generation parameter/);
  });
}

test("multipart streams one opaque reference file with normalized and billed scalar parts", () => {
  const file = { field: "input_reference", ref: "request_file:input_reference", filename: "one.png", mimeType: "image/png" };
  const intent = surfaces.multipart({ prompt: "p", duration: 9, size: "1080x1920", metadata: { note: "keep", seed: 0 } }, base.model, [file]);
  assert.equal(intent.action, "image_to_video");
  const ctx = { ...base, requestBody: intent.requestBody, files: [file] };
  const request = plugin.buildSubmitRequest(ctx);
  assert.equal(request.bodyType, "multipart");
  assert.equal(request.headers["Content-Type"], undefined);
  assert.deepEqual(Object.fromEntries(request.parts.filter((part) => !part.fileRef).map(({ name, value }) => [name, value])), {
    model: base.upstreamModel,
    prompt: "p",
    seconds: 9,
    size: "1080x1920",
    metadata: '{"note":"keep","seed":0}',
  });
  assert.deepEqual(
    request.parts.filter((part) => part.fileRef),
    [{ name: "input_reference", fileRef: file.ref, filename: file.filename, mimeType: file.mimeType }]
  );
  assert.deepEqual(plugin.extractUsage(ctx), { seconds: 9, resolution: "1080p" });
  assert.throws(() => surfaces.multipart({ prompt: "p" }, base.model, [file, { ...file, ref: file.ref + "#1" }]), /Only one/);
  assert.throws(() => surfaces.multipart({ prompt: "p", input_reference: image }, base.model, [file]), /Only one/);
  assert.throws(() => surfaces.multipart({ prompt: "p" }, base.model, [{ ...file, field: "wrong" }]), /Unexpected file field/);
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: base.model, body: { kind: "multipart", fields: { prompt: ["p"], seconds: ["5", "6"] } } }),
    /provided once/
  );
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: base.model, body: { kind: "multipart", fields: { prompt: ["p"], metadata: ["broken"] } } }),
    /JSON object string/
  );
});

test("Responses extracts one image and text without dropping extra reference images silently", () => {
  const intent = surfaces.responses({
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "first" },
          { type: "input_text", text: "second" },
          { type: "input_image", image_url: image },
        ],
      },
    ],
    seconds: 7,
  });
  assert.deepEqual(intent.requestBody, { model: base.model, prompt: "first\nsecond", seconds: 7, size: "1280x720", input_reference: image });
  assert.throws(() => surfaces.responses({ input: "p", images: [image, "https://cdn.example/second.png"] }), /Only one/);
  assert.throws(() => surfaces.responses({ input: "p", images: "wrong" }), /images must be an array/);
  assert.throws(() => surfaces.responses({ input: { text: "wrong" } }), /input must be a string or array/);
  assert.throws(() => surfaces.responses({ input: "p", input_reference: [image] }), /non-empty URL/);
  assert.throws(() => surfaces.video({ prompt: "p", input_reference: [image, image] }), /non-empty URL/);
  assert.throws(() => surfaces.video({ prompt: "p", images: [image, image] }), /single input_reference/);
  assert.throws(() => surfaces.video({ prompt: "p", metadata: [] }), /metadata must be an object/);
  assert.throws(() => surfaces.video([]), /body must be an object/);
  assert.throws(() => surfaces.video({}), /prompt is required/);
});

test("standard submission, polling and GET/HEAD content use the same host paths on vendor and new_api", () => {
  for (const kind of [undefined, "vendor", "new_api"]) {
    const ctx = { ...base, upstream: kind ? { kind } : undefined, requestBody: surfaces.video({ prompt: "p" }).requestBody };
    assert.equal(plugin.buildSubmitRequest(ctx).url, `${base.baseUrl}/v1/videos`);
    assert.equal(plugin.buildQueryRequest({ ...ctx, taskId: "task/id" }).url, `${base.baseUrl}/v1/videos/task%2Fid`);
    for (const method of ["GET", "HEAD"]) {
      assert.deepEqual(plugin.buildContentRequest({ ...ctx, artifactKey: "video", upstreamTaskId: "task/id", clientRequest: { method } }), {
        url: `${base.baseUrl}/v1/videos/task%2Fid/content`,
        method,
        headers: { Authorization: "Bearer test-key" },
      });
    }
  }
  assert.deepEqual(plugin.parseSubmitResponse({}, { body: { id: "video-id", status: "queued" } }), {
    taskId: "video-id",
    taskData: { id: "video-id", status: "queued" },
  });
  assert.equal(plugin.parseSubmitResponse({}, { body: { id: "id", status: "completed" } }).immediate.status, "SUCCESS");
  assert.equal(
    plugin.parseSubmitResponse({}, { body: { id: "id", status: "failed", error: { message: "failed upstream" } } }).immediate.reason,
    "failed upstream"
  );
  assert.throws(() => plugin.parseSubmitResponse({}, { body: { task_id: "nonstandard" } }), /video id/);
  for (const [status, expected] of [
    ["queued", "QUEUED"],
    ["pending", "QUEUED"],
    ["processing", "IN_PROGRESS"],
    ["in_progress", "IN_PROGRESS"],
    ["completed", "SUCCESS"],
    ["failed", "FAILURE"],
    ["cancelled", "FAILURE"],
    ["future-status", "UNKNOWN"],
    ["constructor", "UNKNOWN"],
    [undefined, "UNKNOWN"],
  ]) {
    const result = plugin.parseTaskResult({}, { status, progress: 25, error: { message: "upstream failed" } });
    assert.equal(result.status, expected);
    assert.equal(result.progress, "25%");
    if (expected === "UNKNOWN") assert.match(result.reason, /Unrecognized/);
    if (expected === "FAILURE") assert.equal(result.reason, "upstream failed");
  }
  assert.deepEqual(plugin.listArtifacts({ status: "QUEUED" }), []);
  assert.deepEqual(plugin.listArtifacts({ status: "SUCCESS" }), [{ key: "video", type: "video", mimeType: "video/mp4" }]);
  assert.throws(() => plugin.buildContentRequest({ artifactKey: "wrong" }), /artifact_not_found/);
});

test("completion facts accept explicit measured zero and fractions, and retain reservations for invalid or missing usage", () => {
  for (const seconds of [0, 2.5, "8", 3600]) assert.deepEqual(plugin.extractUsageOnComplete(base, {}, { seconds }), { seconds: Number(seconds) });
  for (const seconds of [-1, 3601, Infinity, "NaN", "", null, true, [], {}]) assert.equal(plugin.extractUsageOnComplete(base, {}, { seconds }), null);
  assert.equal(plugin.extractUsageOnComplete(base, {}, {}), null);
  assert.deepEqual(plugin.extractUsageOnComplete(base, {}, { seconds: 0, duration: 8, size: "1080x1920" }), { seconds: 0, resolution: "1080p" });
  assert.deepEqual(plugin.extractUsageOnComplete(base, {}, { duration: 8, size: "bad" }), { seconds: 8 });
  assert.equal(plugin.extractUsageOnComplete({ model: "seedance-2.0-fast", upstreamModel: "provider/id" }, {}, { size: "7680x4320" }), null);
  assert.equal(plugin.extractUsage({ ...base, usagePurpose: "billing_ratios" }), null);
  assert.throws(() => plugin.buildSubmitRequest({ ...base, requestBody: { prompt: "p", seconds: 999999 } }), /duration must be an integer/);
  assert.throws(() => plugin.extractUsage({ ...base, requestBody: { prompt: "p", seconds: 999999 } }), /duration must be an integer/);
});

test("Responses rendering uses signed host artifacts and deduplicates progress and terminal output", () => {
  const renderer = plugin.protocols.openai_responses;
  const ctx = { artifacts: { video: { url: 'https://gateway.example/content?a=1&b="q"' } } };
  const progress = renderer.renderEvents({}, { status: "IN_PROGRESS", progress: "25%" }, null);
  assert.deepEqual(progress.events, [{ type: "progress", message: "in_progress", progress: 25 }]);
  assert.deepEqual(renderer.renderEvents({}, { status: "IN_PROGRESS", progress: "25%" }, progress.state).events, []);
  const terminal = renderer.renderEvents(ctx, { status: "SUCCESS" }, progress.state);
  assert.equal(terminal.done, true);
  assert.match(terminal.events[0].data, /&amp;b=&quot;q&quot;/);
  assert.deepEqual(renderer.renderEvents(ctx, { status: "SUCCESS" }, terminal.state).events, []);
  assert.equal(renderer.renderFinal(ctx, {}).output[0].content[0].text, terminal.events[0].data);
  assert.equal(renderer.renderEvents({}, { status: "FAILURE", fail_reason: "upstream failed" }, null).events[0].message, "upstream failed");
  assert.throws(() => renderer.renderFinal({}, {}), /artifact is unavailable/);
  assert.deepEqual(plugin.protocols.openai_video.render({}, { data: { id: "public-id", metadata: { info: "kept" } } }), {
    id: "public-id",
    metadata: { info: "kept" },
  });
});
