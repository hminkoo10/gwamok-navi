import { describe, expect, it } from 'vitest'
import { planSummary } from './account-api'
import { Accounts, ACTIVITY_DAYS } from './accounts'
import { createApi } from './handler'
import { Store } from './store'
import { sessionFor, testApi } from './testing'

const ORIGIN = 'http://app.test'
const ENV = { AI_BASE_URL: 'https://ai.example.com/v1/', AI_API_KEY: 'sk-test-secret', AI_MODEL: 'test-model' }
const ctx = { ip: '1.1.1.1', env: ENV }
const get = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers })
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  })
/** 늘 같은 답을 하는 가짜 AI 서버 */
const aiReply = (content: string) => (async () => Response.json({ choices: [{ message: { content } }] })) as unknown as typeof fetch
const userLog = (store: Store) => new Accounts(store.db).logs({ kind: 'user' }).entries

describe('로그인 필수', () => {
  it('로그인하지 않으면 기능 정보와 로그인 과정 말고는 모두 401', async () => {
    const store = new Store(':memory:')
    const api = createApi({ store })
    const closed: [string, string][] = [
      ['GET', '/api/schools?q=반송고'],
      ['GET', '/api/school-tracks?office=J10&code=7530847&cohort=2026'],
      ['GET', '/api/curriculum?office=J10&code=7530847&cohort=2026'],
      ['POST', '/api/curriculum/discover'],
      ['POST', '/api/curriculum/read'],
      ['POST', '/api/curriculum/report'],
      ['POST', '/api/match'],
      ['POST', '/api/import'],
      ['GET', '/api/data/admissions'],
      ['GET', '/api/data/version'],
      ['GET', '/api/data/updates'],
      ['GET', '/api/me/data'],
      ['POST', '/api/me/data'],
      ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/log'],
    ]
    for (const [method, path] of closed) {
      const res = await api(method === 'GET' ? get(path) : post(path, {}), ctx)
      expect(res.status, path).toBe(401)
      expect(await res.json(), path).toEqual({ error: '로그인이 필요해요.' })
    }
    for (const path of ['/api/health', '/api/auth/me', '/api/auth/pending']) expect((await api(get(path), ctx)).status, path).toBe(200)
    // 스크립트용 숨기기는 로그인 대신 ADMIN_TOKEN을 본다
    expect(await (await api(post('/api/admin/hide', { id: 1 }), ctx)).json()).toEqual({ error: '권한이 없어요.' })
    // 누가 했는지 모르는 요청은 기록하지 않는다
    expect(new Accounts(store.db).logs().total).toBe(0)
  })

  it('정지된 계정은 쓰던 세션도 끊긴다', async () => {
    const store = new Store(':memory:')
    const api = createApi({ store })
    const cookie = sessionFor(store, { email: 'student@example.com' })
    expect((await api(get('/api/data/version', { cookie }), ctx)).status).toBe(200)
    const accounts = new Accounts(store.db)
    accounts.setDisabled(accounts.bySub('sub-student@example.com')!.id, true)
    expect((await api(get('/api/data/version', { cookie }), ctx)).status).toBe(401)
  })
})

