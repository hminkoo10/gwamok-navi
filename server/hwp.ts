import { createDecipheriv } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { codePoint, type Grid } from './tables'
import { unzip } from './zip'

// 한글 문서(HWP 5.0, HWPX)에서 표·그림·글자를 꺼낸다. 학교알리미 공시 파일에 한글 파일이 많다.
// HWP 5.0: OLE 복합 파일의 BodyText/SectionN 스트림(raw deflate)을 레코드 단위로 읽는다.
// HWPX: zip 안 Contents/sectionN.xml의 <hp:tbl>을 읽는다.
// 표 바로 앞 문단(예: "2026학년도 입학생")을 caption으로 함께 돌려준다.

export interface DocTable {
  grid: Grid
  caption: string
}

export class HwpError extends Error {}

const MAX_CELLS = 400 * 60

// ---- OLE 복합 파일 (Compound File Binary) ----

const FREE = 0xffffffff
const END = 0xfffffffe

interface DirEntry {
  name: string
  type: number
  left: number
  right: number
  child: number
  start: number
  size: number
}

class Cfb {
  private readonly buf: Buffer
  private readonly sectorSize: number
  private readonly miniSectorSize: number
  private readonly miniCutoff: number
  private readonly fat: number[] = []
  private miniFat: number[] = []
  private miniStream: Buffer = Buffer.alloc(0)
  readonly entries: DirEntry[] = []

