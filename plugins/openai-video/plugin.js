// Adapted from QuantumNous / new-api's Sora plugin under AGPL-3.0-or-later.
// This independently maintained plugin defines its own model and request contract.
const DURATION = { default: 5, min: 1, max: 3600 };
const MODEL_DEFINITIONS = {
  "minimax-h3": { resolutions: ["768p", "1080p", "1440p"], seconds: DURATION },
  "seedance-2.0": { resolutions: ["720p", "480p", "1080p", "4k"], seconds: DURATION },
  "seedance-2.0-fast": { resolutions: ["720p", "480p"], seconds: DURATION },
  "seedance-2.0-mini": { resolutions: ["720p", "480p"], seconds: DURATION },
  "seedance-2.5": { resolutions: ["720p", "480p", "1080p", "1440p"], seconds: DURATION },
  "veo-3.1": { resolutions: ["720p", "1080p"], seconds: DURATION },
  "wan-3.0": { resolutions: ["720p", "1080p", "1440p"], seconds: DURATION },
};
const RESOLUTION_DIMENSIONS = {
  "480p": "854x480",
  "720p": "1280x720",
  "768p": "1280x768",
  "1080p": "1920x1080",
  "1440p": "2560x1440",
  "4k": "3840x2160",
};
const MODEL_NAMES = Object.keys(MODEL_DEFINITIONS);
const SECONDS_FIELD = { type: "number", unit: "second", description: { en: "Video generation unit price", zh: "视频生成单价" } };

export const meta = {
  apiVersion: 1,
  key: "openai-video",
  name: "OpenAI Video",
  icon: "OpenAI",
  version: "1.0.0",
  author: { name: "QuantumNous" },
  description: { en: "Custom video models via the OpenAI Videos API", zh: "通过 OpenAI Videos 接口调用自定义视频模型" },
  models: MODEL_NAMES,
  modelVariants: Object.fromEntries(MODEL_NAMES.map((model) => [model, MODEL_DEFINITIONS[model].resolutions])),
  fetchMode: "per_task",
  upstreams: ["vendor", "new_api"],
  usageSchema: {},
  usageProfiles: MODEL_NAMES.map((model) => {
    const definition = MODEL_DEFINITIONS[model];
    return {
      models: [model],
      schema: {
        seconds: SECONDS_FIELD,
        resolution: {
          enum: definition.resolutions,
          enumLabels: Object.fromEntries(
            definition.resolutions.map((resolution) => [resolution, { en: resolution.toUpperCase(), zh: resolution.toUpperCase() }])
          ),
          description: { en: "Output video resolution", zh: "输出视频分辨率" },
        },
      },
      examples: [{ label: model, facts: { seconds: definition.seconds.default, resolution: definition.resolutions[0] } }],
    };
  }),
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function videoSize(value) {
  const normalized = text(value).toLowerCase();
  for (const [resolution, dimensions] of Object.entries(RESOLUTION_DIMENSIONS)) {
    const portrait = dimensions.split("x").reverse().join("x");
    if (normalized === resolution) return { resolution, size: dimensions };
    if (normalized === dimensions || normalized === portrait) return { resolution, size: normalized };
  }
  throw new Error("Unsupported video size or resolution");
}

function requestSeconds(value, definition) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim()))
    throw new Error("Video duration must be an integer between " + definition.min + " and " + definition.max + " seconds");
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < definition.min || seconds > definition.max)
    throw new Error("Video duration must be an integer between " + definition.min + " and " + definition.max + " seconds");
  return seconds;
}

