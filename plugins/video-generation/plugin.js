// Public profile names stay separate from the provider's model identifiers.
const H3_MODEL = "MiniMax-H3";
const SEEDANCE_2_MODEL = "seedance-2.0";
const SEEDANCE_MODEL = "seedance-2.5";
const VEO_MODEL = "veo-3.1";
const WAN_MODEL = "wan3.0";
const RESOLUTION_LABELS = {
  "480p": { en: "480P", zh: "480P" },
  "720p": { en: "720P", zh: "720P" },
  "1080p": { en: "1080P", zh: "1080P" },
  "768p": { en: "768P", zh: "768P" },
  "1440p": { en: "1440P", zh: "1440P" },
  "4k": { en: "4K", zh: "4K" },
};
const RESOLUTIONS = Object.keys(RESOLUTION_LABELS);
const MIN_SECONDS = 5;
const MAX_SECONDS = 15;
const DEFAULT_SECONDS = 5;

const VIDEO_SECONDS_FIELD = {
  type: "number",
  unit: "second",
  description: { en: "Video generation unit price", zh: "视频生成单价" },
};
const VIDEO_RESOLUTION_FIELD = {
  enum: RESOLUTIONS,
  enumLabels: RESOLUTION_LABELS,
  description: { en: "Output video resolution", zh: "输出视频分辨率" },
};

const PROFILES = {
  [H3_MODEL]: { kind: "h3", resolutions: ["768p", "1080p", "1440p"], seconds: [5, 15], requiresImages: true },
  [SEEDANCE_2_MODEL]: { kind: "fixed", resolutions: ["720p", "480p", "1080p", "4k"], seconds: [5] },
  [`${SEEDANCE_2_MODEL}-fast`]: { kind: "fixed", resolutions: ["720p", "480p"], seconds: [5] },
  [`${SEEDANCE_2_MODEL}-mini`]: { kind: "fixed", resolutions: ["720p", "480p"], seconds: [5] },
  [SEEDANCE_MODEL]: { kind: "fixed", resolutions: ["720p", "480p", "1080p", "1440p"], seconds: [5] },
  [VEO_MODEL]: { kind: "veo", resolutions: ["720p", "1080p"] },
  [WAN_MODEL]: { kind: "fixed", resolutions: ["720p", "1080p", "1440p"] },
};
const MODEL_NAMES = Object.keys(PROFILES);

function profileFor(model) {
  const normalized = trimmed(model).toLowerCase();
  const canonical = MODEL_NAMES.find((name) => name.toLowerCase() === normalized);
  return canonical ? PROFILES[canonical] : null;
}

function modelSchema(model) {
  const profile = PROFILES[model];
  const schema = {};
  if (profile.seconds) schema.seconds = VIDEO_SECONDS_FIELD;
  if (profile.resolutions) {
    const values = profile.resolutions;
    const enumLabels = {};
    for (const value of values) enumLabels[value] = VIDEO_RESOLUTION_FIELD.enumLabels[value];
    schema.resolution = Object.assign({}, VIDEO_RESOLUTION_FIELD, { enum: values, enumLabels: enumLabels });
  }
  if (profile.kind === "veo") schema.quality = { enum: ["720p", "1080p"], description: { en: "Video generation quality", zh: "视频生成画质" } };
  return schema;
}

function metaUsageExample(model) {
  const profile = PROFILES[model];
  const facts = {};
  if (profile.seconds) facts.seconds = profile.seconds[0];
  if (profile.resolutions) facts.resolution = profile.resolutions[0];
  if (profile.kind === "veo") facts.quality = "720p";
  return [{ label: model, facts: facts }];
}