  constructor(buf: Buffer) {
    if (buf.length < 512 || !buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
      throw new HwpError('한글 파일 형식이 아니에요.')
    this.buf = buf
    this.sectorSize = 1 << buf.readUInt16LE(30)
    this.miniSectorSize = 1 << buf.readUInt16LE(32)
    this.miniCutoff = buf.readUInt32LE(56)
    if (this.sectorSize !== 512 && this.sectorSize !== 4096) throw new HwpError('한글 파일 구조가 이상해요.')

    // FAT 섹터 목록: 헤더의 109칸 + DIFAT 사슬
    const fatSectors: number[] = []
    for (let i = 0; i < 109; i++) {
      const s = buf.readUInt32LE(76 + i * 4)
      if (s !== FREE) fatSectors.push(s)
    }
    let difat = buf.readUInt32LE(68)
    for (let guard = 0; difat !== END && difat !== FREE && guard < 1000; guard++) {
      const off = this.offset(difat)
      const per = this.sectorSize / 4 - 1
      for (let i = 0; i < per; i++) {
        const s = buf.readUInt32LE(off + i * 4)
        if (s !== FREE) fatSectors.push(s)
      }
      difat = buf.readUInt32LE(off + per * 4)
    }
    for (const s of fatSectors) {
      const off = this.offset(s)
      for (let i = 0; i < this.sectorSize / 4; i++) this.fat.push(buf.readUInt32LE(off + i * 4))
    }

    // 디렉터리 항목: 128바이트씩
    const dir = this.readChain(buf.readUInt32LE(48), Number.MAX_SAFE_INTEGER, this.fat, this.sectorSize, (s) => this.offset(s), buf)
    for (let p = 0; p + 128 <= dir.length; p += 128) {
      const nameLen = dir.readUInt16LE(p + 64)
      this.entries.push({
        name: dir.subarray(p, p + Math.max(0, Math.min(64, nameLen) - 2)).toString('utf16le'),
        type: dir[p + 66],
        left: dir.readUInt32LE(p + 68),
        right: dir.readUInt32LE(p + 72),
        child: dir.readUInt32LE(p + 76),
        start: dir.readUInt32LE(p + 116),
        size: dir.readUInt32LE(p + 120),
      })
    }
    const root = this.entries[0]
    if (!root || root.type !== 5) throw new HwpError('한글 파일 구조가 이상해요.')
    this.miniStream = this.readChain(root.start, root.size, this.fat, this.sectorSize, (s) => this.offset(s), buf)
    const miniFatBuf = this.readChain(buf.readUInt32LE(60), Number.MAX_SAFE_INTEGER, this.fat, this.sectorSize, (s) => this.offset(s), buf)
    for (let p = 0; p + 4 <= miniFatBuf.length; p += 4) this.miniFat.push(miniFatBuf.readUInt32LE(p))
  }

  private offset(sector: number): number {
    const off = (sector + 1) * this.sectorSize
    if (off + this.sectorSize > this.buf.length) throw new HwpError('한글 파일이 잘려 있어요.')
    return off
  }

  private readChain(start: number, size: number, table: number[], unit: number, at: (s: number) => number, from: Buffer): Buffer {
    const parts: Buffer[] = []
    let total = 0
    const seen = new Set<number>()
    for (let s = start; s !== END && s !== FREE && total < size; s = table[s] ?? END) {
      if (seen.has(s) || seen.size > 200_000) throw new HwpError('한글 파일 구조가 이상해요.')
      seen.add(s)
      const off = at(s)
      parts.push(from.subarray(off, off + unit))
      total += unit
    }
    const out = Buffer.concat(parts)
    return size === Number.MAX_SAFE_INTEGER ? out : out.subarray(0, size)
  }

  /** "BodyText/Section0" 꼴 경로의 스트림. 없으면 null */
  stream(path: string): Buffer | null {
    const names = path.split('/')
    let level = this.children(0)
    let found: DirEntry | undefined
    for (const name of names) {
      found = level.find((e) => e.name === name)
      if (!found) return null
      level = this.children(this.entries.indexOf(found))
    }
    if (!found || found.type !== 2) return null
    if (found.size < this.miniCutoff)
      return this.readChain(found.start, found.size, this.miniFat, this.miniSectorSize, (s) => s * this.miniSectorSize, this.miniStream)
    return this.readChain(found.start, found.size, this.fat, this.sectorSize, (s) => this.offset(s), this.buf)
  }

  /** 저장소 바로 아래 항목. 형제끼리는 left/right 트리로 이어짐 */
  children(index: number): DirEntry[] {
    const out: DirEntry[] = []
    const first = this.entries[index]?.child
    const stack = first !== undefined && first !== FREE ? [first] : []
    const seen = new Set<number>()
    while (stack.length) {
      const i = stack.pop()!
      if (i === FREE || seen.has(i) || !this.entries[i]) continue
      seen.add(i)
      const e = this.entries[i]
      out.push(e)
      stack.push(e.left, e.right)
    }
    return out
  }
}

// ---- HWP 5.0 레코드 ----

const TAG_PARA_TEXT = 0x43
const TAG_CTRL_HEADER = 0x47
const TAG_LIST_HEADER = 0x48
const TAG_TABLE = 0x4d
const CTRL_TABLE = 0x74626c20 // 'tbl '

interface Rec {
  tag: number
  level: number
  data: Buffer
}

function* records(buf: Buffer): Generator<Rec> {
  let p = 0
  while (p + 4 <= buf.length) {
    const h = buf.readUInt32LE(p)
    p += 4
    let size = h >>> 20
    if (size === 0xfff) {
      if (p + 4 > buf.length) return
      size = buf.readUInt32LE(p)
      p += 4
    }
    if (p + size > buf.length) return
    yield { tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: buf.subarray(p, p + size) }
    p += size
  }
}

// ---- 배포용 문서 ----
// 본문이 BodyText 대신 ViewText/SectionN에 있다. 스트림 맨 앞 레코드(배포용 문서 데이터, 256바이트)의 앞 4바이트가 씨앗.
// 씨앗으로 돌린 MSVC rand로 나머지 252바이트를 풀면 (씨앗 & 0xf) + 4 자리부터 16바이트가 AES-128 키.
// 그 뒤를 AES-128-ECB로 풀면 보통 본문 스트림이 된다 (압축 문서면 이어서 inflate). 출처: 한글 문서 파일 형식 5.0 「배포용 문서」

const TAG_DISTRIBUTE_DOC_DATA = 0x1c

/** 배포용 문서 구역 스트림 → 보통 구역 스트림. 모양이 다르면 null */
export function viewTextSection(raw: Buffer): Buffer | null {
  if (raw.length < 4 + 256) return null
  const h = raw.readUInt32LE(0)
  if ((h & 0x3ff) !== TAG_DISTRIBUTE_DOC_DATA || h >>> 20 !== 256) return null
  const head = Buffer.from(raw.subarray(4, 4 + 256))
  const seed = head.readUInt32LE(0)
  let state = seed
  const rand = () => {
    state = (Math.imul(state, 214013) + 2531011) >>> 0
    return (state >>> 16) & 0x7fff
  }
  let key = 0
  let n = 0
  for (let i = 0; i < 256; i++) {
    if (n === 0) {
      key = rand() & 0xff
      n = (rand() & 0xf) + 1
    }
    if (i >= 4) head[i] ^= key
    n--
  }
  const at = 4 + (seed & 0xf)
  const body = raw.subarray(4 + 256)
  const usable = body.length - (body.length % 16)
  if (!usable) return null
  const decipher = createDecipheriv('aes-128-ecb', head.subarray(at, at + 16), null)
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(body.subarray(0, usable)), decipher.final()])
}

