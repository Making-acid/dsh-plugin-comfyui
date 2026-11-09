# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-11-09

Compatibility pass for the DSH 0.2.1 / 0.2.2 line (upstream latest: `0.2.2-rc.1`).

### Changed

- `engines.dsh` is now `>=0.2.0-rc.2 <0.3.0-0` (was `>=0.2.0-rc.1`). DSH 0.2.1 started
  preferring `engines.dsh` when deciding whether a third-party plugin is compatible, so the
  range is now the tested floor and an explicit `<0.3.0-0` ceiling.
- README documents that DSH itself requires Node `>=24.9` from 0.2.2 on, while this plugin's
  own code still only needs Node 20 built-ins.

### Added

- `scripts/check-dsh.mjs` (`npm run test:dsh`): validates every model-facing tool against the
  **installed Host's own** `@deepseek-ai/dsh-tools` schema contract and checks that `engines.dsh`
  covers the running DSH version. Read-only, no install, skips cleanly on machines without DSH.

### Verified against DSH 0.2.2-rc.1

Checked against the packages published for `0.2.2-rc.1`; no API change was needed:

- `tools.register(definition, options)` still requires `output: { schema, render }` and returns the
  same disposer; all three tool definitions pass the 0.2.2 schema-subset validator
  (`assertSupportedJsonSchema` / `assertObjectJsonSchema`).
- `ctx.systemPrompt.section({ name, order, text })`, `ctx.effect(fn, label)`, `ctx.get(name)` and
  `ctx.on(name, listener, { prepend })` (Cordis 4.1.0) keep their signatures.
- `attachments.saveImage()` → `ImageAttachmentRef` and the `{ type: 'image', attachment }` content
  block are unchanged, so generated pictures still attach to the conversation.
- `configEditor.entries()` / `edit(entry, (current, inherited) => …)` — used to persist a discovered
  install directory — is unchanged.
- `cordis.patch.yml` rows (`insert`, `config`, `disabled`) are still the supported loader patch
  format under Loader 1.1.0 / Include 1.1.0.

## [1.0.0] - 2026-10-26

First release: local ComfyUI discovery, detached auto-start, text-to-image with checkpoint/LoRA
selection, workspace output plus chat attachments, and three model-facing tools
(`comfyui_status`, `comfyui_start`, `comfyui_generate`). Listed in
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
