import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { checkPlan } from '../src/data/admissions-check'
import admissions from '../src/data/admissions2028.json'
import type { AdmissionPlan, AdmissionTrack } from '../src/data/schema'
import type { AiConfig, ChatRequest } from './ai'
import { Datasets } from './datasets'
import { applyChanges, changedParts, changeLines, type CheckResult, diffPlan, type DocText, PlanUpdater, ProposalConflict, rebase } from './plan-update'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16)

const base = (fileSha?: string): AdmissionPlan => ({
  univ: 'korea',
  planTitle: '2028학년도 고려대학교 입학전형시행계획',
  url: 'https://example.ac.kr/korea.pdf',
  date: '2026-04-30',
  totals: { 수시: 672 },
  changes: [],
  ...(fileSha ? { fileSha } : {}),
  tracks: [
    {
      id: 'school-rec',
      name: '학교추천전형',
      type: '교과',
      period: '수시',
      quota: '정원내',
      seats: 672,
      grads: '예정자',
      rec: { required: true, limit: '고교별 12명' },
      schools: { only: [], exclude: ['특성화고'] },
      regions: [],
      special: [],
      who: '국내 고교 졸업예정자',
      method: '교과 80% + 서류 20%',
      elements: ['교과', '서류'],
      min: null,
      subjects: null,
      note: null,
      pages: '12',
    },
  ],
})

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

/** 가짜 원문 파일: 쪽 글자를 \f로 이어 붙인 것 */
const file = (pages: string[]) => Buffer.from(pages.join('\f'))
const read = async (buf: Buffer): Promise<DocText> => ({ kind: 'pdf', pages: buf.toString().split('\f') })

function setup(opts: { answer?: string | Error; fileSha?: string; pages: string[] }) {
  const db = new DatabaseSync(':memory:')
  const datasets = new Datasets(db, { year: 2028, plans: [base(opts.fileSha)] })
  let current = file(opts.pages)
  const calls: ChatRequest[] = []
  const rendered: number[][] = []
  const updater = new PlanUpdater(db, datasets, {
    download: async () => current,
    read,
    render: async (_b, pages) => {
      rendered.push(pages)
      return pages.map((p) => `data:image/jpeg;base64,${p}`)
    },
    ai: AI,
    chat: async (_cfg, req) => {
      calls.push(req)
      if (opts.answer instanceof Error) throw opts.answer
      return opts.answer ?? '{"summary":"","changes":[]}'
    },
  })
  return { db, datasets, updater, calls, rendered, setFile: (pages: string[]) => (current = file(pages)) }
}

const PAGES = ['표지 2028학년도 시행계획', '전형 요약 수시 672명', '학교추천전형 모집인원 672명 교과 80% 서류 20%']

