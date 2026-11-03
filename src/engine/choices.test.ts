import { describe, expect, it } from 'vitest'
import type { School, Unit } from '../data/schema'
import { BANSONG_2026 } from '../data/schools/bansong2026'
import { choiceNotice, repairNotice } from '../lib/choiceNotice'
import { type ChoiceState, excludeChoice, includeChoice, lockedBy, pinChoice, repairChoices, setPickSubject, unpinChoice } from './choices'
import { makePlan } from './plan'
import { emptySchool, schoolFromLoose } from './school'

/** 디미고 해킹방어과 3학년 코스 선택 (운영 공유 편제표와 같은 모양): 코스마다 두 과목이 한 세트 */
const course = (label: string, a: string, b: string) => ({
  label,
  items: (['3-1', '3-2'] as const).flatMap((term) => [
    { term, subject: a, credits: 4 },
    { term, subject: b, credits: 4 },
  ]),
})
const DIMIGO: School = {
  ...emptySchool({ id: 'dimigo-test', name: '한국디지털미디어고등학교', region: '경기', cohort: 2026 }),
  tracks: [
    {
      id: 'track-1',
      label: '코스 선택',
      sets: [course('인공지능코스', '빅데이터 분석', '인공지능 모델링'), course('정보보안코스', '네트워크 프로그래밍', '컴퓨터 보안')],
    },
  ],
}
/** 운영 편제표처럼 3학년 1학기에 수학 선택(택1) 칸까지 있는 디미고 */
const DIMIGO_FULL: School = {
  ...DIMIGO,
  terms: DIMIGO.terms.map((t) =>
    t.id === '3-1' ? { ...t, groups: [{ id: '3-1-g1', label: '수학 선택', pick: 1, credits: 3, options: ['확률과 통계', '미적분Ⅱ'] }] } : t,
  ),
}
const EMPTY: ChoiceState = { pinned: [], excluded: [] }

/** 선택 칸 자리를 모두 함께 채울 수 있는 과목 수 (한 과목은 한 칸에만, 뺀 과목·모두 듣는 과목은 못 쓴다). 엔진과 따로 만든 확인용 */
function seatsFilled(school: School, ex: Set<string>): number {
  const fixed = new Set(school.terms.flatMap((t) => t.fixed.flatMap((f) => (f.alt ? [f.subject, f.alt] : [f.subject]))))
  const seats = school.terms.flatMap((t) => t.groups.flatMap((g) => Array.from({ length: g.pick }, () => g.options)))
  const owner = new Array<string | null>(seats.length).fill(null)
  const place = (s: string, seen: Set<number>): boolean =>
    seats.some((options, i) => {
      if (seen.has(i) || !options.includes(s)) return false
      seen.add(i)
      if (owner[i] === null || place(owner[i]!, seen)) {
        owner[i] = s
        return true
      }
      return false
    })
  const subjects = [...new Set(school.terms.flatMap((t) => t.groups.flatMap((g) => g.options)))].filter((s) => !ex.has(s) && !fixed.has(s))
  return subjects.filter((s) => place(s, new Set())).length
}

/** 세트 묶음이 하나도 비지 않았고, 선택 칸을 모두 함께 채울 수 있고, 꼭 듣기가 모두 들어가는지 */
function expectValid(school: School, s: ChoiceState, label = '') {
  const ex = new Set(s.excluded)
  for (const t of school.tracks)
    expect(
      t.sets.some((set) => !set.items.some((it) => ex.has(it.subject))),
      `${label} ${t.label}`,
    ).toBe(true)
  for (const term of school.terms)
    for (const g of term.groups) expect(g.options.filter((o) => !ex.has(o)).length, `${label} ${g.label}`).toBeGreaterThanOrEqual(g.pick)
  expect(seatsFilled(school, ex), `${label} 선택 칸 함께 채우기`).toBe(seatsFilled(school, new Set()))
  expect(
    s.pinned.filter((p) => ex.has(p)),
    label,
  ).toEqual([])
  expect(new Set(s.pinned).size, label).toBe(s.pinned.length)
  expect(new Set(s.excluded).size, label).toBe(s.excluded.length)
  expect(makePlan(school, [], s).unplacedPins, label).toEqual([])
  // 이렇게 만든 상태는 고칠 것이 없다 (불러올 때 고치는 규칙과 누를 때 지키는 규칙이 같다)
  expect(repairChoices(school, s), label).toBeNull()
}

