import { useEffect, useSyncExternalStore } from 'react'
import type { AdmissionPlan } from '../data/schema'

// 대학별 전형 자료. 서버가 주는 최신 판을 쓰고(관리자가 고치면 바로 바뀐다), 서버가 없으면 앱에 든 자료를 쓴다.
// 판 번호를 가끔 물어 바뀌었으면 다시 받는다.

export interface AdmissionsState {
  plans: AdmissionPlan[]
  byUniv: Map<string, AdmissionPlan>
  version: string
  updatedAt: string
  /** 처음 받는 중 */
  loading: boolean
  error: string
  /** 서버에서 받지 못해 앱에 든 자료를 쓰는 중 (나중에 다시 받아 본다) */
  bundled: boolean
}

/** 앱에 든 자료를 쓸 때 보이는 안내 */
export const BUNDLED_NOTE = '최신 전형 자료를 받지 못해 앱에 든 자료를 보여 줘요. 잠시 후 다시 받아 볼게요.'

let state: AdmissionsState = { plans: [], byUniv: new Map(), version: '', updatedAt: '', loading: true, error: '', bundled: false }
let started: Promise<void> | null = null
let etag = ''
const listeners = new Set<() => void>()

const set = (next: Partial<AdmissionsState>) => {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

const accept = (plans: AdmissionPlan[], version: string, updatedAt: string, bundled = false) =>
  set({ plans, byUniv: new Map(plans.map((p) => [p.univ, p])), version, updatedAt, loading: false, error: '', bundled })

async function fetchLatest(): Promise<boolean> {
  const res = await fetch('/api/data/admissions', { headers: etag ? { 'if-none-match': etag } : {} })
  if (res.status === 304) return false
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { version: string; updatedAt: string; plans: AdmissionPlan[] }
  if (!Array.isArray(data.plans)) throw new Error('bad data')
  etag = res.headers.get('etag') ?? ''
  accept(data.plans, data.version, data.updatedAt)
  return true
}

/** 처음 한 번 받는다 (서버에서 못 받으면 앱에 든 자료를 쓰고, 잠시 뒤 다시 받아 본다) */
export function loadAdmissions(): Promise<void> {
  started ??= fetchLatest()
    .then(() => undefined)
    .catch(async () => {
      try {
        const bundled = (await import('../data/admissions2028.json')).default
        accept(bundled.plans, 'bundled', '', true)
        setTimeout(() => void refreshAdmissions(), 30_000)
      } catch {
        set({ loading: false, error: '전형 자료를 불러오지 못했어요.' })
      }
    })
  return started
}

/** 서버의 판이 바뀌었으면 새로 받는다 (앱에 든 자료를 쓰는 중이면 다시 받아 본다). 바뀌었으면 true */
export async function refreshAdmissions(): Promise<boolean> {
  if (!state.version) return false
  if (state.bundled) return fetchLatest().catch(() => false)
  try {
    const v = (await (await fetch('/api/data/version')).json()) as { admissions?: string }
    if (!v.admissions || v.admissions === state.version) return false
    return await fetchLatest()
  } catch {
    return false
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useAdmissions(): AdmissionsState {
  const s = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    void loadAdmissions()
  }, [])
  return s
}

/**
 * 판이 바뀌는지 지켜본다: 10분마다, 그리고 탭으로 돌아왔을 때.
 * 처음 받은 뒤에만 묻는다 (전형 화면을 열지 않은 사람에게는 요청하지 않는다).
 */
export function watchAdmissions(onUpdate: () => void): () => void {
  const check = () => {
    if (document.visibilityState !== 'visible' || !state.version) return
    void refreshAdmissions().then((changed) => changed && onUpdate())
  }
  const timer = setInterval(check, 10 * 60_000)
  document.addEventListener('visibilitychange', check)
  window.addEventListener('online', check)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', check)
    window.removeEventListener('online', check)
  }
}
