import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { BANSONG_2026 } from '../src/data/schools/bansong2026'
import type { ReadResult, ReadTarget, SchoolRef } from './curriculum'
import { schoolByCode } from './curriculum'
import type { Discovery } from './discover'
import { createApi } from './handler'
import { DailyUsage, kstDay } from './limits'
import { schoolYear } from './neis'
import { Store } from './store'
import { sessionFor, signedIn } from './testing'

// 공유 편제표를 지키는 규칙: 이미 공유된 것을 바꿔 끼우지 못하게, 숨긴 파일·다른 해 표는 공유하지 않게,
// 나이스 오류는 기억하지 않게, 하루 한도는 저장소에 한국 날짜로 센다

const ENV = { AI_BASE_URL: 'https://ai.example.com/v1/', AI_API_KEY: 'sk-test-secret', AI_MODEL: 'test-model' }
const BODY = { office: 'J10', code: '7530847', cohort: 2026 }
const ctx = (ip = '1.1.1.1') => ({ ip, env: ENV })
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://app.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://app.test', ...headers },
    body: JSON.stringify(body),
  })
const get = (path: string, headers: Record<string, string> = {}) => new Request(`http://app.test${path}`, { headers })

const NEIS_ROW = {
  ATPT_OFCDC_SC_CODE: 'J10',
  ATPT_OFCDC_SC_NM: '경기도교육청',
  SD_SCHUL_CODE: '7530847',
  SCHUL_NM: '반송고등학교',
  HMPG_ADRES: 'bansong-h.goehs.kr',
}
const candidate = (name: string) => ({
  url: `https://bansong-h.goehs.kr/upload/${name}.pdf`,
  kind: 'pdf' as const,
  fileName: `${name}.pdf`,
  postTitle: '2026학년도 교육과정 편제표',
  postUrl: 'https://bansong-h.goehs.kr/post/1',
  score: 9,
  source: 'homepage' as const,
})
const FOUND: Discovery = { entry: 'https://bansong-h.goehs.kr/bansong-h/main.do', candidates: [candidate('a'), candidate('b')] }

/** 나이스는 neis 상태대로 답하고, 읽기는 read가 정한다 */
function setup(read: (t: ReadTarget) => Partial<ReadResult> = () => ({}), store = new Store(':memory:')) {
  const neis = { mode: 'ok' as 'ok' | 'error' | 'quota' | 'none', calls: 0 }
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.hostname !== 'open.neis.go.kr') return new Response('no', { status: 404 })
    neis.calls++
    if (neis.mode === 'error') return new Response('down', { status: 500 })
    if (neis.mode === 'quota') return Response.json({ RESULT: { CODE: 'ERROR-337', MESSAGE: '일별 트래픽 제한' } })
    if (neis.mode === 'none' || url.searchParams.get('SD_SCHUL_CODE') !== '7530847') return Response.json({ RESULT: { CODE: 'INFO-200' } })
    return Response.json({ schoolInfo: [{ head: [] }, { row: [NEIS_ROW] }] })
  }) as typeof fetch
  let readCalls = 0
  const raw = createApi({
    fetch: fetchImpl,
    store,
    schoolInfo: async () => ({ id: null, candidates: [] }),
    robots: async () => {},
    discover: async () => FOUND,
    read: async (_s: SchoolRef, _c: number, t: ReadTarget) => {
      readCalls++
      return { data: { ...BANSONG_2026, id: 'x' }, unknown: [], sourceUrl: t.url, pages: 3, used: [2], ...read(t) }
    },
  })
  const api = signedIn(raw, store)
  const boss = sessionFor(store, { email: 'boss@example.com', role: 'owner' })
  const readFile = async (name: string, headers: Record<string, string> = {}, ip = '1.1.1.1') => {
    await api(post('/api/curriculum/discover', BODY, headers), ctx(ip))
    return api(post('/api/curriculum/read', { ...BODY, url: candidate(name).url }, headers), ctx(ip))
  }
  return { api, raw, store, neis, boss, readFile, reads: () => readCalls }
}

describe('공유된 편제표 지키기', () => {
  it('공유된 편제표가 있으면 다른 파일로 바꿔 끼우지 못하고, 관리자는 다시 읽을 수 있다', async () => {
    const t = setup()
    const first = await (await t.readFile('a')).json()
    expect(first.status).toBe('ready')
    // 다른 학생이 다른 파일을 읽으라고 보내도 이미 공유된 것을 준다 (AI도 다시 부르지 않는다)
    const other = signedIn(t.raw, t.store, { email: 'other@example.com' })
    await other(post('/api/curriculum/discover', BODY), ctx('2.2.2.2'))
    const second = await (await other(post('/api/curriculum/read', { ...BODY, url: candidate('b').url }), ctx('2.2.2.2'))).json()
    expect(second.curriculum.id).toBe(first.curriculum.id)
    expect(t.reads()).toBe(1)
    // 관리자는 확인하느라 다른 파일을 읽어 새 판을 만들 수 있다
    const staff = await (await t.readFile('b', { cookie: t.boss })).json()
    expect(staff.curriculum.id).not.toBe(first.curriculum.id)
    expect(t.store.latest('J10', '7530847', 2026)?.readBy).toBeGreaterThan(0)
  })

  it('관리자가 숨긴 파일은 다시 읽어 공유하지 않는다', async () => {
    const t = setup()
    const first = await (await t.readFile('a')).json()
    t.store.hide(first.curriculum.id)
    const again = await t.readFile('a', {}, '3.3.3.3')
    expect(again.status).toBe(422)
    expect((await again.json()).error).toContain('숨긴 파일')
    expect(t.reads()).toBe(1)
    // 다른 파일은 읽을 수 있다
    expect((await (await t.readFile('b')).json()).status).toBe('ready')
  })

  it('다른 해 입학생 표면 공유하지 않는다', async () => {
    const t = setup(() => ({ year: 2025 }))
    const res = await t.readFile('a')
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('2025학년도 입학생 편제표')
    expect(t.store.latest('J10', '7530847', 2026)).toBeNull()
  })

  it('표준 과목을 너무 적게 알아본 결과는 공유하지 않는다', async () => {
    const odd = (s: string) => `${s}알수없음`
    const t = setup(() => ({
      data: {
        ...BANSONG_2026,
        terms: BANSONG_2026.terms.map((x) => ({
          ...x,
          fixed: x.fixed.map((f) => ({ ...f, subject: odd(f.subject) })),
          groups: x.groups.map((g) => ({ ...g, options: g.options.map(odd) })),
        })),
        tracks: [],
      },
    }))
    expect((await (await t.readFile('a')).json()).status).toBe('partial')
    expect(t.store.latest('J10', '7530847', 2026)).toBeNull()
  })

  it('먼 해의 입학년도는 받지 않는다', async () => {
    const t = setup()
    const res = await t.api(post('/api/curriculum/discover', { ...BODY, cohort: schoolYear() + 3 }), ctx())
    expect(res.status).toBe(400)
  })
})

