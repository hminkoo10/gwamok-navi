import { FINE_BY_ID } from '../data/majors'
import { describe, expect, it } from 'vitest'
import { MAJORS } from '../data/majors'
import type { School, Unit } from '../data/schema'
import { TERMS } from '../data/schema'
import { BANSONG_2026 } from '../data/schools/bansong2026'
import { SUBJECT_BY_NAME } from '../data/subjects'
import { UNIVERSITIES } from '../data/universities'
import { UNITS, UNIT_BY_ID } from '../data/units'
import { majorUnitsOf } from '../lib/selection'
import { makePlan, resolveSubjects } from './plan'
import { emptySchool, schoolFromLoose } from './school'
import { searchMajors } from './search'

const u = (id: string): Unit => {
  const unit = UNIT_BY_ID.get(id)
  if (!unit) throw new Error(`no unit ${id}`)
  return unit
}

const fake = (clauses: Unit['clauses']): Unit => ({ id: 'test:x', univ: 'cau', name: '테스트', majors: [], clauses })

describe('데이터 무결성', () => {
  it('모집단위와 학교 편제표의 모든 과목명이 과목 목록에 있다 (오타 방지)', () => {
    const names = new Set<string>()
    for (const unit of UNITS) for (const c of unit.clauses) for (const s of resolveSubjects(c.subjects)) names.add(s)
    for (const t of BANSONG_2026.terms) {
      for (const f of t.fixed) {
        names.add(f.subject)
        if (f.alt) names.add(f.alt)
      }
      for (const g of t.groups) for (const o of g.options) names.add(o)
    }
    for (const tr of BANSONG_2026.tracks) for (const set of tr.sets) for (const it of set.items) names.add(it.subject)
    const unknown = [...names].filter((n) => !SUBJECT_BY_NAME.has(n))
    expect(unknown).toEqual([])
  })

  it('모집단위의 대학·계열 id가 모두 존재한다', () => {
    const univ = new Set(UNIVERSITIES.map((x) => x.id))
    const major = new Set(MAJORS.map((x) => x.id))
    for (const unit of UNITS) {
      expect(univ.has(unit.univ), unit.id).toBe(true)
      for (const m of unit.majors) expect(major.has(m), `${unit.id} ${m}`).toBe(true)
    }
  })

  it('모집단위 id가 겹치지 않는다', () => {
    expect(new Set(UNITS.map((x) => x.id)).size).toBe(UNITS.length)
  })

  it('반송고 편제표: 학기마다 29학점 (원문 합계와 대조)', () => {
    for (const term of TERMS) {
      const t = BANSONG_2026.terms.find((x) => x.id === term)!
      let credits = t.fixed.reduce((a, f) => a + f.credits, 0)
      credits += t.groups.reduce((a, g) => a + g.pick * g.credits, 0)
      for (const tr of BANSONG_2026.tracks) {
        const first = tr.sets[0].items.filter((it) => it.term === term)
        credits += first.reduce((a, it) => a + it.credits, 0)
      }
      expect(credits, term).toBe(29)
    }
  })
})

