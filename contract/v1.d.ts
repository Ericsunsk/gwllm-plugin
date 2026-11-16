export type JSONValue = null | boolean | number | string | readonly JSONValue[] | {readonly [key: string]: JSONValue};
/** json-clone@1, submit-sse-delta@1 and duration-auto@1 are accepted for earlier hosts; new plugins need none of them. */
export type HostCapability = "json-clone@1" | "submit-sse-delta@1" | "json-order@1" | "duration-auto@1";
/** Kinds of upstream a driver can address: the vendor API itself, or another New API gateway with the same plugin installed. */
export type UpstreamKind = "vendor" | "new_api";
/** Host-injected on every driver hook context. With "new_api" the driver uses its own native-route prefix and the host already set Bearer credentials. */
export interface UpstreamContext {kind: UpstreamKind}
export type MutableJSON<T> = T extends readonly (infer Item)[] ? MutableJSON<Item>[] : T extends object ? {-readonly [Key in keyof T]: MutableJSON<T[Key]>} : T;
export interface HostUtils {
  hasCapability(name: string): boolean;
  /** Independent native JS containers; at most 1 MiB encoded JSON, depth 32 and 32,768 nodes. */
  json: {clone<T extends JSONValue>(value: T): MutableJSON<T>};
  unixNow(): number;
  uuid(): string;
  hmacSHA256(message: string, secret: string): string;
  jwtSignHS256(claims: Record<string, JSONValue>, secret: string): string;
  base64(value: string): string;
  base64URL(value: string): string;
  base64URLDecode(value: string): string;
  volcSignV4(request: {method: string; url: string; headers?: Record<string, string>; body?: string; accessKey: string; secretKey: string; region?: string; service?: string; timestamp?: number}): Record<string, string>;
  /** Synchronous request; GET/HEAD in task drivers, POST only in explicitly bound service hooks. Requests go to the channel Base URL host or allowedHosts. At most 4 per hook call, 15 s each, 30 s in total, 1 MiB per body; redirects are returned, not followed. */
  fetch(request: FetchRequest): FetchResponse;
  /** Outbound only; requires an explicit host binding and applies no changes itself. */
  paramOverride(body: Record<string, JSONValue>, override: Record<string, JSONValue>): {body: Record<string, JSONValue>; headers?: {set?: Record<string, string>; remove?: string[]}} | {reject: {code: string; message?: string}};
  keywords(field: string, text: string, options?: {caseSensitive?: boolean}): string[];
  attachments(): Attachment[];
  media(ref: string): MediaInfo | null;
  mediaText(ref: string, options?: {maxChars?: number}): MediaText | null;
}
export interface FetchRequest {url: string; method?: "GET" | "HEAD" | "POST"; body?: string; headers?: Record<string, string>; responseType?: "json" | "bytes"}
/** headers holds the first value of each header under its canonical name; body is parsed JSON when the response parses, otherwise text, and "" for HEAD; with responseType "bytes" it is an ArrayBuffer of the response bytes. */
export interface FetchResponse {status: number; headers: Record<string, string>; body: JSONValue | string | ArrayBuffer}
declare global {const utils: HostUtils;}
export type FileReference = Readonly<{ref: string; field: string; filename: string; mimeType: string; size: number}>;
export type FilePlaceholder = Readonly<{__fileRef: string; encoding: "base64" | "dataUrl"; mimeType?: string; maxBytes?: number}>;
export type DecodedBody =
  | Readonly<{kind: "json"; value: JSONValue}>
  | Readonly<{kind: "form"; fields: Readonly<Record<string, readonly string[]>>}>
  | Readonly<{kind: "multipart"; fields: Readonly<Record<string, readonly string[]>>; files: readonly FileReference[]}>
  | Readonly<{kind: "none"}>;

