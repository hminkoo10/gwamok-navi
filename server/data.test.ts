import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { AdmissionPlan } from '../src/data/schema'
import { checkPlan } from '../src/data/admissions-check'
import type { AiConfig } from './ai'
import { Datasets, diffSummary } from './datasets'
import { createApi } from './handler'
import { diffPlan } from './plan-update'
import { servicesFor } from './services'
import { Store } from './store'
import { sessionFor, testApi } from './testing'
import { SourceWatch } from './watch'

const plan = (univ: string, seats = 100): AdmissionPlan => ({
  univ,
  planTitle: `${univ} 2028학년도 입학전형시행계획`,
  url: `https://example.ac.kr/${univ}.pdf`,
  date: '2026-04-30',
  totals: null,
  changes: [],
  tracks: [
    {
      id: 'school-rec',
      name: '학교추천전형',
      type: '교과',
      period: '수시',
      quota: '정원내',
      seats,
      grads: '예정자',
      rec: { required: true, limit: '고교별 10명' },
      schools: { only: [], exclude: ['특성화고'] },
      regions: [],
      special: [],
      who: '국내 고교 졸업예정자, 학교장 추천',
      method: '교과 100%',
      elements: ['교과'],
      min: null,
      subjects: null,
      note: null,
      pages: '10',
    },
  ],
})

describe('전형 자료 검사', () => {
  it('정해진 값만 통과한다', () => {
    expect(checkPlan(plan('korea'), 'korea').tracks).toHaveLength(1)
    const bad = { ...plan('korea'), tracks: [{ ...plan('korea').tracks[0], type: '정시', schools: { only: ['외계고'] } }] }
    expect(() => checkPlan(bad, 'korea')).toThrow(/type.*schools|schools.*type/)
    expect(() => checkPlan({ ...plan('korea'), tracks: [] }, 'korea')).toThrow(/tracks/)
  })

  it('바뀐 것을 한 줄로 적는다', () => {
    const a = plan('korea', 100)
    const b = {
      ...a,
      tracks: [
        { ...a.tracks[0], seats: 120 },
        { ...a.tracks[0], id: 'essay', name: '논술전형', type: '논술' as const, elements: ['논술' as const] },
      ],
    }
    expect(diffSummary(a, b)).toBe('추가: 논술전형 / 변경: 학교추천전형 / 모집인원 100→220')
  })

  it('합계를 비우거나 모양이 틀린 상세를 버려서 통과시키지 않는다', () => {
    const p = { ...plan('korea'), totals: { 수시: 100 } }
    for (const totals of [{}, [], 0, '수시 100']) expect(() => checkPlan({ ...p, totals }, 'korea'), JSON.stringify(totals)).toThrow(/totals/)
    expect(checkPlan({ ...p, totals: null }, 'korea').totals).toBeNull()
    const rule = {
      group: '인문',
      units: null,
      tracks: ['school-rec'],
      use: '표준점수',
      weights: { 국어: 50, 수학: 50 },
      inquiry: null,
      english: null,
      history: null,
      bonus: null,
      formula: null,
      total: null,
      pages: '40',
    }
    expect(checkPlan({ ...p, suneung: [rule] }, 'korea').suneung).toEqual([rule])
    // 모양이 틀린 묶음 하나를 빼고 저장하지 않는다
    expect(() => checkPlan({ ...p, suneung: [rule, { group: '자연' }] }, 'korea')).toThrow(/suneung\[1\] use/)
    // 없는 전형 id를 빼면 빈 배열(그 대학 해당 전형 모두)로 넓어지므로 막는다
    expect(() => checkPlan({ ...p, suneung: [{ ...rule, tracks: ['nope'] }] }, 'korea')).toThrow(/suneung\[0\] tracks/)
    expect(() => checkPlan({ ...p, record: [{ tracks: ['nope'], subjects: '국수영사과', pages: '30' }] }, 'korea')).toThrow(/record\[0\] tracks/)
    expect(() => checkPlan({ ...p, tracks: [{ ...p.tracks[0], stages: [{ step: '일괄', parts: { 교과: '100' } }] }] }, 'korea')).toThrow(/stages\[0\]/)
    expect(() => checkPlan({ ...p, tracks: [{ ...p.tracks[0], interview: 'x'.repeat(301) }] }, 'korea')).toThrow(/interview/)
  })
})

