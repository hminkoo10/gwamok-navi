import { lookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net, { isIP } from 'node:net'
import type { Duplex } from 'node:stream'
import tls from 'node:tls'
import { isConnectFailure, markRelay, needsRelay, relayable, relayUrl, tunnel } from './relay'

// 학교 홈페이지에서 편제표 파일을 받아 올 때 쓰는 fetch.
// 서버가 사용자가 고른 주소로 요청을 보내므로(SSRF 위험) 다음을 지킨다.
// - http/https, 기본 포트만
// - 연결할 IP를 직접 검사: 사설·루프백·링크로컬·멀티캐스트 등 내부 주소 차단 (DNS 조회 함수 안에서 검사해 조회-연결 사이 바뀜도 막는다)
// - 리다이렉트는 직접 따라가며 매번 같은 검사와 호출자의 주소 검사(allow)를 다시 한다
// - 크기·시간 상한
// - 해외 접속을 막는 한국 사이트는 한국 서버 중계(KR_RELAY)로 다시 받는다 (중계도 .kr 공개 주소만 이어 준다)

export class FetchBlocked extends Error {}

const V4_BLOCKS: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 CGNAT
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16
  [0xac100000, 12], // 172.16/12
  [0xc0000000, 24], // 192.0.0/24
  [0xc0000200, 24], // 192.0.2/24
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15
  [0xc6336400, 24], // 198.51.100/24
  [0xcb007100, 24], // 203.0.113/24
  [0xe0000000, 4], // 224/4 multicast
  [0xf0000000, 4], // 240/4 reserved
]

const v4Public = (n: number) => !V4_BLOCKS.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits))