describe('추천 계획', () => {
  it('중앙대 소프트웨어학부: 반송고에서 권장과목 5개를 모두 채운다', () => {
    const plan = makePlan(BANSONG_2026, [u('cau:소프트웨어학부')])
    const r = plan.units[0]
    expect(r.ok).toBe(true)
    expect(plan.taken.get('물리학')?.term).toBe('2-1')
    expect(plan.taken.get('역학과 에너지')?.term).toBe('2-2')
    expect(plan.taken.get('기하')?.term).toBe('2-2')
    expect(plan.taken.get('미적분Ⅱ')?.term).toBe('3-1')
    expect(plan.taken.get('전자기와 양자')?.term).toBe('3-1')
    expect(plan.warnings).toEqual([])
  })

  it('필요 없는 과목은 넣지 않고 빈칸으로 남긴다', () => {
    const plan = makePlan(BANSONG_2026, [u('cau:AI학과')])
    expect(plan.units[0].ok).toBe(true)
    const g21 = plan.groups.find((g) => g.group.id === '2-1-탐구')!
    expect(g21.chosen).toEqual([])
    expect(g21.free).toBe(3)
  })

  it('의예 여러 대학: 조건을 모두 채우고 칸 수를 넘지 않는다', () => {
    const units = [u('cau:의학부'), u('yonsei:의예과'), u('korea:의과대학'), u('snu:의예과')]
    const plan = makePlan(BANSONG_2026, units)
    for (const r of plan.units) expect(r.ok, r.unit.id).toBe(true)
    for (const g of plan.groups) expect(g.chosen.length).toBeLessThanOrEqual(g.group.pick)
    expect(plan.taken.has('세포와 물질대사')).toBe(true)
    expect(plan.taken.has('생물의 유전')).toBe(true)
  })

  it('뒤 과목만 요구돼도 앞 과목(물리학)을 함께 넣는다', () => {
    const plan = makePlan(BANSONG_2026, [u('korea:건축사회환경공학부')])
    expect(plan.taken.has('역학과 에너지')).toBe(true)
    expect(plan.taken.get('물리학')?.term).toBe('2-1')
    expect(plan.warnings).toEqual([])
  })

  it('학교에 없는 과목은 not-offered로 알려 준다', () => {
    const plan = makePlan(BANSONG_2026, [fake([{ pick: 'all', subjects: ['데이터 과학'] }])])
    const c = plan.units[0].clauses[0]
    expect(c.ok).toBe(false)
    expect(c.missing).toEqual([{ subject: '데이터 과학', reason: 'not-offered' }])
    expect(plan.notOffered).toContain('데이터 과학')
  })

  it('같은 택1 칸에 두 과목이 걸리면 하나는 no-slot이 된다', () => {
    const plan = makePlan(BANSONG_2026, [fake([{ pick: 'all', subjects: ['기하', '영미 문학 읽기'] }])])
    const c = plan.units[0].clauses[0]
    expect(c.met).toHaveLength(1)
    expect(c.missing).toHaveLength(1)
    expect(c.missing[0].reason).toBe('no-slot')
  })

  it('서울대 국어국문학과: 제2외국어 세트를 골라 조건을 채운다', () => {
    const plan = makePlan(BANSONG_2026, [u('snu:국어국문학과')])
    expect(plan.units[0].ok).toBe(true)
    const track = plan.tracks.find((t) => t.track.id === '2-제2외국어')!
    expect(track.setIndex).not.toBeNull()
  })

  it('지정 과목이 없는 대학은 조건 0개로 통과', () => {
    const plan = makePlan(BANSONG_2026, [u('skku:자연계열 전 모집단위')])
    expect(plan.units[0].ok).toBe(true)
    expect(plan.units[0].need).toBe(0)
  })

  it('"이 중 1과목"을 채웠으면 그 조건의 다른 과목은 편제표에 없는 권장과목으로 알리지 않는다', () => {
    const plan = makePlan(BANSONG_2026, [u('jnu:간호학과')])
    expect(plan.units[0].ok).toBe(true)
    expect(plan.notOffered).toEqual([])
    // 채우지 못한 조건에 걸린 과목은 그대로 알린다
    const short = makePlan(BANSONG_2026, [fake([{ pick: 2, subjects: ['데이터 과학', '실생활 영어 회화', '기하'] }])])
    expect(short.notOffered.sort()).toEqual(['데이터 과학', '실생활 영어 회화'].sort())
  })
})

describe('탐색이 끝까지 간다 (조건이 아주 많은 학과)', () => {
  it('영남대 휴먼서비스학과 + 서울시립대 사회복지학과: 넣을 수 있는 꼭 듣기 두 과목을 모두 넣는다', () => {
    const plan = makePlan(BANSONG_2026, [u('yu:휴먼서비스학과'), u('uos:사회복지학과')], { pinned: ['주제 탐구 독서', '미디어 영어'] })
    expect(plan.unplacedPins).toEqual([])
    expect(plan.taken.get('미디어 영어')?.term).toBe('2-1')
    expect(plan.taken.get('주제 탐구 독서')?.term).toBe('2-2')
    expect(plan.search?.complete).toBe(true)
  })

  it('세트 조합마다 따로 찾는다: 첫 조합(일본어)이 탐색을 다 쓰지 않고 중국어 세트를 고른다', () => {
    const units = ['yu:휴먼서비스학과', 'uos:사회복지학과', 'snu:국어국문학과', 'kookmin:중어중문학과'].map(u)
    const plan = makePlan(BANSONG_2026, units)
    expect(plan.tracks.find((t) => t.track.id === '2-제2외국어')!.setIndex).toBe(1)
    // 국민대 중어중문학과의 핵심과목(중국어)과 권장과목(중국어 회화)이 들어간다 (한문 고전 읽기는 반송고에 없다)
    expect(plan.taken.has('중국어') && plan.taken.has('중국어 회화')).toBe(true)
    expect(plan.search?.complete).toBe(true)
  })

  it('조건이 아주 많아도 끝까지 찾는다 (탐색 노드 수로 본다)', () => {
    const one = makePlan(BANSONG_2026, [u('yu:휴먼서비스학과')])
    expect(one.search?.complete).toBe(true)
    expect(one.search!.nodes).toBeLessThan(20_000)
    // 대학 페이지처럼 영남대 학과를 하나씩
    for (const unit of UNITS.filter((x) => x.univ === 'yu' && x.clauses.length)) expect(makePlan(BANSONG_2026, [unit]).search?.complete, unit.id).toBe(true)
    // 사회·인문 × 대학 60곳
    const many = makePlan(
      BANSONG_2026,
      majorUnitsOf(
        ['social', 'humanities'],
        UNIVERSITIES.slice(0, 60).map((x) => x.id),
      ),
    )
    expect(many.search?.complete).toBe(true)
  })

  it('세트 묶음이 아주 많은 편제표(6묶음 × 6세트)도 조합 수를 줄여 금방 끝난다', () => {
    const subj = (t: number, j: number) => `가과목 ${t}${j}`
    const school = schoolFromLoose(
      {
        terms: [
          { id: '2-1', groups: [{ label: '선택', pick: 30, credits: 1, options: Array.from({ length: 36 }, (_, k) => subj(Math.floor(k / 6), k % 6)) }] },
        ],
        tracks: Array.from({ length: 6 }, (_, t) => ({
          label: `세트 ${t}`,
          sets: Array.from({ length: 6 }, (_, j) => ({ label: `세트 ${t}-${j}`, items: [{ term: '3-1', subject: subj(t, j), credits: 1 }] })),
        })),
      },
      { id: 'x', name: '학교', region: '', cohort: 2026 },
    )
    const pins = school.tracks.flatMap((t) => t.sets.map((s) => s.items[0].subject))
    const plan = makePlan(school, [], { pinned: pins })
    expect(plan.search?.combos).toBe(6 ** 6)
    expect(plan.search!.nodes).toBeLessThan(10_000)
    expect(plan.unplacedPins).toEqual([])
  })
})

