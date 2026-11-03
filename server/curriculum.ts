import type { School, TermId } from '../src/data/schema'
import { TERMS } from '../src/data/schema'
import { checkSchool, schoolFromLoose, termCredits } from '../src/engine/school'
import { type AiConfig, chat, extractJson } from './ai'
import { type DocKind, decodeHtml, MAX_IMAGES, mentionsTrack, pickByCohort } from './discover'
import { looksLikeImage, looksLikePdf, normalizeImage, renderPdf } from './pdf-render'
import { regionOf } from './neis'
import { importSystem } from './prompts'
import { type CookieJar, FetchBlocked, safeFetch } from './safe-fetch'
import { type DocTable, type HangulDoc, hangulDoc, HwpError, isHwp5 } from './hwp'
import { curriculumTables, gridText, htmlTables, subjectHits, xlsxGrids } from './tables'
import { isZip, unzip } from './zip'

// 학교 홈페이지의 편제표를 서버가 직접 받아 AI로 읽는다.
// PDF·그림은 그림으로, 엑셀·한글·HTML 표는 칸 위치가 보이는 글로 보낸다. 학기 합계가 어긋나면 한 번 더 묻는다.

export interface SchoolRef {
  office: string
  code: string
  name: string
  region: string
  homepage: string
  /** 나이스 고등학교 구분 (일반고·특성화고·특목고·자율고) */
  kind?: string
  /** 일반계·전문계 */
  field?: string
}

/**
 * 사용자가 보낸 학교 코드를 믿지 않고 나이스에서 다시 찾아 공식 홈페이지 주소를 얻는다.
 * 없는 학교면 null, 나이스 오류·한도면 던진다 (잠깐의 오류를 '학교 없음'으로 기억하지 않게)
 */
export async function schoolByCode(office: string, code: string, key: string | undefined, fetchImpl: typeof fetch = fetch): Promise<SchoolRef | null> {
  if (!/^[A-Z]\d{2}$/.test(office) || !/^\d{7}$/.test(code)) return null
  const params = new URLSearchParams({ Type: 'json', ATPT_OFCDC_SC_CODE: office, SD_SCHUL_CODE: code })
  if (key) params.set('KEY', key)
  const res = await fetchImpl(`https://open.neis.go.kr/hub/schoolInfo?${params}`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`나이스 HTTP ${res.status}`)
  const data = (await res.json().catch(() => null)) as { schoolInfo?: [unknown, { row?: Record<string, string>[] }]; RESULT?: { CODE?: string } } | null
  if (!data) throw new Error('나이스 응답을 읽지 못함')
  // INFO-200: 해당 데이터 없음. 그 밖의 결과 코드(인증키·트래픽 한도·서버 오류)는 오류
  const result = data.RESULT?.CODE
  if (result && result !== 'INFO-200') throw new Error(`나이스 ${result}`)
  const row = data.schoolInfo?.[1]?.row?.[0]
  if (!row || row.SD_SCHUL_CODE !== code) return null
  const raw = row.HMPG_ADRES?.trim() ?? ''
  let homepage = ''
  try {
    homepage = raw ? new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).toString() : ''
  } catch {
    homepage = ''
  }
  return {
    office,
    code,
    name: row.SCHUL_NM ?? '',
    region: regionOf(row.ATPT_OFCDC_SC_NM ?? ''),
    homepage,
    kind: row.HS_SC_NM ?? '',
    field: row.HS_GNRL_BUSNS_SC_NM ?? '',
  }
}

/** 공유해도 될 만큼 표 모양을 갖췄는지: 여섯 학기 모두 과목이 있고 학기 학점이 고름 */
export function looksComplete(school: School): boolean {
  const filled = (t: TermId) => {
    const term = school.terms.find((x) => x.id === t)
    return !!term && (term.fixed.length > 0 || term.groups.length > 0)
  }
  if (!TERMS.every(filled)) return false
  if (!TERMS.filter((t) => t.startsWith('1-')).every((t) => termCredits(school, t) >= 10)) return false
  const later = TERMS.filter((t) => !t.startsWith('1-'))
  const credits = later.map((t) => termCredits(school, t))
  if (!credits.every((c) => c >= 14 && c <= 45)) return false
  // 한 학기만 중앙값에서 5학점 넘게 튀면 잘못 읽은 것 (같은 칸을 두 번 옮기는 등)
  const sorted = [...credits].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return credits.every((c) => Math.abs(c - median) <= 5)
}

