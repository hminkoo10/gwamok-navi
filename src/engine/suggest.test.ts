import { describe, expect, it } from 'vitest'
import type { School, Unit } from '../data/schema'
import { BANSONG_2026 } from '../data/schools/bansong2026'
import { UNIT_BY_ID, UNITS } from '../data/units'
import { majorUnitsOf } from '../lib/selection'
import { makePlan } from './plan'
import { fieldScores, groupSuggestions, isSuggestible, relevanceOf, trackSuggestions } from './suggest'

const u = (id: string): Unit => UNIT_BY_ID.get(id)!
const fake = (id: string, majors: string[], clauses: Unit['clauses']): Unit => ({ id, univ: 'x', name: id, majors, clauses })

/** 2·3학년 두 학기에 선택 칸이 하나씩 있는 작은 학교 */
const tinySchool = (g21: string[], g31: string[], pick = 1): School => ({
  ...BANSONG_2026,
  id: 'tiny',
  terms: [
    { id: '1-1', fixed: [], groups: [] },
    { id: '1-2', fixed: [], groups: [] },
    { id: '2-1', fixed: [], groups: [{ id: 'g21', label: '2-1 선택', pick, credits: 4, options: g21 }] },
    { id: '2-2', fixed: [], groups: [] },
    { id: '3-1', fixed: [], groups: [{ id: 'g31', label: '3-1 선택', pick, credits: 4, options: g31 }] },
    { id: '3-2', fixed: [], groups: [] },
  ],
  tracks: [],
})

describe('진로 관련도', () => {
  it('이미 고른 학과는 세지 않는다 (남는 건 과목 이름으로 본 관련뿐)', () => {
    const chosen = [u('cau:소프트웨어학부')]
    const alone = fieldScores(chosen, ['cs'], new Set(chosen.map((x) => x.id)))
    expect([...alone.values()].every((f) => f.prior)).toBe(true)
  })

  it('넓은 조건(교과 전체 중 몇 과목)은 콕 집은 과목보다 약하게 센다', () => {
    const s = fieldScores([fake('a', ['cs'], [{ pick: 'all', subjects: ['기하'] }]), fake('b', ['cs'], [{ pick: 1, subjects: ['area:수학'] }])], ['cs'])
    expect(s.get('기하')!.share).toBeGreaterThan(s.get('확률과 통계')!.share)
    expect(s.get('확률과 통계')!.named).toBe(0)
  })

  it('다른 계열이 섞인 학과 한 곳만 권한 과목은 추천하지 않는다', () => {
    const units = [
      ...Array.from({ length: 6 }, (_, i) => fake(`cs${i}`, ['cs', 'ai'], [{ pick: 'all', subjects: ['미적분Ⅱ', '기하'] }])),
      fake('bizdata', ['social', 'ai'], [{ pick: 'all', subjects: ['법과 사회', '국제 관계의 이해', '미적분Ⅱ'] }]),
    ]
    const s = fieldScores(units, ['cs', 'ai', 'security'])
    expect(isSuggestible(s.get('미적분Ⅱ'))).toBe(true)
    expect(isSuggestible(s.get('법과 사회'))).toBe(false)
    expect(isSuggestible(s.get('국제 관계의 이해'))).toBe(false)
  })

  it('전문교과처럼 대학 자료에 없는 과목은 이름으로 진로와 잇는다', () => {
    const sec = fieldScores(UNITS, ['security'], new Set(), ['컴퓨터 보안', '빅 데이터 분석'])
    expect(isSuggestible(sec.get('컴퓨터 보안'))).toBe(true)
    const biz = fieldScores(UNITS, ['soc-business'], new Set(), ['컴퓨터 보안', '중국어 회화'])
    expect(isSuggestible(biz.get('컴퓨터 보안'))).toBe(false)
    // '회화'는 그림이 아니라 말하기일 수 있어 미술 쪽과 잇지 않는다
    const art = fieldScores(UNITS, ['arts-design'], new Set(), ['중국어 회화'])
    expect(art.get('중국어 회화')?.prior ?? false).toBe(false)
  })
})

describe('빈칸 추천', () => {
  const chosen = [u('cau:소프트웨어학부')]
  const scores = fieldScores(UNITS, ['cs'], new Set(chosen.map((x) => x.id)))
  const plan = makePlan(BANSONG_2026, chosen, { relevance: relevanceOf(scores) })
  const sugg = groupSuggestions(plan, scores)

  it('빈자리가 있는 칸에만, 계획에 없는 과목만 권한다', () => {
    expect(sugg.size).toBeGreaterThan(0)
    for (const [groupId, list] of sugg) {
      const g = plan.groups.find((x) => x.group.id === groupId)!
      expect(g.free).toBeGreaterThan(0)
      for (const s of list) {
        expect(g.group.options).toContain(s.subject)
        expect(plan.taken.has(s.subject)).toBe(false)
        expect(s.named >= 2 || s.prior).toBe(true)
      }
    }
  })

  it('제외한 과목은 추천하지 않는다', () => {
    const first = [...sugg.values()][0][0].subject
    const p2 = makePlan(BANSONG_2026, chosen, { excluded: [first], relevance: relevanceOf(scores) })
    const again = groupSuggestions(p2, scores)
    expect([...again.values()].flat().some((s) => s.subject === first)).toBe(false)
  })

  it('같은 과목을 두 칸에 추천하지 않고, 앞 과목보다 먼저 추천하지 않는다', () => {
    const units = Array.from({ length: 4 }, (_, i) => fake(`p${i}`, ['physics'], [{ pick: 'all', subjects: ['물리학', '역학과 에너지', '기하'] }]))
    const sc = fieldScores(units, ['physics'])
    // 역학과 에너지는 2-1에 있지만 물리학이 3-1에만 있으면 2-1에 낼 수 없다
    const school = tinySchool(['역학과 에너지', '기하'], ['물리학', '기하'])
    const p = makePlan(school, [])
    const out = groupSuggestions(p, sc)
    const first21 = out.get('g21')?.[0]?.subject
    const first31 = out.get('g31')?.[0]?.subject
    expect(first21).toBe('기하')
    expect(first31).toBe('물리학')
  })

  it('두 학기 세트는 진로와 가장 가까운 세트를 고른다', () => {
    const school: School = {
      ...tinySchool([], []),
      tracks: [
        {
          id: 't1',
          label: '전공 선택',
          sets: [
            { label: 'A', items: [{ term: '3-1', subject: '빅 데이터 분석', credits: 4 }] },
            { label: 'B', items: [{ term: '3-1', subject: '컴퓨터 보안', credits: 4 }] },
          ],
        },
      ],
    }
    const p = makePlan(school, [])
    const sec = fieldScores(UNITS, ['sec-info'], new Set(), ['빅 데이터 분석', '컴퓨터 보안'])
    expect(trackSuggestions(p, sec).get('t1')).toBe(1)
  })
})

