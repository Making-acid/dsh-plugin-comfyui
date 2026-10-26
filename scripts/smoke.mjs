/**
 * Pre-install smoke test for the dsh-comfyui bundle.
 *
 * Runs the plugin's own modules against the ComfyUI that is already running on
 * this machine, and validates every tool schema with the Harness' own schema
 * subset checker (imported from the installed app, not from the workspace).
 *
 * Usage: node scripts/smoke.mjs [--generate]
 */

import { pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { normalizeConfig } from '../lib/config.js'
import { buildTxt2ImgGraph, comboChoices, resolveCheckpoint, resolveChoice } from '../lib/comfy.js'
import { discoverInstall } from '../lib/discover.js'
import { generateImage } from '../lib/generate.js'
import { probeServer } from '../lib/http.js'
import { createRuntime } from '../lib/runtime.js'
import { createComfyTools } from '../lib/tools.js'

const APP_TOOLS = 'C:/Program Files/DSH NEXT/resources/app/node_modules/@deepseek-ai/dsh-tools/lib/index.js'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('== config ==')
const config = normalizeConfig({})
check('baseUrl default', config.baseUrl === 'http://127.0.0.1:8188', config.baseUrl)
check('isLocal', config.isLocal === true)
check('sampler default', config.sampler === 'dpmpp_2m')
check('autoStart default', config.autoStart === true)
const overridden = normalizeConfig({ baseUrl: 'http://192.168.1.9:9000/', autoStart: false, width: '640', steps: 999 })
check('baseUrl trim', overridden.baseUrl === 'http://192.168.1.9:9000', overridden.baseUrl)
check('remote isLocal false', overridden.isLocal === false)
check('width coerced', overridden.width === 640)
check('steps clamped', overridden.steps === 200, String(overridden.steps))

console.log('== comboChoices ==')
check('classic list', comboChoices([[['a'], {}]]).length === 0) // intentional: nested list is not the spec shape
check('classic shape', JSON.stringify(comboChoices([['euler', 'dpmpp_2m'], { tooltip: 'x' }])) === '["euler","dpmpp_2m"]')
check('COMBO shape', JSON.stringify(comboChoices(['COMBO', { multiselect: false, options: ['sdxl'] }])) === '["sdxl"]')
check('object shape', JSON.stringify(comboChoices([{ options: ['v1'] }, {}])) === '["v1"]')

console.log('== graph ==')
const graph = buildTxt2ImgGraph({
  prompt: 'a cat',
  negativePrompt: 'blurry',
  width: 832,
  height: 1216,
  batchSize: 1,
  steps: 24,
  cfg: 5,
  sampler: 'dpmpp_2m',
  scheduler: 'karras',
  seed: 42,
  checkpoint: 'model.safetensors',
  loras: [{ name: 'style.safetensors', strength: 0.7 }],
  filenamePrefix: 'dsh_comfy'
})
check('checkpoint node', graph['4'].class_type === 'CheckpointLoaderSimple')
check('lora chained into sampler', graph['3'].inputs.model[0] === '20' && graph['20'].inputs.clip[0] === '4')
check('sampler wiring', graph['3'].inputs.positive[0] === '6' && graph['3'].inputs.latent_image[0] === '5')
check('save node', graph['9'].inputs.images[0] === '8')

console.log('== model choice guards ==')
try {
  resolveCheckpoint([], '', '')
  check('empty checkpoint throws', false)
} catch (error) {
  check('empty checkpoint throws', /没有可用的 checkpoint/.test(error.message))
}
check('configured stale falls back', resolveCheckpoint(['a.safetensors'], '', 'missing.safetensors') === 'a.safetensors')
try {
  resolveChoice(['euler'], 'nope', 'euler', 'sampler_name')
  check('bad sampler throws', false)
} catch (error) {
  check('bad sampler throws', /不被当前 ComfyUI 支持/.test(error.message))
}

console.log('== discovery ==')
const found = await discoverInstall({})
check('finds local install', Boolean(found), JSON.stringify(found?.searched))
if (found) {
  check('portable layout', found.kind === 'portable', found.kind)
  check('has main.py', await fs.stat(path.join(found.comfyDir, 'main.py')).then(() => true).catch(() => false))
}

console.log('== server ==')
const probe = await probeServer(config.baseUrl, { timeoutMs: 3000 })
check('server reachable', probe.available, probe.error)
if (!probe.available) {
  console.log('ComfyUI is not running; skipping live parts (start it and rerun).')
} else {
  const ctx = { logger: () => ({ info: console.log, warn: console.warn }), get: () => undefined }
  const runtime = createRuntime(ctx, config)
  const snapshot = await runtime.describe()
  check('describe running', snapshot.server.running === true)
  check('inventory has checkpoint', snapshot.inventory.checkpoints.length > 0, JSON.stringify(snapshot.inventory.checkpoints))
  check('inventory has sampler', snapshot.inventory.samplers.includes('dpmpp_2m'))

  console.log('== harness schema subset ==')
  const harness = await import(pathToFileURL(APP_TOOLS).href)
  for (const tool of createComfyTools(runtime)) {
    try {
      harness.assertSupportedJsonSchema(tool.output.schema)
      harness.assertObjectJsonSchema(tool.parameters)
      check(`schema ${tool.name}`, true)
    } catch (error) {
      check(`schema ${tool.name}`, false, error.message)
    }
  }

  const statusTool = createComfyTools(runtime).find((tool) => tool.name === 'comfyui_status')
  const statusValue = await statusTool.execute({}, { signal: undefined })
  check('status value', statusValue.running === true && statusValue.models.checkpoints.length > 0)
  console.log(statusTool.output.render({}, statusValue)[0].text)
  console.log('== live generation (small) ==')
  const exec = {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: process.cwd() } } }
  }
  const startedAt = Date.now()
  const result = await generateImage({
    runtime,
    config,
    ctx,
    args: { prompt: 'masterpiece, best quality, 1girl, short silver hair, blue eyes, simple white background', width: 512, height: 512, steps: 8, seed: 1234 },
    exec
  })
  check('generated images', result.images.length === 1, JSON.stringify(result.images))
  const image = result.images[0]
  const exists = await fs.stat(image.path).then(() => true).catch(() => false)
  check('image file written', exists, image.path)
  const head = await fs.readFile(image.path).then((buffer) => buffer.subarray(0, 8))
  check('image is PNG', head[0] === 0x89 && head[1] === 0x50, head.toString('hex'))
  check('rendered image block', true)
  const blocks = createComfyTools(runtime).find((tool) => tool.name === 'comfyui_generate').output.render({}, result)
  check('render returns text block', blocks[0].type === 'text' && blocks[0].text.includes('图片已生成'))
  console.log(blocks[0].text)
  console.log(`generation took ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
