import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { BANSONG_2026 } from '../src/data/schools/bansong2026'
import { safeNext } from './account-api'
import { Accounts, GONE_USER } from './accounts'
import { checkIdToken, GOOGLE_TOKEN_URL, GoogleAuthError } from './google-auth'
import { createApi } from './handler'
import { Store } from './store'
import { fakeIdToken } from './testing'
import { UserAiKeys } from './user-keys'

// 테스트용 값 (실제 Google 앱·계정 아님)
const CLIENT = { GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret-value' }
const OWNER = 'boss@example.com'
const ENV = { ...CLIENT, OWNER_EMAIL: OWNER }
const ORIGIN = 'http://app.test'
const STUDENT = { sub: '1000000000000000000001', email: 'student@example.com' }
const TEACHER = { sub: '1000000000000000000002', email: 'teacher@example.com' }
const BOSS = { sub: '1000000000000000000009', email: OWNER }

type Who = { sub: string; email: string; verified?: boolean; name?: string }

function setup(env: Record<string, string> = ENV) {
  const store = new Store(':memory:')
  // 가짜 Google 토큰 주소: 정해 둔 내용의 ID 토큰을 준다
  const google = { claims: {} as Record<string, unknown>, status: 200, requests: [] as URLSearchParams[] }
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== GOOGLE_TOKEN_URL) return new Response('no', { status: 404 })
    google.requests.push(new URLSearchParams(String(init?.body ?? '')))
    const body = google.status === 200 ? { id_token: fakeIdToken(google.claims), access_token: 'x', token_type: 'Bearer' } : { error: 'invalid_grant' }
    return new Response(JSON.stringify(body), { status: google.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const api = createApi({ store, fetch: fetchImpl })
  const call = (
    method: string,
    path: string,
    opts: { body?: unknown; cookie?: string; headers?: Record<string, string>; secure?: boolean; ip?: string } = {},
  ) =>
    api(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' ? { origin: ORIGIN } : {}),
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      }),
      { ip: opts.ip ?? '10.0.0.1', env, secure: opts.secure },
    )
  /** 응답이 심은 쿠키 하나를 요청 헤더 모양(이름=값)으로 */
  const cookieOf = (res: Response, name: string) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith(`${name}=`)) ?? ''
  const pre = (secure?: boolean) => (secure ? '__Host-' : '')

  /** Google 로그인: 시작 → (Google에서 who로 로그인) → 돌아옴 */
  const viaGoogle = async (who: Who, opts: { next?: string; claims?: Record<string, unknown>; secure?: boolean } = {}) => {
    const start = await call('GET', `/api/auth/google?next=${encodeURIComponent(opts.next ?? '/plan')}`, { secure: opts.secure })
    const loc = new URL(start.headers.get('location') ?? 'http://x/')
    const state = loc.searchParams.get('state') ?? ''
    const flow = cookieOf(start, `${pre(opts.secure)}gwamok_oauth`)
    const now = Math.floor(Date.now() / 1000)
    google.claims = {
      iss: 'https://accounts.google.com',
      aud: CLIENT.GOOGLE_CLIENT_ID,
      sub: who.sub,
      email: who.email,
      email_verified: who.verified ?? true,
      nonce: loc.searchParams.get('nonce'),
      iat: now,
      exp: now + 3600,
      ...opts.claims,
    }
    const back = await call('GET', `/api/auth/google/callback?state=${state}&code=4%2F0test-code-xyz`, { cookie: flow, secure: opts.secure })
    return { start, loc, state, flow, back }
  }

  /** 처음 온 사람: Google 로그인 → 가입 동의 → 세션 */
  const join = async (who: Who, opts: { secure?: boolean } = {}) => {
    const { back } = await viaGoogle(who, opts)
    const pending = cookieOf(back, `${pre(opts.secure)}gwamok_pending`)
    const res = await call('POST', '/api/auth/complete', {
      cookie: pending,
      body: { agreeAge: true, agreePrivacy: true, name: who.name ?? '김학생' },
      secure: opts.secure,
    })
    return { res, cookie: cookieOf(res, `${pre(opts.secure)}gwamok_sid`) }
  }

  /** 이미 가입한 사람의 로그인 */
  const login = async (who: Who) => {
    const { back } = await viaGoogle(who)
    return { back, cookie: cookieOf(back, 'gwamok_sid') }
  }

  const me = async (cookie: string) => (await (await call('GET', '/api/auth/me', { cookie })).json()).user
  return { store, call, google, cookieOf, viaGoogle, join, login, me }
}

