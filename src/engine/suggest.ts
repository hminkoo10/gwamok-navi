import { FINE_BY_ID, MAJORS } from '../data/majors'
import type { Unit } from '../data/schema'
import { TERMS } from '../data/schema'
import { SUBJECT_BY_NAME } from '../data/subjects'
import { type Focus, NO_RANK } from './focus'
import { needOf, offerIndex, type Plan, resolveSubjects } from './plan'
import { fineOf } from './search'

// 진로 관련도: 고른 분야 학과들이 전국에서 어떤 과목을 얼마나 권하는지로 과목마다 점수를 매긴다.
// - 세기: 이름을 콕 집으면 1, '수학 교과 2과목' 같은 넓은 조건은 2/(교과 과목 수), 권장과목은 × 0.85
// - share: 같은 분야 학과들의 세기 평균 (다른 계열이 섞인 학과는 섞인 만큼 덜 셈). lift: 모든 학과 평균보다 이 분야가 더 권하는 정도
// - 빈칸 추천은 두 곳 이상이 이름으로 권한 과목만. 대학 자료가 거의 없는 과목(정보·전문교과 등)은 과목 이름으로 본 관련(prior)을 약하게

export interface FieldScore {
  /** 순위용 점수 (0~1) */
  score: number
  /** 같은 분야 학과 가운데 이 과목을 권하는 비율 (0~1) */
  share: number
  /** 이 과목을 이름으로 콕 집어 권한 같은 분야 학과 수 */
  named: number
  /** 대학 자료가 아니라 과목 이름으로 본 관련 */
  prior: boolean
}

const RECOMMENDED = 0.85
/** 빈칸 추천에 낼 최소 점수 */
const MIN_SCORE = 0.12
const PRIOR_SCORE = 0.15

const strengthCache = new WeakMap<Unit, Map<string, number>>()

/** 학과 하나가 과목마다 얼마나 세게 권하는지 (0~1) */
function strengths(u: Unit): Map<string, number> {
  let out = strengthCache.get(u)
  if (out) return out
  out = new Map()
  for (const c of u.clauses) {
    const subjects = resolveSubjects(c.subjects)
    if (!subjects.length) continue
    const w = Math.min(1, needOf(c) / subjects.length) * (c.level === 'recommended' ? RECOMMENDED : 1)
    for (const s of subjects) out.set(s, Math.max(out.get(s) ?? 0, w))
  }
  strengthCache.set(u, out)
  return out
}

const backgroundCache = new WeakMap<Unit[], Map<string, number>>()

/** 모든 학과에서 과목마다 권하는 평균 세기 (분야 특징을 가리는 기준) */
function background(units: Unit[]): Map<string, number> {
  let out = backgroundCache.get(units)
  if (out) return out
  out = new Map()
  let n = 0
  for (const u of units) {
    const st = strengths(u)
    if (!st.size) continue
    n++
    for (const [s, w] of st) out.set(s, (out.get(s) ?? 0) + w)
  }
  for (const [s, w] of out) out.set(s, w / Math.max(1, n))
  backgroundCache.set(units, out)
  return out
}

/** 고른 분야(묶음 id·세부 학과 id)가 걸치는 계열 묶음 (세부 학과의 가까운 학과 묶음까지) */
function coarseOf(majors: string[]): Set<string> {
  const out = new Set<string>()
  for (const m of majors) {
    const fine = FINE_BY_ID.get(m)
    if (!fine) {
      out.add(m)
      continue
    }
    out.add(fine.parent)
    for (const r of fine.related ?? []) out.add(FINE_BY_ID.get(r)?.parent ?? r)
  }
  return out
}

const FIELD_OF = new Map(MAJORS.map((m) => [m.id, m.field as string]))

/** 학과 수가 이만큼 모이기 전까지는 윗단계(같은 계열 → 같은 큰 분야) 경향을 더 믿는다 */
const SHRINK = 5

interface Tally {
  sum: Map<string, number>
  total: number
}
const tally = (): Tally => ({ sum: new Map(), total: 0 })
function addTo(t: Tally, st: Map<string, number>, w: number) {
  t.total += w
  for (const [s, x] of st) t.sum.set(s, (t.sum.get(s) ?? 0) + w * x)
}
const shareIn = (t: Tally, s: string) => (t.total ? (t.sum.get(s) ?? 0) / t.total : 0)
/** 학과가 적은 단계의 비율을 윗단계 비율 쪽으로 당긴다 */
const shrink = (t: Tally, s: string, parent: number) => (t.total * shareIn(t, s) + SHRINK * parent) / (t.total + SHRINK)

