import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { createApi } from './handler'
import { clientIp, isSecure, sendWebResponse, toWebRequest } from './node-adapter'

// 운영 서버: 빌드된 정적 파일(dist)과 /api를 함께 띄운다.
// 기본은 127.0.0.1에만 열고, 외부 공개는 앞단 nginx 등에서 HTTPS로 받는다.

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.env.STATIC_DIR ?? join(here, '../dist'))
const PORT = Number(process.env.PORT ?? 8080)
const HOST = process.env.HOST ?? '127.0.0.1'
const TRUST_PROXY = process.env.TRUST_PROXY === '1'

const api = createApi()
// 운영 서버는 원문 감시를 기본 6시간마다 돈다 (WATCH_INTERVAL_HOURS=0이면 끔)
const ENV = { WATCH_INTERVAL_HOURS: '6', ...process.env }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt'])

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
}

function safePath(pathname: string): string | null {
  let p: string
  try {
    p = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (p.includes('\0')) return null
  const full = resolve(root, `.${p}`)
  return full === root || full.startsWith(root + sep) ? full : null
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET, HEAD' })
    res.end()
    return
  }
  let file = safePath(pathname === '/' ? '/index.html' : pathname)
  let info = file ? await stat(file).catch(() => null) : null
  if (!info?.isFile()) {
    // 앱 내부 주소는 index.html로, 없는 파일(확장자가 있는 주소)은 404
    if (extname(pathname)) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }
    file = join(root, 'index.html')
    info = await stat(file).catch(() => null)
    if (!info) {
      res.writeHead(500, SECURITY_HEADERS)
      res.end('Build output missing')
      return
    }
  }
  const ext = extname(file!)
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  }
  const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
  if (gzip) {
    headers['content-encoding'] = 'gzip'
    headers.vary = 'accept-encoding'
  } else {
    headers['content-length'] = String(info!.size)
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(file!)
  stream.on('error', () => res.destroy())
  if (gzip) stream.pipe(createGzip()).pipe(res)
  else stream.pipe(res)
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host ?? `localhost:${PORT}`
  const url = new URL(req.url ?? '/', `http://${host}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      const response = await api(toWebRequest(req, `http://${host}`), { ip: clientIp(req, TRUST_PROXY), env: ENV, secure: isSecure(req, TRUST_PROXY) })
      await sendWebResponse(res, response, SECURITY_HEADERS)
      return
    }
    await serveStatic(req, res, url.pathname)
  } catch {
    if (!res.headersSent) res.writeHead(500, SECURITY_HEADERS)
    res.end()
  }
})

server.requestTimeout = 210_000
server.headersTimeout = 20_000
server.listen(PORT, HOST, () => {
  console.log(`gwamok-navi listening on http://${HOST}:${PORT} (static: ${root})`)
})