describe('Google 로그인', () => {
  it('처음 로그인하면 동의 화면으로 보내고, 동의해야 가입된다', async () => {
    const t = setup()
    const { start, loc, back } = await t.viaGoogle(STUDENT)
    // Google 계정 고르는 화면으로: 이메일만 묻고, PKCE·state·nonce를 붙인다
    expect(start.status).toBe(302)
    expect(`${loc.origin}${loc.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(loc.searchParams.get('client_id')).toBe(CLIENT.GOOGLE_CLIENT_ID)
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`)
    expect(loc.searchParams.get('scope')).toBe('openid email')
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256')
    expect(start.headers.getSetCookie()[0]).toMatch(/^gwamok_oauth=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600$/)
    // 토큰 주소에는 PKCE verifier와 같은 돌아올 주소를 보낸다
    const sent = t.google.requests[0]
    expect(sent.get('code')).toBe('4/0test-code-xyz')
    expect(sent.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`)
    expect(createHash('sha256').update(sent.get('code_verifier')!).digest('base64url')).toBe(loc.searchParams.get('code_challenge'))
    // 아직 계정이 없으니 동의 화면으로 (로그인 쿠키 없이)
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/signup?next=%2Fplan')
    expect(t.cookieOf(back, 'gwamok_sid')).toBe('')
    const pending = t.cookieOf(back, 'gwamok_pending')
    expect((await (await t.call('GET', '/api/auth/pending', { cookie: pending })).json()).pending).toEqual({ email: STUDENT.email, next: '/plan' })

    const refused = await t.call('POST', '/api/auth/complete', { cookie: pending, body: { agreeAge: true, name: '김학생' } })
    expect(refused.status).toBe(400)
    // 실명을 적어야 가입된다 (빈칸·숫자·자음만은 안 된다)
    for (const name of [undefined, '', ' 김 ', '홍길동1', 'ㅇㅇ', 'admin@x']) {
      const res = await t.call('POST', '/api/auth/complete', { cookie: pending, body: { agreeAge: true, agreePrivacy: true, name } })
      expect(res.status, String(name)).toBe(400)
      expect((await res.json()).error).toBe('이름은 실명으로 2~30자, 글자로만 적어 주세요.')
    }
    const done = await t.call('POST', '/api/auth/complete', { cookie: pending, body: { agreeAge: true, agreePrivacy: true, name: '  김  학생 ' } })
    expect(done.status).toBe(201)
    const body = await done.json()
    expect(body.next).toBe('/plan')
    expect(body.user).toMatchObject({ email: STUDENT.email, name: '김 학생', role: 'user' })
    const sid = t.cookieOf(done, 'gwamok_sid')
    expect(sid).toMatch(/^gwamok_sid=[\w-]{43}$/)
    // Google 고유 번호는 화면에 보내지 않는다
    expect(JSON.stringify(await t.me(sid))).not.toContain(STUDENT.sub)
    // 동의 대기는 한 번만 쓴다
    expect((await (await t.call('GET', '/api/auth/pending', { cookie: pending })).json()).pending).toBeNull()
  })

  it('가입한 계정은 바로 로그인하고, Google 이메일이 바뀌면 맞춘다', async () => {
    const t = setup()
    await t.join(STUDENT)
    const { back, cookie } = await t.login({ ...STUDENT, email: 'renamed@example.com' })
    expect(back.headers.get('location')).toBe('/plan')
    expect(await t.me(cookie)).toMatchObject({ email: 'renamed@example.com', role: 'user' })
  })

  it('이 브라우저에서 시작하지 않았거나 한 번 쓴 state면 막는다 (Google에 묻지도 않는다)', async () => {
    const t = setup()
    const { start, state } = await t.viaGoogle(STUDENT)
    const flow = t.cookieOf(start, 'gwamok_oauth')
    // 한 번 쓴 state
    const again = await t.call('GET', `/api/auth/google/callback?state=${state}&code=4%2F0test-code-xyz`, { cookie: flow })
    expect(again.headers.get('location')).toBe('/login?error=expired')
    // 쿠키 없이, 또는 다른 state의 쿠키로
    const fresh = await t.call('GET', '/api/auth/google?next=%2F')
    const freshState = new URL(fresh.headers.get('location')!).searchParams.get('state')
    expect((await t.call('GET', `/api/auth/google/callback?state=${freshState}&code=4%2F0test-code-xyz`)).headers.get('location')).toBe('/login?error=expired')
    expect((await t.call('GET', `/api/auth/google/callback?state=${freshState}&code=4%2F0test-code-xyz`, { cookie: flow })).headers.get('location')).toBe(
      '/login?error=expired',
    )
    expect(t.google.requests).toHaveLength(1)
  })

  it('Google에서 취소하거나 토큰을 못 받으면 로그인 화면으로 돌려보낸다', async () => {
    const t = setup()
    const start = await t.call('GET', '/api/auth/google')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')
    const cancelled = await t.call('GET', `/api/auth/google/callback?state=${state}&error=access_denied`, { cookie: t.cookieOf(start, 'gwamok_oauth') })
    expect(cancelled.headers.get('location')).toBe('/login?error=cancelled')
    t.google.status = 400
    const { back } = await t.viaGoogle(STUDENT)
    expect(back.headers.get('location')).toBe('/login?error=failed')
  })

  it('ID 토큰: 우리 앱·Google·이번 로그인·유효 시간·확인된 이메일만 받는다', () => {
    const now = Date.now()
    const base = {
      iss: 'https://accounts.google.com',
      aud: CLIENT.GOOGLE_CLIENT_ID,
      sub: STUDENT.sub,
      email: 'Student@Example.com',
      email_verified: true,
      nonce: 'n-1',
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
    }
    const check = (extra: Record<string, unknown>) => checkIdToken(fakeIdToken({ ...base, ...extra }), CLIENT.GOOGLE_CLIENT_ID, 'n-1', now)
    expect(check({})).toEqual({ sub: STUDENT.sub, email: 'student@example.com' })
    expect(() => check({ aud: 'other-app' })).toThrow(GoogleAuthError)
    expect(() => check({ aud: [CLIENT.GOOGLE_CLIENT_ID, 'x'] })).toThrow(/aud/)
    expect(check({ aud: [CLIENT.GOOGLE_CLIENT_ID, 'x'], azp: CLIENT.GOOGLE_CLIENT_ID }).sub).toBe(STUDENT.sub)
    expect(() => check({ iss: 'https://evil.example' })).toThrow(/iss/)
    expect(() => check({ nonce: 'n-2' })).toThrow(/nonce/)
    expect(() => check({ exp: Math.floor(now / 1000) - 120 })).toThrow(/expired/)
    expect(() => check({ email_verified: false })).toThrow(/email/)
    expect(() => check({ email: undefined })).toThrow(/email/)
    expect(() => checkIdToken('not-a-jwt', CLIENT.GOOGLE_CLIENT_ID, 'n-1', now)).toThrow(GoogleAuthError)
  })

  it('이메일을 확인하지 않은 Google 계정은 가입시키지 않는다', async () => {
    const t = setup()
    const { back } = await t.viaGoogle({ ...STUDENT, verified: false })
    expect(back.headers.get('location')).toBe('/login?error=failed')
  })

  it('돌아갈 주소는 이 사이트 안 화면만', async () => {
    expect(safeNext('/plan?step=1')).toBe('/plan?step=1')
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', '/api/auth/delete', 'plan', '', null]) expect(safeNext(bad)).toBe('/')
    const t = setup()
    const { back } = await t.viaGoogle(STUDENT, { next: '//evil.example/x' })
    expect(back.headers.get('location')).toBe('/signup?next=%2F')
  })

  it('가입을 막아 두면 새 계정은 못 만든다 (대표 관리자는 예외)', async () => {
    const t = setup()
    const boss = await t.join(BOSS)
    await t.call('POST', '/api/admin/settings', { cookie: boss.cookie, body: { values: { signupOpen: false } } })
    const { back } = await t.viaGoogle(STUDENT)
    expect(back.headers.get('location')).toBe('/login?error=closed')
    expect((await (await t.call('GET', '/api/health')).json()).signup).toBe(false)
  })

  it('정지된 계정은 로그인하지 못하고, 세션도 바로 끊긴다', async () => {
    const t = setup()
    const boss = await t.join(BOSS)
    const student = await t.join(STUDENT)
    const id = (await t.me(student.cookie)).id
    await t.call('POST', '/api/admin/users/update', { cookie: boss.cookie, body: { id, disabled: true } })
    expect(await t.me(student.cookie)).toBeNull()
    expect((await t.login(STUDENT)).back.headers.get('location')).toBe('/login?error=disabled')
  })

  it('HTTPS면 쿠키에 __Host-와 Secure를 붙이고, 돌아올 주소도 https로', async () => {
    const t = setup()
    const { loc } = await t.viaGoogle(STUDENT, { secure: true })
    expect(loc.searchParams.get('redirect_uri')).toBe('https://app.test/api/auth/google/callback')
    const { res } = await t.join(TEACHER, { secure: true })
    const set = res.headers.getSetCookie().find((c) => c.startsWith('__Host-gwamok_sid='))!
    expect(set).toContain('Secure')
    expect(set).toContain('Path=/')
  })

  it('PUBLIC_URL이 있으면 돌아올 주소를 그것으로 만든다', async () => {
    const t = setup({ ...ENV, PUBLIC_URL: 'https://gwamok.example.kr/' })
    const { loc } = await t.viaGoogle(STUDENT)
    expect(loc.searchParams.get('redirect_uri')).toBe('https://gwamok.example.kr/api/auth/google/callback')
  })

  it('Google 앱 키가 없으면 로그인을 끈다', async () => {
    const t = setup({ OWNER_EMAIL: OWNER })
    expect((await (await t.call('GET', '/api/health')).json()).login).toBe(false)
    expect((await t.call('GET', '/api/auth/google')).headers.get('location')).toBe('/login?error=unavailable')
    expect((await (await setup().call('GET', '/api/health')).json()).login).toBe(true)
  })

  it('로그아웃하면 그 세션은 더 못 쓴다', async () => {
    const t = setup()
    const { cookie } = await t.join(STUDENT)
    const out = await t.call('POST', '/api/auth/logout', { cookie })
    expect(out.headers.getSetCookie()[0]).toContain('Max-Age=0')
    expect(await t.me(cookie)).toBeNull()
  })

  it('탈퇴하면 계정과 저장한 설계가 지워지고, 대표 관리자는 탈퇴할 수 없다', async () => {
    const t = setup()
    const { cookie } = await t.join(STUDENT)
    await t.call('POST', '/api/me/data', { cookie, body: { data: { prefs: {}, schools: [] } } })
    expect((await t.call('POST', '/api/auth/delete', { cookie, body: {} })).status).toBe(400)
    expect((await t.call('POST', '/api/auth/delete', { cookie, body: { confirm: true } })).status).toBe(200)
    // 다시 오면 새로 가입해야 한다
    expect((await t.viaGoogle(STUDENT)).back.headers.get('location')).toBe('/signup?next=%2Fplan')
    const boss = await t.join(BOSS)
    expect((await t.call('POST', '/api/auth/delete', { cookie: boss.cookie, body: { confirm: true } })).status).toBe(409)
  })

  it('다른 사이트에서 보낸 요청은 막는다', async () => {
    const t = setup()
    const { back } = await t.viaGoogle(STUDENT)
    const pending = t.cookieOf(back, 'gwamok_pending')
    const body = { agreeAge: true, agreePrivacy: true }
    expect((await t.call('POST', '/api/auth/complete', { cookie: pending, body, headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await t.call('POST', '/api/auth/complete', { cookie: pending, body, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
  })

  it('아이디·비밀번호 시절의 계정 표는 옆으로 옮기고 그 세션은 끊는다', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      create table users (id integer primary key, username text not null unique, password text not null, role text not null default 'user',
        disabled integer not null default 0, must_change integer not null default 0, created_at text not null, last_login_at text);
      create table sessions (id text primary key, user_id integer not null, created_at text not null, expires_at text not null, last_seen_at text not null);
      create table user_data (user_id integer primary key, data text not null, updated_at text not null);
      insert into users (username, password, role, created_at) values ('admin', 'scrypt$x', 'admin', '2026-10-01');
      insert into sessions values ('s', 1, '2026-10-01', '2099-01-01', '2026-10-01');
      insert into user_data values (1, '{"prefs":{}}', '2026-10-01');
    `)
    const accounts = new Accounts(db)
    const tables = (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name)
    expect(tables).toEqual(expect.arrayContaining(['users', 'users_password_legacy', 'user_data', 'user_data_password_legacy']))
    expect((db.prepare('select count(*) n from sessions').get() as { n: number }).n).toBe(0)
    // 새 계정이 1번이 돼도 예전 계정의 설계를 넘겨받지 않는다
    const u = accounts.create({ sub: 'g-1', email: 'new@example.com' })
    expect(u.id).toBe(1)
    expect(accounts.getData(u.id)).toBeNull()
    // 다시 열어도 옮기지 않는다
    expect(() => new Accounts(db)).not.toThrow()
  })
})

