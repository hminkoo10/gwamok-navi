import type { Clause, Group, School, TermId, Track, Unit } from '../data/schema'
import { TERMS } from '../data/schema'
import { SUBJECTS, SUBJECT_BY_NAME } from '../data/subjects'

// 학교 편제표의 선택 칸(택N) 안에서, 고른 모집단위들의 권장과목을 최대한 많이 채우는 조합을 찾는다 (분기 한정 탐색으로 최적해).
// 점수 = 모집단위 조건마다 채운 과목 수(조건이 요구하는 개수까지만 셈) × 가중치의 합. 핵심과목 조건은 권장과목 조건보다 무겁다.
// 위계상 앞 과목(예: 물리학 → 역학과 에너지)을 빼먹으면 조금 깎는다.
// 점수가 같은 조합이 여럿이면 진로 관련도가 높은 과목을 고른다 ('과학 진로선택 3과목'을 컴퓨터공학이면 물리 쪽으로).
// 학생이 고정한 과목은 아주 큰 점수를 줘서 먼저 자리를 잡게 하고, 제외한 과목은 후보에서 뺀다.
// 두 학기 세트는 고를 만한 세트 조합마다 따로 찾는다. 조합마다 탐색 상한이 따로 있고, 점수를 많이 얻을 만한 조합부터 본다
// (한 조합이 상한을 다 써서 다른 조합을 못 보는 일이 없게).

const ORDER_PENALTY = 0.4
/** 꼭 듣기는 권장과목을 아무리 많이 채우는 과목보다도 먼저 자리를 잡는다 (학과를 수백 곳 골라도 넘지 않을 만큼 크다) */
const PIN_WEIGHT = 10_000
/** 꼭 듣기 과목을 학생이 고른 칸에 넣으면 더 얹는 몫. 꼭 듣기 하나보다 훨씬 작고, 권장과목 조건 몇 개보다는 크다 */
const PREFER_WEIGHT = 100
const CORE_WEIGHT = 1.5
/** 관련도로 동점을 가르는 몫. 과목을 다 더해도 조건 하나(1)나 위계 감점(0.4)을 넘지 않을 만큼 작다 */
const TIE = 0.004
/** 세트 조합 하나에서 쓰는 탐색 노드 상한. 넘으면 그 조합에서 그때까지 찾은 가장 좋은 배치를 쓴다 */
const SEARCH_BUDGET = 400_000
/** 모든 세트 조합을 합친 탐색 노드 상한 */
const TOTAL_BUDGET = 1_200_000
/** 세트 조합이 이보다 많으면(세트 묶음이 아주 많은 편제표) 점수를 많이 얻을 만한 조합부터 이만큼만 본다 */
const MAX_COMBOS = 128
/** 탐색이 이만큼 길어지면 그때부터 자리 수까지 따지는 상한을 쓴다 (짧게 끝나는 탐색은 간단한 상한이 더 빠르다) */
const TIGHT_AFTER = 1024
const EPS = 1e-9

export type Slot =
  | { kind: 'fixed'; term: TermId; alt?: string }
  | { kind: 'group'; term: TermId; groupId: string }
  | { kind: 'track'; term: TermId; trackId: string; setIndex: number }

export interface Placement {
  subject: string
  slot: Slot
}

export type MissingReason = 'not-offered' | 'no-slot' | 'excluded'

/**
 * no-slot의 까닭 (알 수 있을 때만): pinned = 들을 수 있는 칸을 꼭 듣기 과목이 차지함,
 * other-set = 세트로만 듣는 과목인데 같은 묶음에서 이 과목이 없는 세트를 고름
 */
export type MissingCause = 'pinned' | 'other-set'

export interface Missing {
  subject: string
  reason: MissingReason
  cause?: MissingCause
  /** cause가 pinned면 그 칸을 차지한 꼭 듣기 과목, other-set이면 대신 고른 세트 이름 */
  by?: string[]
}

export interface ClauseResult {
  clause: Clause
  need: number
  candidates: string[]
  met: Placement[]
  missing: Missing[]
  ok: boolean
}

export interface UnitResult {
  unit: Unit
  clauses: ClauseResult[]
  got: number
  need: number
  ok: boolean
}

export interface GroupPlan {
  term: TermId
  group: Group
  chosen: string[]
  free: number
}

export interface TrackPlan {
  track: Track
  setIndex: number | null
}

export interface OrderWarning {
  subject: string
  before: string
  kind: 'missing' | 'late' | 'not-offered'
  /** kind가 missing일 때 까닭 (알 수 있을 때만): excluded-prereq = 학생이 앞 과목을 뺌, pinned·other-set은 Missing.cause와 같다 */
  cause?: 'excluded-prereq' | MissingCause
  /** cause가 pinned·other-set일 때 Missing.by와 같다 */
  by?: string[]
}

export interface PlanOptions {
  pinned?: Iterable<string>
  excluded?: Iterable<string>
  /** 과목별 진로 관련도 (0~1). 점수가 같은 조합 가운데 고를 때만 쓴다 */
  relevance?: Map<string, number>
  /** 꼭 듣기 과목을 넣고 싶은 선택 칸 (과목 → 선택 칸 id). 되도록 그 칸에 넣고, 자리가 없으면 다른 칸에 넣는다 */
  pinGroups?: Readonly<Record<string, string>>
}

export interface Plan {
  school: School
  taken: Map<string, Slot>
  groups: GroupPlan[]
  tracks: TrackPlan[]
  units: UnitResult[]
  warnings: OrderWarning[]
  /** 채우지 못한 조건에 걸린 과목 가운데 학교 편제표에 없는 과목 */
  notOffered: string[]
  /** 고른 모집단위 수 기준으로 많이 요구된 순서 */
  wanted: { subject: string; units: string[] }[]
  pinned: Set<string>
  excluded: Set<string>
  /** 고정했지만 칸이 모자라거나 학교에 없어서 못 넣은 과목 */
  unplacedPins: string[]
  /** 탐색 기록. complete가 false면 상한에 걸려 그때까지 찾은 가장 좋은 배치를 쓴 것이다 */
  search?: { nodes: number; combos: number; complete: boolean }
}

