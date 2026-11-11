# gwllm-plugin

独立维护的 [new-api](https://github.com/QuantumNous/new-api) 任务插件仓库，由 Ericsunsk 维护。插件原作者及元数据归属保留为 QuantumNous。

## 安装

在后台「任务插件 → 插件市场」添加第三方源：

```text
https://raw.githubusercontent.com/Ericsunsk/gwllm-plugin/marketplace/index.json
```

选择版本并安装、激活，再在渠道中绑定 `video-generation` 或 `openai-video`，无需重新部署网关。`video-generation` 由本仓库独立维护，主项目不再内嵌其工厂副本；官方内置 Sora、Hailuo 等插件继续由主项目维护。已有相同 key 的安装可通过激活版本更新；本仓库不会自动拉取或修改生产配置。

两个自定义插件统一使用公开模型 ID：`minimax-h3`（768P / 1080P / 1440P）、`seedance-2.0`、`seedance-2.0-fast`、`seedance-2.0-mini`、`seedance-2.5`、`veo-3.1`、`wan-3.0`。公开模型和分辨率由插件定义；各分辨率对应的上游模型 ID 在渠道中配置，上游 ID 保持原样。

`video-generation@2.0.0` 统一公开模型 ID，是破坏性变更。市场仅提供当前版本，`1.1.0` 不再列于安装索引。升级前需将渠道公开模型列表、分辨率映射键和相应插件价格键改为新 ID；不提供旧名称别名或自动迁移。旧任务保留提交时的模型身份，必须等待旧任务完成后再激活新版本。

官方 Hailuo 声明的 `MiniMax-H3` 与这里的 `minimax-h3` 仅大小写不同，当前宿主会拒绝同时启用。使用这些自定义插件前，需由管理员手动停用 Hailuo，再激活自定义插件；本仓库不会自动修改原生插件、宿主规则或启用状态。

## OpenAI Video

`openai-video@1.0.0` 为相同的七个自定义公开模型提供独立插件，通过 `POST /v1/videos` 提交、`GET /v1/videos/:id` 查询和 `GET/HEAD /v1/videos/:id/content` 下载。也支持宿主 `/v1/responses` 的 stream、sync、background 模式。JSON 和 multipart 图片上传使用同一请求校验。上游为厂商或另一 New API 网关时均使用这些标准路径；不会使用 `video-generation` 的 `/v1/videos/generations/:model` 接口。

模型配置集中在 `plugins/openai-video/plugin.js` 的 `MODEL_DEFINITIONS`，自动生成模型、分辨率路由与每模型计费字段。新增模型只需修改该定义和对应回归用例，再递增插件版本。渠道绑定 `openai-video` 后，按公开模型和分辨率配置上游模型 ID；实际出站 `body.model` 使用该映射 ID。计费为 `seconds` 与 `resolution`，与 `video-generation` 共用公开模型时，可在 `<pluginKey>::<model>` 下单独配置价格。

当前策略为缺省 5 秒、允许整数 1–3600 秒；这是安全校验范围，不代表供应商支持全部时长。`seconds` 和别名 `duration` 双写必须相同。分辨率选项按分辨率升序排列，H3 默认使用 768p，其他模型默认使用 720p。`size` 接受表内横竖尺寸或分辨率名，`resolution` 接受同样的归一化输入；同时提供时必须属于同一档位。出站始终发送明确的 `WxH`，保留所选横竖方向。缺省或仅给分辨率名时采用以下横向尺寸：

| 分辨率 | 默认出站尺寸 |
| ------ | ------------ |
| 480p   | 854x480      |
| 720p   | 1280x720     |
| 768p   | 1280x768     |
| 1080p  | 1920x1080    |
| 1440p  | 2560x1440    |
| 4k     | 3840x2160    |

请求要求文本提示词，可附带一个 `input_reference` URL 或一个同名上传文件；多图明确拒绝。Responses 输入支持文本和一张参考图。`metadata` 仅透传描述信息，不合并生成参数；其中的 `seconds`、`duration`、`size`、`resolution`、`n`、`quality`、`count`、`batch_size` 会被拒绝。顶层 `n`、`quality`、`count`、`batch_size` 亦不支持。其他未知顶层字段不向上游转发。

这些模型、时长和尺寸是本插件的可编辑配置，需目标供应商实际支持 OpenAI Videos 请求、任务对象及内容下载契约；尚未完成真实供应商端到端验证。官方 Sora 插件仍由主项目维护，本插件不包含 Sora 模型或其专用限制。插件市场仅提供 `openai-video@1.0.2` 和 `video-generation@2.0.2`，不保留旧版本条目。

## 兼容性

宿主需支持 Task Plugin API v1 的 `modelVariants`、`usageProfiles`、`enumLabels`、`upstreams` 扩展及第三方插件市场源。`minApiVersion: 1` 只表示契约主版本，不代表所有旧版 v1 宿主均能加载。已验证的来源基线是 `Ericsunsk/gwllm@f1da677e478ce75cc25478478462ee88492fe52e`；最终安装检查由宿主编译器执行。新增宿主运行时能力或协议契约仍需升级主项目。

后台轮询旧异步任务时使用当前激活插件。升级需兼容尚未完成任务的请求、状态和持久化数据，或先等待任务完成再激活。市场不提供历史版本安装；Git 历史中的源码记录继续保留。

## 开发与发布

使用 `.node-version` 固定的 Node.js，依赖版本及 npm lockfile 固定：

```sh
npm ci --ignore-scripts
npm run check
```

测试和契约校验全部在本仓库运行，不依赖主项目 checkout 或密钥。`contract/v1.schema.json` 和 `contract/v1.d.ts` 原样取自上述宿主基线；Schema 校验和 Node hook 回归不替代实际宿主编译。计费数值字段描述遵循「计费对象 + 单价」，单位保留在 `unit`。

源码放在 `plugins/<key>/plugin.js`，元数据以源码实际导出的 `meta` 为唯一来源。修改已发布插件必须递增 `meta.version`；禁止复用版本号修改内容。新增插件采用同一目录布局并补充行为回归。

PR 和 main 的 CI 只验证。发布时在 GitHub Actions 手动运行 `Publish marketplace`，选择 main 中已经合并的完整 commit SHA（留空使用工作流提交）。工作流重新验证该 SHA，再原子更新 `marketplace` 分支的 `index.json`。索引每个插件只保留当前版本；已有当前版本的路径和 SHA256 保留，重复发布会移除旧版本条目，同版本不同内容直接失败。源文件 URL 固定到 40 位 commit SHA，不使用可变分支 URL。

本地预览发布（只准备本地分支，不推送）：

```sh
node scripts/prepare-release.mjs --revision <40-character-main-SHA>
```

脚本要求发布输入已提交、当前 checkout 与指定 SHA 一致，输出位于被 git 忽略的 `.release/marketplace/`。本地验收可用 `--remote /path/to/test.git --output .release/test` 指向临时 bare 仓库。

## 许可与来源

采用 [GNU AGPLv3](LICENSE)，保留 [NOTICE](NOTICE) 中 QuantumNous / new-api 的版权、来源及 Section 7 附加条款。插件源码、契约快照、LICENSE 和 NOTICE 初次迁入时保持原样；本仓库新增独立校验、回归测试和市场发布流程。NOTICE 中上游产品依赖说明保留为原始归属记录；本仓库实际开发依赖及版本以 `package-lock.json` 为准。

Frontend design and development by New API contributors.

原项目：<https://github.com/QuantumNous/new-api>