// 대학 자료에 거의 나오지 않는 과목(정보 교과, 특성화고·마이스터고 전문교과)을 과목 이름으로 이어 주는 규칙.
// 대상은 계열 묶음 id(공학처럼 한 갈래인 묶음) 또는 세부 학과 id(인문·사회·예체능처럼 여러 갈래인 묶음)다.
const PRIOR: [RegExp, string[]][] = [
  [/보안|해킹|암호|포렌식/, ['security', 'edu-computer']],
  [/네트워크|통신/, ['security', 'cs', 'ee-comm', 'ee-electronic', 'edu-computer']],
  [/인공지능|머신 ?러닝|딥 ?러닝|피지컬 컴퓨팅/, ['ai', 'cs', 'edu-computer']],
  [/데이터/, ['ai', 'cs', 'math-stat', 'edu-computer']],
  [/^정보$|정보과학|정보 처리|프로그래밍|소프트웨어|알고리즘|자료 구조|컴퓨터|코딩|웹|운영 체제|시스템 일반/, ['cs', 'ai', 'security', 'edu-computer']],
  [/게임/, ['cs-software', 'art-content']],
  [/전기|전자|회로|반도체|임베디드/, ['ee', 'edu-eng']],
  [/기계|로봇|자동차|자동화|메카트로닉스|제도/, ['mech', 'edu-tech', 'edu-eng']],
  [/건축|건설|토목|측량/, ['arch-arch', 'arch-archeng', 'arch-civil']],
  [/화학 공업|화학 공정|소재|재료/, ['chemeng']],
  [/회계|세무/, ['soc-business', 'soc-accounting']],
  [/경영|마케팅|창업|유통/, ['soc-business']],
  [/금융|보험/, ['soc-business', 'soc-finance', 'soc-econ']],
  [/무역|통상/, ['soc-trade', 'soc-business', 'soc-econ']],
  [/디자인|드로잉/, ['arts-design', 'arts-fashion', 'arts-space', 'art-designtech']],
  [/^미술|조형|미술 창작|미술 이론/, ['arts-fine', 'arts-craft', 'arts-design', 'edu-art']],
  [/영상|미디어|방송|촬영|편집/, ['art-media', 'arts-film', 'soc-media']],
  [/음악|합창|합주|연주|작곡|국악/, ['arts-music', 'arts-korean-music', 'edu-music']],
  [/스포츠|체육|운동/, ['arts-sports', 'arts-sportbiz', 'arts-martial', 'edu-pe']],
  [/간호|보건|의료|인체/, ['nursing']],
  [/식품|조리|제과|제빵|영양/, ['bio-food', 'bio-nutrition', 'bio-culinary', 'edu-home']],
  [/농업|원예|동물|축산|산림|스마트 ?팜/, ['bio-agri', 'bio-forest', 'bio-animal']],
]

/**
 * 과목 이름으로 고른 분야와 얼마나 이어지는가 (0이면 무관).
 * 세부 학과를 골랐으면 그 묶음 규칙도, 묶음을 골랐으면 그 안 세부 학과 규칙도 쓴다.
 * 먼저 고른 분야일수록 무겁게 친다 (보안·컴퓨터·AI 순으로 골랐으면 '컴퓨터 보안'이 '빅 데이터 분석'보다 앞).
 */
function priorFor(subject: string, majors: string[]): number {
  let best = 0
  for (const [re, targets] of PRIOR) {
    if (!re.test(subject)) continue
    const i = majors.findIndex((m) => targets.some((t) => m === t || FINE_BY_ID.get(m)?.parent === t || FINE_BY_ID.get(t)?.parent === m))
    if (i >= 0) best = Math.max(best, Math.max(0.8, 1 - 0.1 * i))
  }
  return best
}

/**
 * 고른 분야에서 과목마다 진로 관련도.
 * skip: 이미 목표로 고른 학과(그 학과 조건은 따로 채우므로 다시 세지 않는다)
 * extra: 학교 편제표에만 있는 과목 이름 (과목 이름으로 본 관련을 매길 대상)
 */