/** 본문 구역 스트림. 보통 문서는 BodyText, 배포용 문서는 ViewText를 복호화해서. 압축은 아직 안 푼 상태 */
function sectionStreams(cfb: Cfb, distributed: boolean): Buffer[] {
  const root = distributed ? 'ViewText' : 'BodyText'
  const sections = cfb
    .children(cfb.entries.findIndex((e) => e.name === root && e.type === 1))
    .filter((e) => /^Section\d+$/.test(e.name))
    .sort((a, b) => Number(a.name.slice(7)) - Number(b.name.slice(7)))
  const out: Buffer[] = []
  for (const s of sections.slice(0, 50)) {
    const raw = cfb.stream(`${root}/${s.name}`)
    const data = raw && distributed ? viewTextSection(raw) : raw
    if (data) out.push(data)
  }
  if (distributed && sections.length && !out.length) throw new HwpError('배포용 한글 문서를 풀지 못했어요.')
  return out
}

/** 문단 글자 (UTF-16LE). 제어 문자는 1칸짜리와 8칸(16바이트)짜리 */
export function paraText(data: Buffer): string {
  let out = ''
  for (let i = 0; i + 1 < data.length;) {
    const c = data.readUInt16LE(i)
    if (c >= 32) {
      out += String.fromCharCode(c)
      i += 2
    } else if (c === 0 || c === 10 || c === 13 || c >= 24) {
      if (c === 10 || c === 13) out += ' '
      i += 2
    } else {
      if (c === 9) out += ' '
      i += 16
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}

interface OpenTable {
  level: number
  rows: number
  cols: number
  cells: { row: number; col: number; rs: number; cs: number; text: string[] }[]
  caption: string
}

function toGrid(t: OpenTable): Grid {
  const rows = Math.min(400, Math.max(t.rows, ...t.cells.map((c) => c.row + c.rs)))
  const cols = Math.min(60, Math.max(t.cols, ...t.cells.map((c) => c.col + c.cs)))
  if (rows * cols > MAX_CELLS) return []
  const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))
  // 합친 칸이 겹겹인 문서가 격자를 여러 번 덮어쓰지 않게 쓰기 횟수 상한 (MAX_CELLS × 4)
  let writes = 0
  for (const c of t.cells) {
    if (writes > MAX_CELLS * 4) break
    const text = c.text.join(' ').trim()
    for (let r = c.row; r < Math.min(rows, c.row + c.rs); r++)
      for (let k = c.col; k < Math.min(cols, c.col + c.cs); k++) {
        grid[r][k] = text
        writes++
      }
  }
  return grid
}

/** 문서 안 그림. caption은 바로 앞 문단, name은 BinData 안 이름 */
export interface DocPicture {
  caption: string
  name: string
}

export interface HangulDoc {
  tables: DocTable[]
  pictures: DocPicture[]
  /** 그림 바이트 (없으면 null) */
  image: (name: string) => Buffer | null
}

const TAG_SHAPE_PICTURE = 0x55
const CTRL_PICTURE = 0x67736f20 // 'gso '

