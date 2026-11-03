import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, call, health, myData, NO_FEATURES } from './api'
import { safeHref } from './href'
import { decodeShare } from './share'
import { firstSeen, unseenOf } from './updates'

afterEach(() => {
  vi.unstubAllGlobals()
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('링크 주소 검사', () => {
  it('http·https만 링크로 쓴다', () => {
    expect(safeHref('https://school.example.kr/board?a=1')).toBe('https://school.example.kr/board?a=1')
    expect(safeHref(' http://x.test/ ')).toBe('http://x.test/')
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', '//evil.test', '/local', '', null, undefined, 'https://'])
      expect(safeHref(bad)).toBeUndefined()
  })
})

describe('대입 소식: 처음 쓰는 기기', () => {
  const entries = [
    { id: 1, dataset: 'admissions', key: 'snu', summary: '', createdAt: '2026-06-01T00:00:00.000Z' },
    { id: 2, dataset: 'admissions', key: 'korea', summary: '', createdAt: '2026-09-01T00:00:00.000Z' },
  ]

  it('지금까지 나온 소식은 새 소식으로 치지 않고, 그 뒤 소식부터 알린다', () => {
    const seen = firstSeen(entries)
    expect(unseenOf(entries, seen, [])).toEqual([])
    const later = { id: 3, dataset: 'admissions', key: 'snu', summary: '', createdAt: '2026-10-23T00:00:00.000Z' }
    expect(unseenOf([...entries, later], seen, ['snu'])).toEqual([later])
    // 소식이 하나도 없던 기기는 다음 소식부터 새것
    expect(unseenOf([later], firstSeen([]), [])).toEqual([later])
  })
})

describe('공유 링크', () => {
  it('예전(v1) 링크는 실제 반송고 나이스 id를 쓰지 않는다', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, majors: [], units: [], pinned: [], excluded: [] }))
    const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    let bin = ''
    for (const b of packed) bin += String.fromCharCode(b)
    const state = await decodeShare(btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
    expect(state?.school.id.startsWith('shared-')).toBe(true)
    expect(state?.school.id).not.toBe('neis-J10-7530847-2026')
  })
})

describe('서버 확인', () => {
  it('정적 배포(/api가 없어 index.html이나 404가 옴)면 서버 없음', async () => {
    vi.stubGlobal('fetch', async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(health()).resolves.toEqual(NO_FEATURES)
    vi.stubGlobal('fetch', async () => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }))
    await expect(health()).resolves.toEqual(NO_FEATURES)
  })

  it('서버에 닿지 못했거나 서버 오류면 서버 없음으로 보지 않는다 (로그인 없이 열지 않게)', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(health()).rejects.toBeInstanceOf(ApiError)
    vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
    await expect(health()).rejects.toBeInstanceOf(ApiError)
    vi.stubGlobal('fetch', async () => json({ error: '서버 오류가 났어요.' }, 500))
    await expect(health()).rejects.toBeInstanceOf(ApiError)
  })

  it('서버가 있으면 기능을 읽는다', async () => {
    vi.stubGlobal('fetch', async () => json({ ai: true, login: true, notice: '점검' }))
    await expect(health()).resolves.toMatchObject({ server: true, ai: true, login: true, signup: true, notice: '점검' })
  })
})

describe('계정 저장 요청', () => {
  it('409의 계정 설계를 오류와 함께 넘긴다', async () => {
    const body = { error: '다른 곳에서 먼저 저장했어요.', saved: { data: { prefs: {} }, updatedAt: 'r2' } }
    vi.stubGlobal('fetch', async () => json(body, 409))
    const e = await call('/api/me/data').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).status).toBe(409)
    expect((e as ApiError).body).toEqual(body)
  })

  it('판(base)을 함께 보내고, keepalive는 64KB 안쪽일 때만 쓴다', async () => {
    const sent: RequestInit[] = []
    vi.stubGlobal('fetch', async (_: string, init: RequestInit) => {
      sent.push(init)
      return json({ updatedAt: 'r2' })
    })
    await myData.put({ prefs: {} }, 'r1', { keepalive: true })
    await myData.put({ prefs: { note: '가'.repeat(30_000) } }, null, { keepalive: true })
    expect(JSON.parse(String(sent[0].body))).toEqual({ data: { prefs: {} }, base: 'r1' })
    expect(sent[0].keepalive).toBe(true)
    // 한글은 한 글자에 3바이트: 3만 글자면 90KB라 보통 요청으로 보낸다
    expect(sent[1].keepalive).toBe(false)
    expect(JSON.parse(String(sent[1].body)).base).toBeNull()
  })
})