describe('추천 엔진의 동점 처리', () => {
  const school = tinySchool(['물리학', '생명과학'], ['역학과 에너지', '세포와 물질대사'])
  const unit = fake('x', ['cs'], [{ pick: 1, subjects: ['역학과 에너지', '세포와 물질대사'] }])

  it('같은 조건을 채우는 과목이 여럿이면 진로 관련도가 높은 쪽을 고른다', () => {
    const physicsFirst = makePlan(school, [unit], {
      relevance: new Map([
        ['역학과 에너지', 0.6],
        ['세포와 물질대사', 0.1],
      ]),
    })
    expect(physicsFirst.taken.has('역학과 에너지')).toBe(true)
    const bioFirst = makePlan(school, [unit], {
      relevance: new Map([
        ['역학과 에너지', 0.1],
        ['세포와 물질대사', 0.6],
      ]),
    })
    expect(bioFirst.taken.has('세포와 물질대사')).toBe(true)
  })

  it('관련도만으로는 자리를 차지하지 않는다 (조건을 채우는 과목만 넣는다)', () => {
    const p = makePlan(school, [unit], {
      relevance: new Map([
        ['역학과 에너지', 0.6],
        ['물리학', 0.9],
        ['생명과학', 0.9],
      ]),
    })
    // 물리학은 역학과 에너지의 앞 과목이라 들어가고, 생명과학은 관련도가 높아도 넣지 않는다
    expect(p.taken.has('물리학')).toBe(true)
    expect(p.taken.has('생명과학')).toBe(false)
  })

  it('앞 과목을 하나 더 넣는 조합이 동점 처리에서 이득을 보지 않는다', () => {
    // 조건 하나를 지구시스템과학(앞 과목 지구과학 필요) 또는 전자기와 양자(앞 과목 물리학 필요)로 채울 수 있을 때, 관련도만 본다
    const s2 = tinySchool(['물리학', '지구과학'], ['전자기와 양자', '지구시스템과학'], 2)
    const one = fake('y', ['cs'], [{ pick: 1, subjects: ['전자기와 양자', '지구시스템과학'] }])
    const p = makePlan(s2, [one], {
      relevance: new Map([
        ['전자기와 양자', 0.3],
        ['지구시스템과학', 0.2],
        ['지구과학', 0.9],
        ['물리학', 0.1],
      ]),
    })
    expect(p.taken.has('전자기와 양자')).toBe(true)
    expect(p.taken.has('지구시스템과학')).toBe(false)
  })
})

describe('실제 자료로 본 추천 (이상한 과목이 다시 나오지 않게)', () => {
  const SEVEN = ['snu', 'yonsei', 'korea', 'skku', 'sogang', 'hanyang', 'cau']
  const run = (majors: string[], univs: string[]) => {
    const units = majorUnitsOf(majors, univs)
    const scores = fieldScores(UNITS, majors, new Set(units.map((x) => x.id)))
    const plan = makePlan(BANSONG_2026, units, { relevance: relevanceOf(scores) })
    return { plan, sugg: [...groupSuggestions(plan, scores).values()].flat().map((x) => x.subject) }
  }

  it('보안·컴퓨터·AI 학생에게 사회 과목을 빈칸 추천으로 내지 않는다', () => {
    const { sugg } = run(['security', 'cs', 'ai'], SEVEN)
    for (const s of ['법과 사회', '국제 관계의 이해', '금융과 경제생활', '세계시민과 지리', '현대사회와 윤리', '사회문제 탐구']) expect(sugg).not.toContain(s)
  })

  it('과학 진로선택을 채울 때 정보보호는 물리 쪽을 고른다 (지구과학으로 새지 않는다)', () => {
    const { plan } = run(['sec-info'], SEVEN)
    expect(plan.taken.has('역학과 에너지') || plan.taken.has('전자기와 양자')).toBe(true)
    expect(plan.taken.has('지구시스템과학')).toBe(false)
  })

  it('대학 자료에 없는 컴퓨터교육도 가까운 학과 자료로 수학·물리·정보 쪽을 추천한다', () => {
    const { sugg } = run(['edu-computer'], ['snu', 'korea', 'pnu', 'knu', 'kangwon'])
    expect(sugg.some((s) => ['기하', '인공지능 수학', '물리학', '미적분Ⅱ', '정보', '역학과 에너지'].includes(s))).toBe(true)
    expect(sugg).not.toContain('법과 사회')
  })
})