/** requestHeaders: the client's request headers, as DriverContext.requestHeaders holds them. Older gateways do not pass them to decoders. */
export interface NativeDecodeContext {method: string; path: string; params: Readonly<Record<string, string>>; query: Readonly<Record<string, readonly string[]>>; requestHeaders: Readonly<Record<string, string>>; body: DecodedBody}
export interface ProtocolDecodeContext extends NativeDecodeContext {protocol: ProtocolName; operation: string; model: string; upstreamModel?: string; stream: boolean}
export type SubmitIntent = {kind: "submit"; model: string; modelVariant?: string; action?: string; requestBody?: unknown; originTaskIds?: readonly string[]};
export type QueryIntent = {kind: "query"; taskIds: readonly string[]};
export type TaskIntent = SubmitIntent | QueryIntent;
export interface NativeRoute {method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; /** The vendor's own path; the host also serves it under /{key} unless its first segment is the key or a proper prefix of it. */ path: string; type: "submit" | "query" | "dynamic"; action?: string; /** Query routes: the path parameter carrying the gateway task id or, when the path has none, the query-string parameter of that name. Default "task_id". */ taskIdParam?: string; decode?: string; render: string; models?: readonly string[]; retainResult?: boolean}
export type ProtocolName = "openai_responses" | "openai_video" | "openai_image";
export type ResponsesMode = "stream" | "sync" | "background";
export type ProtocolClaim =
  | "openai_video"
  | "openai_image"
  | {name: "openai_responses"; supports: readonly ResponsesMode[]; models?: readonly string[]}
  | {name: "openai_video"; models?: readonly string[]}
  | {name: "openai_image"; models?: readonly string[]};
/** One entry of the OpenAI ImageResponse `data` array rendered by protocols.openai_image.render. */
export type ImageResponseEntry = {url?: string; b64_json?: string; revised_prompt?: string};
export type LocalizedText = string | ({ en: string } & Record<string, string>);
export type UsageFieldSchema =
  | {type: "number"; unit: "count"; unitLabel?: LocalizedText; description?: LocalizedText}
  | {type: "number"; unit: "second" | "token" | "credit"; unitLabel?: never; description?: LocalizedText}
  | {type: "boolean"; unitLabel?: never; description?: LocalizedText}
  | {modelVariant?: boolean; enum: readonly string[]; unitLabel?: never; description?: LocalizedText; enumLabels?: Readonly<Record<string, LocalizedText>>};
export type UsageExample = {label: string; facts: Readonly<Record<string, string | number | boolean>>};
export type UsageProfile = {models: readonly string[]; schema: Readonly<Record<string, UsageFieldSchema>>; examples?: readonly UsageExample[]};
export interface RelayRoute {incoming_path: string; upstream_path: string; converter?: string; models?: readonly string[]; auth?: {type: "none" | "header" | "query"; name?: string; value?: string}; pass_through_body_enabled?: boolean}
/** One field of an instance config: a JSON Schema subset. title is required; nesting is at most 4 levels; unit, visibleWhen and every format but url are form hints that never change the check, the defaults or the config. A non-empty url value must be an absolute http(s) URL without credentials or fragment, and its host is one utils.fetch may address in ingress, egress, reply and report; password marks a secret the form hides. The form shows a slider for an integer field whose minimum and maximum are both set and at most 100 apart. */
export interface ConfigField {type: "string" | "number" | "integer" | "boolean" | "array" | "object"; title: LocalizedText; description?: LocalizedText; default?: JSONValue; examples?: readonly JSONValue[]; enum?: readonly (string | number)[]; enumTitles?: readonly LocalizedText[]; minimum?: number; maximum?: number; /** number and integer fields: byte values get a KB/MB choice (1000-based, stored in bytes), the others a suffix. */ unit?: "byte" | "pixel" | "character" | "second"; minLength?: number; maxLength?: number; /** RE2 regular expression. */ pattern?: string; /** string: textarea, regex, url, password, keywords (a property of the schema itself only); object: json. */ format?: "textarea" | "regex" | "url" | "password" | "keywords" | "json"; items?: ConfigField; minItems?: number; maxItems?: number; uniqueItems?: boolean; properties?: Readonly<Record<string, ConfigField>>; required?: readonly string[]; /** meta.channelConfig only, on an object field without properties: a value per model, keyed by model name. A string, number, integer or boolean field without default or visibleWhen. */ additionalProperties?: ConfigField; /** A property only, not an items field: shown while every named sibling property (string, number, integer or boolean) holds one of the listed values. Values must be valid for that sibling; lists are non-empty without repeats. API responses always write lists. */ visibleWhen?: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[]>>}
/** The schema of a request processing instance's config. Without it the config is {}. */
export interface ConfigSchema {type: "object"; properties: Readonly<Record<string, ConfigField>>; required?: readonly string[]}
/** A plugin has a task part when it exports buildSubmitRequest, which needs models and fetchMode, a provider part when relay is not empty, and a request processing part when it exports ingress, request, outbound, egress, reply or report. A plugin without a task part must not declare the task fields. */

