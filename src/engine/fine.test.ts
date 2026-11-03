import { describe, expect, it } from 'vitest'
import { FINE_BY_ID, FINE_MAJORS, MAJOR_ALIASES, MAJOR_BY_ID, MAJORS, upgradeMajors } from '../data/majors'
import { UNIT_BY_ID, UNITS } from '../data/units'
import { fineOf, searchMajors, unitsOf } from './search'

const u = (id: string) => UNIT_BY_ID.get(id)!

describe('세부 학과', () => {
  it('세부 학과 id는 겹치지 않고, 모두 있는 묶음에 속한다', () => {
    expect(new Set(FINE_MAJORS.map((f) => f.id)).size).toBe(FINE_MAJORS.length)
    for (const f of FINE_MAJORS) expect(MAJOR_BY_ID.has(f.parent)).toBe(true)
    for (const m of MAJORS) expect(FINE_MAJORS.some((f) => f.parent === m.id)).toBe(true)
  })

  it('모집단위 이름으로 세부 학과를 정한다', () => {
    expect(fineOf(u('cau:소프트웨어학부'))).toContain('cs-software')
    expect(fineOf(u('cau:소프트웨어학부'))).not.toContain('cs-computer')
    expect(fineOf(u('cau:의학부'))).toContain('med-med')
  })

  it('치의예·한의예는 의예로 잡지 않는다', () => {
    const dent = UNITS.find((x) => x.name.startsWith('치의예'))!
    const korean = UNITS.find((x) => x.name.startsWith('한의예'))!
    expect(fineOf(dent)).toEqual(['med-dent'])
    expect(fineOf(korean)).toEqual(['med-korean'])
  })

  it('세부 학과를 고르면 그 학과와 넓게 뽑는 모집단위만 나온다', () => {
    const computer = unitsOf('cs-computer').map((x) => x.id)
    expect(computer).not.toContain('cau:소프트웨어학부')
    expect(computer).toContain('skku:자연계열 전 모집단위')
    // 묶음 전체는 예전처럼 모두
    expect(unitsOf('cs').map((x) => x.id)).toContain('cau:소프트웨어학부')
  })

  it('하고 싶은 일로 찾으면 세부 학과가 먼저 나온다', () => {
    const hits = searchMajors('반도체')
    expect(hits[0].major.id).toBe('ee-semi')
    expect(searchMajors('약사')[0].major.id).toBe('pharm-pharm')
  })
})

describe('교육 계열 세부 학과', () => {
  it('과목마다 따로 고를 수 있고, 학과 이름이 섞이지 않는다', () => {
    for (const id of [
      'edu-korean',
      'edu-english',
      'edu-math',
      'edu-physics',
      'edu-computer',
      'edu-history',
      'edu-ethics',
      'edu-pe',
      'edu-elem',
      'edu-early',
      'edu-special',
    ])
      expect(FINE_BY_ID.has(id), id).toBe(true)
    const fineNames = (id: string) => fineOf(u(id))
    const korean = UNITS.find((x) => x.name === '국어교육과')!
    expect(fineNames(korean.id)).toContain('edu-korean')
    expect(fineNames(korean.id)).not.toContain('edu-english')
    // 화학공학교육과는 화학교육이 아니라 공학교육
    const chemEng = UNITS.find((x) => x.name === '화학공학교육과')
    if (chemEng) {
      expect(fineNames(chemEng.id)).toContain('edu-eng')
      expect(fineNames(chemEng.id)).not.toContain('edu-chem')
    }
    // 과학교육학부는 물리·화학·생물·지구과학교육 모두에 들고, 지구과학교육과는 지구과학교육에만
    const sci = UNITS.find((x) => x.name === '과학교육학부')!
    for (const id of ['edu-physics', 'edu-chem', 'edu-bio', 'edu-earth']) expect(fineNames(sci.id)).toContain(id)
    const earth = UNITS.find((x) => x.name === '지구과학교육과')!
    expect(fineNames(earth.id).filter((id) => id.startsWith('edu-'))).toEqual(['edu-earth'])
  })

  it('가까운 학과로 정한 id는 모두 있는 학과·묶음이다', () => {
    for (const f of FINE_MAJORS) for (const r of f.related ?? []) expect(MAJOR_BY_ID.has(r), `${f.id} → ${r}`).toBe(true)
  })

  it('예전에 하나로 묶였던 id는 새 세부 학과로 풀린다', () => {
    expect(upgradeMajors(['edu-sci', 'cs'])).toEqual(['edu-physics', 'edu-chem', 'edu-bio', 'edu-earth', 'cs'])
    expect(upgradeMajors(['hum-lang'])).toContain('hum-japanese')
    expect(upgradeMajors(['없는-id'])).toEqual([])
    for (const list of Object.values(MAJOR_ALIASES)) for (const id of list) expect(MAJOR_BY_ID.has(id)).toBe(true)
  })

  it('한 글자 낱말(법·별·열)은 다른 말 속에서 찾지 않는다', () => {
    const ids = (q: string) => searchMajors(q).map((h) => h.major.id)
    expect(ids('특별한 개발자')).not.toContain('earth-astro')
    expect(ids('마법 같은 게임')).not.toContain('soc-law')
    expect(ids('방법을 찾는 데이터 분석가')).not.toContain('soc-law')
    expect(ids('열심히 하는 간호사')).not.toContain('mech-mech')
    expect(searchMajors('특별한 개발자')[0].major.id).toBe('cs-computer')
    // 띄어 쓴 낱말이나 조사만 붙은 낱말은 찾는다
    expect(ids('별을 보는 일')).toContain('earth-astro')
    expect(ids('법 공부')).toContain('soc-law')
    expect(ids('앱을 만들고 싶어요')).toContain('cs')
    // 알파벳 낱말은 다른 알파벳에 붙어 있지 않을 때만
    expect(ids('aircraft 정비')).not.toContain('ai')
    expect(ids('AI 개발자')).toContain('ai-ai')
  })

  it('"컴퓨터 선생님"으로 찾으면 컴퓨터교육이 나온다', () => {
    expect(searchMajors('컴퓨터 선생님')[0].major.id).toBe('edu-computer')
    expect(searchMajors('유치원 선생님')[0].major.id).toBe('edu-early')
  })
})

