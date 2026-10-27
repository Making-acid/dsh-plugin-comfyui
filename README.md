# dsh-plugin-comfyui

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com/)

[English](#english) · **中文**

让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）用本机
[ComfyUI](https://www.comfy.org) **真正生成图片**。安装后，模型接到「画一张…」「生成一张…的图」这类指令时，
不再回答自己不能生图，而是先查 ComfyUI、必要时自动启动服务，然后完成文生图并把图片**附回对话**。

> 已收录进 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（dsh-market 的目录来源），
> 收录 PR：[#9733](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9733)（已合并）。

![示例：橘猫窗台](assets/screenshot-1.jpg)
![示例：雨夜霓虹街景](assets/screenshot-2.jpg)

## 它解决什么问题

没有这个插件时，纯文本模型面对「画一张图」往往直接回答「我无法生成图片」。
装上它之后：

1. 系统提示词里增加一段「本地图像生成能力」策略，明确规定生图请求必须走 ComfyUI；
2. 提供三个模型可调用的工具：`comfyui_status` / `comfyui_start` / `comfyui_generate`；
3. 插件会**自动发现**本机 ComfyUI 安装目录（portable 版或源码版），第一次自动启动成功后把路径写回配置；
4. 生成的图片保存到会话工作区 `comfyui-output/`，同时作为附件显示在对话里。

## 安装

插件是一个标准的 DSH bundle（`package.json` 里声明 `dsh.bundle.patch`）。

```sh
# 已经发布到 npm 时（市场一键安装走的就是这条路）
dsh plugin --profile desktop add dsh-plugin-comfyui

# 或者直接从本仓库的本地路径安装（开发常用）
dsh plugin --profile desktop add link:/path/to/dsh-plugin-comfyui
```

在 DSH 桌面端也可以用插件管理器的「安装本地 bundle」，或点插件市场里的一键安装卡片。
安装后无需重启即可生效（若安装时服务未启动，第一次生图会自动拉起 ComfyUI）。

### 前置条件

| 依赖 | 说明 |
| --- | --- |
| DSH | 核心 `>=0.2.0-rc.1 <0.3.0-0`（本插件在 `0.2.0-rc.2` 上验证） |
| Node | `>=20`（插件只用 Node 内置模块，无第三方依赖） |
| ComfyUI | 本机安装，portable 版（`ComfyUI/` + `python_embeded/`）或源码版均可；已在 `v0.34.0` 验证 |
| 模型 | 至少一个 checkpoint 放在 `ComfyUI/models/checkpoints`（例如 SDXL / Illustrious 系） |

ComfyUI 可以放在任意目录：插件会在 `AIpainting`、`ComfyUI`、用户主目录、桌面、下载等常见位置搜索，
也可以在配置里写死 `installDir`。ComfyUI 已经在跑、或者跑在局域网另一台机器上也支持（只做连接与生成，不代启动）。

## 工具

| 工具 | 作用 |
| --- | --- |
| `comfyui_status` | 查服务状态：是否运行、版本、GPU 显存、队列、安装目录、checkpoint/LoRA 清单、采样器与默认参数，并给出下一步建议 |
| `comfyui_start` | 启动本机 ComfyUI 并等待就绪；可用 `install_dir` 指定安装目录（成功后会被记住）；已运行则直接返回状态 |
| `comfyui_generate` | 文生图：`prompt` 必填，可选尺寸/步数/CFG/采样器/scheduler/seed/张数/checkpoint/LoRA；服务没运行会自动启动，完成后把图片附回对话并给出可复现参数 |

`comfyui_generate` 返回的参数（checkpoint、尺寸、steps、CFG、sampler/scheduler、seed、保存路径）足以复现或微调同一张图。

## 配置

配置写在 profile 的 `cordis.patch.yml` 里（bundle 自带默认值，全部可选）：

```yaml
- id: comfyui
  name: dsh-plugin-comfyui
  config:
    baseUrl: http://127.0.0.1:8188
    autoStart: true
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8188` | ComfyUI HTTP API 地址；非本机地址时只连接、不代启动 |
| `autoStart` | `true` | 生图时服务未运行是否自动启动 |
| `installDir` | 空 | 明确指定安装目录（portable 根目录或其中的 `ComfyUI` 文件夹）；空 = 自动查找 |
| `searchDirs` | `[]` | 额外搜索目录 |
| `checkpoint` | 空 | 默认 checkpoint；空 = 服务返回的第一个 |
| `sampler` / `scheduler` | `dpmpp_2m` / `karras` | 默认采样器 / 调度器 |
| `steps` / `cfg` | `28` / `5` | 默认步数 / 提示词引导强度 |
| `width` / `height` | `1024` / `1024` | 默认尺寸（生成时自动对齐到 8 的倍数） |
| `negativePrompt` | 通用负面词 | 默认负面提示词 |
| `generationTimeoutSeconds` | `900` | 单次生成等待上限 |
| `startTimeoutSeconds` | `180` | 等待服务启动上限 |
| `maxImages` | `4` | 单次生成张数上限 |
| `outputDir` | 空 | 图片保存目录；空 = `<会话工作区>/comfyui-output` |
| `persistDiscovery` | `true` | 自动找到的安装目录是否写回配置 |
| `pythonPath` | 空 | 源码版 ComfyUI 使用的 Python（portable 版忽略） |
| `extraLaunchArgs` | `[]` | 追加的启动参数，例如 `["--lowvram"]` |
| `launchLogFile` | 空 | 启动日志路径；空 = `<会话工作区>/comfyui-launch.log` |

## 工作原理

```
用户：画一张雨夜霓虹街景
  → 模型读到系统提示词里的「本地图像生成能力」策略
  → comfyui_status      探测 /system_stats、/queue、模型清单、安装目录
  → comfyui_start       未运行时：发现安装目录 → detached 启动 ComfyUI → 轮询就绪
  → comfyui_generate    校验模型与采样器 → POST /prompt → 轮询 /history
                        → GET /view 下载图片 → 写入会话工作区 + 存为对话附件
  → 模型汇报：图片已附上 + 保存路径 + 完整可复现参数
```

几个实现要点：

- **只用 Node 内置模块**（`fetch` / `fs` / `child_process`），没有第三方依赖，不需要构建；
- **进程独立**：ComfyUI 以 detached 方式启动，会话结束或插件卸载都不会关掉用户的 ComfyUI；
- **可取消**：工具调用被中断时会尽力 `POST /queue {delete}` + `POST /interrupt`；
- **错误可读**：ComfyUI 的 `execution_error`、被拒绝的 prompt、启动失败日志尾部都会被翻译成模型可执行的信息；
- **附件一致性**：图片块的元数据一律取自附件服务返回的引用（服务可能把大 PNG 归一化成 JPEG），
  否则框架读回时会报 `Stored attachment metadata does not match its reference`——仓库内有一个针对该缺陷的回归测试。

## 自行验证

```sh
# 纯逻辑 + 真实服务 + 真实出图（需要 ComfyUI 在跑，或让插件自己拉起）
node scripts/smoke.mjs

# 生成图片的附件路径回归测试（使用 DSH 真实的本地附件服务）
node scripts/test-attachments.mjs

# 直接探针：不经过插件，调 ComfyUI API 生成一张图
pwsh -File scripts/test-api.ps1
```

实测环境与结果（Windows / RTX 5070 Laptop 8 GB / ComfyUI v0.34.0 / `waiIllustriousSDXL_v170`）：

| 验证项 | 结果 |
| --- | --- |
| `comfyui_status`（服务未启动） | 正确报告未运行，并从磁盘列出安装目录与 checkpoint |
| `comfyui_start` | detached 启动 ComfyUI，11.1 秒就绪，启动日志落盘 |
| `comfyui_generate` 832×1216 / 24 steps | 26.2 秒出图，PNG 落盘 + 对话附件显示 |
| `scripts/smoke.mjs` | `ALL CHECKS PASSED` |
| `scripts/test-attachments.mjs` | `ALL CHECKS PASSED`（含「旧写法会被框架拒绝」的回归守卫） |

## 兼容性与市场

- 本插件是标准的 DSH community plugin：`package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入一行 Host 插件，
  用 `dsh plugin add` 即可安装；
- 官方 `@deepseek-ai/*` 包一个都没有被引入，因此不声明 peerDependencies，避免版本范围导致 `ERESOLVE`；
  宿主兼容性用 `engines.dsh` 声明；
- 上架 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（dsh-market 的目录来源）
  需要仓库创建满 1 天，条目 YAML 见 [docs/market-submission.md](docs/market-submission.md)；
- 发布 npm 包后，`repository` 指向本仓库即可被市场自动关联；未发布也可以用 GitHub Release 的 tarball 安装。

## 常见问题

- **报「没有可用的 checkpoint」**：把 `.safetensors` 放进 `<ComfyUI>/models/checkpoints`，重启 ComfyUI。
- **报 `Permission denied` 写 output**：ComfyUI 进程被更严格的沙箱/杀软限制；插件从 DSH Host 进程启动通常不会有这个问题，
  也可以手动启动 ComfyUI 后再生成。
- **显存不足 / 很慢**：降低尺寸与步数（如 832×1216 / 20-24 steps），或在 `extraLaunchArgs` 里加 `["--lowvram"]`。
- **想换端口**：改 `baseUrl`，插件会按新端口启动。
- **服务一直连不上**：先看 `comfyui_status` 的 `serverError`，再确认端口占用（`Get-NetTCPConnection -LocalPort 8188`）。

## 目录结构

```
index.js                  # Cordis 入口：注册提示词段落 + 三个工具
cordis.patch.yml          # bundle patch：插入 comfyui 行与默认配置
lib/config.js             # 配置归一化与默认值
lib/http.js               # ComfyUI HTTP 客户端（超时/中断/错误翻译）
lib/discover.js           # 安装目录发现（portable / 源码，限时限深度）
lib/launcher.js           # detached 启动 + 就绪等待 + 日志尾部诊断
lib/comfy.js              # 模型清单、txt2img 工作流、错误翻译
lib/runtime.js            # 单次激活共享的服务器/安装状态
lib/generate.js           # 一次完整生图请求
lib/images.js             # 落盘 + 对话附件（附件元数据以服务引用为准）
lib/tools.js              # 三个工具的 schema / 渲染
lib/prompt-section.js     # 系统提示词段落
lib/version.js            # 运行时代码版本（status 里可见）
assets/                   # 市场卡片图标与截图
scripts/                  # smoke / 附件回归 / API 探针脚本
docs/                     # 市场投稿说明
```

## License

MIT © Making-acid

---

## English

**Local ComfyUI image generation for DeepSeek Harness.** This plugin makes an image request actually produce an
image instead of a refusal: it discovers the ComfyUI installation on the machine (portable or source), starts it
detached when needed, runs a text-to-image workflow, then saves the result into the session workspace and attaches
it to the conversation. It also registers a short system-prompt section so the model routes image requests to
ComfyUI instead of answering that it cannot draw.

- Three model-facing tools: `comfyui_status`, `comfyui_start`, `comfyui_generate`.
- Zero npm dependencies and no build step — Node built-ins only (`fetch`, `fs`, `child_process`).
- Works with a local or remote ComfyUI; only local addresses may be auto-started.
- Requires DSH core `>=0.2.0-rc.1 <0.3.0-0`, Node `>=20`, and at least one checkpoint in `ComfyUI/models/checkpoints`.
- Install: `dsh plugin --profile desktop add dsh-plugin-comfyui` (once published) or a linked local path.
- Verify: `node scripts/smoke.mjs` and `node scripts/test-attachments.mjs`.
