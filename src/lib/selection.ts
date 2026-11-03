import { useEffect, useState } from 'react'
import type { Unit } from '../data/schema'
import { unitsOf } from '../engine/search'

/** 고른 분야(묶음·세부 학과) × 대학의 학과 (대학 순서 → 분야 순서, 중복 제거) */
export function majorUnitsOf(majors: string[], univs: string[]): Unit[] {
  const seen = new Set<string>()
  const all = majors.flatMap((m) => unitsOf(m)).filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)))
  return univs.flatMap((id) => all.filter((u) => u.univ === id))
}

/** 한 대학에서 '내 학과': 고른 분야의 학과. 학과를 직접 골라 뒀으면 그것만 */
export function myUnitsAt(univ: string, majors: string[], unitIds: string[] | null): Unit[] {
  const units = majorUnitsOf(majors, [univ])
  const picked = unitIds ? units.filter((u) => unitIds.includes(u.id)) : []
  return picked.length ? picked : units
}

/**
 * 대학 → 모집단위 id → 전형 id → 모집인원 (시행계획의 모집단위별 인원표에서 옮긴 것).
 * 전형 id가 없으면 그 전형으로 안 뽑고, null이면 뽑지만 학과별 인원이 정해지지 않았다(약간명·이월 인원·계열 단위 모집 등).
 */
export type UnitSeats = Record<string, Record<string, Record<string, number | null>>>

export interface MySeats {
  rows: { unit: Unit; n: number | null | undefined }[]
  total: number
  /** 뽑지만 인원이 정해지지 않은 학과가 있다 */
  open: boolean
}

/** 전형 하나에서 내 학과 모집인원. 인원표에 내 학과가 없으면 null */
export function mySeatsIn(univSeats: UnitSeats[string] | undefined, units: Unit[], track: string): MySeats | null {
  if (!univSeats) return null
  const rows = units
    .filter((u) => Object.hasOwn(univSeats, u.id))
    .map((u) => ({ unit: u, n: Object.hasOwn(univSeats[u.id], track) ? univSeats[u.id][track] : undefined }))
  if (!rows.length) return null
  return { rows, total: rows.reduce((a, r) => a + (r.n ?? 0), 0), open: rows.some((r) => r.n === null) }
}

export const recruitsMine = (m: MySeats) => m.total > 0 || m.open

export function mySeatsText(m: MySeats): string {
  if (m.total) return `내 학과 ${m.total.toLocaleString('ko-KR')}명${m.open ? ' 이상' : ''}`
  return m.open ? '내 학과 인원 미정' : '내 학과 모집 없음'
}

export function unitSeatText(n: number | null | undefined): string {
  return n ? `${n}명` : n === null ? '인원 미정' : '이 전형으로 뽑지 않아요'
}

let cache: UnitSeats | null = null
let loading: Promise<UnitSeats> | null = null

/** 모집단위별 인원은 따로 받는다 (전형 목록을 볼 때만) */
export function useUnitSeats(): UnitSeats | null {
  const [seats, setSeats] = useState(cache)
  useEffect(() => {
    if (cache) return
    let alive = true
    loading ??= import('../data/admissions2028.units.json').then((m) => (cache = m.default as UnitSeats))
    void loading.then((v) => alive && setSeats(v))
    return () => {
      alive = false
    }
  }, [])
  return seats
}
