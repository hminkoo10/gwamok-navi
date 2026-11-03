import { SUBJECTS } from '../src/data/subjects'
import { subjectKey } from '../src/engine/school'
import { unzip } from './zip'

// 페이지 안 HTML 표와 엑셀 파일을 칸 위치가 보이는 글자 표로 바꾼다. 합친 칸(rowspan/colspan)은 값을 펼쳐 채운다.
// 이렇게 만든 글은 그림보다 싸고 정확하게 AI가 읽는다.

export type Grid = string[][]

const MAX_ROWS = 400
const MAX_COLS = 60
const MAX_TEXT = 40_000

/** 숫자 문자 참조를 글자로. 없는 코드(0, 서로게이트, U+10FFFF 넘음)는 U+FFFD로 바꾼다 (fromCodePoint가 예외를 던지지 않게) */
export const codePoint = (n: number) => (n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : '�')

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&amp;/g, '&')

// 학교 페이지는 3MB까지 받는다. 닫히지 않은 태그가 잔뜩 든 페이지에서 정규식이 처음부터 끝까지 되풀이해 훑지 않도록
// 태그는 indexOf로 앞으로만 훑는다 (한 번 지나간 곳은 다시 보지 않는다).

const isWordChar = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95

/** 태그(<...>)를 빈칸으로 바꾼다. /<[^>]+>/g와 같지만 닫는 >가 없으면 거기서 멈춘다 */
export function stripTags(s: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const lt = s.indexOf('<', i)
    const gt = lt < 0 ? -1 : s.indexOf('>', lt + 2)
    // <> 처럼 속이 빈 것은 태그가 아니다. 뒤에 >가 하나도 없으면 남은 <도 태그가 될 수 없다
    if (gt < 0) return out + s.slice(i)
    if (s.charCodeAt(lt + 1) === 62) {
      out += s.slice(i, lt + 1)
      i = lt + 1
      continue
    }
    out += `${s.slice(i, lt)} `
    i = gt + 1
  }
}

// 소문자 복사본을 만들지 않고 원본 자리에서 대소문자 무시로 태그 이름을 맞춘다 (대소문자로 길이가 달라지는 글자가 섞여도 자리가 어긋나지 않게).
// 닫히지 않은 태그가 가득한 입력에서 정규식이 자리마다 되짚지 않도록 모두 indexOf로 앞으로만 훑는다.

/** s의 pos가 소문자 name과 (대소문자 무시) 같고 name 뒤가 단어 문자가 아니면 true. name은 소문자여야 한다 */
function nameAt(s: string, pos: number, name: string): boolean {
  for (let j = 0; j < name.length; j++) {
    let c = s.charCodeAt(pos + j)
    if (c >= 65 && c <= 90) c += 32
    if (c !== name.charCodeAt(j)) return false
  }
  return !isWordChar(s.charCodeAt(pos + name.length))
}

/** from부터 '<'를 훑어, names 가운데 처음 나오는 여는 태그('<' 위치와 이름) */
function nextOpen(s: string, names: string[], from: number): { name: string; lt: number } | null {
  for (let lt = s.indexOf('<', from); lt >= 0; lt = s.indexOf('<', lt + 1)) for (const name of names) if (nameAt(s, lt + 1, name)) return { name, lt }
  return null
}

/** from부터 '</'를 훑어, names 가운데 처음 나오는 닫는 태그('</' 위치와 태그 길이) */
function nextClose(s: string, names: string[], from: number): { lt: number; len: number } | null {
  for (let lt = s.indexOf('</', from); lt >= 0; lt = s.indexOf('</', lt + 1))
    for (const name of names) if (nameAt(s, lt + 2, name) && s.charCodeAt(lt + 2 + name.length) === 62) return { lt, len: name.length + 3 }
  return null
}

/** <이름 ...> 여는 태그만 통째로 (닫는 >까지). /<이름\b[^>]*>/gi의 matchAll과 같다 */
export function* openTags(html: string, name: string): Generator<string> {
  let from = 0
  for (;;) {
    const hit = nextOpen(html, [name], from)
    if (!hit) return
    const gt = html.indexOf('>', hit.lt + 1 + name.length)
    if (gt < 0) return
    yield html.slice(hit.lt, gt + 1)
    from = gt + 1
  }
}

