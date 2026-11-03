import { describe, expect, it } from 'vitest'
import type { School, Unit } from '../data/schema'
import { BANSONG_2026 } from '../data/schools/bansong2026'
import { UNIT_BY_ID } from '../data/units'
import { decodeShare, encodeShare } from '../lib/share'
import { pinChoice } from './choices'
import { makePlan } from './plan'
import { checkSchool, emptySchool, matchSubject, schoolFromLoose, termCredits } from './school'

const u = (id: string): Unit => UNIT_BY_ID.get(id)!
const fake = (clauses: Unit['clauses']): Unit => ({ id: 'test:x', univ: 'cau', name: '테스트', majors: [], clauses })

describe('고정·제외', () => {
  it('고정한 과목이 같은 칸의 권장과목보다 먼저 자리를 잡는다', () => {
    const plan = makePlan(BANSONG_2026, [u('cau:소프트웨어학부')], { pinned: ['영미 문학 읽기'] })
    expect(plan.taken.get('영미 문학 읽기')?.term).toBe('2-2')
    expect(plan.taken.has('기하')).toBe(false)
    const math = plan.units[0].clauses.find((c) => c.candidates.includes('기하'))!
    expect(math.missing).toEqual([{ subject: '기하', reason: 'no-slot', cause: 'pinned', by: ['영미 문학 읽기'] }])
  })

  it('제외한 과목은 넣지 않고 이유를 excluded로 남긴다', () => {
    const plan = makePlan(BANSONG_2026, [u('cau:의학부')], { excluded: ['화학'] })
    expect(plan.taken.has('화학')).toBe(false)
    const c = plan.units[0].clauses.find((x) => x.candidates.includes('화학'))!
    expect(c.missing).toContainEqual({ subject: '화학', reason: 'excluded' })
  })

  it('세트 과목을 고정하면 그 세트를 고른다', () => {
    const plan = makePlan(BANSONG_2026, [u('cau:AI학과')], { pinned: ['중국어 회화'] })
    const t = plan.tracks.find((x) => x.track.id === '2-제2외국어')!
    expect(t.setIndex).toBe(1)
    expect(plan.taken.has('중국어')).toBe(true)
  })

  it('한 칸에 두 개를 고정하면 하나는 못 넣었다고 알려 준다', () => {
    const plan = makePlan(BANSONG_2026, [fake([])], { pinned: ['기하', '영미 문학 읽기'] })
    expect(plan.unplacedPins).toHaveLength(1)
  })

  it('고정과 제외를 같이 걸면 고정이 이긴다', () => {
    const plan = makePlan(BANSONG_2026, [fake([])], { pinned: ['기하'], excluded: ['기하'] })
    expect(plan.taken.has('기하')).toBe(true)
  })
})

describe('편제표 과목명 맞추기', () => {
  it.each([
    ['물리학Ⓐ', '물리학'],
    ['미적분II', '미적분Ⅱ'],
    ['미적분 Ⅱ', '미적분Ⅱ'],
    ['화학반응의세계', '화학 반응의 세계'],
    ['행성 우주과학', '행성우주과학'],
    ['기술ㆍ가정', '기술·가정'],
    ['합창․합주', '합창·합주'],
    ['  영어 Ⅰ ', '영어Ⅰ'],
    ['기후변화와 지속 가능한 세계', '기후변화와 지속가능한 세계'],
  ])('%s → %s', (raw, name) => {
    expect(matchSubject(raw)).toEqual({ name, known: true })
  })

  it('2015 개정 과목명은 모르는 이름으로 남긴다', () => {
    expect(matchSubject('물리학Ⅰ').known).toBe(false)
    expect(matchSubject('언어와 매체').known).toBe(false)
    expect(matchSubject('화법과 작문').known).toBe(false)
    expect(matchSubject('통합수학').known).toBe(false)
  })

  it.each([
    ['역사 탐구하는 현대 세계', '역사로 탐구하는 현대 세계'],
    ['인문과학과 윤리', '인문학과 윤리'],
    ['생활과 과학 탐구', '생활과학 탐구'],
    ['기후변화와 지속가능 세계', '기후변화와 지속가능한 세계'],
  ])('한두 글자 틀린 긴 이름 %s → %s', (raw, name) => {
    expect(matchSubject(raw)).toEqual({ name, known: true, fixedFrom: raw })
  })

  it('많이 틀린 이름은 억지로 고치지 않는다', () => {
    expect(matchSubject('역토 탐구는 현대 세계').known).toBe(false)
    expect(matchSubject('서민과 지리').known).toBe(false)
  })
})

