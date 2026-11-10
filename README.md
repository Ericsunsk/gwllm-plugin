# gwllm-plugin

独立维护的 [new-api](https://github.com/QuantumNous/new-api) 任务插件仓库，由 Ericsunsk 维护。插件原作者及元数据归属保留为 QuantumNous。

## 安装

在后台「任务插件 → 插件市场」添加第三方源：

```text
https://raw.githubusercontent.com/Ericsunsk/gwllm-plugin/marketplace/index.json
```

选择版本并安装、激活，即可覆盖同 key 的工厂插件，无需重新部署网关。官方内置 Sora、Hailuo 等插件继续由主项目维护。主项目内嵌的 `video-generation` 基础副本保留；本仓库不会自动拉取或修改生产配置。

`video-generation@1.1.0` 支持 MiniMax-H3（768P / 1080P / 1440P）、Seedance 2.0 / fast / mini、Seedance 2.5、Veo 3.1 和 Wan 3.0。公开模型和分辨率由插件定义；各分辨率对应的上游模型 ID 在渠道中配置。

## 兼容性

宿主需支持 Task Plugin API v1 的 `modelVariants`、`usageProfiles`、`enumLabels`、`upstreams` 扩展及第三方插件市场源。`minApiVersion: 1` 只表示契约主版本，不代表所有旧版 v1 宿主均能加载。已验证的来源基线是 `Ericsunsk/gwllm@f1da677e478ce75cc25478478462ee88492fe52e`；最终安装检查由宿主编译器执行。新增宿主运行时能力或协议契约仍需升级主项目。

后台轮询旧异步任务时使用当前激活插件。升级需兼容尚未完成任务的请求、状态和持久化数据，或先等待任务完成再激活。安装历史版本可回滚，回滚同样需要兼容进行中的任务。

## 开发与发布

使用 `.node-version` 固定的 Node.js，依赖版本及 npm lockfile 固定：

```sh
npm ci --ignore-scripts
npm run check
```

测试和契约校验全部在本仓库运行，不依赖主项目 checkout 或密钥。`contract/v1.schema.json` 和 `contract/v1.d.ts` 原样取自上述宿主基线；Schema 校验和 Node hook 回归不替代实际宿主编译。计费数值字段描述遵循「计费对象 + 单价」，单位保留在 `unit`。

源码放在 `plugins/<key>/plugin.js`，元数据以源码实际导出的 `meta` 为唯一来源。修改已发布插件必须递增 `meta.version`；禁止复用版本号修改内容。新增插件采用同一目录布局并补充行为回归。

PR 和 main 的 CI 只验证。发布时在 GitHub Actions 手动运行 `Publish marketplace`，选择 main 中已经合并的完整 commit SHA（留空使用工作流提交）。工作流重新验证该 SHA，再原子更新 `marketplace` 分支的 `index.json`。历史版本路径和 SHA256 保留；重复发布无变化，同版本不同内容直接失败。源文件 URL 固定到 40 位 commit SHA，不使用可变分支 URL。

本地预览发布（只准备本地分支，不推送）：

```sh
node scripts/prepare-release.mjs --revision <40-character-main-SHA>
```

脚本要求发布输入已提交、当前 checkout 与指定 SHA 一致，输出位于被 git 忽略的 `.release/marketplace/`。本地验收可用 `--remote /path/to/test.git --output .release/test` 指向临时 bare 仓库。

## 许可与来源

采用 [GNU AGPLv3](LICENSE)，保留 [NOTICE](NOTICE) 中 QuantumNous / new-api 的版权、来源及 Section 7 附加条款。插件源码、契约快照、LICENSE 和 NOTICE 初次迁入时保持原样；本仓库新增独立校验、回归测试和市场发布流程。NOTICE 中上游产品依赖说明保留为原始归属记录；本仓库实际开发依赖及版本以 `package-lock.json` 为准。

Frontend design and development by New API contributors.

原项目：<https://github.com/QuantumNous/new-api>