function sectionScan(buf: Buffer, tables: DocTable[], pics: { caption: string; binId: number }[]) {
  const stack: OpenTable[] = []
  const recent: string[] = []
  const finish = () => {
    const t = stack.pop()!
    const grid = toGrid(t)
    if (grid.length) tables.push({ grid, caption: t.caption })
  }
  for (const rec of records(buf)) {
    while (stack.length && rec.level <= stack[stack.length - 1].level) finish()
    const top = stack[stack.length - 1]
    const ctrl = rec.tag === TAG_CTRL_HEADER && rec.data.length >= 4 ? rec.data.readUInt32LE(0) : 0
    if (ctrl === CTRL_TABLE) {
      stack.push({ level: rec.level, rows: 0, cols: 0, cells: [], caption: recent.slice(-3).join(' ') })
    } else if (ctrl === CTRL_PICTURE) {
      pics.push({ caption: recent.slice(-3).join(' '), binId: 0 })
    } else if (rec.tag === TAG_SHAPE_PICTURE && rec.data.length >= 73) {
      // 그림 개체: 테두리(12) + 좌표(32) + 자르기(16) + 여백(8) + 밝기·명암·효과(3) = 71바이트 뒤가 BinItem 번호
      const last = pics[pics.length - 1]
      if (last && !last.binId) last.binId = rec.data.readUInt16LE(71)
    } else if (top && rec.tag === TAG_TABLE && rec.level === top.level + 1 && rec.data.length >= 8) {
      top.rows = rec.data.readUInt16LE(4)
      top.cols = rec.data.readUInt16LE(6)
    } else if (top && rec.tag === TAG_LIST_HEADER && rec.level === top.level + 1 && rec.data.length >= 16 && top.cells.length < 20_000) {
      top.cells.push({
        col: rec.data.readUInt16LE(8),
        row: rec.data.readUInt16LE(10),
        cs: Math.max(1, Math.min(60, rec.data.readUInt16LE(12))),
        rs: Math.max(1, Math.min(400, rec.data.readUInt16LE(14))),
        text: [],
      })
    } else if (rec.tag === TAG_PARA_TEXT) {
      const text = paraText(rec.data)
      if (!text) continue
      const cell = top?.cells[top.cells.length - 1]
      if (top && cell) cell.text.push(text)
      else if (!top) {
        recent.push(text.slice(0, 120))
        if (recent.length > 6) recent.shift()
      }
    }
  }
  while (stack.length) finish()
}

export function isHwp5(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
}

const inflateMaybe = (data: Buffer, compressed: boolean): Buffer => {
  if (!compressed) return data
  try {
    return inflateRawSync(data, { maxOutputLength: 60_000_000 })
  } catch {
    return data
  }
}

export function hwp5Doc(buf: Buffer): HangulDoc {
  const cfb = new Cfb(buf)
  const header = cfb.stream('FileHeader')
  if (!header || !header.subarray(0, 17).toString('latin1').startsWith('HWP Document File')) throw new HwpError('한글 문서가 아니에요.')
  const flags = header.readUInt32LE(36)
  if (flags & 0x2) throw new HwpError('암호가 걸린 한글 문서예요.')
  const compressed = (flags & 0x1) === 1
  const storage = (name: string) => cfb.children(cfb.entries.findIndex((e) => e.name === name && e.type === 1))
  const tables: DocTable[] = []
  const pics: { caption: string; binId: number }[] = []
  // flags 0x4 = 배포용 문서 (ViewText를 복호화해서 읽음)
  for (const raw of sectionStreams(cfb, (flags & 0x4) !== 0)) sectionScan(compressed ? inflateRawSync(raw, { maxOutputLength: 60_000_000 }) : raw, tables, pics)
  // BinItem 번호 n → BinData/BIN000n.확장자 (16진 4자리)
  const bins = storage('BinData').map((e) => e.name)
  const pictures: DocPicture[] = []
  for (const p of pics) {
    const prefix = `BIN${p.binId.toString(16).toUpperCase().padStart(4, '0')}.`
    const name = bins.find((n) => n.toUpperCase().startsWith(prefix))
    if (name && /\.(png|jpe?g|bmp|gif)$/i.test(name)) pictures.push({ caption: p.caption, name })
  }
  return {
    tables,
    pictures,
    image: (name) => {
      const raw = cfb.stream(`BinData/${name}`)
      return raw ? inflateMaybe(raw, compressed) : null
    },
  }
}

