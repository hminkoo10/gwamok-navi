import type { AdmissionPlan, AdmissionTrack, AdmissionType, RecordRule, SchoolType, SpecialCode, SuneungRule } from '../data/schema'
import { SCHOOL_TYPES } from '../data/schema'

// 전형 지원 자격 판단: 대학이 시행계획에 적은 조건(졸업 여부, 고교 유형, 지역, 특별 자격, 학교장 추천)을
// 학생의 학교와 '내 조건'에 맞춰 본다. 자격 서류로 확인하는 것은 '확인 필요'로 남긴다.

export interface Profile {
  /** 재학생(졸업예정자) 또는 졸업생 */
  status: '재학생' | '졸업생'
  /** 고교 유형. 비우면 학교 정보로 정한다 */
  schoolType: SchoolType | ''
  /** 고교 소재 시도. 비우면 학교 정보로 정한다 */
  region: string
  /** 해당하는 특별 자격 */
  special: SpecialCode[]
  /** 관심 있는 전형 유형 (비우면 모두) */
  types: AdmissionType[]
}

export const EMPTY_PROFILE: Profile = { status: '재학생', schoolType: '', region: '', special: [], types: [] }

export const SIDO = [
  '서울',
  '부산',
  '대구',
  '인천',
  '광주',
  '대전',
  '울산',
  '세종',
  '경기',
  '강원',
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
] as const

const LONG_SIDO: [RegExp, string][] = [
  [/^충청북/, '충북'],
  [/^충청남/, '충남'],
  [/^전라북|^전북/, '전북'],
  [/^전라남/, '전남'],
  [/^경상북/, '경북'],
  [/^경상남/, '경남'],
]

/**
 * 광주와 전남이 합친 전남광주통합특별시. 나이스는 '전남광주통합특별시교육청(광주)'처럼 옛 시도를 괄호로 적는다.
 * 주소만 있으면 옛 광주의 자치구(…구)와 전남의 시·군으로 가른다. 가를 수 없으면 빈 문자열 (지역인재 전형이 광주·전남을 따로 보기도 한다)
 */
function gwangjuJeonnam(t: string): string | null {
  if (!t.startsWith('전남광주')) return null
  const old = /\((광주|전남)\)/.exec(t)
  if (old) return old[1]
  const place = t.replace(/^전남광주(통합특별시)?(교육청)?\s*/, '')
  if (/^\S+구(\s|$)/.test(place)) return '광주'
  if (/^\S+[시군](\s|$)/.test(place)) return '전남'
  return ''
}

/** '경기 화성', '서울특별시', '충청북도' → 시도 이름 (모르면 빈 문자열) */
export function sidoOf(text: string | undefined): string {
  const t = (text ?? '').trim()
  if (!t) return ''
  const merged = gwangjuJeonnam(t)
  if (merged !== null) return merged
  for (const [re, name] of LONG_SIDO) if (re.test(t)) return name
  return SIDO.find((s) => t.startsWith(s)) ?? ''
}

export const SPECIAL_LABEL: Record<SpecialCode, string> = {
  rural: '농어촌 학생',
  equity: '기초생활수급자·차상위·한부모 가정',
  vocational: '특성화고 등 졸업(예정)자',
  worker: '특성화고 등 졸업 후 재직자',
  disabled: '장애인 등 대상자',
  veteran: '국가보훈 대상자',
  nk: '북한이탈주민',
  overseas: '재외국민·외국인',
  multicultural: '다문화 가정',
  island: '서해5도 학생',
  athlete: '체육 특기자',
  artist: '예술 실기 특기자',
  military: '군 위탁·계약학과',
  adult: '성인학습자·만학도',
  other: '정해진 대상',
}

/** '내 조건'에서 고를 수 있는 특별 자격 (특성화고 자격은 학교 유형으로 정해진다) */
export const PROFILE_SPECIALS: { code: SpecialCode; label: string; help: string }[] = [
  { code: 'rural', label: '농어촌 학생', help: '읍·면 지역에서 중·고교를 다니고 부모와 함께 살았거나(6년), 본인이 초·중·고 12년을 다닌 경우' },
  { code: 'equity', label: '기초생활수급자·차상위·한부모 가정', help: '국민기초생활 수급권자, 차상위계층, 한부모가족 지원 대상' },
  { code: 'disabled', label: '장애인 등 대상자', help: '장애인복지법상 장애인, 특수교육 대상자 등' },
  { code: 'veteran', label: '국가보훈 대상자', help: '국가유공자 본인·자녀 등 보훈 대상' },
  { code: 'island', label: '서해5도 학생', help: '서해5도(백령·대청·소청·연평·우도) 지역 학생' },
  { code: 'multicultural', label: '다문화 가정', help: '부모 중 한 명 이상이 외국 출신인 경우' },
  { code: 'nk', label: '북한이탈주민', help: '북한이탈주민 본인 또는 자녀' },
  { code: 'athlete', label: '체육 특기자', help: '대회 입상 등 경기 실적이 있는 경우' },
  { code: 'artist', label: '예술 실기 특기자', help: '음악·미술·무용·연기 등 실기·실적으로 지원' },
  { code: 'worker', label: '특성화고 졸업 후 재직자', help: '특성화고 등을 졸업하고 산업체에 3년 이상 다닌 경우' },
  { code: 'adult', label: '성인학습자·만학도', help: '나이·경력 조건이 있는 평생학습자 전형' },
  { code: 'overseas', label: '재외국민·외국인', help: '해외에서 중·고교 과정을 다닌 경우' },
]

