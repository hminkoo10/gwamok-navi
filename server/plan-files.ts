import type { AdmissionPlan } from '../src/data/schema'
import { attachments, decodeHtml, type FileRef } from './discover'
import { hangulText, isHwp5 } from './hwp'
import { looksLikePdf, pdfPageTexts } from './pdf-render'
import type { DocText } from './plan-update'
import { CookieJar, safeFetch } from './safe-fetch'
import { fileLinks } from './watch'
import { unzip } from './zip'

// 대학 원문(시행계획·모집요강) 파일 받기와 읽기.
// 받는 주소는 우리가 정한 원문 주소의 사이트로만 한정한다 (리다이렉트도 같은 사이트 안에서만).

const isZip = (b: Buffer) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50
const isDoc = (b: Buffer) => looksLikePdf(b) || isHwp5(b) || isZip(b)

const siteOf = (host: string) => host.split('.').slice(-3).join('.')

export async function downloadPlan(plan: Pick<AdmissionPlan, 'url' | 'page' | 'watch'>): Promise<Buffer | null> {
  const urls = [plan.url, plan.page, plan.watch].filter((u): u is string => !!u)
  const sites = new Set(urls.map((u) => siteOf(new URL(u).hostname.toLowerCase())))
  const allow = (u: URL) => u.protocol === 'https:' && sites.has(siteOf(u.hostname.toLowerCase()))
  const jar = new CookieJar()
  const get = (url: string, referer?: string) =>
    safeFetch(url, { allow, maxBytes: 40_000_000, timeoutMs: 90_000, jar, referer, accept: '*/*' }).catch(() => null)

  // 게시글에서 연 경우만 내려받게 하는 곳이 있어 게시글을 먼저 연다 (쿠키·Referer)
  const page = plan.page ? await get(plan.page) : null
  const first = await get(plan.url, plan.page)
  if (first?.status === 200 && isDoc(first.body)) return first.body

  // 원문 주소가 게시글이면 첨부 파일을 따라간다 (일회용 토큰이 붙은 링크도 이때 새로 받는다).
  // 게시판마다 첨부를 붙이는 방식이 달라 학교 편제표 찾기와 같은 방법으로 모으고, 2028 시행계획일 만한 것부터 받는다
  const board = first?.status === 200 && /html/i.test(first.contentType) ? first : page
  if (!board || board.status !== 200) return null
  const seen = new Set<string>()
  const files: FileRef[] = []
  for (const f of [
    ...attachments(decodeHtml(board.body, board.contentType), board.url),
    ...fileLinks(board.body.toString('latin1')).map((href) => ({ url: href, name: '' })),
  ]) {
    try {
      const url = new URL(f.url, board.url).toString()
      if (!seen.has(url)) files.push({ url, name: f.name })
      seen.add(url)
    } catch {
      continue
    }
  }
  for (const f of rankPlanFiles(files).slice(0, 6)) {
    const r = await get(f.url, board.url)
    if (r?.status === 200 && isDoc(r.body)) return r.body
  }
  return null
}

/**
 * 게시글 첨부를 2028 시행계획일 만한 순서로: 이름·주소에 2028·시행계획이 있으면 앞으로, PDF를 한글 파일보다 앞으로
 * (배포용 한글 파일은 글자를 뽑지 못한다). 다른 해 자료와 장학·서식 같은 것은 뒤로, 아주 멀면 뺀다
 */
export function rankPlanFiles(files: FileRef[]): FileRef[] {
  const score = (f: FileRef) => {
    let url = f.url
    try {
      url = decodeURIComponent(f.url)
    } catch {
      // 주소에 깨진 % 표기가 있으면 그대로 본다
    }
    const s = `${f.name} ${url}`
    let n = 0
    if (/2028/.test(s)) n += 5
    else if (/20(1\d|2[0-79])/.test(s)) n -= 10
    if (/시행\s?계획|전형\s?계획|기본\s?계획|모집\s?요강|입학\s?전형/.test(s)) n += 4
    if (/장학|서식|양식|신청서|안내문/.test(s)) n -= 4
    if (/\.pdf\b/i.test(s)) n += 1
    return n
  }
  return files
    .map((f, i) => ({ f, s: score(f), i }))
    .filter((x) => x.s > -5)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.f)
}

/** PDF는 쪽마다, 한글 파일은 줄마다 글자. 시행계획을 압축 파일에 담아 올린 대학이 있어 압축 파일이면 안의 본 문서를 읽는다 */
export async function readPlanDoc(buf: Buffer): Promise<DocText> {
  const doc = innerDoc(buf)
  if (looksLikePdf(doc)) return { kind: 'pdf', pages: await pdfPageTexts(doc) }
  const text = hangulText(doc)
  return { kind: 'hwp', pages: text.split('\n').filter((l) => l.trim()) }
}

/** HWPX(한글 문서도 zip이다)인지: 문서 종류 표시나 목차 항목이 있다 */
const isHwpx = (buf: Buffer) => {
  try {
    return unzip(buf, (n) => n === 'mimetype' || n === 'Contents/content.hpf' || n === 'Contents/header.xml').size > 0
  } catch {
    return false
  }
}

/**
 * 압축 파일로 올린 원문이면 안의 문서(PDF·한글) 중 가장 큰 것: 본 시행계획 (외국인 특별전형 같은 딸린 문서는 작다).
 * 압축 파일이 아니거나 HWPX면 그대로. 안에 문서가 없으면 그대로 돌려줘서 읽을 때 알린다
 */
export function innerDoc(buf: Buffer): Buffer {
  if (!isZip(buf) || isHwpx(buf)) return buf
  let files: Map<string, Buffer>
  try {
    files = unzip(buf, (n) => !n.endsWith('/'))
  } catch {
    return buf
  }
  let best: Buffer | null = null
  for (const b of files.values()) if ((looksLikePdf(b) || isHwp5(b) || (isZip(b) && isHwpx(b))) && (!best || b.length > best.length)) best = b
  return best ?? buf
}
