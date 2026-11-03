import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { type AiConfig, AiError, type ChatRequest } from './ai'
import { cleanProvider } from './ai-providers'
import { Datasets } from './datasets'
import { rankPlanFiles } from './plan-files'
import { cdnUrl, fullTrack, listTracks, partsOf, PlanImporter } from './plan-import'
import type { DocText } from './plan-update'
import { servicesFor } from './services'
import { Store } from './store'

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

/** 가짜 시행계획: 쪽마다 글자 (모집인원 표, 전형별 자격·방법, 글자 수를 채우는 쪽) */
const PAGES = [
  '2028학년도 대학입학전형시행계획 2026. 4. 30.',
  '전형별 모집인원 수시 정시 정원내 정원외 학생부교과 학생부우수자 500 학생부종합 바람개비 400 수능 일반전형 300 합계 1200',
  '학생부우수자 지원자격 고등학교 졸업예정자 전형방법 교과 100% 수능 최저학력기준 국수영탐 2합 7',
  '바람개비 지원자격 고등학교 졸업(예정)자 전형방법 1단계 서류 100%(4배수) 2단계 1단계 70% 면접 30%',
  `일반 안내 ${'원서 접수와 합격자 발표 일정은 모집요강을 따른다. '.repeat(60)}`,
]
const file = (pages: string[]) => Buffer.from(pages.join('\f'))
const read = async (buf: Buffer): Promise<DocText> => ({ kind: 'pdf', pages: buf.toString().split('\f') })

const LIST = {
  planTitle: '2028학년도 대학입학전형시행계획',
  date: '2026-04-30',
  totals: { 수시: '900', 정시: 300 },
  changes: ['학생부우수자 수능 최저 완화'],
  tracks: [
    { id: 'Student Excellence', name: '학생부우수자전형', type: '교과', period: '수시', quota: '정원내', seats: '500명' },
    { id: 'baram', name: '바람개비전형', type: '종합', period: '수시', quota: '정원내', seats: 400 },
    { id: 'jeongsi', name: '일반전형', type: '수능', period: '정시', quota: '정원내', seats: 300 },
    { id: 'abroad', name: '재외국민전형', type: '기타', period: '기타', quota: '정원외', seats: null },
    { id: 'bad', name: '이상한전형', type: '면접', period: '수시', quota: '정원내', seats: 1 },
  ],
}
const DETAIL = {
  'student-excellence': {
    id: 'student-excellence',
    grads: '예정자',
    rec: null,
    schools: { only: [], exclude: ['검정고시', '없는유형'] },
    regions: [],
    special: [],
    who: '고등학교 졸업예정자',
    method: '교과 100%',
    elements: ['교과'],
    min: '국수영탐 2합 7',
    subjects: null,
    note: null,
    pages: 3,
  },
  baram: {
    id: 'baram',
    grads: '졸업자포함',
    who: '고등학교 졸업(예정)자',
    method: '1단계 서류 100%(4배수) → 2단계 1단계 70%+면접 30%',
    elements: ['서류', '면접'],
    pages: '4',
  },
}

function chatFor(calls: ChatRequest[], opts: { fail?: Error; list?: unknown } = {}) {
  return async (_cfg: AiConfig, req: ChatRequest) => {
    calls.push(req)
    if (opts.fail) throw opts.fail
    if (req.system.includes('전형 목록을 옮긴다')) return JSON.stringify(opts.list ?? LIST)
    const asked = Object.values(DETAIL).filter((d) => req.user.includes(`"id":"${d.id}"`))
    return `답이에요\n\`\`\`json\n${JSON.stringify({ tracks: asked })}\n\`\`\``
  }
}

