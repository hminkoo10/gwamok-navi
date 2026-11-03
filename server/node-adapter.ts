import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'

// Node의 req/res와 웹 표준 Request/Response 사이 변환. Vite 개발 서버와 운영 서버가 함께 쓴다.

/**
 * 요청한 사람 IP. 앞에 nginx 같은 프록시를 둘 때만 TRUST_PROXY=1로 X-Forwarded-For를 믿는다.
 * nginx의 proxy_add_x_forwarded_for는 클라이언트가 보낸 값 뒤에 실제 IP를 덧붙이므로 맨 오른쪽 값을 쓴다.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for']
    const value = Array.isArray(xff) ? xff.join(',') : xff
    const last = value
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop()
    if (last) return last
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function toWebRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const item of v) headers.append(k, item)
    else headers.set(k, v)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(new URL(req.url ?? '/', origin), {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    // Node의 fetch 구현은 스트림 본문에 duplex 지정을 요구한다
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)
}

/**
 * HTTPS로 들어온 요청인지. 앞단 프록시를 믿을 때만 X-Forwarded-Proto를 본다.
 * COOKIE_SECURE=1이면 늘 HTTPS로 본다 (프록시가 그 헤더를 안 넘길 때).
 */
export function isSecure(req: IncomingMessage, trustProxy: boolean, env: Record<string, string | undefined> = process.env): boolean {
  if (env.COOKIE_SECURE === '1') return true
  if (trustProxy)
    return (
      String(req.headers['x-forwarded-proto'] ?? '')
        .split(',')[0]
        .trim() === 'https'
    )
  return 'encrypted' in req.socket && req.socket.encrypted === true
}

const gzipAsync = promisify(gzip)
const COMPRESSIBLE = /^(application\/(json|javascript)|text\/)/
/** 전형 자료처럼 큰 응답은 내용이 같으면 한 번만 압축한다 (판이 바뀌면 내용 해시도 바뀐다) */
const gzipCache = new Map<string, Buffer>()

async function gzipped(body: Buffer): Promise<Buffer> {
  if (body.byteLength < 64 * 1024) return gzipAsync(body)
  const key = createHash('sha1').update(body).digest('hex')
  const hit = gzipCache.get(key)
  if (hit) return hit
  const out = await gzipAsync(body)
  if (gzipCache.size >= 8) gzipCache.delete(gzipCache.keys().next().value!)
  gzipCache.set(key, out)
  return out
}

export async function sendWebResponse(res: ServerResponse, response: Response, extraHeaders: Record<string, string> = {}): Promise<void> {
  const headers: Record<string, string | string[]> = { ...extraHeaders }
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') headers[key] = value
  })
  // 쿠키는 여러 개일 수 있어 따로 넘긴다
  const cookies = response.headers.getSetCookie()
  if (cookies.length) headers['set-cookie'] = cookies
  let body: Buffer = Buffer.from(await response.arrayBuffer())
  // 브라우저가 gzip을 받으면 1KB 넘는 JSON·글은 압축해서 보낸다 (전형 자료 1.4MB → 약 1/10)
  const accept = String(res.req?.headers['accept-encoding'] ?? '')
  if (body.byteLength >= 1024 && !headers['content-encoding'] && COMPRESSIBLE.test(String(headers['content-type'] ?? '')) && /\bgzip\b/.test(accept)) {
    body = await gzipped(body)
    headers['content-encoding'] = 'gzip'
    headers.vary = 'accept-encoding'
  }
  headers['content-length'] = String(body.byteLength)
  res.writeHead(response.status, headers)
  res.end(body)
}