export const meta = {
  apiVersion: 1,
  key: "video-generation",
  name: "Video Generation",
  description: {
    en: "Video generation",
    zh: "视频生成",
  },
  version: "1.1.0",
  author: { name: "QuantumNous" },
  models: MODEL_NAMES,
  modelVariants: Object.fromEntries(MODEL_NAMES.map((model) => [model, PROFILES[model].resolutions])),
  fetchMode: "per_task",
  upstreams: ["vendor", "new_api"],
  usageSchema: modelSchema(H3_MODEL),
  usageExamples: [{ label: "H3 768P 5s", facts: { seconds: 5, resolution: "768p" } }],
  usageProfiles: MODEL_NAMES.map((model) => ({ models: [model], schema: modelSchema(model), examples: metaUsageExample(model) })),
  routes: [
    { method: "POST", path: "/video-generation/v1/videos/generations/:model", type: "submit", decode: "createTask", render: "taskCreated" },
    { method: "GET", path: "/video-generation/v1/videos/:task_id", type: "query", render: "taskStatus" },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

function trimmed(value) {
  return String(value || "").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function viaGateway(ctx) {
  return Boolean(ctx && ctx.upstream && ctx.upstream.kind === "new_api");
}

function apiRoot(ctx) {
  return ctx.baseUrl + (viaGateway(ctx) ? "/video-generation" : "");
}

function normalizeResolution(value) {
  const raw = trimmed(value).toLowerCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (RESOLUTIONS.includes(raw)) return raw;
  if (raw === "3840x2160" || raw === "2160x3840") return "4k";
  if (raw === "1280x768" || raw === "768x1280") return "768p";
  if (raw === "2560x1440" || raw === "1440x2560") return "1440p";
  if (raw === "1920x1080" || raw === "1080x1920") return "1080p";
  if (raw === "1280x720" || raw === "720x1280") return "720p";
  if (raw === "854x480" || raw === "480x854") return "480p";
  throw new Error("unsupported video resolution");
}

function duration(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_SECONDS;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS)
    throw new Error("Video duration must be an integer between " + MIN_SECONDS + " and " + MAX_SECONDS + " seconds");
  return seconds;
}

function requestResolution(req) {
  const metadata = plainObject(req && req.metadata) || {};
  return normalizeResolution((req && (req.resolution || req.size)) || metadata.resolution);
}

function requestDuration(req) {
  return duration(req && (req.duration !== undefined ? req.duration : req.seconds));
}

function imageValues(req) {
  const values = [];
  for (const source of [req && req.input_reference, req && req.image].concat((req && req.images) || [])) {
    const entries = Array.isArray(source) ? source : [source];
    for (const entry of entries) {
      if (entry && typeof entry === "object" ? entry.__fileRef : trimmed(entry)) values.push(entry);
    }
  }
  return values;
}

function responsesInput(req) {
  const texts = [];
  const images = [];
  const input = req.input;
  if (typeof input === "string") texts.push(input);
  else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        texts.push(item);
        continue;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const content = item.content === undefined ? [item] : Array.isArray(item.content) ? item.content : [item.content];
      for (const part of content) {
        if (typeof part === "string") texts.push(part);
        else if (part && typeof part === "object" && ["input_text", "text"].includes(part.type) && typeof part.text === "string") texts.push(part.text);
        else if (part && typeof part === "object" && ["input_image", "image_url"].includes(part.type)) {
          let image = part.image_url;
          if (image && typeof image === "object") image = image.url;
          if (trimmed(image)) images.push(trimmed(image));
        }
      }
    }
  }
  return { prompt: texts.filter((text) => trimmed(text)).join("\n"), images: images };
}

