import http, { type IncomingHttpHeaders } from 'node:http'
import https from 'node:https'
import type net from 'node:net'
import { Readable } from 'node:stream'
import tls from 'node:tls'

// 해외(이 서버는 일본 리전) 접속을 막는 한국 사이트를 한국 서버를 거쳐 받는다.
// KR_RELAY=http://127.0.0.1:18080 : SSH 터널 너머 한국 서버의 CONNECT 중계 (그 중계는 .kr 공개 주소만 이어 준다).
// 직접 연결이 '연결 단계'에서 막힐 때만 중계로 다시 하고, 그런 사이트는 6시간 동안 바로 중계로 보낸다.

const RELAY_HOURS = 6
/** 중계가 필요했던 사이트 → 다시 직접 해 볼 시각 */
const viaRelay = new Map<string, number>()

let relayOverride: string | null | undefined

/** 시험용: 중계 주소를 바꾼다 (undefined면 환경변수) */
export function setRelayForTest(url: string | null | undefined): void {
  relayOverride = url
  viaRelay.clear()
}

/** 중계 주소 (없으면 null) */
export function relayUrl(): URL | null {
  const raw = relayOverride === undefined ? process.env.KR_RELAY : relayOverride
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]') ? u : null
  } catch {
    return null
  }
}

/** 중계로 보낼 수 있는 주소: 한국 도메인(.kr)만 (중계도 같은 규칙으로 막는다) */
export const relayable = (host: string) => /\.kr$/i.test(host.replace(/\.$/, ''))

/** 이 사이트는 지금 중계로 보내야 하는지 */
export function needsRelay(host: string): boolean {
  const until = viaRelay.get(host.toLowerCase())
  if (!until) return false
  if (until < Date.now()) {
    viaRelay.delete(host.toLowerCase())
    return false
  }
  return true
}

export function markRelay(host: string): void {
  viaRelay.set(host.toLowerCase(), Date.now() + RELAY_HOURS * 3600_000)
}

/** 연결 단계에서 막힌 오류인지 (해외 접속 차단은 보통 연결 시간 초과·끊김·거절로 나타난다) */
export function isConnectFailure(e: unknown): boolean {
  const codes = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ECONNTIMEOUT', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'])
  const code = (x: unknown) => (x && typeof x === 'object' && 'code' in x ? String((x as { code: unknown }).code) : '')
  const cause = e && typeof e === 'object' && 'cause' in e ? (e as { cause: unknown }).cause : undefined
  return codes.has(code(e)) || codes.has(code(cause))
}

/** 중계를 거쳐 host:port로 이어진 소켓 (https면 그 위에 TLS를 연다) */
export function tunnel(relay: URL, host: string, port: number, secure: boolean, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: relay.hostname,
      port: Number(relay.port) || 80,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { host: `${host}:${port}` },
      timeout: timeoutMs,
    })
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('중계 연결 시간 초과'), { code: 'ECONNTIMEOUT' })), timeoutMs)
    req.on('connect', (res, socket) => {
      clearTimeout(timer)
      if (res.statusCode !== 200) {
        socket.destroy()
        return reject(Object.assign(new Error(`중계가 거절했어요 (${res.statusCode})`), { code: 'ERELAY' }))
      }
      if (!secure) return resolve(socket)
      const t = tls.connect({ socket, servername: host, ALPNProtocols: ['http/1.1'] })
      const tlsTimer = setTimeout(() => t.destroy(Object.assign(new Error('TLS 시간 초과'), { code: 'ECONNTIMEOUT' })), timeoutMs)
      t.once('secureConnect', () => {
        clearTimeout(tlsTimer)
        resolve(t)
      })
      t.once('error', (err) => {
        clearTimeout(tlsTimer)
        reject(err)
      })
    })
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    req.end()
  })
}

/**
 * fetch와 같은 모양으로 중계를 거쳐 받는다 (원문 감시용: GET·HEAD, 리다이렉트 따라가기, 시간 상한).
 * 본문은 흘려 받으므로 큰 파일도 앞부분만 읽을 수 있다
 */
export async function relayFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const relay = relayUrl()
  if (!relay) throw Object.assign(new Error('중계가 없어요'), { code: 'ERELAY' })
  let url = new URL(String(input))
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') throw new Error('중계는 GET·HEAD만 해요')
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((v, k) => (headers[k] = v))
  for (let hop = 0; hop <= 5; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('http, https 주소만 받아요')
    if (!relayable(url.hostname)) throw Object.assign(new Error('한국 도메인만 중계해요'), { code: 'ERELAY' })
    const secure = url.protocol === 'https:'
    const port = Number(url.port) || (secure ? 443 : 80)
    const socket = await tunnel(relay, url.hostname, port, secure, 15_000)
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = (secure ? https : http).request(
        {
          host: url.hostname,
          port,
          method,
          path: `${url.pathname}${url.search}`,
          headers: { host: url.host, 'user-agent': 'Mozilla/5.0 GwamokNavi/1.0', ...headers },
          createConnection: () => socket,
          signal: init.signal ?? undefined,
        },
        resolve,
      )
      req.on('error', reject)
      req.end()
    })
    const status = res.statusCode ?? 0
    const location = res.headers.location
    if (status >= 300 && status < 400 && location && init.redirect !== 'manual') {
      res.resume()
      socket.destroy()
      url = new URL(location, url)
      continue
    }
    const out = new Headers()
    for (const [k, v] of Object.entries(res.headers as IncomingHttpHeaders)) {
      if (Array.isArray(v)) for (const x of v) out.append(k, x)
      else if (v !== undefined) out.set(k, String(v))
    }
    const empty = method === 'HEAD' || status === 204 || status === 304
    if (empty) {
      res.resume()
      socket.destroy()
    } else res.once('end', () => socket.destroy())
    return new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), { status, headers: out })
  }
  throw new Error('리다이렉트가 너무 많아요')
}

/**
 * fetch를 감싸 해외 접속을 막는 한국 사이트는 중계로 받게 한다.
 * 직접 연결이 연결 단계에서 막히면 그 사이트를 기억하고 중계로 다시 한다 (중계가 없으면 원래 오류)
 */
export function withRelay(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    let host = ''
    try {
      host = new URL(href).hostname
    } catch {
      return fetchImpl(input, init)
    }
    const canRelay = !!relayUrl() && relayable(host)
    if (canRelay && needsRelay(host)) return relayFetch(href, init)
    try {
      return await fetchImpl(input, init)
    } catch (e) {
      if (!canRelay || !isConnectFailure(e)) throw e
      markRelay(host)
      return relayFetch(href, init)
    }
  }) as typeof fetch
}
