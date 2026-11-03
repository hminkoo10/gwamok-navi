import type { Fixed, Group, School, Term, TermId, Track } from '../data/schema'
import { TERMS } from '../data/schema'
import { SUBJECTS, SUBJECT_BY_NAME } from '../data/subjects'

// 학교 편제표를 사람이 입력하거나 AI가 읽어 왔을 때 쓰는 정리·검사 도구.

/** 편제표 표기(Ⓐ, ◯, (A), 띄어쓰기, 로마숫자 등)를 지운 비교용 키 */
export function subjectKey(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[ⒶⒷⒸⓐⓑⓒ◯○●◎]/g, '')
    .replace(/\((?:[A-Ca-c]|공통|일반|진로|융합|택\d)\)/g, '')
    .replace(/II$|Ⅱ|2$/u, '2')
    .replace(/I$|Ⅰ|1$/u, '1')
    .replace(/[\s·ㆍ․.,/\-_]/g, '')
    .toLowerCase()
}

const KEY_TO_NAME = new Map(SUBJECTS.map((s) => [subjectKey(s.name), s.name]))
const KEYS = [...KEY_TO_NAME.keys()]

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]
}

/**
 * 한두 글자만 틀린 긴 과목명(예: '역사 탐구하는 현대 세계')을 표준 이름으로 고친다.
 * 짧은 이름이나 '물리학Ⅰ'·'화법과 작문'처럼 실제로 다른 과목은 건드리지 않도록 기준을 높게 둔다.
 */
function nearest(key: string): string | null {
  if (key.length < 5) return null
  let best = ''
  let bestScore = 0
  let second = 0
  for (const k of KEYS) {
    const score = 1 - distance(key, k) / Math.max(key.length, k.length)
    if (score > bestScore) {
      second = bestScore
      bestScore = score
      best = k
    } else if (score > second) second = score
  }
  return bestScore >= 0.85 && bestScore - second >= 0.08 ? (KEY_TO_NAME.get(best) ?? null) : null
}

