import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { AdmissionPlan, AdmissionTrack } from '../src/data/schema'
import { type AiConfig, AiError, type ChatRequest } from './ai'
import { Datasets } from './datasets'
import type { DocText } from './plan-update'
import { PlanVerifier } from './plan-verify'

const AI: AiConfig = {
  kind: 'anthropic',
  name: 'Claude',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'k',
  model: 'claude-sonnet-5-5',
  visionModel: 'claude-sonnet-5-5',
  maxTokensParam: 'max_tokens',
  jsonMode: false,
}

const PAGES = [
  '2028학년도 대학입학전형시행계획',
  '전형별 모집인원 학생부우수자 450 바람개비 400 일반전형 300',
  '학생부우수자 지원자격 졸업예정자 전형방법 교과 100% 수능 최저 국수영탐 2합 7',
  '바람개비 지원자격 졸업(예정)자 1단계 서류 100% 2단계 면접',
  '일반전형 수능 100%',
]
const DOC: DocText = { kind: 'pdf', pages: PAGES }

const track = (id: string, name: string, type: AdmissionTrack['type'], period: AdmissionTrack['period'], seats: number): AdmissionTrack => ({
  id,
  name,
  type,
  period,
  quota: '정원내',
  seats,
  grads: null,
  rec: null,
  schools: { only: [], exclude: [] },
  regions: [],
  special: [],
  who: '고교 졸업(예정)자',
  method: type === '수능' ? '수능 100%' : '서류 100%',
  elements: [type === '수능' ? '수능' : type === '교과' ? '교과' : type === '실기' ? '실기' : '서류'],
  min: null,
  subjects: null,
  note: null,
  pages: '2',
})

const plan = (univ: string, extra: Partial<AdmissionPlan> = {}): AdmissionPlan => ({
  univ,
  planTitle: '2028학년도 대학입학전형시행계획',
  url: 'https://cdn.example/plan.pdf',
  date: '2026-04-30',
  totals: null,
  changes: [],
  tracks: [
    track('school', '학생부우수자전형', '교과', '수시', 500),
    track('baram', '바람개비전형', '종합', '수시', 400),
    track('wrong', '연기예술학과', '실기', '정시', 6),
  ],
  ai: '2026-10-23',
  ...extra,
})

const FIXES = {
  verdict: '고침',
  changes: [
    { op: 'update', id: 'school', set: { seats: 450, min: '국수영탐 2합 7' } },
    { op: 'remove', id: 'wrong' },
    {
      op: 'add',
      track: {
        id: 'jeongsi',
        name: '일반전형',
        type: '수능',
        period: '정시',
        quota: '정원내',
        seats: 300,
        who: '고교 졸업(예정)자',
        method: '수능 100%',
        elements: ['수능'],
        pages: '5',
      },
    },
    // 틀린 값(없는 유형)은 적용하지 않는다
    { op: 'update', id: 'baram', set: { type: '면접' } },
  ],
  totals: { 수시: 850, 정시: 300 },
  unsure: [],
}

function setup(opts: { plans?: AdmissionPlan[]; answer?: unknown; fail?: Error; enabled?: boolean; limit?: number } = {}) {
  const db = new DatabaseSync(':memory:')
  const datasets = new Datasets(db, { year: 2028, plans: opts.plans ?? [plan('gachon'), plan('ajou', { ai: undefined })] })
  const calls: ChatRequest[] = []
  const rejected: string[] = []
  const verifier = new PlanVerifier(db, datasets, {
    snapshot: () => DOC,
    download: async () => null,
    read: async () => DOC,
    ai: () => AI,
    chat: async (_cfg, req) => {
      calls.push(req)
      if (opts.fail) throw opts.fail
      return JSON.stringify(opts.answer ?? FIXES)
    },
    enabled: () => opts.enabled ?? false,
    limit: () => opts.limit ?? 30,
    pause: 0,
    retryWait: 0,
    onReject: (univ) => rejected.push(univ),
  })
  return { datasets, verifier, calls, rejected }
}