export const TYPE_LABEL: Record<AdmissionType, string> = {
  교과: '학생부교과',
  종합: '학생부종합',
  논술: '논술',
  실기: '실기·실적',
  수능: '수능(정시)',
  기타: '기타',
}

/** 전형 유형마다 고교 과목 선택이 얼마나 영향을 주는지 */
export function subjectWeight(t: AdmissionTrack): { level: '높음' | '보통' | '낮음'; text: string } {
  const docs = t.elements.includes('서류')
  if (t.type === '종합') return { level: '높음', text: '서류평가에서 전공 관련 과목 이수와 성취를 살펴요. 권장과목을 들었는지가 중요해요.' }
  if (t.type === '교과')
    return docs
      ? { level: '보통', text: '교과 성적이 중심이고, 서류평가에서 과목 이수도 함께 봐요.' }
      : { level: '낮음', text: '교과 성적이 중심이에요. 반영 교과에 권장과목이 들어가는지 확인하세요.' }
  if (t.type === '수능')
    return t.elements.includes('교과') || docs
      ? { level: '보통', text: '수능이 중심이지만 교과(학생부) 평가도 함께 봐요.' }
      : { level: '낮음', text: '수능 성적이 중심이에요.' }
  if (t.type === '논술') return { level: '낮음', text: '논술 성적이 중심이에요. 수능 최저가 있는지 함께 보세요.' }
  if (t.type === '실기') return { level: '낮음', text: '실기·실적이 중심이에요.' }
  return { level: '보통', text: '대상이 정해진 전형이에요.' }
}

export type Status = 'ok' | 'check' | 'no'

export const STATUS_LABEL: Record<Status, string> = { ok: '지원 가능', check: '확인 필요', no: '지원 불가' }

export interface Eligibility {
  status: Status
  /** 판단 이유 (화면에 그대로 보인다) */
  reasons: string[]
}

export interface Context {
  schoolType: SchoolType | ''
  region: string
  special: Set<SpecialCode>
  status: Profile['status']
}

const isSchoolType = (x: string | undefined): x is SchoolType => !!x && (SCHOOL_TYPES as readonly string[]).includes(x)

/** 학교 정보와 '내 조건'으로 판단에 쓸 값을 정한다 */
export function contextOf(profile: Profile, school: { kind?: string; region: string } | null): Context {
  const kind = school?.kind
  const schoolType = profile.schoolType || (isSchoolType(kind) ? kind : '')
  const region = profile.region || sidoOf(school?.region)
  const special = new Set(profile.special)
  // 특성화고·마이스터고·직업계열 학생은 특성화고 대상 전형 자격이 있다
  if (schoolType === '특성화고' || schoolType === '마이스터고' || schoolType === '직업계열') special.add('vocational')
  return { schoolType, region, special, status: profile.status }
}

const joinTypes = (list: string[]) => (list.length > 4 ? `${list.slice(0, 4).join('·')} 등` : list.join('·'))

