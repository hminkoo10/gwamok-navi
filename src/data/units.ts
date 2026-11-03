import { ADIGA_UNITS } from './adiga'
import type { Clause, Unit } from './schema'

// 모집단위별 권장과목. 출처는 universities.ts. 원문 표기와 다르게 해석한 곳은 note에 적었다.

const PHYS = ['역학과 에너지', '전자기와 양자']
const CHEM = ['물질과 에너지', '화학 반응의 세계']
const BIO = ['세포와 물질대사', '생물의 유전']
const EARTH = ['지구시스템과학', '행성우주과학']
const SCI_CAREER = [...PHYS, ...CHEM, ...BIO, ...EARTH]

const all = (...subjects: string[]): Clause => ({ pick: 'all', subjects })
const pick = (n: number, subjects: string[], text?: string): Clause => (text ? { pick: n, subjects, text } : { pick: n, subjects })

const unit = (univ: string, name: string, majors: string[], clauses: Clause[], note?: string): Unit =>
  note ? { id: `${univ}:${name}`, univ, name, majors, clauses, note } : { id: `${univ}:${name}`, univ, name, majors, clauses }

// ---------------------------------------------------------------------------
// 중앙대 (원문 표, 2025-09)
// 표의 "화학, 물리학 또는 화학, 생명과학"은 화학 + (물리학 또는 생명과학)으로 옮겼다.
const CAU_MATH = all('미적분Ⅱ', '기하')
const cau = (name: string, majors: string[], clauses: Clause[], note?: string) => unit('cau', name, majors, clauses, note)

const CAU: Unit[] = [
  ...[
    ['기계공학부', ['mech']],
    ['물리학과', ['physics']],
    ['사회기반시스템공학부(건설환경플랜트공학)', ['arch']],
    ['전자전기공학부', ['ee']],
    ['지능형반도체공학과', ['ee']],
  ].map(([n, m]) => cau(n as string, m as string[], [CAU_MATH, all('물리학', '화학'), all(...PHYS)])),
  ...[
    ['에너지시스템공학부', ['chemeng']],
    ['첨단소재공학과', ['chemeng']],
    ['화학공학과', ['chemeng']],
  ].map(([n, m]) => cau(n as string, m as string[], [CAU_MATH, all('화학', '물리학'), all(...CHEM)])),
  cau('융합공학부', ['chemeng', 'bio'], [CAU_MATH, all('화학'), pick(1, ['물리학', '생명과학'], '화학, 물리학 또는 화학, 생명과학'), all(...CHEM)]),
  ...[
    ['건축학부', ['arch']],
    ['사회기반시스템공학부(도시시스템공학)', ['arch']],
    ['소프트웨어학부', ['cs']],
  ].map(([n, m]) => cau(n as string, m as string[], [CAU_MATH, all('물리학'), all(...PHYS)])),
  ...[
    ['AI학과', ['ai']],
    ['산업보안학과(자연)', ['security']],
    ['수학과', ['math']],
    ['예술공학부', ['artTech']],
  ].map(([n, m]) => cau(n as string, m as string[], [CAU_MATH])),
  ...[
    ['약학부', ['pharm']],
    ['의학부', ['med']],
  ].map(([n, m]) =>
    cau(n as string, m as string[], [
      CAU_MATH,
      all('생명과학', '화학'),
      pick(3, [...CHEM, ...BIO], '물질과 에너지, 화학 반응의 세계, 세포와 물질대사, 생물의 유전 中 3과목 이상'),
    ]),
  ),
  cau('생명과학과', ['bio'], [all('미적분Ⅱ'), all('생명과학', '화학'), pick(2, [...CHEM, ...BIO], '4과목 中 2과목 이상')]),
  cau(
    '화학과',
    ['chem'],
    [all('미적분Ⅱ'), all('화학'), pick(1, ['물리학', '생명과학'], '화학, 물리학 또는 화학, 생명과학'), pick(2, [...CHEM, ...BIO], '4과목 中 2과목 이상')],
  ),
  ...[
    ['시스템생명공학과', ['bio']],
    ['식품공학부(식품공학, 식품영양)', ['bio']],
  ].map(([n, m]) =>
    cau(n as string, m as string[], [
      pick(1, ['미적분Ⅱ', '기하'], '미적분Ⅱ 또는 기하'),
      all('생명과학', '화학'),
      pick(2, [...CHEM, ...BIO], '4과목 中 2과목 이상'),
    ]),
  ),
  cau('간호학과', ['nursing'], [all('미적분Ⅱ'), all('생명과학'), all(...BIO)]),
  cau('생명자원공학부(동물생명공학, 식물생명공학)', ['bio'], [all('미적분Ⅱ'), all('생명과학', '화학'), all(...BIO)]),
  cau('인문계열 학문단위', ['humanities', 'social'], [], '인문계열은 이수 권장과목을 따로 제시하지 않는다.'),
]