function normalizeRequest(req, model, mappedModel) {
  const source = plainObject(req) || {};
  const profile = profileFor(model);
  if (!profile) throw new Error("unsupported video generation model");
  const input = responsesInput(source);
  const prompt = trimmed(source.prompt) || input.prompt;
  const images = imageValues(source)
    .concat(input.images)
    .filter((value, index, all) => all.indexOf(value) === index);
  if (!prompt && images.length === 0) throw new Error("input is required");
  let resolution = requestResolution(source);
  if (!resolution) resolution = (profile.resolutions && profile.resolutions[0]) || "768p";
  if (profile.resolutions && !profile.resolutions.includes(resolution)) throw new Error(model + " resolution must be one of " + profile.resolutions.join(", "));
  if (profile.kind === "veo") {
    const quality = trimmed(source.quality).toLowerCase() || "720p";
    if (!profile.resolutions.includes(quality)) throw new Error("veo-3.1 quality must be one of " + profile.resolutions.join(", "));
    if (resolution !== quality) throw new Error("veo-3.1 resolution must match quality");
  }
  if (profile.requiresImages && images.length === 0) throw new Error(model + " requires at least one reference image");
  let seconds = profile.seconds ? requestDuration(source) : undefined;
  if (profile.seconds && (seconds < profile.seconds[0] || seconds > profile.seconds[1]))
    throw new Error(model + " duration must be between " + profile.seconds[0] + " and " + profile.seconds[1] + " seconds");
  if (profile.seconds && profile.seconds.length === 1 && seconds !== profile.seconds[0])
    throw new Error(model + " duration must be " + profile.seconds[0] + " seconds");
  const body = { model: trimmed(mappedModel) || model, prompt: prompt };
  if (seconds !== undefined) body.seconds = seconds;
  if (profile.kind === "h3") body.size = resolution.toUpperCase();
  else body.size = resolution;
  if (profile.kind === "veo") body.quality = trimmed(source.quality).toLowerCase() || "720p";
  if (images.length) body.images = images;
  const metadata = plainObject(source.metadata);
  for (const key of ["aspect_ratio", "ratio", "seed"]) {
    if (source[key] !== undefined) body[key] = source[key];
    else if (metadata && metadata[key] !== undefined) body[key] = metadata[key];
  }
  return { body: body, resolution: resolution, seconds: seconds, quality: body.quality, action: images.length ? "image_to_video" : "text_to_video" };
}

function taskID(body) {
  const value = body && (body.id || body.task_id || body.taskId || body.request_id);
  return trimmed(value);
}

function responseStatus(body) {
  const status = trimmed(body && (body.status || body.state || body.task_status)).toLowerCase();
  if (["queued", "pending", "created", "submitted", "processing", "running", "in_progress"].includes(status)) return "IN_PROGRESS";
  if (["success", "succeeded", "completed", "complete", "done"].includes(status)) return "SUCCESS";
  if (["failed", "failure", "cancelled", "canceled", "error"].includes(status)) return "FAILURE";
  return "UNKNOWN";
}

function responseVideoURL(body) {
  const output = plainObject(body && (body.output || body.result || body.video));
  const metadata = plainObject(body && body.metadata);
  return trimmed(
    (output && (output.url || output.video_url || output.download_url)) ||
      (metadata && metadata.url) ||
      (body && (body.video_url || body.output_url || body.url))
  );
}

function responseFacts(body, task) {
  const source = plainObject(body && (body.output || body.result || body.video)) || body || {};
  const result = {};
  const seconds = Number(source.duration || source.seconds || source.output_seconds || (body && body.duration));
  const profile = profileFor(task && (task.model || task.upstreamModel));
  if (profile && profile.seconds && Number.isInteger(seconds) && seconds >= profile.seconds[0] && seconds <= profile.seconds[profile.seconds.length - 1])
    result.seconds = seconds;
  try {
    const resolution = normalizeResolution(source.resolution || (body && body.resolution) || source.size || (body && body.size));
    if (resolution && profile && profile.resolutions && profile.resolutions.includes(resolution)) result.resolution = resolution;
  } catch (e) {
    // Keep the submission estimate when the vendor omits or changes the field.
  }
  return result;
}

