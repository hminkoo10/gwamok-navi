import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chat } from './ai'
import { AiProviders, cleanProvider, GEMINI_URL, keySecret } from './ai-providers'
import { AiError } from './ai-types'
import { createApi } from './handler'
import { importAi, verifyAi } from './services'
import { Store } from './store'
import { sessionFor } from './testing'

// 테스트용 값 (실제 키 아님)
const FAKE_KEY = 'sk-ant-test-0000-abcd1234wxyz'
const OWNER = 'boss@example.com'
const ENV = { OWNER_EMAIL: OWNER }
const ORIGIN = 'http://app.test'

const claudeInput = (extra: Record<string, unknown> = {}) => ({ kind: 'anthropic', name: '임시 Claude', model: 'claude-opus-5-5', apiKey: FAKE_KEY, ...extra })
// 테스트용 값 (실제 키 아님)
const FAKE_GEMINI_KEY = 'AIzaTest-0000-0000-0000-abcdefgh9876'
const geminiInput = (extra: Record<string, unknown> = {}) => ({
  kind: 'google',
  name: '무료 Gemini',
  model: 'gemini-3.8-flash',
  apiKey: FAKE_GEMINI_KEY,
  ...extra,
})

/** OpenAI 호환 Chat Completions 답 */
const completion = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

/** Claude Messages API 스트리밍 응답 (SSE) */
function sse(text: string, stop = 'end_turn'): Response {
  const events = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      },
    ],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 3 } }],
    ['message_stop', { type: 'message_stop' }],
  ]
  const body = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** 요청을 모아 두는 가짜 fetch */
function fakeFetch(respond: (url: string, body: Record<string, unknown>) => Response) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    calls.push({ url, body, headers: new Headers(init?.headers) })
    return respond(url, body)
  }) as typeof fetch
  return { impl, calls }
}

describe('AI 연결 값 검사', () => {
  it('Claude는 주소를 비우면 공식 주소, /v1은 뗀다. https만 받는다', () => {
    expect(cleanProvider(claudeInput(), { requireKey: true }).baseUrl).toBe('https://api.anthropic.com')
    expect(cleanProvider(claudeInput({ baseUrl: 'https://api.anthropic.com/v1/' }), { requireKey: true }).baseUrl).toBe('https://api.anthropic.com')
    expect(() => cleanProvider(claudeInput({ baseUrl: 'http://example.com' }), { requireKey: true })).toThrow(/https/)
    expect(cleanProvider({ ...claudeInput(), kind: 'openai', baseUrl: 'http://localhost:11434/v1' }, { requireKey: true }).baseUrl).toBe(
      'http://localhost:11434/v1',
    )
    expect(() => cleanProvider({ ...claudeInput(), kind: 'openai', baseUrl: '' }, { requireKey: true })).toThrow(/https/)
  })

  it('필수 값과 추론 강도', () => {
    expect(() => cleanProvider({ ...claudeInput(), kind: 'x' }, { requireKey: true })).toThrow(/종류/)
    expect(() => cleanProvider(claudeInput({ name: ' ' }), { requireKey: true })).toThrow(/이름/)
    expect(() => cleanProvider(claudeInput({ model: 'bad model' }), { requireKey: true })).toThrow(/모델/)
    expect(() => cleanProvider(claudeInput({ apiKey: '' }), { requireKey: true })).toThrow(/키/)
    expect(cleanProvider(claudeInput({ apiKey: '' }), { requireKey: false }).apiKey).toBe('')
    expect(cleanProvider(claudeInput({ textEffort: 'low' }), { requireKey: true }).textEffort).toBe('low')
    expect(() => cleanProvider(claudeInput({ textEffort: 'none' }), { requireKey: true })).toThrow(/low, medium/)
    // OpenAI 호환 연결만 jsonMode·max_completion_tokens를 쓴다
    const c = cleanProvider(claudeInput({ jsonMode: true, maxTokensParam: 'max_completion_tokens' }), { requireKey: true })
    expect(c.jsonMode).toBe(false)
    expect(c.maxTokensParam).toBe('max_tokens')
  })

  it('Gemini는 주소를 비우면 OpenAI 호환 공식 주소, 추론 강도는 minimal~high만', () => {
    expect(cleanProvider(geminiInput(), { requireKey: true }).baseUrl).toBe(GEMINI_URL)
    // 문서에 나온 대로 끝에 /를 붙이거나 /chat/completions까지 적어도 같은 주소
    expect(cleanProvider(geminiInput({ baseUrl: `${GEMINI_URL}/` }), { requireKey: true }).baseUrl).toBe(GEMINI_URL)
    expect(cleanProvider(geminiInput({ baseUrl: `${GEMINI_URL}/chat/completions` }), { requireKey: true }).baseUrl).toBe(GEMINI_URL)
    expect(cleanProvider(geminiInput({ textEffort: 'minimal', visionEffort: 'high' }), { requireKey: true })).toMatchObject({
      textEffort: 'minimal',
      visionEffort: 'high',
    })
    expect(() => cleanProvider(geminiInput({ textEffort: 'xhigh' }), { requireKey: true })).toThrow(/minimal, low, medium, high/)
    const g = cleanProvider(geminiInput({ jsonMode: true, maxTokensParam: 'max_completion_tokens' }), { requireKey: true })
    expect(g.jsonMode).toBe(false)
    expect(g.maxTokensParam).toBe('max_tokens')
  })
})

