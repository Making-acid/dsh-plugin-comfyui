/**
 * Shared plugin runtime: server state, install discovery, auto-start and model
 * inventory. One instance is created per plugin activation and shared by every
 * tool definition, so a discovery or a launch is not repeated across tools.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { fetchInventory } from './comfy.js'
import { discoverInstall, inspectInstallDir, listCheckpointFiles } from './discover.js'
import { getQueue, probeServer } from './http.js'
import { buildLaunchPlan, defaultLogFile, launchServer, waitForServer } from './launcher.js'

const PACKAGE_NAME = 'dsh-comfyui'
const ENTRY_ID = 'comfyui'

const EMPTY_INVENTORY = { checkpoints: [], loras: [], samplers: [], schedulers: [] }

function resolveLogger(ctx) {
  try {
    if (typeof ctx?.logger === 'function') return ctx.logger('comfyui')
  } catch {
    /* fall through to the silent logger */
  }
  return null
}

function safeLog(logger, level, message) {
  const target = logger?.[level]
  if (typeof target !== 'function') return
  try {
    target.call(logger, message)
  } catch {
    /* logging must never break a tool call */
  }
}

async function pathExists(target) {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

function readQueue(data) {
  return {
    running: Array.isArray(data?.queue_running) ? data.queue_running.length : 0,
    pending: Array.isArray(data?.queue_pending) ? data.queue_pending.length : 0
  }
}

/** One activation-scoped runtime. */
export function createRuntime(ctx, config) {
  const logger = resolveLogger(ctx)
  const state = {
    /** @type {null | {kind: string, root: string, comfyDir: string, pythonPath: string}} */
    install: null,
    /** In-flight launch, so concurrent tool calls share one startup. */
    launching: null
  }

  async function findInstall({ refresh = false, installDir, signal } = {}) {
    void signal
    const explicit = typeof installDir === 'string' ? installDir.trim() : ''
    if (explicit) {
      const hit = await inspectInstallDir(explicit)
      if (hit) {
        state.install = hit
        return { install: hit, searched: [explicit], configuredError: '' }
      }
      const discovered = await discoverInstall({ installDir: config.installDir, searchDirs: config.searchDirs })
      return {
        install: discovered,
        searched: discovered?.searched ?? [explicit],
        configuredError: `指定的 install_dir 不是可用的 ComfyUI 安装目录：${explicit}`
      }
    }

    if (!refresh && state.install && (await pathExists(state.install.comfyDir))) {
      return { install: state.install, searched: [], configuredError: '' }
    }

    let configuredError = ''
    if (config.installDir) {
      const configured = await inspectInstallDir(config.installDir)
      if (configured) {
        state.install = configured
        return { install: configured, searched: [config.installDir], configuredError }
      }
      configuredError = `插件配置里的 installDir 无效：${config.installDir}`
    }

    const discovered = await discoverInstall({ searchDirs: config.searchDirs })
    state.install = discovered
    return { install: discovered, searched: discovered?.searched ?? [], configuredError }
  }

  async function readServer(signal) {
    const probe = await probeServer(config.baseUrl, { signal, timeoutMs: 2500 })
    if (!probe.available) return { running: false, error: probe.error }
    let queue
    try {
      queue = readQueue(await getQueue(config.baseUrl, { signal }))
    } catch {
      queue = undefined
    }
    return { running: true, stats: probe.stats, queue }
  }

  /** One consistent snapshot for `comfyui_status`: server, install and models. */
  async function describe(signal) {
    const server = await readServer(signal)
    const found = await findInstall({ signal })

    let inventory = EMPTY_INVENTORY
    if (server.running) {
      try {
        inventory = await fetchInventory(config.baseUrl, signal)
      } catch (error) {
        safeLog(logger, 'warn', `读取 ComfyUI 模型清单失败：${error?.message ?? error}`)
      }
    } else if (found.install) {
      inventory = { ...EMPTY_INVENTORY, checkpoints: await listCheckpointFiles(found.install.comfyDir) }
    }

    return {
      server,
      install: found.install,
      configuredError: found.configuredError,
      searched: found.searched,
      inventory
    }
  }

  /** Persist a discovered install dir into the profile patch through configEditor. */
  async function persistInstall(install) {
    if (!config.persistDiscovery || !install) return false
    if (config.installDir === install.root || config.installDir === install.comfyDir) return false
    let editor
    try {
      editor = ctx.get?.('configEditor')
    } catch {
      editor = undefined
    }
    if (!editor || typeof editor.entries !== 'function' || typeof editor.edit !== 'function') return false
    try {
      const entry = editor.entries().find((candidate) => {
        const options = candidate?.options ?? {}
        return options.name === PACKAGE_NAME || options.id === ENTRY_ID
      })
      if (!entry) return false
      const target = install.root
      await editor.edit(entry, (current, inherited) => ({
        ...(inherited ?? {}),
        ...(current ?? {}),
        installDir: target
      }))
      safeLog(logger, 'info', `ComfyUI 安装目录已写入插件配置：${target}`)
      return true
    } catch (error) {
      safeLog(logger, 'warn', `无法把 ComfyUI 安装目录写入配置：${error?.message ?? error}`)
      return false
    }
  }

  function launchLogFile(cwd) {
    if (config.launchLogFile) return config.launchLogFile
    const base = typeof cwd === 'string' && cwd ? cwd : path.dirname(defaultLogFile())
    return path.join(base, 'comfyui-launch.log')
  }

  function noInstallMessage({ searched, configuredError, installDir }) {
    const lines = ['在这台电脑上没有找到 ComfyUI 安装，因此无法生成图片。']
    if (configuredError) lines.push(configuredError)
    if (installDir) lines.push(`指定的 install_dir：${installDir}`)
    const roots = (searched ?? []).slice(0, 12)
    if (roots.length > 0) lines.push(`已搜索：${roots.join('；')}`)
    lines.push('解决办法（任选其一）：')
    lines.push('1) 让用户给出 ComfyUI 安装目录，并在调用 comfyui_start 时传 install_dir（插件会记住该路径）；')
    lines.push('2) 在 profile 的 cordis.patch.yml 中给 comfyui 行配置 installDir；')
    lines.push('3) 让用户安装 ComfyUI（https://www.comfy.org/download），并把模型放进 models/checkpoints。')
    return lines.join('\n')
  }

  /**
   * Guarantee a reachable server, starting a local one when allowed.
   * @returns {Promise<{started: boolean, stats: any, install: any, seconds: number, pid?: number, logFile?: string}>}
   */
  async function ensureRunning({ signal, installDir, cwd, timeoutSeconds } = {}) {
    const probe = await probeServer(config.baseUrl, { signal, timeoutMs: 2500 })
    if (probe.available) {
      const { install } = await findInstall({ signal })
      return { started: false, stats: probe.stats, install, seconds: 0 }
    }
    if (!config.isLocal) {
      throw new Error(
        `ComfyUI 服务不可达（${config.baseUrl}），而且该地址不是本机，插件无法代为启动。请检查服务地址/端口，或先手动启动远端 ComfyUI。`
      )
    }
    if (!config.autoStart) {
      throw new Error(`ComfyUI 未在 ${config.baseUrl} 运行，且插件配置 autoStart=false。请先启动 ComfyUI，或调用 comfyui_start。`)
    }
    if (state.launching) return state.launching

    state.launching = (async () => {
      const found = await findInstall({ refresh: true, installDir, signal })
      const { install } = found
      if (!install) throw new Error(noInstallMessage(found))
      const plan = buildLaunchPlan(install, config)
      const logFile = launchLogFile(cwd)
      safeLog(logger, 'info', `启动 ComfyUI：${plan.command} ${plan.args.join(' ')}（cwd=${plan.cwd}）`)
      const launched = await launchServer(plan, logFile)
      const timeout = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : config.startTimeoutSeconds
      const ready = await waitForServer(config.baseUrl, {
        pid: launched.pid,
        logFile,
        timeoutMs: timeout * 1000,
        signal
      })
      safeLog(logger, 'info', `ComfyUI 就绪，用时 ${ready.seconds}s（pid ${launched.pid}）`)
      await persistInstall(install)
      state.install = install
      return {
        started: true,
        stats: ready.stats,
        install,
        seconds: ready.seconds,
        pid: launched.pid,
        logFile
      }
    })()

    try {
      return await state.launching
    } finally {
      state.launching = null
    }
  }

  return {
    config,
    ctx,
    logger,
    state,
    findInstall,
    describe,
    ensureRunning,
    persistInstall,
    noInstallMessage
  }
}