export interface Meta {relay?: readonly RelayRoute[]; configSchema?: ConfigSchema; channelConfig?: ConfigSchema; keyHint?: LocalizedText; optional?: boolean; samples?: readonly Sample[];requiredCapabilities?: readonly HostCapability[]; submitResponseTypes?: readonly ("json" | "sse")[]; sortPriority?: number; website?: string; apiVersion: 1; key: string; name: LocalizedText; icon?: string; description?: LocalizedText; version: string; author: {name: string; url?: string}; baseUrl?: string; channelTypes?: readonly number[]; models?: readonly string[]; modelVariants?: Readonly<Record<string, readonly string[]>>; fetchMode?: "per_task" | "batch"; allowedHosts?: readonly string[]; upstreams?: readonly UpstreamKind[]; routes?: readonly NativeRoute[]; protocols?: readonly ProtocolClaim[]; usageSchema?: Readonly<Record<string, UsageFieldSchema>>; usageExamples?: readonly UsageExample[]; usageProfiles?: readonly UsageProfile[]; auth?: "none" | "api_key" | "vertex_oauth" | {type: "none" | "api_key" | "oauth2_jwt"}}
export interface Sample {
  /** At most 64 characters per locale. */
  name: LocalizedText;
  /** Base language of the text, such as "en" or "zh"; absent for any language. */
  lang?: string;
  format: "openai" | "openai_responses" | "claude" | "gemini";
  /** A request body in format, at most 16 KB as JSON. */
  body: Readonly<Record<string, JSONValue>>;
  /** An answer text of at most 4 KB, for trying a reply hook. */
  reply?: string;
}

