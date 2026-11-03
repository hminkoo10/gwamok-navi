import { MAJOR_BY_ID } from '../data/majors'
import type { AdmissionPlan, AdmissionTrack, Clause, Unit } from '../data/schema'
import { SUBJECTS } from '../data/subjects'

// 목표 전형에 따라 과목 추천을 바꾼다.
// - 학생부종합: 대학이 발표한 학과별 권장과목 (서류평가에서 과목 이수를 본다)
// - 학생부교과: 권장과목은 그대로, 석차등급이 나오지 않는 과목을 따로 알린다
// - 논술: 목표 대학 논술 출제 범위 과목을 조건으로 더한다 (대학 시행계획에서 옮긴 범위)
// - 정시: 2028 수능 출제 과목을 조건으로 더한다
// 근거: 교육부 「2028 대학입시제도 개편 확정안」(2023-12-27)

export type Focus = '종합' | '교과' | '논술' | '정시'

export const FOCUSES: { id: Focus; label: string; help: string }[] = [
  { id: '종합', label: '학생부종합', help: '대학이 학과마다 발표한 권장과목을 채워요. 서류평가에서 어떤 과목을 들었는지 살피는 전형이에요.' },
  {
    id: '교과',
    label: '학생부교과',
    help: '권장과목은 그대로 채우고, 석차등급이 나오지 않는 과목을 표시해요. 교과 전형은 등급으로 성적을 계산하는 대학이 많아요.',
  },
  { id: '논술', label: '논술', help: '목표 대학 논술 출제 범위에 드는 과목을 조건에 더해요. 범위는 대학 시행계획에 적힌 대로예요.' },
  { id: '정시', label: '정시(수능)', help: '2028 수능에 나오는 국어·수학·영어 과목을 조건에 더해요. 대학마다 영역별 반영 비율도 함께 보여 줘요.' },
]

export const FOCUS_IDS = FOCUSES.map((f) => f.id)

/** 2022 개정 교육과정: 사회·과학 융합선택 9과목은 석차등급 없이 성취도(A~E)만 나온다 */
export const NO_RANK = new Set([
  '여행지리',
  '역사로 탐구하는 현대 세계',
  '사회문제 탐구',
  '금융과 경제생활',
  '윤리문제 탐구',
  '기후변화와 지속가능한 세계',
  '과학의 역사와 문화',
  '기후변화와 환경생태',
  '융합과학 탐구',
])

/** 2028 수능 영역별 출제 과목 (탐구는 1학년 공통과목) */
export const SUNEUNG_2028: { area: string; subjects: string[] }[] = [
  { area: '국어', subjects: ['화법과 언어', '독서와 작문', '문학'] },
  { area: '수학', subjects: ['대수', '미적분Ⅰ', '확률과 통계'] },
  { area: '영어', subjects: ['영어Ⅰ', '영어Ⅱ'] },
  { area: '탐구', subjects: ['통합사회1', '통합사회2', '통합과학1', '통합과학2'] },
]

export const isExamUnit = (id: string) => id.startsWith('exam:')

/** 큰 분야마다 정시 묶음 이름에 나오는 말 */
const GROUP_WORDS: Record<string, RegExp> = {
  공학: /공학|공과|자연|이공|이과|소프트웨어|정보|IT/,
  자연: /자연|이과|이학|과학|이공/,
  의약: /의예|의학|의과|치의|치과|한의|약학|약대|간호|수의|자연/,
  인문사회: /인문|사회|경영|경상|상경|법|어문|국제/,
  교육: /사범|교육/,
  예체능: /예체능|예능|체능|체육|미술|음악|무용|디자인|연극|영화|예술/,
  융합: /자연|인문|자유|자율|융합/,
}

/**
 * 한 대학의 정시 반영 묶음 가운데 고른 학과가 드는 묶음.
 * 1) 묶음 설명에 학과 이름이 그대로 있으면 그 묶음
 * 2) 아니면 묶음 이름에 학과의 큰 분야 말(자연·공과·인문 …)이 있는 묶음
 * 3) 그래도 없으면 묶음 설명으로 본다 ('인문계열, 자연계열 간호학과'처럼 설명에는 다른 계열 말이 섞이기 쉬워 마지막에)
 */
