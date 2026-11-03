import { describe, expect, it } from 'vitest'
import { aiConfig, extractJson } from './ai'
import { keywordMajors } from './handler'
import { Store } from './store'
import { sessionFor, testApi } from './testing'

const ENV = { AI_BASE_URL: 'https://ai.example.com/v1/', AI_API_KEY: 'sk-test-secret', AI_MODEL: 'test-model' }

interface Call {
  url: string
  body: Record<string, unknown> | null
  headers: Headers
}

/** AI·나이스 서버 대신 쓰는 가짜 fetch */
function fakeFetch(reply: (call: Call) => Response) {
  const calls: Call[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      headers: new Headers(init?.headers),
    }
    calls.push(call)
    return reply(call)
  }) as typeof fetch
  return { impl, calls }
}

const aiReply = (content: string) => () => Response.json({ choices: [{ message: { content } }] })

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://app.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://app.test', ...headers },
    body: JSON.stringify(body),
  })

describe('AI 설정', () => {
  it('주소·키·모델이 모두 있어야 켜진다', () => {
    expect(aiConfig({})).toBeNull()
    expect(aiConfig({ ...ENV, AI_MODEL: '' })).toBeNull()
    expect(aiConfig({ ...ENV, AI_BASE_URL: 'file:///etc/passwd' })).toBeNull()
    expect(aiConfig(ENV)?.baseUrl).toBe('https://ai.example.com/v1')
  })

  it('코드 블록이나 설명이 섞여도 JSON을 꺼낸다', () => {
    expect(extractJson('결과입니다\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('앞말 {"b":[1,2]} 뒷말')).toEqual({ b: [1, 2] })
  })
})

describe('/api/health', () => {
  it('키가 없으면 ai=false, 있으면 true. 키 값은 절대 내보내지 않는다', async () => {
    const api = testApi({ store: new Store(':memory:') })
    const off = await api(new Request('http://app.test/api/health'), { ip: '1.1.1.1', env: {} })
    expect(await off.json()).toMatchObject({ ai: false, read: false, import: false, match: false, signup: true, notice: '' })
    const on = await api(new Request('http://app.test/api/health'), { ip: '1.1.1.1', env: ENV })
    const text = await on.text()
    expect(JSON.parse(text)).toMatchObject({ ai: true, read: true, import: true, match: true })
    expect(text).not.toContain('sk-test-secret')
  })
})

describe('/api/match', () => {
  it('목록에 있는 계열·세부 학과만 최대 5개 돌려준다', async () => {
    const { impl, calls } = fakeFetch(
      aiReply(
        '{"majors":[{"id":"sec-info","why":"해킹 방어"},{"id":"rocket","why":"없는 id"},{"id":"cs","why":"개발\\n자"},{"id":"sec-info","why":"중복"},{"id":"ai-data","why":"데이터"},{"id":"ee-semi","why":"칩"},{"id":"sec-defense","why":"국방"},{"id":"mech-robot","why":"넘침"}]}',
      ),
    )
    const api = testApi({ store: new Store(':memory:'), fetch: impl })
    const res = await api(post('/api/match', { text: '화이트해커가 되고 싶어요' }), { ip: '1.1.1.1', env: ENV })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      majors: [
        { id: 'sec-info', why: '해킹 방어' },
        { id: 'cs', why: '개발 자' },
        { id: 'ai-data', why: '데이터' },
        { id: 'ee-semi', why: '칩' },
        { id: 'sec-defense', why: '국방' },
      ],
    })
    expect(calls[0].url).toBe('https://ai.example.com/v1/chat/completions')
    expect(calls[0].headers.get('authorization')).toBe('Bearer sk-test-secret')
    expect(calls[0].body?.model).toBe('test-model')
  })

  it('같은 문장은 캐시에서 답한다', async () => {
    const { impl, calls } = fakeFetch(aiReply('{"majors":[{"id":"med","why":"의사"}]}'))
    const api = testApi({ store: new Store(':memory:'), fetch: impl })
    await api(post('/api/match', { text: '의사가 꿈' }), { ip: '1.1.1.1', env: ENV })
    await api(post('/api/match', { text: '의사가 꿈' }), { ip: '1.1.1.1', env: ENV })
    expect(calls).toHaveLength(1)
  })

  it('다른 사이트에서 온 요청은 막는다', async () => {
    const api = testApi({ store: new Store(':memory:'), fetch: fakeFetch(aiReply('{}')).impl })
    const res = await api(post('/api/match', { text: '의사가 꿈' }, { origin: 'https://evil.example' }), { ip: '1.1.1.1', env: ENV })
    expect(res.status).toBe(403)
    const res2 = await api(post('/api/match', { text: '의사가 꿈' }, { 'sec-fetch-site': 'cross-site' }), { ip: '1.1.1.1', env: ENV })
    expect(res2.status).toBe(403)
  })

  it('한 사람이 1분에 20번까지만 (같은 IP를 쓰는 다른 학생은 따로 센다)', async () => {
    const store = new Store(':memory:')
    const api = testApi({ store, fetch: fakeFetch(aiReply('{"majors":[]}')).impl })
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) {
      const res = await api(post('/api/match', { text: `질문 ${i}` }), { ip: '9.9.9.9', env: ENV })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
    const cookie = sessionFor(store, { email: 'friend@example.com' })
    const other = await api(post('/api/match', { text: '다른 사람' }, { cookie }), { ip: '9.9.9.9', env: ENV })
    expect(other.status).toBe(200)
  })

  it('공급자 오류 내용을 그대로 노출하지 않는다', async () => {
    const api = testApi({
      store: new Store(':memory:'),
      fetch: fakeFetch(() => new Response('{"error":"invalid key sk-test-secret for org 123"}', { status: 401 })).impl,
    })
    const res = await api(post('/api/match', { text: '의사가 꿈' }), { ip: '1.1.1.1', env: ENV })
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain('sk-test')
    expect(text).not.toContain('org 123')
  })

  it('키가 설정되지 않으면 503', async () => {
    const api = testApi({ store: new Store(':memory:') })
    const res = await api(post('/api/match', { text: '의사가 꿈' }), { ip: '1.1.1.1', env: {} })
    expect(res.status).toBe(503)
  })
})