describe('계정에 설계 저장', () => {
  it('로그인해야 쓰고, 저장한 것을 그대로 돌려준다', async () => {
    const t = setup()
    expect((await t.call('GET', '/api/me/data')).status).toBe(401)
    const { cookie } = await t.join(STUDENT)
    expect((await (await t.call('GET', '/api/me/data', { cookie })).json()).saved).toBeNull()
    const data = { prefs: { majors: ['cs'], schoolId: 'x' }, schools: [{ id: 'x', name: '가나고' }] }
    const put = await t.call('POST', '/api/me/data', { cookie, body: { data } })
    expect(put.status).toBe(200)
    const got = await (await t.call('GET', '/api/me/data', { cookie })).json()
    expect(got.saved.data).toEqual({ ...data, plans: [] })
  })

  it('모양이 틀리거나 너무 크면 받지 않는다', async () => {
    const t = setup()
    const { cookie } = await t.join(STUDENT)
    expect((await t.call('POST', '/api/me/data', { cookie, body: { data: [] } })).status).toBe(400)
    expect((await t.call('POST', '/api/me/data', { cookie, body: { data: { prefs: {}, schools: Array(21).fill({}) } } })).status).toBe(400)
    const big = { prefs: {}, schools: [{ notes: ['x'.repeat(500_000)] }] }
    expect((await t.call('POST', '/api/me/data', { cookie, body: { data: big } })).status).toBe(413)
  })
})