/** IPv6 주소를 16비트 8칸으로 편다. ::ffff:1.2.3.4 같은 IPv4 꼬리도 처리한다. */
function v6Words(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, '')
  const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number)
    s = `${s.slice(0, -tail[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null
  const words = rest ? [...head, ...Array<string>(8 - head.length - rest.length).fill('0'), ...rest] : head
  if (words.length !== 8 || words.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return null
  return words.map((w) => parseInt(w, 16))
}

export function isPublicIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return v4Public(ip.split('.').reduce((a, p) => (a << 8) + Number(p), 0) >>> 0)
  if (v !== 6) return false
  const w = v6Words(ip)
  if (!w) return false
  const v4 = (hi: number, lo: number) => ((hi << 16) | lo) >>> 0
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return v4Public(v4(w[6], w[7])) // IPv4 매핑·호환 (::1, :: 포함)
  if (w.slice(0, 4).every((x) => x === 0) && w[4] === 0xffff && w[5] === 0) return v4Public(v4(w[6], w[7])) // IPv4 변환
  if (w[0] === 0x64 && w[1] === 0xff9b) return false // NAT64
  if (w[0] === 0x2002) return v4Public(v4(w[1], w[2])) // 6to4
  if (w[0] === 0x2001 && w[1] === 0) return false // Teredo
  if (w[0] === 0x2001 && w[1] === 0xdb8) return false // 문서용
  if (w[0] === 0x100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return false // 버림용
  if ((w[0] & 0xfe00) === 0xfc00) return false // fc00::/7 내부망
  if ((w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xffc0) === 0xfec0) return false // 링크·사이트 로컬
  if ((w[0] & 0xff00) === 0xff00) return false // 멀티캐스트
  return true
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void

function safeLookup(hostname: string, options: object, callback: LookupCallback) {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4)
    const list = addresses as { address: string; family: number }[]
    const bad = list.find((a) => !isPublicIp(a.address))
    if (bad || !list.length) return callback(new FetchBlocked(`내부 주소로는 연결할 수 없어요: ${hostname}`) as NodeJS.ErrnoException, '', 4)
    if ((options as { all?: boolean }).all) callback(null, list)
    else callback(null, list[0].address, list[0].family)
  })
}

/** 한 번 둘러보는 동안만 쓰는 쿠키 저장소. 세션 쿠키가 없으면 첫 화면으로 계속 돌려보내는 학교 홈페이지가 있다. */
export class CookieJar {
  private jar = new Map<string, Map<string, string>>()

  // 여러 학교·기관이 함께 쓰는 kr의 2단계 끝 주소. 쿠키 Domain으로 쓰면 다른 학교에 쿠키가 샌다.
  private static readonly KR_SECOND = new Set([
    'co',
    'go',
    'ac',
    'hs',
    'ms',
    'es',
    'sc',
    'or',
    'ne',
    're',
    'pe',
    'kg',
    'mil',
    'seoul',
    'busan',
    'daegu',
    'incheon',
    'gwangju',
    'daejeon',
    'ulsan',
    'sejong',
    'gyeonggi',
    'gangwon',
    'chungbuk',
    'chungnam',
    'jeonbuk',
    'jeonnam',
    'gyeongbuk',
    'gyeongnam',
    'jeju',
  ])

  /** 쿠키 Domain으로 쓰면 안 되는 공용 끝 주소인지 (단일 TLD(kr·com 등)나 co.kr·hs.kr·seoul.kr 같은 kr 2단계) */
  private static publicSuffix(domain: string): boolean {
    const labels = domain.split('.')
    if (labels.length < 2) return true
    return labels.length === 2 && labels[1] === 'kr' && CookieJar.KR_SECOND.has(labels[0])
  }

  store(url: URL, setCookie: string[] | undefined): void {
    const clean = (s: string) => s.replace(/[\r\n\0]/g, '')
    for (const line of setCookie ?? []) {
      const [pair, ...attrs] = line.split(';')
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = clean(pair.slice(0, eq).trim())
      const value = clean(pair.slice(eq + 1).trim())
      if (!name) continue
      const host = url.hostname.toLowerCase()
      const domainAttr = attrs
        .map((a) =>
          a
            .trim()
            .match(/^domain=\.?(.+)$/i)?.[1]
            ?.toLowerCase(),
        )
        .find(Boolean)
      // 공용 끝 주소(hs.kr·.kr 등)에 건 쿠키는 다른 학교로 새므로 버린다
      if (domainAttr && CookieJar.publicSuffix(domainAttr)) continue
      // 다른 사이트용 쿠키는 브라우저처럼 버린다
      if (domainAttr && host !== domainAttr && !host.endsWith(`.${domainAttr}`)) continue
      const domain = domainAttr ?? host
      if (!this.jar.has(domain)) this.jar.set(domain, new Map())
      this.jar.get(domain)!.set(name, value)
      if (this.size() > 200) this.jar.clear()
    }
  }

  header(url: URL): string {
    const host = url.hostname.toLowerCase()
    const out: string[] = []
    for (const [domain, cookies] of this.jar) if (host === domain || host.endsWith(`.${domain}`)) for (const [k, v] of cookies) out.push(`${k}=${v}`)
    return out.join('; ')
  }

  private size(): number {
    let n = 0
    for (const m of this.jar.values()) n += m.size
    return n
  }
}

export interface SafeFetchOptions {
  /** 이 주소로 가도 되는지 (리다이렉트마다 다시 확인) */
  allow: (url: URL) => boolean
  maxBytes: number
  /** 전체 시간 상한 (조금씩 흘려 보내는 서버도 끊는다) */
  timeoutMs: number
  maxRedirects?: number
  accept?: string
  jar?: CookieJar
  /** 폼으로 보내는 POST (일부 학교 게시판은 목록·글을 POST로만 준다) */
  form?: Record<string, string>
  /** 이미 인코딩한 폼 본문 (EUC-KR 사이트처럼 UTF-8이 아닌 폼) */
  rawForm?: string
  referer?: string
}

export interface SafeResponse {
  url: string
  status: number
  contentType: string
  body: Buffer
}

/** 직접 연결이 이 시간 안에 이어지지 않으면 막힌 것으로 본다 (해외 접속 차단은 연결 단계에서 멈춘다) */
const CONNECT_MS = 10_000

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 GwamokNavi/1.0'

type RawResult = { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

/** 청크 전송 본문을 푼다. 형식이 깨졌으면 null */
export function dechunk(buf: Buffer): Buffer | null {
  const out: Buffer[] = []
  let p = 0
  for (;;) {
    const eol = buf.indexOf('\r\n', p)
    if (eol < 0) return null
    const size = parseInt(buf.subarray(p, eol).toString('latin1').split(';')[0].trim(), 16)
    if (!Number.isFinite(size) || size < 0) return null
    if (size === 0) return Buffer.concat(out)
    const start = eol + 2
    if (start + size > buf.length) return null
    out.push(buf.subarray(start, start + size))
    p = start + size + 2
  }
}

/** 헤더 형식이 조금 틀린 응답(예: "P3P : CP=...")을 너그럽게 읽는다 */
export function parseRawResponse(raw: Buffer): RawResult | null {
  const end = raw.indexOf('\r\n\r\n')
  const sep = end >= 0 ? end + 4 : raw.indexOf('\n\n') >= 0 ? raw.indexOf('\n\n') + 2 : -1
  if (sep < 0) return null
  const lines = raw.subarray(0, sep).toString('latin1').split(/\r?\n/)
  const status = Number(lines[0].match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/)?.[1])
  if (!status) return null
  const headers: http.IncomingHttpHeaders = {}
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    // 헤더 값에 남은 홑 CR·LF·NUL은 떼어 낸다 (raw 경로로 다시 내보낼 때 헤더가 쪼개지지 않게)
    const name = line
      .slice(0, i)
      .trim()
      .toLowerCase()
      .replace(/[\r\n\0]/g, '')
    const value = Buffer.from(line.slice(i + 1).trim(), 'latin1')
      .toString('utf8')
      .replace(/[\r\n\0]/g, '')
    if (!/^[a-z0-9-]+$/.test(name)) continue
    if (name === 'set-cookie') (headers['set-cookie'] ??= []).push(value)
    else headers[name] = value
  }
  let body = raw.subarray(sep)
  if (/chunked/i.test(String(headers['transfer-encoding'] ?? ''))) body = dechunk(body) ?? body
  else if (headers['content-length'] && /^\d+$/.test(String(headers['content-length']))) body = body.subarray(0, Number(headers['content-length']))
  return { status, headers, body: Buffer.from(body) }
}

/** Node의 엄격한 HTTP 파서가 거절한 서버에만 쓰는 예비 요청 (같은 주소 검사·크기·시간 상한) */
function rawOnce(
  url: URL,
  opts: SafeFetchOptions,
  headers: Record<string, string>,
  body: string | undefined,
  deadline: number,
  relay: URL | null,
): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now()
    if (left <= 0) return reject(new FetchBlocked('응답이 너무 늦어요.'))
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
    if (relay) {
      // 중계로 이은 소켓은 이미 연결(TLS까지)돼 있다
      tunnel(relay, url.hostname, port, url.protocol === 'https:', Math.min(15_000, left)).then((socket) => readRaw(socket, true), reject)
      return
    }
    readRaw(
      url.protocol === 'https:'
        ? tls.connect({ host: url.hostname, port, servername: url.hostname, lookup: safeLookup as never })
        : net.connect({ host: url.hostname, port, lookup: safeLookup as never }),
      false,
    )

    function readRaw(socket: net.Socket, ready: boolean) {
      const chunks: Buffer[] = []
      let size = 0
      const timer = setTimeout(() => socket.destroy(new FetchBlocked('응답이 너무 늦어요.')), left)
      const lines = [
        `${body === undefined ? 'GET' : 'POST'} ${url.pathname}${url.search} HTTP/1.1`,
        `host: ${url.host}`,
        'connection: close',
        'accept-encoding: identity',
      ]
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`)
      // 보내고 나서 끊지 않는다 (connection: close라 서버가 응답 뒤 닫는다. TLS에서 먼저 닫으면 응답 없이 끊는 서버가 있다)
      const send = () => socket.write(`${lines.join('\r\n')}\r\n\r\n${body ?? ''}`)
      if (ready) send()
      else socket.on(url.protocol === 'https:' ? 'secureConnect' : 'connect', send)
      socket.on('data', (c: Buffer) => {
        size += c.length
        if (size > opts.maxBytes + 64_000) {
          socket.destroy(new FetchBlocked('파일이 너무 커요.'))
          return
        }
        chunks.push(c)
      })
      socket.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      socket.on('close', () => {
        clearTimeout(timer)
        const parsed = parseRawResponse(Buffer.concat(chunks))
        if (!parsed) return reject(new FetchBlocked('학교 서버 응답을 읽지 못했어요.'))
        if (parsed.body.length > opts.maxBytes) return reject(new FetchBlocked('파일이 너무 커요.'))
        opts.jar?.store(url, parsed.headers['set-cookie'])
        resolve(parsed)
      })
    }
  })
}