describe('/api/import', () => {
  it('AI가 읽은 편제표를 정리해서 돌려준다', async () => {
    const loose = {
      terms: [
        {
          id: '2-1',
          fixed: [{ subject: '문학Ⓐ', credits: '4' }],
          groups: [{ label: '탐구', pick: 2, credits: 3, options: ['물리학◯', '화학', '화학반응의세계'] }],
        },
        { id: '9-9', fixed: [{ subject: '무시됨', credits: 3 }] },
      ],
      tracks: [],
      evil: '<script>',
    }
    const { impl, calls } = fakeFetch(aiReply(JSON.stringify(loose)))
    const api = testApi({ store: new Store(':memory:'), fetch: impl })
    const res = await api(post('/api/import', { text: '2-1 문학 4 ...', cohort: 2026 }), { ip: '1.1.1.1', env: ENV })
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      terms: { id: string; fixed: { subject: string; credits: number }[]; groups: { options: string[] }[] }[]
      unknown: string[]
    }
    const t21 = data.terms.find((t) => t.id === '2-1')!
    expect(t21.fixed).toEqual([{ subject: '문학', credits: 4 }])
    expect(t21.groups[0].options).toEqual(['물리학', '화학', '화학 반응의 세계'])
    expect(JSON.stringify(data)).not.toContain('무시됨')
    expect(JSON.stringify(data)).not.toContain('script')
    const messages = calls[0].body?.messages as { content: string }[] | undefined
    expect(String(messages?.[0]?.content)).toContain('2026학년도')
  })

  it('이미지 형식이 아니면 거절한다', async () => {
    const api = testApi({ store: new Store(':memory:'), fetch: fakeFetch(aiReply('{}')).impl })
    const res = await api(post('/api/import', { images: ['data:text/html;base64,PHNjcmlwdD4='] }), { ip: '1.1.1.1', env: ENV })
    expect(res.status).toBe(400)
  })

  it('추론 강도는 기능별로 따로 보낸다', async () => {
    const { impl, calls } = fakeFetch(aiReply('{"terms":[{"id":"2-1","fixed":[{"subject":"대수","credits":4}]}],"majors":[]}'))
    const api = testApi({ store: new Store(':memory:'), fetch: impl })
    const env = { ...ENV, AI_REASONING_EFFORT: 'none', AI_VISION_REASONING_EFFORT: 'low; drop table' }
    await api(post('/api/match', { text: '의사가 꿈이에요' }), { ip: '1.1.1.1', env })
    await api(post('/api/import', { images: ['data:image/png;base64,iVBORw0KGgo='] }), { ip: '1.1.1.1', env })
    expect(calls[0].body?.reasoning_effort).toBe('none')
    expect(calls[1].body && 'reasoning_effort' in calls[1].body).toBe(false)
  })

  it('이미지는 비전 모델로 보낸다', async () => {
    const { impl, calls } = fakeFetch(aiReply('{"terms":[{"id":"2-1","fixed":[{"subject":"대수","credits":4}]}]}'))
    const api = testApi({ store: new Store(':memory:'), fetch: impl })
    const res = await api(post('/api/import', { images: ['data:image/png;base64,iVBORw0KGgo='] }), {
      ip: '1.1.1.1',
      env: { ...ENV, AI_VISION_MODEL: 'vision-model' },
    })
    expect(res.status).toBe(200)
    expect(calls[0].body?.model).toBe('vision-model')
  })

  it('과목을 하나도 못 찾으면 422', async () => {
    const api = testApi({ store: new Store(':memory:'), fetch: fakeFetch(aiReply('{"terms":[]}')).impl })
    const res = await api(post('/api/import', { text: '아무 내용' }), { ip: '1.1.1.1', env: ENV })
    expect(res.status).toBe(422)
  })
})