describe('관리자', () => {
  it('OWNER_EMAIL 계정은 가입하면 대표 관리자, 일반 사용자와 비로그인은 관리 API를 못 쓴다', async () => {
    const t = setup()
    const boss = await t.join(BOSS)
    expect((await boss.res.json()).user.role).toBe('owner')
    expect((await t.call('GET', '/api/admin/overview')).status).toBe(401)
    const student = await t.join(STUDENT)
    expect((await t.call('GET', '/api/admin/overview', { cookie: student.cookie })).status).toBe(403)
    const ov = await (await t.call('GET', '/api/admin/overview', { cookie: boss.cookie })).json()
    expect(ov.users.total).toBe(2)
    expect(ov.users.admins).toBe(1)
  })

  it('관리자 지정·취소는 대표 관리자만, 지정된 관리자는 관리자를 줄 수 없다', async () => {
    const t = setup()
    const boss = await t.join(BOSS)
    const teacher = await t.join(TEACHER)
    const student = await t.join(STUDENT)
    const teacherId = (await t.me(teacher.cookie)).id
    const studentId = (await t.me(student.cookie)).id
    const bossId = (await t.me(boss.cookie)).id

    expect((await t.call('POST', '/api/admin/users/role', { cookie: boss.cookie, body: { id: teacherId, role: 'admin' } })).status).toBe(200)
    expect((await t.me(teacher.cookie)).role).toBe('admin')
    expect((await t.call('GET', '/api/admin/overview', { cookie: teacher.cookie })).status).toBe(200)
    // 지정된 관리자: 관리자 지정·취소, 대표 관리자 바꾸기는 막힌다
    expect((await t.call('POST', '/api/admin/users/role', { cookie: teacher.cookie, body: { id: studentId, role: 'admin' } })).status).toBe(403)
    expect((await t.call('POST', '/api/admin/users/update', { cookie: teacher.cookie, body: { id: bossId, disabled: true } })).status).toBe(403)
    expect((await t.call('POST', '/api/admin/users/delete', { cookie: teacher.cookie, body: { id: bossId } })).status).toBe(403)
    // 대표 관리자는 누구도 못 바꾼다 (OWNER_EMAIL로 정한다), 'owner'는 줄 수 없다
    expect((await t.call('POST', '/api/admin/users/role', { cookie: boss.cookie, body: { id: studentId, role: 'owner' } })).status).toBe(400)
    // 지정된 관리자도 일반 사용자는 정지할 수 있다
    expect((await t.call('POST', '/api/admin/users/update', { cookie: teacher.cookie, body: { id: studentId, disabled: true } })).status).toBe(200)

    expect((await t.call('POST', '/api/admin/users/role', { cookie: boss.cookie, body: { id: teacherId, role: 'user' } })).status).toBe(200)
    expect((await t.call('GET', '/api/admin/overview', { cookie: teacher.cookie })).status).toBe(403)
    const log = await (await t.call('GET', '/api/admin/log?kind=admin', { cookie: boss.cookie })).json()
    expect(log.entries.map((e: { action: string; who: string }) => `${e.action}:${e.who}`)).toEqual([
      `user.revoke:${OWNER}`,
      `user.disable:${TEACHER.email}`,
      `user.grant:${OWNER}`,
    ])
  })

  it('관리자 계정을 정지·삭제하는 것은 대표 관리자만, 내 계정은 관리 화면에서 못 바꾼다', async () => {
    const t = setup()
    const boss = await t.join(BOSS)
    const a = await t.join(TEACHER)
    const b = await t.join({ sub: '1000000000000000000003', email: 'other@example.com' })
    const ids = { boss: (await t.me(boss.cookie)).id, a: (await t.me(a.cookie)).id, b: (await t.me(b.cookie)).id }
    for (const id of [ids.a, ids.b]) await t.call('POST', '/api/admin/users/role', { cookie: boss.cookie, body: { id, role: 'admin' } })
    expect((await t.call('POST', '/api/admin/users/update', { cookie: a.cookie, body: { id: ids.b, disabled: true } })).status).toBe(403)
    expect((await t.call('POST', '/api/admin/users/delete', { cookie: a.cookie, body: { id: ids.b } })).status).toBe(403)
    expect((await t.call('POST', '/api/admin/users/role', { cookie: boss.cookie, body: { id: ids.boss, role: 'user' } })).status).toBe(400)
    expect((await t.call('POST', '/api/admin/users/delete', { cookie: boss.cookie, body: { id: ids.b } })).status).toBe(200)
    const list = await (await t.call('GET', '/api/admin/users?q=teacher', { cookie: boss.cookie })).json()
    expect(list.users.map((u: { email: string; role: string }) => `${u.email}:${u.role}`)).toEqual([`${TEACHER.email}:admin`])
    const admins = await (await t.call('GET', '/api/admin/users?role=admin', { cookie: boss.cookie })).json()
    expect(admins.users.map((u: { role: string }) => u.role).sort()).toEqual(['admin', 'owner'])
  })

  it('OWNER_EMAIL을 바꾸면 새 계정이 대표가 되고 예전 대표는 지정된 관리자로 남는다', () => {
    const accounts = new Accounts(new Store(':memory:').db)
    const old = accounts.create({ sub: 'g-1', email: 'old@example.com' }, { role: 'owner' })
    const next = accounts.create({ sub: 'g-2', email: 'new@example.com' })
    accounts.setDisabled(next.id, true)
    accounts.syncOwner('New@Example.com')
    expect(accounts.byId(old.id)?.role).toBe('admin')
    // 대표 관리자는 정지돼 있어도 풀린다 (스스로 잠기지 않게)
    expect(accounts.byId(next.id)).toMatchObject({ role: 'owner', disabled: false })
  })

  it('설정: 틀린 값은 하나도 저장하지 않고, 바꾼 값은 공개 정보에 바로 반영된다', async () => {
    const t = setup()
    const { cookie } = await t.join(BOSS)
    const bad = await t.call('POST', '/api/admin/settings', { cookie, body: { values: { notice: '점검 안내', dailyReadLimit: -5 } } })
    expect(bad.status).toBe(400)
    expect((await (await t.call('GET', '/api/health')).json()).notice).toBe('')
    const ok = await (
      await t.call('POST', '/api/admin/settings', { cookie, body: { values: { notice: '  오늘 밤\n점검해요 ', signupOpen: false, dailyReadLimit: 50 } } })
    ).json()
    expect(ok.changed.sort()).toEqual(['dailyReadLimit', 'notice', 'signupOpen'])
    const health = await (await t.call('GET', '/api/health')).json()
    expect(health.notice).toBe('오늘 밤 점검해요')
    expect(health.signup).toBe(false)
    expect((await t.call('POST', '/api/admin/settings', { cookie, body: { values: { nope: 1 } } })).status).toBe(400)
  })

  it('로그인 없이 자동 읽기를 끄면 비로그인 읽기는 막힌다', async () => {
    const t = setup({ ...ENV, AI_BASE_URL: 'https://ai.example.com/v1', AI_API_KEY: 'k', AI_MODEL: 'm' })
    const { cookie } = await t.join(BOSS)
    await t.call('POST', '/api/admin/settings', { cookie, body: { values: { anonymousRead: false } } })
    const res = await t.call('POST', '/api/curriculum/read', { body: { office: 'J10', code: '7530847', cohort: 2026, url: 'https://x' } })
    expect(res.status).toBe(401)
  })

  it('공유 편제표: 숨기기·확인 표시·고친 판 저장, 신고 처리', async () => {
    const t = setup()
    const { cookie } = await t.join(BOSS)
    const row = t.store.insert({
      office: 'J10',
      code: '7530847',
      cohort: 2027,
      track: '',
      schoolName: '반송고등학교',
      region: '경기',
      data: { ...BANSONG_2026, id: 'neis-J10-7530847-2027', cohort: 2027 },
      sourceUrl: 'https://example.com/a.pdf',
      pageUrl: 'https://example.com/post',
      sourceTitle: '편제표',
      method: 'school-site',
      model: 'm',
    })
    t.store.report(row.id, '2학년 과목이 틀려요')
    const list = await (await t.call('GET', '/api/admin/curricula?status=reported', { cookie })).json()
    expect(list.items.map((i: { id: number }) => i.id)).toEqual([row.id])

    await t.call('POST', '/api/admin/curricula/update', { cookie, body: { id: row.id, verified: true } })
    expect(t.store.byId(row.id)?.verified).toBe(true)

    const edited = await (
      await t.call('POST', '/api/admin/curricula/edit', { cookie, body: { id: row.id, data: { terms: BANSONG_2026.terms, tracks: [] } } })
    ).json()
    expect(edited.item.method).toBe('manual')
    expect(t.store.byId(row.id)?.hidden).toBe(true)
    // 이제 이 학교 2027은 고친 판을 준다
    expect(t.store.latest('J10', '7530847', 2027)?.id).toBe(edited.item.id)

    const reports = await (await t.call('GET', '/api/admin/reports', { cookie })).json()
    expect(reports.items[0].reason).toBe('2학년 과목이 틀려요')
    await t.call('POST', '/api/admin/reports/update', { cookie, body: { id: reports.items[0].id, resolved: true } })
    expect((await (await t.call('GET', '/api/admin/reports', { cookie })).json()).total).toBe(0)
  })
})

