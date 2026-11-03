import { describe, expect, it } from 'vitest'
import type { AdmissionPlan, AdmissionTrack } from '../data/schema'
import { picksText } from '../lib/export'
import { contextOf, EMPTY_PROFILE } from './admissions'
import { dupNotes, isPickKey, pickKey, summarizePicks } from './picks'

const track = (id: string, patch: Partial<AdmissionTrack> = {}): AdmissionTrack => ({
  id,
  name: `전형${id}`,
  type: '종합',
  period: '수시',
  quota: '정원내',
  seats: 10,
  grads: '졸업자포함',
  rec: null,
  schools: { only: [], exclude: [] },
  regions: [],
  special: [],
  who: '',
  method: '서류 100%',
  elements: ['서류'],
  min: null,
  subjects: null,
  note: null,
  pages: '1',
  ...patch,
})
const plan = (univ: string, tracks: AdmissionTrack[]): AdmissionPlan => ({
  univ,
  planTitle: '',
  url: '',
  date: '2026-04-30',
  totals: null,
  changes: [],
  tracks,
})

const byUniv = new Map([
  [
    'korea',
    plan('korea', [
      track('a', { note: '학업우수전형과 중복지원 불가' }),
      track('b', { type: '교과', elements: ['교과'], min: '3합 7' }),
      track('c', { period: '정시', type: '수능', elements: ['수능'] }),
    ]),
  ],
  ['snu', plan('snu', [track('a', { elements: ['서류', '면접'] }), track('b', { special: ['rural'] })])],
  ['yonsei', plan('yonsei', [track('a', { type: '논술', elements: ['논술'] }), track('o', { period: '기타', special: ['overseas'] })])],
])
const ctx = contextOf(EMPTY_PROFILE, { kind: '일반고', region: '경기 화성' })

describe('원서 후보', () => {
  it('키 모양을 검사한다', () => {
    expect(isPickKey(pickKey('korea', 'school-rec'))).toBe(true)
    expect(isPickKey('korea')).toBe(false)
    expect(isPickKey('Korea:<b>')).toBe(false)
  })

  it('모집 시기별로 세고 기타 전형은 횟수와 따로 센다', () => {
    const s = summarizePicks(['korea:a', 'korea:b', 'korea:c', 'snu:a', 'yonsei:a', 'yonsei:o'], byUniv, ctx)
    expect(s.count).toEqual({ 수시: 4, 정시: 1, 기타: 1 })
    expect(s.needs).toEqual({ min: 1, interview: 1, essay: 1, practical: 0 })
  })

  it('같은 대학 수시 전형을 여럿 담으면 중복 지원 참고를 모은다', () => {
    const s = summarizePicks(['korea:a', 'korea:b', 'korea:c', 'snu:a'], byUniv, ctx)
    expect(s.sameUniv).toEqual([{ univ: 'korea', names: ['전형a', '전형b'], notes: ['학업우수전형과 중복지원 불가'] }])
  })

  it('참고 글에서 중복 지원 문장만 뽑는다', () => {
    expect(dupNotes('학폭 처분자 추천 불가. 학업우수전형 등과 중복지원 제한 없음')).toEqual(['학업우수전형 등과 중복지원 제한 없음'])
    expect(dupNotes('고른기회·다문화·재직자전형 중 1개 전형만 지원 가능')).toHaveLength(1)
    expect(dupNotes('수시 전형 간 복수지원 허용. 과탐 2.5등급')).toEqual(['수시 전형 간 복수지원 허용'])
    expect(dupNotes(null)).toEqual([])
  })

  it('지원할 수 없는 전형과 자료에서 사라진 전형을 알려 준다', () => {
    const s = summarizePicks(['snu:b', 'snu:gone', 'nope:a'], byUniv, ctx)
    expect(s.blocked).toBe(1)
    expect(s.missing).toEqual(['snu:gone', 'nope:a'])
    expect(s.items.map((it) => it.key)).toEqual(['snu:b'])
  })

  it('목록 글은 시기별 번호와 지원 횟수를 적는다', () => {
    const s = summarizePicks(['korea:b', 'snu:b', 'korea:c'], byUniv, ctx)
    const text = picksText(s, new Date('2026-10-20T03:00:00Z'))
    expect(text).toContain('[수시 2/6]')
    expect(text).toContain('[정시 1/3]')
    expect(text).toContain('1. 고려대학교 전형b')
    expect(text).toContain('수능 최저: 3합 7')
    expect(text).toContain('서울대학교 전형b (지원 불가)')
  })
})