/** 표의 학기별 합계와 옮긴 학점이 다른 학기 */
export interface Mismatch {
  term: TermId
  table: number
  read: number
}

const termName = (id: TermId) => `${id[0]}학년 ${id[2]}학기`

/**
 * totals: 모델이 표의 합계 행에서 읽은 학기별 교과 학점.
 * 창체가 든 합계처럼 학기마다 똑같은 차이(1~4학점)는 봐주고, 그 밖에 2학점 이상 어긋난 학기만 짚는다
 */
export function totalMismatch(school: School, totals: unknown): Mismatch[] {
  if (!totals || typeof totals !== 'object') return []
  const rows = TERMS.flatMap((term) => {
    const table = Number((totals as Record<string, unknown>)[term])
    const read = termCredits(school, term)
    return Number.isInteger(table) && table > 0 && table <= 60 ? [{ term, table, read }] : []
  })
  // 표 합계는 있는데 한 과목도 못 옮긴 학기는 그대로 어긋난 학기
  const empty = rows.filter((r) => r.read === 0)
  const read = rows.filter((r) => r.read > 0)
  if (read.length < 2) return empty
  const counts = new Map<number, number>()
  for (const r of read) counts.set(r.table - r.read, (counts.get(r.table - r.read) ?? 0) + 1)
  const [base] = [...counts].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]
  const offset = base > 0 && base <= 4 ? base : 0
  return [...empty, ...read.filter((r) => Math.abs(r.table - r.read - offset) >= 2)]
}

/** 문서에 학과·과정별 편제표가 여러 개일 때 그 이름들 (모델이 적은 값을 정리) */
export function variantsOf(raw: unknown): string[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { variants?: unknown }).variants) ? (raw as { variants: unknown[] }).variants : []
  const names = list
    .filter((v): v is string => typeof v === 'string')
    .map((v) =>
      v
        .replace(/[^\p{L}\p{N} ·()-]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30),
    )
    .filter(Boolean)
  return [...new Set(names)].slice(0, 12)
}

export interface ReadResult {
  data: School
  unknown: string[]
  sourceUrl: string
  pages: number
  used: number[]
  /** 표 합계와 다르게 옮긴 학기. 있으면 공유하지 않음 */
  mismatch?: Mismatch[]
  /** 문서에 학과·과정별 편제표가 여러 개면 그 이름들 */
  variants?: string[]
  /** 표에 적힌 입학년도. 안 적혀 있거나 학년별 단면이면 없음 */
  year?: number
}

/** 모델이 적은 표의 입학년도 (2000~2099만) */
export function yearOf(raw: unknown): number | undefined {
  const y = raw && typeof raw === 'object' ? Number((raw as { year?: unknown }).year) : Number.NaN
  return Number.isInteger(y) && y >= 2000 && y <= 2099 ? y : undefined
}

/** 읽기 전체 시간 상한. nginx가 210초에 끊으므로 그 전에 답함 */
const READ_MS = 190_000
/** 합계가 어긋날 때 다시 묻는 데 남아 있어야 하는 시간 */
const FOLLOW_UP_MS = 60_000

export interface ReadDeps {
  /**
   * AI를 부르기 직전에 하루 사용량을 센다 (파일을 못 받으면 세지 않게).
   * 첫 묻기에서 한도가 없으면 던지고, 합계가 어긋나 다시 물을 때는 false면 다시 묻지 않는다
   */
  reserve?: (followUp: boolean) => boolean
  download?: typeof safeFetch
  render?: typeof renderPdf
  normalize?: typeof normalizeImage
  fetchImpl?: typeof fetch
}