describe('대입 자료 판', () => {
  it('관리자가 고치면 판이 올라가고, 되돌리면 배포한 자료로 돌아간다', () => {
    const db = new DatabaseSync(':memory:')
    const ds = new Datasets(db, { year: 2028, plans: [plan('korea')] })
    const v0 = ds.version()
    const fixed = ds.setPlan('korea', plan('korea', 130), 'boss', '')
    expect(fixed.tracks[0].seats).toBe(130)
    expect(ds.version()).not.toBe(v0)
    expect(ds.admissions().plans[0].tracks[0].seats).toBe(130)
    expect(ds.updates()[0]).toMatchObject({ key: 'korea', summary: '변경: 학교추천전형 / 모집인원 100→130' })
    expect(ds.revert('korea', 'boss')).toBe(true)
    expect(ds.admissions().plans[0].tracks[0].seats).toBe(100)
    expect(() => ds.setPlan('korea', { nope: 1 }, 'boss', '')).toThrow()
  })

  it('관리자가 고쳐도 원문 게시글·감시 주소는 남는다', () => {
    const notice = 'https://example.ac.kr/notice?id=1'
    const ds = new Datasets(new DatabaseSync(':memory:'), { year: 2028, plans: [{ ...plan('chosun'), page: notice, watch: notice }] })
    const edited = plan('chosun', 90)
    expect(ds.setPlan('chosun', edited, 'boss', '')).toMatchObject({ page: notice, watch: notice, url: 'https://example.ac.kr/chosun.pdf' })
    // http 주소나 이상한 값은 받지 않는다
    expect(ds.setPlan('chosun', { ...edited, page: 'javascript:alert(1)' }, 'boss', '').page).toBe(notice)
  })
})