function setup(
  opts: {
    files?: Map<string, Buffer | null>
    fail?: Error
    enabled?: boolean
    limit?: number
    list?: unknown
    adiga?: (code: string) => Promise<string | null>
    render?: (buf: Buffer, pages: number[]) => Promise<string[]>
    chat?: (cfg: AiConfig, req: ChatRequest) => Promise<string>
  } = {},
) {
  const db = new DatabaseSync(':memory:')
  const datasets = new Datasets(db, { year: 2028, plans: [] })
  const calls: ChatRequest[] = []
  const downloads: string[] = []
  const imported: string[] = []
  const answer = chatFor(calls, { fail: opts.fail, list: opts.list })
  const importer = new PlanImporter(db, datasets, {
    download: async ({ url }) => {
      downloads.push(url)
      return opts.files ? (opts.files.get(url) ?? null) : file(PAGES)
    },
    read,
    ai: () => AI,
    chat: opts.chat ? (cfg, req) => (calls.push(req), opts.chat!(cfg, req)) : answer,
    enabled: () => opts.enabled ?? false,
    limit: () => opts.limit ?? 25,
    onImported: (univ) => imported.push(univ),
    pause: 0,
    retryWait: 0,
    // 테스트에서는 어디가에 묻지 않는다
    adiga: opts.adiga ?? (async () => null),
    ...(opts.render ? { render: opts.render } : {}),
  })
  return { db, datasets, importer, calls, downloads, imported, answer }
}

