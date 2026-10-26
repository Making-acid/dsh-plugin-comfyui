/**
 * Locate a ComfyUI installation on this machine.
 *
 * Two layouts are recognized:
 *  - "portable": a directory that contains `ComfyUI/` plus `python_embeded/`
 *    (the Windows portable archive), or the `ComfyUI` folder inside it.
 *  - "source": a `ComfyUI` checkout with `main.py` and `nodes.py`, started
 *    with a Python interpreter from PATH.
 *
 * Searching is bounded: named candidates are inspected directly, then a
 * shallow breadth-first scan over likely roots runs with a wall-clock budget so
 * a status call never hangs on a large disk.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SKIP_DIRECTORIES = new Set([
  '$recycle.bin',
  'system volume information',
  'windows',
  'winsxs',
  'programdata',
  'appdata',
  'node_modules',
  'site-packages',
  '__pycache__',
  '.git',
  '.cache',
  '.venv',
  'venv',
  'temp',
  'tmp'
])

const COMFY_NAME = /comfy/i
const SEARCH_BUDGET_MS = 12000
const MAX_DIRS_PER_ROOT = 600

async function statPath(target) {
  try {
    return await fs.stat(target)
  } catch {
    return undefined
  }
}

async function isFile(target) {
  const info = await statPath(target)
  return info?.isFile() === true
}

async function isDir(target) {
  const info = await statPath(target)
  return info?.isDirectory() === true
}

function pythonExecutable(root) {
  return process.platform === 'win32'
    ? path.join(root, 'python_embeded', 'python.exe')
    : path.join(root, 'python_embeded', 'bin', 'python')
}

/**
 * Classify one path as a ComfyUI installation.
 * @param {string} dir - candidate directory (portable root, or the ComfyUI folder).
 * @returns {Promise<null | {kind: string, root: string, comfyDir: string, pythonPath: string}>}
 */
export async function inspectInstallDir(dir) {
  if (!dir) return null
  const resolved = path.resolve(dir)

  // Portable root: <root>/ComfyUI/main.py + <root>/python_embeded/python(.exe)
  const portableComfy = path.join(resolved, 'ComfyUI')
  if ((await isFile(path.join(portableComfy, 'main.py'))) && (await isDir(path.join(resolved, 'python_embeded')))) {
    return {
      kind: 'portable',
      root: resolved,
      comfyDir: portableComfy,
      pythonPath: pythonExecutable(resolved)
    }
  }

  // The ComfyUI folder itself (portable or source checkout).
  if (await isFile(path.join(resolved, 'main.py'))) {
    const parent = path.dirname(resolved)
    const embedded = pythonExecutable(parent)
    if (await isFile(embedded)) {
      return { kind: 'portable', root: parent, comfyDir: resolved, pythonPath: embedded }
    }
    return { kind: 'source', root: resolved, comfyDir: resolved, pythonPath: '' }
  }

  return null
}

/** Candidate roots to scan, in priority order, without duplicates. */
function defaultRoots() {
  const home = os.homedir()
  const roots = []
  const push = (value) => {
    if (typeof value !== 'string' || !value) return
    const resolved = path.resolve(value)
    if (!roots.includes(resolved)) roots.push(resolved)
  }

  const drive = process.env.SystemDrive || 'C:'
  push(path.join(`${drive}${path.sep}`, 'AIpainting'))
  push(path.join(`${drive}${path.sep}`, 'ComfyUI'))
  for (const letter of ['D:', 'E:', 'F:']) {
    push(path.join(`${letter}${path.sep}`, 'ComfyUI'))
    push(path.join(`${letter}${path.sep}`, 'AIpainting'))
  }
  push(path.join(home, 'ComfyUI'))
  push(path.join(home, 'Desktop'))
  push(path.join(home, 'Documents'))
  push(path.join(home, 'Downloads'))
  push(path.join(home, 'AppData', 'Local', 'Programs'))
  return roots
}

/** Breadth-first scan of one root, bounded by depth, entries and the deadline. */
async function scanRoot(root, deadline) {
  if (Date.now() > deadline) return null
  const direct = await inspectInstallDir(root)
  if (direct) return direct

  const queue = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < MAX_DIRS_PER_ROOT && Date.now() <= deadline) {
    const current = queue.shift()
    visited += 1
    let entries
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = entry.name.toLowerCase()
      if (SKIP_DIRECTORIES.has(name)) continue
      const child = path.join(current.dir, entry.name)
      if (COMFY_NAME.test(entry.name)) {
        const hit = await inspectInstallDir(child)
        if (hit) return hit
      }
      if (current.depth < 2) queue.push({ dir: child, depth: current.depth + 1 })
    }
  }
  return null
}

/**
 * Discover a ComfyUI installation.
 * @param {{installDir?: string, searchDirs?: string[]}} options
 * @returns {Promise<null | {kind: string, root: string, comfyDir: string, pythonPath: string, searched: string[]}>}
 */
export async function discoverInstall(options = {}) {
  const searched = []
  const explicit = typeof options.installDir === 'string' ? options.installDir.trim() : ''
  if (explicit) {
    const hit = await inspectInstallDir(explicit)
    if (hit) return { ...hit, searched }
    // An explicit path that is not usable is reported by the caller, which knows
    // how the user configured it; keep searching so a stale path cannot block.
    searched.push(explicit)
  }

  const roots = [...(options.searchDirs ?? []), ...defaultRoots()]
  const deadline = Date.now() + SEARCH_BUDGET_MS
  for (const root of roots) {
    if (searched.includes(root)) continue
    searched.push(root)
    const hit = await scanRoot(root, deadline)
    if (hit) return { ...hit, searched }
    if (Date.now() > deadline) break
  }
  return null
}

/** Filesystem fallback for the model list when the server is not running. */
export async function listCheckpointFiles(comfyDir) {
  const dir = path.join(comfyDir, 'models', 'checkpoints')
  const found = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.(safetensors|ckpt|pt|bin)$/i.test(entry.name)) continue
      found.push(entry.name)
    }
  } catch {
    /* models directory is optional */
  }
  return found.sort()
}
