// 대학별 「2028학년도 대학입학전형시행계획」을 옮긴 원본(data-src/admissions2028/*.json)을 검사하고
// 앱이 쓰는 형태(src/data/admissions2028.json)로 모은다. 규칙은 data-src/admissions2028/README.md.
//   node scripts/build-admissions.mjs          검사하고 만든다
//   node scripts/build-admissions.mjs --check  검사만
//   node scripts/build-admissions.mjs --src <폴더>  그 폴더의 원본만 검사 (옮기는 중인 것)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// --src <폴더>: 다른 폴더(옮기는 중인 원본과 그 폴더의 sources.json)를 검사만 한다
const srcAt = process.argv.indexOf('--src')
const SRC = srcAt > 0 ? process.argv[srcAt + 1] : join(root, 'data-src/admissions2028')
const OUT = join(root, 'src/data/admissions2028.json')
const CHECK_ONLY = process.argv.includes('--check') || srcAt > 0

// 대학 id는 앱의 대학 목록과 같아야 한다
const adiga = JSON.parse(readFileSync(join(root, 'src/data/adiga2028.json'), 'utf8'))
const UNIV_IDS = new Set([
  ...adiga.universities.map((u) => u.id),
  ...[...readFileSync(join(root, 'src/data/universities.ts'), 'utf8').matchAll(/id: '([^']+)'/g)].map((m) => m[1]),
])

const TYPES = ['교과', '종합', '논술', '실기', '수능', '기타']
const PERIODS = ['수시', '정시', '기타']
const QUOTAS = ['정원내', '정원외']
const GRADS = ['예정자', '졸업자포함', '졸업자', null]
const SCHOOL_TYPES = [
  '일반고',
  '자율고',
  '특성화고',
  '마이스터고',
  '직업계열',
  '과학고',
  '외고',
  '국제고',
  '예술고',
  '체육고',
  '영재학교',
  '방송통신고',
  '평생교육시설',
  '검정고시',
  '대안학교',
  '해외고',
]
const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
const SPECIAL = [
  'rural',
  'equity',
  'vocational',
  'worker',
  'disabled',
  'veteran',
  'nk',
  'overseas',
  'multicultural',
  'island',
  'athlete',
  'artist',
  'military',
  'adult',
  'other',
]
const ELEMENTS = ['교과', '서류', '면접', '논술', '실기', '수능']

const errors = []
const warn = []
const err = (file, msg) => errors.push(`${file}: ${msg}`)

const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const optStr = (v, max) => v === null || v === undefined || (typeof v === 'string' && v.length <= max)
const list = (v, allowed) => Array.isArray(v) && v.every((x) => allowed.includes(x)) && new Set(v).size === v.length

