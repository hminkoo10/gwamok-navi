import type { School } from '../data/schema'

// 꼭 듣기·빼기 규칙. 어느 칸에서 어떤 순서로 눌러도 늘 지킨다.
//  1) 세트 묶음마다 고를 세트가 하나 이상 남는다 (세트 하나는 꼭 들어야 함)
//  2) 선택 칸을 모두 함께 채울 수 있다. 한 과목은 한 칸에만, 모두 듣는 과목은 선택 칸에서 못 고름
//  3) 꼭 듣기 과목은 모두 들어갈 자리가 있다 (묶음마다 한 세트, 선택 칸은 고르는 수까지)
// 세트는 통째로 들어서 세트 과목 하나를 빼거나 넣으면 같은 세트 과목도 함께 바뀐다.
// 부딪치면 마지막에 누른 쪽을 따른다: 앞서 뺀 세트·오래전에 뺀 과목을 다시 넣고, 자리가 모자라면 먼저 고른 꼭 듣기를 푼다.

export interface ChoiceState {
  pinned: string[]
  excluded: string[]
}

/** 세트 묶음이나 선택 칸이 비지 않게 다시 넣은 것 */
export interface Reopened {
  /** 세트 묶음 이름, 또는 '3학년 1학기 수학 선택' 같은 선택 칸 이름 */
  where: string
  /** 다시 넣은 세트 이름 (선택 칸이면 없다) */
  set?: string
  /** 선택 칸에서 골라야 하는 과목 수 */
  pick?: number
  /** 다시 넣은 세트의 과목, 또는 선택 칸에 다시 넣은 과목 */
  subjects: string[]
}

export interface ChoiceChange extends ChoiceState {
  /** 함께 뺀 과목 (같은 세트라 이제 들을 수 없는 과목) */
  alsoExcluded: string[]
  /** 함께 다시 넣은 과목 (꼭 듣기·다시 넣기한 과목과 같은 세트) */
  alsoIncluded: string[]
  /** 함께 바뀐 세트 이름 */
  set?: string
  reopened: Reopened[]
  /** 같은 묶음의 다른 세트를 골라 꼭 듣기를 푼 과목 */
  unpinned: string[]
  /** 자리가 모자라 꼭 듣기를 푼 과목 */
  bumped: string[]
  /** 거절한 바꾸기. every-set = 모든 세트에 든 과목이라 못 뺌, whole-group = 선택 칸을 채우려면 다 들어야 해서 못 뺌, no-room = 들어갈 칸이 없어 꼭 듣기 불가 */
  refused?: { reason: 'every-set' | 'whole-group' | 'no-room'; where?: string }
}

interface SetInfo {
  track: number
  label: string
  subjects: string[]
}

interface GroupInfo {
  label: string
  pick: number
  options: string[]
}

interface Model {
  fixed: Set<string>
  groups: GroupInfo[]
  sets: SetInfo[]
  /** 세트 묶음 이름 (번호 = SetInfo.track) */
  tracks: string[]
  /** 학교에서 들을 수 있는 과목 (모두 듣는 과목·선택 칸·세트) */
  offered: Set<string>
}

const termName = (id: string) => (/^\d-\d$/.test(id) ? `${id[0]}학년 ${id[2]}학기` : id)

function modelOf(school: School): Model {
  const fixed = new Set<string>()
  const groups: GroupInfo[] = []
  for (const t of school.terms) {
    for (const f of t.fixed) {
      fixed.add(f.subject)
      if (f.alt) fixed.add(f.alt)
    }
    for (const g of t.groups) groups.push({ label: `${termName(t.id)} ${g.label}`, pick: g.pick, options: [...new Set(g.options)] })
  }
  const sets = school.tracks.flatMap((t, track) => t.sets.map((s) => ({ track, label: s.label, subjects: [...new Set(s.items.map((i) => i.subject))] })))
  const offered = new Set([...fixed, ...groups.flatMap((g) => g.options), ...sets.flatMap((s) => s.subjects)])
  return { fixed, groups, sets, tracks: school.tracks.map((t) => t.label), offered }
}

const blockedIn = (set: SetInfo, ex: Set<string>) => set.subjects.filter((s) => ex.has(s))
/** 세트 말고도 들을 수 있는 과목 (모두 듣는 과목·선택 칸) */
const elsewhere = (m: Model, s: string) => m.fixed.has(s) || m.groups.some((g) => g.options.includes(s))

