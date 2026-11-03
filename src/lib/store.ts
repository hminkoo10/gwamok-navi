import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { upgradeMajors } from '../data/majors'
import { ADMISSION_TYPES, SCHOOL_TYPES, type School, SPECIALS, TERMS } from '../data/schema'
import { SCHOOL_BY_ID } from '../data/schools'
import { UNIV_BY_ID } from '../data/universities'
import { UNIT_BY_ID } from '../data/units'
import { EMPTY_PROFILE, type Profile, SIDO } from '../engine/admissions'
import { type ChoiceChange, type ChoiceState, excludeChoice, includeChoice, pinChoice, unpinChoice } from '../engine/choices'
import { isPickKey, MAX_PICKS } from '../engine/picks'
import { type Focus, FOCUS_IDS } from '../engine/focus'
import { schoolFromLoose } from '../engine/school'
import type { ToastAction } from './app'
import { josa } from './format'
import { decodeShare, encodeShare, type ShareState } from './share'
import { AccountSync, type BaseSnap, hashText, type SyncInfo, type SyncState } from './sync'

export type { SyncState } from './sync'

// 화면 상태. localStorage에 저장하고, 로그인하면 계정에도 올린다. 공유 링크는 주소 # 뒤에 담는다.
// 설계는 슬롯 단위로, 지금 슬롯의 내용이 prefs다. 기본 학교는 없어 처음엔 학교부터 고른다.
// 계정과는 마지막으로 맞춘 기준(SYNC_KEY)에 견줘 합친다: 다른 기기에서 지운 것은 지우고, 이 기기에서 새로 만든 것은 남긴다.

const PREFS_KEY = 'gwamok-navi:v4'
const OLD_PREFS_KEYS = ['gwamok-navi:v3', 'gwamok-navi:v2']
const SCHOOLS_KEY = 'gwamok-navi:schools'
/** 슬롯 목록. 예전 '설계안' 키를 그대로 써서 저장된 설계안이 곧 슬롯이 된다 */
const SLOTS_KEY = 'gwamok-navi:plans'
/** 이 기기 설계의 주인 계정. 로그인 없이 만들었으면 없음 */
const OWNER_KEY = 'gwamok-navi:owner'
/** 마지막으로 계정과 맞춘 기준: 계정 판(rev), 그때의 슬롯·편제표 해시 */
const SYNC_KEY = 'gwamok-navi:sync'
/** 다른 탭이 바꾸면 다시 읽는 키 */
const STORE_KEYS = new Set([PREFS_KEY, SCHOOLS_KEY, SLOTS_KEY, OWNER_KEY, SYNC_KEY])
const SLOT_ID = /^[a-z0-9-]{1,40}$/

/** 목록 길이 상한. 서버 한도 안쪽 (넘으면 서버가 저장을 거절) */
const MAX_MAJORS = 100
const MAX_UNIVS = 60
const MAX_CHOICES = 500
const MAX_UNITS = 5000
export const MAX_SCHOOLS = 20

/** 대학 고르기에서 한 번에 더하는 묶음 (서울 주요 대학, 지역 거점 국립대) */
export const SEOUL_MAJOR = ['snu', 'yonsei', 'korea', 'skku', 'sogang', 'hanyang', 'cau']
export const FLAGSHIP = ['pnu', 'knu', 'cnu', 'jnu', 'cbnu', 'jbnu', 'kangwon']

export interface Prefs {
  majors: string[]
  /** 목표 대학 */
  univs: string[]
  /** null이면 고른 분야·대학의 모집단위 전체 */
  unitIds: string[] | null
  /** 빈 문자열이면 아직 학교를 고르지 않음 */
  schoolId: string
  pinned: string[]
  excluded: string[]
  /** 지원 자격 판정에 쓰는 내 조건. 특별 자격은 이 기기에만 저장 */
  profile: Profile
  /** 원서 후보 전형 ('대학 id:전형 id') */
  picks: string[]
  /** 목표 전형. 과목 추천의 기준 */
  focus: Focus
  /** 목표 전형이 권장과목을 안 보는 대학도 권장과목을 채운다 (수시·정시를 함께 준비할 때) */
  keepAll: boolean
  /** 지금 보는 슬롯 id */
  slot: string
  /** 지금 슬롯을 마지막으로 고친 때. 합칠 때 나중에 고친 쪽이 이긴다 */
  at?: string
}

const EMPTY: Prefs = {
  majors: [],
  univs: [],
  unitIds: null,
  schoolId: '',
  pinned: [],
  excluded: [],
  profile: EMPTY_PROFILE,
  picks: [],
  focus: '종합',
  keepAll: false,
  slot: '',
  at: '',
}

/** 슬롯마다 따로 두는 설계. profile·picks는 모든 슬롯 공통 */
export type Design = Pick<Prefs, 'schoolId' | 'majors' | 'univs' | 'unitIds' | 'pinned' | 'excluded' | 'focus' | 'keepAll'>

export const designOf = (p: Design): Design => ({
  schoolId: p.schoolId,
  majors: p.majors,
  univs: p.univs,
  unitIds: p.unitIds,
  pinned: p.pinned,
  excluded: p.excluded,
  focus: p.focus,
  keepAll: p.keepAll,
})

export const sameDesign = (a: Design, b: Design) => JSON.stringify(designOf(a)) === JSON.stringify(designOf(b))

/** 빈 설계. 학교는 부르는 쪽이 채운다 */
const EMPTY_DESIGN: Design = designOf(EMPTY)

const now = () => new Date().toISOString()
/** 둘 중 나중 시각 (비어 있으면 다른 쪽) */
const laterOf = (a: string | undefined, b: string | undefined) => ((a ?? '') > (b ?? '') ? (a ?? '') : (b ?? ''))

function restoreProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== 'object') return EMPTY_PROFILE
  const r = raw as Record<string, unknown>
  const pick = <T extends string>(x: unknown, allowed: readonly T[]): T[] =>
    Array.isArray(x) ? [...new Set(x.filter((v): v is T => allowed.includes(v as T)))] : []
  return {
    status: r.status === '졸업생' ? '졸업생' : '재학생',
    schoolType: typeof r.schoolType === 'string' && (SCHOOL_TYPES as readonly string[]).includes(r.schoolType) ? (r.schoolType as Profile['schoolType']) : '',
    region: typeof r.region === 'string' && (SIDO as readonly string[]).includes(r.region) ? r.region : '',
    special: pick(r.special, SPECIALS),
    types: pick(r.types, ADMISSION_TYPES),
  }
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function readOwner(): number | null {
  const o = read(OWNER_KEY)
  return typeof o === 'number' ? o : null
}

const strings = (x: unknown, ok: (s: string) => boolean = () => true) =>
  Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && s.length <= 80 && ok(s)))] : []

const cleanTrack = (x: unknown) =>
  typeof x === 'string'
    ? x
        .replace(/[^\p{L}\p{N} ·()-]/gu, '')
        .trim()
        .slice(0, 30)
    : ''