function checkTrack(file, t, i, ids) {
  const at = `tracks[${i}] ${t?.name ?? ''}`
  if (!t || typeof t !== 'object') return err(file, `${at}: 객체가 아님`)
  if (typeof t.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(t.id)) err(file, `${at}: id 형식`)
  else if (ids.has(t.id)) err(file, `${at}: id 중복 ${t.id}`)
  else ids.add(t.id)
  if (!str(t.name, 60)) err(file, `${at}: name`)
  if (!TYPES.includes(t.type)) err(file, `${at}: type ${t.type}`)
  if (!PERIODS.includes(t.period)) err(file, `${at}: period ${t.period}`)
  if (!QUOTAS.includes(t.quota)) err(file, `${at}: quota ${t.quota}`)
  if (!(t.seats === null || (Number.isInteger(t.seats) && t.seats >= 0 && t.seats <= 10000))) err(file, `${at}: seats ${t.seats}`)
  if (!GRADS.includes(t.grads ?? null)) err(file, `${at}: grads ${t.grads}`)
  if (!(t.rec === null || t.rec === undefined || (typeof t.rec === 'object' && t.rec.required === true && optStr(t.rec.limit, 60)))) err(file, `${at}: rec`)
  const s = t.schools ?? { only: [], exclude: [] }
  if (!list(s.only ?? [], SCHOOL_TYPES)) err(file, `${at}: schools.only ${JSON.stringify(s.only)}`)
  if (!list(s.exclude ?? [], SCHOOL_TYPES)) err(file, `${at}: schools.exclude ${JSON.stringify(s.exclude)}`)
  if ((s.only ?? []).some((x) => (s.exclude ?? []).includes(x))) err(file, `${at}: only와 exclude가 겹침`)
  if (!list(t.regions ?? [], REGIONS)) err(file, `${at}: regions ${JSON.stringify(t.regions)}`)
  if (!list(t.special ?? [], SPECIAL)) err(file, `${at}: special ${JSON.stringify(t.special)}`)
  if (!str(t.who, 140)) err(file, `${at}: who (140자 안쪽)`)
  if (!str(t.method, 140)) err(file, `${at}: method (140자 안쪽)`)
  if (!list(t.elements ?? [], ELEMENTS) || !(t.elements ?? []).length) err(file, `${at}: elements ${JSON.stringify(t.elements)}`)
  if (!optStr(t.min, 160)) err(file, `${at}: min`)
  if (!optStr(t.subjects, 160)) err(file, `${at}: subjects`)
  if (!optStr(t.note, 140)) err(file, `${at}: note`)
  if (!str(t.pages, 20)) err(file, `${at}: pages`)
  // 서로 맞지 않는 값
  if (t.type === '수능' && t.period === '수시') warn.push(`${file}: ${at}: 수능위주인데 수시`)
  if (t.type === '논술' && !(t.elements ?? []).includes('논술')) err(file, `${at}: 논술전형인데 elements에 논술이 없음`)
  if (t.type === '수능' && !(t.elements ?? []).includes('수능')) err(file, `${at}: 수능위주인데 elements에 수능이 없음`)
}

// 원문 PDF 주소 (내려받은 곳)
const SOURCES = JSON.parse(readFileSync(join(SRC, 'sources.json'), 'utf8'))
const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.json') && f !== 'sources.json')
  .sort()
const plans = []
for (const f of files) {
  let data
  try {
    data = JSON.parse(readFileSync(join(SRC, f), 'utf8'))
  } catch (e) {
    err(f, `JSON 오류 ${e.message}`)
    continue
  }
  const id = f.replace(/\.json$/, '')
  if (data.univ !== id) err(f, `univ가 파일 이름과 다름 (${data.univ})`)
  if (!UNIV_IDS.has(id)) err(f, `앱에 없는 대학 id ${id}`)
  if (!str(data.planTitle, 120)) err(f, 'planTitle')
  if (typeof data.date !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(data.date)) err(f, `date ${data.date}`)
  if (!(
    data.totals === null ||
    data.totals === undefined ||
    (typeof data.totals === 'object' && Object.values(data.totals).every((n) => Number.isInteger(n) && n >= 0))
  ))
    err(f, 'totals')
  if (!Array.isArray(data.changes) || data.changes.length > 8 || !data.changes.every((c) => str(c, 120))) err(f, 'changes (최대 8개, 120자 안쪽)')
  if (!Array.isArray(data.tracks) || !data.tracks.length) err(f, 'tracks가 비었음')
  const ids = new Set()
  ;(data.tracks ?? []).forEach((t, i) => checkTrack(f, t, i, ids))
  if (!SOURCES[id]?.url) err(f, 'sources.json에 원문 주소가 없음')
  for (const k of ['page', 'watch']) if (SOURCES[id]?.[k] !== undefined && !/^https:\/\//.test(SOURCES[id][k])) err(f, `sources.json ${k}는 https 주소`)
  if (data.ai !== undefined && !(typeof data.ai === 'string' && /^20\d\d-\d\d-\d\d$/.test(data.ai))) err(f, `ai (AI가 옮긴 날 YYYY-MM-DD) ${data.ai}`)
  plans.push({
    univ: id,
    planTitle: data.planTitle,
    url: SOURCES[id]?.url ?? '',
    ...(SOURCES[id]?.page ? { page: SOURCES[id].page } : {}),
    ...(SOURCES[id]?.watch ? { watch: SOURCES[id].watch } : {}),
    ...(SOURCES[id]?.sha ? { fileSha: SOURCES[id].sha } : {}),
    ...(data.ai ? { ai: data.ai } : {}),
    ...(data.ai && data.aiCheck ? { aiCheck: data.aiCheck } : {}),
    date: data.date,
    totals: data.totals ?? null,
    changes: data.changes ?? [],
    tracks: (data.tracks ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      period: t.period,
      quota: t.quota,
      seats: t.seats ?? null,
      grads: t.grads ?? null,
      rec: t.rec ? { required: true, limit: t.rec.limit ?? null } : null,
      schools: { only: t.schools?.only ?? [], exclude: t.schools?.exclude ?? [] },
      regions: t.regions ?? [],
      special: t.special ?? [],
      who: t.who,
      method: t.method,
      elements: t.elements,
      min: t.min ?? null,
      subjects: t.subjects ?? null,
      note: t.note ?? null,
      pages: t.pages,
    })),
  })
}