/** 다시 넣을 세트: 막은 과목이 적은 세트, 같으면 오래전에 막은 세트 (나중에 뺀 쪽이 지금 뜻에 가깝다) */
function easiest(sets: SetInfo[], ex: Set<string>, order: string[]): SetInfo {
  const newest = (s: SetInfo) => Math.max(-1, ...blockedIn(s, ex).map((x) => order.indexOf(x)))
  return sets.reduce((a, b) => {
    const d = blockedIn(b, ex).length - blockedIn(a, ex).length
    return d < 0 || (d === 0 && newest(b) < newest(a)) ? b : a
  })
}

/** 같은 세트를 빼서 지금은 들을 수 없게 된 과목과 그 까닭이 된 과목 (화면 표시용) */
export function lockedBy(school: School | null | undefined, excluded: Iterable<string>): Map<string, string[]> {
  return school ? lockedIn(modelOf(school), new Set(excluded)) : new Map()
}

function lockedIn(m: Model, ex: Set<string>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const subject of new Set(m.sets.flatMap((s) => s.subjects))) {
    if (ex.has(subject) || elsewhere(m, subject)) continue
    const mine = m.sets.filter((s) => s.subjects.includes(subject))
    if (mine.every((s) => blockedIn(s, ex).length > 0)) out.set(subject, [...new Set(mine.flatMap((s) => blockedIn(s, ex)))])
  }
  return out
}

/** 들을 수 없게 된 세트 과목을 빼기에 더한다. keep = 이미 막혀 있던 과목이라 그대로 둠 */
function addLocks(m: Model, ex: Set<string>, keep: Map<string, string[]>, out: string[]) {
  for (let changed = true; changed;) {
    changed = false
    for (const [s] of lockedIn(m, ex)) {
      if (keep.has(s)) continue
      ex.add(s)
      out.push(s)
      changed = true
    }
  }
}

/** 고를 세트가 하나도 남지 않은 묶음 */
function emptyTracks(m: Model, ex: Set<string>): number[] {
  return m.tracks.flatMap((_, t) => {
    const mine = m.sets.filter((s) => s.track === t)
    return mine.length && mine.every((s) => blockedIn(s, ex).length > 0) ? [t] : []
  })
}

/**
 * 선택 칸을 모두 함께 채울 때 모자라는 자리 수 (이분 매칭, 한 과목은 한 칸에만, 뺀 과목·모두 듣는 과목 제외).
 * short: 다 채우지 못한 칸, at: 과목이 들어간 칸
 */
function seatGap(m: Model, ex: Set<string>): { gap: number; short: GroupInfo[]; at: Map<string, GroupInfo> } {
  const members = m.groups.map((): string[] => [])
  const place = (s: string, seen: Set<number>): boolean => {
    for (let gi = 0; gi < m.groups.length; gi++) {
      if (seen.has(gi) || !m.groups[gi].options.includes(s)) continue
      seen.add(gi)
      const list = members[gi]
      if (list.length < m.groups[gi].pick) {
        list.push(s)
        return true
      }
      for (let q = 0; q < list.length; q++)
        if (place(list[q], seen)) {
          list[q] = s
          return true
        }
    }
    return false
  }
  for (const s of new Set(m.groups.flatMap((g) => g.options))) if (!ex.has(s) && !m.fixed.has(s)) place(s, new Set())
  const gap = m.groups.reduce((a, g, gi) => a + Math.max(0, g.pick - members[gi].length), 0)
  return {
    gap,
    short: m.groups.filter((g, gi) => members[gi].length < g.pick),
    at: new Map(members.flatMap((list, gi) => list.map((s): [string, GroupInfo] => [s, m.groups[gi]]))),
  }
}

/**
 * 빈자리가 floor보다 많으면 뺀 과목을 order 순(오래전에 뺀 것부터)으로 다시 넣는다. 빈자리를 줄이는 과목만.
 * 다시 넣은 과목을 칸별로 돌려주고, 끝내 모자라면 null
 */
function refill(m: Model, ex: Set<string>, order: string[], floor: number): Reopened[] | null {
  let now = seatGap(m, ex)
  if (now.gap <= floor) return []
  const back: string[] = []
  for (const o of order) {
    if (now.gap <= floor) break
    if (!ex.has(o) || m.fixed.has(o) || !m.groups.some((g) => g.options.includes(o))) continue
    ex.delete(o)
    const next = seatGap(m, ex)
    if (next.gap < now.gap) {
      back.push(o)
      now = next
    } else ex.add(o)
  }
  if (now.gap > floor) {
    for (const o of back) ex.add(o)
    return null
  }
  const where = (s: string) => now.at.get(s) ?? m.groups.find((g) => g.options.includes(s))!
  return m.groups.flatMap((g) => {
    const subjects = back.filter((s) => where(s) === g)
    return subjects.length ? [{ where: g.label, pick: g.pick, subjects }] : []
  })
}