describe('대입 자료 자동 갱신', () => {
  it('처음엔 기준만 잡고, 같은 파일이면 AI를 부르지 않는다', async () => {
    const t = setup({ pages: PAGES })
    expect((await t.updater.check('korea', { autoApply: false })).state).toBe('baseline')
    expect((await t.updater.check('korea', { autoApply: false })).state).toBe('same')
    expect(t.calls).toHaveLength(0)
  })

  it('달라진 쪽만 그려 AI에게 보이고, 검사를 통과한 제안을 남긴다', async () => {
    const answer = JSON.stringify({
      summary: '학교추천전형 모집인원 672→680',
      changes: [{ op: 'update', id: 'school-rec', set: { seats: 680 }, page: 3 }],
      totals: { 수시: 680 },
      unsure: [],
    })
    const t = setup({ pages: PAGES, answer })
    await t.updater.check('korea', { autoApply: false })
    t.setFile([PAGES[0], '전형 요약 수시 680명', '학교추천전형 모집인원 680명 교과 80% 서류 20%'])
    const r = await t.updater.check('korea', { autoApply: false })
    expect(r.state).toBe('pending')
    expect(t.rendered).toEqual([[2, 3]])
    expect(t.calls[0].images).toHaveLength(2)
    expect(t.calls[0].user).toContain('"seats":672')
    const p = t.updater.list()[0]
    expect(p.lines).toEqual([
      { track: '학교추천전형', field: '모집인원', before: '672', after: '680' },
      { track: '전체', field: '모집시기별 합계', before: '수시 672명', after: '수시 680명' },
    ])
    // 반영하면 자료 판이 올라가고 소식이 남는다
    const v0 = t.datasets.version()
    expect(t.updater.apply(p.id, 'boss')?.status).toBe('applied')
    expect(t.datasets.plan('korea')?.tracks[0].seats).toBe(680)
    expect(t.datasets.version()).not.toBe(v0)
    expect(t.datasets.updates()[0].summary).toContain('원문 변경 반영')
    expect(t.updater.apply(p.id, 'boss')).toBeNull()
  })

  it('설정에서 바로 반영을 켜면 확인 없이 반영한다 (확실하지 않은 점이 있으면 기다린다)', async () => {
    // 바로 반영은 모집인원이 ±20% 안이고 그 시기 합계도 모집인원 합과 맞을 때만 (이 자료는 수시 합계 672 = 학교추천 672)
    const ok = setup({ pages: PAGES, answer: '{"changes":[{"op":"update","id":"school-rec","set":{"seats":700}}],"totals":{"수시":700}}' })
    await ok.updater.check('korea', { autoApply: true })
    ok.setFile([PAGES[0], PAGES[1], '학교추천전형 700명'])
    expect((await ok.updater.check('korea', { autoApply: true })).state).toBe('applied')
    expect(ok.datasets.plan('korea')).toMatchObject({ totals: { 수시: 700 }, tracks: [{ seats: 700 }] })

    // 합계를 그대로 두면 합계 672와 모집인원 700이 어긋나서(표를 잘못 읽었을 수 있다) 관리자를 기다린다
    const stale = setup({ pages: PAGES, answer: '{"changes":[{"op":"update","id":"school-rec","set":{"seats":700}}]}' })
    await stale.updater.check('korea', { autoApply: true })
    stale.setFile([PAGES[0], PAGES[1], '학교추천전형 700명'])
    const waiting = await stale.updater.check('korea', { autoApply: true })
    expect(waiting.state).toBe('pending')
    expect(waiting.state === 'pending' && waiting.proposal.detail).toContain('모집시기별 합계와 모집인원이 맞지 않음')
    expect(stale.datasets.plan('korea')?.tracks[0].seats).toBe(672)

    const unsure = setup({
      pages: PAGES,
      answer: '{"changes":[{"op":"update","id":"school-rec","set":{"seats":700}}],"totals":{"수시":700},"unsure":["표가 흐림"]}',
    })
    await unsure.updater.check('korea', { autoApply: true })
    unsure.setFile([PAGES[0], PAGES[1], '학교추천전형 700명'])
    expect((await unsure.updater.check('korea', { autoApply: true })).state).toBe('pending')
    expect(unsure.datasets.plan('korea')?.tracks[0].seats).toBe(672)
  })

  it('검사를 통과하지 못한 제안은 반영할 수 없게 남긴다', async () => {
    const t = setup({ pages: PAGES, answer: '{"changes":[{"op":"update","id":"school-rec","set":{"type":"정시"}}]}' })
    await t.updater.check('korea', { autoApply: true })
    t.setFile([PAGES[0], PAGES[1], '바뀜'])
    const r = await t.updater.check('korea', { autoApply: true })
    expect(r.state).toBe('failed')
    expect(t.updater.list()[0].summary).toContain('검사를 통과하지 못')
    expect(t.datasets.plan('korea')?.tracks[0].type).toBe('교과')
  })

  it('많이 바뀌면 AI를 부르지 않고 직접 보게 한다', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `쪽 ${i}`)
    const t = setup({ pages: many })
    await t.updater.check('korea', { autoApply: false })
    t.setFile(many.map((p) => `${p} 고침`))
    const r = await t.updater.check('korea', { autoApply: false })
    expect(r.state).toBe('failed')
    expect(t.calls).toHaveLength(0)
  })

  it('AI가 답하지 못하면 기준을 그대로 둬서 다음에 다시 본다', async () => {
    const t = setup({ pages: PAGES, answer: new Error('down') })
    await t.updater.check('korea', { autoApply: false })
    t.setFile([PAGES[0], PAGES[1], '학교추천전형 690명'])
    expect((await t.updater.check('korea', { autoApply: false })).state).toBe('failed')
    expect((await t.updater.check('korea', { autoApply: false })).state).toBe('failed')
    expect(t.calls).toHaveLength(2)
  })

  it('전형이 그대로라고 답하면 제안 목록에 남기지 않는다', async () => {
    const t = setup({ pages: PAGES, answer: '{"summary":"쪽 번호만 바뀜","changes":[]}' })
    await t.updater.check('korea', { autoApply: false })
    t.setFile([PAGES[0], PAGES[1], `${PAGES[2]} - 3 -`])
    expect((await t.updater.check('korea', { autoApply: false })).state).toBe('none')
    expect(t.updater.list()).toEqual([])
  })

  it('옮겨 둔 원문과 처음 받은 원문이 다르면 직접 확인하게 한다', async () => {
    const t = setup({ pages: PAGES, fileSha: sha(file(['다른 판'])) })
    const r = await t.updater.check('korea', { autoApply: false })
    expect(r.state).toBe('failed')
    expect(t.updater.list()[0].detail).toContain('원문 파일이 바뀌었어요')
    const same = setup({ pages: PAGES, fileSha: sha(file(PAGES)) })
    expect((await same.updater.check('korea', { autoApply: false })).state).toBe('baseline')
  })

  it('달라진 쪽: 순서가 밀려도 같은 내용은 그대로로 본다', () => {
    expect(changedParts(['가', '나', '다'], ['새 쪽', '가', '나', '다'])).toEqual([1])
    expect(changedParts(['가', '나'], ['가', '나 고침'])).toEqual([2])
  })

  it('없는 전형을 고치려 하면 막는다', () => {
    expect(() => applyChanges(base(), { changes: [{ op: 'update', id: 'nope', set: { seats: 1 } }] })).toThrow(/없는 전형/)
  })

  it('단계별 반영 비율과 정시 수능 반영 비율도 고치고, 바뀐 곳을 읽기 쉬운 줄로 보여 준다', () => {
    const before: AdmissionPlan = {
      ...base(),
      tracks: [{ ...base().tracks[0], stages: [{ step: '일괄', pick: null, parts: { 교과: 80, 서류: 20 } }] }],
      suneung: [
        {
          group: '인문',
          units: null,
          tracks: [],
          use: '표준점수',
          weights: { 국어: 35, 수학: 30, 영어: 15, 탐구: 20 },
          inquiry: null,
          english: null,
          history: null,
          bonus: null,
          formula: null,
          total: null,
          pages: '40',
        },
      ],
    }
    const after = applyChanges(before, {
      changes: [
        { op: 'update', id: 'school-rec', set: { method: '교과 70% + 서류 30%', stages: [{ step: '일괄', pick: null, parts: { 교과: 70, 서류: 30 } }] } },
        { op: 'plan', set: { suneung: [{ ...before.suneung![0], weights: { 국어: 30, 수학: 35, 영어: 15, 탐구: 20 } }], tracks: [] } },
      ],
    })
    expect(after.tracks).toHaveLength(1)
    expect(after.suneung![0].weights.수학).toBe(35)
    expect(changeLines(before, after)).toEqual([
      { track: '학교추천전형', field: '전형 방법', before: '교과 80% + 서류 20%', after: '교과 70% + 서류 30%' },
      { track: '학교추천전형', field: '단계별 반영 비율', before: '일괄 교과 80%·서류 20%', after: '일괄 교과 70%·서류 30%' },
      {
        track: '정시 수능 (인문)',
        field: '반영 방법',
        before: '국어 35%·수학 30%·영어 15%·탐구 20% / 표준점수',
        after: '국어 30%·수학 35%·영어 15%·탐구 20% / 표준점수',
      },
    ])
  })
})