// ---- 전형 상세: data-src/admissions2028/detail/<id>.json (정시 수능·학생부 반영 방법, 단계별 선발, 면접·논술, 모집단위별 인원) ----
const DETAIL = join(SRC, 'detail')
const AREAS = ['국어', '수학', '영어', '탐구', '한국사', '직업탐구', '제2외국어/한문']
const num = (v) => typeof v === 'number' && Number.isFinite(v)
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
let detailFiles = []
try {
  detailFiles = readdirSync(DETAIL)
    .filter((x) => x.endsWith('.json'))
    .sort()
} catch {
  detailFiles = []
}
const unitsOut = {}
for (const f of detailFiles) {
  const id = f.replace(/\.json$/, '')
  const fn = `detail/${f}`
  const plan = plans.find((p) => p.univ === id)
  if (!plan) {
    err(fn, '같은 id의 전형 자료가 없음')
    continue
  }
  let d
  try {
    d = JSON.parse(readFileSync(join(DETAIL, f), 'utf8'))
  } catch (e) {
    err(fn, `JSON 오류 ${e.message}`)
    continue
  }
  if (d.univ !== id) err(fn, `univ가 파일 이름과 다름 (${d.univ})`)
  const trackIds = new Set(plan.tracks.map((t) => t.id))
  const tracksOf = (v, at) => {
    if (!Array.isArray(v) || !v.every((x) => trackIds.has(x))) {
      err(fn, `${at}: tracks에 없는 전형 id ${JSON.stringify(v)}`)
      return []
    }
    return v
  }

  plan.suneung = (Array.isArray(d.suneung) ? d.suneung : (err(fn, 'suneung는 배열'), [])).map((r, i) => {
    const at = `suneung[${i}] ${r?.group ?? ''}`
    if (!str(r?.group, 30)) err(fn, `${at}: group`)
    if (!optStr(r?.units, 200)) err(fn, `${at}: units (200자 안쪽)`)
    if (!str(r?.use, 60)) err(fn, `${at}: use`)
    const w = r?.weights
    if (!w || typeof w !== 'object' || Array.isArray(w)) err(fn, `${at}: weights`)
    else {
      for (const [k, v] of Object.entries(w)) {
        if (!AREAS.includes(k)) err(fn, `${at}: weights 영역 이름 ${k}`)
        if (!num(v) || v < 0 || v > 100) err(fn, `${at}: weights ${k}=${v}`)
      }
      const sum = Object.values(w).reduce((a, b) => a + (num(b) ? b : 0), 0)
      // 합이 100을 넘어도 '상위 2개 영역'처럼 골라 반영하는 규칙이면 맞게 옮긴 것
      const bestOf = sum > 100 && /상위|우수|중\s*택|택\s*\d|\d\s*개\s*영역|골라|높은/.test(`${r?.use ?? ''} ${r?.formula ?? ''} ${r?.group ?? ''}`)
      if (Object.keys(w).length && Math.abs(sum - 100) > 1 && !bestOf) warn.push(`${fn}: ${at}: 반영 비율 합이 ${sum}`)
    }
    for (const k of ['inquiry', 'english', 'history', 'bonus']) if (!optStr(r?.[k], 300)) err(fn, `${at}: ${k} (300자 안쪽)`)
    if (!optStr(r?.formula, 400)) err(fn, `${at}: formula (400자 안쪽)`)
    if (!(r?.total === null || r?.total === undefined || (num(r.total) && r.total > 0))) err(fn, `${at}: total`)
    if (!str(r?.pages, 40)) err(fn, `${at}: pages`)
    return {
      group: r?.group,
      units: clean(r?.units),
      tracks: tracksOf(r?.tracks ?? [], at),
      use: r?.use,
      weights: w ?? {},
      inquiry: clean(r?.inquiry),
      english: clean(r?.english),
      history: clean(r?.history),
      bonus: clean(r?.bonus),
      formula: clean(r?.formula),
      total: num(r?.total) ? r.total : null,
      pages: r?.pages,
    }
  })

  plan.record = (Array.isArray(d.record) ? d.record : (err(fn, 'record는 배열'), [])).map((r, i) => {
    const at = `record[${i}]`
    if (!str(r?.subjects, 300)) err(fn, `${at}: subjects`)
    for (const k of ['terms', 'grades', 'achievement', 'extra']) if (!optStr(r?.[k], 300)) err(fn, `${at}: ${k} (300자 안쪽)`)
    if (!optStr(r?.formula, 400)) err(fn, `${at}: formula (400자 안쪽)`)
    if (!str(r?.pages, 40)) err(fn, `${at}: pages`)
    return {
      tracks: tracksOf(r?.tracks ?? [], at),
      subjects: r?.subjects,
      terms: clean(r?.terms),
      grades: clean(r?.grades),
      achievement: clean(r?.achievement),
      formula: clean(r?.formula),
      extra: clean(r?.extra),
      pages: r?.pages,
    }
  })

  for (const [tid, x] of Object.entries(d.tracks ?? {})) {
    const at = `tracks.${tid}`
    const t = plan.tracks.find((tt) => tt.id === tid)
    if (!t) {
      err(fn, `${at}: 없는 전형 id`)
      continue
    }
    const stages = Array.isArray(x?.stages) ? x.stages : []
    if (stages.length > 8) err(fn, `${at}: stages는 8단계까지`)
    stages.forEach((s, i) => {
      if (!str(s?.step, 20)) err(fn, `${at}.stages[${i}]: step`)
      if (!optStr(s?.pick, 40)) err(fn, `${at}.stages[${i}]: pick`)
      const parts = s?.parts
      if (!parts || typeof parts !== 'object' || Array.isArray(parts) || !Object.keys(parts).length) err(fn, `${at}.stages[${i}]: parts`)
      else {
        for (const [k, v] of Object.entries(parts)) if (!str(k, 30) || !num(v) || v < 0 || v > 100) err(fn, `${at}.stages[${i}]: parts ${k}=${v}`)
        const sum = Object.values(parts).reduce((a, b) => a + b, 0)
        if (Math.abs(sum - 100) > 1) warn.push(`${fn}: ${at}.stages[${i}]: 반영 비율 합이 ${sum}`)
      }
    })
    for (const k of ['interview', 'essay', 'docs']) if (!optStr(x?.[k], 300)) err(fn, `${at}: ${k} (300자 안쪽)`)
    if (stages.length) t.stages = stages.map((s) => ({ step: s.step, pick: clean(s.pick), parts: s.parts }))
    for (const k of ['interview', 'essay', 'docs']) if (clean(x?.[k])) t[k] = clean(x[k])
  }
}