export interface Element {
  /** 여는 태그 이름 (names 가운데 하나, 소문자) */
  name: string
  /** 여는 태그의 이름 뒤부터 > 앞까지 */
  attrs: string
  /** 여는 태그 뒤부터 가장 가까운 닫는 태그 앞까지 */
  inner: string
}

/**
 * /<(이름)\b([^>]*)>([\s\S]*?)<\/(닫는 이름)>/gi의 matchAll과 같은 결과를 앞으로만 훑어 낸다 (게으른 *? 그대로, 가장 가까운 닫는 태그까지).
 * 여는 태그의 >나 닫는 태그가 더 없으면 멈춘다.
 */
export function* elements(html: string, names: string[], closes: string[] = names): Generator<Element> {
  let from = 0
  for (;;) {
    const hit = nextOpen(html, names, from)
    if (!hit) return
    const nameEnd = hit.lt + 1 + hit.name.length
    const gt = html.indexOf('>', nameEnd)
    if (gt < 0) return
    const close = nextClose(html, closes, gt + 1)
    if (!close) return
    yield { name: hit.name, attrs: html.slice(nameEnd, gt), inner: html.slice(gt + 1, close.lt) }
    from = close.lt + close.len
  }
}

/** <script>·<style> 안을 빈칸 하나로 (/<(script|style)\b[\s\S]*?<\/\1>/gi와 같다. 짝 없는 여는 태그는 건너뛴다) */
export function dropScripts(html: string): string {
  let out = ''
  let i = 0 // 여기까지 내보냈다
  let search = 0 // 여는 태그는 여기부터 찾는다
  for (;;) {
    const hit = nextOpen(html, ['script', 'style'], search)
    if (!hit) return out + html.slice(i)
    const close = nextClose(html, [hit.name], hit.lt + 1 + hit.name.length)
    if (!close) {
      search = hit.lt + 1
      continue
    }
    out += `${html.slice(i, hit.lt)} `
    i = close.lt + close.len
    search = i
  }
}

const cellText = (html: string) =>
  decodeEntities(stripTags(html.replace(/<br\s*\/?>/gi, ' ')))
    .replace(/\s+/g, ' ')
    .trim()

