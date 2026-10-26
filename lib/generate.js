/**
 * One text-to-image request against the local ComfyUI server:
 * ensure the server, validate the requested model/options, queue the graph,
 * wait for history, download the images and persist them.
 */

import path from 'node:path'

import {
  buildTxt2ImgGraph,
  describeHistoryFailure,
  describePromptFailure,
  fetchInventory,
  normalizeDimension,
  randomSeed,
  resolveCheckpoint,
  resolveChoice
} from './comfy.js'
import { cancelPrompt, downloadImage, getHistory, submitPrompt } from './http.js'
import { saveImages } from './images.js'

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

function clampInteger(value, min, max) {
  return Math.round(clamp(value, min, max))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function abortError(signal) {
  const reason = signal?.reason
  return reason instanceof Error ? reason : new Error('图片生成已取消：工具调用被中断。')
}

/** Collect image descriptors from a history entry. */
function collectImages(entry) {
  const outputs = entry?.outputs
  const files = []
  if (!outputs || typeof outputs !== 'object') return files
  for (const nodeOutput of Object.values(outputs)) {
    if (!Array.isArray(nodeOutput?.images)) continue
    for (const image of nodeOutput.images) {
      if (image && typeof image.filename === 'string') files.push(image)
    }
  }
  return files
}

/**
 * Execute a generation request.
 * @param {{runtime: any, config: any, ctx: any, args: any, exec: any}} input
 */
export async function generateImage({ runtime, config, ctx, args, exec }) {
  const signal = exec?.signal
  const cwd = exec?.agent?.session?.header?.cwd
  const notes = []

  const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : ''
  if (!prompt) throw new Error('prompt 不能为空：请描述想生成的画面。')

  // 1. A reachable server, started if needed and allowed.
  const server = await runtime.ensureRunning({ signal, cwd })
  if (server.started) notes.push(`ComfyUI 未运行，已自动启动（用时 ${server.seconds}s）。`)

  // 2. Validate the requested options against what this server actually offers.
  const inventory = await fetchInventory(config.baseUrl, signal)
  const checkpoint = resolveCheckpoint(inventory.checkpoints, args.checkpoint, config.checkpoint)
  const sampler = resolveChoice(inventory.samplers, args.sampler_name, config.sampler, 'sampler_name')
  const scheduler = resolveChoice(inventory.schedulers, args.scheduler, config.scheduler, 'scheduler')

  const loras = []
  for (const entry of Array.isArray(args.loras) ? args.loras : []) {
    const name = typeof entry === 'string' ? entry : entry?.name
    if (!name) continue
    if (inventory.loras.length > 0 && !inventory.loras.includes(name)) {
      throw new Error(`LoRA "${name}" 不存在。可用 LoRA：${inventory.loras.slice(0, 12).join(', ') || '(无)'}`)
    }
    loras.push({ name, strength: Math.round(clamp(entry?.strength ?? 0.8, 0, 2) * 100) / 100 })
  }

  const requestedWidth = Number(args.width ?? config.width)
  const requestedHeight = Number(args.height ?? config.height)
  const width = normalizeDimension(Number.isFinite(requestedWidth) ? requestedWidth : config.width)
  const height = normalizeDimension(Number.isFinite(requestedHeight) ? requestedHeight : config.height)
  if (width !== requestedWidth) notes.push(`width 已按 8 像素对齐：${requestedWidth} → ${width}`)
  if (height !== requestedHeight) notes.push(`height 已按 8 像素对齐：${requestedHeight} → ${height}`)

  const steps = clampInteger(args.steps ?? config.steps, 1, 150)
  const cfg = Math.round(clamp(args.cfg ?? config.cfg, 0, 30) * 100) / 100
  const count = clampInteger(args.count ?? 1, 1, config.maxImages)
  const seed = Number.isFinite(Number(args.seed)) && Number(args.seed) >= 0 ? Math.floor(Number(args.seed)) : randomSeed()
  const negativePrompt =
    typeof args.negative_prompt === 'string' && args.negative_prompt.trim().length > 0
      ? args.negative_prompt.trim()
      : config.negativePrompt

  // 3. Queue the graph.
  const graph = buildTxt2ImgGraph({
    prompt,
    negativePrompt,
    width,
    height,
    batchSize: count,
    steps,
    cfg,
    sampler,
    scheduler,
    seed,
    checkpoint,
    loras,
    filenamePrefix: 'dsh_comfy'
  })

  const clientId = `dsh-comfyui-${process.pid}-${Date.now()}`
  const startedAt = Date.now()
  let submission
  try {
    submission = await submitPrompt(config.baseUrl, graph, clientId, { signal })
  } catch (error) {
    if (signal?.aborted) throw abortError(signal)
    throw new Error(describePromptFailure(error))
  }

  const promptId = submission?.prompt_id
  if (typeof promptId !== 'string' || promptId.length === 0) {
    throw new Error(`ComfyUI 没有返回 prompt_id，无法跟踪生成进度。返回内容：${JSON.stringify(submission).slice(0, 300)}`)
  }

  // 4. Wait for the history entry.
  const deadline = startedAt + config.generationTimeoutSeconds * 1000
  let entry
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await cancelPrompt(config.baseUrl, promptId)
      throw abortError(signal)
    }
    await sleep(800)
    let history
    try {
      history = await getHistory(config.baseUrl, promptId, { signal, timeoutMs: 15000 })
    } catch (error) {
      if (signal?.aborted) throw abortError(signal)
      continue
    }
    const candidate = history?.[promptId]
    if (candidate) {
      entry = candidate
      break
    }
  }

  if (!entry) {
    await cancelPrompt(config.baseUrl, promptId)
    throw new Error(
      `等待 ComfyUI 生成超时（${config.generationTimeoutSeconds} 秒）。图片可能仍在排队；可稍后查看 ComfyUI 页面，或提高插件配置 generationTimeoutSeconds。`
    )
  }

  if (entry?.status?.status_str === 'error') throw new Error(describeHistoryFailure(entry))

  // 5. Download and persist the produced images.
  const historyImages = collectImages(entry)
  if (historyImages.length === 0) {
    throw new Error('ComfyUI 执行完成但没有返回任何图片（工作流中的 SaveImage 节点没有输出）。')
  }

  const install = runtime.state?.install
  const downloads = []
  for (const image of historyImages) {
    const data = await downloadImage(config.baseUrl, image, { signal })
    const folder = image.type === 'temp' ? 'temp' : 'output'
    downloads.push({
      data,
      filename: image.filename,
      width,
      height,
      comfyuiPath: install
        ? path.join(install.comfyDir, folder, image.subfolder ?? '', image.filename)
        : undefined
    })
  }

  const saved = await saveImages({ ctx, config, exec, downloads })
  const durationSeconds = Math.round(((Date.now() - startedAt) / 1000) * 10) / 10

  return {
    promptId,
    checkpoint,
    seed,
    width,
    height,
    steps,
    cfg,
    sampler,
    scheduler,
    count: saved.images.length,
    durationSeconds,
    outputDir: saved.outputDir,
    autoStarted: server.started === true,
    loras: loras.map((lora) => lora.name),
    notes,
    images: saved.images
  }
}