function restoreSchool(raw: unknown): School | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '')
  const id = text(r.id, 80)
  if (!id || SCHOOL_BY_ID.has(id)) return null
  const cohort = typeof r.cohort === 'number' ? r.cohort : 2026
  const school = schoolFromLoose(r, { id, name: text(r.name, 30) || '이름 없는 학교', region: text(r.region, 20), cohort })
  const notes = strings(r.notes).slice(0, 10)
  const source = r.source && typeof r.source === 'object' ? (r.source as Record<string, unknown>) : {}
  const shared = r.shared && typeof r.shared === 'object' ? (r.shared as Record<string, unknown>) : null
  const track = cleanTrack(r.track)
  const kind = text(r.kind, 10)
  return {
    ...school,
    checked: text(r.checked, 10) || school.checked,
    notes,
    source: { title: text(source.title, 160) || '직접 입력', url: /^https?:\/\//.test(text(source.url, 500)) ? text(source.url, 500) : '' },
    ...(shared && typeof shared.id === 'number'
      ? { shared: { id: shared.id, at: text(shared.at, 30), ...(shared.verified === true ? { verified: true } : {}) } }
      : {}),
    ...(track ? { track } : {}),
    ...(kind ? { kind } : {}),
  }
}

/** 저장된 편제표 목록. id가 겹치면 앞의 것만 */
function restoreSchools(raw: unknown): School[] {
  if (!Array.isArray(raw)) return []
  const out: School[] = []
  for (const r of raw) {
    const s = restoreSchool(r)
    if (s && !out.some((x) => x.id === s.id)) out.push(s)
  }
  return out.slice(0, MAX_SCHOOLS)
}

/** 저장하는 모양으로 다시 정리한다. 계정에서 받은 것과 모양이 같아야 해시로 변경을 견줄 수 있다 */
export function normalizeSchool(s: School): School {
  return restoreSchool(JSON.parse(JSON.stringify(s))) ?? s
}

/** 편제표 내용 비교 키: 입학년도·학과, 학기별 과목·학점·선택 묶음·세트. 학교 이름·출처·확인 표시는 뺀다 */
export function curriculumKey(s: School): string {
  return JSON.stringify([
    s.cohort,
    s.track ?? '',
    TERMS.map((id) => {
      const t = s.terms.find((x) => x.id === id)
      return t ? [t.fixed.map((f) => [f.subject, f.credits, f.alt ?? '']), t.groups.map((g) => [g.label, g.pick, g.credits, g.options])] : [[], []]
    }),
    s.tracks.map((tr) => [tr.label, tr.sets.map((set) => [set.label, set.items.map((it) => [it.term, it.subject, it.credits])])]),
  ])
}

/** 맨 앞에 넣는다 (같은 id는 교체). 20개를 넘으면 어느 슬롯도 안 쓰는 것을 뒤에서부터 뺀다 */
export function withSchool(list: School[], s: School, inUse: Set<string>): School[] {
  const next = [s, ...list.filter((x) => x.id !== s.id)]
  while (next.length > MAX_SCHOOLS) {
    const i = next.findLastIndex((x) => x.id !== s.id && !inUse.has(x.id))
    next.splice(i < 0 ? next.length - 1 : i, 1)
  }
  return next
}

/**
 * 공유받은 편제표를 둘 자리. 같은 id의 내 편제표가 내용까지 같으면 내 것을 그대로 쓴다 (확인 표시 유지).
 * 내용이 다르면 내 것을 덮어쓰지 않고 새 id로 따로 둔다
 */
export function placeShared(shared: School, schools: School[], inUse: Set<string>): { school: School; schools: School[] } {
  const s = normalizeSchool(shared)
  const mine = schools.find((x) => x.id === s.id)
  if (mine && curriculumKey(mine) === curriculumKey(s)) return { school: mine, schools }
  const school = mine ? { ...s, id: `shared-${s.name.slice(0, 30)}-${s.cohort}-${Math.random().toString(36).slice(2, 6)}` } : s
  return { school, schools: withSchool(schools, school, inUse) }
}

function restorePrefs(raw: unknown, schoolIds: Set<string>): Prefs {
  if (!raw || typeof raw !== 'object') return EMPTY
  const r = raw as Record<string, unknown>
  const unitIds = r.unitIds === null ? null : strings(r.unitIds, (s) => UNIT_BY_ID.has(s))
  // v2는 대학을 '숨기기'(hiddenUnivs)로 저장했다
  const univs = Array.isArray(r.univs)
    ? strings(r.univs, (s) => UNIV_BY_ID.has(s)).slice(0, MAX_UNIVS)
    : Array.isArray(r.hiddenUnivs)
      ? SEOUL_MAJOR.filter((u) => !strings(r.hiddenUnivs).includes(u))
      : []
  return {
    majors: upgradeMajors(strings(r.majors)).slice(0, MAX_MAJORS),
    univs,
    unitIds: unitIds && unitIds.length ? unitIds.slice(0, MAX_UNITS) : null,
    schoolId: typeof r.schoolId === 'string' && schoolIds.has(r.schoolId) ? r.schoolId : '',
    pinned: strings(r.pinned).slice(0, MAX_CHOICES),
    excluded: strings(r.excluded).slice(0, MAX_CHOICES),
    profile: restoreProfile(r.profile),
    picks: strings(r.picks, isPickKey).slice(0, MAX_PICKS),
    focus: FOCUS_IDS.includes(r.focus as Focus) ? (r.focus as Focus) : '종합',
    keepAll: r.keepAll === true,
    slot: typeof r.slot === 'string' && SLOT_ID.test(r.slot) ? r.slot : '',
    at: '',
  }
}

/** 따로 저장해 두고 오가는 설계 (다른 진로·대학 비교용) */
export interface Slot extends Design {
  id: string
  name: string
  /** 마지막으로 바뀐 때 */
  at: string
}

export const MAX_SLOTS = 10

const newSlotId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export const cleanSlotName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 30)

/** 아직 안 쓴 이름: base, base 2, base 3 … ('슬롯'이면 슬롯 1부터) */
export function unusedSlotName(slots: { name: string }[], base = '슬롯'): string {
  const used = new Set(slots.map((s) => s.name))
  const full = cleanSlotName(base)
  if (base !== '슬롯' && !used.has(full)) return full
  const stem = full.slice(0, 26)
  for (let n = base === '슬롯' ? 1 : 2; ; n++) if (!used.has(`${stem} ${n}`)) return `${stem} ${n}`
}

/** 저장된 슬롯을 검사해 되살린다. 목표 전형이 없는 예전 '설계안'은 '종합'으로 */
export function restoreSlots(raw: unknown, schoolIds: Set<string>): Slot[] {
  if (!Array.isArray(raw)) return []
  const out: Slot[] = []
  for (const r0 of raw) {
    if (!r0 || typeof r0 !== 'object') continue
    const r = r0 as Record<string, unknown>
    const id = typeof r.id === 'string' && SLOT_ID.test(r.id) ? r.id : ''
    const name = typeof r.name === 'string' ? cleanSlotName(r.name) : ''
    if (!id || !name || out.some((s) => s.id === id)) continue
    out.push({
      id,
      name,
      at: typeof r.at === 'string' ? r.at.slice(0, 30) : '',
      ...designOf(restorePrefs(r, schoolIds)),
      // 지워진 학교 id도 남긴다. 열 때 지금 학교로 바꾼다 (openSlot)
      schoolId: typeof r.schoolId === 'string' ? r.schoolId.slice(0, 80) : '',
    })
    if (out.length === MAX_SLOTS) break
  }
  return out
}

