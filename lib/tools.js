/**
 * Model-facing tools of the ComfyUI bundle.
 *
 * Three tools cover the whole loop: inspect the local server and its models,
 * start it when needed, and generate images. Each one renders a compact text
 * envelope, and `comfyui_generate` also attaches the produced images so they
 * appear in the conversation.
 */

import { PLUGIN_VERSION } from './version.js'
import { generateImage } from './generate.js'

const NO_PARAMETERS = { type: 'object', properties: {}, additionalProperties: false }

const ATTACHMENT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: true,
      properties: {
        width: { type: 'integer' },
        height: { type: 'integer' }
      },
      required: ['width', 'height']
    }
  },
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height']
}

const IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    path: { type: 'string', description: '会话工作区里的图片文件绝对路径。' },
    filename: { type: 'string' },
    mediaType: { type: 'string' },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    comfyuiPath: { type: 'string', description: 'ComfyUI 自己 output 目录中的原始文件路径。' },
    attachment: ATTACHMENT_SCHEMA
  },
  required: ['path', 'mediaType', 'bytes', 'width', 'height']
}

const MODELS_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    checkpoints: { type: 'array', items: { type: 'string' } },
    loras: { type: 'array', items: { type: 'string' } }
  },
  required: ['checkpoints', 'loras']
}

const DEFAULT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    checkpoint: { type: 'string' },
    sampler: { type: 'string' },
    scheduler: { type: 'string' },
    steps: { type: 'integer' },
    cfg: { type: 'number' },
    width: { type: 'integer' },
    height: { type: 'integer' }
  },
  required: ['sampler', 'scheduler', 'steps', 'cfg', 'width', 'height']
}

const DEVICE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    name: { type: 'string' },
    vramTotalMb: { type: 'integer' },
    vramFreeMb: { type: 'integer' }
  },
  required: ['name']
}

const QUEUE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    running: { type: 'integer' },
    pending: { type: 'integer' }
  },
  required: ['running', 'pending']
}

const STATUS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    pluginVersion: { type: 'string' },
    running: { type: 'boolean' },
    baseUrl: { type: 'string' },
    version: { type: 'string' },
    devices: { type: 'array', items: DEVICE_SCHEMA },
    queue: QUEUE_SCHEMA,
    installFound: { type: 'boolean' },
    installKind: { type: 'string' },
    installRoot: { type: 'string' },
    comfyDir: { type: 'string' },
    pythonPath: { type: 'string' },
    searched: { type: 'array', items: { type: 'string' } },
    configuredError: { type: 'string' },
    serverError: { type: 'string' },
    models: MODELS_SCHEMA,
    samplers: { type: 'array', items: { type: 'string' } },
    schedulers: { type: 'array', items: { type: 'string' } },
    defaults: DEFAULT_SCHEMA,
    next: { type: 'string' }
  },
  required: ['running', 'baseUrl', 'installFound', 'models', 'defaults', 'next']
}

const START_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    started: { type: 'boolean' },
    alreadyRunning: { type: 'boolean' },
    baseUrl: { type: 'string' },
    version: { type: 'string' },
    seconds: { type: 'number' },
    pid: { type: 'integer' },
    logFile: { type: 'string' },
    installFound: { type: 'boolean' },
    installKind: { type: 'string' },
    installRoot: { type: 'string' },
    comfyDir: { type: 'string' },
    next: { type: 'string' }
  },
  required: ['started', 'alreadyRunning', 'baseUrl', 'installFound', 'next']
}

const GENERATE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    promptId: { type: 'string' },
    checkpoint: { type: 'string' },
    seed: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    steps: { type: 'integer' },
    cfg: { type: 'number' },
    sampler: { type: 'string' },
    scheduler: { type: 'string' },
    count: { type: 'integer' },
    durationSeconds: { type: 'number' },
    outputDir: { type: 'string' },
    autoStarted: { type: 'boolean' },
    loras: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
    images: { type: 'array', items: IMAGE_SCHEMA }
  },
  required: [
    'promptId',
    'checkpoint',
    'seed',
    'width',
    'height',
    'steps',
    'cfg',
    'sampler',
    'scheduler',
    'count',
    'durationSeconds',
    'outputDir',
    'images'
  ]
}