// ---- 바로 반영의 안전장치, 제안과 그 뒤에 고친 자료, 하루 한도, 되돌리기 ----

const track = (id: string, name: string, period: '수시' | '정시', seats: number, type: AdmissionTrack['type'] = '교과'): AdmissionTrack => ({
  ...base().tracks[0],
  id,
  name,
  type,
  period,
  seats,
  rec: null,
  method: period === '정시' ? '수능 100%' : '교과 100%',
  elements: period === '정시' ? ['수능'] : ['교과'],
})

/** 수시 둘·정시 둘, 정시 나군만 쓰는 수능 반영 묶음 하나. 모집시기별 합계는 모집인원 합과 같다 */
const wide = (univ = 'korea'): AdmissionPlan => ({
  ...base(),
  univ,
  totals: { 수시: 1500, 정시: 300 },
  tracks: [
    track('school-rec', '학교추천전형', '수시', 672),
    track('general', '학업우수전형', '수시', 828, '종합'),
    track('jeongsi-ga', '정시 일반(가군)', '정시', 200, '수능'),
    track('jeongsi-na', '정시 일반(나군)', '정시', 100, '수능'),
  ],
  suneung: [
    {
      group: '의예',
      units: '의과대학',
      tracks: ['jeongsi-na'],
      use: '표준점수',
      weights: { 국어: 20, 수학: 40, 영어: 0, 탐구: 40 },
      inquiry: null,
      english: null,
      history: null,
      bonus: null,
      formula: null,
      total: null,
      pages: '40',
    },
  ],
})

