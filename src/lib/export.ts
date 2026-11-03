import { jointLinksFor } from '../data/joint'
import { TERMS } from '../data/schema'
import { UNIV_BY_ID } from '../data/universities'
import { sidoOf, STATUS_LABEL, TYPE_LABEL } from '../engine/admissions'
import { JEONGSI_LIMIT, type PickSummary, SUSI_LIMIT } from '../engine/picks'
import type { Plan } from '../engine/plan'
import { TERM_LABEL } from './format'

/** 수강 신청서에 옮겨 적기 좋은 글: 학기마다 선택 칸과 고를 과목 */
export function planText(plan: Plan, opts: { units: string[]; url: string; today?: Date }): string {
  const s = plan.school
  const lines: string[] = []
  lines.push(`${s.name} · ${s.cohort}학년도 입학${s.track ? ` · ${s.track}` : ''}`)
  lines.push(`선택과목 계획 (과목내비, ${(opts.today ?? new Date()).toLocaleDateString('ko-KR')})`)
  for (const term of TERMS) {
    const groups = plan.groups.filter((g) => g.term === term)
    const tracks = plan.tracks.filter((t) => t.track.sets.some((set) => set.items.some((it) => it.term === term)))
    if (!groups.length && !tracks.length) continue
    lines.push('', `[${TERM_LABEL[term]}]`)
    for (const g of groups) {
      const picks = [...g.chosen, ...(g.free ? [`원하는 과목 ${g.free}개`] : [])]
      lines.push(`- ${g.group.label} (${g.group.pick}과목 선택): ${picks.join(', ')}`)
    }
    for (const t of tracks) {
      const set = t.setIndex === null ? null : t.track.sets[t.setIndex]
      const here = set?.items.filter((it) => it.term === term).map((it) => it.subject) ?? []
      lines.push(`- ${t.track.label}: ${here.length ? here.join(', ') : '원하는 세트'}`)
    }
  }
  if (plan.pinned.size) lines.push('', `꼭 듣기: ${[...plan.pinned].join(', ')}`)
  if (plan.notOffered.length) {
    lines.push(`학교에 없어 공동교육과정·온라인학교로 알아볼 과목: ${plan.notOffered.join(', ')}`)
    for (const l of jointLinksFor(sidoOf(s.region))) lines.push(`- ${l.name}: ${l.url}`)
  }
  if (opts.units.length) lines.push('', `목표 학과: ${opts.units.slice(0, 12).join(', ')}${opts.units.length > 12 ? ` 외 ${opts.units.length - 12}곳` : ''}`)
  lines.push('', opts.url)
  return lines.join('\n')
}

/** 원서 후보 목록 글: 모집 시기마다 대학·전형·방법·수능 최저 */
export function picksText(s: PickSummary, today = new Date()): string {
  const lines = [`원서 후보 (과목내비, ${today.toLocaleDateString('ko-KR')})`]
  for (const period of ['수시', '정시', '기타'] as const) {
    const list = s.items.filter((it) => it.track.period === period)
    if (!list.length) continue
    const limit = period === '수시' ? `/${SUSI_LIMIT}` : period === '정시' ? `/${JEONGSI_LIMIT}` : ''
    lines.push('', `[${period} ${list.length}${limit}]`)
    list.forEach((it, i) => {
      const t = it.track
      const status = it.result.status === 'ok' ? '' : ` (${STATUS_LABEL[it.result.status]})`
      lines.push(`${i + 1}. ${UNIV_BY_ID.get(it.plan.univ)?.name ?? it.plan.univ} ${t.name}${status}`)
      lines.push(`   ${TYPE_LABEL[t.type]} · ${t.method}${t.min ? ` · 수능 최저: ${t.min}` : ''}`)
    })
  }
  return lines.join('\n')
}