export function hwp5Tables(buf: Buffer): DocTable[] {
  return hwp5Doc(buf).tables
}

// ---- HWPX ----

const xmlDecode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&amp;/g, '&')

// HWPX 태그에는 <hp:tbl>처럼 'prefix:'가 붙는다.
// 닫히지 않은 태그가 가득한 파일에서 정규식 되짚기로 느려지지 않게, 아래 함수들은 indexOf로 앞으로만 훑는다 (선형).

const isWord = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95

/** pos('<'·'</' 바로 뒤)에서 [prefix:]name이 단어 경계까지 맞으면 이름 끝 위치, 아니면 -1. 대소문자 무시, name은 소문자로 */
function matchName(s: string, pos: number, name: string): number {
  let p = pos
  let q = pos
  while (isWord(s.charCodeAt(q))) q++
  if (q > pos && s.charCodeAt(q) === 58 /* : */) p = q + 1 // prefix: 건너뜀
  for (let j = 0; j < name.length; j++) {
    let c = s.charCodeAt(p + j)
    if (c >= 65 && c <= 90) c += 32
    if (c !== name.charCodeAt(j)) return -1
  }
  return isWord(s.charCodeAt(p + name.length)) ? -1 : p + name.length
}

/** <[prefix:]name ...>...</[prefix:]name> 요소들. 게으른 *?처럼 가장 가까운 닫는 태그까지 */
function* nsElements(xml: string, name: string): Generator<{ attrs: string; inner: string }> {
  let from = 0
  for (;;) {
    let lt = xml.indexOf('<', from)
    let ne = -1
    for (; lt >= 0; lt = xml.indexOf('<', lt + 1)) {
      if (xml.charCodeAt(lt + 1) === 47) continue // '</' 닫는 태그는 건너뜀
      ne = matchName(xml, lt + 1, name)
      if (ne >= 0) break
    }
    if (lt < 0 || ne < 0) return
    const gt = xml.indexOf('>', ne)
    if (gt < 0) return
    const close = nsClose(xml, name, gt + 1)
    if (close < 0) return
    yield { attrs: xml.slice(ne, gt), inner: xml.slice(gt + 1, close) }
    from = xml.indexOf('>', close) + 1
    if (from <= 0) return
  }
}

/** from부터 </[prefix:]name>의 '<' 위치, 없으면 -1 */
function nsClose(xml: string, name: string, from: number): number {
  for (let lt = xml.indexOf('</', from); lt >= 0; lt = xml.indexOf('</', lt + 1)) {
    const ne = matchName(xml, lt + 2, name)
    if (ne >= 0 && xml.charCodeAt(ne) === 62) return lt
  }
  return -1
}

/** <[prefix:]name ...> 여는 태그만. /<(?:\w+:)?name\b[^>]*>/g와 같은 결과 */
function* nsOpenTags(xml: string, name: string): Generator<{ tag: string; start: number }> {
  let from = 0
  for (;;) {
    let lt = xml.indexOf('<', from)
    let ne = -1
    for (; lt >= 0; lt = xml.indexOf('<', lt + 1)) {
      if (xml.charCodeAt(lt + 1) === 47) continue
      ne = matchName(xml, lt + 1, name)
      if (ne >= 0) break
    }
    if (lt < 0 || ne < 0) return
    const gt = xml.indexOf('>', ne)
    if (gt < 0) return
    yield { tag: xml.slice(lt, gt + 1), start: lt }
    from = gt + 1
  }
}

/** replace(/<[^>]+>/g, '')의 선형판. 닫는 >가 없으면 나머지는 그대로 */
function stripTagsHard(s: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const lt = s.indexOf('<', i)
    const gt = lt < 0 ? -1 : s.indexOf('>', lt + 2)
    if (gt < 0) return out + s.slice(i)
    if (s.charCodeAt(lt + 1) === 62) {
      out += s.slice(i, lt + 1)
      i = lt + 1
      continue
    }
    out += s.slice(i, lt)
    i = gt + 1
  }
}

const runText = (xml: string) => {
  let out = ''
  for (const e of nsElements(xml, 't')) out += xmlDecode(stripTagsHard(e.inner))
  return out.replace(/\s+/g, ' ').trim()
}

