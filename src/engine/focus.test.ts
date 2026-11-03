import { describe, expect, it } from 'vitest'
import type { AdmissionPlan } from '../data/schema'
import { BANSONG_2026 } from '../data/schools/bansong2026'
import { SUBJECT_BY_NAME } from '../data/subjects'
import { UNIT_BY_ID } from '../data/units'
import { MAJOR_BY_ID } from '../data/majors'
import { focusUnits, myGroups, NO_RANK, recordUse, SUNEUNG_2028, subjectsIn, unitRoutes } from './focus'
import { makePlan } from './plan'

const plan = (univ: string, essay?: string): AdmissionPlan => ({
  univ,
  planTitle: '',
  url: '',
  date: '2026-04-30',
  totals: null,
  changes: [],
  tracks: [
    {
      id: 'essay',
      name: '논술전형',
      type: '논술',
      period: '수시',
      quota: '정원내',
      seats: 10,
      grads: '졸업자포함',
      rec: null,
      schools: { only: [], exclude: [] },
      regions: [],
      special: [],
      who: '',
      method: '논술 100%',
      elements: ['논술'],
      min: null,
      subjects: null,
      note: null,
      pages: '1',
      ...(essay ? { essay } : {}),
    },
  ],
})

describe('목표 전형', () => {
  it('과목 이름이 모두 과목 목록에 있다', () => {
    for (const s of [...NO_RANK, ...SUNEUNG_2028.flatMap((a) => a.subjects)]) expect(SUBJECT_BY_NAME.has(s), s).toBe(true)
  })

  it('글에서 과목 이름을 찾는다 (미적분Ⅰ과 미적분Ⅱ를 따로)', () => {
    expect(subjectsIn('자연계: 수리 논술(대수, 미적분Ⅰ, 확률과 통계, 미적분Ⅱ, 기하)').sort()).toEqual(
      ['기하', '대수', '미적분Ⅰ', '미적분Ⅱ', '확률과 통계'].sort(),
    )
    expect(subjectsIn('인문 통합 논술')).toEqual([])
  })

  it('정시는 수능 출제 과목, 논술은 대학 출제 범위를 조건으로 더한다', () => {
    const by = new Map([
      ['korea', plan('korea', '수리 논술: 대수, 미적분Ⅰ, 확률과 통계, 미적분Ⅱ, 기하')],
      ['snu', plan('snu')],
    ])
    expect(focusUnits('종합', ['korea'], by)).toEqual([])
    const exam = focusUnits('정시', ['korea'], by)
    expect(exam[0].clauses.flatMap((c) => c.subjects)).toContain('미적분Ⅰ')
    const essay = focusUnits('논술', ['korea', 'snu'], by)
    expect(essay.map((u) => u.id)).toEqual(['exam:essay:korea'])
    // 계획에 들어가면 학교 편제표에서 그 과목을 고른다
    const p = makePlan(BANSONG_2026, [UNIT_BY_ID.get('cau:소프트웨어학부')!, ...essay])
    expect(p.units.find((r) => r.unit.id === 'exam:essay:korea')).toBeTruthy()
    expect(p.taken.has('미적분Ⅱ')).toBe(true)
  })
})