describe('나이스 조회', () => {
  it('나이스 오류는 기억하지 않고, 나아지면 바로 다시 찾는다', async () => {
    const t = setup()
    t.neis.mode = 'error'
    expect((await t.api(get('/api/school-tracks?office=J10&code=7530847&cohort=2026'), ctx())).status).toBe(502)
    t.neis.mode = 'quota'
    expect((await t.api(get('/api/school-tracks?office=J10&code=7530847&cohort=2026'), ctx())).status).toBe(502)
    t.neis.mode = 'ok'
    expect((await t.api(get('/api/school-tracks?office=J10&code=7530847&cohort=2026'), ctx())).status).not.toBe(502)
  })

  it('없는 학교는 잠깐 기억하고, 나이스에 묻기 전에 요청 수를 센다', async () => {
    const t = setup()
    const miss = await t.api(get('/api/school-tracks?office=J10&code=1234567&cohort=2026'), ctx())
    expect(miss.status).toBe(404)
    const calls = t.neis.calls
    expect((await t.api(get('/api/school-tracks?office=J10&code=1234567&cohort=2026'), ctx())).status).toBe(404)
    expect(t.neis.calls).toBe(calls)
    // 코드를 바꿔 가며 물어도 1분에 40번까지
    const statuses: number[] = []
    for (let i = 0; i < 45; i++) statuses.push((await t.api(get(`/api/school-tracks?office=J10&code=${String(2000000 + i)}&cohort=2026`), ctx())).status)
    expect(statuses).toContain(429)
    expect(t.neis.calls).toBeLessThanOrEqual(calls + 40)
  })

  it('나이스 결과 코드: 자료 없음만 null이고 그 밖의 코드는 오류', async () => {
    const reply = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch
    expect(await schoolByCode('J10', '7530847', undefined, reply({ RESULT: { CODE: 'INFO-200' } }))).toBeNull()
    await expect(schoolByCode('J10', '7530847', undefined, reply({ RESULT: { CODE: 'ERROR-290' } }))).rejects.toThrow()
    await expect(schoolByCode('J10', '7530847', undefined, reply({}, 503))).rejects.toThrow()
  })
})

describe('하루 사용량', () => {
  it('한국 날짜로 세고, 한도를 넘기지 않으며, 저장소에 남는다', () => {
    const db = new DatabaseSync(':memory:')
    const u = new DailyUsage(db)
    // 한국 시간 자정(UTC 15시)에 날이 바뀐다
    expect(kstDay(new Date('2026-10-23T14:59:00Z'))).toBe('2026-10-23')
    expect(kstDay(new Date('2026-10-23T15:00:00Z'))).toBe('2026-10-24')
    const at = new Date('2026-10-23T03:00:00Z')
    expect(u.take('all:read', 2, at)).toBe(true)
    expect(u.take('all:read', 2, at)).toBe(true)
    expect(u.take('all:read', 2, at)).toBe(false)
    expect(u.take('all:read', 0, at)).toBe(false)
    expect(new DailyUsage(db).used('all:read', at)).toBe(2)
    expect(u.take('all:read', 2, new Date('2026-10-23T15:30:00Z'))).toBe(true)
  })

  it('서버를 다시 켜도 서버 AI 하루 한도를 이어 센다', async () => {
    const store = new Store(':memory:')
    const t = setup(() => ({}), store)
    expect((await t.api(post('/api/admin/settings', { values: { dailyReadLimit: 1 } }, { cookie: t.boss }), ctx())).status).toBe(200)
    expect((await (await t.readFile('a')).json()).status).toBe('ready')
    // 같은 저장소로 서버를 다시 켠 것처럼: 관리자가 숨긴 뒤 다른 파일을 읽으려 하면 오늘 한도에 걸린다
    t.store.hide(t.store.latest('J10', '7530847', 2026)!.id)
    const restarted = setup(() => ({}), store)
    const res = await restarted.readFile('b')
    expect(res.status).toBe(429)
    expect((await res.json()).error).toContain('오늘 자동 읽기 사용량을 다 썼어요')
  })
})