describe('AI 연결 저장', () => {
  it('키는 암호화해 두고, 목록에는 끝 4자리만 나온다', () => {
    const store = new Store(':memory:')
    const ai = new AiProviders(store.db, keySecret({}))
    const p = ai.create(cleanProvider(claudeInput(), { requireKey: true }))
    expect(p.keyHint).toBe('…wxyz')
    expect(JSON.stringify(ai.list())).not.toContain(FAKE_KEY)
    const raw = store.db.prepare('select key_enc from ai_providers').get() as { key_enc: string }
    expect(raw.key_enc).not.toContain(FAKE_KEY)
    expect(raw.key_enc.startsWith('v1:')).toBe(true)
    // 고르기 전에는 환경변수 설정을 쓴다 (undefined)
    expect(ai.config()).toBeUndefined()
    ai.select(p.id)
    expect(ai.config()).toMatchObject({ kind: 'anthropic', apiKey: FAKE_KEY, model: 'claude-opus-5-5', visionModel: 'claude-opus-5-5' })
    // 키를 비우고 고치면 키는 그대로
    ai.update(p.id, cleanProvider(claudeInput({ name: '새 이름', apiKey: '' }), { requireKey: false }))
    expect(ai.config()?.apiKey).toBe(FAKE_KEY)
    expect(ai.byId(p.id)?.name).toBe('새 이름')
    ai.select(null)
    expect(ai.active()).toBeNull()
  })

  it('전형 가져오기는 고른 연결이 유료여도 저장된 Gemini 연결을 먼저 쓴다', () => {
    const ai = new AiProviders(new Store(':memory:').db, keySecret({}))
    const claude = ai.create(cleanProvider(claudeInput(), { requireKey: true }))
    ai.select(claude.id)
    expect(importAi(ai, {})?.kind).toBe('anthropic')
    ai.create(cleanProvider({ kind: 'google', name: 'Gemini', model: 'gemini-3.6-flash', apiKey: 'AIza-test-1234-abcd5678efgh' }, { requireKey: true }))
    expect(importAi(ai, {})).toMatchObject({ kind: 'google', model: 'gemini-3.6-flash' })
    // 다른 기능은 고른 연결 그대로
    expect(ai.config()?.kind).toBe('anthropic')
  })

  it('검수는 Gemini가 아닌 연결로 한다 (고른 연결이 Gemini면 저장된 Claude)', () => {
    const ai = new AiProviders(new Store(':memory:').db, keySecret({}))
    const gemini = ai.create(
      cleanProvider({ kind: 'google', name: 'Gemini', model: 'gemini-3.6-flash', apiKey: 'AIza-test-1234-abcd5678efgh' }, { requireKey: true }),
    )
    ai.select(gemini.id)
    expect(verifyAi(ai, {})).toBeNull()
    const claude = ai.create(cleanProvider(claudeInput(), { requireKey: true }))
    expect(verifyAi(ai, {})).toMatchObject({ kind: 'anthropic' })
    ai.select(claude.id)
    expect(verifyAi(ai, {})).toMatchObject({ kind: 'anthropic' })
  })

  it('주소나 종류를 바꿀 때는 키를 다시 받는다 (저장된 키를 다른 서버로 못 보내게)', () => {
    const ai = new AiProviders(new Store(':memory:').db, keySecret({}))
    const p = ai.create(cleanProvider(claudeInput(), { requireKey: true }))
    const moved = cleanProvider(claudeInput({ baseUrl: 'https://evil.example', apiKey: '' }), { requireKey: false })
    expect(() => ai.update(p.id, moved)).toThrow(/키를 다시/)
    const asOpenai = cleanProvider({ ...claudeInput({ apiKey: '' }), kind: 'openai', baseUrl: 'https://api.anthropic.com' }, { requireKey: false })
    expect(() => ai.update(p.id, asOpenai)).toThrow(/키를 다시/)
    expect(ai.byId(p.id)?.baseUrl).toBe('https://api.anthropic.com')
    // 같은 주소를 /v1 붙여 적은 것은 바뀐 게 아니다
    ai.update(p.id, cleanProvider(claudeInput({ baseUrl: 'https://api.anthropic.com/v1', apiKey: '' }), { requireKey: false }))
    // 새 키와 함께면 바꿀 수 있다
    const NEW_KEY = 'sk-ant-test-1111-efgh5678qrst'
    ai.update(p.id, cleanProvider(claudeInput({ baseUrl: 'https://proxy.example', apiKey: NEW_KEY }), { requireKey: false }))
    expect(ai.config(p.id)).toMatchObject({ baseUrl: 'https://proxy.example', apiKey: NEW_KEY })
  })

  it('비밀값이 바뀌면 키를 풀지 못하고, 고른 연결은 꺼진 것으로 본다', () => {
    const store = new Store(':memory:')
    const p = new AiProviders(store.db, keySecret({ AI_KEY_SECRET: 'first-secret-value-123' })).create(cleanProvider(claudeInput(), { requireKey: true }))
    const other = new AiProviders(store.db, keySecret({ AI_KEY_SECRET: 'second-secret-value-456' }))
    other.select(p.id)
    expect(other.byId(p.id)?.keyOk).toBe(false)
    expect(other.config()).toBeNull()
  })

  it('비밀값: 환경변수가 없으면 데이터 폴더 파일을 만들어 다시 쓴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gwamok-ai-'))
    try {
      const a = keySecret({}, dir)
      const b = keySecret({}, dir)
      expect(a.equals(b)).toBe(true)
      expect(readFileSync(join(dir, 'ai-key.secret'), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/)
      expect(keySecret({ AI_KEY_SECRET: 'env-secret-wins-0000' }, dir).equals(a)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Claude 연결 (공식 SDK)', () => {
  const cfg = {
    kind: 'anthropic' as const,
    name: '임시 Claude',
    baseUrl: 'https://api.anthropic.com',
    apiKey: FAKE_KEY,
    model: 'claude-sonnet-5-5',
    visionModel: 'claude-opus-5-5',
    maxTokensParam: 'max_tokens' as const,
    jsonMode: false,
    textEffort: 'low',
    visionEffort: 'high',
  }

  it('Messages API 모양으로 보내고 스트리밍 답의 글만 돌려준다', async () => {
    const f = fakeFetch(() => sse('{"ok":true}'))
    const out = await chat(cfg, { system: '규칙', user: '질문', maxTokens: 1200, timeoutMs: 10_000 }, f.impl)
    expect(out).toBe('{"ok":true}')
    expect(f.calls).toHaveLength(1)
    const { url, body, headers } = f.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(headers.get('x-api-key')).toBe(FAKE_KEY)
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', system: '규칙', stream: true, output_config: { effort: 'low' } })
    // 생각에도 출력 토큰을 쓰므로 짧은 요청도 4096까지는 둔다
    expect(body.max_tokens).toBe(4096)
    expect(body.messages).toEqual([{ role: 'user', content: '질문' }])
  })

  it('이미지는 base64 블록으로, 이어 묻기는 대화로 보내고 비전 모델·강도를 쓴다', async () => {
    const f = fakeFetch(() => sse('표'))
    await chat(
      cfg,
      {
        system: 's',
        user: '옮겨 줘',
        images: ['data:image/png;base64,AAAA'],
        maxTokens: 32_000,
        timeoutMs: 10_000,
        followUp: { answer: '앞 답', text: '다시' },
      },
      f.impl,
    )
    const { body } = f.calls[0]
    expect(body.model).toBe('claude-opus-5-5')
    expect(body.max_tokens).toBe(32_000)
    expect(body.output_config).toEqual({ effort: 'high' })
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: '옮겨 줘' },
        ],
      },
      { role: 'assistant', content: '앞 답' },
      { role: 'user', content: '다시' },
    ])
  })

  it('오류는 짧은 문장과 원인(상태·종류)만 남긴다', async () => {
    const unauthorized = fakeFetch(
      () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const e1 = await chat(cfg, { system: 's', user: 'u', maxTokens: 10, timeoutMs: 10_000 }, unauthorized.impl).catch((e: unknown) => e)
    expect(e1).toBeInstanceOf(AiError)
    expect((e1 as AiError).status).toBe(502)
    expect((e1 as AiError).detail).toBe('HTTP 401 authentication_error')
    expect((e1 as AiError).message).not.toContain('x-api-key')

    const busy = fakeFetch(
      () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
        }),
    )
    const e2 = await chat(cfg, { system: 's', user: 'u', maxTokens: 10, timeoutMs: 10_000 }, busy.impl).catch((e: unknown) => e)
    expect((e2 as AiError).status).toBe(429)

    const refused = fakeFetch(() => sse('', 'refusal'))
    const e3 = await chat(cfg, { system: 's', user: 'u', maxTokens: 10, timeoutMs: 10_000 }, refused.impl).catch((e: unknown) => e)
    expect((e3 as AiError).detail).toBe('refusal')
  })
})

