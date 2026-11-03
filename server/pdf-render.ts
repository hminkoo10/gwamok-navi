import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// PDF의 필요한 쪽을 서버에서 JPEG 데이터 URL로 그린다 (pdf.js + @napi-rs/canvas, 둘 다 미리 빌드된 패키지).
// 학교 홈페이지에서 받은 파일을 서버가 직접 그려야 사용자가 다른 그림을 끼워 넣어 공유 데이터를 오염시킬 수 없다.

const require = createRequire(import.meta.url)
const MAX_SIDE = 1800
/** 디코딩해 받아들일 최대 픽셀 수 (가로×세로) */
const MAX_PIXELS = 60_000_000
/** pdf.js 상한: 이미지 하나의 픽셀 수, 캔버스 넓이(바이트). 기본값은 무제한이라 악성 PDF가 메모리를 터뜨릴 수 있음 */
const PDF_MAX_IMAGE_PIXELS = 25_000_000
const PDF_CANVAS_MAX_BYTES = 128 * 1024 * 1024
/** 글자 꺼내기 반복의 시간 상한. 쪽 많은 무거운 PDF가 이벤트 루프를 오래 잡지 않게 */
const TEXT_BUDGET_MS = 45_000
/** 동시 이미지 디코딩 수. 여러 요청이 한꺼번에 큰 그림을 풀어 메모리가 몰리지 않게 */
const MAX_DECODES = 2

/** PNG·JPEG·GIF·WEBP 머리글의 가로·세로. 디코딩 전에 큰 그림을 거르는 용도, 모르면 null */
export function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } // PNG
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) } // GIF
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const fmt = buf.toString('latin1', 12, 16)
    if (fmt === 'VP8X') return { w: (buf.readUIntLE(24, 3) & 0xffffff) + 1, h: (buf.readUIntLE(27, 3) & 0xffffff) + 1 }
    if (fmt === 'VP8 ') {
      const w = buf.readUInt16LE(26) & 0x3fff
      const h = buf.readUInt16LE(28) & 0x3fff
      return w && h ? { w, h } : null
    }
    if (fmt === 'VP8L' && buf[20] === 0x2f) {
      const b = buf.readUInt32LE(21)
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }
    }
    return null
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG: SOF 마커(크기 정보)가 나올 때까지 세그먼트를 건너뜀
    let p = 2
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) {
        p++
        continue
      }
      const marker = buf[p + 1]
      if (marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2
        continue
      }
      const len = buf.readUInt16BE(p + 2)
      if (len < 2) break
      // SOF0~SOF15 (DHT=c4, JPG=c8, DAC=cc 제외)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) }
      p += 2 + len
    }
    return null
  }
  return null
}

// 동시 디코딩을 MAX_DECODES개로 막는 대기열
let decoding = 0
const waiting: (() => void)[] = []
async function withDecodeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (decoding >= MAX_DECODES) await new Promise<void>((r) => waiting.push(r))
  decoding++
  try {
    return await fn()
  } finally {
    decoding--
    waiting.shift()?.()
  }
}

type PdfJs = typeof import('pdfjs-dist')
let pdfjsPromise: Promise<PdfJs> | null = null
const loadPdfJs = () =>
  (pdfjsPromise ??= (import(/* @vite-ignore */ pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href) as Promise<PdfJs>).then((pdfjs) => {
    // Node에서는 가짜 워커(같은 스레드). 워커 경로를 file:// 주소로 줘야 Windows에서도 열림
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    return pdfjs
  }))

/** getDocument 공통 옵션 (이미지·캔버스 크기 상한 포함). pdf.js 6은 글꼴 처리에 eval을 쓰지 않음 */
const docOpts = (data: Buffer) => ({
  data: new Uint8Array(data),
  useWasm: false,
  disableFontFace: true,
  maxImageSize: PDF_MAX_IMAGE_PIXELS,
  canvasMaxAreaInBytes: PDF_CANVAS_MAX_BYTES,
})

export function looksLikePdf(buf: Buffer): boolean {
  return buf.subarray(0, 1024).includes(Buffer.from('%PDF-'))
}

export function looksLikeImage(buf: Buffer): boolean {
  const h = buf.subarray(0, 12)
  return (
    h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || // PNG
    h.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) || // JPEG
    h.subarray(0, 4).toString('latin1') === 'GIF8' ||
    (h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP')
  )
}