export function myGroups<R extends { group: string; units: string | null }>(rules: R[], units: Unit[], fieldOf: (major: string) => string | undefined): Set<R> {
  const flat = (s: string) => s.replace(/\s+/g, '')
  const names = units.map((u) => flat(u.name.replace(/\(.*?\)/g, ''))).filter((n) => n.length >= 3)
  const byName = rules.filter((r) => names.some((n) => flat(`${r.group}${r.units ?? ''}`).includes(n)))
  if (byName.length) return new Set(byName)
  const fields = [...new Set(units.flatMap((u) => u.majors.map(fieldOf)).filter((f): f is string => !!f))]
  const hit = (text: string) => fields.some((f) => GROUP_WORDS[f]?.test(flat(text)))
  const byGroup = rules.filter((r) => hit(r.group))
  if (byGroup.length) return new Set(byGroup)
  return new Set(rules.filter((r) => hit(r.units ?? '')))
}

/**
 * 목표 전형에서 학과 하나의 권장과목을 어떻게 다루는지.
 * - record: 서류·정성평가로 학생부를 본다 → 권장과목 이수가 평가에 들어가 조건에 넣는다
 * - grades: 학생부 교과 성적(정량)만 본다 → 어떤 과목을 들었는지는 보지 않아 뺀다
 * - exam: 수능·논술·실기만 본다 → 뺀다
 * - none: 이 학과는 목표 전형으로 뽑지 않는다 → 다른 전형(학생부종합)으로 지원하게 되니 넣는다
 * - all: 학생부종합이 목표
 */
export interface UnitRoute {
  unit: Unit
  keep: boolean
  kind: 'all' | 'record' | 'grades' | 'exam' | 'none'
  /** 판단에 쓴 전형 이름 */
  tracks: string[]
}

const QUALITATIVE = /정성|역량평가|충실도|종합평가|서류평가|교과평가|학생부평가/

/** 전형이 학생부를 어떻게 보는가. 전형 방법 글은 첫 문장(예외 모집단위 설명 앞)만 본다 */
export function recordUse(t: AdmissionTrack): 'record' | 'grades' | 'exam' {
  const head = t.method.split(/\.\s| \/ /)[0]
  if (t.elements.includes('서류') || QUALITATIVE.test(head)) return 'record'
  if (t.elements.includes('교과')) return 'grades'
  return 'exam'
}

/**
 * 고른 학과마다 목표 전형에서 권장과목을 넣을지.
 * seats: 그 대학의 학과별 모집인원 (있으면 그 학과를 실제로 뽑는 전형만 본다)
 */
export function unitRoutes(
  focus: Focus,
  units: Unit[],
  byUniv: Map<string, AdmissionPlan>,
  seats: Record<string, Record<string, Record<string, number | null>>> | null = null,
): UnitRoute[] {
  return units.map((unit): UnitRoute => {
    if (focus === '종합') return { unit, keep: true, kind: 'all', tracks: [] }
    const ofFocus = (t: AdmissionTrack) => (focus === '정시' ? t.period === '정시' : t.type === focus)
    let tracks = (byUniv.get(unit.univ)?.tracks ?? []).filter((t) => ofFocus(t) && t.quota === '정원내')
    const row = seats?.[unit.univ]?.[unit.id]
    if (row) tracks = tracks.filter((t) => t.id in row && row[t.id] !== 0)
    if (!tracks.length) return { unit, keep: true, kind: 'none', tracks: [] }
    // 모집인원으로 무게를 둔다 (학과별 인원이 있으면 그 학과 인원, 없으면 전형 인원). 작은 전형 하나 때문에 판단이 뒤집히지 않게
    const weight = (t: AdmissionTrack) => {
      const n = row?.[t.id]
      return typeof n === 'number' && n > 0 ? n : row ? 1 : (t.seats ?? 1)
    }
    const sum = { record: 0, grades: 0, exam: 0 }
    for (const t of tracks) sum[recordUse(t)] += weight(t)
    const total = sum.record + sum.grades + sum.exam
    const kind = sum.record / total >= 0.25 ? 'record' : sum.grades >= sum.exam ? 'grades' : 'exam'
    return { unit, keep: kind === 'record', kind, tracks: tracks.filter((t) => recordUse(t) === kind).map((t) => t.name) }
  })
}

