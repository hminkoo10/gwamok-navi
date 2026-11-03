import type { Clause, Coverage, School, TermId } from '../data/schema'
import { SCHOOL_BY_ID } from '../data/schools'
import { UNIV_BY_ID } from '../data/universities'
import { UNIT_BY_ID } from '../data/units'
import { type Plan, resolveSubjects, type TrackPlan } from '../engine/plan'

/** 지역 묶음 (대학 고르기·대학 목록 필터) */
export const REGIONS: [string, string[]][] = [
  ['서울', ['서울']],
  ['경기·인천', ['경기', '인천']],
  ['강원', ['강원']],
  ['충청', ['대전', '세종', '충북', '충남']],
  ['전라', ['광주', '전북', '전남']],
  ['경상', ['부산', '대구', '울산', '경북', '경남']],
  ['제주', ['제주']],
]

/** 끝 글자 받침에 맞춘 조사: josa('과목', '을', '를') → '을'. 숫자·로마 숫자는 읽는 소리로 (1·3·6·7·8·0은 받침, 미적분Ⅱ를) */
export function josa(word: string, withBatchim: string, without: string): string {
  const last = word.trim().slice(-1)
  if (/\d/.test(last)) return '013678'.includes(last) ? withBatchim : without
  if (/[Ⅰ-Ⅹ]/.test(last)) return 'ⅠⅢⅥⅦⅧⅩ'.includes(last) ? withBatchim : without
  const code = last.charCodeAt(0) - 0xac00
  return code >= 0 && code <= 11171 && code % 28 ? withBatchim : without
}

/** 지금 고1의 입학년도 (3월에 학년이 바뀐다) */
export const thisCohort = () => {
  const now = new Date()
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1
}

/** 편제표 출처 한 줄. 불러온 편제표를 고치면 shared가 빠져 '고친 편제표'가 된다 */
export function schoolOrigin(s: School): string {
  if (SCHOOL_BY_ID.has(s.id)) return '예시 편제표 · 학교 홈페이지 원문을 옮김'
  if (s.id.startsWith('neis-'))
    return s.shared ? `${s.shared.verified ? '확인된' : '자동으로 읽은'} 편제표 · ${s.shared.at.slice(0, 10)}` : '자동으로 읽어 고친 편제표'
  if (s.id.startsWith('shared-')) return '공유받은 편제표'
  return '직접 넣은 편제표'
}

/** 권장과목 말고 세트를 고른 까닭: 꼭 듣기 과목이 든 세트, 다른 세트를 모두 빼서 남은 세트. 그 밖엔 빈 문자열 */
export function setWhyText(plan: Plan, tp: TrackPlan): string {
  if (tp.setIndex === null) return ''
  if (tp.track.sets[tp.setIndex].items.some((it) => plan.pinned.has(it.subject))) return '꼭 듣기로 고른 세트'
  const others = tp.track.sets.filter((_, i) => i !== tp.setIndex)
  return others.length && others.every((set) => set.items.some((it) => plan.excluded.has(it.subject))) ? '다른 세트를 빼서 남은 세트' : ''
}

export const TERM_LABEL: Record<TermId, string> = {
  '1-1': '1학년 1학기',
  '1-2': '1학년 2학기',
  '2-1': '2학년 1학기',
  '2-2': '2학년 2학기',
  '3-1': '3학년 1학기',
  '3-2': '3학년 2학기',
}

export const COVERAGE_LABEL: Record<Coverage, string> = {
  official: '공식 자료',
  secondary: '2차 자료',
  summary: '언론 요약',
}

const TOKEN_LABEL: Record<string, (x: string) => string> = {
  area: (x) => `${x} 교과`,
  career: (x) => `${x} 진로선택`,
  general: (x) => `${x} 일반선택`,
  family: (x) => `${x} 계열`,
}

/** 묶음 표기(area:·career:·general:·family:)를 읽기 좋은 말로. 과목 이름은 그대로 */
export function subjectLabel(s: string): string {
  const m = s.match(/^(area|career|general|family):(.+)$/)
  return m ? TOKEN_LABEL[m[1]](m[2]) : s
}

export function clauseText(c: Clause): string {
  if (c.text) return c.text
  const subjects = c.subjects.map(subjectLabel).join(', ')
  return c.pick === 'all' ? subjects : `${subjects} 중 ${c.pick}과목 이상`
}

export function clauseSubjects(c: Clause): string[] {
  return resolveSubjects(c.subjects)
}

/** 목표 전형 때문에 더한 조건의 이름 (수능 출제 과목, 대학 논술 범위) */
function examLabel(id: string): string | null {
  if (id === 'exam:suneung') return '2028 수능'
  if (id.startsWith('exam:essay:')) return `${UNIV_BY_ID.get(id.slice('exam:essay:'.length))?.short ?? ''} 논술`
  return null
}

/** 모집단위 id 목록 → 대학 약칭 목록 (중복 제거, 대학 순서 유지) */
export function univShorts(unitIds: string[]): string[] {
  const seen: string[] = []
  for (const id of unitIds) {
    const unit = UNIT_BY_ID.get(id)
    const short = examLabel(id) ?? (unit ? UNIV_BY_ID.get(unit.univ)?.short : undefined)
    if (short && !seen.includes(short)) seen.push(short)
  }
  return seen
}

export function unitLabel(id: string): string {
  const exam = examLabel(id)
  if (exam) return exam
  const unit = UNIT_BY_ID.get(id)
  if (!unit) return id
  return `${UNIV_BY_ID.get(unit.univ)?.short ?? ''} ${unit.name}`
}

const DATE = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' })
const DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** ISO 시각 → '2026. 10. 19. 20:22' (withTime이 false면 '2026년 10월 19일') */
export function dateTime(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return (withTime ? DATE_TIME : DATE).format(d)
}