describe('이용 기록 (가입·로그인·탈퇴)', () => {
  it('가입·로그인·로그아웃·설계 저장을 남기고, 탈퇴하면 누가 했는지 알 수 없게 바꾼다', async () => {
    const t = setup()
    const boss = await t.join(BOSS)
    const first = await t.join(STUDENT)
    await t.call('POST', '/api/auth/logout', { cookie: first.cookie })
    const again = await t.login(STUDENT)
    const saved = await t.call('POST', '/api/me/data', { cookie: again.cookie, body: { data: { prefs: { majors: ['cs-software'] }, schools: [], plans: [] } } })
    expect(saved.status).toBe(200)
    const userLog = async (q = '') =>
      (await (await t.call('GET', `/api/admin/log?kind=user${q}`, { cookie: boss.cookie })).json()).entries as { who: string; action: string }[]
    expect((await userLog(`&q=${encodeURIComponent(STUDENT.email)}`)).map((e) => e.action)).toEqual(['plan.save', 'auth.login', 'auth.logout', 'auth.signup'])

    expect((await t.call('POST', '/api/auth/delete', { cookie: again.cookie, body: { confirm: true } })).status).toBe(200)
    const after = await userLog()
    expect(after.filter((e) => e.who === GONE_USER).map((e) => e.action)).toEqual(['auth.delete', 'plan.save', 'auth.login', 'auth.logout', 'auth.signup'])
    expect(JSON.stringify(after)).not.toContain(STUDENT.email)
    // 다른 사람의 기록은 그대로
    expect(after.filter((e) => e.who === OWNER).map((e) => e.action)).toEqual(['auth.signup'])
  })

  it('관리자가 지운 계정도 누가 했는지 지운다 (관리자가 지운 사실은 관리자 기록에 남는다)', async () => {
    const t = setup()
    const boss = await t.join(BOSS)
    const student = await t.join(STUDENT)
    const id = (await t.me(student.cookie)).id
    expect((await t.call('POST', '/api/admin/users/delete', { cookie: boss.cookie, body: { id } })).status).toBe(200)
    const log = (await (await t.call('GET', '/api/admin/log', { cookie: boss.cookie })).json()).entries as {
      kind: string
      who: string
      action: string
      target: string
    }[]
    expect(log.find((e) => e.kind === 'user' && e.action === 'auth.signup' && e.who === GONE_USER)).toBeTruthy()
    expect(log.find((e) => e.kind === 'admin' && e.action === 'user.delete')?.target).toBe(STUDENT.email)
  })
})