describe('편제표 검사', () => {
  it('택N이 과목 수보다 크면 오류', () => {
    const s: School = {
      ...BANSONG_2026,
      terms: [{ id: '2-1', fixed: [], groups: [{ id: 'g', label: '묶음', pick: 3, credits: 3, options: ['물리학', '화학'] }] }],
      tracks: [],
    }
    const check = checkSchool(s)
    expect(check.issues.some((i) => i.level === 'error' && i.message.includes('택3'))).toBe(true)
  })

  it('반송고 편제표에는 오류도 모르는 과목도 없다', () => {
    const check = checkSchool(BANSONG_2026)
    expect(check.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(check.unknown).toEqual([])
    expect(Object.values(check.credits)).toEqual([29, 29, 29, 29, 29, 29])
    // 두 학기에 함께 열린 과목(주제 탐구 독서 등)은 정상이라 경고하지 않는다
    expect(check.issues).toEqual([])
  })

  it('학기 학점은 고른 세트로 세고, 세트마다 학점이 다르면 알린다', () => {
    const base = emptySchool({ id: 's', name: '가나고', region: '서울', cohort: 2026 })
    const school: School = {
      ...base,
      tracks: [
        {
          id: 't',
          label: '과학 세트',
          sets: [
            {
              label: 'A',
              items: [
                { term: '3-1', subject: '역학과 에너지', credits: 3 },
                { term: '3-2', subject: '전자기와 양자', credits: 3 },
              ],
            },
            {
              label: 'B',
              items: [
                { term: '3-1', subject: '물질과 에너지', credits: 4 },
                { term: '3-2', subject: '화학 반응의 세계', credits: 2 },
              ],
            },
          ],
        },
      ],
    }
    expect(termCredits(school, '3-1')).toBe(3)
    expect(termCredits(school, '3-1', [1])).toBe(4)
    expect(termCredits(school, '3-2', [1])).toBe(2)
    expect(termCredits(school, '3-1', [null])).toBe(3)
    expect(termCredits(school, '3-1', [7])).toBe(3)
    expect(
      termCredits(
        school,
        '3-1',
        makePlan(school, [], { pinned: ['물질과 에너지'] }).tracks.map((t) => t.setIndex),
      ),
    ).toBe(4)
    const warns = checkSchool(school).issues.filter((i) => i.level === 'warn' && i.message.includes('세트마다'))
    expect(warns.map((i) => i.term)).toEqual(['3-1', '3-2'])
    expect(warns[0].message).toBe('과학 세트: 세트마다 이 학기 학점이 달라요 (A 3학점, B 4학점). 학기 합계는 첫 세트로 셌어요.')
  })

  it('모두 듣는 과목이 선택 묶음·세트에도 있거나, 같은 학기 두 묶음에 같은 과목이 있으면 알린다', () => {
    const base = emptySchool({ id: 's', name: '가나고', region: '서울', cohort: 2026 })
    const school: School = {
      ...base,
      terms: base.terms.map((t) =>
        t.id === '2-1'
          ? {
              ...t,
              fixed: [{ subject: '정보', credits: 2 }],
              groups: [
                { id: 'a', label: '과학 선택', pick: 1, credits: 3, options: ['물리학', '화학'] },
                { id: 'b', label: '교과 선택', pick: 1, credits: 3, options: ['화학', '기하'] },
              ],
            }
          : t.id === '2-2'
            ? { ...t, groups: [{ id: 'c', label: '탐구 선택', pick: 1, credits: 3, options: ['경제', '정보'] }] }
            : t,
      ),
      tracks: [
        {
          id: 't',
          label: '정보 세트',
          sets: [
            { label: 'A', items: [{ term: '3-1', subject: '정보', credits: 2 }] },
            { label: 'B', items: [{ term: '3-1', subject: '기하', credits: 2 }] },
          ],
        },
      ],
    }
    const messages = checkSchool(school).issues.map((i) => `${i.term} ${i.message}`)
    expect(messages).toContain('2-1 화학이(가) 같은 학기 선택 묶음 두 곳(과학 선택, 교과 선택)에 들어 있어요.')
    expect(messages).toContain('2-2 정보은(는) 모두 듣는 과목인데 탐구 선택에도 들어 있어요. 이미 듣는 과목이라 그 칸에서는 고를 수 없어요.')
    // 같은 과목은 한 번만 알린다
    expect(messages.filter((m) => m.includes('정보은(는)'))).toHaveLength(1)
  })

  it('학점·선택 개수는 반올림해서 1 이상이어야 한다 (0.4는 비어 있는 값)', () => {
    const raw = {
      terms: [
        {
          id: '2-1',
          fixed: [
            { subject: '물리학', credits: 0.4 },
            { subject: '화학', credits: '2.6' },
            { subject: '지구과학', credits: 39.6 },
          ],
          groups: [{ label: 'x', pick: 0.4, credits: 0.3, options: ['생명과학', '기하'] }],
        },
      ],
    }
    const meta = { id: 'a', name: 'a', region: '', cohort: 2026 }
    // 저장해 둔 설계·공유 링크: 읽지 못한 학점은 3학점, 선택 개수는 1
    const loose = schoolFromLoose(raw, meta).terms.find((t) => t.id === '2-1')!
    expect(loose.fixed.map((f) => f.credits)).toEqual([3, 3, 3])
    expect(loose.groups[0]).toMatchObject({ pick: 1, credits: 3 })
    expect(checkSchool(schoolFromLoose(raw, meta)).issues.filter((i) => i.level === 'error')).toEqual([])
    expect(pinChoice(schoolFromLoose(raw, meta), { pinned: [], excluded: [] }, '생명과학').refused).toBeUndefined()
    // AI가 읽어 온 결과: 학점을 읽지 못한 과목·묶음은 뺀다
    const strict = schoolFromLoose(raw, meta, { strict: true }).terms.find((t) => t.id === '2-1')!
    expect(strict.fixed).toEqual([{ subject: '화학', credits: 3 }])
    expect(strict.groups).toEqual([])
  })

  it('모양이 이상한 입력은 버리고 개수에 상한을 둔다', () => {
    const raw = {
      terms: [
        { id: '2-1', fixed: Array.from({ length: 100 }, (_, i) => ({ subject: `과목${i}`, credits: 3 })), groups: 'nope' },
        { id: '<img>', fixed: [{ subject: 'x' }] },
        null,
      ],
      tracks: [{ sets: [{ items: [{ term: '9-9', subject: '무시' }] }] }],
    }
    const s = schoolFromLoose(raw, { id: 't', name: 't', region: '', cohort: 2026 })
    expect(s.terms.find((t) => t.id === '2-1')!.fixed).toHaveLength(30)
    expect(s.tracks).toEqual([])
    expect(s.terms).toHaveLength(6)
  })
})

describe('공유 링크', () => {
  it('인코딩한 상태를 그대로 되살린다', async () => {
    const school = { ...BANSONG_2026, id: 'neis-J10-7530847-2026' }
    const code = await encodeShare({ majors: ['cs', 'ee'], univs: ['cau', 'snu'], units: ['cau:소프트웨어학부'], school, pinned: ['기하'], excluded: ['화학'] })
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    const back = await decodeShare(code)
    expect(back).toMatchObject({ majors: ['cs', 'ee'], univs: ['cau', 'snu'], units: ['cau:소프트웨어학부'], pinned: ['기하'], excluded: ['화학'] })
    // 나이스 코드로 만든 학교 id와 편제표가 그대로 돌아온다 (선택 칸 id는 링크에 담지 않아 새로 붙는다)
    expect(back?.school.id).toBe('neis-J10-7530847-2026')
    const shape = (terms: School['terms']) => terms.map((t) => ({ ...t, groups: t.groups.map((g) => ({ ...g, id: '' })) }))
    expect(shape(back!.school.terms)).toEqual(shape(BANSONG_2026.terms))
  })

  it('특성화고 학과도 함께 담긴다', async () => {
    const school = { ...BANSONG_2026, id: 'neis-J10-7530560-2026-해킹방어과', name: '한국디지털미디어고등학교', track: '해킹방어과' }
    const back = await decodeShare(await encodeShare({ majors: ['security'], univs: [], units: [], school, pinned: [], excluded: [] }))
    expect(back?.school.id).toBe('neis-J10-7530560-2026-해킹방어과')
    expect(back?.school.track).toBe('해킹방어과')
  })

  it('없는 id는 버리고, 학교 데이터는 다시 검사한다', async () => {
    const code = await encodeShare({
      majors: ['cs', 'hack'],
      univs: ['nope', 'snu'],
      units: ['nope:x'],
      school: { ...BANSONG_2026, id: 'evil', name: '<script>alert(1)</script>가나다라마바사아자차카타파하', extra: 'drop' } as School,
      pinned: ['기하'],
      excluded: [],
    })
    const s = await decodeShare(code)
    expect(s?.majors).toEqual(['cs'])
    expect(s?.univs).toEqual(['snu'])
    expect(s?.units).toEqual([])
    expect(typeof s?.school).toBe('object')
    const school = s!.school as School
    expect(school.name.length).toBeLessThanOrEqual(30)
    expect('extra' in school).toBe(false)
    expect(school.terms.find((t) => t.id === '3-1')!.groups[0].options).toContain('미적분Ⅱ')
  })

  it('망가진 링크는 null', async () => {
    expect(await decodeShare('!!!')).toBeNull()
    expect(await decodeShare('q1YqU7Iy1FHKTczK')).toBeNull()
  })
})
