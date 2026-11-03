import { cohortMentions, type DocCandidate, decodeHtml, type DocKind, scoreTitle, yearsIn } from './discover'
import { CookieJar, FetchBlocked, safeFetch } from './safe-fetch'

// 학교알리미(schoolinfo.go.kr) 공시 "2-가. 학교교육과정 편성·운영 및 평가에 관한 사항"에서 편제표 파일을 찾는다.
// 모든 학교가 매년 4월 공시해야 하는 항목이고, robots.txt가 모든 접근을 허용한다.
// 학교알리미 학교 식별값은 나이스 학교 코드에서 계산되지 않으므로, 학교 이름으로 검색한 뒤
// 검색 결과에 함께 나오는 나이스 학교 코드(sdSchulCode)로 같은 학교인지 확인한다.

const ORIGIN = 'https://www.schoolinfo.go.kr'
export const schoolInfoSite = (u: URL) => u.protocol === 'https:' && u.hostname === 'www.schoolinfo.go.kr'

/** 나이스 시도교육청 코드 → 학교알리미 시·도 코드 */
const SIDO: Record<string, string> = {
  B10: '1100000000',
  C10: '2600000000',
  D10: '2700000000',
  E10: '2800000000',
  F10: '1200000000',
  G10: '3000000000',
  H10: '3100000000',
  I10: '3611000000',
  J10: '4100000000',
  K10: '5100000000',
  M10: '4300000000',
  N10: '4400000000',
  P10: '5200000000',
  Q10: '1200000000',
  R10: '4700000000',
  S10: '4800000000',
  T10: '5000000000',
}

// ---- EUC-KR 폼 인코딩 (학교알리미 검색은 EUC-KR로만 받는다) ----

let table: Map<string, [number, number]> | null = null

/** Node 내장 디코더로 CP949 두 바이트 조합을 모두 풀어 역표를 만든다 (처음 한 번, 수 ms) */
function eucKrTable(): Map<string, [number, number]> {
  if (table) return table
  const map = new Map<string, [number, number]>()
  const dec = new TextDecoder('euc-kr')
  for (let lead = 0x81; lead <= 0xfe; lead++)
    for (let trail = 0x41; trail <= 0xfe; trail++) {
      const ch = dec.decode(new Uint8Array([lead, trail]))
      if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [lead, trail])
    }
  table = map
  return map
}

export function eucKrPercent(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x80) {
      out += /[A-Za-z0-9\-_.~]/.test(ch) ? ch : `%${code.toString(16).toUpperCase().padStart(2, '0')}`
      continue
    }
    const bytes = eucKrTable().get(ch)
    if (!bytes) throw new FetchBlocked('학교 이름에 학교알리미에서 찾을 수 없는 글자가 있어요.')
    out += bytes.map((b) => `%${b.toString(16).toUpperCase()}`).join('')
  }
  return out
}