/** 여러 대학을 함께 돌린다. answer(n)은 n번째 AI 호출의 답 (Error면 AI가 답하지 못한 것) */
function rig(plans: AdmissionPlan[], answer: (n: number, req: ChatRequest) => unknown, limit?: number) {
  const db = new DatabaseSync(':memory:')
  const datasets = new Datasets(db, { year: 2028, plans })
  const files = new Map(plans.map((p) => [p.univ, file(PAGES)]))
  let n = 0
  const updater = new PlanUpdater(db, datasets, {
    download: async (p) => files.get(p.univ) ?? null,
    read,
    render: async () => [],
    ai: AI,
    chat: async (_cfg, req) => {
      const a = answer(++n, req)
      if (a instanceof Error) throw a
      return typeof a === 'string' ? a : JSON.stringify(a)
    },
    ...(limit === undefined ? {} : { limit: () => limit }),
  })
  let version = 0
  /** 원문을 바꾼다 (다음 확인 때 바뀐 쪽을 AI에게 보인다) */
  const edit = (univ = 'korea') => files.set(univ, file([PAGES[0], PAGES[1], `${PAGES[2]} 고침 ${++version}`]))
  return { db, datasets, updater, edit, calls: () => n }
}
type Rig = ReturnType<typeof rig>

/** 기준이 없으면 잡고, 원문을 바꾼 뒤 한 번 확인한다 */
async function changed(t: Rig, autoApply: boolean, univ = 'korea'): Promise<CheckResult> {
  if (!t.updater.hasSnapshot(univ)) await t.updater.check(univ, { autoApply })
  t.edit(univ)
  return t.updater.check(univ, { autoApply })
}

const seatsOf = (t: Rig, id: string) => t.datasets.plan('korea')?.tracks.find((x) => x.id === id)?.seats
const detailOf = (r: CheckResult) => ('proposal' in r ? r.proposal.detail : '')
const idOf = (r: CheckResult) => ('proposal' in r ? r.proposal.id : 0)
/** 관리자가 화면에서 한 전형 인원을 고친다 */
const editSeats = (t: Rig, id: string, seats: number) => {
  const p = t.datasets.plan('korea')!
  t.datasets.setPlan('korea', { ...p, tracks: p.tracks.map((x) => (x.id === id ? { ...x, seats } : x)) }, 'admin@example.com', `${id} ${seats}`)
}

