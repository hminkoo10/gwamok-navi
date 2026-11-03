import type { ServerResponse } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { sendWebResponse } from './node-adapter'

function fakeRes(accept: string) {
  const out: { status?: number; headers?: Record<string, string | string[]>; body?: Buffer } = {}
  const res = {
    req: { headers: { 'accept-encoding': accept } },
    writeHead: (status: number, headers: Record<string, string | string[]>) => {
      out.status = status
      out.headers = headers
    },
    end: (body: Buffer) => {
      out.body = body
    },
  }
  return { res: res as unknown as ServerResponse, out }
}

const json = (body: string | null, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

describe('API 응답 압축', () => {
  const big = JSON.stringify({ tracks: Array.from({ length: 3000 }, (_, i) => ({ i, name: `학생부종합 전형 ${i}` })) })

  it('gzip을 받는 브라우저에는 큰 JSON을 압축해 보낸다', async () => {
    for (let round = 0; round < 2; round++) {
      const { res, out } = fakeRes('gzip, deflate, br')
      await sendWebResponse(res, json(big))
      expect(out.headers!['content-encoding']).toBe('gzip')
      expect(out.headers!.vary).toBe('accept-encoding')
      expect(Number(out.headers!['content-length'])).toBe(out.body!.byteLength)
      expect(out.body!.byteLength).toBeLessThan(big.length / 3)
      expect(gunzipSync(out.body!).toString()).toBe(big)
    }
  })

  it('작은 응답, gzip을 못 받는 곳, 본문 없는 304는 그대로 보낸다', async () => {
    const cases: [string, Response][] = [
      ['gzip', json('{"ok":true}')],
      ['identity', json(big)],
      ['gzip', new Response(null, { status: 304, headers: { etag: '"1"' } })],
    ]
    for (const [accept, response] of cases) {
      const { res, out } = fakeRes(accept)
      await sendWebResponse(res, response)
      expect(out.headers!['content-encoding']).toBeUndefined()
      expect(Number(out.headers!['content-length'])).toBe(out.body!.byteLength)
    }
  })
})