export function fieldScores(units: Unit[], majors: string[], skip: Set<string> = new Set(), extra: Iterable<string> = []): Map<string, FieldScore> {
  const out = new Map<string, FieldScore>()
  if (!majors.length) return out
  const fines = majors.flatMap((m) => FINE_BY_ID.get(m) ?? [])
  const picked = new Set(majors.filter((m) => !FINE_BY_ID.has(m)))
  const related = fines.flatMap((f) => f.related ?? [])
  const relatedFine = new Set(related.filter((r) => FINE_BY_ID.has(r)))
  const relatedGroup = new Set(related.filter((r) => !FINE_BY_ID.has(r)))
  // 가까운 학과를 정해 둔 세부 학과는 그 학과들로, 아니면 같은 계열 묶음으로 보완한다
  const nearGroup = new Set(fines.filter((f) => !f.related?.length).map((f) => f.parent))
  const coarse = coarseOf(majors)
  const fields = new Set([...coarse].map((c) => FIELD_OF.get(c)))
  const bg = background(units)
  // 세 단계로 센다: 고른 학과(세부 학과·묶음) → 가까운 학과 → 같은 큰 분야(공학·자연·의약 …).
  // 학과가 적은 단계는 윗단계 쪽으로 당기고, 다른 계열이 섞인 학과는 섞인 만큼 덜 센다.
  const close = tally()
  const near = tally()
  const wide = tally()
  const namedClose = new Map<string, number>()
  const namedNear = new Map<string, number>()
  const bump = (m: Map<string, number>, s: string) => m.set(s, (m.get(s) ?? 0) + 1)
  for (const u of units) {
    if (skip.has(u.id)) continue
    const st = strengths(u)
    if (!st.size) continue
    const n = Math.max(1, u.majors.length)
    const inWide = u.majors.filter((m) => fields.has(FIELD_OF.get(m))).length / n
    if (inWide) addTo(wide, st, inWide)
    const inField = u.majors.filter((m) => coarse.has(m)).length / n
    if (!inField) continue
    const fu = fineOf(u)
    const isClose = fines.some((f) => fu.includes(f.id)) || u.majors.some((m) => picked.has(m))
    const isNear = !isClose && (fu.some((x) => relatedFine.has(x)) || u.majors.some((m) => relatedGroup.has(m)) || u.majors.some((m) => nearGroup.has(m)))
    if (!isClose && !isNear) continue
    addTo(isClose ? close : near, st, inField)
    if (inField >= 0.5) for (const [s, x] of st) if (x >= 0.5) bump(isClose ? namedClose : namedNear, s)
  }
  for (const s of new Set([...close.sum.keys(), ...near.sum.keys(), ...wide.sum.keys()])) {
    const share = shrink(close, s, shrink(near, s, shareIn(wide, s)))
    const lift = share / Math.max(bg.get(s) ?? 0, 0.02)
    // 고른 학과가 몇 곳 안 되면 가까운 학과가 권한 것도 센다
    const named = (namedClose.get(s) ?? 0) + (close.total < 3 ? (namedNear.get(s) ?? 0) : 0)
    out.set(s, { score: share * Math.min(1, lift / 1.5), share, named, prior: false })
  }
  for (const s of [...SUBJECT_BY_NAME.keys(), ...extra]) {
    const cur = out.get(s)
    const score = PRIOR_SCORE * priorFor(s, majors)
    if (!score || (cur?.score ?? 0) >= score) continue
    out.set(s, { score, share: cur?.share ?? 0, named: cur?.named ?? 0, prior: true })
  }
  return out
}

/** 빈칸 추천으로 낼 만한가: 점수가 충분하고, 두 곳 이상이 이름으로 권했거나 과목 이름으로 관련이 분명하다 */
export const isSuggestible = (f: FieldScore | undefined): f is FieldScore => !!f && f.score >= MIN_SCORE && (f.named >= 2 || f.prior)

export interface Suggestion {
  subject: string
  named: number
  share: number
  prior: boolean
}

const termIndex = (t: string) => (TERMS as readonly string[]).indexOf(t)

/**
 * 선택 칸마다 빈자리에 넣을 과목. 칸마다 목록의 앞쪽 (빈자리 수만큼)이 그 칸 추천이고, 나머지는 더 볼 만한 후보다.
 * - 같은 과목을 두 칸에 내지 않는다 (점수 높은 과목부터 자리를 잡고, 필요하면 앞서 둔 과목을 다른 칸으로 옮긴다)
 * - 앞 과목이 학교에 있으면 그보다 뒤 학기에만 낸다
 * - 학생부교과가 목표면 석차등급이 없는 과목을 뒤로 미룬다
 */