export interface TaskView {task_id: string; status: string; progress?: string; fail_reason?: string; created_at?: number; updated_at?: number; data?: unknown; properties?: Record<string, unknown>}
export interface DriverContext {requestBody: unknown; /** Client request headers, first value under the canonical name, without gateway credentials; Content-Type and Accept are always present. Older gateways pass only those two. */ requestHeaders: Readonly<Record<string, string>>; action: string; model: string; upstreamModel: string; baseUrl: string; /** Managed identity data, private to this plugin on type 61; apiKey is absent. */ credential?: JSONValue; apiKey?: string; authHeader: string; upstream: UpstreamContext; /** new-api Vertex AI channel region from the raw other field; absent on other channel types and hosts. */ channelOther?: string; files: readonly FileReference[]; publicTaskId: string; originTasks?: readonly {taskId: string; upstreamTaskId: string; action: string; status: string; data: unknown}[]}
export interface TaskQueryContext {taskId: string; publicTaskId: string; action: string; model: string; upstreamModel: string; baseUrl: string; /** Managed identity data, private to this plugin on type 61; apiKey is absent. */ credential?: JSONValue; apiKey?: string; authHeader: string; auth?: unknown; upstream: UpstreamContext; data: unknown; state: unknown}
export interface BatchQueryContext {baseUrl: string; /** Managed identity data, private to this plugin on type 61; apiKey is absent. */ credential?: JSONValue; apiKey?: string; authHeader: string; auth?: unknown; upstream: UpstreamContext; tasks: readonly TaskQueryContext[]}
export type HookHTTPResponse = {readonly status: number; readonly headers: Readonly<Record<string, string>>}
export interface RequestDescriptor {responseType?: "json" | "sse"; url: string; method?: string; headers?: Record<string, string>; /** JSON body may contain FilePlaceholder objects at any depth; the host replaces each with a Base64 or data-URL string. */ body?: unknown; credentialless?: boolean; action?: string; model?: string; rewriteModel?: string; bodyType?: "json" | "multipart"; parts?: readonly {name: string; value?: unknown; fileRef?: string; filename?: string}[]; /** buildContentRequest only: the artifact's bytes are the base64 string at this path of the JSON reply, a long-running operation. String keys and non-negative integer indices, at most 32 segments. */ contentPath?: readonly (string | number)[]; /** buildContentRequest with contentPath: the artifact's media type, default "video/mp4". */ mimeType?: string}
export interface UpstreamResponse {statusCode: number; headers: Readonly<Record<string, readonly string[]>>; body: unknown}
export interface NormalizedTaskResult {taskId?: string; status: "NOT_START" | "SUBMITTED" | "QUEUED" | "IN_PROGRESS" | "SUCCESS" | "FAILURE" | "UNKNOWN"; progress?: string; reason?: string; url?: string; remoteUrl?: string; completionTokens?: number; totalTokens?: number}
export interface TaskArtifact {key: string; type: "video" | "audio" | "image" | "file"; mimeType?: string}
export declare const meta: Meta;
/** A query presenter's context: artifacts holds the gateway download addresses of one task in SUCCESS (from listArtifacts) and is empty otherwise. Throwing "artifact_not_found" answers 404. */
export interface NativeQueryContext extends NativeDecodeContext {artifacts: Readonly<Record<string, {key: string; type: string; url: string; mimeType?: string}>>}
/** A native presenter's reply with the vendor's own HTTP status (200–599); only Location and Retry-After may be set, and a reply without __body has no body. Any other value is the JSON body of a 200 reply, or of the host's status for the error presenter. */
export type NativeReply = {__status: number; __headers?: {Location?: string; "Retry-After"?: string}; __body?: unknown};
export declare const native: Record<string, ((ctx: NativeDecodeContext) => TaskIntent) | ((ctx: NativeQueryContext, task: TaskView | readonly TaskView[]) => unknown | NativeReply)> & {error?: (ctx: NativeDecodeContext, error: {code: string; message: string; httpStatus: number; retryable: boolean; requestId: string}) => unknown | NativeReply};
export declare const protocols: {
  openai_responses?: {decodeRequest(ctx: ProtocolDecodeContext): SubmitIntent; renderEvents?(ctx: unknown, task: TaskView, previousState: unknown): unknown; renderFinal?(ctx: unknown, task: TaskView): unknown};
  openai_video?: {decodeRequest(ctx: ProtocolDecodeContext): SubmitIntent; render(ctx: unknown, task: TaskView): unknown};
  /** render returns the OpenAI ImageResponse; the host adds `created` when absent and resolves response_format b64_json. */
  openai_image?: {decodeRequest(ctx: ProtocolDecodeContext): SubmitIntent; render(ctx: unknown, task: TaskView): {created?: number; data: readonly ImageResponseEntry[]} & Record<string, unknown>};
};
export declare function buildSubmitRequest(ctx: DriverContext): RequestDescriptor;
export interface SubmitEvent {event: string; id: string; data: string}
export type JSONPath = readonly (string | number)[];
export type JSONChange =
  | {op: "set" | "append"; path: JSONPath; value: JSONValue}
  | {op: "appendText"; path: JSONPath; value: string};
export interface SubmitEventDeltaResult {changes: readonly JSONChange[]; state: JSONValue; done: boolean}
/** With submit-sse-delta@1, state is small control data; changes build the separate response body. */
export declare function parseSubmitEventDelta(ctx: DriverContext, event: SubmitEvent, previousState: JSONValue | null): SubmitEventDeltaResult;
export declare function parseSubmitEvent(ctx: DriverContext, event: SubmitEvent, previousState: JSONValue | null): {state: JSONValue; done: boolean};
export declare function parseSubmitResponse(ctx: DriverContext, response: UpstreamResponse): {taskId: string; taskData?: unknown; immediate?: NormalizedTaskResult; state?: unknown};
/** Managed/signed redirects return to the plugin. Unsigned static query redirects retain credentials only within approved hosts; SSRF and HTTPS downgrade checks still apply. */
export declare function buildQueryRequest(ctx: TaskQueryContext): RequestDescriptor;
export declare function buildBatchQueryRequest(ctx: BatchQueryContext, tasks: readonly TaskQueryContext[]): RequestDescriptor;
export declare function parseTaskResult(ctx: TaskQueryContext, body: unknown, response: HookHTTPResponse): NormalizedTaskResult;
export declare function parseBatchResult(ctx: BatchQueryContext, body: unknown, response: HookHTTPResponse): readonly (NormalizedTaskResult & {taskId: string; data?: unknown; state?: unknown})[];
export declare function extractUsage(ctx: DriverContext & {usagePurpose?: "facts" | "billing_ratios"}): Readonly<Record<string, string | number | boolean>> | null;
export declare function extractUsageOnSubmit(ctx: DriverContext, taskData: unknown): Readonly<Record<string, string | number | boolean>> | null;
export declare function extractUsageOnComplete(task: TaskQueryContext, result: NormalizedTaskResult, data: unknown): Readonly<Record<string, string | number | boolean>> | null;
export declare function listArtifacts(task: {taskId: string; status: string; action: string; data: unknown; producerVersion: string}): readonly TaskArtifact[];
export declare function buildContentRequest(ctx: DriverContext & {artifactKey: string; data: unknown; state?: unknown; upstreamTaskId: string; clientRequest: {method: "GET" | "HEAD"; headers: Readonly<Record<string, string>>}}): RequestDescriptor;