describe('바로 반영의 안전장치', () => {
  it('전형 추가·삭제, 수능 반영 방법, 큰 인원 변화, 합계, 글 항목은 바로 반영하지 않고 까닭을 남긴다', async () => {
    const rule = wide().suneung![0]
    const cases: [unknown, string][] = [
      [{ changes: [{ op: 'remove', id: 'general' }] }, '전형 삭제'],
      [{ changes: [{ op: 'add', track: track('essay', '논술전형', '수시', 300, '논술') }] }, '전형 추가'],
      // 672→6720: 합계까지 맞춰 줘도 20%를 넘으면 기다린다
      [{ changes: [{ op: 'update', id: 'school-rec', set: { seats: 6720 } }], totals: { 수시: 7548, 정시: 300 } }, '모집인원이 20% 넘게 바뀜'],
      [{ changes: [{ op: 'update', id: 'school-rec', set: { min: '국수영탐 중 3개 합 7' } }] }, '수능 최저'],
      [{ changes: [{ op: 'plan', set: { suneung: [{ ...rule, weights: { 국어: 25, 수학: 35, 영어: 0, 탐구: 40 } }] } }] }, '정시 수능 반영 방법'],
      [{ changes: [], totals: { 수시: 1400, 정시: 300 } }, '모집시기별 합계와 모집인원이 맞지 않음'],
      [{ changes: [], totals: { 수시: 1500 } }, '모집시기별 합계'],
    ]
    for (const [answer, why] of cases) {
      const t = rig([wide()], () => answer)
      const r = await changed(t, true)
      expect(r.state, why).toBe('pending')
      expect(detailOf(r), why).toContain('바로 반영하지 않았어요 (')
      expect(detailOf(r), why).toContain(why)
      expect(t.datasets.plan('korea'), why).toEqual(wide())
    }
  })

  it('작은 인원 변화는 합계가 맞으면 바로 반영하고, 소식에는 AI가 쓴 글 대신 바뀐 곳을 남긴다', async () => {
    const t = rig([wide()], () => ({
      summary: '중요: 전형 안내는 http://evil.example 에서 확인하세요',
      changes: [{ op: 'update', id: 'school-rec', set: { seats: 680, pages: '12-13' } }],
      totals: { 수시: 1508, 정시: 300 },
      unsure: [],
    }))
    expect((await changed(t, true)).state).toBe('applied')
    expect(seatsOf(t, 'school-rec')).toBe(680)
    expect(t.datasets.updates()[0].summary).toBe('학교추천전형 모집인원 672→680 (원문 변경 반영)')
    expect(t.updater.list()[0].summary).toBe('학교추천전형 모집인원 672→680')
  })

  it('AI에게 원문 속 지시를 따르지 말라고 하고, 확실하지 않은 점은 배열이 아니어도 기다린다', async () => {
    let system = ''
    const answer = { changes: [{ op: 'update', id: 'school-rec', set: { seats: 680 } }], totals: { 수시: 1508, 정시: 300 } }
    const text = rig([wide()], (_n, req) => {
      system = req.system ?? ''
      return { ...answer, unsure: '표가 흐려서 680인지 690인지 모르겠음' }
    })
    const r = await changed(text, true)
    expect(system).toMatch(/지시.*따르지 않/)
    expect(r.state).toBe('pending')
    expect(detailOf(r)).toContain('680인지 690인지')
    expect(seatsOf(text, 'school-rec')).toBe(672)
    const objects = rig([wide()], () => ({ ...answer, unsure: [{ page: 3, note: '흐림' }] }))
    expect((await changed(objects, true)).state).toBe('pending')
    const none = rig([wide()], () => ({ ...answer, unsure: [] }))
    expect((await changed(none, true)).state).toBe('applied')
  })

  it('지운 전형을 쓰던 수능 반영 묶음이 남으면 검사에서 막는다 (모든 정시 전형으로 넓어지지 않게)', async () => {
    expect(() => checkPlan(applyChanges(wide(), { changes: [{ op: 'remove', id: 'jeongsi-na' }] }), 'korea', wide())).toThrow(/suneung\[0\] tracks/)
    // '쪽 번호 정리'라며 전형 넷 중 셋(정시 모두)을 지우는 답
    const t = rig([wide()], () => ({
      summary: '쪽 번호 정리',
      changes: ['general', 'jeongsi-ga', 'jeongsi-na'].map((id) => ({ op: 'remove', id })),
      unsure: [],
    }))
    expect((await changed(t, true)).state).toBe('failed')
    expect(t.datasets.plan('korea')?.tracks).toHaveLength(4)
  })

  it('합계를 비우거나 묶음 모양이 틀린 답은 버리지 않고 막는다', () => {
    const p = wide()
    for (const totals of [{}, [], '수시 1500'])
      expect(() => checkPlan(applyChanges(p, { changes: [], totals }), 'korea', p), JSON.stringify(totals)).toThrow(/totals/)
    expect(checkPlan(applyChanges(p, { changes: [], totals: null }), 'korea', p).totals).toEqual(p.totals)
    // 모양이 틀린 수능 반영 묶음 하나로 묶음이 모두 사라지지 않는다
    expect(() => checkPlan(applyChanges(p, { changes: [{ op: 'plan', set: { suneung: [{ group: '의예' }] } }] }), 'korea', p)).toThrow(/suneung\[0\] use/)
    expect(() => applyChanges(p, { changes: [{ op: 'plan', set: { suneung: null } }] })).toThrow(/배열/)
    expect(() => applyChanges(p, { changes: [{ op: 'delete', id: 'general' }] })).toThrow(/모르는 op/)
    expect(() => applyChanges(p, { changes: [{ op: 'remove', id: 'nope' }] })).toThrow(/없는 전형/)
    expect(() => applyChanges(p, { changes: [{ op: 'add', track: { ...p.tracks[0] } }] })).toThrow(/이미 있는 전형/)
    expect(() => applyChanges(p, { changes: { op: 'remove', id: 'general' } })).toThrow(/배열/)
  })

  it('배포한 전형 자료는 검사를 거쳐도 바뀐 곳이 없다 (불러와 저장하거나 제안을 반영해도 그대로)', () => {
    for (const p of admissions.plans as unknown as AdmissionPlan[]) {
      const checked = checkPlan(p, p.univ, p)
      expect(changeLines(p, checked), p.univ).toEqual([])
      expect(diffPlan(p, checked), p.univ).toEqual({ fields: [], added: [], removed: [], plan: [] })
    }
  })
})