/** 과학 선택 칸(택2), 탐구 선택 칸(택1), 과학 세트(물리·화학·융합)와 언어 세트가 있는 학교 */
const blank = emptySchool({ id: 'mixed', name: '섞인고', region: '서울', cohort: 2026 })
const MIXED: School = {
  ...blank,
  terms: blank.terms.map((t) =>
    t.id === '2-1'
      ? { ...t, groups: [{ id: 'a', label: '과학 선택', pick: 2, credits: 3, options: ['물리학', '화학', '생명과학', '지구과학'] }] }
      : t.id === '2-2'
        ? { ...t, groups: [{ id: 'b', label: '탐구 선택', pick: 1, credits: 3, options: ['경제', '정치'] }] }
        : t,
  ),
  tracks: [
    {
      id: 't1',
      label: '과학 세트',
      sets: [
        {
          label: '물리',
          items: [
            { term: '3-1', subject: '역학과 에너지', credits: 3 },
            { term: '3-2', subject: '전자기와 양자', credits: 3 },
          ],
        },
        {
          label: '화학',
          items: [
            { term: '3-1', subject: '물질과 에너지', credits: 3 },
            { term: '3-2', subject: '화학 반응의 세계', credits: 3 },
          ],
        },
        {
          label: '융합',
          items: [
            { term: '3-1', subject: '역학과 에너지', credits: 3 },
            { term: '3-2', subject: '화학', credits: 3 },
          ],
        },
      ],
    },
    {
      id: 't2',
      label: '언어 세트',
      sets: [
        {
          label: '일본어',
          items: [
            { term: '3-1', subject: '일본어', credits: 3 },
            { term: '3-2', subject: '일본어 회화', credits: 3 },
          ],
        },
        {
          label: '중국어',
          items: [
            { term: '3-1', subject: '중국어', credits: 3 },
            { term: '3-2', subject: '중국어 회화', credits: 3 },
          ],
        },
      ],
    },
  ],
}

describe('세트와 선택 칸', () => {
  it('선택 칸에도 있는 과목을 꼭 듣기로 해도 그 과목이 든 세트를 억지로 고르지 않는다', () => {
    const plan = makePlan(MIXED, [fake([{ pick: 'all', subjects: ['역학과 에너지', '전자기와 양자'] }])], { pinned: ['화학'] })
    expect(plan.tracks[0].setIndex).toBe(0)
    expect(plan.taken.get('화학')).toMatchObject({ kind: 'group', groupId: 'a' })
    expect(plan.units[0].ok).toBe(true)
    expect(plan.unplacedPins).toEqual([])
  })

  it('세트로만 듣는 꼭 듣기 과목은 그 세트를 고른다', () => {
    const plan = makePlan(MIXED, [fake([{ pick: 'all', subjects: ['역학과 에너지', '전자기와 양자'] }])], { pinned: ['물질과 에너지'] })
    expect(plan.tracks[0].setIndex).toBe(1)
  })

  it('꼭 듣기 과목을 고른 칸에 넣는다 (자리가 있으면)', () => {
    const tied = makePlan(BANSONG_2026, [], { pinned: ['주제 탐구 독서'] })
    expect(tied.taken.get('주제 탐구 독서')?.term).toBe('2-1')
    const there = makePlan(BANSONG_2026, [], { pinned: ['주제 탐구 독서'], pinGroups: { '주제 탐구 독서': '2-2-교과영역간' } })
    expect(there.taken.get('주제 탐구 독서')).toMatchObject({ term: '2-2', groupId: '2-2-교과영역간' })
    // 권장과목(기하)보다 학생이 고른 칸이 먼저다
    const cs = makePlan(BANSONG_2026, [u('cau:소프트웨어학부')], { pinned: ['주제 탐구 독서'], pinGroups: { '주제 탐구 독서': '2-2-교과영역간' } })
    expect(cs.taken.get('주제 탐구 독서')?.term).toBe('2-2')
    expect(cs.taken.has('기하')).toBe(false)
    // 칸 id가 틀리거나 꼭 듣기가 아니면 무시한다
    const wrong = makePlan(BANSONG_2026, [], { pinned: ['주제 탐구 독서'], pinGroups: { '주제 탐구 독서': '3-1-선택', 기하: '2-2-교과영역간' } })
    expect(wrong.taken.get('주제 탐구 독서')?.term).toBe('2-1')
    expect(wrong.taken.has('기하')).toBe(false)
  })
})