describe('/api/schools', () => {
  it('나이스 결과를 필요한 값만 추려서 돌려준다', async () => {
    const { impl, calls } = fakeFetch(() =>
      Response.json({
        schoolInfo: [
          { head: [] },
          {
            row: [
              {
                ATPT_OFCDC_SC_CODE: 'J10',
                ATPT_OFCDC_SC_NM: '경기도교육청',
                SD_SCHUL_CODE: '7530847',
                SCHUL_NM: '반송고등학교',
                ORG_RDNMA: '경기도 화성시 동탄반석로 21',
                HMPG_ADRES: 'bansong-h.goehs.kr',
                HS_SC_NM: '일반고',
              },
            ],
          },
        ],
      }),
    )
    const api = testApi({ store: new Store(':memory:'), fetch: impl })
    const res = await api(new Request('http://app.test/api/schools?q=반송고'), { ip: '1.1.1.1', env: {} })
    expect(await res.json()).toEqual({
      schools: [
        {
          office: 'J10',
          code: '7530847',
          name: '반송고등학교',
          region: '경기',
          address: '경기도 화성시 동탄반석로 21',
          homepage: 'http://bansong-h.goehs.kr/',
          type: '일반고',
          schoolType: '일반고',
        },
      ],
    })
    expect(calls[0].url).toContain('open.neis.go.kr')
    expect(calls[0].url).not.toContain('KEY=')
  })

  it('이상한 검색어는 나이스로 보내지 않는다', async () => {
    const { impl, calls } = fakeFetch(() => Response.json({}))
    const api = testApi({ store: new Store(':memory:'), fetch: impl })
    const res = await api(new Request('http://app.test/api/schools?q=%3Cscript%3E'), { ip: '1.1.1.1', env: {} })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe('고교 유형', () => {
  it('특목고는 계열로 나눈다', async () => {
    const { schoolTypeOf } = await import('./neis')
    expect(schoolTypeOf('특목고', '외국어계열')).toBe('외고')
    expect(schoolTypeOf('특목고', '산업수요맞춤형')).toBe('마이스터고')
    expect(schoolTypeOf('특목고', '예술계열')).toBe('예술고')
    expect(schoolTypeOf('특성화고', '')).toBe('특성화고')
    expect(schoolTypeOf('특목고', '')).toBe('')
    expect(schoolTypeOf('자율고', '', '사립')).toBe('자율고')
    expect(schoolTypeOf('자율고', '', '공립')).toBe('일반고')
  })

  it('교육청 이름에서 시도를 뽑는다 (합쳐진 시도는 괄호 안 옛 시도)', async () => {
    const { regionOf } = await import('./neis')
    expect(regionOf('경기도교육청')).toBe('경기')
    expect(regionOf('서울특별시교육청')).toBe('서울')
    expect(regionOf('전북특별자치도교육청')).toBe('전북')
    expect(regionOf('전남광주통합특별시교육청(광주)')).toBe('광주')
    expect(regionOf('전남광주통합특별시교육청(전남)')).toBe('전남')
  })
})

describe('진로 문장의 학과 키워드', () => {
  it('키워드가 그대로 들어 있으면 그 세부 학과를 낸다 (짧은 낱말은 AI에 맡긴다)', () => {
    expect(keywordMajors('유치원 선생님이 되고 싶어요').map((m) => m.id)).toEqual(['edu-early'])
    expect(keywordMajors('물리치료사')[0].id).toBe('nurse-pt')
    expect(keywordMajors('게임 개발자')).toEqual([])
  })
})