/** One request-processing call; routing, credentials and effect application remain host-owned. */
export type TransformStage = "ingress" | "request" | "outbound" | "egress";
export interface TransformContext {
  readonly stage: TransformStage | "reply" | "report";
  readonly format: string;
  readonly path: string;
  readonly model: string;
  readonly upstreamModel?: string;
  readonly group: string;
  readonly attempt: number;
  readonly channel?: {readonly id: number; readonly type: number};
  readonly user: {readonly id: number; readonly username: string};
  readonly token?: {readonly id: number; readonly name: string};
  readonly instance: {readonly id: string; readonly name: string};
  readonly config: Readonly<Record<string, JSONValue>>;
}
export interface TransformRequest {
  readonly body: JSONValue;
  readonly headers?: Readonly<Record<string, string>>;
  readonly form?: boolean;
  readonly media?: readonly {index: number; path: string; mimeType: string; bytes: number; width?: number; height?: number}[];
  readonly summary?: {messageCount: number; toolCount: number; lastUserTextLength: number; totalTextLength: number; hasImages: boolean; reasoningEffort: string};
}
export interface TransformFinding {rule: string; category?: string; path?: string; count: number}
/** Effects are decoded and guarded by the host for the specific stage before application. */
export type TransformResult =
  | {action: "continue"; effects?: readonly JSONValue[]; findings?: readonly TransformFinding[]; notice?: LocalizedText}
  | {action: "reject"; code: string; message?: string; ruleId?: string; findings?: readonly TransformFinding[]; notice?: LocalizedText};
export interface ReplyRequest {readonly stream: boolean; readonly outputs: readonly {index: number; text: string; offset: number; final: boolean}[]}
export type ReplyResult =
  | {action: "continue"; mask?: readonly {index: number; start: number; end: number; category?: string}[]; hold?: number; findings?: readonly TransformFinding[]; notice?: LocalizedText}
  | {action: "pass"}
  | {action: "stop"; code: string; message?: string; findings?: readonly TransformFinding[]; notice?: LocalizedText};
/** External URLs and file ids stay in the host; their opaque refs are unavailable for reading or fetch. */
export interface Attachment {ref: string; kind: string; mime: string; size?: number; filename?: string; unavailableReason?: "reference"; path: string; rewritable?: boolean}
export interface MediaInfo {kind: string; mime: string; size: number; filename?: string; width?: number; height?: number; rewritable?: boolean}
export type MediaText = {text: string; truncated: boolean} | {unchecked: string};

export declare function ingress(ctx: TransformContext, request: TransformRequest): TransformResult;
export declare function request(ctx: TransformContext, request: TransformRequest): TransformResult;
export declare function outbound(ctx: TransformContext, request: TransformRequest): TransformResult;
export declare function egress(ctx: TransformContext, request: TransformRequest): TransformResult;
export declare function reply(ctx: TransformContext, request: ReplyRequest): ReplyResult;
export declare function report(ctx: TransformContext, record: JSONValue): unknown;