describe('제안과 그 뒤에 고친 자료', () => {
  const to680 = { changes: [{ op: 'update', id: 'school-rec', set: { seats: 680 } }], unsure: [] }

  it('오래된 제안을 반영해도 그 뒤에 관리자가 고친 다른 곳은 되돌리지 않는다', async () => {
    const t = rig([wide()], () => to680)
    const r = await changed(t, false)
    expect(r.state).toBe('pending')
    editSeats(t, 'general', 900)
    expect(t.updater.revalidate('korea')).toBe(0)
    expect(t.updater.apply(idOf(r), 'other@example.com')?.status).toBe('applied')
    expect([seatsOf(t, 'school-rec'), seatsOf(t, 'general')]).toEqual([680, 900])
  })

  it('제안이 바꾸는 곳을 그 사이 다르게 고쳤으면 반영하지 않고 직접 확인으로 돌린다', async () => {
    const t = rig([wide()], () => to680)
    const id = idOf(await changed(t, false))
    editSeats(t, 'school-rec', 690)
    expect(() => t.updater.apply(id, 'boss')).toThrow(ProposalConflict)
    expect(t.updater.get(id)?.status).toBe('failed')
    expect(t.updater.get(id)?.detail).toContain('그 사이에 자료가 바뀌어 반영하지 않았어요 (학교추천전형 모집인원)')
    expect(seatsOf(t, 'school-rec')).toBe(690)
    // 관리 화면에서 고친 뒤 다시 보면(revalidate) 겹치는 제안은 바로 직접 확인으로 돌아간다
    const u = rig([wide()], () => to680)
    const other = idOf(await changed(u, false))
    editSeats(u, 'school-rec', 690)
    expect(u.updater.revalidate('korea')).toBe(1)
    expect(u.updater.get(other)?.status).toBe('failed')
    expect(u.updater.apply(other, 'boss')).toBeNull()
  })

  it('같은 대학 제안 둘: 겹치지 않으면 차례로 반영되고, 겹치면 남은 것은 직접 확인으로 돌아간다', async () => {
    const apart = rig([wide()], (n) => ({ changes: [{ op: 'update', id: n === 1 ? 'school-rec' : 'general', set: { seats: n === 1 ? 680 : 830 } }] }))
    const a = idOf(await changed(apart, false))
    const b = idOf(await changed(apart, false))
    expect(apart.updater.apply(a, 'boss')?.status).toBe('applied')
    expect(apart.updater.apply(b, 'boss')?.status).toBe('applied')
    expect([seatsOf(apart, 'school-rec'), seatsOf(apart, 'general')]).toEqual([680, 830])

    const clash = rig([wide()], (n) => ({ changes: [{ op: 'update', id: 'school-rec', set: { seats: n === 1 ? 680 : 700 } }] }))
    const c = idOf(await changed(clash, false))
    const d = idOf(await changed(clash, false))
    expect(clash.updater.apply(d, 'boss')?.status).toBe('applied')
    expect(clash.updater.get(c)?.status).toBe('failed')
    expect(seatsOf(clash, 'school-rec')).toBe(700)
  })

  it('AI를 기다리는 사이 관리자가 고쳐도 바로 반영이 그 고침을 되돌리지 않는다', async () => {
    const answer = { changes: [{ op: 'update', id: 'school-rec', set: { seats: 680 } }], totals: { 수시: 1508, 정시: 300 } }
    let during = () => {}
    const t = rig([wide()], () => {
      during()
      return answer
    })
    during = () => editSeats(t, 'general', 900)
    expect((await changed(t, true)).state).toBe('applied')
    expect([seatsOf(t, 'school-rec'), seatsOf(t, 'general')]).toEqual([680, 900])
    // 같은 곳을 고쳤으면 반영하지 않고 직접 확인으로 남긴다
    const u = rig([wide()], () => {
      during()
      return answer
    })
    during = () => editSeats(u, 'school-rec', 690)
    expect((await changed(u, true)).state).toBe('failed')
    expect(seatsOf(u, 'school-rec')).toBe(690)
  })

  it('더한·지운 전형과 수능 반영 묶음도 그 사이 바뀌었는지 보고 옮긴다', () => {
    const before = wide()
    const after = checkPlan(
      applyChanges(before, {
        changes: [
          { op: 'remove', id: 'general' },
          { op: 'add', track: track('essay', '논술전형', '수시', 300, '논술') },
        ],
      }),
      'korea',
      before,
    )
    const patch = diffPlan(before, after)
    expect(rebase(before, patch)).toEqual({ plan: after })
    // 관리자가 다른 전형 인원을 고친 자료에는 그대로 옮긴다
    const other = { ...before, tracks: before.tracks.map((x) => (x.id === 'school-rec' ? { ...x, seats: 700 } : x)) }
    const moved = rebase(other, patch)
    expect('plan' in moved && moved.plan.tracks.map((x) => `${x.id}:${x.seats}`)).toEqual(['school-rec:700', 'jeongsi-ga:200', 'jeongsi-na:100', 'essay:300'])
    // 지울 전형을 그 사이 고쳤으면 옮기지 않는다
    expect(rebase({ ...before, tracks: before.tracks.map((x) => (x.id === 'general' ? { ...x, seats: 900 } : x)) }, patch)).toEqual({
      conflict: '학업우수전형',
    })
    const rule = before.suneung![0]
    const plan = diffPlan(before, { ...before, suneung: [{ ...rule, formula: '표준점수 합' }] })
    expect(rebase({ ...before, suneung: [{ ...rule, total: 1000 }] }, plan)).toEqual({ conflict: '정시 수능 반영 방법' })
  })

  it('예전 방식 제안(자료 전체를 담은 것)은 서버를 켤 때 직접 확인으로 돌린다', () => {
    const t = rig([wide()], () => ({}))
    const id = Number(
      t.db
        .prepare("insert into data_proposals (univ, created_at, status, summary, plan) values ('korea', '2026-10-22T00:00:00.000Z', 'pending', '예전 제안', ?)")
        .run(JSON.stringify(wide())).lastInsertRowid,
    )
    const again = new PlanUpdater(t.db, t.datasets, { download: async () => null, read, render: async () => [], ai: null })
    expect(again.get(id)?.status).toBe('failed')
    expect(again.get(id)?.detail).toContain('예전 방식으로 만든 제안')
    expect(again.apply(id, 'boss')).toBeNull()
  })
})