const hasChoices = (p: Design) => !!(p.schoolId || p.majors.length || p.univs.length)

const profileSet = (p: Profile) => p.status === '졸업생' || !!p.schoolType || !!p.region || p.special.length > 0 || p.types.length > 0

/** 아무것도 고르지 않은 상태 */
const isBlank = (s: LocalState) =>
  !s.schools.length && !s.prefs.picks.length && !hasChoices(s.prefs) && !profileSet(s.prefs.profile) && s.slots.every((x) => !hasChoices(x))

/**
 * prefs를 슬롯에 맞춘다. 슬롯은 prefs.slot → 같은 설계의 슬롯(예전 설계안) → 맨 앞에 새로 만든 슬롯 순으로 정하고, 내용은 prefs로 맞춘다.
 * 가득 찼으면 빈 슬롯을, 없으면 가장 오래 안 고친 슬롯을 뺀다. dropped: 빼서 알릴 슬롯 이름
 */
export function withSlots(prefs: Prefs, slots: Slot[]): { prefs: Prefs; slots: Slot[]; dropped: string[] } {
  let list = slots
  const dropped: string[] = []
  let active = list.find((s) => s.id === prefs.slot) ?? list.find((s) => sameDesign(s, prefs))
  if (!active) {
    active = { id: newSlotId(), name: unusedSlotName(list), at: prefs.at || now(), ...designOf(prefs) }
    if (list.length >= MAX_SLOTS) {
      const out = list.find((s) => !hasChoices(s)) ?? list.reduce((a, b) => (b.at < a.at ? b : a))
      if (hasChoices(out)) dropped.push(out.name)
      list = list.filter((s) => s !== out)
    }
    list = [active, ...list]
  }
  const id = active.id
  const next = list.map((s) => (s.id === id && !sameDesign(s, prefs) ? { ...s, ...designOf(prefs), at: laterOf(prefs.at, s.at) } : s))
  return { prefs: { ...prefs, slot: id, at: next.find((s) => s.id === id)?.at ?? '' }, slots: next, dropped }
}

/** 지금 슬롯 내용을 prefs로 바꾼 목록 (화면·저장용) */
const withDesign = (list: Slot[], p: Prefs): Slot[] => list.map((s) => (s.id === p.slot ? { ...s, ...designOf(p), at: laterOf(p.at, s.at) } : s))

/** 슬롯을 떠나기 전: 지금 설계를 써 넣고, 바뀌었으면 at도 적는다 */
const synced = (list: Slot[], p: Prefs): Slot[] =>
  list.map((s) => (s.id === p.slot && !sameDesign(s, p) ? { ...s, ...designOf(p), at: laterOf(p.at, s.at) || now() } : s))

/** 슬롯을 연 설계. 그 학교가 지워졌으면 지금 학교로 열고, 꼭 듣기·빼기는 학교마다 달라 비운다 */
function openSlot(p: Prefs, s: Slot, schools: School[]): Prefs {
  const known = schools.some((x) => x.id === s.schoolId)
  return { ...p, ...designOf(s), ...(known ? {} : { schoolId: p.schoolId, pinned: [], excluded: [] }), slot: s.id, at: s.at }
}

// ---- 계정과 합치기 ----

/** 화면 상태 전체. slots의 지금 슬롯은 prefs로 채운 것 */
export interface LocalState {
  prefs: Prefs
  schools: School[]
  slots: Slot[]
}

/** 계정 설계를 되살린 것. empty: 열 슬롯도, 고른 학교·분야·대학도 없음 */
export interface Remote extends LocalState {
  empty: boolean
}

/** 마지막으로 계정과 맞춘 기준: 슬롯·편제표별 내용 해시, picks·profile 해시, 열려 있던 슬롯 */
export interface Snap extends BaseSnap {
  slots: [string, string][]
  schools: [string, string][]
  picks: string
  profile: string
  active: string
}

const slotRecord = (s: Slot) => ({
  id: s.id,
  name: s.name,
  at: s.at,
  schoolId: s.schoolId,
  majors: s.majors.slice(0, MAX_MAJORS),
  univs: s.univs.slice(0, MAX_UNIVS),
  unitIds: s.unitIds ? s.unitIds.slice(0, MAX_UNITS) : null,
  pinned: s.pinned.slice(0, MAX_CHOICES),
  excluded: s.excluded.slice(0, MAX_CHOICES),
  focus: s.focus,
  keepAll: s.keepAll,
})

/**
 * 계정에 올리는 설계. 특별 자격은 민감할 수 있어 빼고, 서버 한도로 자른다.
 * 키 순서를 고정해 내용이 같으면 해시도 같다
 */
export function payloadOf(s: LocalState) {
  const p = s.prefs
  return {
    prefs: {
      majors: p.majors.slice(0, MAX_MAJORS),
      univs: p.univs.slice(0, MAX_UNIVS),
      unitIds: p.unitIds ? p.unitIds.slice(0, MAX_UNITS) : null,
      schoolId: p.schoolId,
      pinned: p.pinned.slice(0, MAX_CHOICES),
      excluded: p.excluded.slice(0, MAX_CHOICES),
      profile: { status: p.profile.status, schoolType: p.profile.schoolType, region: p.profile.region, special: [], types: p.profile.types },
      picks: p.picks.slice(0, MAX_PICKS),
      focus: p.focus,
      keepAll: p.keepAll,
      slot: p.slot,
    },
    schools: s.schools.slice(0, MAX_SCHOOLS),
    // 서버 필드 이름은 예전 그대로 plans
    plans: s.slots.slice(0, MAX_SLOTS).map(slotRecord),
  }
}

/** 슬롯 내용 해시. id·at은 뺀다 */
const slotHash = (s: Slot) => hashText(JSON.stringify([s.name, s.schoolId, s.majors, s.univs, s.unitIds, s.pinned, s.excluded, s.focus, s.keepAll]))
const schoolHash = (s: School) => hashText(JSON.stringify(s))
const picksHash = (picks: string[]) => hashText(JSON.stringify(picks))
/** 특별 자격은 계정에 올리지 않으므로 뺀다 */
const profileHash = (p: Profile) => hashText(JSON.stringify([p.status, p.schoolType, p.region, p.types]))

export function snapshotOf(s: LocalState | null, owner: number, rev: string | null, hash: string): Snap {
  return {
    owner,
    rev,
    hash,
    slots: s ? s.slots.map((x) => [x.id, slotHash(x)]) : [],
    schools: s ? s.schools.map((x) => [x.id, schoolHash(x)]) : [],
    picks: picksHash(s ? s.prefs.picks : []),
    profile: s ? profileHash(s.prefs.profile) : '',
    active: s ? s.prefs.slot : '',
  }
}