function once(url: URL, opts: SafeFetchOptions, body: string | undefined, deadline: number, relay: URL | null = null): Promise<RawResult> {
  return new Promise((done, failed) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const resolve = (v: RawResult) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        done(v)
      }
    }
    const reject = (e: unknown) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        failed(e)
      }
    }
    const lib = url.protocol === 'https:' ? https : http
    const headers: Record<string, string> = {
      // 중계로 이은 소켓을 쓸 때도 기본 포트를 붙이지 않은 Host를 보낸다 (가상 호스트를 가르는 서버가 있다)
      host: url.host,
      'user-agent': UA,
      accept: opts.accept ?? '*/*',
      'accept-language': 'ko-KR,ko;q=0.9',
    }
    const cookie = opts.jar?.header(url)
    if (cookie) headers.cookie = cookie
    if (opts.referer) headers.referer = opts.referer
    if (body !== undefined) {
      headers['content-type'] = opts.rawForm !== undefined ? 'application/x-www-form-urlencoded' : 'application/x-www-form-urlencoded; charset=UTF-8'
      headers['content-length'] = String(Buffer.byteLength(body))
      headers['x-requested-with'] = 'XMLHttpRequest'
    }
    const left = deadline - Date.now()
    if (left <= 0) return reject(new FetchBlocked('응답이 너무 늦어요.'))

    // 응답 형식이 HTTP 규칙에서 벗어나 Node 파서가 거절하면(예: 헤더 이름 뒤 공백) 한 번만 너그러운 방식으로 다시 받는다
    const fail = (e: Error & { code?: string }) => {
      if (settled) return
      if (typeof e.code === 'string' && e.code.startsWith('HPE_')) {
        settled = true
        clearTimeout(timer)
        rawOnce(url, opts, headers, body, deadline, relay).then(done, failed)
      } else reject(e)
    }

    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
    const req = lib.request(
      url,
      {
        method: body === undefined ? 'GET' : 'POST',
        // 중계로 갈 때는 중계가 주소를 찾고(공개 주소만) 이어 준 소켓을 쓴다
        ...(relay
          ? {
              createConnection: (_o: unknown, cb: (err: Error | null, socket: Duplex) => void) => {
                tunnel(relay, url.hostname, port, url.protocol === 'https:', Math.min(15_000, Math.max(1, deadline - Date.now()))).then(
                  (socket) => cb(null, socket),
                  (err: Error) => cb(err, undefined as never),
                )
              },
            }
          : { lookup: safeLookup as never }),
        headers,
        timeout: left,
        // 엄격한 파서로 받는다. 오래된 학교 서버가 헤더 형식이 틀려 거절당하면(HPE_*) fail에서 rawOnce로 한 번만 느슨하게 다시 받는다.
        // (요청 스머글링을 막으려고 느슨한 파싱은 그 예비 경로에만 둔다)
        insecureHTTPParser: false,
      },
      (res) => {
        // 리다이렉트는 본문을 읽지 않는다 (본문 형식이 깨진 오래된 서버가 있다)
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400 && res.headers.location) {
          opts.jar?.store(url, res.headers['set-cookie'])
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.alloc(0) })
          res.on('error', () => {})
          res.destroy()
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        if (Number(res.headers['content-length'] ?? '0') > opts.maxBytes) {
          reject(new FetchBlocked('파일이 너무 커요.'))
          res.destroy()
          return
        }
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > opts.maxBytes) {
            reject(new FetchBlocked('파일이 너무 커요.'))
            res.destroy()
            return
          }
          chunks.push(c)
        })
        res.on('end', () => {
          opts.jar?.store(url, res.headers['set-cookie'])
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
        })
        res.on('error', fail)
      },
    )
    timer = setTimeout(() => req.destroy(new FetchBlocked('응답이 너무 늦어요.')), left)
    req.on('timeout', () => req.destroy(new FetchBlocked('응답이 너무 늦어요.')))
    // 직접 연결이 오래 이어지지 않으면 막힌 것으로 보고 끊는다 (해외 접속 차단이면 중계로 다시 한다)
    if (!relay)
      req.on('socket', (sock: net.Socket) => {
        if (!sock.connecting) return
        const t = setTimeout(
          () => {
            if (sock.connecting) req.destroy(Object.assign(new Error('연결 시간 초과'), { code: 'ECONNTIMEOUT' }))
          },
          Math.min(CONNECT_MS, left),
        )
        sock.once('connect', () => clearTimeout(t))
        sock.once('close', () => clearTimeout(t))
      })
    req.on('error', fail)
    req.end(body)
  })
}

