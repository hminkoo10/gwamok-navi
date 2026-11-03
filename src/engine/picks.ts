import type { AdmissionPlan, AdmissionTrack } from '../data/schema'
import { type Context, type Eligibility, eligibility } from './admissions'

// 원서 후보: 학생이 담아 둔 전형을 모아 지원 횟수와 준비할 것을 본다.
// 수시는 6번, 정시는 가·나·다군에 한 번씩 3번까지 지원할 수 있다 (대교협 대학입학전형기본사항).
// 재외국민처럼 전형 기간이 따로인 전형(기타)은 횟수에 넣지 않는다.

export const SUSI_LIMIT = 6
export const JEONGSI_LIMIT = 3
export const MAX_PICKS = 30

/** 담은 전형의 키: '대학 id:전형 id' */
export const pickKey = (univ: string, track: string) => `${univ}:${track}`
export const isPickKey = (s: string) => /^[a-z0-9-]{1,40}:[a-z0-9-]{1,60}$/.test(s)

const DUP = /중복|복수\s?지원|1개 전형만|1개 전형에만|하나만|한 전형만/

/** 참고 글에서 중복·복수 지원에 관한 문장만 */
export const dupNotes = (note: string | null): string[] =>
  note
    ? note
        .split(/(?<=\.)\s+/)
        .map((s) => s.replace(/\.$/, '').trim())
        .filter((s) => DUP.test(s))
    : []

export interface PickItem {
  key: string
  plan: AdmissionPlan
  track: AdmissionTrack
  result: Eligibility
}

export interface PickSummary {
  items: PickItem[]
  /** 자료에서 찾을 수 없는 키 (대학이 전형을 바꿨거나 자료를 고친 경우) */
  missing: string[]
  count: Record<AdmissionTrack['period'], number>
  /** 같은 대학에 수시 전형을 둘 이상 담은 경우와, 그 전형들의 중복 지원 관련 참고 */
  sameUniv: { univ: string; names: string[]; notes: string[] }[]
  /** 준비할 것: 수능 최저·면접·논술·실기가 있는 전형 수 */
  needs: { min: number; interview: number; essay: number; practical: number }
  /** 지금 조건으로는 지원할 수 없는 전형 수 */
  blocked: number
}

export function summarizePicks(keys: string[], byUniv: Map<string, AdmissionPlan>, ctx: Context): PickSummary {
  const items: PickItem[] = []
  const missing: string[] = []
  for (const key of keys) {
    const [univ, id] = key.split(':')
    const plan = byUniv.get(univ)
    const track = plan?.tracks.find((t) => t.id === id)
    if (plan && track) items.push({ key, plan, track, result: eligibility(track, ctx) })
    else missing.push(key)
  }

  const count = { 수시: 0, 정시: 0, 기타: 0 }
  for (const it of items) count[it.track.period]++

  const byUnivSusi = new Map<string, PickItem[]>()
  for (const it of items) if (it.track.period === '수시') byUnivSusi.set(it.plan.univ, [...(byUnivSusi.get(it.plan.univ) ?? []), it])
  const sameUniv = [...byUnivSusi]
    .filter(([, list]) => list.length > 1)
    .map(([univ, list]) => ({
      univ,
      names: list.map((it) => it.track.name),
      notes: [...new Set(list.flatMap((it) => dupNotes(it.track.note)))],
    }))

  const has = (it: PickItem, e: AdmissionTrack['elements'][number]) => it.track.elements.includes(e)
  return {
    items,
    missing,
    count,
    sameUniv,
    needs: {
      min: items.filter((it) => it.track.min).length,
      interview: items.filter((it) => has(it, '면접')).length,
      essay: items.filter((it) => has(it, '논술')).length,
      practical: items.filter((it) => has(it, '실기')).length,
    },
    blocked: items.filter((it) => it.result.status === 'no').length,
  }
}