const pairs = (x: unknown): [string, string][] | null =>
  Array.isArray(x) && x.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string')
    ? (x as [string, string][])
    : null

function readSnap(): Snap | null {
  const r = read(SYNC_KEY) as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || typeof r.owner !== 'number' || typeof r.hash !== 'string') return null
  const slots = pairs(r.slots)
  const schools = pairs(r.schools)
  if (!(typeof r.rev === 'string' || r.rev === null) || !slots || !schools) return null
  return {
    owner: r.owner,
    rev: r.rev as string | null,
    hash: r.hash,
    slots,
    schools,
    picks: typeof r.picks === 'string' ? r.picks : '',
    profile: typeof r.profile === 'string' ? r.profile : '',
    active: typeof r.active === 'string' ? r.active : '',
  }
}

/** 계정 설계를 되살린다. 모양이 틀리면 null */
export function restoreSaved(raw: unknown): Remote | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as { prefs?: unknown; schools?: unknown; plans?: unknown }
  const schools = restoreSchools(r.schools)
  const ids = new Set(schools.map((s) => s.id))
  // 학교 id는 슬롯처럼 그대로 둔다. 그 학교가 있는지는 합친 뒤에 본다
  const p = r.prefs && typeof r.prefs === 'object' ? (r.prefs as Record<string, unknown>) : {}
  const prefs = { ...restorePrefs(r.prefs, ids), schoolId: typeof p.schoolId === 'string' ? p.schoolId.slice(0, 80) : '' }
  const slots = restoreSlots(r.plans, ids)
  return { prefs, schools, slots, empty: !(slots.some((s) => s.id === prefs.slot) || hasChoices(prefs)) }
}

/** 세 갈래 고르기: 같으면 계정 것(r), 한쪽만 기준 b에서 바뀌었으면 그쪽, 둘 다 바뀌었거나 b가 없으면 both */
function pick3<T>(r: T, l: T, b: string | undefined, hash: (x: T) => string, both: (r: T, l: T) => T): T {
  const rh = hash(r)
  const lh = hash(l)
  if (rh === lh) return r
  if (b !== undefined) {
    if (lh === b) return r
    if (rh === b) return l
  }
  return both(r, l)
}

/**
 * 계정 설계(remote)와 이 기기 것(local)을 합친다. base: 이 기기가 마지막으로 계정과 맞춘 기준.
 * - 양쪽에 있는 슬롯: 한쪽만 바뀌었으면 그쪽, 둘 다 바뀌었으면 나중에 고친 쪽(at).
 * - 한쪽에만 있는 슬롯·편제표: 기준에 있고 그 뒤로 그대로면 다른 쪽에서 지운 것이라 뺀다. 기준에 없으면 새로 만든 것이라 남긴다.
 * - 기준이 없으면(이 기기에서 처음 합칠 때): 같은 학교는 계정 것, 이 기기에만 있는 슬롯은 분야나 대학을 고른 것만 덧붙인다.
 * - 슬롯 10개·편제표 20개를 넘으면 이 기기에서 덧붙인 것부터 빼고 그 이름을 dropped로 돌려준다.
 * - 기준은 이 기기 설계가 거기서 이어졌을 때만 쓴다. 이 기기 설계가 비었거나 기준과 겹치는 슬롯이 없으면(다른 탭·다른 계정이 남긴 기준)
 *   기준 없이 합친다. 안 그러면 계정 슬롯이 모두 '이 기기에서 지운 것'으로 보여 계정이 비워진다
 */
export function mergeStates(remote: Remote, local: LocalState, base: Snap | null): { state: LocalState; dropped: string[] } {
  const related = !!base && !isBlank(local) && local.slots.some((s) => base.slots.some(([id]) => id === s.id))
  const known =
    base && related ? { slots: new Map(base.slots), schools: new Map(base.schools), picks: base.picks, profile: base.profile, active: base.active } : null

  // ---- 편제표: 둘 다 바뀌었으면 이 기기 것 (기준이 없으면 계정 것) ----
  const localSchools = new Map(local.schools.map((s) => [s.id, s]))
  const remoteSchoolIds = new Set(remote.schools.map((s) => s.id))
  const schools: School[] = []
  for (const r of remote.schools) {
    const l = localSchools.get(r.id)
    const b = known?.schools.get(r.id)
    if (l) schools.push(pick3(r, l, b, schoolHash, (rs, ls) => (known ? ls : rs)))
    else if (b === undefined || b !== schoolHash(r)) schools.push(r)
  }
  for (const l of local.schools) {
    if (remoteSchoolIds.has(l.id)) continue
    const b = known?.schools.get(l.id)
    if (b !== undefined && b === schoolHash(l)) continue
    schools.push(l)
  }

  // ---- 슬롯 ----
  const localSlots = new Map(local.slots.map((s) => [s.id, s]))
  const remoteSlotIds = new Set(remote.slots.map((s) => s.id))
  const slots: Slot[] = []
  for (const r of remote.slots) {
    const l = localSlots.get(r.id)
    const b = known?.slots.get(r.id)
    if (l) slots.push(pick3(r, l, b, slotHash, (rs, ls) => (ls.at > rs.at ? ls : rs)))
    else if (b === undefined || b !== slotHash(r)) slots.push(r)
  }
  const names = new Set(slots.map((s) => s.name))
  for (const l of local.slots) {
    if (remoteSlotIds.has(l.id)) continue
    const b = known?.slots.get(l.id)
    if (known ? b !== undefined && b === slotHash(l) : !(l.majors.length || l.univs.length)) continue
    slots.push(names.has(l.name) ? { ...l, name: cleanSlotName(`${l.name} (이 기기)`) } : l)
  }

  // ---- 열 슬롯: 이 기기에서 다른 슬롯으로 바꾸지 않았으면 계정에서 보던 것 ----
  const lp = local.prefs
  const rp = remote.prefs
  const fromRemote = known ? known.active === lp.slot : !remote.empty
  let src = fromRemote ? rp : lp
  if (known && !slots.some((s) => s.id === src.slot)) {
    const other = fromRemote ? lp : rp
    if (slots.some((s) => s.id === other.slot)) src = other
  }

  // ---- 원서 후보·내 조건 ----
  let picks: string[]
  let profile: Profile
  if (known) {
    picks =
      picksHash(lp.picks) === known.picks
        ? rp.picks
        : picksHash(rp.picks) === known.picks
          ? lp.picks
          : [...new Set([...rp.picks, ...lp.picks])].slice(0, MAX_PICKS)
    profile = profileHash(lp.profile) === known.profile ? rp.profile : lp.profile
  } else {
    // 원서 후보는 계정에 없을 때만 이 기기 것 (로그인 전에 담은 것)
    picks = rp.picks.length ? rp.picks : lp.picks
    profile = remote.empty ? lp.profile : rp.profile
  }

  const schoolIds = new Set(schools.map((s) => s.id))
  const open = slots.find((s) => s.id === src.slot)
  const design = open ? designOf(open) : designOf(src)
  const prefs: Prefs = {
    ...design,
    // 그 슬롯의 학교가 없어졌으면 학교부터 다시 고르게 한다
    schoolId: schoolIds.has(design.schoolId) ? design.schoolId : '',
    // 특별 자격은 계정에 없으니 늘 이 기기 것
    profile: { ...profile, special: lp.profile.special },
    picks,
    slot: src.slot,
    at: open?.at ?? src.at ?? '',
  }
  const w = withSlots(prefs, slots)
  const dropped = [...w.dropped]
  let outSlots = w.slots
  if (outSlots.length > MAX_SLOTS) {
    const keep = new Set([w.prefs.slot])
    for (const s of outSlots) if (keep.size < MAX_SLOTS) keep.add(s.id)
    dropped.push(...outSlots.filter((s) => !keep.has(s.id)).map((s) => s.name))
    outSlots = outSlots.filter((s) => keep.has(s.id))
  }
  if (schools.length > MAX_SCHOOLS) {
    const inUse = new Set(outSlots.map((s) => s.schoolId))
    while (schools.length > MAX_SCHOOLS) {
      const i = schools.findLastIndex((s) => !inUse.has(s.id))
      const [gone] = schools.splice(i < 0 ? schools.length - 1 : i, 1)
      dropped.push(`${gone.name} 편제표`)
    }
  }
  return { state: { prefs: w.prefs, schools, slots: outSlots }, dropped }
}