export function eligibility(t: AdmissionTrack, ctx: Context): Eligibility {
  let status: Status = 'ok'
  const reasons: string[] = []
  const no = (r: string) => {
    status = 'no'
    reasons.push(r)
  }
  const check = (r: string) => {
    if (status === 'ok') status = 'check'
    reasons.push(r)
  }

  if (t.grads === '예정자' && ctx.status === '졸업생') no('졸업예정자만 지원할 수 있어요')
  if (t.grads === '졸업자' && ctx.status === '재학생') no('고등학교를 졸업한 사람만 지원할 수 있어요')

  if (t.schools.only.length) {
    if (!ctx.schoolType) check(`${joinTypes(t.schools.only)} 학생만 지원할 수 있어요 (내 조건에서 고교 유형을 골라 주세요)`)
    else if (!t.schools.only.includes(ctx.schoolType)) no(`${joinTypes(t.schools.only)} 학생만 지원할 수 있어요`)
  }
  if (ctx.schoolType && t.schools.exclude.includes(ctx.schoolType)) no(`${ctx.schoolType} 학생은 지원할 수 없어요`)

  if (t.regions.length) {
    const where = t.regions.join('·')
    if (!ctx.region) check(`${where} 지역 고교 출신만 지원할 수 있어요 (내 조건에서 지역을 골라 주세요)`)
    else if (!t.regions.includes(ctx.region)) no(`${where} 지역 고교 출신만 지원할 수 있어요`)
    else reasons.push(`${ctx.region} 지역 고교라 지원할 수 있어요`)
  }

  // 특별 자격: 이 중 하나면 된다. 군 계약학과는 자격이 아니라 선발 조건이라 확인만 한다
  const needs = t.special.filter((s) => s !== 'military')
  if (needs.length) {
    const mine = needs.filter((s) => ctx.special.has(s))
    const talent = needs.filter((s) => s === 'athlete' || s === 'artist')
    if (mine.length) check(`${mine.map((s) => SPECIAL_LABEL[s]).join(', ')} 자격을 서류로 확인해요`)
    // '그 밖의 대상'은 화면에서 고를 수 없어 판단하지 않고 확인을 부탁한다
    else if (needs.includes('other')) check(`지원 대상이 정해진 전형이에요. 자격을 확인해 주세요: ${t.who}`)
    else if (talent.length === needs.length) no(`${talent.map((s) => SPECIAL_LABEL[s]).join(', ')} 대상 전형이에요. 해당하면 내 조건에서 골라 주세요`)
    else no(`${needs.map((s) => SPECIAL_LABEL[s]).join(', ')} 대상 전형이에요`)
  }
  if (t.special.includes('military')) check('군 장학생 선발 조건(신체검사·신원조사 등)을 함께 봐요')

  if (t.rec) check(`학교장 추천을 받아야 해요${t.rec.limit ? ` (${t.rec.limit})` : ''}`)
  return { status, reasons }
}

export interface RatedTrack {
  track: AdmissionTrack
  result: Eligibility
}

const ORDER: Record<Status, number> = { ok: 0, check: 1, no: 2 }
const PERIOD_ORDER: Record<string, number> = { 수시: 0, 정시: 1, 기타: 2 }

/** 한 대학의 전형을 판단해 지원 가능한 것부터 */
export function ratePlan(plan: AdmissionPlan, ctx: Context): RatedTrack[] {
  return plan.tracks
    .map((track) => ({ track, result: eligibility(track, ctx) }))
    .sort(
      (a, b) =>
        ORDER[a.result.status] - ORDER[b.result.status] ||
        PERIOD_ORDER[a.track.period] - PERIOD_ORDER[b.track.period] ||
        (b.track.seats ?? 0) - (a.track.seats ?? 0),
    )
}

/** 관심 전형 유형으로 거른다 (비우면 모두) */
export const matchesTypes = (t: AdmissionTrack, types: AdmissionType[]) => !types.length || types.includes(t.type)

export function countByStatus(rated: RatedTrack[]): Record<Status, number> {
  const out: Record<Status, number> = { ok: 0, check: 0, no: 0 }
  for (const r of rated) out[r.result.status]++
  return out
}

/** 내 조건을 한 줄로 */
export function profileSummary(p: Context, status: string, types: AdmissionType[]): string {
  const parts = [status === '졸업생' ? '졸업생' : '재학생', p.schoolType || '고교 유형 모름', p.region || '지역 모름']
  const sp = [...p.special].filter((s) => s !== 'vocational').length
  if (sp) parts.push(`자격 ${sp}개`)
  if (types.length) parts.push(types.map((t) => TYPE_LABEL[t]).join('·'))
  return parts.join(' · ')
}

/** 이 전형에 쓰는 수능·학생부 반영 방법 (전형을 콕 집은 규칙이 있으면 그것만) */
export function rulesFor(plan: AdmissionPlan, t: AdmissionTrack): { suneung: SuneungRule[]; record: RecordRule[] } {
  const pick = <R extends { tracks: string[] }>(rules: R[] | undefined, applies: boolean) => {
    if (!rules?.length || !applies) return []
    const own = rules.filter((r) => r.tracks.includes(t.id))
    return own.length ? own : rules.filter((r) => !r.tracks.length)
  }
  return {
    suneung: pick(plan.suneung, t.elements.includes('수능')),
    record: pick(plan.record, t.elements.includes('교과')),
  }
}