describe('논술 출제 범위는 고른 학과의 계열 것만', () => {
  // 대학 시행계획에서 옮긴 범위 글 (admissions2028.json과 같은 글)
  const KHU =
    '제시문·논제로 구성된 자료 제시형, 고교 교육과정 범위 내 출제, 120분. 인문·체육계·사회계 통합형 2문항 내외(각 1,000자 내외, 원고지 형식), 자연계 수리논술 수학 6문항 내외, 의·약학계 수학·과학 각 4문항 내외(수리 60%·과학 40%, 과학은 물리학·화학·생명과학 중 택1). 사회계는 도표·통계 등 제시문 활용'
  const KNU =
    '100분, 논술형·약술형·풀이형(350점). 인문계열 교과통합형(화법과 언어, 독서와 작문, 문학, 통합사회Ⅰ·Ⅱ 등) / 자연계열Ⅰ 수학(대수, 미적분Ⅰ, 확률과 통계)과 교과목 통합형(통합과학Ⅰ·Ⅱ 등) / 자연계열Ⅱ(의예·치의예·수의예) 수학과 의학논술(생명과학, 세포와 물질대사, 생물의 유전 등)'
  const AJOU =
    '90분, 영어 제시문 없음. 자연계열(약학과 포함) 수리논술 / 의학과 수리논술 + 과학논술(생명과학) / 인문계열 통합논술(언어·사회). 고교 교육과정 수준, 공식 암기형 문제 없음, 수리·과학논술은 풀이과정 부분점수'
  const DONGGUK =
    '인문: 제시문 기반 통합교과형, 국어·사회·한국사(공통·일반·진로·융합선택 전 과목), 400자 이내 2문항+700자 이내 1문항, 100분 / 자연: 수학논술, 공통수학·대수·미적분Ⅰ·확률과 통계·기하·미적분Ⅱ, 15줄 이내 2문항+27줄 이내 1문항, 90분. 문항별 7점 척도, 3문항 합 100점'
  const KAU =
    '2문항. 수리논술(공과대학·AI융합대학·스마트드론·AI자율주행·자유전공 공학·이학적성, 항공·경영대학 이학적성, 항공운항학과): 대수·미적분Ⅰ·확률과통계, 수리적 분석력·응용력·창의력 측정 / 언어논술(항공·경영대학·자유전공학부 사회적성): 인문·사회 교과, 논리력·통합력 측정'
  const KONKUK =
    "계열 구분 없이 '통합'으로 출제. 국어+통합사회 1문항, 수학 3문항. 범위: 국어(공통국어1·2, 화법과언어, 독서와작문, 문학)·통합사회1·2, 수학(공통수학1·2, 대수, 미적분Ⅰ, 확률과통계)"
  const by = new Map(
    (
      [
        ['khu', KHU],
        ['knu', KNU],
        ['ajou', AJOU],
        ['dongguk', DONGGUK],
        ['kau', KAU],
        ['konkuk', KONKUK],
      ] as const
    ).map(([univ, essay]) => [univ, plan(univ, essay)]),
  )
  const unit = (id: string) => UNIT_BY_ID.get(id)!
  const range = (id: string) =>
    focusUnits('논술', [unit(id).univ], by, [unit(id)]).flatMap((u) => u.clauses.map((c) => ({ pick: c.pick, subjects: [...c.subjects].sort() })))
  const all = (...subjects: string[]) => ({ pick: 'all', subjects: subjects.sort() })

  it('띄어쓰기 없이 적은 과목명도 찾는다', () => {
    expect(subjectsIn('화법과언어, 독서와작문, 확률과통계').sort()).toEqual(['독서와 작문', '확률과 통계', '화법과 언어'].sort())
    expect(range('konkuk:공과대학')).toEqual([all('화법과 언어', '독서와 작문', '문학', '대수', '미적분Ⅰ', '확률과 통계')])
    expect(range('kau:공과대학')).toEqual([all('대수', '미적분Ⅰ', '확률과 통계')])
  })

  it('경희대: 의·약학계만 과학 1과목 (물리학·화학·생명과학 중 택1), 자연계·인문계는 지정 과목 없음', () => {
    expect(range('khu:의예과')).toEqual([{ pick: 1, subjects: ['물리학', '생명과학', '화학'] }])
    expect(range('khu:약학과')).toEqual([{ pick: 1, subjects: ['물리학', '생명과학', '화학'] }])
    expect(range('khu:컴퓨터공학과')).toEqual([])
    expect(range('khu:간호학과')).toEqual([])
  })

  it('경북대: 인문·자연Ⅰ·자연Ⅱ(의예·치의예·수의예) 범위를 계열마다 따로', () => {
    expect(range('knu:사학과')).toEqual([all('화법과 언어', '독서와 작문', '문학')])
    expect(range('knu:수학과')).toEqual([all('대수', '미적분Ⅰ', '확률과 통계')])
    expect(range('knu:약학대학 전 모집단위')).toEqual([all('대수', '미적분Ⅰ', '확률과 통계')])
    expect(range('knu:의과대학 전 모집단위')).toEqual([all('생명과학', '세포와 물질대사', '생물의 유전')])
  })

  it('아주대: 과학논술(생명과학)은 의학과만', () => {
    expect(range('ajou:의학과')).toEqual([all('생명과학')])
    expect(range('ajou:약학과')).toEqual([])
    expect(range('ajou:기계공학과')).toEqual([])
  })

  it('동국대: 인문 지원자에게 자연계 수학을 넣지 않는다', () => {
    expect(range('dongguk:법학과')).toEqual([])
    expect(range('dongguk:수학과')).toEqual([all('대수', '미적분Ⅰ', '확률과 통계', '기하', '미적분Ⅱ')])
    expect(range('dongguk:열린전공학부(인문)')).toEqual([])
  })

  it('한국항공대: 같은 단과대학도 이학적성·사회적성이 다르다', () => {
    expect(range('kau:항공경영대학(이학적성)')).toEqual([all('대수', '미적분Ⅰ', '확률과 통계')])
    expect(range('kau:항공경영대학(사회적성)')).toEqual([])
  })

  it('그 대학 학과를 고르지 않았으면 다른 대학에서 고른 학과의 계열로, 학과를 주지 않으면 모든 범위를 넣는다', () => {
    const cs = UNIT_BY_ID.get('cau:소프트웨어학부')!
    expect(focusUnits('논술', ['knu'], by, [cs])[0].clauses.map((c) => c.subjects)).toEqual([['대수', '미적분Ⅰ', '확률과 통계']])
    expect(focusUnits('논술', ['knu'], by)[0].clauses).toHaveLength(3)
  })
})