/** 계정 설계(raw)와 이 기기 것을 합친다. raw 모양이 틀리면 null */
export function mergeSaved(raw: unknown, local: LocalState, base: Snap | null = null): (LocalState & { dropped: string[] }) | null {
  const remote = restoreSaved(raw)
  if (!remote) return null
  const { state, dropped } = mergeStates(remote, local, base)
  return { ...state, dropped }
}

/** AccountSync용 합치기. 계정 설계가 없거나 모양이 틀리면 이 기기 것 그대로 */
function mergeForSync(raw: unknown, local: LocalState, base: Snap | null): { state: LocalState; remote: LocalState | null; dropped: string[] } {
  const remote = restoreSaved(raw)
  if (!remote) return { state: local, remote: null, dropped: [] }
  const { state, dropped } = mergeStates(remote, local, base)
  return { state, remote, dropped }
}

/** 다른 탭 상태와 견주는 키 (특별 자격 포함) */
const stateKey = (s: LocalState) => JSON.stringify([payloadOf(s), s.prefs.profile.special])

function blankState(): LocalState {
  const { prefs, slots } = withSlots(EMPTY, [])
  return { prefs, schools: [], slots }
}

/** localStorage에서 되살린다: 편제표 → 설계(예전 판 키도 봄) → 슬롯 순 */
function readLocal(): LocalState & { owner: number | null; dropped: string[] } {
  const schools = restoreSchools(read(SCHOOLS_KEY))
  const ids = new Set(schools.map((s) => s.id))
  const saved = read(PREFS_KEY) ?? OLD_PREFS_KEYS.map(read).find(Boolean) ?? null
  const { prefs, slots, dropped } = withSlots(restorePrefs(saved, ids), restoreSlots(read(SLOTS_KEY), ids))
  return { schools, prefs, slots, dropped, owner: readOwner() }
}

const quoteList = (names: string[]) => names.map((n) => `'${n}'`).join(', ')

/** 슬롯·편제표가 넘쳐 뺀 것 알림 */
const droppedText = (names: string[]) =>
  `자리가 모자라 ${quoteList(names)}${josa(names[names.length - 1], '을', '를')} 뺐어요. 슬롯은 ${MAX_SLOTS}개, 편제표는 ${MAX_SCHOOLS}개까지예요.`

// ---- 공유 링크 ----

const SHARE_KEY = 'gwamok-navi:share'
/** 공유 코드의 메모리 사본 (sessionStorage를 못 쓸 때 대비) */
let heldShare: string | null = null

/** 주소의 공유 코드를 sessionStorage에 맡기고 주소에서 지운다 (Google 로그인을 다녀와도 이 탭에 남게). 맡았으면 true */
function holdShare(): boolean {
  const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)$/)
  if (!m) return false
  heldShare = m[1]
  try {
    sessionStorage.setItem(SHARE_KEY, m[1])
  } catch {
    // sessionStorage를 못 쓰면 heldShare만
  }
  history.replaceState(null, '', location.pathname + location.search)
  return true
}

/** 맡긴 공유 코드를 꺼낸다. 꺼내면 지운다 */
function takeShare(): string | null {
  let code = heldShare
  heldShare = null
  try {
    code ??= sessionStorage.getItem(SHARE_KEY)
    sessionStorage.removeItem(SHARE_KEY)
  } catch {
    // sessionStorage를 못 쓰면 heldShare만
  }
  return code && /^[A-Za-z0-9_-]+$/.test(code) ? code : null
}

export interface StoreOptions {
  /** 공유받은 설계를 연 뒤 (설계 화면으로 옮긴다) */
  onShared?: () => void
  /** 알림. action으로 되돌리기 같은 버튼을 붙인다 */
  onNotice?: (text: string, action?: ToastAction) => void
  /** 로그인한 계정 (없으면 이 기기에만 저장) */
  userId?: number | null
  /** 로그인 확인을 마쳤는지. 공유 링크는 그 뒤에 연다 (로그인했으면 계정 설계를 합친 뒤) */
  ready?: boolean
}