describe('못 넣은 까닭', () => {
  it('학생이 뺀 앞 과목은 칸이 모자란 것과 따로 알린다', () => {
    const plan = makePlan(BANSONG_2026, [fake([{ pick: 'all', subjects: ['역학과 에너지'] }])], { excluded: ['물리학'] })
    expect(plan.warnings).toContainEqual({ subject: '역학과 에너지', before: '물리학', kind: 'missing', cause: 'excluded-prereq' })
  })

  it('꼭 듣기 과목이 칸을 차지했으면 pinned, 다른 세트를 골랐으면 other-set', () => {
    const pinnedOut = makePlan(BANSONG_2026, [u('cau:소프트웨어학부')], { pinned: ['영미 문학 읽기'] })
    const math = pinnedOut.units[0].clauses.find((c) => c.candidates.includes('기하'))!
    expect(math.missing).toEqual([{ subject: '기하', reason: 'no-slot', cause: 'pinned', by: ['영미 문학 읽기'] }])
    const sets = makePlan(MIXED, [fake([{ pick: 'all', subjects: ['일본어 회화', '중국어 회화'] }])])
    const c = sets.units[0].clauses[0]
    expect(c.missing).toHaveLength(1)
    expect(c.missing[0]).toMatchObject({ reason: 'no-slot', cause: 'other-set' })
    expect(c.missing[0].by).toHaveLength(1)
    // 다른 권장과목이 먼저 차지한 경우는 까닭을 따로 달지 않는다
    const plain = makePlan(BANSONG_2026, [fake([{ pick: 'all', subjects: ['기하', '영미 문학 읽기'] }])])
    expect(plain.units[0].clauses[0].missing[0].cause).toBeUndefined()
  })
})

describe('검색', () => {
  it('진로 문장에서 세부 학과를 찾는다', () => {
    // 맨 앞 결과가 그 계열 묶음이거나 묶음 안의 세부 학과
    const groupOf = (id: string) => FINE_BY_ID.get(id)?.parent ?? id
    expect(['cs', 'artTech']).toContain(groupOf(searchMajors('게임 만드는 개발자가 꿈')[0].major.id))
    expect(searchMajors('화이트 해커')[0].major.id).toBe('sec-info')
    expect(groupOf(searchMajors('의사')[0].major.id)).toBe('med')
  })

  it('area 표기를 펼친다', () => {
    expect(resolveSubjects(['area:한문'])).toEqual(['한문', '한문 고전 읽기', '언어생활과 한자'])
    expect(resolveSubjects(['area:제2외국어'])).toContain('일본어 회화')
    // 공통과목은 area에 넣지 않는다
    expect(resolveSubjects(['area:수학'])).not.toContain('공통수학1')
    expect(resolveSubjects(['area:수학'])).toContain('미적분Ⅱ')
  })

  it('진로선택·일반선택·계열 묶음을 펼친다', () => {
    expect(resolveSubjects(['career:과학'])).toEqual([
      '역학과 에너지',
      '전자기와 양자',
      '물질과 에너지',
      '화학 반응의 세계',
      '세포와 물질대사',
      '생물의 유전',
      '지구시스템과학',
      '행성우주과학',
    ])
    expect(resolveSubjects(['general:과학'])).toEqual(['물리학', '화학', '생명과학', '지구과학'])
    expect(resolveSubjects(['career:수학'])).toEqual(['기하', '미적분Ⅱ', '경제 수학', '인공지능 수학', '직무 수학'])
    expect(resolveSubjects(['family:물리', '물리학'])).toEqual(['물리학', '역학과 에너지', '전자기와 양자'])
  })
})