/** 받은 그림 → 크기를 맞춘 JPEG 데이터 URL. 원본을 그대로 AI에 넘기지 않음 */
export async function normalizeImage(buf: Buffer): Promise<string> {
  // 디코딩 전에 머리글 크기로 먼저 거름
  const dim = imageSize(buf)
  if (dim && (dim.w <= 0 || dim.h <= 0 || dim.w * dim.h > MAX_PIXELS)) throw new Error('image size')
  return withDecodeSlot(async () => {
    const { createCanvas, loadImage } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
    const img = await loadImage(buf)
    if (!img.width || !img.height || img.width * img.height > MAX_PIXELS) throw new Error('image size')
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
    const canvas = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const jpg = await canvas.encode('jpeg', 85)
    return `data:image/jpeg;base64,${Buffer.from(jpg).toString('base64')}`
  })
}

/** 쪽 글자로 해당 입학년도 편제표가 있는 쪽 고르기 (1부터). 글자 층이 없으면 앞쪽부터 */
export function pickPages(texts: string[], cohort: number, max: number): number[] {
  const scored = texts.map((t, i) => {
    const s = t.replace(/\s+/g, '')
    let score = 0
    if (s.includes(`${cohort}학년도입학생`) || s.includes(`${cohort}입학생`)) score += 10
    if (/편제표|편성표/.test(s)) score += 3
    if (/택\d|선택/.test(s)) score += 1
    for (const m of s.matchAll(/(20\d\d)학년도입학생/g)) if (Number(m[1]) !== cohort) score -= 4
    return { page: i + 1, score, empty: s.length < 30 }
  })
  const best = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.page - b.page)
  if (!best.length && scored.every((x) => x.empty)) return texts.slice(0, max).map((_, i) => i + 1)
  const pages = (best.length ? best : scored).slice(0, max).map((x) => x.page)
  return pages.sort((a, b) => a - b)
}

/** 쪽마다 글자. 대입 원문이 바뀐 쪽 찾기용 */
export async function pdfPageTexts(data: Buffer, maxPages = 200): Promise<string[]> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument(docOpts(data))
  const doc = await task.promise
  try {
    const texts: string[] = []
    const until = Date.now() + TEXT_BUDGET_MS
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      if (Date.now() > until) break
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      texts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
      page.cleanup()
    }
    return texts
  } finally {
    await task.destroy()
  }
}

/** 고른 쪽(1부터)만 JPEG 데이터 URL로 */
export async function renderPdfPages(data: Buffer, pages: number[]): Promise<string[]> {
  const pdfjs = await loadPdfJs()
  const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
  const task = pdfjs.getDocument(docOpts(data))
  const doc = await task.promise
  try {
    const images: string[] = []
    for (const i of pages) {
      if (i < 1 || i > doc.numPages) continue
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(4, MAX_SIDE / Math.max(base.width, base.height)) })
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise
      images.push(`data:image/jpeg;base64,${Buffer.from(await canvas.encode('jpeg', 85)).toString('base64')}`)
      page.cleanup()
    }
    return images
  } finally {
    await task.destroy()
  }
}

export async function renderPdf(data: Buffer, cohort: number, maxPages = 4): Promise<{ images: string[]; pages: number; used: number[] }> {
  const pdfjs = await loadPdfJs()
  const { createCanvas } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
  const task = pdfjs.getDocument(docOpts(data))
  const doc = await task.promise
  try {
    // 학교교육계획서는 200쪽이 넘기도 해 300쪽까지 본다 (글자만 꺼내 가벼움). 시간 상한도 둠
    const count = Math.min(doc.numPages, 300)
    const texts: string[] = []
    const until = Date.now() + TEXT_BUDGET_MS
    for (let i = 1; i <= count; i++) {
      if (Date.now() > until) break
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      texts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
      page.cleanup()
    }
    const used = pickPages(texts, cohort, maxPages)
    const images: string[] = []
    for (const i of used) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(4, MAX_SIDE / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise
      const jpg = await canvas.encode('jpeg', 85)
      images.push(`data:image/jpeg;base64,${Buffer.from(jpg).toString('base64')}`)
      page.cleanup()
    }
    return { images, pages: doc.numPages, used }
  } finally {
    await task.destroy()
  }
}
