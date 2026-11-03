import type { AdmissionPlan, AdmissionTrack } from './schema'
import { ADMISSION_TYPES, SCHOOL_TYPES, SPECIALS } from './schema'

// 전형 자료 한 대학 몫을 검사하고 정리한다. 관리자가 화면에서 고친 자료와 AI가 원문에서 찾은 고칠 곳도 이 검사를 거친다.
// (scripts/build-admissions.mjs와 같은 규칙)

const PERIODS = ['수시', '정시', '기타']
const QUOTAS = ['정원내', '정원외']
const GRADS = ['예정자', '졸업자포함', '졸업자']
const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
const ELEMENTS = ['교과', '서류', '면접', '논술', '실기', '수능']

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null)
const optText = (v: unknown, max: number): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'string' && v.length <= max ? v.trim() || null : undefined
const listOf = (v: unknown, allowed: readonly string[]): string[] | null => {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && allowed.includes(x))) return null
  return [...new Set(v as string[])]
}

export class PlanError extends Error {}

/** 검사를 통과하면 정리한 자료, 아니면 PlanError (무엇이 틀렸는지 첫 몇 개를 알려 준다) */
export function checkPlan(raw: unknown, univ: string, source: Pick<AdmissionPlan, 'url' | 'page' | 'watch' | 'fileSha'> = { url: '' }): AdmissionPlan {
  const errors: string[] = []
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const planTitle = text(r.planTitle, 120)
  if (!planTitle) errors.push('planTitle')
  const date = typeof r.date === 'string' && /^20\d\d-\d\d-\d\d$/.test(r.date) ? r.date : null
  if (!date) errors.push('date (YYYY-MM-DD)')
  // 모집시기별 합계: 없으면 null. 빈 객체나 배열은 합계를 지우는 것과 같아 받지 않는다
  let totals: Record<string, number> | null = null
  if (r.totals !== null && r.totals !== undefined) {
    const entries = typeof r.totals === 'object' && !Array.isArray(r.totals) ? Object.entries(r.totals as Record<string, unknown>) : []
    if (entries.length && entries.every(([k, n]) => k.length <= 10 && Number.isInteger(n) && (n as number) >= 0))
      totals = Object.fromEntries(entries) as Record<string, number>
    else errors.push('totals')
  }
  const changes = Array.isArray(r.changes) ? r.changes.filter((c): c is string => typeof c === 'string' && !!c.trim()).map((c) => c.trim().slice(0, 120)) : []
  if (changes.length > 8) errors.push('changes는 8개까지')
  const tracksRaw = Array.isArray(r.tracks) ? r.tracks : []
  if (!tracksRaw.length) errors.push('tracks가 비었음')
  const ids = new Set<string>()
  const tracks: AdmissionTrack[] = []
  tracksRaw.forEach((t0, i) => {
    const t = (t0 && typeof t0 === 'object' ? t0 : {}) as Record<string, unknown>
    const at = `tracks[${i}]`
    const bad = (f: string) => errors.push(`${at} ${f}`)
    const id = typeof t.id === 'string' && /^[a-z0-9][a-z0-9-]{0,40}$/.test(t.id) && !ids.has(t.id) ? t.id : null
    if (!id) bad('id')
    else ids.add(id)
    const name = text(t.name, 60)
    if (!name) bad('name')
    const type = (ADMISSION_TYPES as readonly string[]).includes(t.type as string) ? (t.type as AdmissionTrack['type']) : null
    if (!type) bad('type')
    const period = PERIODS.includes(t.period as string) ? (t.period as AdmissionTrack['period']) : null
    if (!period) bad('period')
    const quota = QUOTAS.includes(t.quota as string) ? (t.quota as AdmissionTrack['quota']) : null
    if (!quota) bad('quota')
    const seats =
      t.seats === null || t.seats === undefined
        ? null
        : Number.isInteger(t.seats) && (t.seats as number) >= 0 && (t.seats as number) <= 10000
          ? (t.seats as number)
          : undefined
    if (seats === undefined) bad('seats')
    const grads = t.grads === null || t.grads === undefined ? null : GRADS.includes(t.grads as string) ? (t.grads as AdmissionTrack['grads']) : undefined
    if (grads === undefined) bad('grads')
    let rec: AdmissionTrack['rec'] = null
    if (t.rec && typeof t.rec === 'object') {
      const lim = optText((t.rec as Record<string, unknown>).limit, 60)
      if ((t.rec as Record<string, unknown>).required === true && lim !== undefined) rec = { required: true, limit: lim }
      else bad('rec')
    }
    const s = (t.schools && typeof t.schools === 'object' ? t.schools : {}) as Record<string, unknown>
    const only = listOf(s.only, SCHOOL_TYPES)
    const exclude = listOf(s.exclude, SCHOOL_TYPES)
    if (!only || !exclude) bad('schools')
    const regions = listOf(t.regions, REGIONS)
    if (!regions) bad('regions')
    const special = listOf(t.special, SPECIALS)
    if (!special) bad('special')
    const who = text(t.who, 140)
    if (!who) bad('who')
    const method = text(t.method, 140)
    if (!method) bad('method')
    const elements = listOf(t.elements, ELEMENTS)
    if (!elements || !elements.length) bad('elements')
    const min = optText(t.min, 160)
    const subjects = optText(t.subjects, 160)
    const note = optText(t.note, 140)
    if (min === undefined) bad('min')
    if (subjects === undefined) bad('subjects')
    if (note === undefined) bad('note')
    const pages = text(t.pages, 20)
    if (!pages) bad('pages')
    const extra = trackDetail(t, bad)
    if (
      id &&
      name &&
      type &&
      period &&
      quota &&
      seats !== undefined &&
      grads !== undefined &&
      only &&
      exclude &&
      regions &&
      special &&
      who &&
      method &&
      elements?.length &&
      pages
    )
      tracks.push({
        id,
        name,
        type,
        period,
        quota,
        seats,
        grads,
        rec,
        schools: { only: only as AdmissionTrack['schools']['only'], exclude: exclude as AdmissionTrack['schools']['exclude'] },
        regions,
        special: special as AdmissionTrack['special'],
        who,
        method,
        elements: elements as AdmissionTrack['elements'],
        min: min ?? null,
        subjects: subjects ?? null,
        note: note ?? null,
        pages,
        ...extra,
      })
  })
  const detail = planDetail(r, ids, errors)
  if (errors.length) throw new PlanError(`자료가 맞지 않아요: ${errors.slice(0, 6).join(', ')}${errors.length > 6 ? ` 외 ${errors.length - 6}개` : ''}`)
  const link = (x: unknown, fallback: string | undefined) => (typeof x === 'string' && /^https:\/\//.test(x) ? x.slice(0, 500) : fallback)
  const page = link(r.page, source.page)
  const watch = link(r.watch, source.watch)
  // AI가 옮긴 날: 관리자가 확인하고 지우면(빼고 저장하면) 표시가 사라진다
  const ai = typeof r.ai === 'string' && /^20\d\d-\d\d-\d\d$/.test(r.ai) ? r.ai : null
  const aiCheck = ai && typeof r.aiCheck === 'string' && /^20\d\d-\d\d-\d\d$/.test(r.aiCheck) ? r.aiCheck : null
  return {
    univ,
    planTitle: planTitle!,
    url: typeof r.url === 'string' && /^https?:\/\//.test(r.url) ? r.url.slice(0, 500) : source.url,
    ...(page ? { page } : {}),
    ...(watch ? { watch } : {}),
    ...(source.fileSha ? { fileSha: source.fileSha } : {}),
    ...(ai ? { ai } : {}),
    ...(aiCheck ? { aiCheck } : {}),
    date: date!,
    totals,
    changes,
    tracks,
    ...detail,
  }
}

// ---- 전형 상세 (정시 수능·학생부 반영, 단계별 선발, 면접·논술·서류) ----
// 모양이 틀린 것은 버리지 않고 검사에서 막는다. 버리고 저장하면 틀린 묶음 하나로 정시 반영 방법이 통째로 사라지거나,
// 없는 전형 id만 빠진 빈 배열이 '이 대학 해당 전형 모두'로 읽혀 범위가 넓어진다

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {}) as Record<string, unknown>
/** 요소·영역별 반영 비율(%). 모양이 틀리면 null */
const ratios = (x: unknown, allowEmpty: boolean): Record<string, number> | null => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  const entries = Object.entries(x as Record<string, unknown>)
  if (entries.length > 12 || (!entries.length && !allowEmpty)) return null
  return entries.every(([k, v]) => k.length <= 30 && isNum(v) && v >= 0 && v <= 100) ? (Object.fromEntries(entries) as Record<string, number>) : null
}

