/**
 * dsh-comfyui — ComfyUI image generation for DeepSeek Harness.
 *
 * Host-only bundle. It contributes:
 *  - three model-facing tools (`comfyui_status`, `comfyui_start`, `comfyui_generate`),
 *  - one system-prompt section stating that image requests must be routed to the
 *    local ComfyUI instead of being refused.
 *
 * The plugin finds or starts the local ComfyUI server on demand, so the model
 * never has to know the installation path up front.
 */

import { normalizeConfig } from './lib/config.js'
import { createPromptSection } from './lib/prompt-section.js'
import { createRuntime } from './lib/runtime.js'
import { createComfyTools } from './lib/tools.js'

/** Cordis plugin name (used by logs and diagnostics). */
export const name = 'comfyui'

/** Hard dependencies: both services are part of every chat composition. */
export const inject = ['tools', 'systemPrompt']

/**
 * Cordis entry point.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} rawConfig - the Loader row's `config`.
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const runtime = createRuntime(ctx, config)

  ctx.effect(() => ctx.systemPrompt.section(createPromptSection(config)))

  ctx.effect(() => {
    const disposers = createComfyTools(runtime).map((tool) => ctx.tools.register(tool))
    return () => {
      for (let index = disposers.length - 1; index >= 0; index -= 1) {
        try {
          disposers[index]()
        } catch {
          /* disposal must not throw out of the effect */
        }
      }
    }
  })
}