describe('대학 공식 자료로 넣은 대학 (이화여대·한국교원대)', () => {
  const ids = (major: string) => unitsOf(major).map((x) => x.id)

  it('교원대 환경교육과는 환경교육에만 들고, 다른 교육 학과에 과학 권장과목이 섞이지 않는다', () => {
    expect(fineOf(u('knue:환경교육과'))).toContain('edu-env')
    for (const other of ['edu-korean', 'edu-english', 'edu-history', 'edu-early', 'edu-math']) expect(ids(other), other).not.toContain('knue:환경교육과')
    expect(ids('edu-env')).toContain('knue:환경교육과')
  })

  it('과목별 교육학과는 자기 세부 학과로 간다', () => {
    expect(ids('edu-math')).toEqual(expect.arrayContaining(['knue:수학교육과', 'ewha:수학교육과']))
    expect(ids('edu-physics')).toEqual(expect.arrayContaining(['knue:물리교육과', 'ewha:과학교육과']))
    expect(ids('edu-physics')).not.toContain('knue:화학교육과')
    expect(ids('edu-computer')).toContain('knue:컴퓨터교육과')
    expect(u('knue:컴퓨터교육과').clauses).toEqual([])
    // 이대 사회과교육과의 세 전공은 따로
    expect(ids('edu-geo')).toContain('ewha:지리교육전공')
    expect(ids('edu-geo')).not.toContain('ewha:역사교육전공')
  })

  it('이대 "그 밖의 모집단위"는 인문·사회·예체능의 어느 세부 학과에도 넓게 든다', () => {
    expect(fineOf(u('ewha:그 밖의 모집단위'))).toEqual([])
    for (const m of ['soc-psych', 'soc-business', 'hum-history', 'arts-design']) expect(ids(m), m).toContain('ewha:그 밖의 모집단위')
    expect(ids('edu-korean')).not.toContain('ewha:그 밖의 모집단위')
  })

  it('이대 의약 묶음: 화학·생명과학 둘 다 + 진로선택 4과목 중 2', () => {
    const med = u('ewha:의예과').clauses
    expect(med).toHaveLength(3)
    expect(med[1]).toMatchObject({ pick: 'all', subjects: ['화학', '생명과학'] })
    expect(med[2]).toMatchObject({ pick: 2 })
    expect(med[2].subjects).not.toContain('역학과 에너지')
  })
})

describe('언어 이름이 겹치는 학과', () => {
  const unit = (name: string, majors: string[]) => ({ id: `t:${name}`, univ: 't', name, majors, clauses: [] })

  it('중국어교육과는 국어교육이 아니고, 독일어 학과는 일본어가 아니다', () => {
    expect(fineOf(u('knue:중국어교육과'))).not.toContain('edu-korean')
    expect(fineOf(u('knue:중국어교육과'))).toContain('edu-chinese')
    expect(fineOf(u('knue:국어교육과'))).toContain('edu-korean')
    const german = fineOf(unit('독일어교육과', ['edu', 'humanities']))
    expect(german).toContain('edu-german')
    expect(german).not.toContain('edu-japanese')
    expect(german).not.toContain('hum-japanese')
    expect(fineOf(unit('일어교육과', ['edu', 'humanities']))).toContain('edu-japanese')
    expect(fineOf(unit('일어일문학과', ['humanities']))).toContain('hum-japanese')
  })
})

