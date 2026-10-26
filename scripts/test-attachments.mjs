/**
 * Regression test for the generated-image attachment path.
 *
 * It runs the plugin's real `saveImages()` against the Harness's real local
 * attachment store (imported from the installed app), and proves two things:
 *
 *  1. the store normalizes a large PNG (it may re-encode or downscale it), so the
 *     caller must trust the returned reference instead of the original bytes;
 *  2. the reference the plugin puts in its image content block passes the store's
 *     read-back verification — the exact check that failed with
 *     "Stored attachment metadata does not match its reference".
 *
 * Usage: node scripts/test-attachments.mjs [path/to/fixture.png]
 */

import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { saveImages } from '../lib/images.js'

const APP = 'C:/Program Files/DSH NEXT/resources/app/node_modules'
const FIXTURE =
  process.argv[2] ||
  path.resolve(import.meta.dirname, '..', 'comfyui-output', '20261025-132523_dsh_comfy_00001_.png')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function importHarness(relative) {
  return import(pathToFileURL(`${APP}/${relative}`).href)
}

const { Context } = await importHarness('@deepseek-ai/cordis/lib/index.js')
const { default: LocalAttachmentStore } = await importHarness('@deepseek-ai/dsh-attachment-local/lib/index.js')

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-comfyui-attach-'))
const ctx = new Context()
const store = new LocalAttachmentStore(ctx, { dshHome: tempHome })

const png = await fs.readFile(FIXTURE)
console.log(`fixture: ${FIXTURE} (${png.byteLength} bytes)`)

console.log('== store normalization ==')
const sourceRef = await store.saveImage({ data: new Uint8Array(png), mediaType: 'image/png', name: 'fixture.png' })
console.log(
  `  store ref: ${sourceRef.mediaType} ${sourceRef.width}x${sourceRef.height} ${sourceRef.bytes} bytes (source was image/png ${png.byteLength} bytes)`
)
check(
  'large PNG is normalized by the store',
  sourceRef.mediaType !== 'image/png' || sourceRef.bytes !== png.byteLength,
  'store passed the bytes through unchanged, so this fixture does not exercise normalization'
)

console.log('== plugin saveImages() ==')
const config = { outputDir: path.join(tempHome, 'out') }
const exec = { agent: { session: { header: { cwd: tempHome } } } }
const saved = await saveImages({
  ctx: { get: (name) => (name === 'attachments' ? store : undefined) },
  config,
  exec,
  downloads: [{ data: new Uint8Array(png), filename: 'fixture.png', width: sourceRef.width, height: sourceRef.height }]
})
const record = saved.images[0]
check('image file written', await fs.stat(record.path).then(() => true).catch(() => false), record.path)
check('attachment reference captured', Boolean(record.attachment), JSON.stringify(record))
check(
  'reference uses the store metadata, not the source bytes',
  record.attachment.mediaType === sourceRef.mediaType &&
    record.attachment.bytes === sourceRef.bytes &&
    record.attachment.width === sourceRef.width &&
    record.attachment.height === sourceRef.height,
  JSON.stringify(record.attachment)
)

console.log('== read-back verification (the bug that failed) ==')
const readBack = await store.readImage(record.attachment)
check('store readImage() accepts the plugin reference', readBack.data.byteLength === sourceRef.bytes)

const legacy = {
  attachmentId: sourceRef.attachmentId,
  mediaType: 'image/png',
  bytes: png.byteLength,
  width: sourceRef.width,
  height: sourceRef.height
}
let legacyRejected = false
try {
  await store.readImage(legacy)
} catch (error) {
  legacyRejected = /does not match its reference/.test(error?.message ?? '')
}
check('legacy original-bytes metadata is rejected (regression guard)', legacyRejected)

await fs.rm(tempHome, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