function megabytes(bytes) {
  const value = Number(bytes)
  return Number.isFinite(value) ? Math.round(value / 1048576) : 0
}

function deviceLines(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return []
  return devices.map((device) => {
    const total = Number.isFinite(device.vramTotalMb) ? `${device.vramTotalMb} MB` : '?'
    const free = Number.isFinite(device.vramFreeMb) ? `${device.vramFreeMb} MB` : '?'
    return `- GPU：${device.name}（显存可用 ${free} / ${total}）`
  })
}

function formatStatusText(value) {
  const lines = []
  lines.push(value.running ? `ComfyUI 服务：运行中${value.version ? `（v${value.version}）` : ''}` : 'ComfyUI 服务：未运行')
  if (value.pluginVersion) lines.push(`- 插件版本：${value.pluginVersion}`)
  lines.push(`- 地址：${value.baseUrl}`)
  if (value.serverError) lines.push(`- 连接错误：${value.serverError}`)
  lines.push(...deviceLines(value.devices))
  if (value.queue) lines.push(`- 队列：运行 ${value.queue.running} · 等待 ${value.queue.pending}`)

  if (value.installFound) {
    lines.push(`- 安装：${value.installKind} · ${value.installRoot}`)
    if (value.comfyDir) lines.push(`  ComfyUI 目录：${value.comfyDir}`)
  } else {
    lines.push('- 安装：未找到')
    if (value.configuredError) lines.push(`  ${value.configuredError}`)
    if (Array.isArray(value.searched) && value.searched.length > 0) lines.push(`  已搜索：${value.searched.join('；')}`)
  }

  const checkpoints = value.models?.checkpoints ?? []
  const loras = value.models?.loras ?? []
  lines.push(`- 模型：checkpoint ${checkpoints.length} 个${checkpoints.length ? `（${checkpoints.slice(0, 8).join(', ')}${checkpoints.length > 8 ? ' …' : ''}）` : ''}；LoRA ${loras.length} 个`)
  if (Array.isArray(value.samplers) && value.samplers.length > 0) {
    lines.push(`- 采样器：${value.samplers.slice(0, 10).join(', ')}${value.samplers.length > 10 ? ' …' : ''}`)
  }
  const defaults = value.defaults
  if (defaults) {
    lines.push(
      `- 默认：${defaults.width}x${defaults.height} · ${defaults.steps} steps · CFG ${defaults.cfg} · ${defaults.sampler}/${defaults.scheduler}${defaults.checkpoint ? ` · ${defaults.checkpoint}` : ''}`
    )
  }
  lines.push(`- 下一步：${value.next}`)
  return lines.join('\n')
}

function formatStartText(value) {
  const lines = []
  if (value.alreadyRunning) {
    lines.push(`ComfyUI 已在运行${value.version ? `（v${value.version}）` : ''}`)
  } else {
    lines.push(`ComfyUI 已启动，用时 ${value.seconds ?? '?'} 秒`)
  }
  lines.push(`- 地址：${value.baseUrl}`)
  if (Number.isInteger(value.pid)) lines.push(`- 进程 PID：${value.pid}`)
  if (value.installFound) lines.push(`- 安装：${value.installKind} · ${value.installRoot}`)
  if (value.logFile) lines.push(`- 启动日志：${value.logFile}`)
  lines.push(`- 下一步：${value.next}`)
  return lines.join('\n')
}

function formatGenerateText(value) {
  const lines = []
  lines.push(`图片已生成：${value.count} 张，用时 ${value.durationSeconds} 秒${value.autoStarted ? '（ComfyUI 由插件自动启动）' : ''}`)
  lines.push(
    `- 参数：${value.checkpoint} · ${value.width}x${value.height} · ${value.steps} steps · CFG ${value.cfg} · ${value.sampler}/${value.scheduler} · seed ${value.seed}${value.loras?.length ? ` · LoRA ${value.loras.join(', ')}` : ''}`
  )
  lines.push(`- 保存目录：${value.outputDir}`)
  for (const image of value.images ?? []) {
    lines.push(`- 文件：${image.path}${image.comfyuiPath ? `（ComfyUI 原始输出：${image.comfyuiPath}）` : ''}`)
  }
  if (Array.isArray(value.notes) && value.notes.length > 0) {
    for (const note of value.notes) lines.push(`- 说明：${note}`)
  }
  return lines.join('\n')
}

