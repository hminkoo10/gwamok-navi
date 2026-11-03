import http from 'node:http'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { isConnectFailure, markRelay, needsRelay, relayable, relayFetch, relayUrl, setRelayForTest, withRelay } from './relay'
import { safeFetch } from './safe-fetch'

// 해외 접속을 막는 한국 사이트를 한국 서버 중계로 받는 경로. 이 컴퓨터에 가짜 중계(CONNECT)와 가짜 학교 서버를 띄운다

/** 가짜 학교 서버: 받은 경로를 그대로 돌려준다 */
async function school(): Promise<{ port: number; close: () => void; hits: string[] }> {
  const hits: string[] = []
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.headers.host} ${req.url}`)
    if (req.url === '/moved') {
      res.writeHead(302, { location: '/final' })
      return res.end()
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', etag: '"v1"' })
    res.end(req.method === 'HEAD' ? undefined : `ok ${req.url}`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { port: (server.address() as net.AddressInfo).port, close: () => server.close(), hits }
}

/** 가짜 중계: CONNECT 요청의 호스트는 무시하고 가짜 학교 서버로 이어 준다. refuse에 든 호스트는 거절한다 */
async function relay(target: number, refuse: string[] = []): Promise<{ url: string; close: () => void; asked: string[] }> {
  const asked: string[] = []
  const server = http.createServer((_req, res) => res.writeHead(405).end())
  server.on('connect', (req, socket: net.Socket, head) => {
    asked.push(req.url ?? '')
    if (refuse.some((h) => (req.url ?? '').startsWith(h))) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    const up = net.connect(target, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) up.write(head)
      up.pipe(socket)
      socket.pipe(up)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, close: () => server.close(), asked }
}

afterEach(() => setRelayForTest(undefined))

describe('한국 서버 중계', () => {
  it('중계 주소는 이 컴퓨터(터널 입구)만, 중계로 보내는 곳은 .kr만', () => {
    setRelayForTest('http://127.0.0.1:18080')
    expect(relayUrl()?.port).toBe('18080')
    for (const bad of ['http://10.0.0.5:18080', 'https://127.0.0.1:18080', 'http://relay.example.com:18080', 'nonsense']) {
      setRelayForTest(bad)
      expect(relayUrl(), bad).toBeNull()
    }
    setRelayForTest(null)
    expect(relayUrl()).toBeNull()
    expect(relayable('i.chosun.ac.kr')).toBe(true)
    expect(relayable('i.chosun.ac.kr.')).toBe(true)
    for (const bad of ['example.com', 'kr.example.com', 'evil.kr.com', 'localhost']) expect(relayable(bad), bad).toBe(false)
  })

  it('연결 단계에서 막힌 오류만 중계로 다시 한다', () => {
    expect(isConnectFailure(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true)
    expect(isConnectFailure(new TypeError('fetch failed', { cause: Object.assign(new Error('t'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) }))).toBe(true)
    expect(isConnectFailure(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBe(false)
    expect(isConnectFailure(new Error('HTTP 500'))).toBe(false)
  })

  it('fetch 감싸기: 연결이 막히면 중계로 받고, 한동안은 바로 중계로 보낸다', async () => {
    const s = await school()
    const r = await relay(s.port)
    try {
      setRelayForTest(r.url)
      let direct = 0
      const blocked = (async () => {
        direct++
        throw new TypeError('fetch failed', { cause: Object.assign(new Error('timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) })
      }) as unknown as typeof fetch
      const f = withRelay(blocked)
      const res = await f('http://ipsi.chosun.ac.kr/plan.pdf')
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('ok /plan.pdf')
      expect(r.asked).toEqual(['ipsi.chosun.ac.kr:80'])
      expect(needsRelay('ipsi.chosun.ac.kr')).toBe(true)
      // 두 번째는 직접 해 보지 않고 바로 중계로. HEAD와 리다이렉트도 따라간다
      const head = await f('http://ipsi.chosun.ac.kr/plan.pdf', { method: 'HEAD' })
      expect(head.headers.get('etag')).toBe('"v1"')
      expect(await (await f('http://ipsi.chosun.ac.kr/moved')).text()).toBe('ok /final')
      expect(direct).toBe(1)
      // .kr이 아니거나 다른 오류면 중계로 보내지 않는다
      await expect(f('http://example.com/x')).rejects.toThrow('fetch failed')
      const failing = withRelay((async () => {
        throw new Error('HTTP 500')
      }) as unknown as typeof fetch)
      await expect(failing('http://other.ac.kr/x')).rejects.toThrow('HTTP 500')
    } finally {
      r.close()
      s.close()
    }
  })

  it('중계가 거절하면 그 오류를 그대로 알린다', async () => {
    const s = await school()
    const r = await relay(s.port, ['ipsi.chosun.ac.kr'])
    try {
      setRelayForTest(r.url)
      await expect(relayFetch('http://ipsi.chosun.ac.kr/x')).rejects.toThrow('중계가 거절했어요 (403)')
      await expect(relayFetch('http://example.com/x')).rejects.toThrow('한국 도메인만')
      await expect(relayFetch('http://ipsi.chosun.ac.kr/x', { method: 'POST' })).rejects.toThrow('GET·HEAD만')
    } finally {
      r.close()
      s.close()
    }
  })

  it('safeFetch도 중계가 필요한 곳은 중계로 받는다', async () => {
    const s = await school()
    const r = await relay(s.port)
    try {
      setRelayForTest(r.url)
      markRelay('www.chosun.ac.kr')
      const res = await safeFetch('http://www.chosun.ac.kr/notice?id=1', { allow: () => true, maxBytes: 10_000, timeoutMs: 5_000 })
      expect(res.status).toBe(200)
      expect(res.body.toString()).toBe('ok /notice?id=1')
      expect(s.hits).toEqual(['GET www.chosun.ac.kr /notice?id=1'])
    } finally {
      r.close()
      s.close()
    }
  })
})