// Both decoders and driver hooks cross this seam: the body sent and billed is identical.
function normalizeRequest(req, model, files) {
  if (!object(req)) throw new Error("Request body must be an object");
  const canonical = MODEL_NAMES.find((name) => name.toLowerCase() === text(model).toLowerCase());
  if (!canonical) throw new Error("Unsupported OpenAI Video model");
  const definition = MODEL_DEFINITIONS[canonical];
  for (const key of ["n", "quality", "count", "batch_size"]) {
    if (req[key] !== undefined) throw new Error("Unsupported generation parameter: " + key);
  }
  const prompt = text(req.prompt);
  if (!prompt) throw new Error("Video prompt is required");
  const seconds =
    req.seconds === undefined
      ? req.duration === undefined
        ? definition.seconds.default
        : requestSeconds(req.duration, definition.seconds)
      : requestSeconds(req.seconds, definition.seconds);
  if (req.seconds !== undefined && req.duration !== undefined && seconds !== requestSeconds(req.duration, definition.seconds))
    throw new Error("seconds and duration must match");
  const output = videoSize(req.size === undefined ? (req.resolution === undefined ? definition.resolutions[0] : req.resolution) : req.size);
  if (req.resolution !== undefined && videoSize(req.resolution).resolution !== output.resolution) throw new Error("size and resolution must match");
  if (!definition.resolutions.includes(output.resolution)) throw new Error(canonical + " resolution must be one of " + definition.resolutions.join(", "));
  const uploaded = files || [];
  for (const file of uploaded) {
    if (file.field !== "input_reference") throw new Error("Unexpected file field: " + file.field);
  }
  if (uploaded.length > 1 || (uploaded.length && req.input_reference !== undefined)) throw new Error("Only one input_reference is supported");
  if (req.input_reference !== undefined && !text(req.input_reference)) throw new Error("input_reference must be a non-empty URL string");
  const body = { model: canonical, prompt, seconds, size: output.size };
  if (req.input_reference !== undefined) body.input_reference = text(req.input_reference);
  if (req.metadata !== undefined) {
    if (!object(req.metadata)) throw new Error("metadata must be an object");
    // Metadata is descriptive, never an alternative source of generation parameters.
    for (const key of ["seconds", "duration", "size", "resolution", "n", "quality", "count", "batch_size"]) {
      if (Object.prototype.hasOwnProperty.call(req.metadata, key)) throw new Error("Unsupported generation parameter in metadata: " + key);
    }
    body.metadata = req.metadata;
  }
  return {
    kind: "submit",
    model: canonical,
    modelVariant: output.resolution,
    action: uploaded.length || body.input_reference ? "image_to_video" : "text_to_video",
    requestBody: body,
  };
}

export function buildSubmitRequest(ctx) {
  const files = ctx.files || [];
  const intent = normalizeRequest(ctx.requestBody, ctx.model, files);
  const body = Object.assign({}, intent.requestBody, { model: text(ctx.upstreamModel) || intent.model });
  const headers = { Authorization: "Bearer " + ctx.apiKey, Accept: "application/json" };
  if (files.length) {
    const parts = [];
    for (const [name, value] of Object.entries(body)) parts.push({ name, value: name === "metadata" ? JSON.stringify(value) : value });
    const file = files[0];
    parts.push({ name: "input_reference", fileRef: file.ref, filename: file.filename, mimeType: file.mimeType });
    return { url: ctx.baseUrl + "/v1/videos", method: "POST", headers, bodyType: "multipart", parts, action: intent.action };
  }
  headers["Content-Type"] = "application/json";
  return { url: ctx.baseUrl + "/v1/videos", method: "POST", headers, body, action: intent.action };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const intent = normalizeRequest(ctx.requestBody, ctx.model, ctx.files);
  return { seconds: intent.requestBody.seconds, resolution: intent.modelVariant };
}

export function parseSubmitResponse(ctx, response) {
  const body = object(response.body);
  const id = body && text(body.id);
  if (!id) throw new Error("Video provider did not return a video id");
  const parsed = parseTaskResult(ctx, body);
  const result = { taskId: id, taskData: body };
  if (parsed.status === "SUCCESS" || parsed.status === "FAILURE") result.immediate = parsed;
  return result;
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Authorization: "Bearer " + ctx.apiKey, Accept: "application/json" },
  };
}

export function parseTaskResult(_ctx, body) {
  const statuses = {
    queued: "QUEUED",
    pending: "QUEUED",
    processing: "IN_PROGRESS",
    in_progress: "IN_PROGRESS",
    completed: "SUCCESS",
    failed: "FAILURE",
    cancelled: "FAILURE",
    canceled: "FAILURE",
  };
  const status = text(body && body.status).toLowerCase();
  const result = { status: Object.prototype.hasOwnProperty.call(statuses, status) ? statuses[status] : "UNKNOWN" };
  if (result.status === "UNKNOWN") result.reason = "Unrecognized video status: " + status;
  if (result.status === "FAILURE") result.reason = text(body && body.error && body.error.message) || "Video generation failed";
  const progress = body && body.progress;
  if (typeof progress === "number" && Number.isFinite(progress) && progress >= 0 && progress < 100) result.progress = progress + "%";
  return result;
}

