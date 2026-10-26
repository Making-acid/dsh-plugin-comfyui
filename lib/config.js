/**
 * Configuration normalization for the ComfyUI bundle.
 *
 * The row's `config` is plain YAML and is not schema-validated (this bundle
 * deliberately declares no `Config` export so it keeps working across Harness
 * versions without a peer dependency on schemastery). Every field therefore has
 * a documented default here, and bad values are coerced instead of throwing.
 */

/** The negative prompt used when the caller does not supply one (SDXL-safe). */
export const DEFAULT_NEGATIVE_PROMPT = [
  'lowres',
  'bad anatomy',
  'bad hands',
  'extra digits',
  'fewer digits',
  'worst quality',
  'low quality',
  'jpeg artifacts',
  'signature',
  'watermark',
  'username',
  'blurry',
  'text',
  'error'
].join(', ')

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function textList(value) {
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function number(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function integer(value, fallback, min, max) {
  const parsed = Math.round(number(value, fallback))
  return Math.min(max, Math.max(min, parsed))
}

/** Parse a URL, returning undefined instead of throwing. */
function parseUrl(value) {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/**
 * Normalize the raw bundle config into the shape the tools consume.
 * @param {unknown} raw - the Loader row's `config` value (may be missing).
 */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const portDefault = integer(source.port, 8188, 1, 65535)
  const configuredBaseUrl = text(source.baseUrl)
  const baseUrl = (configuredBaseUrl || `http://127.0.0.1:${portDefault}`).replace(/\/+$/, '')

  const url = parseUrl(baseUrl)
  const host = url?.hostname ?? '127.0.0.1'
  const port = url?.port ? Number(url.port) : portDefault

  return {
    baseUrl,
    host,
    port,
    /** True when the API address is on this machine, so this plugin may start it. */
    isLocal: LOCAL_HOSTS.has(host.toLowerCase()),
    installDir: text(source.installDir),
    pythonPath: text(source.pythonPath),
    extraLaunchArgs: textList(source.extraLaunchArgs),
    searchDirs: textList(source.searchDirs),
    autoStart: source.autoStart !== false,
    persistDiscovery: source.persistDiscovery !== false,
    startTimeoutSeconds: integer(source.startTimeoutSeconds, 180, 15, 1800),
    generationTimeoutSeconds: integer(source.generationTimeoutSeconds, 900, 30, 7200),
    outputDir: text(source.outputDir),
    checkpoint: text(source.checkpoint),
    sampler: text(source.sampler) || 'dpmpp_2m',
    scheduler: text(source.scheduler) || 'karras',
    steps: integer(source.steps, 28, 1, 200),
    cfg: Math.min(30, Math.max(0, number(source.cfg, 5))),
    width: integer(source.width, 1024, 64, 4096),
    height: integer(source.height, 1024, 64, 4096),
    negativePrompt: text(source.negativePrompt) || DEFAULT_NEGATIVE_PROMPT,
    maxImages: integer(source.maxImages, 4, 1, 8),
    launchLogFile: text(source.launchLogFile)
  }
}