// 교양 과목(논술·철학·심리학 등)은 출제 범위 글에서 흔한 낱말이라 뺀다
const ELECTIVES = SUBJECTS.filter((s) => s.kind !== '공통' && s.kind !== '기타' && s.area !== '교양').map((s) => s.name)

/** 띄어쓰기를 지운 글 (대학 글에는 '확률과통계', '화법과언어'처럼 붙여 쓴 과목명이 섞여 있다) */
const flat = (s: string) => s.replace(/\s+/g, '')
const ELECTIVE_KEYS = ELECTIVES.map((name) => ({ name, key: flat(name) })).sort((a, b) => b.key.length - a.key.length)

/** 글(띄어쓰기를 지운 것)에서 과목 이름이 나오는 자리. 긴 이름부터, 겹치면 긴 쪽 */
function findSubjects(text: string): { name: string; start: number; end: number }[] {
  const used = new Uint8Array(text.length)
  const out: { name: string; start: number; end: number }[] = []
  for (const { name, key } of ELECTIVE_KEYS)
    for (let at = text.indexOf(key); at >= 0; at = text.indexOf(key, at + 1)) {
      if (used.subarray(at, at + key.length).some(Boolean)) continue
      used.fill(1, at, at + key.length)
      out.push({ name, start: at, end: at + key.length })
    }
  return out.sort((a, b) => a.start - b.start)
}

/** 글에서 2022 개정 선택과목 이름을 찾는다 (긴 이름부터, 겹치면 긴 쪽, 띄어쓰기는 보지 않는다) */
export function subjectsIn(text: string): string[] {
  return [...new Set(findSubjects(flat(text)).map((x) => x.name))]
}

/** 글 한 덩어리의 출제 과목을 조건으로: '물리학·화학·생명과학 중 택1'은 그중 1과목, 나머지는 모두 */
function clausesOf(text: string): Clause[] {
  const t = flat(text)
  const found = findSubjects(t)
  const inPick = new Set<number>()
  const picks: Clause[] = []
  for (const m of t.matchAll(/(?:중|가운데)(?:에서)?택(\d+)|(?:중|가운데)(?:에서)?(\d+)과목/g)) {
    const n = Number(m[1] ?? m[2])
    // '중 택N' 바로 앞에 '·'나 쉼표로만 이어진 과목들
    const run: number[] = []
    let end = m.index
    for (let q = found.length - 1; q >= 0; q--) {
      if (found[q].end > end || inPick.has(q)) continue
      if (t.slice(found[q].end, end).replace(/[·ㆍ,/、]|및|또는/g, '')) break
      run.unshift(q)
      end = found[q].start
    }
    if (run.length <= n) continue
    for (const q of run) inPick.add(q)
    picks.push({ pick: n, subjects: run.map((q) => found[q].name) })
  }
  const rest = [...new Set(found.filter((_, q) => !inPick.has(q)).map((f) => f.name))]
  const note = text.trim()
  if (rest.length) return [{ pick: 'all', subjects: rest, text: note }, ...picks]
  return picks.length === 1 ? [{ ...picks[0], text: note }] : picks
}