// ---------------------------------------------------------------------------

/** 'area:제2외국어' 같은 표기를 실제 과목명으로 펼친다 */
/** 과목 계열 묶음: 일반선택 과목과 그 뒤를 잇는 진로선택 과목 */
export const FAMILY: Record<string, string[]> = {
  물리: ['물리학', '역학과 에너지', '전자기와 양자'],
  화학: ['화학', '물질과 에너지', '화학 반응의 세계'],
  생명: ['생명과학', '세포와 물질대사', '생물의 유전'],
  지구: ['지구과학', '지구시스템과학', '행성우주과학'],
}

/**
 * 조건에 적힌 과목·묶음 표기를 과목 이름으로 푼다.
 * area:수학 = 공통과목을 뺀 수학 과목 전체, career:과학 = 과학 진로선택, general:과학 = 과학 일반선택, family:물리 = 물리 계열
 */
export function resolveSubjects(names: string[]): string[] {
  const out: string[] = []
  for (const n of names) {
    const m = n.match(/^(area|career|general|family):(.+)$/)
    if (!m) {
      out.push(n)
      continue
    }
    const [, kind, what] = m
    if (kind === 'family') {
      out.push(...(FAMILY[what] ?? []))
      continue
    }
    for (const s of SUBJECTS) {
      if (s.area !== what) continue
      if (kind === 'area' ? s.kind !== '공통' && s.kind !== '기타' : s.kind === (kind === 'career' ? '진로선택' : '일반선택')) out.push(s.name)
    }
  }
  return [...new Set(out)]
}

export function needOf(clause: Clause): number {
  return clause.pick === 'all' ? resolveSubjects(clause.subjects).length : clause.pick
}

/** 과목 → 학교에서 들을 수 있는 자리 목록 */
export function offerIndex(school: School): Map<string, Slot[]> {
  const idx = new Map<string, Slot[]>()
  const add = (subject: string, slot: Slot) => {
    const list = idx.get(subject)
    if (list) list.push(slot)
    else idx.set(subject, [slot])
  }
  for (const term of school.terms) {
    for (const f of term.fixed) {
      add(f.subject, f.alt ? { kind: 'fixed', term: term.id, alt: f.alt } : { kind: 'fixed', term: term.id })
      if (f.alt) add(f.alt, { kind: 'fixed', term: term.id, alt: f.subject })
    }
    for (const g of term.groups) for (const o of g.options) add(o, { kind: 'group', term: term.id, groupId: g.id })
  }
  for (const t of school.tracks)
    t.sets.forEach((set, setIndex) => {
      for (const it of set.items) add(it.subject, { kind: 'track', term: it.term, trackId: t.id, setIndex })
    })
  return idx
}

const termIndex = (t: TermId) => TERMS.indexOf(t)

/** 과목 → 그 과목을 앞 과목으로 두는 과목 (과목 목록 순서) */
const DEPENDENTS = new Map<string, string[]>()
for (const s of SUBJECTS) for (const b of s.after ?? []) DEPENDENTS.set(b, [...(DEPENDENTS.get(b) ?? []), s.name])

interface Need {
  cand: string[]
  need: number
  weight: number
}

function score(taken: Map<string, Slot>, needs: Need[], offered: Map<string, Slot[]>): number {
  let total = 0
  for (const n of needs) {
    let c = 0
    for (const s of n.cand) if (taken.has(s)) c++
    total += Math.min(c, n.need) * n.weight
  }
  // 위계 감점: 학교에 개설된 앞 과목을 안 듣거나 늦게 듣는 경우
  for (const [subject, slot] of taken) {
    if (slot.kind === 'fixed') continue
    for (const before of SUBJECT_BY_NAME.get(subject)?.after ?? []) {
      if (!offered.has(before)) continue
      const b = taken.get(before)
      if (!b || termIndex(b.term) >= termIndex(slot.term)) total -= ORDER_PENALTY
    }
  }
  return total
}

// ---------------------------------------------------------------------------

/** 세트 조합 하나를 고른 뒤의 탐색 상태 */
interface ComboState {
  tracks: (number | null)[]
  /** 세트 조합의 원래 순서 (점수가 같으면 앞 조합을 고른다) */
  index: number
  taken: Map<string, Slot>
  /** 선택 칸마다 남은 자리 */
  cap: number[]
  /** 조건마다 채운 과목 수 */
  count: number[]
  /** 조건마다 아직 정하지 않은 후보 수 */
  remaining: number[]
  /** 조건마다 아직 정하지 않았고 넣을 자리가 남은 후보 수 */
  openCount: number[]
  /** 후보마다 지금 넣으면 채우는 조건 가중치 합 */
  metOf: number[]
  /** 후보마다 '넓은 조건'(모자란 수가 넣을 자리가 남은 후보 수 이상이라 넣는 대로 다 세는 조건)의 가중치 합 */
  wideOf: number[]
  /** 후보마다 남은 자리가 있는 선택 칸 수 */
  openGroups: Int32Array
  /** 후보가 들어갔는지 (세트로 들어간 후보 포함)와 그 학기 번호. 상한 계산에서 Map을 찾지 않으려고 따로 둔다 */
  placed: Uint8Array
  termAt: Int8Array
  /** 후보마다 후보가 아닌 뒤 과목(세트·모두 듣는 과목)으로 풀 수 있는 위계 감점 (탐색 중에는 바뀌지 않는다) */
  fixedRecover: Float64Array
  /** 조건마다 모자란 수까지, 정하지 않은 후보 수까지 더한 점수 (간단한 상한) */
  needBound: number
  /** 같되 넣을 자리가 남은 후보 수까지 */
  openBound: number
  /** '좁은 조건'(넣을 자리가 남은 후보가 모자란 수보다 많은 조건)마다 모자란 수까지 더한 점수 */
  narrow: number
  start: number
}

interface Best {
  taken: Map<string, Slot>
  score: number
  tracks: (number | null)[]
  combo: number
}

