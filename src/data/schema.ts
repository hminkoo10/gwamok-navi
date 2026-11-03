// 데이터 구조. 대학 권장과목·학교 편제표는 원문을 손으로 옮긴 자료라
// 출처(source)와 확인일(checked)을 늘 함께 둔다.

export type Area = '국어' | '수학' | '영어' | '사회' | '과학' | '정보' | '기술·가정' | '제2외국어' | '한문' | '체육' | '예술' | '교양' | '기타'

export type Kind = '공통' | '일반선택' | '진로선택' | '융합선택' | '기타'

export interface Subject {
  name: string
  area: Area
  kind: Kind
  /** 위계상 먼저 듣는 것이 좋은 과목 */
  after?: string[]
}

/** official = 대학 원문 표, secondary = 블로그 등 2차 정리, summary = 언론 요약 */
export type Coverage = 'official' | 'secondary' | 'summary'

export interface Source {
  title: string
  url: string
  date?: string
}

export interface University {
  id: string
  name: string
  short: string
  /** 시·도 (서울, 경기 …) */
  region: string
  coverage: Coverage
  sources: Source[]
  checked: string
  policy: string
  caveat?: string
}

export type Level = 'core' | 'recommended'

export interface Clause {
  /** 'all' = 전부, 숫자 = 이 중 n과목 이상 */
  pick: 'all' | number
  /** 과목명, 또는 묶음 표기 area:·career:·general:·family: (engine/plan의 resolveSubjects) */
  subjects: string[]
  level?: Level
  /** 원문 표기 */
  text?: string
}

export interface Unit {
  id: string
  univ: string
  name: string
  majors: string[]
  clauses: Clause[]
  note?: string
  /** 자료집 원문 칸 글자: 핵심과목, 권장과목 (merged면 두 칸이 합쳐진 표) */
  core?: string
  rec?: string
  merged?: boolean
  /** 2015 개정 과목명으로 적혀 있어 일부를 조건으로 옮기지 못함 */
  legacy?: boolean
  /** 해석이 애매해 원문을 함께 봐야 하는 곳 */
  check?: boolean
}

export type Field = '공학' | '자연' | '의약' | '융합' | '인문사회' | '교육' | '예체능'

export interface Major {
  id: string
  name: string
  field: Field
  keywords: string[]
}

export type TermId = '1-1' | '1-2' | '2-1' | '2-2' | '3-1' | '3-2'

export const TERMS: TermId[] = ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2']

export interface Fixed {
  subject: string
  credits: number
  /** 집중이수로 학기를 나눠 듣는 짝 과목 (예: 기술·가정 ↔ 정보) */
  alt?: string
}

export interface Group {
  id: string
  label: string
  pick: number
  credits: number
  options: string[]
}

export interface Term {
  id: TermId
  fixed: Fixed[]
  groups: Group[]
}

export interface TrackSet {
  label: string
  items: { term: TermId; subject: string; credits: number }[]
}

/** 두 학기에 걸친 세트 선택 (예: 일본어 → 일본어 회화) */
export interface Track {
  id: string
  label: string
  sets: TrackSet[]
}

export interface School {
  id: string
  name: string
  region: string
  cohort: number
  source: Source
  checked: string
  terms: Term[]
  tracks: Track[]
  notes: string[]
  /** 서버 공유 저장소에서 받은 편제표의 번호와 읽은 날 (틀린 곳 알리기용) */
  shared?: { id: number; at: string; verified?: boolean }
  /** 학과·계열 (특성화고·특목고는 학과마다 편제표가 다르다) */
  track?: string
  /** 나이스 고등학교 구분 (일반고·특성화고·특목고·자율고) */
  kind?: string
}

// ---- 대입 전형 (대학별 「2028학년도 대학입학전형시행계획」) ----

/** 전형 지원 자격에 쓰는 고교 유형 */
export const SCHOOL_TYPES = [
  '일반고',
  '자율고',
  '특성화고',
  '마이스터고',
  '직업계열',
  '과학고',
  '외고',
  '국제고',
  '예술고',
  '체육고',
  '영재학교',
  '방송통신고',
  '평생교육시설',
  '검정고시',
  '대안학교',
  '해외고',
] as const
export type SchoolType = (typeof SCHOOL_TYPES)[number]