describe('Gemini 연결 (OpenAI 호환 주소)', () => {
  const cfg = {
    kind: 'google' as const,
    name: '무료 Gemini',
    baseUrl: GEMINI_URL,
    apiKey: FAKE_GEMINI_KEY,
    model: 'gemini-3.8-flash',
    visionModel: 'gemini-3.6-flash',
    maxTokensParam: 'max_tokens' as const,
    jsonMode: false,
    textEffort: 'low',
  }

  it('Chat Completions 모양으로 보내고, 생각에 쓸 토큰을 남겨 max_tokens를 정한다', async () => {
    const f = fakeFetch(() => completion('2'))
    expect(await chat(cfg, { system: '규칙', user: '질문', maxTokens: 64, timeoutMs: 10_000 }, f.impl)).toBe('2')
    const { url, body, headers } = f.calls[0]
    expect(url).toBe(`${GEMINI_URL}/chat/completions`)
    expect(headers.get('authorization')).toBe(`Bearer ${FAKE_GEMINI_KEY}`)
    expect(body).toMatchObject({ model: 'gemini-3.8-flash', reasoning_effort: 'low', max_tokens: 4096 })
    expect(body.response_format).toBeUndefined()

    // 이미지는 image_url, 비전 모델을 쓰고 강도를 정하지 않았으면 보내지 않는다. 한 번에 받는 상한은 65,536
    await chat(cfg, { system: 's', user: '옮겨 줘', images: ['data:image/png;base64,AAAA'], maxTokens: 200_000, timeoutMs: 10_000 }, f.impl)
    const second = f.calls[1].body
    expect(second.model).toBe('gemini-3.6-flash')
    expect(second.max_tokens).toBe(65_536)
    expect(second.reasoning_effort).toBeUndefined()
    expect(second.messages).toEqual([
      { role: 'system', content: 's' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '옮겨 줘' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      },
    ])
  })

  it('무료 등급 한도에 걸리면 사용량 오류로, 원인은 Google 오류 상태만 남긴다', async () => {
    const f = fakeFetch(
      () =>
        new Response(JSON.stringify([{ error: { code: 429, message: 'Quota exceeded for project 1234', status: 'RESOURCE_EXHAUSTED' } }]), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const e = await chat(cfg, { system: 's', user: 'u', maxTokens: 10, timeoutMs: 10_000 }, f.impl).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(AiError)
    expect((e as AiError).status).toBe(429)
    expect((e as AiError).detail).toBe('HTTP 429 RESOURCE_EXHAUSTED')
    expect((e as AiError).message).not.toContain('1234')
  })

  it('모델에 요청이 몰리면(503) 잠시 뒤 다시 하라고 알린다', async () => {
    // 2026-10-22 gemini-3.8-flash가 실제로 준 답 모양
    const f = fakeFetch(
      () =>
        new Response(
          JSON.stringify([
            { error: { code: 503, message: 'This model is currently experiencing high demand. Please try again later.', status: 'UNAVAILABLE' } },
          ]),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
    )
    const e = await chat(cfg, { system: 's', user: 'u', maxTokens: 10, timeoutMs: 10_000 }, f.impl).catch((x: unknown) => x)
    expect((e as AiError).status).toBe(503)
    expect((e as AiError).message).toContain('잠시 후')
    expect((e as AiError).detail).toBe('HTTP 503 UNAVAILABLE')
  })
})

describe('관리자 AI 연결 화면', () => {
  function setup(respond: (url: string, body: Record<string, unknown>) => Response) {
    const f = fakeFetch(respond)
    const store = new Store(':memory:')
    const api = createApi({ store, fetch: f.impl })
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
    // 대표 관리자 세션 (Google 로그인은 accounts.test.ts에서 따로 검사한다)
    const login = async () => sessionFor(store, { email: OWNER, role: 'owner' })
    return { call, login, calls: f.calls }
  }

  it('관리자만 보고, 키는 응답과 관리 기록 어디에도 나오지 않는다', async () => {
    const t = setup(() => sse('2'))
    expect((await t.call('GET', '/api/admin/ai')).status).toBe(401)
    const cookie = await t.login()
    const created = await t.call('POST', '/api/admin/ai/create', { cookie, body: claudeInput() })
    expect(created.status).toBe(201)
    const text = await created.text()
    expect(text).not.toContain(FAKE_KEY)
    const state = JSON.parse(text)
    expect(state.providers[0]).toMatchObject({ name: '임시 Claude', kind: 'anthropic', keyHint: '…wxyz', keyOk: true, active: false })
    expect(state.using).toBeNull() // 환경변수에도 AI가 없다
    const log = await (await t.call('GET', '/api/admin/log', { cookie })).text()
    expect(log).toContain('ai.create')
    expect(log).not.toContain(FAKE_KEY)
  })

  it('고르면 문장 찾기가 Claude로 가고, 지우면 환경변수 설정으로 돌아간다', async () => {
    const t = setup((url) => (url.endsWith('/v1/messages') ? sse('{"majors":[{"id":"cs-software","why":"게임 개발"}]}') : new Response('{}', { status: 404 })))
    const cookie = await t.login()
    const { providers } = await (await t.call('POST', '/api/admin/ai/create', { cookie, body: claudeInput() })).json()
    const id = providers[0].id
    expect((await (await t.call('GET', '/api/health')).json()).match).toBe(false)
    const selected = await (await t.call('POST', '/api/admin/ai/select', { cookie, body: { id } })).json()
    expect(selected.using).toEqual({ name: '임시 Claude', kind: 'anthropic', model: 'claude-opus-5-5' })
    expect((await (await t.call('GET', '/api/health')).json()).match).toBe(true)
    const matched = await (await t.call('POST', '/api/match', { cookie, body: { text: '게임 만드는 사람' } })).json()
    expect(matched.majors.map((m: { id: string }) => m.id)).toContain('cs-software')
    expect(t.calls.some((c) => c.url === 'https://api.anthropic.com/v1/messages')).toBe(true)

    const tested = await (await t.call('POST', '/api/admin/ai/test', { cookie, body: { id } })).json()
    expect(tested.ok).toBe(true)

    const after = await (await t.call('POST', '/api/admin/ai/delete', { cookie, body: { id } })).json()
    expect(after.providers).toEqual([])
    expect(after.active).toBeNull()
    expect((await (await t.call('GET', '/api/health')).json()).match).toBe(false)
  })

  it('Gemini를 고르면 문장 찾기가 Google로 가고, 개인정보 안내용 표시(aiTraining)가 켜진다', async () => {
    const t = setup((url) =>
      url === `${GEMINI_URL}/chat/completions` ? completion('{"majors":[{"id":"cs-software","why":"게임 개발"}]}') : new Response('{}', { status: 404 }),
    )
    const cookie = await t.login()
    const created = await t.call('POST', '/api/admin/ai/create', { cookie, body: geminiInput() })
    const text = await created.text()
    expect(text).not.toContain(FAKE_GEMINI_KEY)
    const id = JSON.parse(text).providers[0].id
    expect((await (await t.call('GET', '/api/health')).json()).aiTraining).toBe(false)
    const selected = await (await t.call('POST', '/api/admin/ai/select', { cookie, body: { id } })).json()
    expect(selected.using).toEqual({ name: '무료 Gemini', kind: 'google', model: 'gemini-3.8-flash' })
    const health = await (await t.call('GET', '/api/health')).json()
    expect(health).toMatchObject({ ai: true, match: true, aiTraining: true })
    const matched = await (await t.call('POST', '/api/match', { cookie, body: { text: '게임 만드는 사람' } })).json()
    expect(matched.majors.map((m: { id: string }) => m.id)).toContain('cs-software')
    expect(t.calls.some((c) => c.headers.get('authorization') === `Bearer ${FAKE_GEMINI_KEY}`)).toBe(true)
    const log = await (await t.call('GET', '/api/admin/log', { cookie })).text()
    expect(log).toContain('Gemini · gemini-3.8-flash')
    expect(log).not.toContain(FAKE_GEMINI_KEY)
  })

  it('연결 시험이 실패하면 원인만 알려 준다', async () => {
    const t = setup(
      () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const cookie = await t.login()
    const { providers } = await (await t.call('POST', '/api/admin/ai/create', { cookie, body: claudeInput() })).json()
    const r = await (await t.call('POST', '/api/admin/ai/test', { cookie, body: { id: providers[0].id } })).json()
    expect(r).toMatchObject({ ok: false, detail: 'HTTP 401 authentication_error', model: 'claude-opus-5-5' })
  })
})