describe('전형별로 권장과목을 넣을지', () => {
  const track = (id: string, type: AdmissionPlan['tracks'][number]['type'], period: '수시' | '정시', elements: string[], method: string, seats = 100) =>
    ({
      id,
      name: id,
      type,
      period,
      quota: '정원내',
      seats,
      grads: null,
      rec: null,
      schools: { only: [], exclude: [] },
      regions: [],
      special: [],
      who: '',
      method,
      elements,
      min: null,
      subjects: null,
      note: null,
      pages: '1',
    }) as AdmissionPlan['tracks'][number]
  const withTracks = (univ: string, tracks: AdmissionPlan['tracks']): AdmissionPlan => ({ ...plan(univ), tracks })
  const unit = UNIT_BY_ID.get('cau:소프트웨어학부')!

  it('전형 방법으로 학생부를 서류로 보는지, 성적만 보는지, 안 보는지 가른다', () => {
    expect(recordUse(track('a', '수능', '정시', ['수능', '교과'], '1단계 수능 100% → 2단계 수능 60점 + 교과역량평가 40점'))).toBe('record')
    expect(recordUse(track('b', '수능', '정시', ['수능', '교과'], '수능 80% + 학생부(교과) 20%'))).toBe('grades')
    expect(recordUse(track('c', '수능', '정시', ['수능'], '수능 100%'))).toBe('exam')
    // 예외 모집단위 설명(첫 문장 뒤)에 나온 정성평가는 보지 않는다
    expect(recordUse(track('d', '수능', '정시', ['수능', '교과'], '수능 100%. 자유전공학부는 수능 90% + 교과정성 10%'))).toBe('grades')
  })

  it('정시가 수능만 보는 대학은 빼고, 서류를 보는 대학은 넣는다', () => {
    const byUniv = new Map([['cau', withTracks('cau', [track('j', '수능', '정시', ['수능'], '수능 100%')])]])
    const [r] = unitRoutes('정시', [unit], byUniv)
    expect([r.keep, r.kind]).toEqual([false, 'exam'])
    const byUniv2 = new Map([['cau', withTracks('cau', [track('j', '수능', '정시', ['수능', '서류'], '수능 90% + 학생부종합평가 10%')])]])
    expect(unitRoutes('정시', [unit], byUniv2)[0].keep).toBe(true)
  })

  it('작은 전형 하나 때문에 판단이 뒤집히지 않고, 그 전형이 없으면 학생부종합 기준으로 넣는다', () => {
    const byUniv = new Map([
      ['cau', withTracks('cau', [track('big', '수능', '정시', ['수능'], '수능 100%', 900), track('small', '수능', '정시', ['서류'], '학생부평가 100%', 30)])],
    ])
    expect(unitRoutes('정시', [unit], byUniv)[0].kind).toBe('exam')
    const r = unitRoutes('논술', [unit], byUniv)[0]
    expect([r.keep, r.kind]).toEqual([true, 'none'])
    expect(unitRoutes('종합', [unit], byUniv)[0].keep).toBe(true)
  })

  it('학과별 모집인원이 있으면 그 학과를 뽑는 전형만 본다', () => {
    const byUniv = new Map([
      [
        'cau',
        withTracks('cau', [track('rec', '교과', '수시', ['교과', '서류'], '교과 80% + 서류 20%'), track('grade', '교과', '수시', ['교과'], '교과 100%')]),
      ],
    ])
    const seats = { cau: { [unit.id]: { grade: 10 } } }
    expect(unitRoutes('교과', [unit], byUniv, seats)[0].kind).toBe('grades')
    expect(unitRoutes('교과', [unit], byUniv)[0].kind).toBe('record')
  })
})

describe('정시 반영 묶음에서 내 학과', () => {
  const field = (m: string) => MAJOR_BY_ID.get(m)?.field
  const cs = UNIT_BY_ID.get('snu:컴퓨터공학부')!
  const rule = (group: string, units: string) => ({ group, units })

  it('묶음 이름의 큰 분야 말로 고르고, 설명에 섞인 다른 계열 말은 보지 않는다', () => {
    const rules = [
      rule('자연(표준점수)', '자연계열 전체 모집단위(가정교육과, 간호학과 제외)'),
      rule('인문·가정교육·간호·체능(표준점수)', '인문계열 전체 모집단위, 자연계열 가정교육과·간호학과, 체능 체육교육과'),
    ]
    expect([...myGroups(rules, [cs], field)].map((r) => r.group)).toEqual(['자연(표준점수)'])
  })

  it('묶음 설명에 학과 이름이 있으면 그 묶음이다', () => {
    const rules = [rule('특정 학과', '컴퓨터공학부, 전기·정보공학부'), rule('나머지', '그 밖의 모집단위')]
    expect([...myGroups(rules, [cs], () => undefined)].map((r) => r.group)).toEqual(['특정 학과'])
  })
})
