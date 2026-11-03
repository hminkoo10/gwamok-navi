import { describe, expect, it } from 'vitest'
import type { Unit } from '../data/schema'
import { admissionYearOf, daysUntil, nextMilestone, ongoing, SCHEDULES, scheduleFor } from '../data/schedule'
import { BANSONG_2026 } from '../data/schools/bansong2026'
import { UNIT_BY_ID } from '../data/units'
import { makePlan } from '../engine/plan'
import type { DataUpdate } from './api'
import { planText } from './export'
import { mySeatsIn, mySeatsText, recruitsMine, unitSeatText } from './selection'
import { unseenOf } from './updates'

const u = (id: string): Unit => UNIT_BY_ID.get(id)!

describe('설계 목록 글', () => {
  const plan = makePlan(BANSONG_2026, [u('cau:소프트웨어학부')], { pinned: ['기하'] })
  const text = planText(plan, { units: ['중앙대 소프트웨어학부'], url: 'https://example.test/plan', today: new Date('2026-10-20T03:00:00Z') })
  const lines = text.split('\n')

  it('학교·입학년도로 시작하고 링크로 끝난다', () => {
    expect(lines[0]).toBe('반송고등학교 · 2026학년도 입학')
    expect(lines.at(-1)).toBe('https://example.test/plan')
  })

  it('학기마다 선택 칸과 고른 과목을 적는다', () => {
    expect(lines).toContain('[2학년 1학기]')
    const groupLines = lines.filter((l) => /^- .+ \(\d+과목 선택\): /.test(l))
    expect(groupLines.length).toBe(plan.groups.length)
    // 칸마다 고른 과목과 빈자리를 합치면 고르는 수와 같다
    for (const g of plan.groups) expect(g.chosen.length + g.free).toBe(g.group.pick)
    expect(text).toContain('기하')
  })

  it('고정한 과목과 목표 학과를 덧붙인다', () => {
    expect(lines).toContain('꼭 듣기: 기하')
    expect(lines).toContain('목표 학과: 중앙대 소프트웨어학부')
  })

  it('목표 학과가 많으면 12곳까지만 적는다', () => {
    const units = Array.from({ length: 15 }, (_, i) => `학과${i + 1}`)
    const t = planText(plan, { units, url: 'u' })
    expect(t).toContain('학과12 외 3곳')
    expect(t).not.toContain('학과13')
  })
})

describe('대입 일정', () => {
  const y2028 = scheduleFor(2028)!.items
  const y2029 = scheduleFor(2029)!.items

  it('다음 일정은 아직 시작하지 않은 첫 일정이다', () => {
    expect(nextMilestone(y2028, new Date('2027-08-01T00:00:00Z'))?.label).toContain('학생부 작성 기준일')
    expect(nextMilestone(y2028, new Date('2027-09-01T00:00:00Z'))?.label).toContain('수시 원서접수')
    // 수시 전형 기간 중에는 수능이 다음 일정이고, 전형 기간은 진행 중으로 따로 센다
    expect(nextMilestone(y2028, new Date('2027-10-01T00:00:00Z'))?.label).toBe('대학수학능력시험')
    expect(ongoing(y2028, new Date('2027-10-01T00:00:00Z')).map((m) => m.label)).toEqual(['수시 전형 기간 (면접·논술·실기)'])
    expect(nextMilestone(y2028, new Date('2028-03-01T00:00:00Z'))).toBeNull()
  })

  it('수능 시험일과 성적 통지일 (기본사항 전문)', () => {
    expect(y2028.find((m) => m.label === '대학수학능력시험')?.start).toBe('2027-11-18')
    expect(y2029.find((m) => m.label === '대학수학능력시험')?.start).toBe('2028-11-16')
    expect(y2029.find((m) => m.label === '수능 성적 통지')?.start).toBe('2028-12-08')
  })

  it('남은 날은 서울 날짜로 센다', () => {
    // 서울 2027-09-19 23:30 (UTC 14:30) → 원서접수 하루 전
    expect(daysUntil('2027-09-20', new Date('2027-09-19T14:30:00Z'))).toBe(1)
    // 서울 2027-09-20 00:30 (UTC 전날 15:30) → 당일
    expect(daysUntil('2027-09-20', new Date('2027-09-19T15:30:00Z'))).toBe(0)
  })

  it('일정은 날짜순이고 끝나는 날이 시작일보다 늦다', () => {
    for (const s of SCHEDULES) {
      const starts = s.items.map((m) => m.start)
      expect([...starts].sort()).toEqual(starts)
      for (const m of s.items) if (m.end) expect(m.end > m.start).toBe(true)
      // 모든 날짜가 그 학년도 입시 기간 안에 있다 (입학 전해 8월 ~ 입학하는 해 2월)
      for (const m of s.items) expect(m.start >= `${s.year - 1}-08-01` && (m.end ?? m.start) <= `${s.year}-02-29`).toBe(true)
    }
    expect(SCHEDULES.map((s) => s.year)).toEqual([...SCHEDULES.map((s) => s.year)].sort())
  })

  it('입학년도에 3을 더하면 대입 학년도', () => {
    expect(admissionYearOf(2025)).toBe(2028)
    expect(admissionYearOf(2026)).toBe(2029)
    expect(scheduleFor(admissionYearOf(2027))).toBeUndefined()
  })
})