describe('세트 과목 꼭 듣기·빼기', () => {
  it('세트 과목 하나를 빼면 같은 세트 과목도 함께 빠지고, 그 사실을 돌려준다', () => {
    const a = excludeChoice(DIMIGO, EMPTY, '컴퓨터 보안')
    expect(a.excluded.sort()).toEqual(['네트워크 프로그래밍', '컴퓨터 보안'])
    expect(a.alsoExcluded).toEqual(['네트워크 프로그래밍'])
    expect(a.set).toBe('정보보안코스')
    expect(choiceNotice('컴퓨터 보안', a)).toBe('컴퓨터 보안: 같은 세트(정보보안코스)인 네트워크 프로그래밍도 함께 뺐어요.')
    // 꼭 듣기였던 같은 세트 과목은 함께 빠지면서 꼭 듣기도 풀린다
    const b = excludeChoice(DIMIGO, { pinned: ['네트워크 프로그래밍'], excluded: [] }, '컴퓨터 보안')
    expect(b.pinned).toEqual([])
    expect(b.alsoExcluded).toEqual(['네트워크 프로그래밍'])
  })

  it('다시 넣으면 함께 뺀 같은 세트 과목도 다시 들어온다', () => {
    const out = excludeChoice(DIMIGO, EMPTY, '컴퓨터 보안')
    const back = includeChoice(DIMIGO, out, '네트워크 프로그래밍')
    expect(back.excluded).toEqual([])
    expect(back.alsoIncluded).toEqual(['컴퓨터 보안'])
  })

  it('꼭 듣기는 그 세트를 고를 수 있게 같은 세트에서 뺀 과목을 다시 넣고, 다른 세트 꼭 듣기는 푼다', () => {
    const s1 = pinChoice(DIMIGO, { pinned: [], excluded: ['컴퓨터 보안', '네트워크 프로그래밍'] }, '네트워크 프로그래밍')
    expect(s1.excluded).toEqual([])
    expect(s1.alsoIncluded).toEqual(['컴퓨터 보안'])
    const s2 = pinChoice(DIMIGO, s1, '빅데이터 분석')
    expect(s2.pinned).toEqual(['빅데이터 분석'])
    expect(s2.unpinned).toEqual(['네트워크 프로그래밍'])
    expect(s2.bumped).toEqual([])
    expect(s2.set).toBe('인공지능코스')
    expect(choiceNotice('빅데이터 분석', s2)).toBe('빅데이터 분석: 세트는 하나만 고를 수 있어 네트워크 프로그래밍의 꼭 듣기를 풀었어요.')
    expect(unpinChoice(s2, '빅데이터 분석').pinned).toEqual([])
  })

  it('1학기 칸에서 한 코스, 2학기 칸에서 다른 코스를 빼면 앞서 뺀 코스를 다시 넣는다 (코스 하나는 꼭 듣는다)', () => {
    const a = excludeChoice(DIMIGO, EMPTY, '컴퓨터 보안')
    const b = excludeChoice(DIMIGO, a, '인공지능 모델링')
    expect(b.refused).toBeUndefined()
    expect(b.excluded).toEqual(['인공지능 모델링', '빅데이터 분석'])
    expect(b.reopened).toEqual([{ where: '코스 선택', set: '정보보안코스', subjects: ['네트워크 프로그래밍', '컴퓨터 보안'] }])
    expect(choiceNotice('인공지능 모델링', b)).toBe(
      '인공지능 모델링: 같은 세트(인공지능코스)인 빅데이터 분석도 함께 뺐어요. 코스 선택에서는 세트 하나를 꼭 들어야 해서 정보보안코스(네트워크 프로그래밍, 컴퓨터 보안)를 다시 넣었어요.',
    )
    // 남은 코스는 고르지 않아도 계획에 들어간다
    const plan = makePlan(DIMIGO, [], b)
    expect(plan.tracks[0].setIndex).toBe(1)
    expect(plan.taken.has('네트워크 프로그래밍') && plan.taken.has('컴퓨터 보안')).toBe(true)
    expectValid(DIMIGO, b)
  })

  it('꼭 듣기 세트의 과목을 빼면 그 세트가 빠지고 남은 세트가 들어간다', () => {
    const pinned = pinChoice(DIMIGO, EMPTY, '빅데이터 분석')
    const out = excludeChoice(DIMIGO, pinned, '인공지능 모델링')
    expect(out.pinned).toEqual([])
    expect(out.excluded).toEqual(['인공지능 모델링', '빅데이터 분석'])
    expect(makePlan(DIMIGO, [], out).tracks[0].setIndex).toBe(1)
    expectValid(DIMIGO, out)
  })

  it('사용자가 겪은 상태: 두 코스에서 하나씩 빼고 하나씩 꼭 듣기 → 넣을 칸 없는 꼭 듣기가 남지 않는다', () => {
    let s: ChoiceState = EMPTY
    s = excludeChoice(DIMIGO, s, '컴퓨터 보안')
    s = excludeChoice(DIMIGO, s, '인공지능 모델링')
    s = pinChoice(DIMIGO, s, '네트워크 프로그래밍')
    s = pinChoice(DIMIGO, s, '빅데이터 분석')
    const plan = makePlan(DIMIGO, [], s)
    expect(plan.unplacedPins).toEqual([])
    expect(plan.taken.has('빅데이터 분석') && plan.taken.has('인공지능 모델링')).toBe(true)
    expectValid(DIMIGO, s)
  })

  it('다른 세트에도 있는 과목은 하나가 막혀도 남고, 모든 세트에 든 과목은 뺄 수 없다', () => {
    const school: School = {
      ...emptySchool({ id: 'x', name: '가나고', region: '서울', cohort: 2026 }),
      tracks: [
        {
          id: 't',
          label: '과학 세트',
          sets: [
            {
              label: 'A',
              items: [
                { term: '3-1', subject: '물리학Ⅱ', credits: 3 },
                { term: '3-2', subject: '화학Ⅱ', credits: 3 },
              ],
            },
            {
              label: 'B',
              items: [
                { term: '3-1', subject: '물리학Ⅱ', credits: 3 },
                { term: '3-2', subject: '생명과학Ⅱ', credits: 3 },
              ],
            },
          ],
        },
      ],
    }
    const one = excludeChoice(school, EMPTY, '화학Ⅱ')
    expect(one.alsoExcluded).toEqual([])
    expect(lockedBy(school, one.excluded).size).toBe(0)
    // 나머지 세트까지 빼면 앞서 뺀 세트로 바꾼다
    const two = excludeChoice(school, one, '생명과학Ⅱ')
    expect(two.excluded).toEqual(['생명과학Ⅱ'])
    expect(two.reopened.map((o) => o.set)).toEqual(['A'])
    // 두 세트에 모두 든 과목은 꼭 들어야 한다
    const all = excludeChoice(school, one, '물리학Ⅱ')
    expect(all.refused).toEqual({ reason: 'every-set', where: '과학 세트' })
    expect(all.excluded).toEqual(one.excluded)
    expect(choiceNotice('물리학Ⅱ', all)).toBe('물리학Ⅱ: 과학 세트의 모든 세트에 들어 있는 과목이라 뺄 수 없어요.')
  })
})