function contentText(ctx) {
  const artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  const url = trimmed(artifact && artifact.url);
  if (!url) throw new Error("video artifact is unavailable");
  const escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

function nativeBody(ctx) {
  if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const body = plainObject(ctx.body.value);
  if (!body) throw new Error("request body must be an object");
  const model = trimmed((ctx.params || {}).model) || trimmed(body.model);
  if (!model) throw new Error("model is required");
  const canonical = MODEL_NAMES.find((name) => name.toLowerCase() === model.toLowerCase()) || "";
  if (!canonical) throw new Error("unsupported video generation model");
  return { model: canonical, upstreamModel: model, body: body };
}

export const native = {
  createTask: function (ctx) {
    const nativeRequest = nativeBody(ctx);
    const normalized = normalizeRequest(nativeRequest.body, nativeRequest.model, nativeRequest.upstreamModel);
    return { kind: "submit", model: nativeRequest.model, modelVariant: normalized.resolution, action: normalized.action, requestBody: normalized.body };
  },
  taskCreated: function (_ctx, task) {
    return Object.assign({}, plainObject(task.data) || {}, { id: task.task_id });
  },
  taskStatus: function (_ctx, task) {
    const data = plainObject(task.data) || {};
    return Object.assign({}, data, { id: task.task_id, status: task.status === "SUCCESS" ? "completed" : task.status === "FAILURE" ? "failed" : "processing" });
  },
  error: function (_ctx, error) {
    return { error: { message: error.message, code: error.code || "video_generation_error" } };
  },
};

export function buildSubmitRequest(ctx) {
  const publicModel = ctx.model || H3_MODEL;
  const request = normalizeRequest(ctx.requestBody || {}, publicModel, ctx.upstreamModel);
  const body = request.body;
  const model = body.model;
  const files = Array.isArray(ctx.files) ? ctx.files : [];
  if (files.length) {
    const parts = [];
    for (const key of ["model", "prompt", "seconds", "size", "quality", "ratio", "aspect_ratio", "seed"]) {
      if (body[key] !== undefined && body[key] !== null) parts.push({ name: key, value: body[key] });
    }
    for (const image of Array.isArray(body.images) ? body.images : []) {
      if (typeof image === "string" && image.trim()) parts.push({ name: "images", value: image });
    }
    for (const file of files) {
      if (!file || file.field !== "input_reference") throw new Error("unexpected file field: " + (file && file.field));
      parts.push({ name: "input_reference", fileRef: file.ref, filename: file.filename, mimeType: file.mimeType });
    }
    return {
      url: apiRoot(ctx) + "/v1/videos/generations/" + encodeURIComponent(model),
      method: "POST",
      headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
      bodyType: "multipart",
      parts: parts,
      action: request.action,
    };
  }
  return {
    url: apiRoot(ctx) + "/v1/videos/generations/" + encodeURIComponent(model),
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
    body: body,
    action: request.action,
  };
}

export function parseSubmitResponse(_ctx, resp) {
  const body = plainObject(resp.body);
  const id = taskID(body);
  if (!id) throw new Error("Video provider did not return a task id");
  const status = responseStatus(body);
  if (status === "FAILURE") throw new Error(trimmed(body.error && body.error.message) || "Video generation failed");
  return { taskId: id, taskData: body };
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const request = normalizeRequest(ctx.requestBody || {}, ctx.model || H3_MODEL, ctx.upstreamModel);
  const facts = { resolution: request.resolution };
  if (request.seconds !== undefined) facts.seconds = request.seconds;
  if (request.quality !== undefined) facts.quality = request.quality;
  return facts;
}

export function buildQueryRequest(ctx) {
  return {
    url: apiRoot(ctx) + "/v1/videos/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

export function parseTaskResult(_ctx, body) {
  const status = responseStatus(body);
  const result = { status: status };
  if (status === "UNKNOWN") result.reason = "unrecognized status: " + String((body && (body.status || body.state)) || "");
  if (status === "FAILURE")
    result.reason = trimmed(body && body.error && body.error.message) || trimmed(body && (body.message || body.error_message)) || "video generation failed";
  const progress = Number(body && body.progress);
  if (Number.isFinite(progress) && progress >= 0 && progress < 100) result.progress = progress + "%";
  const url = responseVideoURL(body);
  if (url) result.url = url;
  return result;
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" ? [{ key: "video", type: "video", mimeType: "video/mp4" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  return {
    url: apiRoot(ctx) + "/v1/videos/" + encodeURIComponent(ctx.upstreamTaskId) + "/content",
    method: ctx.clientRequest.method,
    headers: { Authorization: "Bearer " + ctx.apiKey },
  };
}

export function extractUsageOnComplete(_task, _taskResult, body) {
  const facts = responseFacts(body, _task);
  return Object.keys(facts).length ? facts : null;
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = plainObject(ctx.body.value);
      if (!req) throw new Error("request body must be an object");
      const model = trimmed(ctx.model) || trimmed(req.model) || trimmed(ctx.upstreamModel);
      if (!model) throw new Error("model is required");
      if (req.input !== undefined && typeof req.input !== "string" && !Array.isArray(req.input)) throw new Error("input must be a string or array");
      const normalized = normalizeRequest(req, model, ctx.upstreamModel);
      return { kind: "submit", model: model, modelVariant: normalized.resolution, action: normalized.action, requestBody: normalized.body };
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const value = Number(String(task.progress || "").replace("%", ""));
      const progress = Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      const state = { status: status, progress: progress };
      if (status === "SUCCESS") {
        const text = contentText(ctx);
        return { events: previousState && previousState.status === status ? [] : [{ type: "output", data: text }], state: state, done: true };
      }
      if (status === "FAILURE")
        return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }], state: state, done: true };
      if (previousState && previousState.status === status && previousState.progress === progress) return { events: [], state: state, done: false };
      const event = { type: "progress", message: status.toLowerCase() };
      if (progress !== null) event.progress = progress;
      return { events: [event], state: state, done: false };
    },
    renderFinal: function (ctx, _task) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: contentText(ctx), annotations: [], logprobs: [] }],
          },
        ],
        metadata: { vendor: "video-generation" },
      };
    },
  },
};