describe('전형 없는 대학 가져오기', () => {
  it('시행계획을 받아 AI로 옮겨 넣고, AI가 옮겼다는 표시를 붙인다', async () => {
    const t = setup()
    const r = await t.importer.importNow('gachon')
    expect(r.state).toBe('done')
    const plan = t.datasets.plan('gachon')!
    expect(plan.ai).toMatch(/^20\d\d-\d\d-\d\d$/)
    expect(plan.planTitle).toBe('2028학년도 대학입학전형시행계획')
    expect(plan.totals).toEqual({ 수시: 900, 정시: 300 })
    // id는 형식에 맞게 고치고, 숫자에 붙은 '명'은 뺀다. 없는 고교 유형은 버린다
    const ex = plan.tracks.find((x) => x.name === '학생부우수자전형')!
    expect(ex).toMatchObject({ id: 'student-excellence', seats: 500, grads: '예정자', min: '국수영탐 2합 7', pages: '3' })
    expect(ex.schools.exclude).toEqual(['검정고시'])
    // 세부를 못 찾은 수능 전형은 '원문에서 확인' 문구, 전형 요소는 유형으로 정한다
    const js = plan.tracks.find((x) => x.id === 'jeongsi')!
    expect(js.elements).toEqual(['수능'])
    expect(js.who).toContain('원문')
    // 유형이 틀린 전형과 세부 없는 기타 전형은 뺀다
    expect(plan.tracks.map((x) => x.id)).toEqual(['student-excellence', 'baram', 'jeongsi'])
    const row = t.importer.list().find((x) => x.univ === 'gachon')!
    expect(row).toMatchObject({ status: 'done', tracks: 3, tries: 1 })
    expect(row.detail).toContain('재외국민전형')
    expect(t.imported).toEqual(['gachon'])
    // 전형 목록 1번 + 세부 1번 (3개라 한 묶음)
    expect(t.calls).toHaveLength(2)
    expect(t.calls[0].user).toContain('[2쪽]')
    expect(t.importer.doneToday()).toBe(1)
  })

  it('모집시기별 합계가 전형별 모집인원 합과 다르면 합계를 버린다', async () => {
    const t = setup({ list: { ...LIST, totals: { 수시: 1000, 정시: 300 } } })
    await t.importer.importNow('gachon')
    expect(t.datasets.plan('gachon')?.totals).toBeNull()
  })

  it('캠퍼스가 나뉜 대학은 그 캠퍼스 것만 옮기라고 알린다', async () => {
    const t = setup()
    await t.importer.importNow('kangwon-gangneung')
    expect(t.calls[0].user).toContain('강릉 캠퍼스')
    // 캠퍼스를 뗀 이름의 파일(강원대학교 = 춘천)은 받지 않는다
    expect(t.downloads.some((u) => u.includes(`${encodeURIComponent('강원대학교')}/`))).toBe(false)
  })

  it('검수 AI가 원문이 맞지 않다고 하면 가져온 자료를 내리고 까닭을 남긴다', async () => {
    const t = setup()
    await t.importer.importNow('gachon')
    expect(t.importer.reject('gachon', '다른 캠퍼스 원문이에요.')).toBe(true)
    expect(t.datasets.plan('gachon')).toBeNull()
    expect(t.importer.list().find((x) => x.univ === 'gachon')).toMatchObject({ status: 'failed', detail: '다른 캠퍼스 원문이에요.' })
    // 가져온 자료가 아니면 건드리지 않는다
    expect(t.importer.reject('kangnam', 'x')).toBe(false)
  })

  it('AI 연결 오류면 기다림으로 두고 멈춘다 (다시 해 볼 횟수에 세지 않는다)', async () => {
    const t = setup({ fail: new AiError(429, 'AI 사용량이 몰려 있어요.') })
    const r = await t.importer.importNow('gachon')
    expect(r).toMatchObject({ state: 'waiting', stop: true })
    expect(t.importer.list().find((x) => x.univ === 'gachon')).toMatchObject({ status: 'waiting', tries: 0 })
    expect(t.datasets.plan('gachon')).toBeNull()
    // 503·429는 기다렸다가 두 번 더 물어본 뒤에 멈춘다
    expect(t.calls).toHaveLength(3)
  })

  it('무료 Gemini 모델이 한도에 걸리면 같은 키의 다른 무료 모델로 바로 다시 묻는다', async () => {
    const db = new DatabaseSync(':memory:')
    const datasets = new Datasets(db, { year: 2028, plans: [] })
    const used: string[] = []
    const answer = chatFor([])
    const importer = new PlanImporter(db, datasets, {
      download: async () => file(PAGES),
      read,
      ai: () => ({ ...AI, kind: 'google', model: 'gemini-3.6-flash', visionModel: 'gemini-3.6-flash' }),
      chat: async (cfg, req) => {
        used.push(cfg.visionModel)
        if (cfg.visionModel === 'gemini-3.6-flash') throw new AiError(429, 'AI 사용량이 몰려 있어요.')
        return answer(cfg, req)
      },
      enabled: () => false,
      limit: () => 25,
      pause: 0,
      retryWait: 0,
      adiga: async () => null,
    })
    expect(await importer.importNow('gachon')).toMatchObject({ state: 'done' })
    // 한 번 걸린 모델은 그 뒤로 다시 부르지 않는다
    expect(used).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash'])
    expect(importer.state().model).toBe('gemini-3.5-flash')
  })

  it('정해 둔 원문을 못 받으면 어디가에 대학이 올린 파일을 받는다', async () => {
    const adigaFile = 'https://www.adiga.kr/cmm/com/file/fileDown.do?fileId=1&fileSn=1'
    const t = setup({ files: new Map([[adigaFile, file(PAGES)]]), adiga: async (code) => (code === '0000063' ? adigaFile : null) })
    expect(await t.importer.importNow('gachon')).toMatchObject({ state: 'done' })
    expect(t.datasets.plan('gachon')?.url).toBe(adigaFile)
  })

  it('받은 파일이 짧은 안내문이면 다음 후보로 넘어간다', async () => {
    const adigaFile = 'https://www.adiga.kr/cmm/com/file/fileDown.do?fileId=2&fileSn=1'
    const src = cdnUrl('가천대학교')
    const t = setup({
      files: new Map([
        [src, file(['2028학년도 시행계획은 입학처 누리집을 보세요.'])],
        [adigaFile, file(PAGES)],
      ]),
      adiga: async () => adigaFile,
    })
    expect(await t.importer.importNow('gachon')).toMatchObject({ state: 'done' })
    expect(t.datasets.plan('gachon')?.url).toBe(adigaFile)
  })

  it('그림으로 된 PDF는 AI가 쪽 그림을 보고 옮겨 적은 뒤에 옮긴다', async () => {
    const rendered: number[][] = []
    const blank = file(['', '', '', '', ''])
    let ocrCalls = 0
    const t = setup({
      files: new Map([[cdnUrl('가천대학교'), blank]]),
      render: async (_buf, pages) => (rendered.push(pages), pages.map((p) => `data:image/png;base64,${p}`)),
      chat: async (cfg, req) => {
        if (req.system.includes('글자를 옮겨 적는')) {
          ocrCalls++
          expect(req.images?.length).toBeGreaterThan(0)
          return JSON.stringify({ pages: req.user.match(/\d+/g)!.map((n) => ({ page: Number(n), text: PAGES[Number(n) - 1] ?? '' })) })
        }
        return t.answer(cfg, req)
      },
    })
    expect(await t.importer.importNow('gachon')).toMatchObject({ state: 'done' })
    expect(rendered).toEqual([[1, 2, 3, 4], [5]])
    expect(ocrCalls).toBe(2)
    expect(t.datasets.plan('gachon')?.tracks.length).toBe(3)
  })

  it('쪽은 많은데 쪽마다 글자가 몇 줄뿐인 PDF도 그림으로 보고 AI가 옮겨 적는다', async () => {
    // 10쪽, 쪽마다 글자 200자 = 모두 2,000자 (기준 1,500자는 넘지만 쪽마다 너무 적다)
    const sparse = file(Array.from({ length: 10 }, (_, i) => `${i + 1}쪽 머리글 ${'가'.repeat(190)}`))
    let ocr = 0
    const t = setup({
      files: new Map([[cdnUrl('가천대학교'), sparse]]),
      render: async (_buf, pages) => pages.map((p) => `data:image/png;base64,${p}`),
      chat: async (cfg, req) => {
        if (req.system.includes('글자를 옮겨 적는')) {
          ocr++
          return JSON.stringify({ pages: req.user.match(/\d+/g)!.map((n) => ({ page: Number(n), text: PAGES[Number(n) - 1] ?? '' })) })
        }
        return t.answer(cfg, req)
      },
    })
    expect(await t.importer.importNow('gachon')).toMatchObject({ state: 'done' })
    expect(ocr).toBe(3)
  })

  it('전형이 너무 적게 옮겨진 대학은 서버가 켜질 때 다시 옮길 차례에 넣고, 그때까지 자료는 그대로 둔다', async () => {
    const t = setup({ list: { ...LIST, totals: null, tracks: LIST.tracks.slice(0, 1) } })
    await t.importer.importNow('gachon')
    expect(t.importer.list().find((x) => x.univ === 'gachon')).toMatchObject({ status: 'done', tracks: 1 })
    t.db.prepare("update plan_import_meta set value = '5' where key = 'code'").run()
    const again = new PlanImporter(t.db, t.datasets, {
      download: async () => null,
      read,
      ai: () => AI,
      enabled: () => false,
      limit: () => 25,
      adiga: async () => null,
    })
    expect(again.list().find((x) => x.univ === 'gachon')).toMatchObject({ status: 'waiting' })
    expect(t.datasets.plan('gachon')?.tracks).toHaveLength(1)
  })

  it('AI 답이 출력 한도에 걸려 끊기면 연결 문제로 멈추지 않고 이 대학만 다시 해 볼 차례로 둔다', async () => {
    const t = setup({ fail: new AiError(502, 'AI 응답을 읽지 못했어요.', 'max_tokens') })
    const r = await t.importer.importNow('gachon')
    expect(r.stop).toBeFalsy()
    expect(t.importer.list().find((x) => x.univ === 'gachon')).toMatchObject({ status: 'waiting', tries: 1 })
    // 한 번 더 물어보고 그만둔다
    expect(t.calls).toHaveLength(2)
  })

  it('요금·키 같은 다른 연결 오류는 다시 묻지 않고 바로 멈춘다', async () => {
    const t = setup({ fail: new AiError(502, 'AI 서버가 오류를 냈어요.', 'HTTP 402') })
    expect(await t.importer.importNow('gachon')).toMatchObject({ state: 'waiting', stop: true })
    expect(t.calls).toHaveLength(1)
  })

  it('원문을 받지 못하면 AI를 부르지 않고 못 함으로 둔다', async () => {
    const t = setup({ files: new Map() })
    const r = await t.importer.importNow('gachon')
    expect(r.state).toBe('failed')
    expect(t.calls).toHaveLength(0)
    expect(t.importer.doneToday()).toBe(0)
    // 대교협 파일 저장소에서 이름으로도 찾아본다
    expect(t.downloads.some((u) => u.includes(encodeURIComponent('가천대학교')))).toBe(true)
  })

  it('관리자가 넣은 주소를 먼저 쓴다', async () => {
    const url = 'https://ipsi.example.ac.kr/plan.pdf'
    const t = setup({ files: new Map([[url, file(PAGES)]]) })
    t.importer.setUrl('gachon', url)
    expect(await t.importer.importNow('gachon')).toMatchObject({ state: 'done' })
    expect(t.downloads[0]).toBe(url)
    expect(t.datasets.plan('gachon')?.url).toBe(url)
    expect(t.importer.list().find((x) => x.univ === 'gachon')).toMatchObject({ custom: true, url })
  })

  it('켜 두면 하루 한도만큼만 차례로 옮긴다', async () => {
    const t = setup({ enabled: true, limit: 2 })
    t.importer.kick()
    await t.importer.idle()
    expect(t.importer.list().filter((x) => x.status === 'done')).toHaveLength(2)
    expect(t.importer.state()).toMatchObject({ doneToday: 2, current: null })
    expect(t.importer.state().note).toContain('내일')
  })

  it('가져온 자료를 지우면 다시 가져오지 않는다', async () => {
    const t = setup()
    await t.importer.importNow('gachon')
    t.datasets.revert('gachon', 'admin')
    expect(t.importer.list().find((x) => x.univ === 'gachon')).toMatchObject({ status: 'skipped' })
  })

  it('2028 전형을 내지 않은 곳은 가져오지 않는다', () => {
    const t = setup()
    expect(t.importer.list().find((x) => x.univ === 'kma')).toMatchObject({ status: 'skipped' })
  })
})