/** 읽을 문서: 파일 하나(PDF·엑셀·한글), 한 페이지에 붙은 그림 여러 장, 본문 표 */
export interface ReadTarget {
  url: string
  kind: DocKind
  images?: string[]
  /** 학교 홈페이지에서 받는 것이면 robots.txt를 다시 확인 */
  source?: 'homepage' | 'schoolinfo'
}

/** allow: 받을 수 있는 주소 범위 (리다이렉트마다 다시 확인). jar: 둘러볼 때 받은 쿠키 */
export interface Site {
  allow: (u: URL) => boolean
  jar?: CookieJar
  /** 받기 전에 확인할 것 (robots.txt) */
  check?: (url: string) => Promise<void>
}

async function loadImages(target: ReadTarget, site: Site, deps: ReadDeps): Promise<string[]> {
  const images: string[] = []
  for (const url of (target.images ?? []).slice(0, MAX_IMAGES)) {
    await site.check?.(url)
    const res = await (deps.download ?? safeFetch)(url, { allow: site.allow, jar: site.jar, maxBytes: 10_000_000, timeoutMs: 20_000, accept: 'image/*' })
    if (res.status >= 400 || !looksLikeImage(res.body)) continue
    images.push(await (deps.normalize ?? normalizeImage)(res.body))
  }
  if (!images.length) throw new FetchBlocked('편제표 그림을 받지 못했어요.')
  return images
}

/** AI에 보낼 것: 그림들, 또는 칸 위치가 보이는 표 글 */
type Loaded = { images: string[]; text?: undefined; pages: number; used: number[] } | { text: string; images?: undefined; pages: number; used: number[] }

function sheetsText(buf: Buffer, track: string): Loaded {
  const sheets = xlsxGrids(buf)
  if (!sheets.length) throw new FetchBlocked('엑셀 파일에서 표를 찾지 못했어요.')
  const useful = sheets.filter((s) => curriculumTables([s.grid]).length || subjectHits(s.grid) >= 5)
  // 학과별 시트가 있으면 그 학과 시트만
  const mine = track ? useful.filter((s) => mentionsTrack(`${s.name} ${s.grid.slice(0, 4).flat().join(' ')}`, track)) : []
  const picked = (mine.length ? mine : useful.length ? useful : sheets).slice(0, 4)
  return {
    text: gridText(
      picked.map((s) => s.grid),
      picked.map((s) => s.name),
    ),
    pages: sheets.length,
    used: picked.map((s) => sheets.indexOf(s) + 1),
  }
}

/**
 * 한글 문서: 편제표로 보이는 표를 표 위 제목과 함께 글로 옮긴다.
 * 표 없이 편제표를 그림으로 붙인 문서면 제목에 편제·편성이 든 그림을 쓴다
 */
async function hangulLoad(buf: Buffer, cohort: number, deps: ReadDeps, track: string): Promise<Loaded> {
  let doc: HangulDoc
  try {
    doc = hangulDoc(buf)
  } catch (e) {
    throw new FetchBlocked(e instanceof HwpError ? e.message : '한글 파일을 열지 못했어요.')
  }
  const tableText = (t: DocTable) => `${t.caption} ${t.grid.slice(0, 3).flat().join(' ')}`
  const curricular = doc.tables.filter((t) => curriculumTables([t.grid]).length)
  // 학과를 골랐으면 그 학과가 나오는 표를 먼저 (한 표에 학과별 열이 나뉜 경우도 있음)
  const forTrack = track ? curricular.filter((t) => mentionsTrack(tableText(t), track)) : []
  const tables = pickByCohort(forTrack.length ? forTrack : curricular, tableText, cohort, 4)
  if (tables.length)
    return {
      text: gridText(
        tables.map((t) => t.grid),
        tables.map((t, i) => (t.caption ? `표 ${i + 1} · ${t.caption}` : `표 ${i + 1}`)),
      ),
      pages: doc.tables.length,
      used: tables.map((t) => doc.tables.indexOf(t) + 1),
    }
  const pictures = pickByCohort(
    doc.pictures.filter((p) => /편제|편성|배당|교육\s*과정/.test(p.caption)),
    (p) => p.caption,
    cohort,
    4,
  )
  const images: string[] = []
  for (const p of pictures) {
    const data = doc.image(p.name)
    if (!data) continue
    try {
      images.push(await (deps.normalize ?? normalizeImage)(data))
    } catch {
      // 못 여는 그림 형식은 건너뛴다
    }
  }
  if (!images.length) throw new FetchBlocked('한글 파일에서 편제표 표나 그림을 찾지 못했어요.')
  return { images, pages: doc.pictures.length, used: pictures.map((p) => doc.pictures.indexOf(p) + 1) }
}