/** Build the image content blocks for a generation result. */
function imageBlocks(value) {
  const blocks = []
  for (const image of value.images ?? []) {
    // saveImages keeps original-file metadata separately from the canonical
    // reference returned by the attachment store after normalization.
    const attachment = image.attachment
    if (!attachment?.attachmentId) continue
    blocks.push({ type: 'image', attachment: { ...attachment } })
  }
  return blocks
}

function statusTool(runtime) {
  const { config } = runtime
  return {
    name: 'comfyui_status',
    description:
      '查看本机 ComfyUI 生图服务状态：是否运行、版本、GPU 显存、队列，已发现的安装目录，以及可用的 checkpoint 模型与采样器。任何生图相关请求都应先调用它。',
    parameters: NO_PARAMETERS,
    output: {
      schema: STATUS_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatStatusText(value) }]
    },
    presentCall: () => ({ card: 'generic', title: '检查 ComfyUI 状态', kind: 'other' }),
    async execute(_args, exec) {
      const snapshot = await runtime.describe(exec?.signal)
      const { server, install, configuredError, searched, inventory } = snapshot
      const system = server.stats?.system ?? {}
      const rawDevices = Array.isArray(server.stats?.devices) ? server.stats.devices : []
      const devices = rawDevices.map((device) => ({
        name: String(device?.name ?? 'GPU'),
        vramTotalMb: megabytes(device?.vram_total),
        vramFreeMb: megabytes(device?.vram_free)
      }))
      const checkpoints = Array.isArray(inventory.checkpoints) ? inventory.checkpoints : []
      const loras = Array.isArray(inventory.loras) ? inventory.loras : []
      const configuredDefault = config.checkpoint && checkpoints.includes(config.checkpoint) ? config.checkpoint : checkpoints[0] ?? ''

      const next = server.running
        ? '服务已就绪，可直接调用 comfyui_generate 生成图片。'
        : install
          ? 'ComfyUI 已安装但未运行：调用 comfyui_start 启动（comfyui_generate 也会自动启动）。'
          : '未找到 ComfyUI 安装：请让用户提供安装目录，并在 comfyui_start 中用 install_dir 指定（会被记住）。'

      return {
        pluginVersion: PLUGIN_VERSION,
        running: server.running === true,
        baseUrl: config.baseUrl,
        ...(typeof system.comfyui_version === 'string' ? { version: system.comfyui_version } : {}),
        devices,
        ...(server.queue ? { queue: server.queue } : {}),
        installFound: Boolean(install),
        ...(install ? { installKind: install.kind, installRoot: install.root, comfyDir: install.comfyDir } : {}),
        ...(install?.pythonPath ? { pythonPath: install.pythonPath } : {}),
        searched: Array.isArray(searched) ? searched.slice(0, 12) : [],
        ...(configuredError ? { configuredError } : {}),
        ...(server.error ? { serverError: server.error } : {}),
        models: { checkpoints: checkpoints.slice(0, 50), loras: loras.slice(0, 50) },
        samplers: Array.isArray(inventory.samplers) ? inventory.samplers : [],
        schedulers: Array.isArray(inventory.schedulers) ? inventory.schedulers : [],
        defaults: {
          checkpoint: configuredDefault,
          sampler: config.sampler,
          scheduler: config.scheduler,
          steps: config.steps,
          cfg: config.cfg,
          width: config.width,
          height: config.height
        },
        next
      }
    }
  }
}