/** <[prefix:]tbl ...> / </[prefix:]tbl> 태그를 문서 순서대로 */
function* tblTags(xml: string): Generator<{ close: boolean; start: number; end: number }> {
  for (let lt = xml.indexOf('<', 0); lt >= 0; lt = xml.indexOf('<', lt + 1)) {
    const close = xml.charCodeAt(lt + 1) === 47
    const ne = matchName(xml, lt + (close ? 2 : 1), 'tbl')
    if (ne < 0) continue
    const gt = xml.indexOf('>', ne)
    if (gt < 0) return
    yield { close, start: lt, end: gt + 1 }
    lt = gt // 태그 안은 건너뜀
  }
}

/** 겹친 <hp:tbl>을 짝지어 바깥부터 꺼낸다 */
function tableSpans(xml: string): { start: number; end: number; inner: string }[] {
  const out: { start: number; end: number; inner: string }[] = []
  const stack: number[] = []
  for (const t of tblTags(xml)) {
    if (!t.close) stack.push(t.start)
    else {
      const start = stack.pop()
      if (start === undefined) continue
      out.push({ start, end: t.end, inner: xml.slice(start, t.end) })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** body 안의 안쪽 표(<tbl>…</tbl>)를 걷어 내 바깥 표의 칸만 남김. 선형 */
function stripNestedTbl(body: string): string {
  let out = ''
  let depth = 0
  let last = 0
  for (const t of tblTags(body)) {
    if (!t.close) {
      if (depth === 0) out += body.slice(last, t.start)
      depth++
    } else if (depth > 0 && --depth === 0) last = t.end
  }
  if (depth === 0) out += body.slice(last)
  return out
}

const attr = (tag: string | undefined, key: string) => Number(tag?.match(new RegExp(`\\b${key}="(\\d+)"`))?.[1] ?? NaN)

export function hwpxDoc(buf: Buffer): HangulDoc {
  const files = unzip(buf, (n) => /^Contents\/section\d+\.xml$/i.test(n) || /^BinData\//i.test(n))
  const tables: DocTable[] = []
  const pictures: DocPicture[] = []
  const names = [...files.keys()].filter((n) => n.startsWith('Contents/')).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
  const binNames = [...files.keys()].filter((n) => /^BinData\//i.test(n))
  for (const name of names) {
    const xml = files.get(name)!.toString('utf8')
    for (const span of tableSpans(xml)) {
      // 안쪽 표는 따로 꺼내므로 바깥 표에서는 걷어 냄 (칸 짝이 어긋나지 않게)
      const open = span.inner.indexOf('>') + 1
      const body = stripNestedTbl(span.inner.slice(open, span.inner.lastIndexOf('<')))
      const cells: OpenTable['cells'] = []
      for (const tc of nsElements(body, 'tc')) {
        if (cells.length >= 20_000) break
        const addr = tc.inner.match(/<(?:\w+:)?cellAddr\b[^>]*>/)?.[0]
        const spanTag = tc.inner.match(/<(?:\w+:)?cellSpan\b[^>]*>/)?.[0]
        const col = attr(addr, 'colAddr')
        const row = attr(addr, 'rowAddr')
        if (!Number.isFinite(col) || !Number.isFinite(row)) continue
        cells.push({
          col,
          row,
          cs: Math.max(1, Math.min(60, attr(spanTag, 'colSpan') || 1)),
          rs: Math.max(1, Math.min(400, attr(spanTag, 'rowSpan') || 1)),
          text: [runText(tc.inner)],
        })
      }
      const head = span.inner.match(/<(?:\w+:)?tbl\b[^>]*>/)?.[0]
      const before = runText(xml.slice(Math.max(0, span.start - 4000), span.start)).slice(-200)
      const grid = toGrid({ level: 0, rows: attr(head, 'rowCnt') || 0, cols: attr(head, 'colCnt') || 0, cells, caption: '' })
      if (grid.length) tables.push({ grid, caption: before })
    }
    // 그림: <hp:pic> … <hc:img binaryItemIDRef="image3"/>
    for (const { tag, start } of nsOpenTags(xml, 'img')) {
      const ref = tag.match(/binaryItemIDRef="([^"]+)"/)?.[1]
      if (!ref) continue
      const file = binNames.find((n) => n.slice(8).replace(/\.[^.]+$/, '') === ref)
      if (!file || !/\.(png|jpe?g|bmp|gif)$/i.test(file)) continue
      const caption = runText(xml.slice(Math.max(0, start - 4000), start)).slice(-200)
      pictures.push({ caption, name: file })
    }
  }
  return { tables, pictures, image: (name) => files.get(name) ?? null }
}

export function hwpxTables(buf: Buffer): DocTable[] {
  return hwpxDoc(buf).tables
}

/** HWP 5.0 또는 HWPX */
export function hangulDoc(buf: Buffer): HangulDoc {
  return isHwp5(buf) ? hwp5Doc(buf) : hwpxDoc(buf)
}

export function hangulTables(buf: Buffer): DocTable[] {
  return hangulDoc(buf).tables
}

const gridLines = (grid: Grid) => grid.map((row) => `| ${row.map((c) => c.replace(/[|]/g, '/')).join(' | ')} |`)

/** 문단 글자와 표(| 칸 | 칸 |)를 문서 순서대로. 한글 파일인 대입 원문의 바뀐 곳 찾기·AI 입력용 */
export function hangulText(buf: Buffer): string {
  if (!isHwp5(buf)) {
    // HWPX: </p>마다 줄바꿈 뒤 태그 제거. 표 칸 글자도 문단 안에 있음
    const files = unzip(buf, (n) => /^Contents\/section\d+\.xml$/i.test(n))
    return [...files.keys()]
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
      .map((n) =>
        stripTagsHard(
          files
            .get(n)!
            .toString('utf8')
            .replace(/<\/(?:\w+:)?p>/g, '\n'),
        )
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&'),
      )
      .join('\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
  }
  const cfb = new Cfb(buf)
  const header = cfb.stream('FileHeader')
  if (!header || !header.subarray(0, 17).toString('latin1').startsWith('HWP Document File')) throw new HwpError('한글 문서가 아니에요.')
  const flags = header.readUInt32LE(36)
  if (flags & 0x2) throw new HwpError('암호가 걸린 한글 문서예요.')
  const compressed = (flags & 0x1) === 1
  const out: string[] = []
  // flags 0x4 = 배포용 문서 (ViewText를 복호화해서 읽음)
  for (const raw of sectionStreams(cfb, (flags & 0x4) !== 0)) {
    const data = compressed ? inflateRawSync(raw, { maxOutputLength: 60_000_000 }) : raw
    const stack: OpenTable[] = []
    const finish = () => out.push(...gridLines(toGrid(stack.pop()!)))
    for (const rec of records(data)) {
      while (stack.length && rec.level <= stack[stack.length - 1].level) finish()
      const top = stack[stack.length - 1]
      const ctrl = rec.tag === TAG_CTRL_HEADER && rec.data.length >= 4 ? rec.data.readUInt32LE(0) : 0
      if (ctrl === CTRL_TABLE) stack.push({ level: rec.level, rows: 0, cols: 0, cells: [], caption: '' })
      else if (top && rec.tag === TAG_TABLE && rec.level === top.level + 1 && rec.data.length >= 8) {
        top.rows = rec.data.readUInt16LE(4)
        top.cols = rec.data.readUInt16LE(6)
      } else if (top && rec.tag === TAG_LIST_HEADER && rec.level === top.level + 1 && rec.data.length >= 16 && top.cells.length < 20_000) {
        top.cells.push({
          col: rec.data.readUInt16LE(8),
          row: rec.data.readUInt16LE(10),
          cs: Math.max(1, Math.min(60, rec.data.readUInt16LE(12))),
          rs: Math.max(1, Math.min(400, rec.data.readUInt16LE(14))),
          text: [],
        })
      } else if (rec.tag === TAG_PARA_TEXT) {
        const text = paraText(rec.data)
        if (!text) continue
        const cell = top?.cells[top.cells.length - 1]
        if (top && cell) cell.text.push(text)
        else if (!top) out.push(text)
      }
    }
    while (stack.length) finish()
  }
  return out.join('\n')
}
