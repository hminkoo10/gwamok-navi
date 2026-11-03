import { describe, expect, it } from 'vitest'
import { GEMINI_URL } from './ai-providers'
import { AiError } from './ai-types'
import { Accounts } from './accounts'
import { createApi } from './handler'
import { Store } from './store'
import { sessionFor } from './testing'
import { cleanUserKey, ownKeyError, userGeminiConfig } from './user-keys'

// 테스트용 가짜 키 (실제 키 아님)
const GOOD = 'AIzaFakeGoodKey-0123456789abcdefghijkl'
const BAD = 'AIzaFakeBadKey-00000000000000000000000'
const ORIGIN = 'http://app.test'
const ENV = { AI_BASE_URL: 'https://server-ai.example.com/v1', AI_API_KEY: 'sk-server-secret', AI_MODEL: 'server-model' }

/** 가짜 AI: 서버 키·사용자 키 요청을 모두 받아 적고, 맞지 않는 키·한도·혼잡을 흉내 낸다 */
function fakeAi() {
  const calls: { url: string; auth: string; model: string }[] = []
  const state = { mode: 'ok' as 'ok' | 'quota' | 'busy' }
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const auth = new Headers(init?.headers).get('authorization') ?? ''
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
    calls.push({ url, auth, model: body.model ?? '' })
    if (auth === `Bearer ${BAD}`)
      return Response.json([{ error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } }], { status: 400 })
    if (url.startsWith(GEMINI_URL) && state.mode === 'quota') return Response.json([{ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }], { status: 429 })
    if (url.startsWith(GEMINI_URL) && state.mode === 'busy') return Response.json([{ error: { code: 503, status: 'UNAVAILABLE' } }], { status: 503 })
    return Response.json({ choices: [{ message: { content: '{"majors":[{"id":"cs-software","why":"게임"}]}' } }] })
  }) as typeof fetch
  return { impl, calls, state }
}

function setup() {
  const store = new Store(':memory:')
  const ai = fakeAi()
  const api = createApi({ store, fetch: ai.impl })
  const call = (method: string, path: string, opts: { body?: unknown; cookie?: string } = {}) =>
    api(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' ? { origin: ORIGIN } : {}),
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      }),
      { ip: '10.0.0.1', env: ENV },
    )
  const boss = sessionFor(store, { email: 'boss@example.com', role: 'owner' })
  const student = sessionFor(store, { email: 'student@example.com' })
  const setting = async (values: Record<string, unknown>) => call('POST', '/api/admin/settings', { cookie: boss, body: { values } })
  let n = 0
  /** 문장으로 찾기 (같은 문장은 캐시에서 답하므로 매번 다른 문장) */
  const match = (cookie = student) => call('POST', '/api/match', { cookie, body: { text: `게임을 만들고 싶어요 ${++n}` } })
  return { store, ai, call, boss, student, setting, match }
}