async function loadFile(target: ReadTarget, site: Site, cohort: number, deps: ReadDeps, track: string): Promise<Loaded> {
  await site.check?.(target.url)
  const res = await (deps.download ?? safeFetch)(target.url, {
    allow: site.allow,
    jar: site.jar,
    maxBytes: 25_000_000,
    timeoutMs: 40_000,
    accept: 'application/pdf,*/*',
  })
  if (res.status >= 400) throw new FetchBlocked(`파일을 받지 못했어요 (${res.status}).`)
  // 확장자·Content-Type보다 파일 내용으로 판단 (PDF가 x-msdownload, 엑셀이 text/html로 오는 서버가 있음)
  const body = res.body
  if (looksLikePdf(body))
    return (deps.render ?? renderPdf)(body, cohort, 4).catch((e: unknown) => {
      console.error(`[read] PDF 그리기 실패: ${e instanceof Error ? e.message : String(e)}`)
      throw new FetchBlocked('PDF 파일을 열지 못했어요. 암호가 걸렸거나 손상된 파일일 수 있어요.')
    })
  if (isZip(body)) {
    let names: string[] = []
    try {
      names = [...unzip(body, (n) => n === 'xl/workbook.xml' || /^Contents\/section\d+\.xml$/i.test(n)).keys()]
    } catch {
      throw new FetchBlocked('압축 파일을 열지 못했어요.')
    }
    if (names.includes('xl/workbook.xml')) return sheetsText(body, track)
    if (names.some((n) => n.startsWith('Contents/'))) return hangulLoad(body, cohort, deps, track)
    throw new FetchBlocked('읽을 수 있는 파일 형식이 아니에요.')
  }
  if (isHwp5(body)) return hangulLoad(body, cohort, deps, track)
  if (/^\s*<(!doctype|html|script)/i.test(body.subarray(0, 200).toString('latin1')))
    throw new FetchBlocked('파일 대신 안내 페이지가 왔어요. 학교 홈페이지에서 직접 받아 올려 주세요.')
  throw new FetchBlocked('읽을 수 있는 파일 형식이 아니에요. 예전 엑셀(xls)이면 xlsx나 PDF로 저장해 올려 주세요.')
}

/** 본문에 HTML 표로 넣은 편제표: 페이지를 다시 받아 표만 글로 옮긴다 */
async function loadTable(target: ReadTarget, site: Site, deps: ReadDeps): Promise<Loaded> {
  await site.check?.(target.url)
  const res = await (deps.download ?? safeFetch)(target.url, {
    allow: site.allow,
    jar: site.jar,
    maxBytes: 3_000_000,
    timeoutMs: 20_000,
    accept: 'text/html,*/*',
  })
  if (res.status >= 400) throw new FetchBlocked(`페이지를 열 수 없어요 (${res.status}).`)
  const tables = curriculumTables(htmlTables(decodeHtml(res.body, res.contentType)))
  if (!tables.length) throw new FetchBlocked('페이지에서 편제표 표를 찾지 못했어요.')
  return { text: gridText(tables), pages: tables.length, used: tables.map((_, i) => i + 1) }
}

