import { ADIGA_UNIVERSITIES } from './adiga'
import type { Source, University } from './schema'

const CHECKED = '2026-10-19'

const SKKU_SOURCE: Source = {
  title: '성균관대 「2028학년도 학생부종합전형 서류평가 개요」 (대입정보포털 대학정보에 대학이 올린 파일)',
  url: 'https://www.adiga.kr/cmm/com/file/fileDown.do?fileId=00000000000000241623&fileSn=1&menuId=PCUVTINF2000&downLogYn=Y&unvCd=0000133&searchSyr=2026',
  date: '2025-08',
}

const SOGANG_SOURCE: Source = {
  title: '서강대 입학처 공지 「2028학년도 서강대학교 모집단위별 반영과목 안내」',
  url: 'https://admission.sogang.ac.kr/common/download.File.asp?strRealFileName=/upload/BBS0004/20250829174558ACVDB8.PDF&strFileName=2028%ED%95%99%EB%85%84%EB%8F%84+%EC%84%9C%EA%B0%95%EB%8C%80%ED%95%99%EA%B5%90+%EB%AA%A8%EC%A7%91%EB%8B%A8%EC%9C%84%EB%B3%84+%EB%B0%98%EC%98%81%EA%B3%BC%EB%AA%A9%5F250829%2Epdf',
  date: '2025-08-29',
}

/** 대교협 자료집에 없거나, 입학처 원문을 따로 옮긴 대학 */
const CURATED: University[] = [
  {
    id: 'yonsei',
    name: '연세대학교',
    short: '연세대',
    region: '서울',
    coverage: 'official',
    sources: [
      {
        title: '연세대 입학처 「2028학년도 연세대학교 전공연계과목 선택 가이드라인」',
        url: 'https://www2.yonsei.ac.kr/entrance/plan/2028_guide.pdf',
        date: '2026-04',
      },
    ],
    checked: CHECKED,
    policy:
      '특정 과목 이수 여부만 보지 않고 교과영역을 얼마나 충실히 이수했는지 종합해서 평가해요. 학교에 개설되지 않아 못 들은 경우는 구분해서 평가하고, 공동교육과정 참여 같은 노력은 긍정적으로 볼 수 있다고 밝혔어요.',
  },
  {
    id: 'cau',
    name: '중앙대학교',
    short: '중앙대',
    region: '서울',
    coverage: 'official',
    sources: [
      {
        title: '중앙대 입학처 「2028학년도 대입전형 학문단위별 이수 권장과목 안내(자연 계열)」',
        url: 'https://admission.cau.ac.kr/files/2026/CAU_2028_subjects.pdf',
        date: '2025-09',
      },
    ],
    checked: CHECKED,
    policy: '학습 단계가 분명한 자연계열 학문단위에만 최소한으로 제시하고, 인문계열은 제시하지 않아요. 바뀌면 입학처 홈페이지에 따로 안내한다고 밝혔어요.',
  },
  {
    id: 'skku',
    name: '성균관대학교',
    short: '성균관대',
    region: '서울',
    coverage: 'official',
    sources: [SKKU_SOURCE],
    checked: '2026-10-21',
    policy:
      '모든 모집단위에 이수 권장과목이나 연계과목을 두지 않는다고 밝혔어요. 학생부종합전형 서류는 학업역량, 자기주도적 학업태도, 관심 분야에 대한 열의, 발전 가능성을 종합해서 평가해요.',
  },
  {
    id: 'sogang',
    name: '서강대학교',
    short: '서강대',
    region: '서울',
    coverage: 'official',
    sources: [SOGANG_SOURCE],
    checked: '2026-10-21',
    policy:
      '모집단위별 권장 이수과목을 지정하지 않는다고 밝혔어요. 스스로 정한 진로에 필요하다고 생각한 과목과 도전적인 과목을 이수한 과정을 성장 가능성으로 평가하고, 목표가 지원한 학과와 달라도 불이익은 없다고 해요.',
  },
]

export const UNIVERSITIES: University[] = [...CURATED, ...ADIGA_UNIVERSITIES].sort((a, b) => a.name.localeCompare(b.name, 'ko'))

export const UNIV_BY_ID = new Map(UNIVERSITIES.map((u) => [u.id, u]))

/** 넣은 범위 */
export const EXCLUDED_NOTE =
  '대교협 자료집에 표가 없는 대학은 넣지 않았어요. 연세대·중앙대는 입학처 원문을 옮겼고, 성균관대·서강대는 학과별 권장과목을 두지 않는다는 대학 공식 안내를 넣었어요.'