/** subjects를 선택 칸에 모두 넣을 수 있는지 (칸마다 고르는 수까지, 이분 매칭) */
function fitGroups(m: Model, subjects: string[], ex: Set<string>): boolean {
  const seats = m.groups.flatMap((g) => Array.from({ length: g.pick }, () => g))
  const owner = new Array<string | null>(seats.length).fill(null)
  const place = (s: string, seen: Set<number>): boolean => {
    for (let i = 0; i < seats.length; i++) {
      if (seen.has(i) || ex.has(s) || !seats[i].options.includes(s)) continue
      seen.add(i)
      const prev = owner[i]
      if (prev === null || place(prev, seen)) {
        owner[i] = s
        return true
      }
    }
    return false
  }
  return subjects.every((s) => place(s, new Set()))
}

/** placeable이 볼 세트 조합 상한. 세트 묶음이 아주 많은 편제표·공유 링크에서 멈추지 않게 */
const MAX_VISITS = 2000

/**
 * 꼭 듣기 과목을 모두 넣을 수 있는지. 묶음마다 꼭 듣기 과목이 든 세트를 하나씩 맞춰 보고,
 * 세트로 못 넣은 과목은 선택 칸에 넣어 본다 (추천 계획도 같은 방식으로 세트를 고른다).
 * 들어갈 곳이 없는 과목이 있으면 바로 끝내고, 세트를 어떻게 골라도 안 되는 가지는 더 보지 않는다.
 */
function placeable(m: Model, pins: string[], ex: Set<string>): boolean {
  const need = [...new Set(pins.filter((p) => !m.fixed.has(p)))]
  if (!need.length) return true
  const open = m.sets.filter((s) => !blockedIn(s, ex).length)
  const inGroup = (p: string) => !ex.has(p) && m.groups.some((g) => g.options.includes(p))
  const inSet = (p: string) => open.some((s) => s.subjects.includes(p))
  if (need.some((p) => !inGroup(p) && !inSet(p))) return false
  // 세트에 없는 과목은 세트를 어떻게 고르든 선택 칸에 들어가야 한다
  const groupOnly = need.filter((p) => !inSet(p))
  if (!fitGroups(m, groupOnly, ex)) return false
  const seats = m.groups.reduce((a, g) => a + g.pick, 0)
  const perTrack = m.tracks.map((_, t) => open.filter((s) => s.track === t && s.subjects.some((x) => need.includes(x)))).filter((list) => list.length)
  let visits = 0
  const visit = (q: number, covered: Set<string>): boolean => {
    if (++visits > MAX_VISITS) return false
    const left = need.filter((p) => !covered.has(p))
    if (q === perTrack.length) return fitGroups(m, left, ex)
    // 가지치기: 남은 묶음이 세트로 덮을 수 있는 만큼 빼도 선택 칸 자리가 모자라거나, 남은 묶음에 없는 과목이 칸에 못 들어갈 때
    const later = perTrack.slice(q)
    const covers = (s: SetInfo) => s.subjects.filter((x) => left.includes(x)).length
    if (left.length - later.reduce((a, list) => a + Math.max(...list.map(covers)), 0) > seats) return false
    const stuck = left.filter((p) => !later.some((list) => list.some((s) => s.subjects.includes(p))))
    if (stuck.some((p) => !inGroup(p)) || !fitGroups(m, stuck, ex)) return false
    return [...perTrack[q]].sort((a, b) => covers(b) - covers(a)).some((s) => visit(q + 1, new Set([...covered, ...s.subjects])))
  }
  return visit(0, new Set())
}

/** 나중에 고른 꼭 듣기부터 넣어 보고, 자리가 없는 것은 뺀다 (순서는 그대로) */
function keepPins(m: Model, pins: string[], ex: Set<string>): string[] {
  const kept: string[] = []
  for (let i = pins.length - 1; i >= 0; i--) if (placeable(m, [...kept, pins[i]], ex)) kept.push(pins[i])
  return pins.filter((p) => kept.includes(p))
}

const blank = (state: ChoiceState): ChoiceChange => ({
  pinned: state.pinned,
  excluded: state.excluded,
  alsoExcluded: [],
  alsoIncluded: [],
  reopened: [],
  unpinned: [],
  bumped: [],
})

export function unpinChoice(state: ChoiceState, subject: string): ChoiceChange {
  return { ...blank(state), pinned: state.pinned.filter((s) => s !== subject) }
}