// ---------------------------------------------------------------------------
// 연세대 (원문 표, 2026-04)
// 자연·의치약 전 모집단위: 기하·미적분Ⅱ + 과학 진로선택 3과목 이상(일반선택 위계 고려).
// "자율선택"은 물리학·화학·생명과학·지구과학 중 자유롭게 고르라는 뜻이라 조건을 두지 않았다.
const YONSEI_BASE = [all('기하', '미적분Ⅱ'), pick(3, SCI_CAREER, '과학 진로선택 3과목 이상')]
const yonsei = (name: string, majors: string[], general?: Clause) =>
  unit('yonsei', name, majors, general ? [YONSEI_BASE[0], general, YONSEI_BASE[1]] : YONSEI_BASE, general ? undefined : '과학 일반선택: 자율선택')

const YONSEI: Unit[] = [
  yonsei('수학과', ['math']),
  yonsei('물리학과', ['physics'], all('물리학')),
  yonsei('화학과', ['chem'], all('화학')),
  yonsei('지구시스템과학과', ['earth'], all('지구과학')),
  yonsei('천문우주학과', ['earth'], all('지구과학')),
  yonsei('대기과학과', ['earth'], all('지구과학')),
  yonsei('화공생명공학부', ['chemeng'], all('화학')),
  yonsei('전기전자공학부', ['ee'], all('물리학')),
  yonsei('건축공학과', ['arch']),
  yonsei('도시공학과', ['arch']),
  yonsei('사회환경시스템공학부', ['arch']),
  yonsei('기계공학부', ['mech'], all('물리학')),
  yonsei('신소재공학부', ['chemeng'], all('화학')),
  yonsei('산업공학과', ['ie']),
  yonsei('시스템반도체공학과', ['ee'], all('물리학')),
  yonsei('디스플레이융합공학과', ['ee'], all('물리학')),
  yonsei('생명과학부', ['bio'], all('생명과학')),
  yonsei('시스템생물학과', ['bio'], all('생명과학')),
  yonsei('생화학과', ['bio'], all('생명과학')),
  yonsei('생명공학과', ['bio'], all('생명과학')),
  yonsei('컴퓨터과학과', ['cs', 'security']),
  yonsei('인공지능학과', ['ai']),
  yonsei('인공지능시스템학과', ['ai']),
  yonsei('IT융합공학전공', ['cs']),
  yonsei('지능형반도체전공', ['ee']),
  yonsei('모빌리티시스템전공', ['mech']),
  yonsei('언더우드학부(생명과학공학)', ['bio']),
  yonsei('융합과학공학부(ISE)', ['free']),
  yonsei('진리자유학부(자연)', ['free']),
  yonsei('의예과', ['med'], all('생명과학')),
  yonsei('치의예과', ['med'], pick(1, ['물리학', '화학', '생명과학'], '물리학, 화학, 생명과학 中 택1')),
  yonsei('약학과', ['pharm'], pick(1, ['생명과학', '화학'], '생명과학 또는 화학')),
  yonsei('첨단약과학과', ['pharm'], pick(1, ['생명과학', '화학'], '생명과학 또는 화학')),
  unit('yonsei', '간호대학 전 모집단위', ['nursing'], [], '연세대는 간호대학을 인문·통합 계열로 묶어 전공연계과목을 제시하지 않았다.'),
  unit('yonsei', '인문·통합 계열 전 모집단위', ['humanities', 'social'], [], '전공연계과목 미제시(진로와 적성에 따라 선택).'),
]

// ---------------------------------------------------------------------------
// 성균관대·서강대: 모집단위별 권장과목을 두지 않는다고 대학이 공식 안내했다 (출처는 universities.ts).
// 단위 이름은 학과별 인원표(units/skku.json, units/sogang.json)의 열쇠라 바꾸지 않는다.
const SCIENCE_MAJORS = ['cs', 'ai', 'security', 'ee', 'mech', 'chemeng', 'arch', 'ie', 'math', 'physics', 'chem', 'bio', 'free']

const OTHERS: Unit[] = [
  unit('skku', '자연계열 전 모집단위', [...SCIENCE_MAJORS, 'med', 'pharm'], [], '모집단위별 이수 권장과목·연계과목 없음 (대학 공식 안내).'),
  unit('skku', '인문계열', ['humanities', 'social'], [], '모집단위별 이수 권장과목·연계과목 없음 (대학 공식 안내).'),
  unit(
    'sogang',
    '자연계열 전 모집단위',
    ['cs', 'ai', 'ee', 'mech', 'chemeng', 'math', 'physics', 'chem', 'bio'],
    [],
    '모집단위별 권장 이수과목 지정 안 함 (대학 공식 안내).',
  ),
  unit('sogang', '인문계열', ['humanities', 'social'], [], '모집단위별 권장 이수과목 지정 안 함 (대학 공식 안내).'),
]

export const UNITS: Unit[] = [...ADIGA_UNITS, ...YONSEI, ...CAU, ...OTHERS]

export const UNIT_BY_ID = new Map(UNITS.map((u) => [u.id, u]))

/** 대학마다 옮긴 학과 수 (0이면 그 대학은 2028학년도 학과별 권장과목 자료가 없다) */
export const UNIT_COUNT = UNITS.reduce((m, u) => m.set(u.univ, (m.get(u.univ) ?? 0) + 1), new Map<string, number>())