function trackDetail(t: Record<string, unknown>, bad: (f: string) => void): Partial<AdmissionTrack> {
  const out: Partial<AdmissionTrack> = {}
  if (t.stages !== null && t.stages !== undefined) {
    if (!Array.isArray(t.stages) || t.stages.length > 8) bad('stages (8단계까지)')
    else {
      const stages = t.stages.map((s0, i) => {
        const s = obj(s0)
        const step = text(s.step, 20)
        const pick = optText(s.pick, 40)
        const parts = ratios(s.parts, false)
        if (!step || pick === undefined || !parts) bad(`stages[${i}]`)
        return { step: step ?? '', pick: pick ?? null, parts: parts ?? {} }
      })
      if (stages.length) out.stages = stages
    }
  }
  for (const k of ['interview', 'essay', 'docs'] as const) {
    const v = optText(t[k], 300)
    if (v === undefined) bad(`${k} (300자까지)`)
    else if (v) out[k] = v
  }
  return out
}

function planDetail(r: Record<string, unknown>, ids: Set<string>, errors: string[]): Partial<AdmissionPlan> {
  const out: Partial<AdmissionPlan> = {}
  /** 묶음 목록: 없으면 빼고, 배열이 아니거나 20개를 넘으면 틀린 것 */
  const list = (x: unknown, name: string): unknown[] | null => {
    if (x === null || x === undefined) return null
    if (Array.isArray(x) && x.length <= 20) return x
    errors.push(`${name} (20개까지의 배열)`)
    return null
  }
  const fields = (x: Record<string, unknown>, at: string) => {
    const bad = (f: string) => errors.push(`${at} ${f}`)
    return {
      bad,
      req: (k: string, max: number) => {
        const v = text(x[k], max)
        if (!v) bad(k)
        return v ?? ''
      },
      opt: (k: string, max: number) => {
        const v = optText(x[k], max)
        if (v === undefined) bad(k)
        return v ?? null
      },
      /** 이 방법을 쓰는 전형 id (비우면 그 대학의 해당 전형 모두). 없는 전형 id가 하나라도 있으면 틀린 것 */
      tracks: () => {
        const v = x.tracks
        if (v === null || v === undefined) return []
        if (Array.isArray(v) && v.every((id) => typeof id === 'string' && ids.has(id))) return [...new Set(v as string[])]
        bad('tracks (없는 전형 id)')
        return []
      },
    }
  }
  const suneung = list(r.suneung, 'suneung')
  if (suneung)
    out.suneung = suneung.map((x0, i) => {
      const x = obj(x0)
      const f = fields(x, `suneung[${i}]`)
      const weights = ratios(x.weights, true)
      if (!weights) f.bad('weights')
      const total = x.total === null || x.total === undefined ? null : isNum(x.total) && x.total > 0 ? x.total : undefined
      if (total === undefined) f.bad('total')
      return {
        group: f.req('group', 30),
        units: f.opt('units', 200),
        tracks: f.tracks(),
        use: f.req('use', 60),
        weights: weights ?? {},
        inquiry: f.opt('inquiry', 300),
        english: f.opt('english', 300),
        history: f.opt('history', 300),
        bonus: f.opt('bonus', 300),
        formula: f.opt('formula', 400),
        total: total ?? null,
        pages: f.req('pages', 40),
      }
    })
  const record = list(r.record, 'record')
  if (record)
    out.record = record.map((x0, i) => {
      const f = fields(obj(x0), `record[${i}]`)
      return {
        tracks: f.tracks(),
        subjects: f.req('subjects', 300),
        terms: f.opt('terms', 300),
        grades: f.opt('grades', 300),
        achievement: f.opt('achievement', 300),
        formula: f.opt('formula', 400),
        extra: f.opt('extra', 300),
        pages: f.req('pages', 40),
      }
    })
  return out
}