/**
 * 꼭 듣기. 세트 과목이면 그 세트를 고를 수 있게 같은 세트에서 뺀 과목을 다시 넣는다.
 * 같은 묶음의 다른 세트를 꼭 듣기로 했거나 선택 칸이 꽉 찼으면 먼저 고른 꼭 듣기를 푼다.
 */
export function pinChoice(school: School | null | undefined, state: ChoiceState, subject: string): ChoiceChange {
  const order = [...state.pinned.filter((s) => s !== subject), subject]
  if (!school) return { ...blank(state), pinned: order, excluded: state.excluded.filter((s) => s !== subject) }
  const m = modelOf(school)
  const change = blank(state)
  const ex = new Set(state.excluded)
  ex.delete(subject)
  const mine = m.sets.filter((s) => s.subjects.includes(subject))
  let chosen: SetInfo | undefined
  if (mine.length && !elsewhere(m, subject)) {
    chosen = easiest(mine, ex, state.excluded)
    for (const s of blockedIn(chosen, ex)) {
      ex.delete(s)
      change.alsoIncluded.push(s)
    }
    change.set = chosen.label
  }
  if (!placeable(m, [subject], ex)) return { ...blank(state), refused: { reason: 'no-room' } }
  const pinned = keepPins(m, order, ex)
  // 고른 세트와 같은 묶음의 다른 세트 과목이면 unpinned(세트는 하나만), 아니면 bumped(자리 부족)
  const rivals = chosen ? m.sets.filter((s) => s.track === chosen.track && s !== chosen).flatMap((s) => s.subjects) : []
  for (const p of order) {
    if (pinned.includes(p)) continue
    ;(rivals.includes(p) && !chosen?.subjects.includes(p) ? change.unpinned : change.bumped).push(p)
  }
  return { ...change, pinned, excluded: [...ex] }
}

/**
 * 빼기. 그 과목이 든 세트로만 들을 수 있던 과목도 함께 뺀다.
 * 남은 세트까지 빼면 앞서 뺀 세트를, 선택 칸을 채울 과목이 모자라면 오래전에 뺀 과목부터 다시 넣는다.
 */
export function excludeChoice(school: School | null | undefined, state: ChoiceState, subject: string): ChoiceChange {
  if (!school) return { ...blank(state), pinned: state.pinned.filter((s) => s !== subject), excluded: [...new Set([...state.excluded, subject])] }
  const m = modelOf(school)
  const change = blank(state)
  const old = new Set(state.excluded)
  const ex = new Set([...state.excluded, subject])

  const wasEmpty = emptyTracks(m, old)
  for (const t of emptyTracks(m, ex)) {
    if (wasEmpty.includes(t)) continue
    const others = m.sets.filter((s) => s.track === t && !s.subjects.includes(subject))
    if (!others.length) return { ...blank(state), refused: { reason: 'every-set', where: m.tracks[t] } }
    const back = easiest(others, ex, state.excluded)
    for (const s of blockedIn(back, ex)) ex.delete(s)
    change.reopened.push({ where: m.tracks[t], set: back.label, subjects: back.subjects })
  }

  // 이번 빼기로 선택 칸을 다 채울 수 없게 되면 오래전에 뺀 과목부터 다시 넣는다. 그래도 모자라면 거절
  const before = seatGap(m, old)
  const after = seatGap(m, ex)
  if (after.gap > before.gap) {
    const back = refill(
      m,
      ex,
      state.excluded.filter((o) => o !== subject),
      before.gap,
    )
    if (!back) {
      const where = after.short.find((g) => g.options.includes(subject)) ?? after.short[0]
      return { ...blank(state), refused: { reason: 'whole-group', where: where?.label } }
    }
    change.reopened.push(...back)
  }

  // 이번에 새로 막힌 세트 과목만 함께 뺀다 (이미 다른 과목 때문에 막혀 있던 과목은 건드리지 않는다)
  addLocks(m, ex, lockedIn(m, old), change.alsoExcluded)
  if (change.alsoExcluded.length)
    change.set = m.sets.find((s) => s.subjects.includes(subject) && s.subjects.some((x) => change.alsoExcluded.includes(x)))?.label

  // 뺀 과목의 꼭 듣기는 풀고, 세트가 바뀌어 자리가 모자라면 먼저 고른 것부터 푼다
  const left = state.pinned.filter((p) => !ex.has(p))
  const pinned = keepPins(m, left, ex)
  change.bumped.push(...left.filter((p) => !pinned.includes(p)))
  return { ...change, pinned, excluded: [...ex] }
}

