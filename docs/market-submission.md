# 上架 dsh-market / awesome-dsh-plugin

[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 是 dsh-market 与多个
DSH 客户端的插件目录来源；市场里的插件卡片就是它的条目。本插件**不是**向 dsh-market 仓库提 PR，
而是向 awesome-dsh-plugin 提交**一个 YAML 文件**。

## 当前状态

| 项 | 状态 |
| --- | --- |
| GitHub 仓库 | ✅ https://github.com/Making-acid/dsh-plugin-comfyui （public） |
| `dsh.bundle.patch` 清单 | ✅ `package.json` 已声明 |
| 真实可用代码 | ✅ 三个工具 + 提示词段落，含 smoke 与附件回归测试 |
| `dsh-plugin` GitHub topic | ✅ 已设置（另含 dsh / deepseek-harness / comfyui / image-generation / stable-diffusion / sdxl / cordis） |
| 仓库创建满 1 天 | ✅ 2026-10-26T02:40:43Z 创建，2026-10-27T03:00Z 提交时已满 24.3 小时 |
| **市场收录 PR** | ✅ **https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9733**（2026-10-27 自动提交） |
| GitHub Release tarball（可选） | ✅ `v1.0.0`，资产名 `dsh-plugin-comfyui.tgz`（版本无关） |
| npm 包（可选） | ⏳ 发布后市场可显示下载量；不发布不影响收录 |
| 截图 | ✅ `screenshots.json` + `assets/screenshot-*.jpg`，市场会自动抓取 |
| 市场卡片图标（可选） | ✅ `assets/icon-180.png`，条目里用 raw.githubusercontent 链接引用 |

## 提交内容

在 awesome-dsh-plugin 仓库新建 `data/plugins/Making-acid__dsh-plugin-comfyui.yml`：

```yaml
url: https://github.com/Making-acid/dsh-plugin-comfyui
name: Making-acid/dsh-plugin-comfyui
category: tools
description:
  en: Local ComfyUI image generation for DeepSeek Harness — discovers or starts the installed ComfyUI server, generates text-to-image from a chat request, and attaches the result in the conversation.
  zh: 让 DeepSeek Harness 用本机 ComfyUI 真正生图——自动查找或启动本地服务，在对话里完成文生图并附图。
```

分类选择：`tools`（工具与能力）。插件只提供模型工具与系统提示词段落，没有 UI，不符合 `ui` / `theme`。

## 提 PR 前检查

1. 仓库里 `package.json` 的 `dsh.bundle.patch` 指向存在的 `cordis.patch.yml`；
2. 仓库创建已满 1 天（本仓库创建日期以 GitHub 为准）；
3. 仓库已加 `dsh-plugin` topic；
4. 描述只陈述功能、不带营销词，且与代码一致（三个工具 = 三个工具）；
5. 一次 PR 只加这一个文件。

## 可选的 GitHub Release tarball

不发 npm 时，市场会优先用 GitHub Release 的预构建 tarball。本仓库的 release 资产命名为
`dsh-plugin-comfyui.tgz`（**不带版本号**），指向方式：

```yaml
tarball: https://github.com/Making-acid/dsh-plugin-comfyui/releases/latest/download/dsh-plugin-comfyui.tgz
```

> `latest/download/` 的资产名是照字面取的：如果资产名带版本号，下次发版就会 404。
> 因此这里保持版本无关的文件名，或改用钉住 tag 的 URL。
