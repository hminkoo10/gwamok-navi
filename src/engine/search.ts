import { FINE_BY_ID, FINE_MAJORS, type FineMajor, MAJORS } from '../data/majors'
import type { Major, Unit } from '../data/schema'
import { UNITS } from '../data/units'

/** 띄어쓰기·대소문자·로마숫자 차이를 없앤 비교용 문자열 */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/Ⅰ/g, '1')
    .replace(/Ⅱ/g, '2')
    .replace(/[\s·ㆍ,.()/_-]/g, '')
}

/** '사회과학대학(사회학과, 심리학과 제외)'처럼 빼는 학과를 적은 괄호 */
const EXCLUDED = /\(([^()]*)제외[^()]*\)/g

const fineCache = new Map<string, { fine: string[]; excluded: string[] }>()

function finesOf(u: Unit) {
  let v = fineCache.get(u.id)
  if (!v) {
    const test = (text: string) => {
      const name = norm(text)
      return name ? FINE_MAJORS.filter((f) => u.majors.includes(f.parent) && f.match.test(name)).map((f) => f.id) : []
    }
    const excluded = [...u.name.matchAll(EXCLUDED)].map((m) => m[1]).join(' ')
    v = { fine: test(u.name.replace(EXCLUDED, '')), excluded: test(excluded) }
    fineCache.set(u.id, v)
  }
  return v
}

/** 모집단위가 드는 세부 학과 (그 모집단위의 계열 묶음 안에서 이름으로 고른다. '(… 제외)' 괄호 속 학과 이름은 보지 않는다) */
export function fineOf(u: Unit): string[] {
  return finesOf(u).fine
}

/** 이 묶음 안에서 어느 세부 학과에도 들지 않는 넓은 모집단위인지 (공과대학, 자연계열 전 모집단위 등) */
const broadIn = (u: Unit, parent: string) => u.majors.includes(parent) && !fineOf(u).some((id) => FINE_BY_ID.get(id)?.parent === parent)

/**
 * 사범 계열의 넓은 모집단위('사범대학(자연계열)', '자연 전 모집단위' 등)는 함께 적힌 과목 계열에 맞는 교육 세부 학과에만 든다
 * (수학·과학 조건이 국어교육으로 새지 않게). 과목 계열 없이 '사범대학 전 모집단위'처럼 적힌 것은 모든 교육 세부 학과에 든다.
 */
function eduFits(u: Unit, fine: FineMajor): boolean {
  const subjects = u.majors.filter((m) => m !== 'edu' && m !== 'free')
  if (!subjects.length) return true
  const fields = new Set((fine.related ?? []).map((r) => FINE_BY_ID.get(r)?.parent ?? r))
  return subjects.some((m) => fields.has(m))
}

/** 계열 묶음 또는 세부 학과의 모집단위. 세부 학과면 그 묶음의 넓은 모집단위도 함께 (넓은 모집단위가 뺀다고 적은 학과는 빼고) */
export function unitsOf(majorId: string): Unit[] {
  const fine = FINE_BY_ID.get(majorId)
  if (!fine) return UNITS.filter((u) => u.majors.includes(majorId))
  return UNITS.filter(
    (u) => fineOf(u).includes(majorId) || (broadIn(u, fine.parent) && !finesOf(u).excluded.includes(majorId) && (fine.parent !== 'edu' || eduFits(u, fine))),
  )
}

export interface SearchHit {
  major: Major
  score: number
  matched: string[]
}

/** 한 글자 낱말 뒤에 붙을 수 있는 조사 ('별을', '법이') */
const JOSA = /^(?:이|가|을|를|은|는|의|에|에서|에게|로|으로|과|와|도|만|나|이나|랑|이랑|처럼|까지|부터)?$/

/**
 * 진로 문장에 검색 낱말이 있는지. 두 글자 이상 한글 낱말은 붙여 쓴 글에서도 찾는다.
 * 한 글자 낱말('법', '별', '열')은 다른 말 속에서 찾지 않는다 ('마법'의 법, '특별한'의 별): 띄어 쓴 낱말 그대로이거나 뒤에 조사만 붙은 경우만 센다.
 * 알파벳 낱말('AI', 'IT')은 앞뒤에 다른 알파벳이 붙어 있지 않을 때만 센다 ('aircraft'의 ai가 아니게)
 */
function hasKeyword(query: string, q: string, keyword: string): boolean {
  const k = norm(keyword)
  if (!k) return false
  if (/^[a-z0-9]+$/.test(k)) return new RegExp(`(?<![a-z])${k}(?![a-z])`).test(q)
  if (k.length >= 2) return q.includes(k)
  return query
    .toLowerCase()
    .split(/[\s·ㆍ,.()/_\-!?~'"]+/)
    .some((word) => word.startsWith(k) && JOSA.test(word.slice(k.length)))
}

/**
 * 진로 문장이나 학과 이름에서 세부 학과를 찾는다. AI 없이 쓰는 기본 검색.
 * "게임 만드는 개발자" → 게임·콘텐츠, 소프트웨어 …
 */
export function searchMajors(query: string): SearchHit[] {
  const q = norm(query)
  if (!q) return []
  const hits: SearchHit[] = []
  for (const major of [...FINE_MAJORS, ...MAJORS]) {
    const matched = new Set<string>()
    let score = 0
    if (norm(major.name).includes(q) || q.includes(norm(major.name))) {
      score += 3
      matched.add(major.name)
    }
    for (const k of major.keywords) {
      if (hasKeyword(query, q, k) || (q.length >= 2 && norm(k).includes(q))) {
        score += 2
        matched.add(k)
      }
    }
    // 세부 학과는 그 학과에 드는 모집단위 이름으로도 찾는다 (넓은 모집단위는 빼고)
    if (FINE_BY_ID.has(major.id)) {
      for (const u of UNITS) {
        if (!fineOf(u).includes(major.id)) continue
        const n = norm(u.name.replace(/\(.*?\)/g, ''))
        if (n.length >= 2 && (q.includes(n) || n.includes(q))) {
          score += 1
          matched.add(u.name)
        }
      }
    }
    // 같은 점수면 세부 학과를 앞에
    if (score > 0) hits.push({ major, score: score + (FINE_BY_ID.has(major.id) ? 0.5 : 0), matched: [...matched].slice(0, 4) })
  }
  return hits.sort((a, b) => b.score - a.score)
}