/** 다시 넣기. 세트로만 듣는 과목이면 그 세트를 다시 고를 수 있게 같은 세트에서 함께 뺀 과목도 다시 넣는다 */
export function includeChoice(school: School | null | undefined, state: ChoiceState, subject: string): ChoiceChange {
  const change = blank(state)
  const ex = new Set(state.excluded)
  ex.delete(subject)
  const m = school ? modelOf(school) : null
  const mine = m ? m.sets.filter((s) => s.subjects.includes(subject)) : []
  if (m && mine.length && !elsewhere(m, subject)) {
    const best = easiest(mine, ex, state.excluded)
    for (const s of blockedIn(best, ex)) {
      ex.delete(s)
      change.alsoIncluded.push(s)
    }
    if (change.alsoIncluded.length) change.set = best.label
  }
  return { ...change, excluded: [...ex] }
}

/**
 * 세트를 고르려고 꼭 듣기로 할 과목: 같은 묶음의 다른 세트·선택 칸·모두 듣는 과목에 없는 과목. 다른 묶음 세트에도 없는 과목 먼저.
 * 없으면 null (과목 하나로는 그 세트를 정할 수 없음)
 */
export function setPickSubject(school: School | null | undefined, trackId: string, setIndex: number): string | null {
  if (!school) return null
  const track = school.tracks.findIndex((t) => t.id === trackId)
  if (track < 0) return null
  const m = modelOf(school)
  const sets = m.sets.filter((s) => s.track === track)
  const set = sets[setIndex]
  if (!set) return null
  const unique = set.subjects.filter((x) => !elsewhere(m, x) && !sets.some((s) => s !== set && s.subjects.includes(x)))
  return unique.find((x) => !m.sets.some((s) => s.track !== track && s.subjects.includes(x))) ?? unique[0] ?? null
}

/**
 * 예전에 저장된 선택을 규칙에 맞게 고친다. 고칠 것이 없으면 null
 * - 학교에 없는 과목의 꼭 듣기·빼기는 버리고, 둘이 겹치면 꼭 듣기를 따른다
 * - 세트가 모두 막힌 묶음, 채울 과목이 모자란 선택 칸은 오래전에 뺀 것부터 다시 넣고, 자리가 없는 꼭 듣기는 푼다
 */
export function repairChoices(school: School | null | undefined, state: ChoiceState): ChoiceChange | null {
  if (!school) return null
  const m = modelOf(school)
  const change = blank(state)
  const pins = [...new Set(state.pinned)]
  // 학교에 없는 과목은 바로 푼다 (공유 링크에 엉뚱한 과목이 잔뜩 있어도 금방 끝나게)
  const live = pins.filter((p) => m.offered.has(p))
  const order = [...new Set(state.excluded)].filter((s) => !pins.includes(s) && m.offered.has(s))
  const ex = new Set(order)

  // 꼭 듣기가 빼기보다 앞선다. 세트 전용 꼭 듣기는 그 세트를 다시 넣을 수 있다고 보고 남길 꼭 듣기를 고른 뒤, 남긴 과목의 세트만 다시 넣는다
  const setOnly = (p: string) => !elsewhere(m, p) && m.sets.some((s) => s.subjects.includes(p))
  const open = new Set(ex)
  for (const s of m.sets) if (s.subjects.some((x) => live.includes(x) && setOnly(x))) for (const b of blockedIn(s, ex)) open.delete(b)
  const wanted = keepPins(m, live, open)
  for (const p of wanted) {
    const mine = m.sets.filter((s) => s.subjects.includes(p))
    if (!setOnly(p) || mine.some((s) => !blockedIn(s, ex).length)) continue
    for (const s of blockedIn(easiest(mine, ex, order), ex)) {
      ex.delete(s)
      change.alsoIncluded.push(s)
    }
  }
  for (const t of emptyTracks(m, ex)) {
    const back = easiest(
      m.sets.filter((s) => s.track === t),
      ex,
      order,
    )
    for (const s of blockedIn(back, ex)) ex.delete(s)
    change.reopened.push({ where: m.tracks[t], set: back.label, subjects: back.subjects })
  }
  // 선택 칸은 아무것도 빼지 않았을 때만큼 채울 수 있어야 한다
  change.reopened.push(...(refill(m, ex, order, seatGap(m, new Set()).gap) ?? []))
  addLocks(m, ex, new Map(), change.alsoExcluded)

  const pinned = keepPins(m, wanted, ex)
  change.bumped.push(...pins.filter((p) => !pinned.includes(p)))
  const excluded = [...order.filter((s) => ex.has(s)), ...change.alsoExcluded]
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  return same(pinned, state.pinned) && same(excluded, state.excluded) ? null : { ...change, pinned, excluded }
}
