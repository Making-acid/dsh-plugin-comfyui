/**
 * ComfyUI domain knowledge: model introspection, workflow construction, and
 * translation of ComfyUI's execution errors into actionable text.
 */

import { ComfyHttpError, getNodeInfo } from './http.js'

/**
 * Extract the selectable values of a node input spec.
 *
 * ComfyUI versions disagree on the shape of a combo input:
 *   [[...values], {tooltip}]            (classic)
 *   ['COMBO', {options: [...values]}]   (newer API nodes)
 *   [{options: [...]}, {...}]           (defensive)
 * @param {unknown} spec - one entry of `input.required`.
 * @returns {string[]}
 */
export function comboChoices(spec) {
  const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
  if (Array.isArray(spec)) {
    const [head, options] = spec
    if (Array.isArray(head)) return strings(head)
    if (typeof head === 'string') {
      if (head === 'COMBO') {
        if (options && typeof options === 'object' && Array.isArray(options.options)) return strings(options.options)
        return strings(options)
      }
      return []
    }
    if (head && typeof head === 'object') {
      if (Array.isArray(head.options)) return strings(head.options)
      if (Array.isArray(head.value)) return strings(head.value)
    }
    return []
  }
  if (spec && typeof spec === 'object') {
    if (Array.isArray(spec.options)) return strings(spec.options)
    if (Array.isArray(spec.value)) return strings(spec.value)
  }
  return []
}

/** Read one combo input's choices from a running server. */
export async function fetchNodeChoices(baseUrl, classType, inputName, signal) {
  const required = await getNodeInfo(baseUrl, classType, { signal })
  return comboChoices(required?.[inputName])
}

/** Everything a text-to-image request can choose from. */
export async function fetchInventory(baseUrl, signal) {
  const [checkpoints, loras, samplers, schedulers] = await Promise.all([
    fetchNodeChoices(baseUrl, 'CheckpointLoaderSimple', 'ckpt_name', signal),
    fetchNodeChoices(baseUrl, 'LoraLoader', 'lora_name', signal),
    fetchNodeChoices(baseUrl, 'KSampler', 'sampler_name', signal),
    fetchNodeChoices(baseUrl, 'KSampler', 'scheduler', signal)
  ])
  return { checkpoints, loras, samplers, schedulers }
}

/**
 * Build the guarded txt2img graph.
 * @param {object} options - prompt, negativePrompt, width, height, batchSize,
 *   steps, cfg, sampler, scheduler, seed, checkpoint, loras, filenamePrefix.
 */
export function buildTxt2ImgGraph(options) {
  const graph = {}
  const loras = Array.isArray(options.loras) ? options.loras : []

  graph['4'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: options.checkpoint }
  }

  let model = ['4', 0]
  let clip = ['4', 1]
  loras.forEach((lora, index) => {
    const id = String(20 + index)
    graph[id] = {
      class_type: 'LoraLoader',
      inputs: {
        model,
        clip,
        lora_name: lora.name,
        strength_model: lora.strength,
        strength_clip: lora.strength
      }
    }
    model = [id, 0]
    clip = [id, 1]
  })

  graph['6'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: options.prompt } }
  graph['7'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: options.negativePrompt } }
  graph['5'] = {
    class_type: 'EmptyLatentImage',
    inputs: { width: options.width, height: options.height, batch_size: options.batchSize }
  }
  graph['3'] = {
    class_type: 'KSampler',
    inputs: {
      seed: options.seed,
      steps: options.steps,
      cfg: options.cfg,
      sampler_name: options.sampler,
      scheduler: options.scheduler,
      denoise: 1.0,
      model,
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0]
    }
  }
  graph['8'] = { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } }
  graph['9'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: options.filenamePrefix ?? 'dsh_comfy', images: ['8', 0] }
  }
  return graph
}

/** Random seed that stays a safe JS integer. */
export function randomSeed() {
  return Math.floor(Math.random() * 9_007_199_254_740_000 * 0.001) // < 2^53 and comfortably below ComfyUI's max
}

/**
 * Pick a checkpoint: the caller's choice wins, then the configured default,
 * then the first available model.
 */
export function resolveCheckpoint(available, requested, configured) {
  const known = Array.isArray(available) ? available : []
  if (known.length === 0) {
    throw new Error(
      'ComfyUI 没有可用的 checkpoint 模型。请把一个 .safetensors 模型放进 ComfyUI 的 models/checkpoints 目录（重启 ComfyUI 后生效），再重试。'
    )
  }
  if (requested) {
    if (known.includes(requested)) return requested
    throw new Error(`checkpoint "${requested}" 不存在。可用模型：${known.slice(0, 12).join(', ')}${known.length > 12 ? ' …' : ''}`)
  }
  if (configured) {
    if (known.includes(configured)) return configured
    // A stale configured default must not block generation.
    return known[0]
  }
  return known[0]
}

/** Validate one choice against what the server reports, with an actionable error. */
export function resolveChoice(available, requested, fallback, label) {
  const known = Array.isArray(available) ? available : []
  if (known.length === 0) return requested || fallback
  if (requested) {
    if (known.includes(requested)) return requested
    throw new Error(`${label} "${requested}" 不被当前 ComfyUI 支持。可用值：${known.join(', ')}`)
  }
  if (known.includes(fallback)) return fallback
  return known[0]
}

/** Round a requested latent size to a multiple of 8. */
export function normalizeDimension(value) {
  return Math.max(64, Math.min(4096, Math.round(value / 8) * 8))
}

/** Explain why an execution stopped. */
export function describeHistoryFailure(entry) {
  const status = entry?.status
  const messages = Array.isArray(status?.messages) ? status.messages : []
  for (const item of messages) {
    if (!Array.isArray(item) || item.length < 2) continue
    const [kind, payload] = item
    if (kind === 'execution_error') {
      const where = payload?.node_type ?? payload?.node_id ?? '未知节点'
      const reason = payload?.exception_message ?? payload?.exception_type ?? '未知错误'
      return `ComfyUI 执行失败（节点 ${where}）：${String(reason).trim()}`
    }
    if (kind === 'execution_interrupted') return 'ComfyUI 执行被中断（可能是显存不足或用户手动取消）。'
  }
  return `ComfyUI 报告生成失败（status=${status?.status_str ?? 'unknown'}）。`
}

/** Turn a rejected `/prompt` submission into the message the model should see. */
export function describePromptFailure(error) {
  if (error instanceof ComfyHttpError && error.body) {
    try {
      const parsed = JSON.parse(error.body)
      const nodeErrors = parsed.node_errors && typeof parsed.node_errors === 'object' ? parsed.node_errors : {}
      const details = []
      for (const [nodeId, nodeError] of Object.entries(nodeErrors)) {
        const errors = Array.isArray(nodeError?.errors) ? nodeError.errors : []
        const text = errors
          .map((item) => [item?.message, item?.details].filter(Boolean).join('：'))
          .filter(Boolean)
          .join('；')
        details.push(`${nodeError?.class_type ?? nodeId}${text ? ` — ${text}` : ''}`)
      }
      const head = parsed.error?.message || parsed.error?.details || '请求被拒绝'
      return `ComfyUI 拒绝了这次生成请求：${head}${details.length ? `\n节点问题：${details.join(' / ')}` : ''}`
    } catch {
      /* fall through to the generic message */
    }
  }
  return error?.message ?? String(error)
}