export function makePlan(school: School, units: Unit[], options: PlanOptions = {}): Plan {
  const offered = offerIndex(school)
  const pinned = new Set(options.pinned ?? [])
  const excluded = new Set(options.excluded ?? [])
  for (const s of pinned) excluded.delete(s)

  // 같은 조건(후보 과목·필요 개수)은 하나로 합쳐 가중치를 더한다. 여러 대학이 같은 조건을 거는 경우가 많다.
  const merged = new Map<string, Need>()
  const wantedBy = new Map<string, Set<string>>()
  const addNeed = (key: string, cand: string[], need: number, weight: number) => {
    const m = merged.get(key)
    if (m) m.weight += weight
    else merged.set(key, { cand, need, weight })
  }
  for (const u of units)
    for (const c of u.clauses) {
      const cand = resolveSubjects(c.subjects)
      const need = needOf(c)
      addNeed(`${need}|${[...cand].sort().join(',')}`, cand, need, c.level === 'core' ? CORE_WEIGHT : 1)
      for (const s of cand) {
        const set = wantedBy.get(s) ?? new Set<string>()
        set.add(u.id)
        wantedBy.set(s, set)
      }
    }
  for (const s of pinned) addNeed(`pin|${s}`, [s], 1, PIN_WEIGHT)
  const needs = [...merged.values()]

  // 고정 과목은 무조건 듣는다 (집중이수 짝도 포함)
  const base = new Map<string, Slot>()
  for (const term of school.terms)
    for (const f of term.fixed) {
      base.set(f.subject, { kind: 'fixed', term: term.id })
      if (f.alt && !base.has(f.alt)) base.set(f.alt, { kind: 'fixed', term: term.id })
    }

  // 선택 칸 후보: 요구된 과목 + 고정한 과목 + 그 과목들의 앞 과목. 제외한 과목은 뺀다.
  const wanted = new Set([...wantedBy.keys(), ...pinned])
  const support = new Set<string>()
  for (const s of wanted) for (const b of SUBJECT_BY_NAME.get(s)?.after ?? []) support.add(b)
  const groups = school.terms.flatMap((t) => t.groups.map((g) => ({ term: t.id, group: g })))
  const candidates = [...new Set([...wanted, ...support])].filter(
    (s) => !base.has(s) && !excluded.has(s) && groups.some(({ group }) => group.options.includes(s)),
  )
  // 고정 과목 → 뒤 과목(위계가 있는 과목) → 나머지 순. 뒤 과목을 먼저 정해야 앞 과목에 위계 점수가 붙는다.
  const rank = (s: string) => (pinned.has(s) ? 0 : SUBJECT_BY_NAME.get(s)?.after ? 1 : 2)
  const weightOf = (s: string) => needs.reduce((a, n) => a + (n.cand.includes(s) ? n.weight : 0), 0)
  const weights = new Map(candidates.map((s) => [s, weightOf(s)]))
  const rel = (s: string) => Math.min(1, Math.max(0, options.relevance?.get(s) ?? 0))
  candidates.sort((a, b) => rank(a) - rank(b) || weights.get(b)! - weights.get(a)! || rel(b) - rel(a))
  const nc = candidates.length
  const relOf = candidates.map(rel)
  // 관련도로 더 얻을 수 있는 최대치 (가지치기 상한용)
  const relCap = new Array<number>(nc + 1).fill(0)
  for (let i = nc - 1; i >= 0; i--) relCap[i] = relCap[i + 1] + relOf[i] * TIE

  const candNeeds = candidates.map((s) => needs.flatMap((n, j) => (n.cand.includes(s) ? [j] : [])))
  const prereqs = candidates.map((s) => (SUBJECT_BY_NAME.get(s)?.after ?? []).filter((b) => offered.has(b)))
  // s를 앞 과목으로 두는 과목 (s를 넣으면 그 과목의 위계 감점이 풀릴 수 있다)
  const dependents = candidates.map((s) => DEPENDENTS.get(s) ?? [])
  // 위계 점수로 더 얻을 수 있는 최대치 (가지치기 상한용)
  const orderCap = new Array<number>(nc + 1).fill(0)
  for (let i = nc - 1; i >= 0; i--) orderCap[i] = orderCap[i + 1] + dependents[i].length * ORDER_PENALTY

  // 선택 칸은 번호로 다룬다. 꼭 듣기 과목을 넣고 싶은 칸이 있으면 그 칸부터 본다
  const G = groups.length
  const groupTerm = groups.map(({ term }) => termIndex(term))
  const groupSlot: Slot[] = groups.map(({ term, group }) => ({ kind: 'group', term, groupId: group.id }))
  const prefer = options.pinGroups ?? {}
  const preferGroup = candidates.map((s) =>
    pinned.has(s) && Object.hasOwn(prefer, s) ? groups.findIndex(({ group }) => group.id === prefer[s] && group.options.includes(s)) : -1,
  )
  const candGroups = candidates.map((s, i) => {
    const list = groups.flatMap(({ group }, g) => (group.options.includes(s) ? [g] : []))
    const p = preferGroup[i]
    return p >= 0 ? [p, ...list.filter((g) => g !== p)] : list
  })
  const preferCap = new Array<number>(nc + 1).fill(0)
  for (let i = nc - 1; i >= 0; i--) preferCap[i] = preferCap[i + 1] + (preferGroup[i] >= 0 ? PREFER_WEIGHT : 0)
  const minTerm = candGroups.map((list) => Math.min(...list.map((g) => groupTerm[g])))
  const maxTerm = candGroups.map((list) => Math.max(...list.map((g) => groupTerm[g])))
  const candIndex = new Map(candidates.map((s, i) => [s, i]))
  const dependentCands = dependents.map((list) => list.flatMap((x) => candIndex.get(x) ?? []))
  // 꼭 듣기 과목은 후보 맨 앞에 모여 있다
  const isPin = candidates.map((s) => pinned.has(s))
  const pinCount = isPin.filter(Boolean).length
  const needW = needs.map((x) => x.weight)
  const needN = needs.map((x) => x.need)
  const needCands: number[][] = needs.map(() => [])
  candNeeds.forEach((list, i) => {
    for (const j of list) needCands[j].push(i)
  })

  // 세트(트랙)는 고정했거나 요구된 과목이 든 세트만 고르고, 아니면 학생 자유로 둔다.
  // 고를 수 있는 세트가 하나뿐이면(다른 세트를 모두 뺐으면) 그 세트를 듣는다 (세트 하나는 꼭 들어야 한다).
  // 꼭 듣기 과목이 세트로만 들을 수 있으면 그 과목이 든 세트만 본다. 선택 칸에도 있는 꼭 듣기 과목은 세트를 정하지 않고 점수로 고른다
  const setOnly = (s: string) => !base.has(s) && !groups.some(({ group }) => group.options.includes(s))
  const trackChoices: (number | null)[][] = school.tracks.map((t) => {
    const allowed = t.sets.map((set, i) => ({ set, i })).filter(({ set }) => !set.items.some((it) => excluded.has(it.subject)))
    if (allowed.length === 1) return [allowed[0].i]
    const forced = allowed.filter(({ set }) => set.items.some((it) => pinned.has(it.subject) && setOnly(it.subject))).map(({ i }) => i)
    if (forced.length) return forced
    const useful = allowed.filter(({ set }) => set.items.some((it) => wanted.has(it.subject))).map(({ i }) => i)
    return useful.length ? useful : [null]
  })
  const comboTotal = trackChoices.reduce((a, list) => a * list.length, 1)
  const setValue = (t: number, si: number | null) =>
    si === null ? 0 : [...new Set(school.tracks[t].sets[si].items.map((it) => it.subject))].reduce((a, s) => a + weightOf(s), 0)
  const combos = comboTotal <= MAX_COMBOS ? cartesian(trackChoices).map((tracks, index) => ({ tracks, index })) : topCombos(trackChoices, setValue, MAX_COMBOS)

  // 조건 하나가 상한에 보태는 몫 (c: 채운 수, r: 정하지 않은 후보 수 또는 그 가운데 넣을 자리가 남은 후보 수 o)
  const needTerm = (c: number, r: number, j: number) => needW[j] * Math.min(Math.max(0, needN[j] - c), r)
  // 넓은 조건: 모자란 수가 넣을 자리가 남은 후보 수 이상이라 넣는 대로 다 센다. 좁은 조건: 모자란 수까지만
  const isWide = (c: number, o: number, j: number) => needN[j] - c > 0 && needN[j] - c >= o
  const narrowTerm = (c: number, o: number, j: number) => (needN[j] - c > 0 && needN[j] - c < o ? needW[j] * (needN[j] - c) : 0)
  // 선택 칸마다 그 칸에 넣을 수 있는 후보
  const groupCands: number[][] = groups.map(() => [])
  candGroups.forEach((list, k) => {
    for (const g of list) groupCands[g].push(k)
  })

  const stateOf = (tracks: (number | null)[], index: number): ComboState => {
    const taken = new Map(base)
    tracks.forEach((setIndex, ti) => {
      if (setIndex === null) return
      const t = school.tracks[ti]
      for (const it of t.sets[setIndex].items) if (!taken.has(it.subject)) taken.set(it.subject, { kind: 'track', term: it.term, trackId: t.id, setIndex })
    })
    const cap = groups.map(({ group }) => group.pick)
    const count = needs.map((n) => n.cand.filter((s) => taken.has(s)).length)
    const placed = new Uint8Array(Math.max(1, nc))
    const termAt = new Int8Array(Math.max(1, nc))
    const fixedRecover = new Float64Array(Math.max(1, nc))
    const openGroups = new Int32Array(Math.max(1, nc))
    candidates.forEach((s, k) => {
      const slot = taken.get(s)
      if (slot) {
        placed[k] = 1
        termAt[k] = termIndex(slot.term)
      }
      openGroups[k] = candGroups[k].filter((g) => cap[g] > 0).length
      for (const x of dependents[k]) {
        if (candIndex.has(x)) continue
        const xt = taken.get(x)
        if (xt && xt.kind !== 'fixed' && minTerm[k] < termIndex(xt.term)) fixedRecover[k] += ORDER_PENALTY
      }
    })
    const remaining = needs.map(() => 0)
    const openCount = needs.map(() => 0)
    candidates.forEach((_, k) => {
      if (placed[k]) return
      for (const j of candNeeds[k]) {
        remaining[j]++
        if (openGroups[k] > 0) openCount[j]++
      }
    })
    const metOf = candNeeds.map((list) => list.reduce((a, j) => a + (count[j] < needN[j] ? needW[j] : 0), 0))
    const wideOf = candNeeds.map((list) => list.reduce((a, j) => a + (isWide(count[j], openCount[j], j) ? needW[j] : 0), 0))
    let needBound = 0
    let openBound = 0
    let narrow = 0
    for (let j = 0; j < needs.length; j++) {
      needBound += needTerm(count[j], remaining[j], j)
      openBound += needTerm(count[j], openCount[j], j)
      narrow += narrowTerm(count[j], openCount[j], j)
    }
    return {
      tracks,
      index,
      taken,
      cap,
      count,
      remaining,
      openCount,
      metOf,
      wideOf,
      openGroups,
      placed,
      termAt,
      fixedRecover,
      needBound,
      openBound,
      narrow,
      start: score(taken, needs, offered),
    }
  }

  // 가지치기 상한: 아직 정하지 않은 후보로 더 얻을 수 있는 점수. 아래 셋 가운데 가장 작은 것을 쓴다 (모두 실제로 얻을 수 있는 점수 이상이다).
  // ① 조건마다 모자란 수까지, 넣을 자리가 남은 후보 수까지 + 관련도·위계 몫
  // ② 남은 자리에 함께 넣을 수 있는 후보 묶음 가운데 후보 몫의 합이 가장 큰 것. 후보 몫 = 지금 넣으면 채우는 조건 가중치 + 관련도 + 풀 수 있는 위계 감점.
  //    칸마다 남은 자리 수까지 이분 매칭으로 몫이 큰 후보부터 넣는 욕심 선택이 최적이다 (매트로이드).
  // ③ ②와 같되, 넣을 자리가 남은 후보가 모자란 수보다 많은 '좁은 조건'(예: 이 중 1과목)은 후보 몫에서 빼고 조건마다 모자란 수까지 따로 더한다.
  // 위계 점수는 뒤 과목이 이미 들어 있거나, 아직 정하지 않았지만 앞 과목보다 먼저 정할 뒤 과목만 센다
  // (나중에 정할 뒤 과목은 그 과목 몫에서 감점을 빼지 않아 이미 넉넉하다).
  // 조건별 값(①의 합, 좁은 조건 합, 후보별 넓은 조건 가중치)은 탐색하면서 바뀔 때마다 고쳐 두어 상한 계산은 후보 수만큼만 돈다.
  const open = new Int32Array(Math.max(1, nc))
  const extraOf = new Float64Array(Math.max(1, nc))
  const gainAll = new Float64Array(Math.max(1, nc))
  const gainWide = new Float64Array(Math.max(1, nc))
  const relList = new Float64Array(Math.max(1, nc))
  const sorted = new Int32Array(Math.max(1, nc))
  const usedB = new Array<number>(G).fill(0)
  const membersB: number[][] = groups.map(() => [])
  const seenB = new Uint8Array(Math.max(1, G))
  const augmentB = (cap: number[], k: number): boolean => {
    for (const g of candGroups[k]) {
      if (seenB[g] || cap[g] <= 0) continue
      seenB[g] = 1
      if (usedB[g] < cap[g]) {
        usedB[g]++
        membersB[g].push(k)
        return true
      }
      const list = membersB[g]
      for (let q = 0; q < list.length; q++)
        if (augmentB(cap, list[q])) {
          list[q] = k
          return true
        }
    }
    return false
  }
  const byAll = (a: number, b: number) => gainAll[b] - gainAll[a]
  const byWide = (a: number, b: number) => gainWide[b] - gainWide[a]
  const bestFill = (cap: number[], m: number, gain: Float64Array, seats: number) => {
    for (let g = 0; g < G; g++) {
      usedB[g] = 0
      membersB[g].length = 0
    }
    for (let q = 0; q < m; q++) sorted[q] = open[q]
    const view = sorted.subarray(0, m).sort(gain === gainAll ? byAll : byWide)
    let sum = 0
    let filled = 0
    for (let q = 0; q < m && filled < seats; q++) {
      const k = view[q]
      if (gain[k] <= 0) break
      seenB.fill(0)
      if (augmentB(cap, k)) {
        sum += gain[k]
        filled++
      }
    }
    return sum
  }
  const sumTop = (list: Float64Array, len: number, k: number) => {
    let s = 0
    if (len <= k) {
      for (let q = 0; q < len; q++) s += list[q]
      return s
    }
    const sub = list.subarray(0, len).sort()
    for (let q = len - Math.max(0, Math.floor(k)); q < len; q++) s += sub[q]
    return s
  }
  /** 상한. current(지금 점수)를 주면 그 조합에서 가지를 칠 수 있게 되는 순간 나머지는 계산하지 않고 돌려준다 */
  const tightBound = (st: ComboState, i: number, current = Number.NaN): number => {
    const { cap, metOf, wideOf, openGroups, placed, termAt, fixedRecover } = st
    let seats = 0
    for (let g = 0; g < G; g++) if (cap[g] > 0) seats += cap[g]
    let m = 0
    let rels = 0
    let orderPot = 0
    let preferPot = 0
    for (let k = i; k < nc; k++) {
      if (placed[k] || openGroups[k] <= 0) continue
      let extra = fixedRecover[k]
      for (const xi of dependentCands[k]) {
        if (placed[xi]) {
          if (minTerm[k] < termAt[xi]) extra += ORDER_PENALTY
        } else if (xi >= i && xi < k && minTerm[k] < maxTerm[xi]) extra += ORDER_PENALTY
      }
      orderPot += extra
      if (metOf[k] > 0) {
        const r = relOf[k] * TIE
        extra += r
        relList[rels++] = r
      }
      const p = preferGroup[k]
      if (p >= 0 && cap[p] > 0) {
        extra += PREFER_WEIGHT
        preferPot += PREFER_WEIGHT
      }
      extraOf[k] = extra
      open[m++] = k
    }
    // 부동소수 오차로 가지를 잘못 치지 않게 아주 조금 넉넉히 (가지치기 기준 EPS보다는 훨씬 작게: 점수가 같은 가지는 쳐야 한다)
    let bound = st.openBound + sumTop(relList, rels, seats) + preferPot + orderPot + 1e-11
    if (beaten(st.index, current + bound)) return bound
    for (let q = 0; q < m; q++) gainAll[open[q]] = metOf[open[q]] + extraOf[open[q]]
    bound = Math.min(bound, bestFill(cap, m, gainAll, seats) + 1e-11)
    if (beaten(st.index, current + bound)) return bound
    for (let q = 0; q < m; q++) gainWide[open[q]] = wideOf[open[q]] + extraOf[open[q]]
    return Math.min(bound, st.narrow + bestFill(cap, m, gainWide, seats) + 1e-11)
  }

  // 꼭 듣기 과목을 남은 자리에 최대 몇 개 넣을 수 있는지 (칸마다 남은 자리 수까지, 이분 매칭)
  const used = new Array<number>(G).fill(0)
  const members: number[][] = groups.map(() => [])
  const seen = new Uint8Array(Math.max(1, G))
  const augment = (st: ComboState, p: number): boolean => {
    for (const g of candGroups[p]) {
      if (seen[g]) continue
      seen[g] = 1
      if (used[g] < st.cap[g]) {
        used[g]++
        members[g].push(p)
        return true
      }
      const list = members[g]
      for (let q = 0; q < list.length; q++)
        if (augment(st, list[q])) {
          list[q] = p
          return true
        }
    }
    return false
  }
  const pinMatch = (st: ComboState, from: number): number => {
    if (from >= pinCount) return 0
    for (let g = 0; g < G; g++) {
      used[g] = 0
      members[g].length = 0
    }
    let m = 0
    for (let p = from; p < pinCount; p++) {
      if (st.placed[p]) continue
      seen.fill(0)
      if (augment(st, p)) m++
    }
    return m
  }

  let best: Best | null = null
  let spent = 0
  let complete = comboTotal <= MAX_COMBOS
  // 점수가 같으면 원래 순서가 앞선 조합, 같은 조합에서는 먼저 찾은 배치를 고른다 (예전 탐색과 같은 결과)
  const beaten = (index: number, bound: number) => {
    const b = best as Best | null
    return b !== null && (index < b.combo ? bound < b.score - EPS : bound <= b.score + EPS)
  }

  const run = (st: ComboState) => {
    const { taken, cap, count, remaining, openCount, metOf, wideOf, openGroups, placed, termAt, tracks, index } = st
    let budget = Math.min(SEARCH_BUDGET, TOTAL_BUDGET - spent)
    const given = budget
    /**
     * 조건 j의 채운 수(dc), 정하지 않은 후보 수(dr), 그 가운데 넣을 자리가 남은 후보 수(dopen)가 바뀔 때 상한용 값을 함께 고친다
     * (가중치가 0.5의 배수라 더하고 빼도 오차가 없다)
     */
    const change = (j: number, dc: number, dr: number, dopen: number) => {
      const c0 = count[j]
      const r0 = remaining[j]
      const o0 = openCount[j]
      const c1 = c0 + dc
      const r1 = r0 + dr
      const o1 = o0 + dopen
      count[j] = c1
      remaining[j] = r1
      openCount[j] = o1
      st.needBound += needTerm(c1, r1, j) - needTerm(c0, r0, j)
      st.openBound += needTerm(c1, o1, j) - needTerm(c0, o0, j)
      st.narrow += narrowTerm(c1, o1, j) - narrowTerm(c0, o0, j)
      const m0 = c0 < needN[j]
      const m1 = c1 < needN[j]
      if (m0 !== m1) {
        const w = m1 ? needW[j] : -needW[j]
        for (const k of needCands[j]) metOf[k] += w
      }
      const w0 = isWide(c0, o0, j)
      const w1 = isWide(c1, o1, j)
      if (w0 !== w1) {
        const w = w1 ? needW[j] : -needW[j]
        for (const k of needCands[j]) wideOf[k] += w
      }
    }
    /** 칸 g가 꽉 차거나(-1) 다시 자리가 나면(+1), 그 칸에만 넣을 수 있던 아직 정하지 않은 후보(i 뒤)의 '자리 남은 후보' 수를 고친다 */
    const shut = (g: number, i: number, d: number) => {
      for (const k of groupCands[g]) {
        if (d > 0 && openGroups[k] === 0 && k > i && !placed[k]) for (const j of candNeeds[k]) change(j, 0, 0, 1)
        openGroups[k] += d
        if (d < 0 && openGroups[k] === 0 && k > i && !placed[k]) for (const j of candNeeds[k]) change(j, 0, 0, -1)
      }
    }
    /** s를 term에 넣었을 때 위계 점수 변화 */
    const orderDelta = (i: number, term: number) => {
      let d = 0
      for (const b of prereqs[i]) {
        const bt = taken.get(b)
        if (!bt || termIndex(bt.term) >= term) d -= ORDER_PENALTY
      }
      for (const x of dependents[i]) {
        const xt = taken.get(x)
        if (xt && xt.kind !== 'fixed' && term < termIndex(xt.term)) d += ORDER_PENALTY
      }
      return d
    }
    // 꼭 듣기 과목은 넣을 수 있는 만큼 모두 넣는다: 남은 꼭 듣기를 다 넣어도 그만큼 못 채우는 가지는 보지 않는다
    const target = pinMatch(st, 0)
    let placedPins = 0
    const pinsFit = (i: number) => !isPin[i] || placedPins + pinMatch(st, i + 1) >= target

    const dfs = (i: number, current: number): void => {
      if (budget-- <= 0) return
      // 세트로 이미 든 후보는 그냥 지나간다 (상한도 다음 후보와 같다)
      if (i < nc && placed[i]) return dfs(i + 1, current)
      if (
        best !== null &&
        (beaten(index, current + st.needBound + orderCap[i] + relCap[i] + preferCap[i]) ||
          (given - budget > TIGHT_AFTER && beaten(index, current + tightBound(st, i, current))))
      )
        return
      if (i === nc) {
        const b = best as Best | null
        if (b === null || (index < b.combo ? current >= b.score - EPS : current > b.score + EPS))
          best = { taken: new Map(taken), score: current, tracks, combo: index }
        return
      }
      const s = candidates[i]
      const cn = candNeeds[i]
      // 이 후보를 정한다 (넣거나 넣지 않거나)
      const wasOpen = openGroups[i] > 0 ? 1 : 0
      for (const j of cn) change(j, 0, -1, -wasOpen)
      const met = metOf[i]
      for (const g of candGroups[i]) {
        if (cap[g] <= 0) continue
        const gain = orderDelta(i, groupTerm[g]) + met + (g === preferGroup[i] ? PREFER_WEIGHT : 0)
        // 조건을 더 채우거나 위계를 맞추지 않는 과목은 넣지 않는다 (관련도만으로는 자리를 차지하지 않는다)
        if (gain <= EPS) continue
        taken.set(s, groupSlot[g])
        placed[i] = 1
        termAt[i] = groupTerm[g]
        cap[g]--
        if (cap[g] <= 0) shut(g, i, -1)
        for (const j of cn) change(j, 1, 0, 0)
        if (isPin[i]) placedPins++
        // 관련도 몫은 조건을 채운 과목에만 준다 (앞 과목을 하나 더 넣는 조합이 이득을 보지 않게)
        if (pinsFit(i)) dfs(i + 1, current + gain + (met > 0 ? relOf[i] * TIE : 0))
        if (isPin[i]) placedPins--
        for (const j of cn) change(j, -1, 0, 0)
        if (cap[g] <= 0) shut(g, i, 1)
        cap[g]++
        placed[i] = 0
        taken.delete(s)
      }
      if (pinsFit(i)) dfs(i + 1, current)
      for (const j of cn) change(j, 0, 1, wasOpen)
    }
    dfs(0, st.start)
    if (budget < 0) complete = false
    spent += given - Math.max(0, budget)
  }

  // 조합마다 얻을 수 있는 점수 상한을 먼저 구해 큰 조합부터 본다. 상한이 지금까지 찾은 점수보다 낮은 조합은 건너뛴다
  const states = combos.map(({ tracks, index }) => {
    const st = stateOf(tracks, index)
    const root = st.start + Math.min(st.needBound + orderCap[0] + relCap[0] + preferCap[0], tightBound(st, 0))
    return { st, root }
  })
  states.sort((a, b) => b.root - a.root || a.st.index - b.st.index)
  for (const { st, root } of states) {
    if (spent >= TOTAL_BUDGET) {
      complete = false
      break
    }
    if (beaten(st.index, root)) continue
    run(st)
  }

  const found = best as Best | null
  const chosen = found ?? { taken: new Map(base), score: 0, tracks: school.tracks.map(() => null), combo: 0 }
  const taken = roomier(chosen.taken, groups, excluded, (t) => score(t, needs, offered), new Set(candidates.filter((_, i) => preferGroup[i] >= 0)))
  const plan = explain(school, units, offered, taken, chosen.tracks, wantedBy, pinned, excluded)
  plan.search = { nodes: spent, combos: comboTotal, complete }
  return plan
}