describe('사용자 Gemini API 키', () => {
  it('기본은 꺼져 있어 서버 AI를 쓰고, 켜면 키가 없는 사람은 AI 기능 대신 등록 안내(428)를 받는다', async () => {
    const t = setup()
    expect(await (await t.call('GET', '/api/health')).json()).toMatchObject({ userKey: false, match: true })
    expect((await t.match()).status).toBe(200)
    expect(t.ai.calls[0]).toMatchObject({ url: 'https://server-ai.example.com/v1/chat/completions', auth: 'Bearer sk-server-secret' })

    expect((await t.setting({ userAiKey: true })).status).toBe(200)
    expect(await (await t.call('GET', '/api/health')).json()).toMatchObject({ userKey: true, match: true, read: true, import: true, aiTraining: true })
    const res = await t.match()
    expect(res.status).toBe(428)
    expect((await res.json()).error).toBe('문장으로 찾기는 내 Gemini API 키로 해요. 내 계정에서 키를 등록해 주세요.')
    const imp = await t.call('POST', '/api/import', { cookie: t.student, body: { text: '2-1 대수 4 문학 4 영어Ⅰ 4', cohort: 2026 } })
    expect(imp.status).toBe(428)
    expect(t.ai.calls).toHaveLength(1)
  })

  it('키를 등록하면 짧은 질문으로 확인하고 암호화해 저장한다. 화면에는 끝 4자리만 간다', async () => {
    const t = setup()
    await t.setting({ userAiKey: true })
    const shape = await t.call('POST', '/api/me/ai-key', { cookie: t.student, body: { apiKey: 'short key' } })
    expect(shape.status).toBe(400)
    const bad = await t.call('POST', '/api/me/ai-key', { cookie: t.student, body: { apiKey: BAD } })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toContain('맞지 않는 키예요')
    expect((await (await t.call('GET', '/api/auth/me', { cookie: t.student })).json()).user.aiKey).toBeNull()

    const ok = await t.call('POST', '/api/me/ai-key', { cookie: t.student, body: { apiKey: ` ${GOOD} ` } })
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body).toMatchObject({ aiKey: { hint: `…${GOOD.slice(-4)}`, ok: true }, note: '' })
    expect(JSON.stringify(body)).not.toContain(GOOD.slice(0, 12))
    // 확인 질문은 관리자가 정한 모델(기본 gemini-3.6-flash)로 Google의 OpenAI 호환 주소에 간다
    expect(t.ai.calls.at(-1)).toEqual({ url: `${GEMINI_URL}/chat/completions`, auth: `Bearer ${GOOD}`, model: 'gemini-3.6-flash' })
    // 저장소에는 암호문만 있다
    const raw = t.store.db.prepare('select key_enc from user_ai_keys').all() as { key_enc: string }[]
    expect(raw).toHaveLength(1)
    expect(raw[0].key_enc.startsWith('v1:')).toBe(true)
    expect(raw[0].key_enc).not.toContain(GOOD)
    const me = (await (await t.call('GET', '/api/auth/me', { cookie: t.student })).json()).user
    expect(me.aiKey).toMatchObject({ hint: `…${GOOD.slice(-4)}`, ok: true })
  })

  it('키가 있으면 그 키로 부르고 서버 하루 한도는 세지 않는다. 모델은 관리자 설정을 따른다', async () => {
    const t = setup()
    await t.setting({ userAiKey: true })
    await t.call('POST', '/api/me/ai-key', { cookie: t.student, body: { apiKey: GOOD } })
    const before = t.ai.calls.length
    expect((await t.match()).status).toBe(200)
    expect(t.ai.calls[before]).toEqual({ url: `${GEMINI_URL}/chat/completions`, auth: `Bearer ${GOOD}`, model: 'gemini-3.6-flash' })
    const overview = await (await t.call('GET', '/api/admin/overview', { cookie: t.boss })).json()
    expect(overview.usage.match).toBe(0)
    expect(overview.userKeys).toBe(1)

    expect((await t.setting({ userAiModel: 'gemini 3; drop' })).status).toBe(400)
    expect((await t.setting({ userAiModel: 'gemini-3.5-flash-lite' })).status).toBe(200)
    await t.match()
    expect(t.ai.calls.at(-1)?.model).toBe('gemini-3.5-flash-lite')

    // 끄면 등록한 키가 있어도 서버 AI를 쓴다
    await t.setting({ userAiKey: false })
    await t.match()
    expect(t.ai.calls.at(-1)?.auth).toBe('Bearer sk-server-secret')
  })

  it('내 키의 한도·혼잡은 할 일이 보이는 말로 알리고, 등록할 때 한도에 걸려도 키는 받아 둔다', async () => {
    const t = setup()
    await t.setting({ userAiKey: true })
    t.ai.state.mode = 'quota'
    const saved = await t.call('POST', '/api/me/ai-key', { cookie: t.student, body: { apiKey: GOOD } })
    expect(saved.status).toBe(200)
    expect((await saved.json()).note).toBe('키는 맞지만 지금은 사용 한도에 걸려 있어요.')
    const limited = await t.match()
    expect(limited.status).toBe(429)
    expect((await limited.json()).error).toContain('내 Gemini API 키의 사용 한도에 걸렸어요')
    t.ai.state.mode = 'busy'
    const busy = await t.match()
    expect(busy.status).toBe(503)
  })

  it('키를 지우거나 탈퇴하면 키도 지운다. 등록·지우기·내 키로 한 일은 이용 기록에 남는다', async () => {
    const t = setup()
    await t.setting({ userAiKey: true })
    await t.call('POST', '/api/me/ai-key', { cookie: t.student, body: { apiKey: GOOD } })
    await t.match()
    expect((await t.call('POST', '/api/me/ai-key/delete', { cookie: t.student, body: {} })).status).toBe(200)
    expect((await t.match()).status).toBe(428)
    const log = new Accounts(t.store.db).logs({ kind: 'user' }).entries.map((e) => `${e.action}:${e.detail}`)
    expect(log).toContain('ai-key.save:확인됨')
    expect(log).toContain('ai-key.delete:')
    expect(log.some((e) => e.startsWith('match:') && e.endsWith(' · 내 키'))).toBe(true)
    expect(JSON.stringify(log)).not.toContain(GOOD)

    await t.call('POST', '/api/me/ai-key', { cookie: t.student, body: { apiKey: GOOD } })
    expect((await t.call('POST', '/api/auth/delete', { cookie: t.student, body: { confirm: true } })).status).toBe(200)
    expect((t.store.db.prepare('select count(*) n from user_ai_keys').get() as { n: number }).n).toBe(0)
  })
})

describe('사용자 키 도우미', () => {
  it('키 모양만 거르고, 오류는 할 일이 보이는 말로 바꾼다', () => {
    expect(cleanUserKey(` ${GOOD}\n`)).toBe(GOOD)
    expect(cleanUserKey('짧은 키')).toBeNull()
    expect(cleanUserKey(`${GOOD} 다른 말`)).toBeNull()
    expect(userGeminiConfig(GOOD, 'bad model; x')).toMatchObject({ kind: 'google', baseUrl: GEMINI_URL, model: 'gemini-3.6-flash' })
    expect(ownKeyError(new AiError(502, 'AI 서버가 오류를 냈어요.', 'HTTP 400 API_KEY_INVALID')).message).toContain('키를 다시 등록해 주세요')
    expect(ownKeyError(new AiError(502, 'AI 서버가 오류를 냈어요.', 'HTTP 403 PERMISSION_DENIED')).status).toBe(400)
    expect(ownKeyError(new AiError(502, 'AI 서버가 오류를 냈어요.', 'HTTP 404 NOT_FOUND')).message).toContain('관리자')
    // 키와 상관없는 400(요청 문제)은 그대로 둔다
    expect(ownKeyError(new AiError(502, 'AI 서버가 오류를 냈어요.', 'HTTP 400 INVALID_ARGUMENT')).status).toBe(502)
  })
})
