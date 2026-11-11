import assert from "node:assert/strict";
import test from "node:test";
import * as plugin from "../plugins/video-generation/plugin.js";

const base = { baseUrl: "https://upstream.example", apiKey: "test-key", model: "minimax-h3", upstreamModel: "mapped/provider-id" };
const image = "https://cdn.example/reference.jpg";

const surfaces = {
  native: (body, model) => plugin.native.createTask({ params: { model }, body: { kind: "json", value: body } }),
  responses: (body, model) => plugin.protocols.openai_responses.decodeRequest({ model, body: { kind: "json", value: body } }),
  video: (body, model) => plugin.protocols.openai_video.decodeRequest({ model, body: { kind: "json", value: body } }),
};

test("public model IDs are canonical, old Wan spelling is rejected and upstream identifiers stay opaque", () => {
  assert.equal(plugin.meta.version, "2.0.1");
  assert.deepEqual(plugin.meta.models, ["minimax-h3", "seedance-2.0", "seedance-2.0-fast", "seedance-2.0-mini", "seedance-2.5", "veo-3.1", "wan-3.0"]);
  for (const decode of Object.values(surfaces)) {
    assert.throws(() => decode({ prompt: "p" }, "wan3.0"), /unsupported video generation model/);
    const intent = decode({ prompt: "p", images: [image] }, "MINIMAX-H3");
    assert.equal(intent.model, "minimax-h3");
    const upstreamModel = "Vendor/MiniMax-H3_Wan3.0";
    const ctx = { ...base, model: intent.model, upstreamModel, requestBody: intent.requestBody };
    assert.equal(plugin.buildSubmitRequest(ctx).body.model, upstreamModel);
    assert.match(plugin.buildSubmitRequest(ctx).url, /Vendor%2FMiniMax-H3_Wan3\.0$/);
    const wan = decode({ prompt: "p" }, "wan-3.0");
    assert.equal(wan.model, "wan-3.0");
  }
});

for (const [name, decode] of Object.entries(surfaces)) {
  test(`${name}: H3 resolution routing preserves mapped ID, normalized usage and request fields`, () => {
    for (const [input, resolution] of [
      ["768P", "768p"],
      ["1080P", "1080p"],
      ["1920x1080", "1080p"],
      ["1080x1920", "1080p"],
      ["1440P", "1440p"],
    ]) {
      const intent = decode({ prompt: "p", images: [image], size: input, duration: 10, metadata: { ratio: "16:9", seed: 0 } }, "minimax-h3");
      assert.equal(intent.model, "minimax-h3");
      assert.equal(intent.modelVariant, resolution);
      const ctx = { ...base, requestBody: intent.requestBody };
      const request = plugin.buildSubmitRequest(ctx);
      assert.equal(request.url, "https://upstream.example/v1/videos/generations/mapped%2Fprovider-id");
      assert.deepEqual(request.body, {
        model: base.upstreamModel,
        prompt: "p",
        seconds: 10,
        size: resolution.toUpperCase(),
        images: [image],
        ratio: "16:9",
        seed: 0,
      });
      assert.deepEqual(plugin.extractUsage(ctx), { seconds: 10, resolution });
      assert.deepEqual(plugin.extractUsageOnComplete(ctx, {}, { output: { seconds: 10, resolution: input } }), { seconds: 10, resolution });
    }
  });
}