/** 의약 계열은 학과마다 논술이 갈리는 일이 많아(의예만 과학논술 등) 큰 분야 말보다 좁게 본다 */
const MAJOR_WORDS: Record<string, RegExp> = {
  med: /의(?=·)|의예|의학|의과|의대|치의|치과|한의/,
  pharm: /약학|약대|약과/,
  nursing: /간호|보건/,
  vet: /수의/,
}
const ANY_FIELD = new RegExp(
  Object.values(GROUP_WORDS)
    .map((r) => r.source)
    .join('|'),
)
/** '인문계열', '자연계열Ⅱ(의예·치의예·수의예)', '의·약학계', '인문·체육계·사회계' 같은 계열 이름 */
const TRACK_WORD = /[가-힣]+(?:·[가-힣]+)*계(?:열)?(?:[ⅠⅡⅢ]|[1-3])?(?:\([^)]*\))?/g
/** '인문:', '자연:' 같은 머리말 */
const TRACK_HEAD = /(^|[\s.,])([가-힣]+(?:·[가-힣]+)*):/g
const stemOf = (word: string) => word.replace(/\(.*$/, '')
/** 괄호 속 학과를 '포함'하는 게 아니라 그 학과로 좁히는 계열 이름이거나, 의약 학과 이름이 든 계열 이름 (예: 의·약학계, 자연계열Ⅱ(의예·…)) */
const narrowWord = (word: string) => /\((?![^)]*포함)[^)]+\)/.test(word) || Object.values(MAJOR_WORDS).some((r) => r.test(stemOf(word)))

interface EssayPart {
  /** 덩어리를 연 계열 이름 (없으면 학과 이름으로만 본다) */
  word: string | null
  /**
   * 학과 이름을 찾을 글 (띄어쓰기·가운뎃점을 지운 것): 계열 이름이 있으면 그 이름과 괄호(예: '(약학과 포함)'),
   * 없으면 첫 과목 앞까지의 글 (예: '수리논술(공과대학·AI융합대학 …):'). 본문은 보지 않는다 ('수학과 의학논술'의 '수학과'를 학과로 읽지 않게)
   */
  lead: string
  clauses: Clause[]
}

/** 괄호 안쪽인지 */
const inParen = (s: string, at: number) => {
  let depth = 0
  for (let q = 0; q < at; q++) depth += s[q] === '(' ? 1 : s[q] === ')' ? -1 : 0
  return depth > 0
}

/** 논술 출제 범위 글을 계열마다 나눈다. ' / '로 나뉜 덩어리마다, 그 안에서 계열 이름이 나올 때마다 새 덩어리로 본다 */
function essayParts(text: string): EssayPart[] {
  const out: EssayPart[] = []
  for (const seg of text.split(/\s\/\s/)) {
    const marks = [
      ...[...seg.matchAll(TRACK_WORD)].map((m) => ({ at: m.index, word: m[0] })),
      ...[...seg.matchAll(TRACK_HEAD)].map((m) => ({ at: m.index + m[1].length, word: m[2] })),
    ]
      .filter(({ at, word }) => !inParen(seg, at) && ANY_FIELD.test(flat(stemOf(word))))
      .sort((a, b) => a.at - b.at)
      .filter((x, k, list) => k === 0 || x.at >= list[k - 1].at + list[k - 1].word.length)
    // 첫 계열 이름 앞의 글(시험 시간 같은 안내)은 첫 덩어리에 붙인다
    const pieces = marks.length
      ? marks.map((x, k) => ({ word: x.word, text: seg.slice(k ? x.at : 0, marks[k + 1]?.at ?? seg.length) }))
      : [{ word: null, text: seg }]
    for (const { word, text: piece } of pieces) {
      const t = flat(piece)
      const first = findSubjects(t)[0]
      const lead = word === null ? t.slice(0, first ? first.start : t.length) : flat(word)
      out.push({ word, lead: lead.replace(/[·ㆍ]/g, ''), clauses: clausesOf(piece) })
    }
  }
  return out
}

const plainName = (s: string) => s.replace(/[\s·ㆍ]/g, '')
/** 학과 이름 (괄호와 '전 모집단위'를 뺀 것) 또는 흔한 끝말을 뗀 앞부분이 글에 있는지 */
function nameIn(unit: Unit, lead: string): boolean {
  const name = plainName(unit.name.replace(/\(.*?\)/g, '').replace(/전\s*모집단위/g, ''))
  if (name.length < 3) return false
  if (lead.includes(name)) return true
  const stem = name.replace(/(시스템공학과|공학과|학과|학부|대학|전공)$/, '')
  return stem.length >= 4 && stem !== name && lead.includes(stem)
}