/**
 * 점수가 같은 배치 가운데 남은 빈자리를 학생이 고를 과목으로 다 채울 수 있는 배치를 고른다.
 * 두 칸에 함께 있는 과목을 한쪽에 넣어 다른 칸에 고를 과목이 하나도 남지 않는 일을 막는다
 * (예: 반송고 교과 영역 간 선택은 1학기·2학기에 주제 탐구 독서가 함께 있다). 지금 배치로 다 채울 수 있으면 그대로 둔다.
 * keep: 칸을 옮기지 않을 과목 (학생이 칸을 고른 꼭 듣기)
 */
function roomier(
  taken: Map<string, Slot>,
  groups: { term: TermId; group: Group }[],
  excluded: Set<string>,
  scoreOf: (t: Map<string, Slot>) => number,
  keep: Set<string>,
): Map<string, Slot> {
  const index = new Map(groups.map(({ group }, g) => [group.id, g]))
  const groupsOf = new Map<string, number[]>()
  groups.forEach(({ group }, g) => {
    for (const o of new Set(group.options)) groupsOf.set(o, [...(groupsOf.get(o) ?? []), g])
  })
  // 두 칸에 함께 있는 과목이 없으면 옮길 수 있는 과목도 없다
  if (![...groupsOf.values()].some((list) => list.length > 1)) return taken
  const fill = (moveable: boolean) => {
    const members = groups.map((): { s: string; fixed: boolean }[] => [])
    for (const [s, slot] of taken) if (slot.kind === 'group') members[index.get(slot.groupId) ?? 0].push({ s, fixed: !moveable || keep.has(s) })
    const place = (s: string, seen: Set<number>): boolean => {
      for (const g of groupsOf.get(s) ?? []) {
        if (seen.has(g)) continue
        seen.add(g)
        const list = members[g]
        if (list.length < groups[g].group.pick) {
          list.push({ s, fixed: false })
          return true
        }
        for (const x of list)
          if (!x.fixed && place(x.s, seen)) {
            x.s = s
            return true
          }
      }
      return false
    }
    // 아직 고를 수 있는 과목 (뺀 과목·이미 듣는 과목은 빼고)
    let filled = 0
    for (const s of groupsOf.keys()) if (!taken.has(s) && !excluded.has(s) && place(s, new Set())) filled++
    return { filled, members }
  }
  const seats = groups.reduce((a, { group }) => a + group.pick, 0) - [...taken.values()].filter((slot) => slot.kind === 'group').length
  const now = fill(false)
  if (now.filled >= seats) return taken
  const moved = fill(true)
  if (moved.filled <= now.filled) return taken
  const out = new Map([...taken].filter(([, slot]) => slot.kind !== 'group'))
  moved.members.forEach((list, g) => {
    const { term, group } = groups[g]
    for (const { s } of list) if (taken.get(s)?.kind === 'group') out.set(s, { kind: 'group', term, groupId: group.id })
  })
  // 위계 점수가 달라지면 (다른 학기로 옮겨 앞 과목보다 늦어지면) 옮기지 않는다
  return scoreOf(out) >= scoreOf(taken) - EPS ? new Map([...taken].map(([s, slot]) => [s, out.get(s) ?? slot])) : taken
}