// ---- 모집단위별 인원: data-src/admissions2028/units/<id>.json ----
// { "univ": "korea", "seats": { "<앱의 모집단위 id>": { "<전형 id>": 12 } }, "pages": "34-38" }
const UNIT_DIR = join(SRC, 'units')
let unitFiles = []
try {
  unitFiles = readdirSync(UNIT_DIR)
    .filter((x) => x.endsWith('.json'))
    .sort()
} catch {
  unitFiles = []
}
for (const f of unitFiles) {
  const id = f.replace(/\.json$/, '')
  const fn = `units/${f}`
  const plan = plans.find((p) => p.univ === id)
  if (!plan) {
    err(fn, '같은 id의 전형 자료가 없음')
    continue
  }
  let d
  try {
    d = JSON.parse(readFileSync(join(UNIT_DIR, f), 'utf8'))
  } catch (e) {
    err(fn, `JSON 오류 ${e.message}`)
    continue
  }
  if (d.univ !== id) err(fn, `univ가 파일 이름과 다름 (${d.univ})`)
  if (!str(d.pages, 40)) err(fn, 'pages')
  const trackIds = new Set(plan.tracks.map((t) => t.id))
  const seats = d.seats && typeof d.seats === 'object' && !Array.isArray(d.seats) ? d.seats : (err(fn, 'seats'), {})
  for (const [unit, row] of Object.entries(seats)) {
    if (!unit.startsWith(`${id}:`)) err(fn, `모집단위 id ${unit}`)
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      err(fn, `${unit}: 전형별 인원`)
      continue
    }
    for (const [tid, n] of Object.entries(row)) {
      if (!trackIds.has(tid)) err(fn, `${unit}: 없는 전형 id ${tid}`)
      if (!(n === null || (Number.isInteger(n) && n >= 0 && n <= 2000))) err(fn, `${unit}: ${tid} 인원 ${n}`)
    }
  }
  // 전형 인원보다 많이 적었으면 잘못 옮긴 것
  for (const t of plan.tracks) {
    const sum = Object.values(seats).reduce((a, row) => a + (Number.isInteger(row?.[t.id]) ? row[t.id] : 0), 0)
    if (t.seats !== null && sum > t.seats) warn.push(`${fn}: ${t.id} 모집단위 인원 합 ${sum} > 전형 인원 ${t.seats}`)
  }
  unitsOut[id] = seats
}