describe('"(… 제외)"라고 적은 넓은 모집단위', () => {
  const ids = (major: string) => unitsOf(major).map((x) => x.id)
  const social = 'cnu:사회과학대학(사회학과, 심리학과, 사회복지학과, 행정학부 제외)'
  const science = 'cnu:자연과학대학(수학과, 정보통계학과, 물리학과, 천문우주과학과 제외 모집단위)'

  it('괄호 속 학과 이름으로 세부 학과를 정하지 않는다', () => {
    expect(fineOf(u(social))).toEqual([])
    expect(fineOf(u(science))).not.toContain('earth-astro')
  })

  it('뺀다고 적은 학과에는 넓게도 들지 않고, 나머지 세부 학과에는 넓게 든다', () => {
    expect(ids('soc-psych')).not.toContain(social)
    expect(ids('soc-welfare')).not.toContain(social)
    expect(ids('soc-media')).toContain(social)
    expect(ids('earth-astro')).not.toContain(science)
    expect(ids('earth-geo')).toContain(science)
    // 이름에 세부 학과가 드러나면 괄호와 상관없이 든다
    expect(fineOf(u('cnu:농생명융합학부(농업경제학과 진로희망자 제외)'))).toContain('bio-agri')
    expect(ids('bio-agri')).toContain('cnu:농생명융합학부(농업경제학과 진로희망자 제외)')
  })
})

describe('사범 계열의 넓은 모집단위', () => {
  const ids = (major: string) => unitsOf(major).map((x) => x.id)

  it('자연계열 사범 단위의 수학·과학 조건은 국어교육으로 새지 않는다', () => {
    expect(ids('edu-korean')).not.toContain('dankook:사범대학(자연계열)')
    expect(ids('edu-korean')).not.toContain('hanyang:자연 전 모집단위')
    expect(ids('edu-korean')).toContain('dankook:사범대학(인문계열)')
    expect(ids('edu-math')).toEqual(expect.arrayContaining(['dankook:사범대학(자연계열)', 'hanyang:자연 전 모집단위']))
    expect(ids('edu-math')).not.toContain('dankook:사범대학(인문계열)')
  })

  it('과목 계열 없이 적힌 사범대학 전체는 모든 교육 세부 학과에 든다', () => {
    for (const m of ['edu-korean', 'edu-math', 'edu-pe', 'edu-elem']) expect(ids(m), m).toContain('knu:사범대학 전 모집단위')
  })

  it('순천대 농업교육과는 농업교육에만 들고, 특화분야 공학분야는 공학 세부 학과에 넓게 든다', () => {
    expect(fineOf(u('scnu:농업교육과'))).toContain('edu-agri')
    expect(ids('edu-korean')).not.toContain('scnu:농업교육과')
    expect(ids('mech-aero')).toContain('scnu:공학분야')
    expect(u('scnu:공학분야').clauses[0].subjects).toEqual(['물리학', '미적분Ⅰ', '미적분Ⅱ'])
    expect(u('scnu:예체능분야').clauses).toEqual([])
  })
})

describe('자료집과 대학 원문이 다를 때는 원문을 따른다', () => {
  it('서울대: 학부대학(자유전공학부)은 유형 ③, 간호대학은 유형 ①·② 모두', () => {
    expect(u('snu:자유전공학부').clauses).toEqual([])
    const nursing = u('snu:간호대학').clauses
    expect(nursing.some((c) => c.subjects.includes('area:제2외국어'))).toBe(true)
    expect(nursing.some((c) => c.pick === 3)).toBe(true)
  })
})

describe('권장과목을 두지 않는 대학 (대교협 자료집 4쪽, 대학이 올린 반영 과목 파일)', () => {
  const ids = (major: string) => unitsOf(major).map((x) => x.id)

  it('학과마다 "권장과목 없음" 단위로 들어가고, 단과대학 단위 모집은 병기된 전공으로 찾힌다', () => {
    expect(u('hansung:컴퓨터공학부' as string)).toBeUndefined()
    expect(ids('cs-computer').some((id) => id.startsWith('hansung:IT공과대학'))).toBe(true)
    expect(ids('soc-law').some((id) => id.startsWith('suwon:인문사회융합대학'))).toBe(true)
    expect(UNITS.filter((x) => x.univ === 'sahmyook').every((x) => x.clauses.length === 0)).toBe(true)
  })

  it('원문에 권장과목이 있는 곳은 조건으로 넣었다 (건양대 의학과, 감리교신학대)', () => {
    const med = UNITS.find((x) => x.univ === 'konyang' && x.name.startsWith('의학과'))!
    expect(med.clauses.find((c) => c.pick === 2)?.subjects).toEqual(['물질과 에너지', '화학 반응의 세계', '세포와 물질대사', '생물의 유전'])
    expect(UNITS.filter((x) => x.univ === 'konyang' && x.clauses.length).length).toBe(1)
    expect(u('mtu:신학부').clauses.flatMap((c) => c.subjects)).toContain('사회와 문화')
  })
})