function explain(
  school: School,
  units: Unit[],
  offered: Map<string, Slot[]>,
  taken: Map<string, Slot>,
  tracks: (number | null)[],
  wantedBy: Map<string, Set<string>>,
  pinned: Set<string>,
  excluded: Set<string>,
): Plan {
  const groupPlans: GroupPlan[] = school.terms.flatMap((t) =>
    t.groups.map((g) => {
      const chosen = [...taken].filter(([, slot]) => slot.kind === 'group' && slot.groupId === g.id).map(([s]) => s)
      return { term: t.id, group: g, chosen, free: g.pick - chosen.length }
    }),
  )

  // 들을 칸이 없던 까닭: 들을 수 있는 칸이 모두 찼고 그 칸에 꼭 듣기 과목이 있으면 pinned,
  // 세트로만 듣는 과목인데 같은 묶음에서 다른 세트를 골랐으면 other-set
  const planOf = new Map(groupPlans.map((g) => [g.group.id, g]))
  const causeOf = (s: string): { cause?: MissingCause; by?: string[] } => {
    const slots = offered.get(s) ?? []
    const inGroups = slots.flatMap((x) => (x.kind === 'group' ? (planOf.get(x.groupId) ?? []) : []))
    if (inGroups.length) {
      if (inGroups.some((g) => g.free > 0)) return {}
      const by = [...new Set(inGroups.flatMap((g) => g.chosen.filter((c) => pinned.has(c))))]
      return by.length ? { cause: 'pinned', by } : {}
    }
    const by = new Set<string>()
    for (const x of slots) {
      if (x.kind !== 'track') continue
      const ti = school.tracks.findIndex((t) => t.id === x.trackId)
      const si = tracks[ti]
      if (ti >= 0 && si !== null && si !== undefined && si !== x.setIndex) by.add(school.tracks[ti].sets[si].label)
    }
    return by.size ? { cause: 'other-set', by: [...by] } : {}
  }

  const unitResults: UnitResult[] = units.map((unit) => {
    const clauses = unit.clauses.map((clause): ClauseResult => {
      const candidates = resolveSubjects(clause.subjects)
      const need = needOf(clause)
      const met = candidates.filter((s) => taken.has(s)).map((s) => ({ subject: s, slot: taken.get(s)! }))
      const ok = met.length >= need
      const missing = ok
        ? []
        : candidates
            .filter((s) => !taken.has(s))
            .map((s): Missing => {
              const reason: MissingReason = excluded.has(s) ? 'excluded' : offered.has(s) ? 'no-slot' : 'not-offered'
              return reason === 'no-slot' ? { subject: s, reason, ...causeOf(s) } : { subject: s, reason }
            })
      return { clause, need, candidates, met, missing, ok }
    })
    const got = clauses.reduce((a, c) => a + Math.min(c.met.length, c.need), 0)
    const need = clauses.reduce((a, c) => a + c.need, 0)
    return { unit, clauses, got, need, ok: clauses.every((c) => c.ok) }
  })

  const warnings: OrderWarning[] = []
  for (const [subject, slot] of taken) {
    if (slot.kind === 'fixed') continue
    for (const before of SUBJECT_BY_NAME.get(subject)?.after ?? []) {
      const b = taken.get(before)
      if (!offered.has(before)) warnings.push({ subject, before, kind: 'not-offered' })
      else if (!b) {
        // 학생이 뺀 앞 과목은 '칸이 모자라'가 아니다
        const why = excluded.has(before) ? { cause: 'excluded-prereq' as const } : causeOf(before)
        warnings.push({ subject, before, kind: 'missing', ...why })
      } else if (termIndex(b.term) >= termIndex(slot.term)) warnings.push({ subject, before, kind: 'late' })
    }
  }

  const wanted = [...wantedBy]
    .map(([subject, set]) => ({ subject, units: [...set] }))
    .sort((a, b) => b.units.length - a.units.length || a.subject.localeCompare(b.subject, 'ko'))

  // 학교에 없는 과목은 채우지 못한 조건에 걸린 것만 알린다 ('이 중 1과목'을 다른 과목으로 채웠으면 알리지 않는다)
  const unmet = new Set(unitResults.flatMap((r) => r.clauses.flatMap((c) => c.missing.filter((m) => m.reason === 'not-offered').map((m) => m.subject))))
  const notOffered = wanted.filter((w) => unmet.has(w.subject)).map((w) => w.subject)
  const unplacedPins = [...pinned].filter((s) => !taken.has(s))

  return {
    school,
    taken,
    groups: groupPlans,
    tracks: school.tracks.map((track, i) => ({ track, setIndex: tracks[i] ?? null })),
    units: unitResults,
    warnings,
    notOffered,
    wanted,
    pinned,
    excluded,
    unplacedPins,
  }
}

