import { lookup } from 'node:dns'
import http, { type IncomingHttpHeaders } from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { isPublicIp } from './safe-fetch'

// 원문 감시처럼 fetch 모양이 필요한 곳에서 쓰는, 공개 주소로만 잇는 fetch.
// 관리자가 더한 원문 주소라도 서버 안쪽(내부망·클라우드 메타데이터)으로는 가지 못하게 한다:
// - https만, 기본 포트만, 주소에 IP·계정 정보가 없을 때만
// - 이름이 가리키는 주소를 연결할 때 다시 확인한다 (확인한 뒤 DNS를 바꿔 끼워도 소용없게)
// - 리다이렉트는 직접 따라가며 한 번씩 다시 확인한다

const UA = 'Mozilla/5.0 (compatible; GwamokNavi/1.0; +https://navi.milky.kr)'
/** 연결 단계 시간 상한 */
const CONNECT_MS = 10_000

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void

export interface PublicFetchOptions {
  /** 이어도 되는 주소인지 (시험에서만 바꾼다) */
  allowAddress?: (ip: string) => boolean
  /** 쓸 수 있는 프로토콜·포트 (시험에서만 바꾼다) */
  allowUrl?: (url: URL) => boolean
}

const defaultUrl = (u: URL) => u.protocol === 'https:' && (u.port === '' || u.port === '443')

/** 공개 주소로만 잇는 fetch를 만든다 (GET·HEAD만, 리다이렉트 5번까지) */
export function makePublicFetch(opts: PublicFetchOptions = {}): typeof fetch {
  const allowAddress = opts.allowAddress ?? isPublicIp
  const allowUrl = opts.allowUrl ?? defaultUrl
  const publicLookup = (hostname: string, options: object, callback: LookupCallback) => {
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 4)
      const list = addresses as { address: string; family: number }[]
      if (!list.length || list.some((a) => !allowAddress(a.address)))
        return callback(Object.assign(new Error(`공개 주소가 아니에요: ${hostname}`), { code: 'EPRIVATE' }), '', 4)
      if ((options as { all?: boolean }).all) callback(null, list)
      else callback(null, list[0].address, list[0].family)
    })
  }

  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    let url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') throw new Error('GET·HEAD만 해요')
    const extra: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => (extra[k] = v))
    for (let hop = 0; hop <= 5; hop++) {
      if (!allowUrl(url)) throw Object.assign(new Error('https 기본 포트 주소만 받아요'), { code: 'EBADURL' })
      if (url.username || url.password) throw Object.assign(new Error('주소에 계정 정보가 들어 있어요'), { code: 'EBADURL' })
      if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw Object.assign(new Error('IP 주소로는 받지 않아요'), { code: 'EBADURL' })
      const target = url
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        const req = (target.protocol === 'https:' ? https : http).request(
          target,
          {
            method,
            headers: { host: target.host, 'user-agent': UA, ...extra },
            lookup: publicLookup as never,
            signal: init.signal ?? undefined,
          },
          resolve,
        )
        req.on('error', reject)
        // 연결이 오래 이어지지 않으면 막힌 것으로 보고 끊는다 (해외 접속 차단이면 한국 중계로 다시 하게 연결 단계 오류로)
        req.on('socket', (sock) => {
          if (!sock.connecting) return
          const t = setTimeout(() => {
            if (sock.connecting) req.destroy(Object.assign(new Error('연결 시간 초과'), { code: 'ECONNTIMEOUT' }))
          }, CONNECT_MS)
          sock.once('connect', () => clearTimeout(t))
          sock.once('close', () => clearTimeout(t))
        })
        req.end()
      })
      const status = res.statusCode ?? 0
      const location = res.headers.location
      if (status >= 300 && status < 400 && location && init.redirect !== 'manual') {
        res.resume()
        url = new URL(location, url)
        continue
      }
      const out = new Headers()
      for (const [k, v] of Object.entries(res.headers as IncomingHttpHeaders)) {
        if (Array.isArray(v)) for (const x of v) out.append(k, x)
        else if (v !== undefined) out.set(k, String(v))
      }
      const empty = method === 'HEAD' || status === 204 || status === 304
      if (empty) res.resume()
      return new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), { status, headers: out })
    }
    throw new Error('리다이렉트가 너무 많아요')
  }) as typeof fetch
}

/** 운영에서 쓰는 것: 공개 주소의 https 기본 포트만 */
export const publicFetch = makePublicFetch()