describe('/api/data', () => {
  const ORIGIN = 'http://app.test'
  const ENV = { OWNER_EMAIL: 'boss@example.com' }

  it('판 번호를 ETag로 주고, 그대로면 304', async () => {
    const api = testApi()
    const first = await api(new Request(`${ORIGIN}/api/data/admissions`), { ip: '1.1.1.1', env: {} })
    expect(first.status).toBe(200)
    const etag = first.headers.get('etag')!
    const body = (await first.json()) as { version: string; plans: unknown[] }
    expect(etag).toBe(`"${body.version}"`)
    const again = await api(new Request(`${ORIGIN}/api/data/admissions`, { headers: { 'if-none-match': etag } }), { ip: '1.1.1.1', env: {} })
    expect(again.status).toBe(304)
    const v = await (await api(new Request(`${ORIGIN}/api/data/version`), { ip: '1.1.1.1', env: {} })).json()
    expect(v).toEqual({ admissions: body.version })
  })

  it('관리자만 자료를 고치고, 고치면 소식에 남는다', async () => {
    const store = new Store(':memory:')
    const api = createApi({ store })
    const call = (method: string, path: string, body?: unknown, cookie = '') =>
      api(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        { ip: '1.1.1.1', env: ENV },
      )
    expect((await call('POST', '/api/admin/data/plan', { univ: 'korea', plan: plan('korea') })).status).toBe(401)
    const cookie = sessionFor(store, { email: ENV.OWNER_EMAIL, role: 'owner' })
    const bad = await call('POST', '/api/admin/data/plan', { univ: 'korea', plan: { tracks: [] } }, cookie)
    expect(bad.status).toBe(400)
    const ok = await call('POST', '/api/admin/data/plan', { univ: 'korea', plan: plan('korea', 650), summary: '학교추천 인원 정정' }, cookie)
    expect(ok.status).toBe(200)
    // 고친 자료는 로그인한 누구에게나 바로 보인다
    const student = sessionFor(store, { email: 'student@example.com' })
    const snap = (await (await call('GET', '/api/data/admissions', undefined, student)).json()) as { plans: AdmissionPlan[] }
    expect(snap.plans.find((p) => p.univ === 'korea')?.tracks[0].seats).toBe(650)
    const feed = (await (await call('GET', '/api/data/updates', undefined, student)).json()) as { entries: { summary: string }[] }
    expect(feed.entries[0].summary).toBe('학교추천 인원 정정')
  })

  it('AI 제안은 그 사이 같은 곳을 고쳤으면 409로 반영하지 않고, 되돌리면 원문 기준과 기다리던 제안을 정리한다', async () => {
    const store = new Store(':memory:')
    const api = createApi({ store })
    const cookie = sessionFor(store, { email: ENV.OWNER_EMAIL, role: 'owner' })
    const call = (method: string, path: string, body?: unknown) =>
      api(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        { ip: '1.1.1.1', env: ENV },
      )
    const korea = ((await (await call('GET', '/api/admin/data/plan?univ=korea')).json()) as { plan: AdmissionPlan }).plan
    const first = korea.tracks[0]
    const withSeats = (p: AdmissionPlan, seats: number) => ({ ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, seats } : t)) })
    /** AI가 남긴 것처럼: korea 첫 전형 인원을 바꾸는 제안 */
    const propose = (base: AdmissionPlan, seats: number) =>
      Number(
        store.db
          .prepare("insert into data_proposals (univ, created_at, status, summary, patch) values ('korea', ?, 'pending', ?, ?)")
          .run(new Date().toISOString(), `${first.name} 모집인원`, JSON.stringify(diffPlan(base, withSeats(base, seats)))).lastInsertRowid,
      )
    const status = async (id: number) =>
      ((await (await call('GET', '/api/admin/data')).json()) as { proposals: { id: number; status: string }[] }).proposals.find((p) => p.id === id)?.status
    const seats = (first.seats ?? 0) + 5

    // 관리 화면에서 같은 곳을 고치면 겹치는 제안은 직접 확인으로 돌아간다
    const overlapping = propose(korea, seats)
    expect((await call('POST', '/api/admin/data/plan', { univ: 'korea', plan: withSeats(korea, seats + 1) })).status).toBe(200)
    expect(await status(overlapping)).toBe('failed')
    // 고치기 전 자료로 만든 제안은 반영을 눌러도 409
    const stale = propose(korea, seats + 2)
    const res = await call('POST', '/api/admin/data/proposals/apply', { id: stale })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toContain('그 사이에 자료가 바뀌어')
    expect(await status(stale)).toBe('failed')

    // 되돌리면 원문 기준을 지우고 기다리던 제안을 정리한다
    const now = ((await (await call('GET', '/api/admin/data/plan?univ=korea')).json()) as { plan: AdmissionPlan }).plan
    const waiting = propose(now, seats + 3)
    store.db.prepare("insert into plan_snapshots (univ, sha, kind, pages, fetched_at) values ('korea', 'x', 'pdf', '[]', '')").run()
    expect((await call('POST', '/api/admin/data/revert', { univ: 'korea' })).status).toBe(200)
    expect(store.db.prepare("select 1 from plan_snapshots where univ = 'korea'").get()).toBeUndefined()
    expect(await status(waiting)).toBe('failed')
  })

  it('편집기를 연 뒤 자료가 바뀌었으면 편집기 저장이 덮어쓰지 않는다', async () => {
    const store = new Store(':memory:')
    const api = createApi({ store })
    const cookie = sessionFor(store, { email: ENV.OWNER_EMAIL, role: 'owner' })
    const call = (method: string, path: string, body?: unknown) =>
      api(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        { ip: '1.1.1.1', env: ENV },
      )
    const load = async () => (await (await call('GET', '/api/admin/data/plan?univ=korea')).json()) as { plan: AdmissionPlan; tag: string }
    const opened = await load()
    expect(opened.tag).toMatch(/^[0-9a-f]{16}$/)
    const withSeats = (p: AdmissionPlan, seats: number) => ({ ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, seats } : t)) })
    const seats = (opened.plan.tracks[0].seats ?? 0) + 3
    // 다른 창(또는 AI 제안 반영)이 먼저 고친다
    expect((await call('POST', '/api/admin/data/plan', { univ: 'korea', plan: withSeats(opened.plan, seats), base: opened.tag })).status).toBe(200)
    // 처음 연 편집기에서 저장하면 409, 다시 불러온 판으로는 저장된다
    const stale = await call('POST', '/api/admin/data/plan', { univ: 'korea', plan: withSeats(opened.plan, seats + 1), base: opened.tag })
    expect(stale.status).toBe(409)
    expect((await load()).plan.tracks[0].seats).toBe(seats)
    const fresh = await load()
    expect((await call('POST', '/api/admin/data/plan', { univ: 'korea', plan: withSeats(fresh.plan, seats + 1), base: fresh.tag })).status).toBe(200)
  })
})