export async function safeFetch(input: string, opts: SafeFetchOptions): Promise<SafeResponse> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new FetchBlocked('주소 형식이 맞지 않아요.')
  }
  const deadline = Date.now() + opts.timeoutMs
  let body = opts.rawForm ?? (opts.form ? new URLSearchParams(opts.form).toString() : undefined)
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchBlocked('http, https 주소만 쓸 수 있어요.')
    if (url.username || url.password) throw new FetchBlocked('주소에 계정 정보가 들어 있어요.')
    if (url.port && url.port !== '80' && url.port !== '443') throw new FetchBlocked('기본 포트만 쓸 수 있어요.')
    if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new FetchBlocked('IP 주소로는 받을 수 없어요.')
    if (!opts.allow(url)) throw new FetchBlocked('학교 공식 주소가 아니에요.')
    const relay = relayUrl()
    const canRelay = !!relay && relayable(url.hostname)
    let res: RawResult
    if (canRelay && needsRelay(url.hostname)) res = await once(url, opts, body, deadline, relay)
    else
      try {
        res = await once(url, opts, body, deadline)
      } catch (e) {
        // 해외 접속을 막는 한국 사이트: 한국 서버 중계로 다시 받고, 한동안 바로 중계로 보낸다
        if (!canRelay || !isConnectFailure(e)) throw e
        markRelay(url.hostname)
        res = await once(url, opts, body, deadline, relay)
      }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url)
      if (res.status !== 307 && res.status !== 308) body = undefined
      continue
    }
    return { url: url.toString(), status: res.status, contentType: String(res.headers['content-type'] ?? ''), body: res.body }
  }
  throw new FetchBlocked('리다이렉트가 너무 많아요.')
}

const SHARED_SUFFIXES = new Set(['hs.kr', 'ms.kr', 'es.kr', 'go.kr', 'or.kr', 'co.kr', 'ac.kr', 'ne.kr', 're.kr', 'sc.kr', 'kg.kr', 'pe.kr'])

/** 학교 홈페이지 주소로부터, 같은 학교(또는 같은 교육청 학교 홈페이지 시스템)의 파일 주소인지 판단하는 함수를 만든다 */
export function sameSchoolSite(homepage: string): (url: URL) => boolean {
  let host: string
  try {
    host = new URL(homepage).hostname.toLowerCase()
  } catch {
    return () => false
  }
  const labels = host.split('.')
  const lastTwo = labels.slice(-2).join('.')
  const base = SHARED_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
  return (url: URL) => {
    const h = url.hostname.toLowerCase()
    return h === host || h === base || h.endsWith(`.${base}`)
  }
}