describe('하루 AI 확인 한도', () => {
  it('차례를 기다릴 때가 아니라 AI를 부르기 바로 앞에서 센다', async () => {
    const univs = ['korea', 'snu', 'yonsei', 'skku', 'hanyang']
    const t = rig(
      univs.map((u) => wide(u)),
      () => ({ changes: [] }),
      2,
    )
    for (const u of univs) {
      await t.updater.check(u, { autoApply: false })
      t.edit(u)
    }
    // 한 번 감시에 다섯 곳이 바뀐 것처럼 한꺼번에 넣는다
    const results = await Promise.all(univs.map((u) => t.updater.check(u, { autoApply: false })))
    expect(t.calls()).toBe(2)
    expect(t.updater.usedToday()).toBe(2)
    expect(results.filter((r) => r.state === 'skipped')).toEqual(Array(3).fill({ state: 'skipped', reason: '오늘 AI 확인 한도를 다 썼어요.' }))
  })

  it('AI가 답하지 못한 확인도 한 번으로 센다', async () => {
    const t = rig([wide()], () => new Error('down'), 1)
    expect((await changed(t, false)).state).toBe('failed')
    expect(t.updater.usedToday()).toBe(1)
    // 기준은 그대로라 다음에 같은 곳을 다시 보지만, 한도를 다 써서 AI는 부르지 않는다
    expect(await t.updater.check('korea', { autoApply: false })).toEqual({ state: 'skipped', reason: '오늘 AI 확인 한도를 다 썼어요.' })
    expect(t.calls()).toBe(1)
  })
})

