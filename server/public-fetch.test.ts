import http from 'node:http'
import type net from 'node:net'
import { describe, expect, it } from 'vitest'
import { makePublicFetch, publicFetch } from './public-fetch'

// 원문 감시가 서버 안쪽 주소로 가지 못하게 하는 fetch

async function server(): Promise<{ port: number; close: () => void }> {
  const s = http.createServer((req, res) => {
    if (req.url === '/to-metadata') {
      res.writeHead(302, { location: 'https://169.254.169.254/latest' })
      return res.end()
    }
    if (req.url === '/moved') {
      res.writeHead(301, { location: '/final' })
      return res.end()
    }
    res.writeHead(200, { 'content-type': 'text/plain', etag: '"e1"' })
    res.end(req.method === 'HEAD' ? undefined : `ok ${req.url}`)
  })
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return { port: (s.address() as net.AddressInfo).port, close: () => s.close() }
}

describe('공개 주소로만 잇는 fetch', () => {
  it('https 기본 포트의 이름 주소만 받고, IP·계정 정보·다른 방법은 막는다', async () => {
    for (const bad of ['http://example.ac.kr/x', 'https://example.ac.kr:8443/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://u:p@example.ac.kr/x'])
      await expect(publicFetch(bad), bad).rejects.toThrow()
    await expect(publicFetch('https://example.ac.kr/x', { method: 'POST' })).rejects.toThrow('GET·HEAD만')
  })

  it('이름이 내부 주소를 가리키면 잇지 않는다 (localhost)', async () => {
    const s = await server()
    try {
      const f = makePublicFetch({ allowUrl: (u) => u.protocol === 'http:' })
      await expect(f(`http://localhost:${s.port}/x`)).rejects.toMatchObject({ code: 'EPRIVATE' })
    } finally {
      s.close()
    }
  })

  it('허락한 주소면 받고, 리다이렉트도 따라가되 그때마다 다시 확인한다', async () => {
    const s = await server()
    try {
      const f = makePublicFetch({ allowAddress: (ip) => ip === '127.0.0.1' || ip === '::1', allowUrl: (u) => u.protocol === 'http:' })
      const res = await f(`http://localhost:${s.port}/moved`)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('ok /final')
      const head = await f(`http://localhost:${s.port}/plan.pdf`, { method: 'HEAD' })
      expect(head.headers.get('etag')).toBe('"e1"')
      // 공개 주소였던 곳이 내부 주소(메타데이터)로 넘기면 막는다
      await expect(f(`http://localhost:${s.port}/to-metadata`)).rejects.toThrow()
    } finally {
      s.close()
    }
  })
})