export interface Reason {
  /** 이 과목을 요구한 모집단위 id */
  units: string[]
  /** 이 과목이 앞 과목이 되는 뒤 과목 (예: 화학 → 물질과 에너지) */
  before: string[]
  pinned: boolean
}

/** 계획에 들어간 선택 과목마다 왜 들어갔는지 */
export function reasonsOf(plan: Plan): Map<string, Reason> {
  const out = new Map<string, Reason>()
  for (const [subject, slot] of plan.taken) {
    if (slot.kind === 'fixed') continue
    const units = plan.units.filter((r) => r.clauses.some((c) => c.met.some((m) => m.subject === subject))).map((r) => r.unit.id)
    const before = [...plan.taken.keys()].filter((s) => SUBJECT_BY_NAME.get(s)?.after?.includes(subject))
    const pinned = plan.pinned.has(subject)
    if (units.length || before.length || pinned) out.set(subject, { units, before, pinned })
  }
  return out
}

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((x) => [...prefix, x])), [[]])
}

/**
 * 세트 조합이 너무 많을 때: 묶음마다 세트를 값이 큰 순으로 놓고, 값의 합이 큰 조합부터 limit개.
 * index는 cartesian 순서의 번호다 (점수가 같을 때 예전처럼 앞 조합을 고르려고)
 */