export function useAppState(options: StoreOptions = {}) {
  const userId = options.userId ?? null
  const ready = options.ready ?? true
  const opts = useRef(options)
  useEffect(() => {
    opts.current = options
  })
  const notice = useCallback((text: string, action?: ToastAction) => opts.current.onNotice?.(text, action), [])

  const [initial] = useState(() => {
    holdShare()
    return readLocal()
  })
  const [schools, setSchools] = useState<School[]>(initial.schools)
  const [prefs, setPrefsRaw] = useState<Prefs>(initial.prefs)
  // 저장된 슬롯. 지금 슬롯 내용은 매번 쓰지 않고 prefs에서 읽으며, 다른 슬롯으로 바꿀 때 써 넣는다
  const [stored, setSlots] = useState<Slot[]>(initial.slots)
  /** 지금 설계의 주인 계정. 로그인 없이 만들었으면 null */
  const [owner, setOwner] = useState<number | null>(initial.owner)
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null)
  /** 직전 렌더의 로그인 계정. 로그인이 확인된 순간을 잡으려고 */
  const [lastUser, setLastUser] = useState<number | null>(null)

  // 로그인이 확인되면 그리기 전에 저장소를 다시 읽는다 (그사이 다른 탭이 바꿨을 수 있다).
  // 이 계정 설계가 아니면(다른 계정이 남긴 것, 로그인 없이 만든 것) 보이기 전에 비운다
  if (userId !== lastUser) {
    setLastUser(userId)
    if (userId !== null) {
      const fresh = readLocal()
      const next = fresh.owner === userId ? fresh : blankState()
      setOwner(userId)
      setSchools(next.schools)
      setPrefsRaw(next.prefs)
      setSlots(next.slots)
    }
  }

  /** 설계가 바뀌면 at도 새로 적는다. 다른 슬롯을 열 때는 그 슬롯의 at 그대로 */
  const setPrefs = useCallback(
    (next: Prefs | ((p: Prefs) => Prefs)) =>
      setPrefsRaw((p) => {
        const n = typeof next === 'function' ? next(p) : next
        return n !== p && n.slot === p.slot && !sameDesign(n, p) ? { ...n, at: now() } : n
      }),
    [],
  )

  const slots = useMemo(() => (stored.some((s) => s.id === prefs.slot && !sameDesign(s, prefs)) ? withDesign(stored, prefs) : stored), [stored, prefs])
  const latest = useRef<LocalState>({ prefs, schools, slots })
  /** 계정·다른 탭에서 받아 넣고 아직 그리기 전인 상태. 그사이 저장하면 이것을 올린다 */
  const pending = useRef<LocalState | null>(null)
  useEffect(() => {
    latest.current = { prefs, schools, slots }
    pending.current = null
  })
  const current = useCallback(() => pending.current ?? latest.current, [])
  const apply = useCallback((next: LocalState) => {
    pending.current = next
    setSchools(next.schools)
    setPrefsRaw(next.prefs)
    setSlots(next.slots)
  }, [])

  // ---- 이 기기 저장소 ----
  const written = useRef(new Map<string, string | null>())
  const persist = useCallback((key: string, value: unknown) => {
    const json = value === null ? null : JSON.stringify(value)
    if (written.current.get(key) === json) return
    written.current.set(key, json)
    try {
      if (json === null) localStorage.removeItem(key)
      else localStorage.setItem(key, json)
    } catch {
      // 저장소를 못 써도 화면은 동작한다
    }
  }, [])
  // 주인을 먼저 적는다: 다른 탭이 설계보다 주인 변경을 먼저 보게
  useEffect(() => persist(OWNER_KEY, owner), [owner, persist])
  useEffect(() => persist(PREFS_KEY, prefs), [prefs, persist])
  useEffect(() => persist(SCHOOLS_KEY, schools), [schools, persist])
  useEffect(() => persist(SLOTS_KEY, slots), [slots, persist])
  useEffect(() => {
    // 새 키에 옮겨 적었으면 예전 판 키는 지운다
    try {
      if (localStorage.getItem(PREFS_KEY) !== null) for (const k of OLD_PREFS_KEYS) localStorage.removeItem(k)
    } catch {
      // 저장소를 못 쓰면 그대로 둔다
    }
    if (initial.dropped.length) notice(droppedText(initial.dropped))
  }, [initial, notice])

  // ---- 계정 저장 ----
  const syncer = useRef<AccountSync<LocalState, Snap> | null>(null)
  const adopting = useRef(false)
  useEffect(() => {
    if (userId === null || owner !== userId) return
    const s = new AccountSync<LocalState, Snap>({
      owner: userId,
      read: current,
      apply,
      payload: payloadOf,
      snapshot: (state, rev, hash) => snapshotOf(state, userId, rev, hash),
      merge: mergeForSync,
      loadBase: readSnap,
      saveBase: (b) => persist(SYNC_KEY, b),
      report: setSyncInfo,
      dropped: (names) => notice(droppedText(names)),
      // 다른 탭에서 계정이 바뀌면 새로 고쳐 지금 계정을 다시 확인한다
      accountChanged: () => location.reload(),
    })
    syncer.current = s
    s.start()
    return () => {
      s.stop()
      if (syncer.current === s) syncer.current = null
    }
  }, [userId, owner, current, apply, persist, notice])

  // 바뀐 설계를 계정에도 올린다 (잠깐 모았다가 한 번에)
  useEffect(() => {
    const fromOtherTab = adopting.current
    adopting.current = false
    syncer.current?.changed(fromOtherTab)
  }, [prefs, schools, slots])

  // ---- 다른 탭 ----
  const userRef = useRef(userId)
  const readyRef = useRef(ready)
  useEffect(() => {
    userRef.current = userId
    readyRef.current = ready
  })
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const adopt = () => {
      const me = userRef.current
      const storedOwner = readOwner()
      if (me !== null) {
        if (storedOwner !== me) {
          // 이 탭이 아직 주인을 적기 전: 곧 적으니 넘어간다
          if (written.current.get(OWNER_KEY) !== JSON.stringify(me)) return
          // 다른 탭에서 로그아웃·계정 전환: 이 탭 설계가 다른 계정에 올라가지 않게 새로 고친다
          syncer.current?.stop()
          location.reload()
          return
        }
      } else if (!readyRef.current || storedOwner !== null) return
      syncer.current?.adoptBase(readSnap())
      const next = readLocal()
      if (stateKey(next) === stateKey(current())) return
      adopting.current = true
      apply(next)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && !STORE_KEYS.has(e.key)) return
      // 한 번 고칠 때 여러 키를 쓰므로 다 쓴 뒤에 읽는다
      clearTimeout(timer)
      timer = setTimeout(adopt, 50)
    }
    window.addEventListener('storage', onStorage)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('storage', onStorage)
    }
  }, [apply, current])

  const school = useMemo(() => schools.find((s) => s.id === prefs.schoolId) ?? null, [schools, prefs.schoolId])

  const toggleMajor = useCallback(
    (id: string) =>
      setPrefs((p) =>
        p.majors.includes(id)
          ? { ...p, majors: p.majors.filter((m) => m !== id), unitIds: null }
          : p.majors.length >= MAX_MAJORS
            ? p
            : { ...p, majors: [...p.majors, id], unitIds: null },
      ),
    [setPrefs],
  )

  const setUnits = useCallback((unitIds: string[] | null) => setPrefs((p) => ({ ...p, unitIds: unitIds ? unitIds.slice(0, MAX_UNITS) : null })), [setPrefs])

  /** 분야(계열 묶음·세부 학과)를 통째로 바꾼다. 모집단위 선택은 다시 '전체'로 */
  const setMajors = useCallback((ids: string[]) => setPrefs((p) => ({ ...p, majors: upgradeMajors(ids).slice(0, MAX_MAJORS), unitIds: null })), [setPrefs])

  /** 모집단위 선택은 다시 '전체'로 */
  const setUnivs = useCallback((univs: string[]) => setPrefs((p) => ({ ...p, univs: [...new Set(univs)].slice(0, MAX_UNIVS), unitIds: null })), [setPrefs])

  const toggleUniv = useCallback(
    (id: string) =>
      setPrefs((p) => ({
        ...p,
        univs: p.univs.includes(id) ? p.univs.filter((u) => u !== id) : [...p.univs, id].slice(0, MAX_UNIVS),
        unitIds: null,
      })),
    [setPrefs],
  )

  const setSchool = useCallback((schoolId: string) => setPrefs((p) => (p.schoolId === schoolId ? p : { ...p, schoolId, pinned: [], excluded: [] })), [setPrefs])

  /** 꼭 듣기·풀기. 두 학기 세트 과목은 세트째 바꾸고, 함께 바뀐 것을 돌려준다 (알림용) */
  const togglePin = useCallback(
    (subject: string): ChoiceChange => {
      const { prefs: p, schools: list } = current()
      const school = list.find((s) => s.id === p.schoolId)
      const state = { pinned: p.pinned, excluded: p.excluded }
      const r = p.pinned.includes(subject) ? unpinChoice(state, subject) : pinChoice(school, state, subject)
      if (!r.refused) setPrefs({ ...p, pinned: r.pinned, excluded: r.excluded })
      return r
    },
    [current, setPrefs],
  )

  /** 빼기·다시 넣기. 세트 과목은 세트째. 남은 세트까지 빼면 앞서 뺀 세트를 다시 넣는다 */
  const toggleExclude = useCallback(
    (subject: string): ChoiceChange => {
      const { prefs: p, schools: list } = current()
      const school = list.find((s) => s.id === p.schoolId)
      const state = { pinned: p.pinned, excluded: p.excluded }
      const r = p.excluded.includes(subject) ? includeChoice(school, state, subject) : excludeChoice(school, state, subject)
      if (!r.refused) setPrefs({ ...p, pinned: r.pinned, excluded: r.excluded })
      return r
    },
    [current, setPrefs],
  )

  /** 꼭 듣기·빼기를 통째로 바꾼다 (저장된 선택 고치기). 그사이 슬롯을 바꿨거나 선택이 바뀌었으면 그대로 둔다 */
  const replaceChoices = useCallback(
    (from: ChoiceState, to: ChoiceState) =>
      setPrefs((p) => (p.pinned === from.pinned && p.excluded === from.excluded ? { ...p, pinned: to.pinned, excluded: to.excluded } : p)),
    [setPrefs],
  )

  /** 학교 편제표를 저장하고 그 학교로 바꾼다 */
  const saveSchool = useCallback(
    (raw: School) => {
      // 계정에서 받은 것과 같은 모양으로 정리한다 (해시로 다른 기기의 변경을 가리려고)
      const s = normalizeSchool(raw)
      const { prefs: p, slots: list } = current()
      const inUse = new Set([p.schoolId, ...list.map((x) => x.schoolId)])
      setSchools((cur) => withSchool(cur, s, inUse))
      setPrefs((q) => ({ ...q, schoolId: s.id, pinned: q.schoolId === s.id ? q.pinned : [], excluded: q.schoolId === s.id ? q.excluded : [] }))
    },
    [current, setPrefs],
  )

  const deleteSchool = useCallback(
    (id: string) => {
      setSchools((list) => list.filter((x) => x.id !== id))
      setPrefs((p) => (p.schoolId === id ? { ...p, schoolId: '', pinned: [], excluded: [] } : p))
    },
    [setPrefs],
  )

  const setProfile = useCallback((patch: Partial<Profile>) => setPrefs((p) => ({ ...p, profile: { ...p.profile, ...patch } })), [setPrefs])

  /** 원서 후보 담기·빼기. MAX_PICKS면 더 담지 않는다 */
  const togglePick = useCallback(
    (key: string) =>
      setPrefs((p) =>
        p.picks.includes(key) ? { ...p, picks: p.picks.filter((k) => k !== key) } : p.picks.length >= MAX_PICKS ? p : { ...p, picks: [...p.picks, key] },
      ),
    [setPrefs],
  )

  const setFocus = useCallback((focus: Focus) => setPrefs((p) => ({ ...p, focus })), [setPrefs])
  const setKeepAll = useCallback((keepAll: boolean) => setPrefs((p) => ({ ...p, keepAll })), [setPrefs])

  const removePicks = useCallback((keys: string[]) => setPrefs((p) => ({ ...p, picks: p.picks.filter((k) => !keys.includes(k)) })), [setPrefs])

  /** 로그아웃·탈퇴 때 이 기기 설계를 모두 지운다 (공용 컴퓨터 대비, 계정에는 남는다) */
  const clearLocal = useCallback(() => {
    syncer.current?.stop()
    syncer.current = null
    persist(SYNC_KEY, null)
    const fresh = blankState()
    apply(fresh)
    setOwner(null)
    setSyncInfo(null)
  }, [apply, persist])

  /**
   * 쓰는 중 세션이 끝났을 때 (만료·정지·다른 기기에서 탈퇴). 계정에 다 올라갔으면 이 기기 설계를 모두 지운다.
   * 못 올린 변경이 있으면 같은 계정으로 다시 로그인할 때 올리게 남기고 특별 자격만 지운다. 다른 계정이 로그인하면 그 전에 비운다
   */
  const sessionLost = useCallback(() => {
    const s = syncer.current
    const state = current()
    const base = readSnap()
    const clean = s ? s.isClean() : !!base && base.owner === owner && hashText(JSON.stringify(payloadOf(state))) === base.hash
    s?.stop()
    syncer.current = null
    setSyncInfo(null)
    if (clean || isBlank(state)) return clearLocal()
    setPrefsRaw((p) => ({ ...p, profile: { ...p.profile, special: [] } }))
  }, [clearLocal, current, owner])

  /** 계정 저장 바로 다시 시도 */
  const retrySync = useCallback(() => syncer.current?.kick(), [])

  /** 로그아웃 전에 밀린 계정 저장을 끝낸다. 못 올린 변경이 남으면 false */
  const flushSync = useCallback(async () => {
    const s = syncer.current
    if (!s) return true
    return (await s.finish()) || isBlank(current())
  }, [current])

  /** 다른 슬롯으로 바꾼다. 떠나는 슬롯에 지금 설계를 먼저 써 넣는다 */
  const switchSlot = useCallback(
    (id: string) => {
      const { prefs: p, slots: list, schools: known } = current()
      const target = list.find((s) => s.id === id)
      if (!target || id === p.slot) return
      setSlots((cur) => synced(cur, p))
      setPrefs(openSlot(p, target, known))
    },
    [current, setPrefs],
  )

  /** 새 슬롯을 만들어 연다. from이 있으면 그 슬롯 복사, 없으면 학교만 둔 빈 슬롯. 가득 찼으면 null */
  const addSlot = useCallback(
    (from?: string): Slot | null => {
      const { prefs: p, slots: list, schools: known } = current()
      if (list.length >= MAX_SLOTS) return null
      const source = from ? list.find((s) => s.id === from) : undefined
      if (from && !source) return null
      // 지금 슬롯은 prefs에서 복사한다 (슬롯에 아직 안 들어간 변경까지)
      const design = source ? designOf(source.id === p.slot ? p : source) : { ...EMPTY_DESIGN, schoolId: p.schoolId }
      const slot: Slot = {
        id: newSlotId(),
        name: source ? unusedSlotName(list, `${source.name} 복사`) : unusedSlotName(list),
        at: now(),
        ...design,
      }
      setSlots((cur) => {
        const base = synced(cur, p)
        // 복사본은 원본 바로 뒤에, 빈 슬롯은 맨 뒤에
        const i = source ? base.findIndex((s) => s.id === source.id) + 1 : 0
        const at = i > 0 ? i : base.length
        return [...base.slice(0, at), slot, ...base.slice(at)]
      })
      setPrefs(openSlot(p, slot, known))
      return slot
    },
    [current, setPrefs],
  )

  const renameSlot = useCallback((id: string, name: string) => {
    const clean = cleanSlotName(name)
    if (clean) setSlots((list) => list.map((s) => (s.id === id ? { ...s, name: clean, at: now() } : s)))
  }, [])

  /** 마지막 하나는 지우지 않는다 (비우려면 초기화). 지금 슬롯을 지우면 옆 슬롯을 연다 */
  const deleteSlot = useCallback(
    (id: string) => {
      const { prefs: p, slots: list, schools: known } = current()
      const i = list.findIndex((s) => s.id === id)
      if (i < 0 || list.length <= 1) return
      const rest = list.filter((s) => s.id !== id)
      setSlots((cur) => synced(cur, p).filter((s) => s.id !== id))
      if (id === p.slot) setPrefs(openSlot(p, rest[Math.min(i, rest.length - 1)], known))
    },
    [current, setPrefs],
  )

  /** 지금 슬롯 초기화. subjects는 꼭 듣기·빼기만, all은 학교만 남기고 모두 비운다. 되돌리기용으로 원래 설계를 돌려준다 */
  const resetDesign = useCallback(
    (what: 'subjects' | 'all'): { slot: string; design: Design } => {
      const p = current().prefs
      setPrefs({ ...p, ...(what === 'all' ? { ...EMPTY_DESIGN, schoolId: p.schoolId } : { pinned: [], excluded: [] }) })
      return { slot: p.slot, design: designOf(p) }
    },
    [current, setPrefs],
  )

  /** 초기화 되돌리기. 그사이 다른 슬롯을 열었으면 원래 슬롯에 넣는다 */
  const restoreDesign = useCallback(
    ({ slot, design }: { slot: string; design: Design }) => {
      const p = current().prefs
      if (p.slot === slot) setPrefs({ ...p, ...design })
      else setSlots((list) => list.map((s) => (s.id === slot ? { ...s, ...design, at: now() } : s)))
    },
    [current, setPrefs],
  )

  // ---- 공유 링크: 로그인 확인(로그인했으면 계정 설계 합치기)을 마친 뒤 새 슬롯으로 연다 ----
  const openShared = useCallback(
    (state: ShareState | null) => {
      if (!state) return notice('공유 링크를 열지 못했어요.')
      const { prefs: p, slots: list, schools: known } = current()
      const placed = placeShared(state.school, known, new Set([p.schoolId, ...list.map((s) => s.schoolId)]))
      // 목표 전형은 링크에 없어 내 것을 쓴다
      const design: Design = {
        ...designOf(p),
        schoolId: placed.school.id,
        majors: state.majors.slice(0, MAX_MAJORS),
        univs: state.univs.slice(0, MAX_UNIVS),
        unitIds: state.units.length ? state.units : null,
        pinned: state.pinned,
        excluded: state.excluded,
      }
      if (list.length < MAX_SLOTS) {
        const slot: Slot = { id: newSlotId(), name: unusedSlotName(list, '공유받은 설계'), at: now(), ...design }
        setSchools(placed.schools)
        setSlots((cur) => [...synced(cur, p), slot])
        setPrefsRaw({ ...p, ...design, slot: slot.id, at: slot.at })
        notice('공유받은 설계를 새 슬롯에 열었어요.')
      } else {
        // 가득 찼으면 지금 슬롯을 덮어쓸지 묻는다 (되돌리기 가능)
        const name = list.find((s) => s.id === p.slot)?.name ?? '지금 슬롯'
        if (!confirm(`슬롯이 ${MAX_SLOTS}개라 새 슬롯을 만들 수 없어요. ${name}${josa(name, '을', '를')} 공유받은 설계로 바꿀까요?`)) {
          notice('공유받은 설계를 열지 않았어요. 슬롯을 하나 지우고 링크를 다시 열어 주세요.')
          return
        }
        const before = { slot: p.slot, design: designOf(p) }
        setSchools(placed.schools)
        setPrefs({ ...p, ...design })
        notice(`${name}에 공유받은 설계를 열었어요.`, { label: '되돌리기', run: () => restoreDesign(before) })
      }
      opts.current.onShared?.()
    },
    [current, notice, setPrefs, restoreDesign],
  )

  // 열린 탭에 공유 링크를 붙여 넣으면 # 뒤만 바뀌어 hashchange만 온다
  const [shareTick, setShareTick] = useState(0)
  useEffect(() => {
    const onHash = () => {
      if (holdShare()) setShareTick((n) => n + 1)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const info = syncInfo && syncInfo.owner === userId ? syncInfo : null
  const shareReady = ready && (userId === null || (owner === userId && !!info && info.state !== 'loading'))
  useEffect(() => {
    if (!shareReady) return
    const code = takeShare()
    if (!code) return
    // 코드는 한 번만 꺼내므로 effect가 다시 돌아도(StrictMode) 받은 설계는 끝까지 연다
    void decodeShare(code).then(openShared)
  }, [shareReady, shareTick, openShared])

  const shareUrl = useCallback(
    async (units: string[]) => {
      if (!school) return location.origin
      const code = await encodeShare({
        majors: prefs.majors,
        univs: prefs.univs,
        units,
        school,
        pinned: prefs.pinned,
        excluded: prefs.excluded,
      })
      return `${location.origin}/plan#s=${code}`
    },
    [prefs, school],
  )

  // 이 기기에서 이 계정 설계를 처음 받는 중이면 화면을 잠깐 막는다 (받기 전에 고친 것이 섞이지 않게)
  const known = useMemo(() => userId !== null && readSnap()?.owner === userId, [userId])
  const sync: SyncState = userId === null ? 'off' : (info?.state ?? 'loading')

  return {
    prefs,
    school,
    schools,
    toggleMajor,
    setMajors,
    setUnits,
    setUnivs,
    toggleUniv,
    setSchool,
    togglePin,
    toggleExclude,
    replaceChoices,
    saveSchool,
    deleteSchool,
    shareUrl,
    sync,
    /** 계정에 마지막으로 저장된 때 */
    savedAt: info?.savedAt ?? null,
    /** 서버가 저장을 거절한 까닭 (sync가 rejected일 때) */
    syncMessage: info?.message ?? '',
    /** 연속 실패 횟수 */
    syncFailures: info?.failures ?? 0,
    holding: userId !== null && sync === 'loading' && !known,
    retrySync,
    flushSync,
    sessionLost,
    clearLocal,
    setProfile,
    togglePick,
    removePicks,
    setFocus,
    setKeepAll,
    slots,
    switchSlot,
    addSlot,
    renameSlot,
    deleteSlot,
    resetDesign,
    restoreDesign,
  }
}

export type AppStore = ReturnType<typeof useAppState>