describe('선택 칸 꼭 듣기·빼기', () => {
  it('택1 칸의 두 과목을 모두 빼면 앞서 뺀 과목을 다시 넣는다', () => {
    const a = excludeChoice(DIMIGO_FULL, EMPTY, '미적분Ⅱ')
    const b = excludeChoice(DIMIGO_FULL, a, '확률과 통계')
    expect(b.excluded).toEqual(['확률과 통계'])
    expect(b.reopened).toEqual([{ where: '3학년 1학기 수학 선택', pick: 1, subjects: ['미적분Ⅱ'] }])
    expect(choiceNotice('확률과 통계', b)).toBe('확률과 통계: 3학년 1학기 수학 선택에서는 1과목을 골라야 해서 미적분Ⅱ를 다시 넣었어요.')
    expectValid(DIMIGO_FULL, b)
  })

  it('칸에 과목이 고르는 수만큼만 있으면 뺄 수 없다', () => {
    const school: School = {
      ...DIMIGO_FULL,
      terms: DIMIGO_FULL.terms.map((t) =>
        t.id === '2-2' ? { ...t, groups: [{ id: 'g', label: '사회 선택', pick: 2, credits: 3, options: ['경제', '정치'] }] } : t,
      ),
    }
    const r = excludeChoice(school, EMPTY, '경제')
    expect(r.refused).toEqual({ reason: 'whole-group', where: '2학년 2학기 사회 선택' })
    expect(r.excluded).toEqual([])
  })

  it('칸을 다시 채울 때는 오래전에 뺀 과목부터 넣는다', () => {
    const school: School = {
      ...DIMIGO_FULL,
      terms: DIMIGO_FULL.terms.map((t) =>
        t.id === '3-1' ? { ...t, groups: [{ id: 'g', label: '수학 선택', pick: 1, credits: 3, options: ['확률과 통계', '미적분Ⅱ', '기하'] }] } : t,
      ),
    }
    const a = excludeChoice(school, EMPTY, '확률과 통계')
    const b = excludeChoice(school, a, '미적분Ⅱ')
    const c = excludeChoice(school, b, '기하')
    expect(c.reopened).toEqual([{ where: '3학년 1학기 수학 선택', pick: 1, subjects: ['확률과 통계'] }])
    expect(c.excluded).toEqual(['미적분Ⅱ', '기하'])
    expectValid(school, c)
  })

  it('두 칸에 함께 있는 과목은 한 번만 센다: 반송고 교과 영역 간 선택 두 칸을 한 과목으로 남기지 않는다', () => {
    let s: ChoiceState = EMPTY
    const out = ['인공지능 수학', '미디어 영어', '드로잉', '로봇과 공학세계', '생활과학 탐구', '음악사', '기하', '영미 문학 읽기']
    for (const x of out) {
      const r = excludeChoice(BANSONG_2026, s, x)
      expect(r.reopened, x).toEqual([])
      s = r
    }
    // 아홉 번째: 두 칸에 주제 탐구 독서 하나만 남으니 가장 먼저 뺀 인공지능 수학을 다시 넣는다
    const r = excludeChoice(BANSONG_2026, s, '미술사')
    expect(r.refused).toBeUndefined()
    expect(r.reopened).toEqual([{ where: '2학년 1학기 교과 영역 간 선택', pick: 1, subjects: ['인공지능 수학'] }])
    s = pinChoice(BANSONG_2026, r, '주제 탐구 독서')
    expectValid(BANSONG_2026, s)
    const plan = makePlan(BANSONG_2026, [], s)
    const g22 = plan.groups.find((g) => g.group.id === '2-2-교과영역간')!
    const g21 = plan.groups.find((g) => g.group.id === '2-1-교과영역간')!
    // 두 칸 모두 학생이 고를 과목이 남아 있다
    for (const g of [g21, g22])
      expect(
        g.group.options.some((o) => !plan.excluded.has(o) && (!plan.taken.has(o) || g.chosen.includes(o))),
        g.group.id,
      ).toBe(true)
  })

  it('모두 듣는 과목은 선택 칸을 채우지 못한다', () => {
    const base = emptySchool({ id: 'f', name: '가나고', region: '서울', cohort: 2026 })
    const school: School = {
      ...base,
      terms: base.terms.map((t) =>
        t.id === '2-1'
          ? { ...t, fixed: [{ subject: '정보', credits: 2 }] }
          : t.id === '2-2'
            ? { ...t, groups: [{ id: 'b', label: '탐구 선택', pick: 1, credits: 3, options: ['화학', '정보', '경제'] }] }
            : t,
      ),
    }
    const a = excludeChoice(school, EMPTY, '화학')
    const b = excludeChoice(school, a, '경제')
    expect(b.reopened).toEqual([{ where: '2학년 2학기 탐구 선택', pick: 1, subjects: ['화학'] }])
    expect(b.excluded).toEqual(['경제'])
    expectValid(school, b)
    // 다시 넣을 과목이 없으면 뺄 수 없다
    const only: School = { ...school, terms: school.terms.map((t) => (t.id === '2-2' ? { ...t, groups: [{ ...t.groups[0], options: ['정보', '경제'] }] } : t)) }
    expect(excludeChoice(only, EMPTY, '경제').refused).toEqual({ reason: 'whole-group', where: '2학년 2학기 탐구 선택' })
    // 예전에 저장된 상태도 같은 규칙으로 고친다
    const fixed = repairChoices(school, { pinned: [], excluded: ['화학', '경제'] })!
    expect(fixed.excluded).toEqual(['경제'])
    expect(fixed.reopened).toEqual([{ where: '2학년 2학기 탐구 선택', pick: 1, subjects: ['화학'] }])
  })

  it('택1 칸에 두 과목을 꼭 듣기로 하면 먼저 고른 것을 푼다', () => {
    const a = pinChoice(DIMIGO_FULL, EMPTY, '확률과 통계')
    const b = pinChoice(DIMIGO_FULL, a, '미적분Ⅱ')
    expect(b.pinned).toEqual(['미적분Ⅱ'])
    expect(b.bumped).toEqual(['확률과 통계'])
    expect(choiceNotice('미적분Ⅱ', b)).toBe('미적분Ⅱ: 들어갈 칸이 모자라 확률과 통계의 꼭 듣기를 풀었어요.')
    expectValid(DIMIGO_FULL, b)
  })

  it('꼭 듣기는 권장과목을 아무리 많이 채우는 과목보다 먼저 자리를 잡는다', () => {
    // 학과 120곳이 모두 미적분Ⅱ를 핵심과목으로 요구해도, 같은 택1 칸에 꼭 듣기로 한 확률과 통계가 들어간다
    const units: Unit[] = Array.from({ length: 120 }, (_, i) => ({
      id: `u${i}`,
      univ: 'snu',
      name: `학과${i}`,
      majors: [],
      clauses: [{ subjects: ['미적분Ⅱ'], pick: 1, level: 'core' }],
    }))
    const plan = makePlan(DIMIGO_FULL, units, { pinned: ['확률과 통계'] })
    expect(plan.unplacedPins).toEqual([])
    expect(plan.taken.has('확률과 통계')).toBe(true)
  })
})