/** 특별 자격 (농어촌, 기회균형 등) */
export const SPECIALS = [
  'rural',
  'equity',
  'vocational',
  'worker',
  'disabled',
  'veteran',
  'nk',
  'overseas',
  'multicultural',
  'island',
  'athlete',
  'artist',
  'military',
  'adult',
  'other',
] as const
export type SpecialCode = (typeof SPECIALS)[number]

export const ADMISSION_TYPES = ['교과', '종합', '논술', '실기', '수능', '기타'] as const
export type AdmissionType = (typeof ADMISSION_TYPES)[number]
export type AdmissionElement = '교과' | '서류' | '면접' | '논술' | '실기' | '수능'

export interface AdmissionTrack {
  id: string
  /** 전형명 원문 */
  name: string
  type: AdmissionType
  period: '수시' | '정시' | '기타'
  quota: '정원내' | '정원외'
  seats: number | null
  /** 예정자: 졸업예정자만, 졸업자포함: 졸업자도, 졸업자: 졸업자만 */
  grads: '예정자' | '졸업자포함' | '졸업자' | null
  /** 학교장 추천이 필요한 전형 (limit: 고교별 추천 인원) */
  rec: { required: true; limit: string | null } | null
  schools: { only: SchoolType[]; exclude: SchoolType[] }
  /** 고교 소재지가 조건이면 시도 이름 (지역인재) */
  regions: string[]
  /** 이 중 하나에 해당해야 지원할 수 있다 */
  special: SpecialCode[]
  /** 지원자격 요약 */
  who: string
  /** 전형방법 요약 */
  method: string
  elements: AdmissionElement[]
  /** 수능 최저학력기준 요약 (없으면 null) */
  min: string | null
  /** 교과 이수·권장과목 반영에 관한 원문 언급 */
  subjects: string | null
  note: string | null
  /** 원문 쪽 */
  pages: string
  /** 단계별 선발 (일괄이면 한 단계) */
  stages?: Stage[]
  /** 면접 방식·시간 */
  interview?: string
  /** 논술 출제 범위·방식 */
  essay?: string
  /** 제출 서류 */
  docs?: string
}

export interface Stage {
  /** 1단계, 2단계, 일괄 */
  step: string
  /** 선발 배수 (예: 3배수) */
  pick: string | null
  /** 전형 요소별 반영 비율(%), 합 100 */
  parts: Record<string, number>
}

/** 정시 수능 반영 방법 (모집단위 묶음마다) */
export interface SuneungRule {
  group: string
  units: string | null
  /** 이 방법을 쓰는 전형 id (빈 배열이면 이 대학 정시 수능 전형 모두) */
  tracks: string[]
  /** 활용 지표: 표준점수, 백분위 … */
  use: string
  /** 영역별 반영 비율(%) */
  weights: Record<string, number>
  inquiry: string | null
  english: string | null
  history: string | null
  bonus: string | null
  formula: string | null
  total: number | null
  pages: string
}

/** 학생부 교과 반영 방법 */
export interface RecordRule {
  /** 이 방법을 쓰는 전형 id (빈 배열이면 교과 성적을 쓰는 전형 모두) */
  tracks: string[]
  subjects: string
  terms: string | null
  grades: string | null
  achievement: string | null
  formula: string | null
  extra: string | null
  pages: string
}

export interface AdmissionPlan {
  univ: string
  planTitle: string
  /** 원문 파일 주소 */
  url: string
  /** 원문 안내 게시글. 파일을 바로 열 수 없을 때 (한글 파일, 일회용 링크, 다른 사이트에서 막힌 다운로드) */
  page?: string
  /** 바뀌었는지 살필 주소 (없으면 url) */
  watch?: string
  /** 이 자료를 옮긴 원문 파일의 지문 (sha256 앞 16자리). 서버가 원문을 처음 받을 때 같은 파일인지 본다 */
  fileSha?: string
  /** AI가 옮기고 사람이 아직 확인하지 않았으면 옮긴 날 (YYYY-MM-DD). 화면에 원문 확인 안내가 뜬다 */
  ai?: string
  /** 더 정확한 AI가 원문과 대조해 고치고 확인한 날 (YYYY-MM-DD). 사람이 확인하면 ai와 함께 지운다 */
  aiCheck?: string
  date: string
  totals: Record<string, number> | null
  changes: string[]
  tracks: AdmissionTrack[]
  /** 정시 수능 반영 방법 */
  suneung?: SuneungRule[]
  /** 학생부 교과 반영 방법 */
  record?: RecordRule[]
}
