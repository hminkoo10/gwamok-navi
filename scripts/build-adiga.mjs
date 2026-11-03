// 대교협 「2028 모집단위별 반영과목 및 대학별 권장과목 자료집」을 옮긴 원본(data-src/adiga2028/*.json)을
// 앱이 쓰는 src/data/adiga2028.json으로 바꾼다. 과목 이름·묶음 표기를 검사하고 엔진이 그대로 쓰게 정리한다.
//   node scripts/build-adiga.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'data-src/adiga2028')
const OUT = join(root, 'src/data/adiga2028.json')

// 과목 목록과 계열 id는 앱 소스에서 읽는다 (같은 기준으로 검사하려고)
const subjectsTs = readFileSync(join(root, 'src/data/subjects.ts'), 'utf8')
const SUBJECTS = [...subjectsTs.matchAll(/s\('([^']+)', '([^']+)', '([^']+)'/g)].map((m) => ({ name: m[1], area: m[2], kind: m[3] }))
for (const m of subjectsTs.matchAll(/\['([^']+)', '([^']+)'\],/g)) {
  // 제2외국어 회화·심화·문화 과목은 언어 목록으로 만듦
  SUBJECTS.push(
    { name: `${m[1]} 회화`, area: '제2외국어', kind: '진로선택' },
    { name: `심화 ${m[1]}`, area: '제2외국어', kind: '진로선택' },
    { name: m[2], area: '제2외국어', kind: '융합선택' },
  )
}
const NAMES = new Set(SUBJECTS.map((s) => s.name))
const MAJORS = new Set([...readFileSync(join(root, 'src/data/majors.ts'), 'utf8').matchAll(/id: '([^']+)'/g)].map((m) => m[1]))

const FAMILY = {
  물리: ['물리학', '역학과 에너지', '전자기와 양자'],
  화학: ['화학', '물질과 에너지', '화학 반응의 세계'],
  생명: ['생명과학', '세포와 물질대사', '생물의 유전'],
  지구: ['지구과학', '지구시스템과학', '행성우주과학'],
}

/** 엔진(resolveSubjects)과 같은 뜻으로 묶음 표기를 푼다 */
function expand(token) {
  const m = token.match(/^(area|career|general|family):(.+)$/)
  if (!m) return NAMES.has(token) ? [token] : null
  const [, kind, what] = m
  if (kind === 'family') return FAMILY[what] ?? null
  const list = SUBJECTS.filter(
    (s) => s.area === what && (kind === 'area' ? s.kind !== '공통' && s.kind !== '기타' : s.kind === (kind === 'career' ? '진로선택' : '일반선택')),
  ).map((s) => s.name)
  return list.length ? list : null
}

const warnings = []
const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')
/** 칸 글자. 여러 줄을 " / "로 이은 칸에서 "-"(해당 없음)만 있는 줄은 뺀다 */
const cell = (s) =>
  clean(s)
    .split(' / ')
    .map((x) => x.trim())
    .filter((x) => x && x !== '-')
    .join(' / ')

// 손으로 검토한 공식 자료가 앱에 따로 있는 대학은 자료집 판을 넣지 않는다 (중앙대: 입학처 원문 표)
const SKIP = new Set(['cau'])

function normalizeClauses(unit, where) {
  const out = []
  for (const c of unit.clauses ?? []) {
    const level = c.level === 'core' ? 'core' : 'recommended'
    const text = clean(c.text)
    const subjects = []
    for (const s of c.subjects ?? []) {
      const name = clean(s)
      if (expand(name)) subjects.push(name)
      else warnings.push(`${where}: 모르는 과목 "${name}" 뺌`)
    }
    if (!subjects.length) continue
    const tokens = subjects.filter((s) => s.includes(':'))
    const names = subjects.filter((s) => !s.includes(':'))
    if (c.pick === 'all' && tokens.length) {
      // "국어, 수학"처럼 교과만 적힌 것을 '전부'로 옮긴 경우: 교과마다 1과목 이상으로 본다
      for (const t of tokens) out.push({ pick: 1, subjects: [t], level, text })
      if (names.length) out.push({ pick: 'all', subjects: names, level, text })
      continue
    }
    if (c.pick === 'all') {
      out.push({ pick: 'all', subjects: [...new Set(names)], level, text })
      continue
    }
    const n = Number(c.pick)
    if (!Number.isInteger(n) || n < 1) {
      warnings.push(`${where}: pick "${c.pick}" 이상해서 1로`)
    }
    const pool = new Set(subjects.flatMap((s) => expand(s)))
    const pick = Math.min(Math.max(1, Number.isInteger(n) ? n : 1), pool.size)
    if (pick < n) warnings.push(`${where}: pick ${n} > 과목 ${pool.size}개라 ${pick}로`)
    out.push({ pick, subjects: [...new Set(subjects)], level, text })
  }
  // 똑같은 조건은 하나만
  const seen = new Set()
  return out.filter((c) => {
    const key = JSON.stringify([c.pick, [...c.subjects].sort(), c.level])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 대학별 출처 { title, url, date } 검사 */
function sourceOf(x, id) {
  const title = clean(x?.title)
  const url = clean(x?.url)
  const date = clean(x?.date)
  if (!title || !/^https:\/\//.test(url) || !/^20\d\d(-\d\d){0,2}$/.test(date))
    throw new Error(`${id}: source는 title, https url, date(YYYY 또는 YYYY-MM-DD)가 있어야 해요`)
  return { title, url, date }
}

const universities = []
const units = []
const ids = new Set()

for (const file of readdirSync(SRC)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  for (const u of JSON.parse(readFileSync(join(SRC, file), 'utf8'))) {
    if (SKIP.has(u.id)) continue
    if (ids.has(u.id)) throw new Error(`대학 id 중복: ${u.id} (${file})`)
    ids.add(u.id)
    const pages = (u.pages ?? []).map(Number).filter(Number.isFinite)
    universities.push({
      id: u.id,
      name: clean(u.name),
      short: clean(u.short) || clean(u.name).replace(/학교$/, ''),
      region: clean(u.region),
      pages: pages.length ? [Math.min(...pages), Math.max(...pages)] : [],
      general: clean(u.general),
      // 자료집이 아니라 대학 입학처의 공식 자료에서 옮긴 대학은 그 출처
      ...(u.source ? { source: sourceOf(u.source, u.id) } : {}),
      // 자료집과 함께 본 대학 원문 (자료집과 다른 곳을 원문대로 고쳤을 때)
      ...(Array.isArray(u.extra) && u.extra.length ? { extra: u.extra.map((x) => sourceOf(x, u.id)) } : {}),
      // 대학 안내 문장을 직접 적을 때 (없으면 general로 만든다)
      ...(clean(u.policy) ? { policy: clean(u.policy) } : {}),
      // 원문 성격상 함께 알릴 점 (예: 2028학년도가 아닌 자료에서 옮김)
      ...(clean(u.caveat) ? { caveat: clean(u.caveat) } : {}),
      // 그 출처를 마지막으로 확인한 날 (없으면 자료집 확인일)
      ...(/^20\d\d-\d\d-\d\d$/.test(clean(u.checked)) ? { checked: clean(u.checked) } : {}),
    })
    // 같은 이름이 두 번 나오면(표가 계열별로 나뉜 경우) 조건을 합친다
    const byName = new Map()
    for (const x of u.units ?? []) {
      const name = clean(x.name)
      if (!name) continue
      const where = `${u.short} ${name}`
      const majors = [...new Set((x.majors ?? []).filter((m) => MAJORS.has(m)))]
      for (const m of x.majors ?? []) if (!MAJORS.has(m)) warnings.push(`${where}: 모르는 계열 "${m}"`)
      if (!majors.length) warnings.push(`${where}: 계열 없음`)
      const unit = {
        id: `${u.id}:${name}`,
        univ: u.id,
        name,
        majors,
        clauses: normalizeClauses(x, where),
        note: cell(x.note),
        core: cell(x.core),
        rec: cell(x.recommended),
        merged: !!x.merged,
        legacy: !!x.legacy,
        check: !!x.unsure,
      }
      const prev = byName.get(name)
      if (!prev) {
        byName.set(name, unit)
        continue
      }
      prev.majors = [...new Set([...prev.majors, ...unit.majors])]
      prev.clauses = [...prev.clauses, ...unit.clauses]
      for (const k of ['note', 'core', 'rec']) if (unit[k] && unit[k] !== prev[k]) prev[k] = prev[k] ? `${prev[k]} / ${unit[k]}` : unit[k]
      prev.legacy ||= unit.legacy
      prev.check ||= unit.check
    }
    for (const unit of byName.values()) {
      // 빈 값은 빼서 크기를 줄인다
      for (const k of ['note', 'core', 'rec']) if (!unit[k]) delete unit[k]
      for (const k of ['merged', 'legacy', 'check']) if (!unit[k]) delete unit[k]
      for (const c of unit.clauses) if (!c.text) delete c.text
      units.push(unit)
    }
  }
}

universities.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
const data = {
  source: {
    title: '대교협 대입정보포털 「2028 모집단위별 반영과목 및 대학별 권장과목 자료집」',
    url: 'https://www.adiga.kr/uct/ces/archiveView.do?menuId=PCUCTCES1000&prtlBbsId=26239',
    date: '2025-12-18',
  },
  universities,
  units,
}
writeFileSync(OUT, `${JSON.stringify(data)}\n`)
console.log(`대학 ${universities.length}곳, 모집단위 ${units.length}개 → ${OUT}`)
console.log(`조건 ${units.reduce((a, u) => a + u.clauses.length, 0)}개, 조건 없는 모집단위 ${units.filter((u) => !u.clauses.length).length}개`)
if (warnings.length) {
  console.log(`확인할 것 ${warnings.length}건:`)
  for (const w of warnings) console.log(`  - ${w}`)
}