for (const w of warn) console.warn(`주의 ${w}`)
if (errors.length) {
  for (const e of errors) console.error(e)
  console.error(`\n오류 ${errors.length}개`)
  process.exit(1)
}
const trackCount = plans.reduce((n, p) => n + p.tracks.length, 0)
if (!CHECK_ONLY) {
  writeFileSync(OUT, `${JSON.stringify({ year: 2028, plans }, null, 0)}\n`)
  // 첫 화면에서 쓰는 숫자만 따로 (전형 자료 전체를 처음부터 받지 않게)
  writeFileSync(join(root, 'src/data/admissions2028.meta.json'), `${JSON.stringify({ year: 2028, univs: plans.length, tracks: trackCount })}\n`)
  // 모집단위별 인원은 따로 (전형을 펼칠 때만 받는다)
  writeFileSync(join(root, 'src/data/admissions2028.units.json'), `${JSON.stringify(unitsOut)}\n`)
  console.log(`대학 ${plans.length}곳, 전형 ${trackCount}개, 상세 ${detailFiles.length}곳, 학과별 인원 ${unitFiles.length}곳 → ${OUT}`)
} else console.log(`검사 통과: 대학 ${plans.length}곳, 전형 ${trackCount}개, 상세 ${detailFiles.length}곳, 학과별 인원 ${unitFiles.length}곳`)