function startTool(runtime) {
  const { config } = runtime
  return {
    name: 'comfyui_start',
    description:
      '启动本机 ComfyUI 服务并等待就绪；如果已在运行则直接返回状态。插件会自动查找 ComfyUI 安装目录，也可以用 install_dir 明确指定（成功后会被记住）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        install_dir: {
          type: 'string',
          description:
            'ComfyUI 安装目录：包含 ComfyUI/ 与 python_embeded/ 的 portable 根目录，或其中 ComfyUI 文件夹本身的路径。仅在自动查找失败或用户给出路径时提供。'
        },
        wait_seconds: {
          type: 'integer',
          description: '等待服务就绪的最长秒数，默认 180。首次加载模型较慢时可调大。'
        }
      }
    },
    output: {
      schema: START_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatStartText(value) }]
    },
    presentCall: () => ({ card: 'generic', title: '启动 ComfyUI', kind: 'execute' }),
    async execute(args, exec) {
      const cwd = exec?.agent?.session?.header?.cwd
      const result = await runtime.ensureRunning({
        signal: exec?.signal,
        installDir: typeof args?.install_dir === 'string' ? args.install_dir : '',
        cwd,
        timeoutSeconds: args?.wait_seconds
      })
      const version = result.stats?.system?.comfyui_version
      return {
        started: result.started === true,
        alreadyRunning: result.started !== true,
        baseUrl: config.baseUrl,
        ...(typeof version === 'string' ? { version } : {}),
        seconds: result.seconds ?? 0,
        ...(Number.isInteger(result.pid) ? { pid: result.pid } : {}),
        ...(result.logFile ? { logFile: result.logFile } : {}),
        installFound: Boolean(result.install),
        ...(result.install ? { installKind: result.install.kind, installRoot: result.install.root, comfyDir: result.install.comfyDir } : {}),
        next: result.started
          ? '服务已就绪，可以调用 comfyui_generate 生成图片。'
          : '服务已在运行，可以调用 comfyui_generate 生成图片。'
      }
    }
  }
}

function generateTool(runtime) {
  const { config } = runtime
  return {
    name: 'comfyui_generate',
    description:
      '用本机 ComfyUI 按文本提示词生成图片（txt2img）：保存到会话工作区并把图片附回对话。服务未运行时会自动启动。生成通常需要数十秒到几分钟，期间不要重复调用同一请求。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: {
          type: 'string',
          description:
            '画面描述（必填）：主体、动作、服装、场景、风格、画质、光照、构图。SDXL/Illustrious 系模型用英文逗号分隔的标签效果最好。'
        },
        negative_prompt: {
          type: 'string',
          description: '不希望出现的元素；省略时使用插件配置里的通用负面提示词。'
        },
        width: {
          type: 'integer',
          description: '宽度（像素，自动对齐到 8 的倍数）；默认取插件配置。竖图常用 832x1216，横图 1216x832。'
        },
        height: {
          type: 'integer',
          description: '高度（像素，自动对齐到 8 的倍数）；默认取插件配置。'
        },
        steps: { type: 'integer', description: '采样步数，默认取插件配置（通常 20-40）。' },
        cfg: { type: 'number', description: '提示词引导强度，默认取插件配置（SDXL/Illustrious 常用 4-7）。' },
        sampler_name: { type: 'string', description: '采样器名称，默认取插件配置；可选值见 comfyui_status。' },
        scheduler: { type: 'string', description: '调度器名称，默认取插件配置；可选值见 comfyui_status。' },
        seed: {
          type: 'integer',
          description: '随机种子；省略或传 -1 表示随机。想复现或微调同一张图时，传上次结果里的 seed。'
        },
        count: { type: 'integer', description: '一次生成的图片数量，默认 1（上限由插件配置 maxImages 决定）。' },
        checkpoint: {
          type: 'string',
          description: 'checkpoint 模型文件名；省略时使用插件配置或第一个可用模型。可选值见 comfyui_status。'
        },
        loras: {
          type: 'array',
          description: '要叠加的 LoRA，按数组顺序生效；名称必须存在于 ComfyUI 的 models/loras。',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', description: 'LoRA 文件名。' },
              strength: { type: 'number', description: '强度，默认 0.8。' }
            },
            required: ['name']
          }
        }
      },
      required: ['prompt']
    },
    output: {
      schema: GENERATE_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: formatGenerateText(value) }, ...imageBlocks(value)]
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `ComfyUI 生成：${String(args?.prompt ?? '').slice(0, 60)}`,
      kind: 'other'
    }),
    async execute(args, exec) {
      return generateImage({ runtime, config, ctx: runtime.ctx, args: args ?? {}, exec })
    }
  }
}

/** All tools this bundle contributes. */
export function createComfyTools(runtime) {
  return [statusTool(runtime), startTool(runtime), generateTool(runtime)]
}