describe('대입 정보 소식 알림', () => {
  const e = (id: number, key: string, createdAt: string): DataUpdate => ({ id, dataset: 'admissions', key, summary: '', createdAt })
  const entries = [e(3, 'korea', '2026-10-20T09:00:00Z'), e(2, 'snu', '2026-10-19T09:00:00Z'), e(1, 'korea', '2026-10-18T09:00:00Z')]

  it('본 시각 뒤의 목표 대학 소식만 고른다', () => {
    expect(unseenOf(entries, '2026-10-18T09:00:00Z', ['korea']).map((x) => x.id)).toEqual([3])
    expect(unseenOf(entries, '', ['snu']).map((x) => x.id)).toEqual([2])
    expect(unseenOf(entries, '2026-10-20T09:00:00Z', ['korea'])).toEqual([])
  })

  it('서버 DB를 새로 만들어 번호가 다시 1부터여도 새 소식은 보인다', () => {
    const fresh = [e(1, 'korea', '2026-11-01T00:00:00Z')]
    expect(unseenOf(fresh, '2026-10-20T09:00:00Z', ['korea'])).toHaveLength(1)
  })
})

describe('내 학과 모집인원', () => {
  const fake = (id: string): Unit => ({ id, univ: 'x', name: id, majors: [], clauses: [] })
  const seats = { 'x:a': { t1: 3, t2: null }, 'x:b': { t1: 2, t3: 4 } }
  const mine = [fake('x:a'), fake('x:b'), fake('x:c')]

  it('인원표에 없는 학과는 빼고, 하나도 없으면 표시하지 않는다', () => {
    expect(mySeatsIn(undefined, mine, 't1')).toBeNull()
    expect(mySeatsIn(seats, [fake('x:c')], 't1')).toBeNull()
    expect(mySeatsIn(seats, mine, 't1')!.rows.map((r) => r.unit.id)).toEqual(['x:a', 'x:b'])
  })

  it('숫자는 더하고, null은 뽑지만 인원 미정, 적히지 않은 전형은 안 뽑는다', () => {
    const t1 = mySeatsIn(seats, mine, 't1')!
    expect([t1.total, t1.open, mySeatsText(t1)]).toEqual([5, false, '내 학과 5명'])
    const t2 = mySeatsIn(seats, mine, 't2')!
    expect([t2.total, t2.open, recruitsMine(t2), mySeatsText(t2)]).toEqual([0, true, true, '내 학과 인원 미정'])
    expect(t2.rows.map((r) => unitSeatText(r.n))).toEqual(['인원 미정', '이 전형으로 뽑지 않아요'])
    const t4 = mySeatsIn(seats, mine, 't4')!
    expect([recruitsMine(t4), mySeatsText(t4)]).toEqual([false, '내 학과 모집 없음'])
  })

  it('숫자와 미정이 섞이면 n명 이상', () => {
    expect(mySeatsText(mySeatsIn({ 'x:a': { t: 2 }, 'x:b': { t: null } }, mine, 't')!)).toBe('내 학과 2명 이상')
  })
})