function topCombos<T>(lists: T[][], value: (list: number, x: T) => number, limit: number): { tracks: T[]; index: number }[] {
  const order = lists.map((list, t) => list.map((x, pos) => ({ x, pos, v: value(t, x) })).sort((a, b) => b.v - a.v || a.pos - b.pos))
  const stride = lists.map((_, t) => lists.slice(t + 1).reduce((a, l) => a * l.length, 1))
  const out: { tracks: T[]; index: number }[] = []
  const seenKeys = new Set<string>()
  const frontier: { ranks: number[]; v: number }[] = []
  const push = (ranks: number[]) => {
    const key = ranks.join(',')
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    frontier.push({ ranks, v: ranks.reduce((a, r, t) => a + order[t][r].v, 0) })
  }
  push(lists.map(() => 0))
  while (frontier.length && out.length < limit) {
    let k = 0
    for (let q = 1; q < frontier.length; q++) if (frontier[q].v > frontier[k].v) k = q
    const { ranks } = frontier.splice(k, 1)[0]
    out.push({ tracks: ranks.map((r, t) => order[t][r].x), index: ranks.reduce((a, r, t) => a + order[t][r].pos * stride[t], 0) })
    ranks.forEach((r, t) => {
      if (r + 1 < order[t].length) push(ranks.map((x, u) => (u === t ? x + 1 : x)))
    })
  }
  return out
}