describe('이용 기록', () => {
  it('문장으로 찾기는 찾은 분야만 남기고 적은 문장은 남기지 않는다. 10분 안에 또 찾으면 한 줄로 모은다', async () => {
    const store = new Store(':memory:')
    const api = testApi({ store, fetch: aiReply('{"majors":[{"id":"cs-software","why":"게임"}]}') })
    expect((await api(post('/api/match', { text: '게임 회사에 가고 싶은 홍길동' }), ctx)).status).toBe(200)
    expect((await api(post('/api/match', { text: '다른 문장' }), ctx)).status).toBe(200)
    const log = userLog(store)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ kind: 'user', who: 'student@example.com', action: 'match', detail: '찾은 분야 소프트웨어', times: 2 })
    expect(JSON.stringify(log)).not.toContain('홍길동')
  })

  it('파일 올려 읽기는 장수·글자 수와 결과만 남기고, 실패하면 화면에 보인 까닭을 남긴다', async () => {
    const store = new Store(':memory:')
    const api = testApi({ store, fetch: aiReply('{"terms":[{"id":"2-1","fixed":[{"subject":"대수","credits":4}]}]}') })
    const text = '비밀 메모 2-1 대수 4'
    expect((await api(post('/api/import', { text, cohort: 2026 }), ctx)).status).toBe(200)
    expect((await api(post('/api/import', { images: ['data:text/html;base64,PHNjcmlwdD4='] }), ctx)).status).toBe(400)
    const log = userLog(store)
    expect(log.map((e) => [e.action, e.target, e.detail])).toEqual([
      ['curriculum.import', '', '이미지 1장 · 실패: 이미지 형식이 맞지 않아요. PNG, JPG, WEBP만 됩니다.'],
      ['curriculum.import', '2026학년도 입학 편제표', `글 ${text.length}자 · 읽음 · 과목 1개`],
    ])
    expect(JSON.stringify(log)).not.toContain('비밀 메모')
  })

  it('설계를 처음 저장하면 요약을, 그다음부터는 바뀐 것을 한 줄씩 남긴다 (같은 내용을 다시 올리면 남기지 않는다)', async () => {
    const store = new Store(':memory:')
    const api = testApi({ store })
    const data = (pinned: string[], schoolId = 's1') => ({
      prefs: { schoolId, majors: ['cs-software'], univs: ['korea', 'yonsei'], pinned, excluded: ['미적분Ⅱ'], slot: 'a' },
      schools: [
        { id: 's1', name: '한국디지털미디어고등학교', track: '해킹방어과' },
        { id: 's2', name: '반송고등학교' },
      ],
      plans: [
        { id: 'a', name: '슬롯 1' },
        { id: 'b', name: '정시' },
      ],
    })
    // 아무것도 고르지 않은 빈 설계를 처음 올린 것은 남기지 않는다
    const empty = { prefs: { schoolId: '', majors: [], univs: [] }, schools: [], plans: [] }
    expect((await api(post('/api/me/data', { data: empty }), ctx)).status).toBe(200)
    expect(userLog(store)).toEqual([])
    store.db.prepare('delete from user_data').run()
    expect((await api(post('/api/me/data', { data: data([]) }), ctx)).status).toBe(200)
    expect((await api(post('/api/me/data', { data: data(['확률과 통계']) }), ctx)).status).toBe(200)
    // 바뀐 것 없이 다시 올리면(화면을 다시 열 때) 남기지 않는다
    expect((await api(post('/api/me/data', { data: data(['확률과 통계']) }), ctx)).status).toBe(200)
    await api(post('/api/me/data', { data: data([], 's2') }), ctx)
    expect(userLog(store).map((e) => [e.action, e.target, e.detail])).toEqual([
      ['design.pin', '슬롯 1', '- 확률과 통계'],
      ['design.school', '슬롯 1', '한국디지털미디어고등학교 → 반송고등학교'],
      ['design.pin', '슬롯 1', '+ 확률과 통계'],
      ['plan.save', '한국디지털미디어고등학교 해킹방어과', '처음 저장 · 분야 소프트웨어 · 대학 2곳 · 꼭 듣기 0 · 빼기 1 · 슬롯 2개'],
    ])
  })

  it('설계 요약은 화면이 보낸 값의 모양을 믿지 않는다', () => {
    const odd = planSummary({
      prefs: { schoolId: 'x', majors: ['없는 분야', 3, 'cs-software'], univs: 'korea' },
      schools: [{ id: 'x', name: '가나\n\t다고' }],
      plans: [],
    })
    expect(odd).toEqual({ target: '가나 다고', detail: '분야 소프트웨어 · 대학 0곳 · 꼭 듣기 0 · 빼기 0 · 슬롯 1개' })
    expect(planSummary({ prefs: null, schools: [null, 3], plans: [] }).target).toBe('학교 고르기 전')
  })

  it('1년이 지난 사용자 기록은 지우고, 관리자 기록은 남긴다', () => {
    const store = new Store(':memory:')
    const accounts = new Accounts(store.db)
    const old = new Date(Date.now() - (ACTIVITY_DAYS + 1) * 86400_000)
    accounts.activity(accounts.create({ sub: 'o', email: 'old@example.com' }), 'auth.login', '', '', {}, old)
    store.db
      .prepare("insert into admin_log (admin_id, admin_name, action, created_at, kind) values (2, 'boss@example.com', 'settings', ?, 'admin')")
      .run(old.toISOString())
    accounts.activity(accounts.create({ sub: 'n', email: 'new@example.com' }), 'auth.login')
    expect(accounts.logs().entries.map((e) => `${e.kind} ${e.who} ${e.action}`)).toEqual(['user new@example.com auth.login', 'admin boss@example.com settings'])
  })

  it('기록에는 그 사람의 지금 이름을 붙이고, 이름·행동 묶음으로도 거른다', () => {
    const store = new Store(':memory:')
    const accounts = new Accounts(store.db)
    const kim = accounts.create({ sub: 'k', email: 'kim@example.com' }, { name: '김민준' })
    accounts.activity(kim, 'design.pin', '슬롯 1', '+ 확률과 통계')
    accounts.activity(kim, 'auth.login')
    accounts.activity(accounts.create({ sub: 'l', email: 'lee@example.com' }), 'match', '', '찾은 분야 소프트웨어')
    expect(accounts.logs({ q: '김민' }).entries.map((e) => `${e.name}:${e.action}`)).toEqual(['김민준:auth.login', '김민준:design.pin'])
    expect(accounts.logs({ actions: ['design.', 'plan.save'] }).entries.map((e) => e.action)).toEqual(['design.pin'])
    expect(accounts.logs({ actions: ['match'] }).entries.map((e) => e.who)).toEqual(['lee@example.com'])
    expect(accounts.logs({ q: '확률' }).total).toBe(1)
    accounts.setName(kim.id, '김민지')
    expect(accounts.logs({ actions: ['auth.'] }).entries[0].name).toBe('김민지')
  })

  it('기록은 종류와 이메일·대상으로 거른다', () => {
    const store = new Store(':memory:')
    const accounts = new Accounts(store.db)
    const boss = accounts.create({ sub: 'b', email: 'boss@example.com' }, { role: 'owner' })
    accounts.activity(accounts.create({ sub: 'k', email: 'kim@example.com' }), 'curriculum.read', '반송고등학교 2026', '읽어서 공유 #1')
    accounts.activity(accounts.create({ sub: 'l', email: 'lee@example.com' }), 'auth.login')
    accounts.log(boss, 'curriculum.verify', '반송고등학교 2026 #1')
    expect(accounts.logs({ kind: 'user' }).total).toBe(2)
    expect(accounts.logs({ kind: 'admin' }).entries.map((e) => e.who)).toEqual(['boss@example.com'])
    expect(accounts.logs({ q: '반송고' }).entries.map((e) => e.action)).toEqual(['curriculum.verify', 'curriculum.read'])
    expect(accounts.logs({ q: 'lee@' }).entries.map((e) => e.who)).toEqual(['lee@example.com'])
    // 찾는 말의 %·_는 글자 그대로
    expect(accounts.logs({ q: '%' }).total).toBe(0)
  })
})