describe('가져오기를 저절로 돌릴지', () => {
  it('관리자가 켜지 않았으면 무료 Gemini 연결이 있을 때만 저절로 돌고, 관리자가 시작하면 고른 연결로도 돈다', () => {
    const s = servicesFor(new Store(':memory:'), {})
    expect(s.importer.state().enabled).toBe(false)
    const claude = s.ai.create(
      cleanProvider({ kind: 'anthropic', name: 'Claude', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test-0000-abcd1234wxyz' }, { requireKey: true }),
    )
    s.ai.select(claude.id)
    expect(s.importer.state().enabled).toBe(false)
    s.ai.create(cleanProvider({ kind: 'google', name: 'Gemini', model: 'gemini-3.6-flash', apiKey: 'AIza-test-1234-abcd5678efgh' }, { requireKey: true }))
    expect(s.importer.state().enabled).toBe(true)
    // 끄면 꺼지고, 다시 켜면 기본값과 같아도 관리자가 고른 값으로 남는다
    s.settings.save({ planImport: false }, { always: true })
    expect(s.importer.state().enabled).toBe(false)
    s.ai.remove(s.ai.list().find((p) => p.kind === 'google')!.id)
    s.settings.save({ planImport: true }, { always: true })
    expect(s.importer.state().enabled).toBe(true)
  })
})

describe('원문 찾기', () => {
  it('게시글 첨부는 2028 시행계획 PDF를 먼저, 다른 해 자료는 빼고 고른다', () => {
    const files = rankPlanFiles([
      { url: 'https://u.ac.kr/download/scholarship-guide.pdf', name: '장학제도' },
      { url: 'https://u.ac.kr/files/susi_p_2025_2.pdf', name: 'PDF 크게보기' },
      { url: 'https://u.ac.kr/cmm/fms/FileDown.do?atchFileId=F1&fileSn=1', name: '2028학년도 대학입학전형 시행계획.hwp' },
      { url: 'https://u.ac.kr/cmm/fms/FileDown.do?atchFileId=F1&fileSn=0', name: '2028학년도 대학입학전형 시행계획.pdf' },
    ])
    expect(files.map((f) => f.name)).toEqual(['2028학년도 대학입학전형 시행계획.pdf', '2028학년도 대학입학전형 시행계획.hwp', '장학제도'])
  })

  it('원문 받기 방법이 나아지면 원문을 못 받아 그친 대학을 다시 차례에 넣는다', () => {
    const db = new DatabaseSync(':memory:')
    const datasets = new Datasets(db, { year: 2028, plans: [] })
    const deps = { download: async () => null, read, ai: () => AI, enabled: () => false, limit: () => 25 }
    new PlanImporter(db, datasets, deps)
    db.prepare("insert into plan_imports (univ, status, url, custom, detail) values ('gist', 'failed', '', 0, '원문 파일을 받지 못했어요.')").run()
    db.prepare(
      "insert into plan_imports (univ, status, url, custom, detail, attempted_at) values ('kosin', 'failed', '', 0, 'AI 답을 읽지 못했어요.', '2026-10-23')",
    ).run()
    db.prepare("update plan_import_meta set value = '1' where key = 'code'").run()
    const again = new PlanImporter(db, datasets, deps)
    expect(again.list().find((r) => r.univ === 'gist')?.status).toBe('waiting')
    // AI까지 불렀다가 그친 대학은 그대로 둔다
    expect(again.list().find((r) => r.univ === 'kosin')?.status).toBe('failed')
  })

  it('캠퍼스를 뗀 이름의 다른 캠퍼스 원문으로 옮긴 자료는 서버가 켜질 때 내린다', async () => {
    const t = setup()
    await t.importer.importNow('gachon')
    // 예전 방식으로 강원대(춘천) 파일을 받아 강릉 자료로 넣은 상태
    t.datasets.setPlan('kangwon-gangneung', { ...t.datasets.plan('gachon')!, univ: 'kangwon-gangneung', ai: '2026-10-23' }, 'AI', '')
    t.db
      .prepare(
        "insert into plan_imports (univ, status, url, custom, tracks, tries, attempted_at) values ('kangwon-gangneung', 'done', ?, 0, 3, 1, '2026-10-23')",
      )
      .run(cdnUrl('강원대학교'))
    t.db.prepare("update plan_import_meta set value = '2' where key = 'code'").run()
    const again = new PlanImporter(t.db, t.datasets, { download: async () => null, read, ai: () => AI, enabled: () => false, limit: () => 25 })
    expect(t.datasets.plan('kangwon-gangneung')).toBeNull()
    expect(again.list().find((r) => r.univ === 'kangwon-gangneung')).toMatchObject({ status: 'failed' })
    // 제 원문으로 옮긴 대학은 그대로
    expect(t.datasets.plan('gachon')).not.toBeNull()
  })
})

describe('가져오기 도우미', () => {
  it('한글 파일은 줄을 묶어 부분으로 본다', () => {
    const parts = partsOf({ kind: 'hwp', pages: Array.from({ length: 200 }, (_, i) => `${i}번째 줄 ${'가'.repeat(40)}`) })
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0].label).toBe('[1번째 부분]')
    expect(parts.every((p) => p.text.length < 3200)).toBe(true)
  })

  it('전형 목록에서 id를 고치고 겹치지 않게 한다', () => {
    const tracks = listTracks({
      tracks: [
        { id: '학교추천', name: '학교추천전형', type: '교과', period: '수시', quota: '정원내', seats: 10 },
        { id: '학교추천', name: '학교추천전형2', type: '교과', period: '수시', quota: '정원내', seats: 10 },
        { id: 'a', name: '가', type: '교과', period: '수시', quota: '정원외', seats: 1 },
        { id: 'a', name: '나', type: '교과', period: '수시', quota: '정원외', seats: 1 },
      ],
    })
    expect(tracks.map((t) => t.id)).toEqual(['track-1', 'track-2', 'a', 'a-2'])
  })

  it('세부가 길면 줄이고, 학교장 추천은 모양에 맞게 고친다', () => {
    const base = { id: 'x', name: '학교추천전형', type: '교과', period: '수시', quota: '정원내', seats: 10 }
    const t = fullTrack(base, { who: '가'.repeat(300), rec: { required: true, limit: 12 }, elements: ['교과', '없는요소'] }, '5')!
    expect((t.who as string).length).toBe(140)
    expect(t.rec).toEqual({ required: true, limit: null })
    expect(t.elements).toEqual(['교과'])
    expect(t.pages).toBe('5')
  })
})