test("model profiles normalize Seedance variants and enforce fixed duration and Veo quality", () => {
  assert.deepEqual(plugin.meta.modelVariants, {
    "minimax-h3": ["768p", "1080p", "1440p"],
    "seedance-2.0": ["720p", "480p", "1080p", "4k"],
    "seedance-2.0-fast": ["720p", "480p"],
    "seedance-2.0-mini": ["720p", "480p"],
    "seedance-2.5": ["720p", "480p", "1080p"],
    "veo-3.1": ["720p", "1080p", "4k"],
    "wan-3.0": ["720p", "480p", "1080p"],
  });
  for (const [model, resolutions] of Object.entries(plugin.meta.modelVariants)) {
    assert.ok(plugin.meta.models.includes(model));
    const profile = plugin.meta.usageProfiles.find((entry) => entry.models.includes(model));
    assert.deepEqual(profile.schema.resolution.enum, resolutions);
    assert.deepEqual(Object.keys(profile.schema.resolution.enumLabels), resolutions);
    for (const resolution of resolutions) {
      const body = { prompt: "p", resolution, images: model === "minimax-h3" ? [image] : [] };
      if (model === "veo-3.1") body.quality = resolution;
      const intent = surfaces.video(body, model);
      const ctx = { ...base, model, requestBody: intent.requestBody };
      const request = plugin.buildSubmitRequest(ctx);
      assert.equal(intent.modelVariant, resolution);
      assert.equal(request.body.model, base.upstreamModel);
      assert.equal(plugin.extractUsage(ctx).resolution, resolution);
      if (model.startsWith("seedance")) assert.equal(request.body.seconds, 5);
      if (model === "veo-3.1") assert.equal(plugin.extractUsage(ctx).quality, resolution);
    }
  }
  assert.throws(() => surfaces.video({ prompt: "p", seconds: 6 }, "seedance-2.5"), /duration must be 5/);
  assert.throws(() => surfaces.video({ prompt: "p", size: "1080p" }, "seedance-2.0-fast"), /resolution must be one of/);
  assert.throws(() => surfaces.video({ prompt: "p", size: "1080p", quality: "720p" }, "veo-3.1"), /resolution must match quality/);
});

test("Wan 3.0 supports 480p, 720p and 1080p across native and host protocols and rejects 1440p", () => {
  assert.deepEqual(plugin.meta.modelVariants["wan-3.0"], ["720p", "480p", "1080p"]);
  const profile = plugin.meta.usageProfiles.find((entry) => entry.models.includes("wan-3.0"));
  assert.deepEqual(profile.schema.resolution.enum, ["720p", "480p", "1080p"]);
  assert.deepEqual(Object.keys(profile.schema.resolution.enumLabels), ["720p", "480p", "1080p"]);
  assert.ok(plugin.meta.modelVariants["minimax-h3"].includes("1440p"));
  assert.ok(!plugin.meta.modelVariants["seedance-2.5"].includes("1440p"));
  for (const decode of Object.values(surfaces)) {
    assert.equal(decode({ prompt: "p" }, "wan-3.0").modelVariant, "720p");
    for (const size of ["1440P", "2560x1440", "1440x2560"]) {
      assert.throws(() => decode({ prompt: "p", size }, "wan-3.0"), /resolution must be one of/);
    }
    for (const size of ["480P", "854x480", "480x854"]) {
      const intent = decode({ prompt: "p", size }, "wan-3.0");
      const ctx = { ...base, model: intent.model, requestBody: intent.requestBody };
      const request = plugin.buildSubmitRequest(ctx);
      assert.equal(intent.modelVariant, "480p");
      assert.equal(request.body.model, base.upstreamModel);
      assert.equal(request.body.size, "480p");
      assert.deepEqual(plugin.extractUsage(ctx), { resolution: "480p" });
      assert.deepEqual(plugin.extractUsageOnComplete(ctx, {}, { output: { size } }), { resolution: "480p" });
    }
  }
  const wan = { ...base, model: "wan-3.0", requestBody: { prompt: "p", size: "1440p" } };
  assert.throws(() => plugin.buildSubmitRequest(wan), /resolution must be one of/);
  assert.throws(() => plugin.extractUsage(wan), /resolution must be one of/);
  assert.equal(plugin.extractUsageOnComplete(wan, {}, { output: { size: "1440p" } }), null);
});