const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${k}=${eucKrPercent(v)}`)
    .join('&')

// ---- 학교 찾기 ----

export interface InfoContext {
  jar: CookieJar
  deadline: number
  fetch?: typeof safeFetch
}

async function get(url: string, ctx: InfoContext, rawForm?: string): Promise<string> {
  const left = ctx.deadline - Date.now()
  if (left < 1_000) throw new FetchBlocked('학교알리미 응답이 너무 늦어요.')
  const res = await (ctx.fetch ?? safeFetch)(url, {
    allow: schoolInfoSite,
    maxBytes: 3_000_000,
    timeoutMs: Math.min(15_000, left),
    accept: 'text/html,*/*',
    jar: ctx.jar,
    rawForm,
    referer: `${ORIGIN}/Main.do`,
  })
  if (res.status >= 400) throw new FetchBlocked(`학교알리미가 응답하지 않아요 (${res.status}).`)
  return decodeHtml(res.body, res.contentType)
}

/** 검색 결과 페이지에서 (학교알리미 식별값, 나이스 학교 코드) 짝 */
export function searchPairs(html: string): { id: string; code: string }[] {
  return [...html.matchAll(/var schulCd = "([0-9a-f-]{36})";\s*var sdSchulCode = "(\d*)"/g)].map((m) => ({ id: m[1], code: m[2] }))
}

/** 나이스 학교 → 학교알리미 식별값. 같은 이름의 학교가 많으면 몇 쪽까지 넘겨 본다 */
export async function findSchoolInfoId(school: { name: string; office: string; code: string }, ctx: InfoContext): Promise<string | null> {
  const names = [...new Set([school.name, school.name.replace(/등학교$/, '')])]
  for (const name of names) {
    for (let page = 1; page <= 4; page++) {
      const html = await get(
        `${ORIGIN}/ei/ss/Pneiss_f01_l0.do`,
        ctx,
        form({
          SEARCH_GS_HANGMOK_CD: '',
          SEARCH_GS_HANGMOK_NM: '',
          SEARCH_SCHUL_NM: name,
          SEARCH_GS_BURYU_CD: '',
          SEARCH_SIGUNGU: '',
          SEARCH_SIDO: SIDO[school.office] ?? '',
          SEARCH_FOND_SC_CODE: '',
          SEARCH_MODE: '3',
          SEARCH_TYPE: '2',
          pageNumber: String(page),
          SEARCH_KEYWORD: name,
        }),
      )
      const pairs = searchPairs(html)
      const hit = pairs.find((p) => p.code === school.code)
      if (hit) return hit.id
      if (pairs.length < 5) break
    }
  }
  return null
}

// ---- 공시 파일 ----

export interface DisclosureFile {
  seq: string
  name: string
}

/** 2-가 공시 조각에서 첨부 파일과 회차 */
export function disclosureFiles(html: string, year: number): { chasu: string; files: DisclosureFile[] } {
  const chasu =
    html.match(new RegExp(`<option[^>]*value="${year}(\\d+)"[^>]*selected`))?.[1] ?? html.match(new RegExp(`<option[^>]*value="${year}(\\d+)"`))?.[1] ?? '1'
  const files: DisclosureFile[] = []
  for (const m of html.matchAll(/getEiFile14\('(\d+)'\)[^>]*title="([^"]+)"/g)) {
    const name = m[2].replace(/\s+\S*\s*첨부파일\s*$/, '').trim()
    if (!files.some((f) => f.seq === m[1])) files.push({ seq: m[1], name })
  }
  return { chasu, files }
}

const kindOfName = (name: string): DocKind | null => {
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.xlsx$/i.test(name)) return 'xlsx'
  if (/\.hwpx?$/i.test(name)) return 'hwp'
  return null
}

const KIND_BONUS: Record<DocKind, number> = { pdf: 2, xlsx: 3, hwp: 1, images: 0, table: 0 }

export interface SchoolInfoResult {
  id: string | null
  candidates: DocCandidate[]
}

/** 학교알리미에서 이 학교 이 입학년도의 편제표 후보 */
export async function schoolInfoCandidates(
  school: { name: string; office: string; code: string },
  cohort: number,
  ctx: InfoContext,
  now = new Date(),
  track = '',
): Promise<SchoolInfoResult> {
  const id = await findSchoolInfoId(school, ctx)
  if (!id) return { id: null, candidates: [] }
  // 4월 공시라 올해 것이 없으면 작년 것을 본다
  const thisYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(now))
  const out: DocCandidate[] = []
  for (const year of [thisYear, thisYear - 1]) {
    if (year < cohort - 1) continue
    const html = await get(
      `${ORIGIN}/ei/pp/Pneipp_b14_s0p.do?GS_HANGMOK_CD=14&GS_BURYU_CD=JG100&JG_BURYU_CD=JG020&JG_HANGMOK_CD=05&JG_GUBUN=1&SHL_IDF_CD=${id}&JG_YEAR=${year}&JG_YEAR2=${year}&CHOSEN_JG_YEAR=${year}&PRE_JG_YEAR=${year}&GS_TYPE=Y&SORT=BR&LOAD_TYPE=single`,
      ctx,
    )
    const { chasu, files } = disclosureFiles(html, year)
    for (const f of files) {
      const kind = kindOfName(f.name)
      if (!kind) continue
      // 다른 해 입학생 것이라고 적힌 파일은 쓰지 않는다 (그 표를 이 해 편제표로 옮겨 공유하지 않게)
      const named = cohortMentions(f.name)
      if (named.length && !named.includes(cohort) && !yearsIn(f.name).includes(cohort)) continue
      // 공시 항목 전체가 교육과정 계획이라, 제목 점수가 낮은 통짜 계획서도 후보로 남긴다
      const score = Math.max(1, scoreTitle(f.name, cohort, track) + KIND_BONUS[kind] + 2 - (year < thisYear ? 1 : 0))
      out.push({
        url: `${ORIGIN}/servlets/EiFileDownLoad.do?SHL_IDF_CD=${id}&JG_BURYU_CD=JG020&JG_HANGMOK_CD=05&JG_GUBUN=1&JG_YEAR=${year}&JG_CHASU=${chasu}&USE_YN=Y&FILE_SEQ=${f.seq}`,
        kind,
        fileName: f.name,
        postTitle: `학교알리미 ${year}년 공시 · 학교교육과정 편성·운영`,
        postUrl: `${ORIGIN}/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${id}`,
        score,
        source: 'schoolinfo',
      })
    }
    if (files.length) break
  }
  return { id, candidates: out.sort((a, b) => b.score - a.score) }
}