const span = (attrs: string, name: string) => Math.max(1, Math.min(50, Number(attrs.match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i'))?.[1] ?? 1)))

/** 페이지의 표들을 칸 격자로. 표 안의 표는 바깥 표 칸 글자로만 남는다. */
export function htmlTables(html: string): Grid[] {
  const out: Grid[] = []
  const body = dropScripts(html)
  for (const t of elements(body, ['table'])) {
    const grid: string[][] = []
    let r = 0
    for (const row of elements(t.inner, ['tr'])) {
      if (r >= MAX_ROWS) break
      grid[r] ??= []
      let c = 0
      for (const cell of elements(row.inner, ['td', 'th'])) {
        while (grid[r][c] !== undefined) c++
        if (c >= MAX_COLS) break
        const rs = span(cell.attrs, 'rowspan')
        const cs = span(cell.attrs, 'colspan')
        const text = cellText(cell.inner)
        for (let i = 0; i < rs && r + i < MAX_ROWS; i++) for (let j = 0; j < cs && c + j < MAX_COLS; j++) (grid[r + i] ??= [])[c + j] = text
        c += cs
      }
      r++
    }
    const width = Math.max(0, ...grid.map((x) => x.length))
    out.push(grid.map((x) => Array.from({ length: width }, (_, i) => x[i] ?? '')))
  }
  return out
}

const KNOWN = new Set(SUBJECTS.map((s) => subjectKey(s.name)))

/** 2022 개정 과목 이름이 몇 개 들어 있는지 */
export function subjectHits(grid: Grid): number {
  const seen = new Set<string>()
  for (const row of grid) for (const cell of row) if (cell.length <= 30 && KNOWN.has(subjectKey(cell))) seen.add(subjectKey(cell))
  return seen.size
}

const HEAD_WORDS = [/학기/, /학점|단위/, /교과/, /입학/, /학년/, /과목/]

/**
 * 편제표로 보이는 표만.
 * - 보통교과 과목 이름이 여럿이고 학점·학기 말이 있는 표 (일반고)
 * - 보통교과는 몇 개뿐이어도 머리말(학기·학점·교과·입학·학년·과목)을 고루 갖춘 큰 표 (특성화고: 전문교과가 대부분)
 */
export function curriculumTables(grids: Grid[]): Grid[] {
  return grids.filter((g) => {
    const head = g.slice(0, 8).flat().join(' ')
    const all = g.flat().join(' ')
    if (subjectHits(g) >= 8 && /학점|단위|학기/.test(all)) return true
    const words = HEAD_WORDS.filter((w) => w.test(head)).length
    return subjectHits(g) >= 2 && words >= 3 && g.length >= 10 && (g[0]?.length ?? 0) >= 5
  })
}

export function gridText(grids: Grid[], labels: string[] = []): string {
  const parts: string[] = []
  grids.forEach((g, i) => {
    const rows = g.filter((row) => row.some((c) => c)).map((row) => row.join(' | '))
    parts.push(`${labels[i] ? `[${labels[i]}]` : `[표 ${i + 1}]`}\n${rows.join('\n')}`)
  })
  const text = parts.join('\n\n')
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n(이하 생략)` : text
}

// ---- 엑셀 ----

const colIndex = (ref: string) => {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
const rowIndex = (ref: string) => Number(ref.match(/\d+$/)?.[0] ?? 1) - 1

const xmlText = (xml: string) => [...elements(xml, ['t'])].map((e) => decodeEntities(e.inner)).join('')

/** xlsx 시트들을 칸 격자로 (시트 이름과 함께) */
export function xlsxGrids(buf: Buffer): { name: string; grid: Grid }[] {
  const files = unzip(buf, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n))
  const shared = [...elements(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '', ['si'])].map((e) => xmlText(e.inner))
  const rels = new Map(
    [...(files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      m[0].match(/Id="([^"]+)"/)?.[1] ?? '',
      (m[0].match(/Target="([^"]+)"/)?.[1] ?? '').replace(/^\/?(xl\/)?/, 'xl/'),
    ]),
  )
  const sheets = [...(files.get('xl/workbook.xml')?.toString('utf8') ?? '').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decodeEntities(m[0].match(/name="([^"]+)"/)?.[1] ?? ''),
    path: rels.get(m[0].match(/r:id="([^"]+)"/)?.[1] ?? '') ?? '',
    hidden: /state="(hidden|veryHidden)"/.test(m[0]),
  }))
  const out: { name: string; grid: Grid }[] = []
  for (const sheet of sheets.slice(0, 12)) {
    const xml = sheet.hidden ? undefined : files.get(sheet.path)?.toString('utf8')
    if (!xml) continue
    const grid: string[][] = []
    // 값이 있는 칸은 <c ...>...</c> 꼴이다. 값 없는 빈 칸(<c .../>)은 격자에 아무것도 넣지 않으므로 건너뛴다
    for (const c of elements(xml, ['c'])) {
      const ref = c.attrs.match(/r="([A-Z]+\d+)"/)?.[1]
      if (!ref) continue
      const r = rowIndex(ref)
      const col = colIndex(ref)
      if (r >= MAX_ROWS || col >= MAX_COLS) continue
      const type = c.attrs.match(/t="(\w+)"/)?.[1]
      const inner = c.inner
      const v = decodeEntities(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
      const text = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? xmlText(inner) : v
      ;(grid[r] ??= [])[col] = text.replace(/\s+/g, ' ').trim()
    }
    // 합친 칸은 왼쪽 위 값을 펼친다. 격자(400×60) 안에서만 채우므로 합친 칸·채우는 칸 수를 넉넉히 막아 둔다
    // (0.5MB짜리 xlsx가 mergeCell 2만 개로 이벤트 루프를 5초 막은 사례가 있다)
    let writes = 0
    let merges = 0
    for (const m of xml.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      if (++merges > 5_000 || writes > MAX_ROWS * MAX_COLS * 4) break
      const [r0, c0, r1, c1] = [rowIndex(m[1]), colIndex(m[1]), rowIndex(m[2]), colIndex(m[2])]
      const value = grid[r0]?.[c0] ?? ''
      for (let r = r0; r <= Math.min(r1, MAX_ROWS - 1); r++)
        for (let c = c0; c <= Math.min(c1, MAX_COLS - 1); c++) {
          ;(grid[r] ??= [])[c] = value
          writes++
        }
    }
    const width = Math.max(0, ...grid.filter(Boolean).map((x) => x.length))
    out.push({ name: sheet.name, grid: Array.from(grid, (row) => Array.from({ length: width }, (_, i) => row?.[i] ?? '')) })
  }
  return out
}