test("Seedance 2.5 rejects 1440p, and Veo 3.1 routes and bills 4k consistently", () => {
  const profile = plugin.meta.usageProfiles.find((entry) => entry.models.includes("veo-3.1"));
  assert.deepEqual(profile.schema.quality.enum, ["720p", "1080p", "4k"]);
  assert.deepEqual(Object.keys(profile.schema), ["resolution", "quality"]);
  for (const decode of Object.values(surfaces)) {
    assert.throws(() => decode({ prompt: "p", size: "1440p" }, "seedance-2.5"), /resolution must be one of/);
    const defaults = decode({ prompt: "p" }, "veo-3.1");
    assert.equal(defaults.modelVariant, "720p");
    assert.deepEqual(plugin.extractUsage({ ...base, model: "veo-3.1", requestBody: defaults.requestBody }), profile.examples[0].facts);
    for (const size of ["4K", "3840x2160", "2160x3840"]) {
      const intent = decode({ prompt: "p", size }, "veo-3.1");
      const ctx = { ...base, model: intent.model, requestBody: intent.requestBody };
      assert.equal(intent.modelVariant, "4k");
      assert.deepEqual(plugin.buildSubmitRequest(ctx).body, { model: base.upstreamModel, prompt: "p", size: "4k", quality: "4k" });
      assert.deepEqual(plugin.extractUsage(ctx), { resolution: "4k", quality: "4k" });
      assert.deepEqual(plugin.extractUsageOnComplete(ctx, {}, { output: { size } }), { resolution: "4k" });
    }
    assert.throws(() => decode({ prompt: "p", size: "4k", quality: "1080p" }, "veo-3.1"), /resolution must match quality/);
  }
  const seedance = { ...base, model: "seedance-2.5", requestBody: { prompt: "p", size: "1440p" } };
  assert.throws(() => plugin.buildSubmitRequest(seedance), /resolution must be one of/);
  assert.throws(() => plugin.extractUsage(seedance), /resolution must be one of/);
  assert.equal(plugin.extractUsageOnComplete(seedance, {}, { output: { size: "1440p" } }), null);
});

test("billing quantities reject invalid durations and use only valid reported completion facts", () => {
  for (const seconds of [-1, 0, 4, 16, 1.5, "NaN", Infinity, 3601]) {
    assert.throws(() => surfaces.video({ prompt: "p", images: [image], seconds }, "minimax-h3"), /duration/);
  }
  assert.throws(() => surfaces.video({ prompt: "p" }, "minimax-h3"), /reference image/);
  assert.equal(plugin.extractUsage({ ...base, usagePurpose: "billing_ratios" }), null);
  assert.equal(plugin.extractUsageOnComplete(base, {}, { output: { seconds: 999999, resolution: "broken" } }), null);
  assert.deepEqual(plugin.extractUsageOnComplete({ model: "seedance-2.0" }, {}, { output: { seconds: 6, resolution: "720p" } }), { resolution: "720p" });
});

test("resolution precedence is identical for routing and usage", () => {
  for (const decode of Object.values(surfaces)) {
    for (const [body, resolution] of [
      [{ metadata: { resolution: "1080p" } }, "1080p"],
      [{ resolution: "720p", metadata: { resolution: "1080p" } }, "720p"],
      [{ size: "480p", metadata: { resolution: "1080p" } }, "480p"],
    ]) {
      const intent = decode({ prompt: "p", ...body }, "seedance-2.0");
      const ctx = { ...base, model: "seedance-2.0", requestBody: intent.requestBody };
      assert.equal(intent.modelVariant, resolution);
      assert.equal(plugin.buildSubmitRequest(ctx).body.size, resolution);
      assert.equal(plugin.extractUsage(ctx).resolution, resolution);
    }
  }
});

test("multipart preserves multiple opaque file references and metadata without decoding file bytes", () => {
  const files = [
    { field: "input_reference", ref: "request_file:input_reference", filename: "one.png", mimeType: "image/png" },
    { field: "input_reference", ref: "request_file:input_reference#1", filename: "two.png", mimeType: "image/png" },
  ];
  const body = { kind: "multipart", fields: { prompt: ["p"], size: ["1080P"], metadata: ['{"ratio":"16:9","seed":0}'] }, files };
  const intent = plugin.protocols.openai_video.decodeRequest({ model: base.model, body });
  assert.equal(intent.action, "image_to_video");
  assert.equal(intent.modelVariant, "1080p");
  assert.deepEqual(
    intent.requestBody.images.map((entry) => entry.__fileRef),
    files.map((file) => file.ref)
  );
  const request = plugin.buildSubmitRequest({ ...base, requestBody: intent.requestBody, files });
  assert.equal(request.bodyType, "multipart");
  assert.deepEqual(
    request.parts.filter((part) => part.fileRef).map((part) => part.fileRef),
    files.map((file) => file.ref)
  );
  assert.deepEqual(
    request.parts.find((part) => part.name === "seed"),
    { name: "seed", value: 0 }
  );
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: base.model, body: { ...body, fields: { ...body.fields, size: ["768P", "1080P"] } } }),
    /provided once/
  );
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: base.model, body: { ...body, files: [{ field: "wrong" }] } }), /unexpected file/);
});