/** 편제표에 적힌 과목명을 과목 목록의 정식 이름으로 맞춘다. 못 찾으면 known=false로 원래 이름(정리만)을 돌려준다. */
export function matchSubject(raw: string): { name: string; known: boolean; fixedFrom?: string } {
  const cleaned = raw
    .normalize('NFC')
    .replace(/[ⒶⒷⒸⓐⓑⓒ◯○●◎]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (SUBJECT_BY_NAME.has(cleaned)) return { name: cleaned, known: true }
  const key = subjectKey(cleaned)
  const hit = KEY_TO_NAME.get(key)
  if (hit) return { name: hit, known: true }
  const near = nearest(key)
  return near ? { name: near, known: true, fixedFrom: cleaned } : { name: cleaned, known: false }
}

export interface SchoolIssue {
  level: 'error' | 'warn'
  term?: TermId
  message: string
}

export interface SchoolCheck {
  issues: SchoolIssue[]
  unknown: string[]
  credits: Record<TermId, number>
}

/**
 * 학기 학점 합계. chosen: 세트 묶음마다 고른 세트 번호 (school.tracks 순서, 계획의 plan.tracks[i].setIndex와 같다).
 * 고르지 않은 묶음은 첫 세트로 센다
 */
export function termCredits(school: School, term: TermId, chosen?: readonly (number | null | undefined)[]): number {
  const t = school.terms.find((x) => x.id === term)
  let credits = 0
  if (t) {
    credits += t.fixed.reduce((a, f) => a + f.credits, 0)
    credits += t.groups.reduce((a, g) => a + g.pick * g.credits, 0)
  }
  school.tracks.forEach((tr, i) => {
    const pick = chosen?.[i]
    const set = (typeof pick === 'number' ? tr.sets[pick] : undefined) ?? tr.sets[0]
    credits += (set?.items ?? []).filter((it) => it.term === term).reduce((a, it) => a + it.credits, 0)
  })
  return credits
}

export function checkSchool(school: School): SchoolCheck {
  const issues: SchoolIssue[] = []
  const names = new Set<string>()

  if (!school.name.trim()) issues.push({ level: 'error', message: '학교 이름이 비어 있어요.' })

  for (const t of school.terms) {
    const seen = new Set<string>()
    for (const f of t.fixed) {
      names.add(f.subject)
      if (f.alt) names.add(f.alt)
      if (seen.has(f.subject)) issues.push({ level: 'warn', term: t.id, message: `${f.subject}이(가) 두 번 들어 있어요.` })
      seen.add(f.subject)
      if (!(f.credits > 0)) issues.push({ level: 'error', term: t.id, message: `${f.subject}의 학점이 비어 있어요.` })
    }
    for (const g of t.groups) {
      for (const o of g.options) names.add(o)
      if (g.options.length === 0) issues.push({ level: 'error', term: t.id, message: `${g.label || '선택 묶음'}에 과목이 없어요.` })
      if (!(g.pick >= 1)) issues.push({ level: 'error', term: t.id, message: `${g.label || '선택 묶음'}의 선택 개수가 비어 있어요.` })
      if (g.pick > g.options.length)
        issues.push({ level: 'error', term: t.id, message: `${g.label || '선택 묶음'}: 택${g.pick}인데 과목이 ${g.options.length}개뿐이에요.` })
      if (new Set(g.options).size !== g.options.length)
        issues.push({ level: 'warn', term: t.id, message: `${g.label || '선택 묶음'}에 같은 과목이 두 번 있어요.` })
      if (!(g.credits > 0)) issues.push({ level: 'error', term: t.id, message: `${g.label || '선택 묶음'}의 학점이 비어 있어요.` })
    }
  }
  for (const tr of school.tracks) {
    if (tr.sets.length < 2) issues.push({ level: 'warn', message: `${tr.label}: 세트가 하나뿐이에요.` })
    for (const set of tr.sets) for (const it of set.items) names.add(it.subject)
    // 세트마다 한 학기 학점이 다르면 학기 합계가 어느 세트를 고르느냐에 따라 달라진다
    for (const term of TERMS) {
      const sums = tr.sets.map((s) => s.items.filter((it) => it.term === term).reduce((a, it) => a + it.credits, 0))
      if (sums.some((x) => x > 0) && new Set(sums).size > 1)
        issues.push({
          level: 'warn',
          term,
          message: `${tr.label}: 세트마다 이 학기 학점이 달라요 (${tr.sets.map((s, i) => `${s.label} ${sums[i]}학점`).join(', ')}). 학기 합계는 첫 세트로 셌어요.`,
        })
    }
  }

  // 모두 듣는 과목이 선택 묶음·세트에도 있으면 그 칸에서는 고를 수 없다 (이미 듣는 과목)
  const fixedSubjects = new Set(school.terms.flatMap((t) => t.fixed.flatMap((f) => (f.alt ? [f.subject, f.alt] : [f.subject]))))
  const doubled = new Set<string>()
  const alsoFixed = (subject: string, term: TermId, where: string) => {
    if (!fixedSubjects.has(subject) || doubled.has(subject)) return
    doubled.add(subject)
    issues.push({
      level: 'warn',
      term,
      message: `${subject}은(는) 모두 듣는 과목인데 ${where}에도 들어 있어요. 이미 듣는 과목이라 그 칸에서는 고를 수 없어요.`,
    })
  }
  for (const t of school.terms) {
    // 같은 학기 선택 묶음 두 곳에 같은 과목이 있으면 한 곳에서만 들을 수 있다
    const inGroup = new Map<string, string>()
    for (const g of t.groups)
      for (const o of new Set(g.options)) {
        const label = g.label || '선택 묶음'
        alsoFixed(o, t.id, label)
        const other = inGroup.get(o)
        if (other !== undefined) issues.push({ level: 'warn', term: t.id, message: `${o}이(가) 같은 학기 선택 묶음 두 곳(${other}, ${label})에 들어 있어요.` })
        else inGroup.set(o, label)
      }
  }
  for (const tr of school.tracks) for (const set of tr.sets) for (const it of set.items) alsoFixed(it.subject, it.term, `${tr.label}의 ${set.label}`)

  const credits = Object.fromEntries(TERMS.map((t) => [t, termCredits(school, t)])) as Record<TermId, number>
  const used = TERMS.filter((t) => credits[t] > 0)
  const values = used.map((t) => credits[t])
  if (values.length > 1 && Math.max(...values) - Math.min(...values) > 4)
    issues.push({ level: 'warn', message: '학기별 학점 합계 차이가 커요. 빠진 과목이나 학점이 틀린 칸이 없는지 확인하세요.' })

  const unknown = [...names].filter((n) => !SUBJECT_BY_NAME.has(n))
  return { issues, unknown, credits }
}

// ---------------------------------------------------------------------------
// AI가 읽어 온 결과처럼 모양이 확실하지 않은 데이터를 School로 바꾼다. 모르는 필드는 버린다.

const isTerm = (x: unknown): x is TermId => typeof x === 'string' && (TERMS as string[]).includes(x)
const str = (x: unknown, max = 40) => (typeof x === 'string' ? x.trim().slice(0, max) : '')
/** 반올림해 1~39 정수. 아니면 fallback (0.4처럼 반올림해 0이 되는 값도) */
const num = <T>(x: unknown, fallback: T): number | T => {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number.parseFloat(x) : Number.NaN
  const r = Math.round(n)
  return Number.isFinite(n) && r >= 1 && r < 40 ? r : fallback
}
// 공유 링크로 들어온 데이터도 이 함수를 거치므로 개수에 상한을 둔다
const arr = (x: unknown, max = 40): unknown[] => (Array.isArray(x) ? x.slice(0, max) : [])

/**
 * strict: AI가 읽어 온 결과. 학점을 읽지 못한 과목·묶음은 3학점으로 채우지 않고 뺀다 (합계 검사가 빠진 곳을 잡게).
 * 저장해 둔 설계·공유 링크는 예전처럼 3학점으로 채운다
 */
export function schoolFromLoose(raw: unknown, meta: { id: string; name: string; region: string; cohort: number }, opts: { strict?: boolean } = {}): School {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const credit = (x: unknown) => num(x, opts.strict ? null : 3)
  const terms: Term[] = TERMS.map((id) => ({ id, fixed: [], groups: [] }))
  const byId = new Map(terms.map((t) => [t.id, t]))
  let groupSeq = 0

  for (const tRaw of arr(r.terms, 12)) {
    const t = (tRaw ?? {}) as Record<string, unknown>
    const id = isTerm(t.id) ? t.id : isTerm(t.term) ? t.term : null
    if (!id) continue
    const term = byId.get(id)!
    for (const fRaw of arr(t.fixed, 30)) {
      const f = (fRaw ?? {}) as Record<string, unknown>
      const subject = matchSubject(str(f.subject)).name
      if (!subject) continue
      const alt = str(f.alt) ? matchSubject(str(f.alt)).name : undefined
      const credits = credit(f.credits)
      if (credits === null) continue
      const fixed: Fixed = alt ? { subject, credits, alt } : { subject, credits }
      term.fixed.push(fixed)
    }
    for (const gRaw of arr(t.groups, 12)) {
      const g = (gRaw ?? {}) as Record<string, unknown>
      const options = [
        ...new Set(
          arr(g.options)
            .map((o) => matchSubject(str(o)).name)
            .filter(Boolean),
        ),
      ]
      const credits = credit(g.credits)
      if (!options.length || credits === null) continue
      groupSeq++
      const group: Group = {
        id: `${id}-g${groupSeq}`,
        label: str(g.label) || '선택',
        pick: Math.min(num(g.pick, 1), options.length),
        credits,
        options,
      }
      term.groups.push(group)
    }
  }

  const tracks: Track[] = []
  for (const trRaw of arr(r.tracks, 6)) {
    const tr = (trRaw ?? {}) as Record<string, unknown>
    const sets = arr(tr.sets, 6)
      .map((sRaw) => {
        const s = (sRaw ?? {}) as Record<string, unknown>
        const items = arr(s.items, 6)
          .map((iRaw) => {
            const it = (iRaw ?? {}) as Record<string, unknown>
            const term = isTerm(it.term) ? it.term : null
            const subject = matchSubject(str(it.subject)).name
            const credits = credit(it.credits)
            return term && subject && credits !== null ? { term, subject, credits } : null
          })
          .filter((x): x is { term: TermId; subject: string; credits: number } => x !== null)
        return { label: str(s.label) || '세트', items }
      })
      .filter((s) => s.items.length)
    if (sets.length) tracks.push({ id: `track-${tracks.length + 1}`, label: str(tr.label) || '세트 선택', sets })
  }

  return {
    id: meta.id,
    name: meta.name,
    region: meta.region,
    cohort: meta.cohort,
    source: { title: '직접 입력', url: '' },
    checked: new Date().toISOString().slice(0, 10),
    terms,
    tracks,
    notes: [],
  }
}

export function emptySchool(meta: { id: string; name: string; region: string; cohort: number }): School {
  return schoolFromLoose({}, meta)
}
