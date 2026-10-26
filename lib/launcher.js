/**
 * Start the local ComfyUI process and wait until its HTTP API answers.
 *
 * The process is detached so it keeps running after this plugin or the session
 * goes away (the same thing the user's own `run_nvidia_gpu.bat` would do), and
 * its stdout/stderr are redirected to a log file so a failed start can be
 * diagnosed from the tool result instead of a console window.
 */

import { spawn } from 'node:child_process'
import { closeSync, openSync, promises as fs, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { probeServer } from './http.js'

/** Default log file used when the session workspace is unavailable. */
export function defaultLogFile() {
  return path.join(os.tmpdir(), 'dsh-comfyui-launch.log')
}

/**
 * Build the command that starts ComfyUI for a discovered installation.
 * @param {{kind: string, root: string, comfyDir: string, pythonPath: string}} install
 * @param {{baseUrl: string, host: string, port: number, pythonPath: string, extraLaunchArgs: string[]}} config
 */
export function buildLaunchPlan(install, config) {
  const mainScript = path.join(install.comfyDir, 'main.py')
  const listenArgs = ['--port', String(config.port), '--listen', config.host === 'localhost' ? '127.0.0.1' : config.host]

  if (install.kind === 'portable') {
    return {
      command: install.pythonPath,
      args: ['-s', mainScript, '--windows-standalone-build', ...listenArgs, ...config.extraLaunchArgs],
      cwd: install.root
    }
  }

  const python = config.pythonPath || install.pythonPath || (process.platform === 'win32' ? 'python' : 'python3')
  return {
    command: python,
    args: [mainScript, ...listenArgs, ...config.extraLaunchArgs],
    cwd: install.comfyDir
  }
}

/** Whether a pid is still alive. */
function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** Read the tail of a log file for diagnostics. */
export async function readLogTail(logFile, maxLines = 40) {
  try {
    const info = await fs.stat(logFile)
    const length = Math.min(info.size, 16384)
    const handle = await fs.open(logFile, 'r')
    try {
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, info.size - length)
      return buffer
        .toString('utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .slice(-maxLines)
        .join('\n')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/**
 * Spawn ComfyUI detached and resolve once the process exists.
 * @returns {Promise<{pid: number, logFile: string}>}
 */
export async function launchServer(plan, logFile) {
  mkdirSync(path.dirname(logFile), { recursive: true })
  const handle = openSync(logFile, 'a')
  let child
  try {
    child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', handle, handle],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
    })
  } finally {
    closeSync(handle)
  }

  await new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off('error', onError)
      resolve()
    }
    const onError = (error) => {
      child.off('spawn', onSpawn)
      reject(
        new Error(
          `无法启动 ComfyUI：命令 "${plan.command}" 执行失败（${error?.code || error?.message}）。请检查安装路径与 Python 是否可用。`
        )
      )
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })

  const pid = child.pid
  child.unref()
  return { pid, logFile }
}

/**
 * Poll the API until it answers, the process dies, or the deadline expires.
 * @returns {Promise<{seconds: number, stats: any}>}
 */
export async function waitForServer(baseUrl, { pid, logFile, timeoutMs, signal } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw new Error('等待 ComfyUI 启动时操作被中断')
    const probe = await probeServer(baseUrl, { signal, timeoutMs: 2500 })
    if (probe.available) {
      return { seconds: Math.round(((Date.now() - startedAt) / 1000) * 10) / 10, stats: probe.stats }
    }
    if (pid !== undefined && !processAlive(pid)) {
      const tail = logFile ? await readLogTail(logFile) : ''
      throw new Error(
        `ComfyUI 进程启动后立即退出（pid ${pid}）。${tail ? `\n启动日志（${logFile}）末尾：\n${tail}` : '未捕获到启动日志。'}`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  const tail = logFile ? await readLogTail(logFile) : ''
  throw new Error(
    `等待 ComfyUI 就绪超时（${Math.round(timeoutMs / 1000)} 秒）。${tail ? `\n启动日志（${logFile}）末尾：\n${tail}` : `启动日志：${logFile ?? '(无)'}`}`
  )
}