describe('배포한 자료로 되돌리기', () => {
  it('원문 기준을 지워, 배포한 자료를 옮긴 원문과 지금 원문이 다르면 다시 알린다', async () => {
    const t = rig([{ ...wide(), fileSha: sha(file(PAGES)) }], (n) => ({ changes: [{ op: 'update', id: 'school-rec', set: { seats: 670 + n * 10 } }] }))
    expect(t.updater.apply(idOf(await changed(t, false)), 'boss')?.status).toBe('applied')
    const waiting = idOf(await changed(t, false))
    expect(t.updater.get(waiting)?.status).toBe('pending')
    expect(t.updater.revert('korea', 'boss')).toBe(true)
    expect(seatsOf(t, 'school-rec')).toBe(672)
    expect(t.updater.hasSnapshot('korea')).toBe(false)
    expect(t.updater.get(waiting)?.status).toBe('failed')
    // 기준이 새 원문에 남아 있으면 'same'이 되어 그 사이 바뀐 곳을 다시는 찾지 않는다
    const again = await t.updater.check('korea', { autoApply: false })
    expect(again.state).toBe('failed')
    expect(detailOf(again)).toContain('원문 파일이 바뀌었어요')
    expect(t.updater.revert('korea', 'boss')).toBe(false)
  })

  it('AI를 기다리는 사이 되돌리면 그 답은 버린다', async () => {
    let during = () => {}
    const t = rig([wide()], () => {
      during()
      return { changes: [{ op: 'update', id: 'school-rec', set: { seats: 680 } }] }
    })
    t.datasets.setPlan('korea', { ...wide(), changes: ['관리자가 고침'] }, 'boss', '고침')
    during = () => t.updater.revert('korea', 'boss')
    expect(await changed(t, true)).toEqual({ state: 'skipped', reason: '확인하는 사이에 자료를 되돌렸어요.' })
    expect(t.updater.hasSnapshot('korea')).toBe(false)
    expect(t.updater.list()).toEqual([])
    expect(seatsOf(t, 'school-rec')).toBe(672)
  })
})