const openaiVideoRenderer = function (task) {
  const statuses = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
  const output = {
    id: task.task_id,
    object: "video",
    model: (task.properties || {}).origin_model_name || "",
    status: statuses[task.status] || "unknown",
    progress: Number(String(task.progress || "0").replace("%", "")),
    created_at: Number(task.created_at || 0),
  };
  if (task.finished_at || task.updated_at) output.completed_at = Number(task.finished_at || task.updated_at);
  if (task.status === "FAILURE") output.error = { code: "video_generation_failed", message: task.fail_reason || "video generation failed" };
  return output;
};

protocols.openai_video = {
  decodeRequest: function (ctx) {
    if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
    let req;
    if (ctx.body.kind === "json") {
      req = plainObject(ctx.body.value);
      if (!req) throw new Error("JSON object required");
    } else {
      req = {};
      const fields = ctx.body.fields || {};
      for (const name of Object.keys(fields)) {
        if (fields[name].length > 1) throw new Error(name + " must be provided once");
        req[name] = fields[name][0];
      }
      const files = ctx.body.files || [];
      const references = [];
      for (const file of files) {
        if (file.field !== "input_reference") throw new Error("unexpected file field: " + file.field);
        references.push({ __fileRef: file.ref, encoding: "dataUrl", maxBytes: 20971520 });
      }
      if (references.length) req.input_reference = references;
      if (req.metadata !== undefined) {
        try {
          req.metadata = JSON.parse(req.metadata);
        } catch (e) {
          throw new Error("metadata must be a JSON object string", { cause: e });
        }
        if (!plainObject(req.metadata)) throw new Error("metadata must be a JSON object string");
      }
    }
    const model = ctx.model;
    const normalized = normalizeRequest(req, model, ctx.upstreamModel);
    return { kind: "submit", model: model, modelVariant: normalized.resolution, action: normalized.action, requestBody: normalized.body };
  },
  render: function (_ctx, task) {
    return openaiVideoRenderer(task);
  },
};