describe('저장된 선택 고치기', () => {
  it('운영에 남아 있던 실제 상태: 두 코스를 모두 막은 것을 나중에 뺀 쪽을 따라 고친다', () => {
    const saved: ChoiceState = { pinned: [], excluded: ['미적분Ⅱ', '컴퓨터 보안', '인공지능 모델링'] }
    const fixed = repairChoices(DIMIGO_FULL, saved)!
    expect(fixed).not.toBeNull()
    expect(fixed.excluded).toEqual(['미적분Ⅱ', '인공지능 모델링', '빅데이터 분석'])
    expect(fixed.reopened.map((o) => o.set)).toEqual(['정보보안코스'])
    expect(repairNotice(fixed)).toBe(
      '저장된 선택 가운데 함께 고를 수 없는 것이 있어 고쳤어요. 코스 선택에서는 세트 하나를 꼭 들어야 해서 정보보안코스(네트워크 프로그래밍, 컴퓨터 보안)를 다시 넣었어요. 같은 세트 과목을 빼서 들을 수 없는 빅데이터 분석도 뺐어요.',
    )
    expect(makePlan(DIMIGO_FULL, [], fixed).tracks[0].setIndex).toBe(1)
    expectValid(DIMIGO_FULL, fixed)
  })

  it('두 코스에서 하나씩 빼고 남은 하나씩을 꼭 듣기로 한 예전 상태는 나중 꼭 듣기를 남긴다', () => {
    const saved: ChoiceState = { pinned: ['네트워크 프로그래밍', '빅데이터 분석'], excluded: ['컴퓨터 보안', '인공지능 모델링'] }
    expect([...lockedBy(DIMIGO, saved.excluded).keys()].sort()).toEqual(['네트워크 프로그래밍', '빅데이터 분석'])
    const fixed = repairChoices(DIMIGO, saved)!
    expect(fixed.pinned).toEqual(['빅데이터 분석'])
    expect(fixed.bumped).toEqual(['네트워크 프로그래밍'])
    expect(fixed.alsoIncluded).toEqual(['인공지능 모델링'])
    expect(fixed.excluded).toEqual(['컴퓨터 보안', '네트워크 프로그래밍'])
    expectValid(DIMIGO, fixed)
  })

  it('꼭 듣기와 빼기에 같은 과목이 있으면 꼭 듣기를 따른다 (계획도 그렇게 짠다)', () => {
    const fixed = repairChoices(DIMIGO_FULL, { pinned: ['확률과 통계'], excluded: ['확률과 통계', '미적분Ⅱ'] })!
    expect(fixed.pinned).toEqual(['확률과 통계'])
    expect(fixed.excluded).toEqual(['미적분Ⅱ'])
    expect(repairNotice(fixed)).toBeNull()
  })

  it('학교에 없는 꼭 듣기는 푼다', () => {
    const fixed = repairChoices(DIMIGO_FULL, { pinned: ['고전 읽기', '확률과 통계'], excluded: [] })!
    expect(fixed.pinned).toEqual(['확률과 통계'])
    expect(fixed.bumped).toEqual(['고전 읽기'])
  })

  it('공유 링크로 만든 엉뚱한 편제표(6묶음 × 6세트, 택30)와 꼭 듣기 39개도 금방 고친다', () => {
    const subj = (t: number, j: number) => `가과목 ${t}${j}`
    const make = (pick: number) =>
      schoolFromLoose(
        {
          terms: [{ id: '2-1', groups: [{ label: '선택', pick, credits: 1, options: Array.from({ length: 36 }, (_, k) => subj(Math.floor(k / 6), k % 6)) }] }],
          tracks: Array.from({ length: 6 }, (_, t) => ({
            label: `세트 ${t}`,
            sets: Array.from({ length: 6 }, (_, j) => ({ label: `세트 ${t}-${j}`, items: [{ term: '3-1', subject: subj(t, j), credits: 1 }] })),
          })),
        },
        { id: 'x', name: '학교', region: '', cohort: 2026 },
      )
    const setSubjects = Array.from({ length: 36 }, (_, k) => subj(Math.floor(k / 6), k % 6))
    const stale = ['없는 과목 1', '없는 과목 2', '없는 과목 3']
    const t0 = performance.now()
    // 세트 6개 + 선택 칸 30자리 = 36과목이 모두 들어간다
    const fits = repairChoices(make(30), { pinned: [...stale, ...setSubjects], excluded: ['없는 과목 4'] })!
    expect(fits.bumped).toEqual(stale)
    expect(fits.pinned).toEqual(setSubjects)
    expect(fits.excluded).toEqual([])
    // 자리가 하나 모자라면 먼저 고른 것 하나를 푼다
    const short = repairChoices(make(29), { pinned: [...stale, ...setSubjects], excluded: [] })!
    expect(short.pinned).toHaveLength(35)
    expect(short.bumped).toEqual([...stale, setSubjects[0]])
    // 예전에는 30초 넘게 걸렸다
    expect(performance.now() - t0).toBeLessThan(5000)
  })

  it('규칙에 맞는 선택은 그대로 둔다', () => {
    expect(repairChoices(DIMIGO_FULL, EMPTY)).toBeNull()
    expect(repairChoices(DIMIGO_FULL, { pinned: ['컴퓨터 보안'], excluded: ['미적분Ⅱ'] })).toBeNull()
  })
})

