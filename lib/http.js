/**
 * Minimal HTTP client for the local ComfyUI server.
 *
 * Only the endpoints this bundle needs are covered: server probe, queue,
 * per-node model introspection, prompt submission, history polling and the
 * `/view` image download. Every request is bounded by its own timeout and by
 * the tool call's abort signal, and connection failures surface as a small,
 * model-readable result instead of a stack trace.
 */

/** Error carrying the HTTP status and a bounded body excerpt. */
export class ComfyHttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message)
    this.name = 'ComfyHttpError'
    this.status = status
    this.body = body
  }
}

function combineSignals(signal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error(`request timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

function excerpt(value, max = 900) {
  const flat = String(value ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function describeFetchFailure(error, url) {
  const cause = error?.cause
  const detail = cause?.code || cause?.message || error?.message || String(error)
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return `请求 ComfyUI 超时或已取消（${url}）：${excerpt(detail, 200)}`
  }
  return `无法连接 ComfyUI（${url}）：${excerpt(detail, 200)}`
}

/** Whether an error means "server not reachable" rather than "server said no". */
export function isConnectionFailure(error) {
  if (!error) return false
  if (error instanceof ComfyHttpError) return false
  const code = error?.cause?.code
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)) return true
  if (error.name === 'TypeError' && /fetch failed/i.test(error.message ?? '')) return true
  if (error.name === 'AbortError') return true
  return /fetch failed|ECONNREFUSED|无法连接/i.test(String(error.message ?? ''))
}

/** Fetch raw bytes; `body` is JSON-encoded when provided. */
export async function requestRaw(baseUrl, pathname, options = {}) {
  const { method = 'GET', body, timeoutMs = 20000, signal } = options
  const url = `${baseUrl}${pathname}`
  const { signal: composed, dispose } = combineSignals(signal, timeoutMs)
  try {
    let response
    try {
      response = await fetch(url, {
        method,
        signal: composed,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch (error) {
      throw new Error(describeFetchFailure(error, url), { cause: error })
    }
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (!response.ok) {
      const textBody = new TextDecoder().decode(buffer.slice(0, 4000))
      throw new ComfyHttpError(`ComfyUI ${method} ${pathname} 返回 HTTP ${response.status}：${excerpt(textBody)}`, {
        status: response.status,
        body: textBody
      })
    }
    return { buffer, contentType: response.headers.get('content-type') ?? '' }
  } finally {
    dispose()
  }
}

/** Fetch and parse JSON. */
export async function requestJson(baseUrl, pathname, options = {}) {
  const { buffer } = await requestRaw(baseUrl, pathname, options)
  const text = new TextDecoder().decode(buffer)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`ComfyUI ${pathname} 返回的不是 JSON：${excerpt(text, 300)}`)
  }
}

/**
 * Probe the server without throwing.
 * @returns {Promise<{available: boolean, stats?: any, error?: string}>}
 */
export async function probeServer(baseUrl, { signal, timeoutMs = 2500 } = {}) {
  try {
    const stats = await requestJson(baseUrl, '/system_stats', { signal, timeoutMs })
    return { available: true, stats }
  } catch (error) {
    return { available: false, error: excerpt(error.message, 300) }
  }
}

export async function getQueue(baseUrl, options = {}) {
  return requestJson(baseUrl, '/queue', { timeoutMs: 8000, ...options })
}

export async function getNodeInfo(baseUrl, classType, options = {}) {
  const payload = await requestJson(baseUrl, `/object_info/${encodeURIComponent(classType)}`, {
    timeoutMs: 15000,
    ...options
  })
  const node = payload?.[classType]
  return node?.input?.required && typeof node.input.required === 'object' ? node.input.required : {}
}

export async function submitPrompt(baseUrl, graph, clientId, options = {}) {
  return requestJson(baseUrl, '/prompt', {
    method: 'POST',
    body: { prompt: graph, client_id: clientId },
    timeoutMs: 30000,
    ...options
  })
}

export async function getHistory(baseUrl, promptId, options = {}) {
  return requestJson(baseUrl, `/history/${encodeURIComponent(promptId)}`, { timeoutMs: 15000, ...options })
}

/** Download one produced image from `/view`. */
export async function downloadImage(baseUrl, image, options = {}) {
  const query = new URLSearchParams({
    filename: String(image.filename),
    subfolder: String(image.subfolder ?? ''),
    type: String(image.type ?? 'output')
  })
  const { buffer } = await requestRaw(baseUrl, `/view?${query.toString()}`, { timeoutMs: 60000, ...options })
  return buffer
}

/** Best-effort cancellation: drop the queued prompt and interrupt a running one. */
export async function cancelPrompt(baseUrl, promptId) {
  const attempts = [
    () => requestJson(baseUrl, '/queue', { method: 'POST', body: { delete: [promptId] }, timeoutMs: 5000 }),
    () => requestJson(baseUrl, '/interrupt', { method: 'POST', body: {}, timeoutMs: 5000 })
  ]
  for (const attempt of attempts) {
    try {
      await attempt()
    } catch {
      /* cancellation is best effort; the caller already has a result */
    }
  }
}