/** Static provider relay hooks do not receive the channel API key. */
export interface ProviderHookContext {readonly baseUrl: string; readonly path?: string; readonly config: Readonly<Record<string, JSONValue>>; readonly state?: JSONValue}
export interface ProviderPrepareInput {readonly path: string; readonly upstreamPath: string; readonly model: string; readonly stream: boolean; readonly body?: JSONValue; readonly form?: {readonly fields: Readonly<Record<string, readonly string[]>>; readonly files: readonly {field: string; filename: string; contentType: string; size: number}[]}; readonly headers: Readonly<Record<string, string>>}
/** Submission estimates for the exact final payload; next descriptors carry cumulative, nondecreasing totals. image_count is required on image routes. */
export interface ProviderFinalFacts {image_count?: number; input_tokens: number}
/** Atomic host-validated effects; body/form changes require replacement facts or faithfully countable native input. */
export interface ProviderPreparedRequest {effects?: readonly JSONValue[]; path?: string; url?: string; finalFacts?: ProviderFinalFacts}
export declare function prepareRequest(ctx: ProviderHookContext, request: ProviderPrepareInput): ProviderPreparedRequest | null | undefined;
export declare function convertRequest(ctx: ProviderHookContext, request: {body?: JSONValue; form?: JSONValue; model: string; stream: boolean}): JSONValue;
export declare function convertResponse(ctx: ProviderHookContext, response: {status: number; headers: Readonly<Record<string, string>>; body?: string; bodyBase64?: string}): JSONValue;
export declare function convertStreamEvent(ctx: ProviderHookContext, event: {event?: string; data?: string; dataBase64?: string; done?: boolean}): JSONValue;
export interface ProviderBalanceWindow {name: LocalizedText; used: number; limit: number; unit?: string; resetAt?: number}
export interface ProviderBalanceResult {amount?: number | null; currency?: string; unlimited?: boolean; windows?: readonly ProviderBalanceWindow[]}
export interface ProviderCredentialContext {readonly baseUrl: string; readonly credential: JSONValue | null; readonly apiKey: string; readonly config: Readonly<Record<string, JSONValue>>}
/** Runs after credential injection and channel overrides, with the digest of final bytes; has no utils.fetch. */
export declare function signRequest(ctx: ProviderCredentialContext, request: {readonly method: string; readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly bodySha256: string}): {headers?: Readonly<Record<string, string>>; query?: Readonly<Record<string, string>>};
export interface ProviderBalanceContext extends ProviderCredentialContext {readonly state: JSONValue}
export declare function buildBalanceRequest(ctx: ProviderBalanceContext): JSONValue;
export declare function parseBalance(ctx: ProviderBalanceContext, response: {status: number; headers: Readonly<Record<string, string>>; body?: string; bodyBase64?: string}): ProviderBalanceResult | {next: JSONValue; state?: JSONValue};

/** Provider login runs only in an authenticated, channel-bound host flow. */
export interface ProviderLoginContext {
  readonly baseUrl: string;
  readonly config: Readonly<Record<string, JSONValue>>;
  /** Existing managed credential data when logging in again at a selected key. */
  readonly credential?: JSONValue;
  readonly login: {
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
    readonly codeChallenge: string;
    readonly codeChallengeMethod: "S256";
    readonly redirectUri: string;
    readonly session: JSONValue;
  };
}
export type ProviderLoginInput = null
  | {readonly callback: Readonly<Record<string, string>>}
  | {readonly fields: Readonly<Record<string, string>>}
  | {readonly poll: true};
export interface ProviderLoginField {name: string; label: LocalizedText; type?: "text" | "password" | "textarea"; required?: boolean; placeholder?: LocalizedText; description?: LocalizedText}
/** Unix-second expiry; credential data, headers and query are never browser output. */
export interface ProviderLoginCredential {credential: Exclude<JSONValue, null>; headers?: Readonly<Record<string, string>>; query?: Readonly<Record<string, string>>; expiresAt?: number; accountId?: string; label?: string}
/** Omitting session retains it; explicit null clears it. */
export type ProviderLoginStep =
  | {type: "redirect"; url: string; issuer?: string; session?: JSONValue}
  | {type: "paste"; url: string; issuer?: string; hint?: LocalizedText; session?: JSONValue}
  | {type: "device"; userCode: string; verificationUri: string; verificationUriComplete?: string; interval?: number; expiresIn?: number; session?: JSONValue}
  | {type: "pending"; interval?: number; session?: JSONValue}
  | {type: "fields"; fields: readonly ProviderLoginField[]; session?: JSONValue}
  | ({type: "done"} & ProviderLoginCredential);
export declare function login(ctx: ProviderLoginContext, input: ProviderLoginInput): ProviderLoginStep;

/** Explicit management refresh; opaque data replaces the old value, summaries may be omitted to preserve them. */
export declare function refresh(ctx: ProviderCredentialContext): ProviderLoginCredential | {relogin: true};
/** The host locally blocks this identity before the bounded provider exchange. Return value is ignored. */
export declare function revoke(ctx: ProviderCredentialContext): unknown;