export function groupSuggestions(plan: Plan, scores: Map<string, FieldScore>, opts: { focus?: Focus } = {}): Map<string, Suggestion[]> {
  const out = new Map<string, Suggestion[]>()
  const offered = offerIndex(plan.school)
  const when = new Map<string, number>()
  for (const [s, slot] of plan.taken) when.set(s, termIndex(slot.term))

  const value = (s: string) => {
    let v = scores.get(s)!.score
    if (opts.focus === '교과' && NO_RANK.has(s)) v *= 0.5
    // 앞 과목을 이미 듣고 있으면 이어 듣는 과목을 조금 올린다 (물리학 → 역학과 에너지)
    if ((SUBJECT_BY_NAME.get(s)?.after ?? []).some((b) => when.has(b))) v += 0.05
    return v
  }
  const byValue = (a: string, b: string) => value(b) - value(a) || a.localeCompare(b, 'ko')

  for (const term of TERMS) {
    const groups = plan.groups.filter((g) => g.term === term && g.free > 0)
    if (!groups.length) continue
    const ti = termIndex(term)
    const ok = (s: string) =>
      !when.has(s) &&
      !plan.excluded.has(s) &&
      isSuggestible(scores.get(s)) &&
      (SUBJECT_BY_NAME.get(s)?.after ?? []).every((b) => !offered.has(b) || (when.get(b) ?? Infinity) < ti)

    const cap = new Map(groups.map((g) => [g.group.id, g.free]))
    const at = new Map<string, string>()
    const place = (s: string, seen: Set<string>): boolean => {
      for (const g of groups) {
        const id = g.group.id
        if (!g.group.options.includes(s) || seen.has(id)) continue
        seen.add(id)
        if ((cap.get(id) ?? 0) > 0) {
          cap.set(id, (cap.get(id) ?? 0) - 1)
          at.set(s, id)
          return true
        }
        // 이 칸의 과목 하나를 다른 칸으로 옮길 수 있으면 그 자리에 넣는다
        for (const [t, gid] of [...at]) {
          if (gid !== id) continue
          if (place(t, seen)) {
            at.set(s, id)
            return true
          }
        }
      }
      return false
    }
    const cands = [...new Set(groups.flatMap((g) => g.group.options))].filter(ok).sort(byValue)
    for (const s of cands) place(s, new Set())

    for (const g of groups) {
      const mine = [...at].filter(([, id]) => id === g.group.id).map(([s]) => s)
      const rest = g.group.options.filter((o) => ok(o) && !at.has(o))
      const list = [...mine.sort(byValue), ...rest.sort(byValue)].map((s) => {
        const f = scores.get(s)!
        return { subject: s, named: f.named, share: f.share, prior: f.prior }
      })
      if (list.length) out.set(g.group.id, list)
    }
    for (const s of at.keys()) when.set(s, ti)
  }
  return out
}

/** 두 학기 세트를 아무것도 고르지 않았을 때 진로와 가장 가까운 세트 (없으면 뺀다) */
export function trackSuggestions(plan: Plan, scores: Map<string, FieldScore>): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of plan.tracks) {
    if (t.setIndex !== null) continue
    let best = -1
    let bestScore = 0
    t.track.sets.forEach((set, i) => {
      if (set.items.some((it) => plan.excluded.has(it.subject))) return
      const sc = Math.max(0, ...set.items.map((it) => (isSuggestible(scores.get(it.subject)) ? scores.get(it.subject)!.score : 0)))
      if (sc > bestScore) {
        bestScore = sc
        best = i
      }
    })
    if (best >= 0) out.set(t.track.id, best)
  }
  return out
}

/**
 * 추천 엔진의 동점 처리용 값: 같은 분야 학과들이 그 과목을 권하는 비율.
 * 같은 조건을 채우는 과목끼리 고르는 것이라, 분야 특징(lift)보다 '이 분야에서 얼마나 흔히 듣는가'가 맞다.
 */
export function relevanceOf(scores: Map<string, FieldScore>): Map<string, number> {
  return new Map([...scores].map(([s, f]) => [s, f.prior ? Math.max(f.share, f.score) : f.share]))
}