describe('대입 자료 AI 확인 한도', () => {
  const AI: AiConfig = {
    kind: 'openai',
    name: 'test',
    baseUrl: 'https://ai.example',
    apiKey: 'k',
    model: 'm',
    visionModel: 'v',
    maxTokensParam: 'max_tokens',
    jsonMode: false,
  }

  it('한 번 감시에 여러 대학 원문이 바뀌어도 하루 한도만큼만 AI를 부른다', async () => {
    let etag = 'v1'
    let version = 'A'
    let calls = 0
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'HEAD' ? new Response(null, { status: 200, headers: { etag, 'content-type': 'application/pdf' } }) : new Response('x')) as typeof fetch
    const s = servicesFor(new Store(':memory:'), {}, fetchImpl, {
      download: async (p) => Buffer.from(`${p.univ}\f${version}`),
      read: async (buf) => ({ kind: 'pdf', pages: buf.toString().split('\f') }),
      render: async () => [],
      ai: AI,
      chat: async () => {
        calls++
        return '{"changes":[]}'
      },
    })
    s.settings.save({ dailyDataLimit: 2, aiData: true })
    await s.updater.ensureBaselines(s.datasets.admissions().plans.map((p) => p.univ))
    await s.watch.checkAll()
    etag = 'v2'
    version = 'B'
    await s.watch.checkAll()
    for (let i = 0; i < 400 && s.updater.checking().length; i++) await new Promise((r) => setTimeout(r, 5))
    expect(s.updater.checking()).toEqual([])
    expect(calls).toBe(2)
    expect(s.updater.usedToday()).toBe(2)
  })
})