export function extractUsageOnComplete(task, _result, body) {
  const facts = {};
  if (!object(body)) return null;
  const seconds = body.seconds === undefined ? body.duration : body.seconds;
  if (
    (typeof seconds === "number" || (typeof seconds === "string" && seconds.trim())) &&
    Number.isFinite(Number(seconds)) &&
    Number(seconds) >= 0 &&
    Number(seconds) <= 3600
  )
    facts.seconds = Number(seconds);
  const canonical = MODEL_NAMES.find((name) => name.toLowerCase() === text(task.model).toLowerCase());
  if (canonical && body.size !== undefined) {
    try {
      const output = videoSize(body.size);
      if (MODEL_DEFINITIONS[canonical].resolutions.includes(output.resolution)) facts.resolution = output.resolution;
    } catch (e) {
      // Invalid upstream dimensions retain the frozen submission resolution.
    }
  }
  return Object.keys(facts).length ? facts : null;
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" ? [{ key: "video", type: "video", mimeType: "video/mp4" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  if (ctx.clientRequest.method !== "GET" && ctx.clientRequest.method !== "HEAD") throw new Error("Unsupported content method");
  return {
    url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.upstreamTaskId) + "/content",
    method: ctx.clientRequest.method,
    headers: { Authorization: "Bearer " + ctx.apiKey },
  };
}

function videoText(ctx) {
  const url = text(ctx.artifacts && ctx.artifacts.video && ctx.artifacts.video.url);
  if (!url) throw new Error("Video artifact is unavailable");
  return '<video controls src="' + url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + '"></video>';
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
      if (ctx.body.kind === "json") {
        if (object(ctx.body.value) && (ctx.body.value.image !== undefined || ctx.body.value.images !== undefined))
          throw new Error("Use a single input_reference for OpenAI Video");
        return normalizeRequest(ctx.body.value, ctx.model);
      }
      const req = {};
      for (const [name, values] of Object.entries(ctx.body.fields || {})) {
        if (values.length !== 1) throw new Error(name + " must be provided once");
        req[name] = values[0];
      }
      if (req.image !== undefined || req.images !== undefined) throw new Error("Use a single input_reference for OpenAI Video");
      if (req.metadata !== undefined) {
        try {
          req.metadata = JSON.parse(req.metadata);
        } catch (e) {
          throw new Error("metadata must be a JSON object string", { cause: e });
        }
      }
      return normalizeRequest(req, ctx.model, ctx.body.files);
    },
    render: function (_ctx, task) {
      // The host overwrites public identity and status and redacts inline video data.
      return object(task.data) || {};
    },
  },
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!object(req)) throw new Error("Request body must be an object");
      if (req.input !== undefined && typeof req.input !== "string" && !Array.isArray(req.input)) throw new Error("input must be a string or array");
      if (req.images !== undefined && !Array.isArray(req.images)) throw new Error("images must be an array");
      const texts = [];
      const images = [];
      for (const image of [req.input_reference, req.image].concat(req.images || [])) {
        if (image !== undefined) {
          if (!text(image)) throw new Error("Reference images must be non-empty URL strings");
          if (!images.includes(text(image))) images.push(text(image));
        }
      }
      for (const item of typeof req.input === "string" ? [req.input] : req.input || []) {
        if (typeof item === "string") {
          texts.push(item);
          continue;
        }
        if (!object(item)) continue;
        const content = item.content === undefined ? [item] : Array.isArray(item.content) ? item.content : [item.content];
        for (const part of content) {
          if (typeof part === "string") texts.push(part);
          else if (object(part) && ["input_text", "text"].includes(part.type) && typeof part.text === "string") texts.push(part.text);
          else if (object(part) && ["input_image", "image_url"].includes(part.type)) {
            const image = typeof part.image_url === "string" ? part.image_url : part.image_url && part.image_url.url;
            if (!text(image)) throw new Error("Reference images must be non-empty URL strings");
            if (!images.includes(text(image))) images.push(text(image));
          }
        }
      }
      if (images.length > 1) throw new Error("Only one input_reference is supported");
      const normalized = Object.assign({}, req, { prompt: texts.filter((value) => text(value)).join("\n") || req.prompt });
      if (images.length) normalized.input_reference = images[0];
      return normalizeRequest(normalized, ctx.model);
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const value = Number(String(task.progress || "").replace("%", ""));
      const progress = Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      const state = { status, progress };
      if (status === "SUCCESS")
        return { events: previousState && previousState.status === status ? [] : [{ type: "output", data: videoText(ctx) }], state, done: true };
      if (status === "FAILURE") return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "Task failed" }], state, done: true };
      if (previousState && previousState.status === status && previousState.progress === progress) return { events: [], state, done: false };
      const event = { type: "progress", message: status.toLowerCase() };
      if (progress !== null) event.progress = progress;
      return { events: [event], state, done: false };
    },
    renderFinal: function (ctx, _task) {
      return {
        output: [
          { type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: videoText(ctx), annotations: [], logprobs: [] }] },
        ],
        metadata: { vendor: "openai-video" },
      };
    },
  },
};