describe('AI가 옮긴 전형 검수', () => {
  it('검수 AI가 원문과 대조해 고친 곳을 넣고 검수 표시를 붙인다', async () => {
    const t = setup()
    const r = await t.verifier.verifyNow('gachon')
    expect(r.state).toBe('done')
    const p = t.datasets.plan('gachon')!
    expect(p.ai).toBe('2026-10-23')
    expect(p.aiCheck).toMatch(/^20\d\d-\d\d-\d\d$/)
    expect(p.tracks.map((x) => x.id)).toEqual(['school', 'baram', 'jeongsi'])
    expect(p.tracks[0]).toMatchObject({ seats: 450, min: '국수영탐 2합 7' })
    expect(p.tracks[1].type).toBe('종합')
    // 합계가 전형별 인원 합과 맞아서 남는다
    expect(p.totals).toEqual({ 수시: 850, 정시: 300 })
    const row = t.verifier.list().find((x) => x.univ === 'gachon')!
    expect(row).toMatchObject({ status: 'done', model: 'claude-sonnet-5-5' })
    expect(row.changes).toBeGreaterThan(0)
    expect(row.detail).toContain('적용하지 못한 고침 1개')
    // 원문 쪽과 옮긴 자료를 함께 보낸다
    expect(t.calls[0].user).toContain('[2쪽]')
    expect(t.calls[0].user).toContain('"id":"wrong"')
  })

  it('고칠 곳이 없으면 그대로 두고 검수 표시만 붙인다', async () => {
    const t = setup({ answer: { verdict: '확인', changes: [], totals: null, unsure: [] } })
    await t.verifier.verifyNow('gachon')
    const p = t.datasets.plan('gachon')!
    expect(p.aiCheck).toBeTruthy()
    expect(p.tracks).toHaveLength(3)
    expect(t.verifier.list().find((x) => x.univ === 'gachon')).toMatchObject({ status: 'done', changes: 0 })
  })

  it('원문과 대조할 수 없다고 하면 고치지 않고 못 함으로 남긴다', async () => {
    const t = setup({ answer: { verdict: '판단 불가', changes: [{ op: 'remove', id: 'school' }], unsure: ['2027학년도 문서예요'] } })
    expect((await t.verifier.verifyNow('gachon')).state).toBe('failed')
    const p = t.datasets.plan('gachon')!
    expect(p.aiCheck).toBeUndefined()
    expect(p.tracks).toHaveLength(3)
    expect(t.verifier.list().find((x) => x.univ === 'gachon')?.detail).toContain('2027학년도')
    // 가져온 자료면 내리도록 알린다
    expect(t.rejected).toEqual(['gachon'])
  })

  it('AI 연결 오류면 기다림으로 두고 멈춘다', async () => {
    const t = setup({ fail: new AiError(502, 'AI 서버가 오류를 냈어요.', 'HTTP 402') })
    expect(await t.verifier.verifyNow('gachon')).toMatchObject({ state: 'waiting', stop: true })
    expect(t.verifier.list().find((x) => x.univ === 'gachon')).toMatchObject({ status: 'waiting', tries: 0 })
  })

  it('AI가 옮긴 대학만 하루 한도만큼 차례로 검수한다', async () => {
    const t = setup({ plans: [plan('gachon'), plan('kangnam'), plan('ajou', { ai: undefined })], enabled: true, limit: 1 })
    expect(t.verifier.list().map((x) => x.univ)).toEqual(['gachon', 'kangnam'])
    t.verifier.kick()
    await t.verifier.idle()
    expect(t.verifier.list().filter((x) => x.status === 'done')).toHaveLength(1)
    expect(t.verifier.state().note).toContain('내일')
  })

  it('다시 가져오면 검수 표시가 없어져 다시 차례를 기다린다', async () => {
    const t = setup()
    await t.verifier.verifyNow('gachon')
    t.datasets.setPlan('gachon', plan('gachon'), 'AI', '다시 가져옴')
    t.verifier.reset('gachon')
    expect(t.verifier.list().find((x) => x.univ === 'gachon')).toMatchObject({ status: 'waiting' })
  })
})