describe('지운 계정과 겹치는 일', () => {
  it('지운 계정의 번호는 다시 쓰지 않고, 주인 없는 설계·키·세션은 지운다', () => {
    const db = new DatabaseSync(':memory:')
    // 예전 표: autoincrement 없이 만들어 가장 큰 번호를 다시 쓰던 표. 3번은 지워졌는데 늦게 들어온 저장이 설계·키를 남겼다
    db.exec(`
      create table users (id integer primary key, google_sub text not null unique, email text not null default '', name text not null default '',
        role text not null default 'user', disabled integer not null default 0, created_at text not null, last_login_at text);
      create table user_data (user_id integer primary key, data text not null, updated_at text not null);
      create table user_ai_keys (user_id integer primary key, key_enc text not null, key_hint text not null, created_at text not null);
      insert into users (id, google_sub, email, created_at) values (1, 'a', 'a@example.com', '2026-10-01'), (2, 'b', 'b@example.com', '2026-10-01');
      insert into user_data values (2, '{"prefs":{}}', '2026-10-01'), (3, '{"prefs":{"secret":1}}', '2026-10-02');
      insert into user_ai_keys values (3, 'enc', 'abcd', '2026-10-02');
    `)
    const accounts = new Accounts(db)
    expect(db.prepare('select user_id from user_data order by user_id').all()).toEqual([{ user_id: 2 }])
    expect(db.prepare('select count(*) n from user_ai_keys').get()).toEqual({ n: 0 })
    expect((db.prepare("select sql from sqlite_master where name = 'users'").get() as { sql: string }).sql).toMatch(/autoincrement/i)
    expect(accounts.byId(2)?.email).toBe('b@example.com')
    accounts.remove(2)
    const next = accounts.create({ sub: 'c', email: 'c@example.com' })
    expect(next.id).toBe(3)
    expect(accounts.getData(next.id)).toBeNull()
    // 다시 열어도 그대로
    expect(new Accounts(db).create({ sub: 'd', email: 'd@example.com' }).id).toBe(4)
  })

  it('탈퇴와 겹쳐 늦게 끝난 저장은 남지 않고, 다음 가입자는 아무것도 물려받지 않는다', async () => {
    const t = setup()
    await t.join(STUDENT)
    const accounts = new Accounts(t.store.db)
    const gone = accounts.bySub(STUDENT.sub)!
    const keys = new UserAiKeys(t.store.db, Buffer.alloc(32, 7))
    keys.save(gone.id, 'AIzaFakeGoodKey-0123456789abcdefghijkl')
    accounts.remove(gone.id)
    expect(keys.count()).toBe(0)
    expect(accounts.putData(gone.id, '{"prefs":{"schoolId":"x"},"schools":[]}')).toBeNull()
    expect(keys.save(gone.id, 'AIzaFakeGoodKey-0123456789abcdefghijkl')).toBeNull()
    accounts.activity(gone, 'design.pin', '설계', '+ 물리학')
    expect(accounts.logs({ q: STUDENT.email }).total).toBe(0)
    const next = await t.join(TEACHER)
    const me = await t.me(next.cookie)
    expect(me.id).not.toBe(gone.id)
    expect(me.aiKey).toBeNull()
    expect((await (await t.call('GET', '/api/me/data', { cookie: next.cookie })).json()).saved).toBeNull()
  })

  it('돌아갈 주소의 우회를 풀고 한글은 %로 바꿔, 로그인이 오류 없이 돌아간다', async () => {
    expect(safeNext('/한글')).toBe('/%ED%95%9C%EA%B8%80')
    expect(safeNext('/universities?q=서울')).toBe('/universities?q=%EC%84%9C%EC%9A%B8')
    for (const bad of ['/./api/auth/delete', '/.//evil.example', '/API/x', '/a/../api/x', '/api']) expect(safeNext(bad), bad).toBe('/')
    const t = setup()
    await t.join(STUDENT)
    const { back } = await t.viaGoogle(STUDENT, { next: '/한글' })
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/%ED%95%9C%EA%B8%80')
  })

  it('쿠키 없는 가입·로그인 요청은 같은 IP의 요청 수를 쓰지 않는다', async () => {
    const t = setup()
    const body = { agreeAge: true, agreePrivacy: true, name: '김학생' }
    for (let i = 0; i < 12; i++) expect((await t.call('POST', '/api/auth/complete', { body })).status).toBe(400)
    for (let i = 0; i < 31; i++)
      expect((await t.call('GET', '/api/auth/google/callback?state=junk-state&code=x')).headers.get('location')).toBe('/login?error=expired')
    expect((await t.join(STUDENT)).res.status).toBe(201)
  })
})