describe('원문 감시', () => {
  const res = (headers: Record<string, string>, status = 200) => new Response(status === 200 ? '' : null, { status, headers })

  it('처음엔 기준만 잡고, 크기·수정 시각이 바뀌면 알리고, 없어진 파일도 알린다', async () => {
    let version = 'a'
    let gone = false
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url).includes('gone') && gone) return res({}, 404)
      return res({ etag: `"${version}"`, 'last-modified': 'Wed, 30 Apr 2026 00:00:00 GMT', 'content-length': '1000' })
    }) as typeof fetch
    const db = new DatabaseSync(':memory:')
    const w = new SourceWatch(
      db,
      [
        { key: 'plan-korea', univ: 'korea', title: '고려대 계획', url: 'https://example.ac.kr/korea.pdf' },
        { key: 'plan-gone', univ: 'x', title: '없어질 파일', url: 'https://example.ac.kr/gone.pdf' },
      ],
      fetchImpl,
    )
    expect(await w.checkAll()).toEqual({ checked: 2, changed: 0 })
    expect(w.pendingCount()).toBe(0)
    version = 'b'
    gone = true
    expect(await w.checkAll()).toEqual({ checked: 2, changed: 2 })
    const rows = w.list()
    expect(rows.find((r) => r.key === 'plan-korea')).toMatchObject({ status: '바뀜', pending: true })
    expect(rows.find((r) => r.key === 'plan-gone')).toMatchObject({ status: '없어짐', pending: true })
    expect(w.acknowledge('plan-korea')).toBe(true)
    expect(w.pendingCount()).toBe(1)
    // 관리자가 넣은 주소만 지울 수 있다
    const added = w.add({ url: 'https://example.ac.kr/notice', title: '입학처 공지', univ: 'korea' })
    expect(w.remove('plan-korea')).toBe(false)
    expect(w.remove(added.key)).toBe(true)
  })

  it('HEAD를 막는 서버는 내용을 받아 비교한다', async () => {
    let body = 'v1'
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 405 })
        : new Response(body, { status: 200, headers: { 'content-type': 'application/pdf' } })) as typeof fetch
    const w = new SourceWatch(new DatabaseSync(':memory:'), [{ key: 'p', univ: 'x', title: '계획', url: 'https://example.ac.kr/p.pdf' }], fetchImpl)
    expect(await w.checkAll()).toEqual({ checked: 1, changed: 0 })
    expect(w.list()[0]).toMatchObject({ status: '확인함', detail: '내용 비교' })
    body = 'v2'
    expect(await w.checkAll()).toEqual({ checked: 1, changed: 1 })
  })

  it('게시글 페이지는 일회용 토큰·조회수가 바뀌어도 첨부 목록이 같으면 그대로', async () => {
    let views = 1
    let attach = 'no=0'
    const page = () =>
      `<html><p>조회 ${views++}</p><a href="download.php?bo_table=a&amp;wr_id=1&amp;${attach}&amp;nonce=${Math.random().toString(36).slice(2)}">계획.hwp</a><a href="/board?page=2">다음</a></html>`
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Response(init?.method === 'HEAD' ? null : page(), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) as typeof fetch
    const w = new SourceWatch(new DatabaseSync(':memory:'), [{ key: 'n', univ: 'x', title: '공지', url: 'https://example.ac.kr/notice' }], fetchImpl)
    await w.checkAll()
    expect(await w.checkAll()).toEqual({ checked: 1, changed: 0 })
    expect(w.list()[0].detail).toBe('첨부 1개 비교')
    attach = 'no=1'
    expect(await w.checkAll()).toEqual({ checked: 1, changed: 1 })
  })

  it('재는 방법이 바뀌면 알리지 않고 새 기준으로 삼는다', async () => {
    let headOk = true
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: headOk ? 200 : 403, headers: { etag: '"a"', 'content-type': 'application/pdf' } })
        : new Response('pdf bytes', { status: 200, headers: { 'content-type': 'application/pdf' } })) as typeof fetch
    const w = new SourceWatch(new DatabaseSync(':memory:'), [{ key: 'p', univ: 'x', title: '계획', url: 'https://example.ac.kr/p.pdf' }], fetchImpl)
    await w.checkAll()
    headOk = false
    expect(await w.checkAll()).toEqual({ checked: 1, changed: 0 })
    expect(await w.checkAll()).toEqual({ checked: 1, changed: 0 })
  })

  it('https가 아니거나 연결이 안 되면 바뀐 것으로 보지 않는다', async () => {
    const db = new DatabaseSync(':memory:')
    const w = new SourceWatch(
      db,
      [
        { key: 'a', univ: '', title: 'http', url: 'http://example.ac.kr/a.pdf' },
        { key: 'b', univ: '', title: 'down', url: 'https://example.ac.kr/b.pdf' },
      ],
      (async () => {
        throw new Error('down')
      }) as typeof fetch,
    )
    expect(await w.checkAll()).toEqual({ checked: 2, changed: 0 })
    expect(w.list().map((r) => r.status)).toEqual(['연결 실패', '연결 실패'])
  })
})