/** 학과 하나가 덩어리에 얼마나 들어맞는지 (0이면 아니다) */
function partScore(unit: Unit, part: EssayPart): number {
  const name = nameIn(unit, part.lead)
  const major = unit.majors.some((m) => MAJOR_WORDS[m]?.test(part.word ?? part.lead))
  const paren = [...unit.name.matchAll(/\((.*?)\)/g)].some((m) => plainName(m[1]).length >= 2 && part.lead.includes(plainName(m[1])))
  const own = (name ? 3 : 0) + (major ? 2 : 0) + (paren ? 1 : 0)
  if (!part.word) return name || major ? own : 0
  // 특정 학과로 좁힌 계열이면 그 학과가 아닌 단위는 들지 않는다 (자연계열Ⅱ(의예·…)에 약학대학이 들지 않게)
  if (narrowWord(part.word) && !name && !major) return 0
  const field = unit.majors.some((m) => {
    const f = MAJOR_BY_ID.get(m)?.field
    return !!f && !!GROUP_WORDS[f]?.test(flat(stemOf(part.word!)))
  })
  return own + (field ? 1 : 0)
}

/** 학과들이 치르는 덩어리: 학과마다 가장 잘 맞는 덩어리 (같으면 모두) */
function partsFor(parts: EssayPart[], units: Unit[]): EssayPart[] {
  // 계열 구분 없는 글 하나면 모두가 치른다
  if (parts.length === 1 && !parts[0].word) return parts
  const out = new Set<EssayPart>()
  for (const u of units) {
    const scores = parts.map((p) => partScore(u, p))
    const top = Math.max(0, ...scores)
    if (top > 0) parts.forEach((p, k) => scores[k] === top && out.add(p))
  }
  return parts.filter((p) => out.has(p))
}

/**
 * 목표 전형에 따라 더 채울 조건 (모집단위처럼 다루는 가짜 단위).
 * units: 고른 학과. 논술은 대학이 계열마다 범위를 다르게 정하므로(인문: 국어·사회 / 자연: 수학) 고른 학과의 계열 범위만 넣는다.
 * 그 대학 학과를 고르지 않았으면 다른 대학에서 고른 학과의 계열로 본다. 주지 않으면 계열을 가리지 않고 모든 범위를 넣는다 (예전 방식)
 */
export function focusUnits(focus: Focus, univs: string[], byUniv: Map<string, AdmissionPlan>, units?: Unit[]): Unit[] {
  if (focus === '정시')
    return [
      {
        id: 'exam:suneung',
        univ: '',
        name: '2028 수능 출제 과목',
        majors: [],
        clauses: SUNEUNG_2028.slice(0, 3).map((a) => ({ pick: 'all' as const, subjects: a.subjects, text: `수능 ${a.area}: ${a.subjects.join(', ')}` })),
      },
    ]
  if (focus === '논술') {
    const out: Unit[] = []
    for (const univ of univs) {
      const essays = (byUniv.get(univ)?.tracks ?? []).filter((t) => t.type === '논술' && t.essay).map((t) => t.essay!)
      const mine = units?.filter((u) => u.univ === univ) ?? []
      const who = mine.length ? mine : (units ?? [])
      const clauses: Clause[] = []
      const seen = new Set<string>()
      for (const essay of essays) {
        const parts = essayParts(essay)
        for (const p of who.length ? partsFor(parts, who) : parts)
          for (const c of p.clauses) {
            const key = `${c.pick}|${[...c.subjects].sort().join(',')}`
            if (seen.has(key)) continue
            seen.add(key)
            clauses.push(c)
          }
      }
      if (clauses.length) out.push({ id: `exam:essay:${univ}`, univ, name: '논술 출제 범위', majors: [], clauses })
    }
    return out
  }
  return []
}