/** 묶음 두 개, 세트끼리 겹치는 과목, 세트와 선택 칸에 함께 있는 과목, 택2 칸이 섞인 학교 */
const MIXED: School = {
  ...emptySchool({ id: 'mixed', name: '섞인고', region: '서울', cohort: 2026 }),
  terms: emptySchool({ id: 'mixed', name: '섞인고', region: '서울', cohort: 2026 }).terms.map((t) =>
    t.id === '2-1'
      ? {
          ...t,
          fixed: [{ subject: '정보', credits: 2 }],
          groups: [{ id: 'a', label: '과학 선택', pick: 2, credits: 3, options: ['물리학', '화학', '생명과학', '지구과학'] }],
        }
      : t.id === '2-2'
        ? { ...t, groups: [{ id: 'b', label: '탐구 선택', pick: 1, credits: 3, options: ['화학', '정보', '경제'] }] }
        : t.id === '3-1'
          ? { ...t, groups: [{ id: 'c', label: '수학 선택', pick: 1, credits: 3, options: ['미적분Ⅱ', '기하', '확률과 통계'] }] }
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
      sets: [course('일본어', '일본어', '일본어 회화'), course('중국어', '중국어', '중국어 회화')],
    },
  ],
}

describe('세트 고르기', () => {
  it('그 세트에만 있고 세트로만 듣는 과목을 꼭 듣기로 하면 그 세트가 정해진다', () => {
    expect(setPickSubject(MIXED, 't1', 0)).toBe('전자기와 양자')
    expect(setPickSubject(MIXED, 't1', 1)).toBe('물질과 에너지')
    // 융합 세트의 역학과 에너지는 물리 세트에도, 화학은 선택 칸에도 있어 과목 하나로는 정할 수 없다
    expect(setPickSubject(MIXED, 't1', 2)).toBeNull()
    expect(setPickSubject(MIXED, 't2', 1)).toBe('중국어')
    expect(setPickSubject(MIXED, 'none', 0)).toBeNull()
    for (const setIndex of [0, 1]) {
      const subject = setPickSubject(MIXED, 't1', setIndex)!
      const s = pinChoice(MIXED, EMPTY, subject)
      expect(makePlan(MIXED, [], s).tracks[0].setIndex).toBe(setIndex)
    }
  })
})