test("submission, polling and content URLs distinguish vendor and new_api upstreams", () => {
  for (const kind of [undefined, "vendor", "new_api"]) {
    const ctx = { ...base, upstream: kind ? { kind } : undefined, requestBody: { prompt: "p", images: [image], size: "1080P" } };
    const prefix = base.baseUrl + (kind === "new_api" ? "/video-generation" : "");
    assert.equal(plugin.buildSubmitRequest(ctx).url, `${prefix}/v1/videos/generations/mapped%2Fprovider-id`);
    assert.equal(plugin.buildQueryRequest({ ...ctx, taskId: "task/id" }).url, `${prefix}/v1/videos/task%2Fid`);
    const content = plugin.buildContentRequest({ ...ctx, artifactKey: "video", upstreamTaskId: "task/id", clientRequest: { method: "HEAD" } });
    assert.equal(content.url, `${prefix}/v1/videos/task%2Fid/content`);
    assert.equal(content.method, "HEAD");
    assert.equal(content.headers.Authorization, "Bearer test-key");
  }
  for (const field of ["id", "task_id", "taskId", "request_id"]) {
    assert.equal(plugin.parseSubmitResponse({}, { body: { [field]: "public-gateway-id", status: "queued" } }).taskId, "public-gateway-id");
  }
  assert.equal(plugin.native.taskCreated({}, { task_id: "public-id", data: { id: "private-id" } }).id, "public-id");
  assert.throws(() => plugin.parseSubmitResponse({}, { body: { status: "queued" } }), /task id/);
  assert.throws(() => plugin.parseSubmitResponse({}, { body: { id: "id", status: "failed", error: { message: "provider failed" } } }), /provider failed/);
});

test("polling failure and unknown statuses stay explicit, and only successful tasks expose artifacts", () => {
  for (const [status, expected] of [
    ["queued", "IN_PROGRESS"],
    ["processing", "IN_PROGRESS"],
    ["completed", "SUCCESS"],
    ["cancelled", "FAILURE"],
    ["failed", "FAILURE"],
    ["other", "UNKNOWN"],
    [undefined, "UNKNOWN"],
  ]) {
    const result = plugin.parseTaskResult({}, { status, progress: 25, output: { url: "https://cdn.example/video.mp4" }, error: { message: "vendor error" } });
    assert.equal(result.status, expected);
    assert.equal(result.progress, "25%");
    if (expected === "FAILURE") assert.equal(result.reason, "vendor error");
    if (expected === "UNKNOWN") assert.match(result.reason, /unrecognized status/);
  }
  assert.deepEqual(plugin.listArtifacts({ status: "IN_PROGRESS" }), []);
  assert.deepEqual(plugin.listArtifacts({ status: "SUCCESS" }), [{ key: "video", type: "video", mimeType: "video/mp4" }]);
  assert.throws(() => plugin.buildContentRequest({ artifactKey: "missing" }), /artifact_not_found/);
});

test("Responses uses host artifacts and emits terminal output once", () => {
  const ctx = { artifacts: { video: { url: 'https://gateway.example/content?a=1&b="q"' } } };
  const renderer = plugin.protocols.openai_responses;
  const event = renderer.renderEvents(ctx, { status: "SUCCESS", progress: "100%" }, null);
  assert.equal(event.done, true);
  assert.match(event.events[0].data, /&amp;b=&quot;q&quot;/);
  assert.deepEqual(renderer.renderEvents(ctx, { status: "SUCCESS" }, event.state).events, []);
  assert.equal(renderer.renderEvents({}, { status: "FAILURE", fail_reason: "failed" }, null).events[0].message, "failed");
  assert.equal(renderer.renderFinal(ctx, {}).output[0].content[0].text, event.events[0].data);
});