describe('설계 저장이 겹칠 때', () => {
  it('다른 곳에서 먼저 저장했으면 덮어쓰지 않고 지금 계정의 설계를 돌려준다', async () => {
    const t = setup()
    const { cookie } = await t.join(STUDENT)
    const save = (data: unknown, base?: unknown) => t.call('POST', '/api/me/data', { cookie, body: base === undefined ? { data } : { data, base } })
    const a = { prefs: { majors: ['cs'] }, schools: [] }
    const first = await save(a, null)
    expect(first.status).toBe(200)
    const v1 = (await first.json()).updatedAt
    // 계정에 없다고 알고 보낸 저장, 예전 판을 바탕으로 한 저장은 막는다
    const stale = await save({ prefs: {}, schools: [] }, null)
    expect(stale.status).toBe(409)
    expect((await stale.json()).saved).toEqual({ data: { ...a, plans: [] }, updatedAt: v1 })
    expect((await save(a, '2020-01-01T00:00:00.000Z')).status).toBe(409)
    // 마지막 판을 바탕으로 하면 저장되고 판이 바뀐다. base를 보내지 않는 예전 화면은 그대로 덮어쓴다
    const second = await save({ prefs: { majors: ['ai'] }, schools: [] }, v1)
    expect(second.status).toBe(200)
    expect((await second.json()).updatedAt > v1).toBe(true)
    expect((await save(a)).status).toBe(200)
    expect((await save(a, 3)).status).toBe(400)
  })

  it('설계의 목록이 터무니없이 길면 받지 않는다', async () => {
    const t = setup()
    const { cookie } = await t.join(STUDENT)
    const save = (prefs: unknown) => t.call('POST', '/api/me/data', { cookie, body: { data: { prefs, schools: [] } } })
    expect((await save({ picks: Array(301).fill('korea:x') })).status).toBe(400)
    expect((await save({ majors: 'cs' })).status).toBe(400)
    expect((await save([])).status).toBe(400)
    expect((await save({ picks: Array(300).fill('korea:x') })).status).toBe(200)
  })

  it('한 번에 많이 바꾸면 기록은 몇 줄만 남기고 나머지는 한 줄로 모은다', async () => {
    const t = setup()
    const { cookie } = await t.join(STUDENT)
    const save = (plans: unknown[]) => t.call('POST', '/api/me/data', { cookie, body: { data: { prefs: { majors: ['cs'] }, schools: [], plans } } })
    await save([])
    const accounts = new Accounts(t.store.db)
    const before = accounts.logs({ kind: 'user' }).total
    await save(Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `슬롯 ${i}` })))
    const rows = accounts.logs({ kind: 'user' }).entries.slice(0, accounts.logs({ kind: 'user' }).total - before)
    expect(rows.filter((r) => r.action === 'design.slot')).toHaveLength(8)
    expect(rows[0]).toMatchObject({ action: 'plan.save', target: '설계', detail: '한꺼번에 많이 바꿔 자세한 줄은 줄임' })
  })
})