describe('어떤 순서로 눌러도', () => {
  for (const [name, school] of [
    ['디미고', DIMIGO_FULL],
    ['섞인 학교', MIXED],
  ] as const) {
    it(`${name}: 무작위로 수백 번 꼭 듣기·빼기를 눌러도 세트·선택 칸이 비지 않고 꼭 듣기가 모두 들어간다`, () => {
      const subjects = [
        ...new Set([
          ...school.terms.flatMap((t) => t.groups.flatMap((g) => g.options)),
          ...school.tracks.flatMap((t) => t.sets.flatMap((s) => s.items.map((i) => i.subject))),
        ]),
      ]
      for (const start of [1, 7, 42]) {
        let seed = start
        const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
        let s: ChoiceState = EMPTY
        for (let i = 0; i < 300; i++) {
          const subject = subjects[Math.floor(next() * subjects.length)]
          const label = `${start}/${i} ${subject} ${JSON.stringify(s)}`
          const pin = next() < 0.5
          const r = pin
            ? s.pinned.includes(subject)
              ? unpinChoice(s, subject)
              : pinChoice(school, s, subject)
            : s.excluded.includes(subject)
              ? includeChoice(school, s, subject)
              : excludeChoice(school, s, subject)
          if (r.refused) {
            // 하지 않은 바꾸기는 상태를 그대로 둔다
            expect(r.pinned, label).toBe(s.pinned)
            expect(r.excluded, label).toBe(s.excluded)
          } else if (pin) {
            // 누른 대로 된다: 꼭 듣기·풀기는 그 과목에 그대로, 빼기·다시 넣기도 그 과목에 그대로
            expect(r.pinned.includes(subject), label).toBe(!s.pinned.includes(subject))
          } else {
            expect(r.excluded.includes(subject), label).toBe(!s.excluded.includes(subject))
          }
          s = { pinned: r.pinned, excluded: r.excluded }
          expectValid(school, s, label)
        }
      }
    })
  }

  it('어떤 엇갈린 상태든 고치면 규칙에 맞는다', () => {
    let seed = 3
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (const school of [DIMIGO_FULL, MIXED]) {
      const subjects = [
        ...new Set([
          ...school.terms.flatMap((t) => t.groups.flatMap((g) => g.options)),
          ...school.tracks.flatMap((t) => t.sets.flatMap((s) => s.items.map((i) => i.subject))),
        ]),
        '없는 과목',
      ]
      for (let i = 0; i < 200; i++) {
        const pick = () => subjects.filter(() => next() < 0.3)
        const saved = { pinned: pick(), excluded: pick() }
        const fixed = repairChoices(school, saved) ?? saved
        expectValid(school, { pinned: fixed.pinned, excluded: fixed.excluded }, JSON.stringify(saved))
      }
    }
  })
})
