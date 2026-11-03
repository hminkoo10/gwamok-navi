import { UNIT_BY_ID, UNITS } from './units'
import { MAJOR_BY_ID, MAJORS } from './majors'
import { unitsOf } from '../engine/search'
import { describe, expect, it } from 'vitest'
import unitSeats from './admissions2028.units.json'
import admissions from './admissions2028.json'
import { checkPlan } from './admissions-check'
import type { AdmissionPlan } from './schema'
import { needOf, resolveSubjects } from '../engine/plan'
import { SUBJECT_BY_NAME } from './subjects'
import { UNIV_BY_ID, UNIVERSITIES } from './universities'

describe('대학·모집단위 자료', () => {
  it('대학 id가 겹치지 않고 지역이 있다', () => {
    expect(new Set(UNIVERSITIES.map((u) => u.id)).size).toBe(UNIVERSITIES.length)
    for (const u of UNIVERSITIES) expect(u.region, u.id).toMatch(/^[가-힣]{2}/)
    expect(UNIVERSITIES.length).toBeGreaterThanOrEqual(45)
  })

  it('모집단위 id가 겹치지 않고 대학이 있다', () => {
    expect(new Set(UNITS.map((u) => u.id)).size).toBe(UNITS.length)
    for (const u of UNITS) expect(UNIV_BY_ID.has(u.univ), u.id).toBe(true)
    expect(UNITS.length).toBeGreaterThan(1300)
  })

  it('모든 조건의 과목은 목록에 있는 과목으로 풀리고, 고를 수 있는 개수를 넘지 않는다', () => {
    for (const unit of UNITS)
      for (const c of unit.clauses) {
        const subjects = resolveSubjects(c.subjects)
        expect(subjects.length, `${unit.id} ${c.subjects}`).toBeGreaterThan(0)
        for (const s of subjects) expect(SUBJECT_BY_NAME.has(s), `${unit.id}: ${s}`).toBe(true)
        expect(needOf(c), unit.id).toBeLessThanOrEqual(subjects.length)
      }
  })

  it('계열 id는 모두 정의돼 있고 모든 계열·세부 학과에 모집단위가 있다', () => {
    for (const u of UNITS)
      for (const m of u.majors)
        expect(
          MAJORS.some((x) => x.id === m),
          `${u.id}: ${m}`,
        ).toBe(true)
    for (const m of MAJORS)
      expect(
        UNITS.some((u) => u.majors.includes(m.id)),
        m.id,
      ).toBe(true)
    for (const id of MAJOR_BY_ID.keys()) expect(unitsOf(id).length, id).toBeGreaterThan(0)
  })

  it('자료집으로 바꾼 대학과 손으로 옮긴 대학이 함께 있다', () => {
    expect(UNIV_BY_ID.get('snu')?.coverage).toBe('official')
    expect(UNIV_BY_ID.get('korea')?.coverage).toBe('official')
    expect(UNIV_BY_ID.get('yonsei')?.coverage).toBe('official')
    expect(UNIV_BY_ID.get('cau')?.sources[0].title).toContain('중앙대 입학처')
    expect(UNITS.filter((u) => u.univ === 'snu').length).toBeGreaterThan(70)
  })
})

describe('대입 전형 자료', () => {
  it('배포한 자료는 모두 검사를 그대로 통과한다 (관리자가 불러와 저장해도 상세가 빠지지 않는다)', () => {
    for (const p of admissions.plans as unknown as AdmissionPlan[]) expect(checkPlan(p, p.univ, p), p.univ).toEqual(p)
  })
})

describe('학과별 모집인원', () => {
  it('모집단위 id는 앱의 학과이고, 전형 id는 그 대학 전형이다', () => {
    const seats = unitSeats as Record<string, Record<string, Record<string, number | null>>>
    for (const [univ, rows] of Object.entries(seats)) {
      const tracks = new Set(admissions.plans.find((p) => p.univ === univ)?.tracks.map((t) => t.id))
      for (const [unit, row] of Object.entries(rows)) {
        expect(UNIT_BY_ID.has(unit), unit).toBe(true)
        for (const tid of Object.keys(row)) expect(tracks.has(tid), `${unit} ${tid}`).toBe(true)
      }
    }
  })
})