export async function readFromUrl(
  school: SchoolRef,
  cohort: number,
  target: ReadTarget,
  site: Site,
  cfg: AiConfig,
  deps: ReadDeps = {},
  track = '',
): Promise<ReadResult> {
  const deadline = Date.now() + READ_MS
  const loaded: Loaded =
    target.kind === 'images'
      ? await loadImages(target, site, deps).then((images) => ({ images, pages: images.length, used: images.map((_, i) => i + 1) }))
      : target.kind === 'table'
        ? await loadTable(target, site, deps)
        : await loadFile(target, site, cohort, deps, track)
  const { pages, used } = loaded
  const system = importSystem(cohort, track, loaded.text !== undefined)
  const ask = (followUp?: { answer: string; text: string }) => {
    const timeoutMs = Math.max(10_000, Math.min(180_000, deadline - Date.now()))
    return chat(
      cfg,
      loaded.text !== undefined
        ? { system, user: `편제표 내용:\n${loaded.text}`, heavy: true, maxTokens: 32_000, timeoutMs, followUp }
        : { system, user: '첨부한 편제표 이미지를 옮겨 줘.', images: loaded.images, maxTokens: 32_000, timeoutMs, followUp },
      deps.fetchImpl,
    )
  }
  const parse = (out: string) => {
    const raw = extractJson(out)
    // 학점을 못 읽은 칸은 3학점으로 채우지 않고 뺀다 (합계 검사가 빠진 곳을 잡게)
    const data = schoolFromLoose(
      raw,
      {
        id: `neis-${school.office}-${school.code}-${cohort}${track ? `-${track}` : ''}`,
        name: school.name,
        region: school.region,
        cohort,
      },
      { strict: true },
    )
    return { data, mismatch: totalMismatch(data, (raw as { totals?: unknown } | null)?.totals), variants: variantsOf(raw), year: yearOf(raw) }
  }

  deps.reserve?.(false)
  const first = await ask()
  let best = parse(first)
  // 다시 물을 시간·한도가 없으면 첫 결과를 쓴다 (어긋난 결과는 공유하지 않음)
  if (best.mismatch.length && deadline - Date.now() > FOLLOW_UP_MS && (deps.reserve?.(true) ?? true)) {
    // 어긋난 학기를 짚어 한 번 더 묻는다 (과목을 옆 학기 열로 옮기는 실수가 잦음)
    const note = best.mismatch.map((m) => `${termName(m.term)}: 표 합계 ${m.table}학점, 옮긴 학점 ${m.read}학점`).join('\n')
    // 모자란 학기는 과목을 빠뜨린 것. 예술처럼 학기마다 과목이 바뀌는 줄을 짝으로 묶어 한 학기에만 적는 실수가 잦다
    const missing = best.mismatch.some((m) => m.read < m.table)
      ? '\n옮긴 학점이 모자란 학기는 빠뜨린 과목이 있다. 예술(음악·미술)·체육·교양처럼 학기마다 과목이 바뀌는 줄을 줄마다 다시 보고, 과목마다 따로 줄이 있으면 짝(alt)으로 묶지 말고 학점이 적힌 학기마다 따로 적어.'
      : ''
    try {
      const again = parse(
        await ask({
          answer: first,
          text: `학기마다 옮긴 학점을 더해 보니 표의 합계 행과 다른 학기가 있다.\n${note}${missing}\n과목마다 학점이 적힌 학기 열을 다시 확인해서, 고친 전체 결과를 같은 JSON 모양으로 다시 출력해.${
            loaded.text !== undefined
              ? '\n글로 옮긴 표라 묶음 테두리가 없다. 학기 열마다 학점·[택N] 표시가 적힌 칸을 기준으로 선택 묶음을 다시 나누고, 선택 과목 계 행 값과 학기마다 pick×credits 합이 맞는지 확인해.'
              : ''
          }`,
        }),
      )
      if (again.mismatch.length < best.mismatch.length) best = again
    } catch {
      // 다시 묻기가 실패하면 첫 결과를 쓴다
    }
  }
  const data = best.data
  data.source = { title: `${school.name} 홈페이지 편제표`, url: target.url }
  const check = checkSchool(data)
  return { data, unknown: check.unknown, sourceUrl: target.url, pages, used, mismatch: best.mismatch, variants: best.variants, year: best.year }
}
