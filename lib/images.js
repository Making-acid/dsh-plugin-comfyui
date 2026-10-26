/**
 * Persist generated images: a durable copy in the session workspace plus a
 * chat attachment so the picture shows up in the conversation.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]

function expandHome(value) {
  const trimmed = value.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return path.join(os.homedir(), trimmed.slice(2))
  return trimmed
}

function sessionCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** Directory that receives generated images. */
export function resolveOutputDir(config, exec) {
  const configured = config.outputDir?.trim()
  const cwd = sessionCwd(exec)
  if (configured) {
    const expanded = expandHome(configured)
    return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd ?? process.cwd(), expanded)
  }
  return path.join(cwd ?? os.homedir(), 'comfyui-output')
}

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || 'image.png')).replace(/[\\/:*?"<>|]+/g, '_')
  return base.length > 0 ? base : 'image.png'
}

/** Media type from the PNG/JPEG signature, then from the extension. */
export function detectMediaType(data, fileName) {
  if (data.length >= 4 && PNG_SIGNATURE.every((byte, index) => data[index] === byte)) return 'image/png'
  if (data.length >= 3 && JPEG_SIGNATURE.every((byte, index) => data[index] === byte)) return 'image/jpeg'
  if (/\.jpe?g$/i.test(fileName ?? '')) return 'image/jpeg'
  if (/\.webp$/i.test(fileName ?? '')) return 'image/webp'
  return 'image/png'
}

function getService(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

/**
 * Write every downloaded image twice: a file under the output directory and an
 * attachment for the conversation.
 * @param {object} options
 * @param {import('@deepseek-ai/cordis').Context} options.ctx
 * @param {object} options.config
 * @param {any} options.exec - tool run context (for the session workspace)
 * @param {Array<{data: Uint8Array, filename: string, mediaType: string, width: number, height: number, comfyuiPath?: string}>} options.downloads
 */
export async function saveImages({ ctx, config, exec, downloads }) {
  const outputDir = resolveOutputDir(config, exec)
  await fs.mkdir(outputDir, { recursive: true })
  const attachments = getService(ctx, 'attachments')
  const stamp = timestamp()
  const images = []

  for (let index = 0; index < downloads.length; index += 1) {
    const item = downloads[index]
    const data = item.data instanceof Uint8Array ? item.data : new Uint8Array(item.data)
    const fileName = `${stamp}_${sanitizeFileName(item.filename ?? `comfyui_${index + 1}.png`)}`
    const filePath = path.join(outputDir, fileName)
    await fs.writeFile(filePath, data)

    const record = {
      path: filePath,
      filename: fileName,
      mediaType: item.mediaType ?? detectMediaType(data, item.filename),
      bytes: data.byteLength,
      width: item.width,
      height: item.height
    }
    if (item.comfyuiPath) record.comfyuiPath = item.comfyuiPath

    if (attachments && typeof attachments.saveImage === 'function') {
      try {
        const ref = await attachments.saveImage({ data, mediaType: record.mediaType, name: fileName })
        // The attachment store may normalize the image (re-encode / downscale),
        // so its returned reference is the only authoritative description of the
        // stored object. Reusing the original bytes' metadata here fails the
        // store's read-back verification later ("Stored attachment metadata does
        // not match its reference").
        if (ref?.attachmentId !== undefined) {
          record.attachment = {
            attachmentId: String(ref.attachmentId),
            mediaType: ref.mediaType,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
            ...(ref.name === undefined ? {} : { name: ref.name }),
            ...(ref.originalDimensions === undefined
              ? {}
              : { originalDimensions: { ...ref.originalDimensions } })
          }
        }
      } catch {
        /* the file on disk is still a usable result */
      }
    }
    images.push(record)
  }

  return { outputDir, images }
}
