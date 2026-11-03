import { checkRobots } from './robots'
import { CookieJar, FetchBlocked, safeFetch, sameSchoolSite } from './safe-fetch'
import { curriculumTables, dropScripts, elements, htmlTables, openTags, stripTags } from './tables'

// 학교 홈페이지에서 교육과정 편제표를 찾는다.
// 첫 화면 → '교육과정' 메뉴 페이지 → (게시판이면) 편제표 글 → 첨부 파일·본문 그림·본문 표.
// 지역마다 홈페이지 시스템이 달라 아는 형식(경기·세종·제주 등 ntt형, 서울 dggb형, 대전·강원 boardCnts형)을 먼저 보고
// 일반 링크 규칙으로도 찾는다.

/** pdf·xlsx·hwp(한글): 첨부 파일, images: 본문 그림, table: 본문 HTML 표 */
export type DocKind = 'pdf' | 'xlsx' | 'images' | 'table' | 'hwp'

export interface DocCandidate {
  /** 파일 주소. 그림·본문 표면 그 페이지 주소 */
  url: string
  kind: DocKind
  /** kind가 images일 때 그림 주소 */
  images?: string[]
  fileName: string
  postTitle: string
  /** 사람이 원문을 확인할 페이지 */
  postUrl: string
  score: number
  /** homepage: 학교 홈페이지, schoolinfo: 학교알리미 공시 */
  source: 'homepage' | 'schoolinfo'
}

export interface Page {
  url: string
  html: string
}

export type Fetcher = (url: string, allow: (u: URL) => boolean, form?: Record<string, string>) => Promise<Page>

/** 열어 볼 페이지. form이 있으면 POST */
interface PageReq {
  url: string
  form?: Record<string, string>
  title: string
  /** 사람이 브라우저로 열 수 있는 주소 */
  human: string
}

const HTML_LIMIT = 3_000_000

/** 한 번 둘러보는 동안 쿠키·Referer를 이어 가고 전체 시간 상한을 지키는 fetcher. robots: 받기 전 검사 */
export function siteFetcher(deadline = Date.now() + 40_000, jar = new CookieJar(), robots: (url: string) => Promise<void> = checkRobots): Fetcher {
  let referer: string | undefined
  return async (url, allow, form) => {
    const left = deadline - Date.now()
    if (left < 1_000) throw new FetchBlocked('학교 홈페이지 응답이 너무 늦어요.')
    await robots(url)
    const res = await safeFetch(url, {
      allow,
      maxBytes: HTML_LIMIT,
      timeoutMs: Math.min(15_000, left),
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      jar,
      form,
      referer,
    })
    if (res.status >= 400) throw new FetchBlocked(`페이지를 열 수 없어요 (${res.status}).`)
    referer = res.url
    return { url: res.url, html: decodeHtml(res.body, res.contentType) }
  }
}

export function decodeHtml(buf: Buffer, contentType: string): string {
  const head = buf.subarray(0, 2048).toString('latin1')
  const charset = (contentType.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8').toLowerCase()
  try {
    return new TextDecoder(charset === 'ks_c_5601-1987' ? 'euc-kr' : charset).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

const strip = (s: string) =>
  stripTags(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const abs = (href: string, base: string): string | null => {
  try {
    return new URL(href.replace(/&amp;/g, '&').trim(), base).toString()
  } catch {
    return null
  }
}

interface Anchor {
  href: string | null
  onclick: string
  text: string
}

function anchors(html: string, base: string): Anchor[] {
  const out: Anchor[] = []
  for (const m of elements(html, ['a'])) {
    const attrs = m.attrs
    const rawHref = attrs.match(/href\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''
    const title = attrs.match(/title\s*=\s*["']([^"']+)["']/i)?.[1] ?? ''
    const onclick = attrs.match(/onclick\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/onclick\s*=\s*'([^']*)'/i)?.[1] ?? ''
    const real = rawHref && !/^(javascript:|#|mailto:|tel:)/i.test(rawHref.trim())
    out.push({ href: real ? abs(rawHref, base) : null, onclick, text: strip(m.inner) || strip(title) })
  }
  return out
}

// ---- 제목 점수 ----

/** 제목에 나오는 학년도. '2024~2026학년도' 같은 범위도 (6년까지) */
export function yearsIn(title: string): number[] {
  const out = new Set<number>()
  for (const m of title.matchAll(/(?:20)?(\d\d)\s*[~∼\-–]\s*(?:20)?(\d\d)\s*학년도/g)) {
    const a = 2000 + Number(m[1])
    const b = 2000 + Number(m[2])
    for (let y = Math.min(a, b); y <= Math.max(a, b) && y - Math.min(a, b) < 6; y++) out.add(y)
  }
  for (const m of title.matchAll(/(?:20)?(\d\d)\s*학년도/g)) out.add(2000 + Number(m[1]))
  for (const m of title.matchAll(/(?<!\d)20(\d\d)(?!\d)/g)) out.add(2000 + Number(m[1]))
  return [...out]
}

const COHORT_RE = /(?:20)?(\d\d)\s*학년도\s*(?:고등학교\s*)?(?:신\s*)?입학생/g

/** "○○학년도 입학생"의 입학년도들, 나온 순서대로 */
export const cohortMentions = (text: string): number[] => [...text.matchAll(COHORT_RE)].map((m) => 2000 + Number(m[1]))

/**
 * 입학년도에 맞는 것만. 맨 끝 언급(가장 가까운 제목)이 그 해면 최우선, 다른 해만 말하면 뺌.
 * 아무 해도 말하지 않으면(전학년 표 등) 마지막 수단
 */
export function pickByCohort<T>(items: T[], textOf: (x: T) => string, cohort: number, max: number): T[] {
  const scored = items.map((x) => {
    const ms = cohortMentions(textOf(x))
    const s = ms.at(-1) === cohort ? 2 : ms.includes(cohort) ? 1 : ms.length ? -1 : 0
    return { x, s }
  })
  const best = Math.max(-1, ...scored.map((y) => y.s))
  if (best < 0) return []
  return scored
    .filter((y) => y.s === best)
    .slice(0, max)
    .map((y) => y.x)
}
const STRONG = /편제표|편성표|배당표|편제\s*및|학점\s*배당|단위\s*배당|이수\s*학점|과목\s*편성/
const NOISE = /운영\s*계획|설명회|안내문|가정\s*통신|수강\s*신청|시간표|진로\s*탐구|신청서|동의서|양식|결과\s*보고|만족도|평가\s*계획|수행\s*평가|방과\s*후/

/** 제목에 학과 이름이 있는지. 띄어쓰기와 끝의 학과·과·계열·과정·학급·반은 무시 */
export function mentionsTrack(title: string, track: string): boolean {
  if (!track) return false
  const t = title.replace(/\s+/g, '')
  const name = track.replace(/\s+/g, '')
  const stem = name.replace(/(학과|과|계열|과정|학급|반)$/, '')
  return t.includes(name) || (stem.length >= 2 && t.includes(stem))
}

export function scoreTitle(title: string, cohort: number, track = ''): number {
  const t = title.replace(/\s+/g, ' ')
  const years = yearsIn(t)
  const cohorts = [...t.matchAll(COHORT_RE)].map((m) => 2000 + Number(m[1]))
  let s = 0
  if (mentionsTrack(t, track)) s += 3
  // 고친 판은 조금 앞으로, 초안은 뒤로
  if (/최종|확정|변경\s*후|수정/.test(t)) s += 1
  if (/\(안\)|변경\s*전/.test(t)) s -= 2
  if (STRONG.test(t)) s += 4
  if (/교육\s*과정/.test(t)) s += 1
  if (/입학생/.test(t)) s += 1
  if (cohorts.includes(cohort)) s += 5
  else if (years.includes(cohort)) s += 2
  // 다른 해 입학생 전용 표는 못 쓰니 크게 감점
  if (cohorts.length && !cohorts.includes(cohort) && !years.includes(cohort)) s -= 8
  if (NOISE.test(t)) s -= 2
  if (/체육\s*(학급|과)|특수\s*학급|예술\s*(학급|과)/.test(t)) s -= 1
  return s
}

// ---- 게시판 글 ----

/** ntt형(경기·세종·제주 등): <a href="javascript:" data-id="글번호">제목</a>, 글은 selectNttInfo.do */
export function nttPosts(html: string, listUrl: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = []
  if (!/selectNttList\.do/.test(listUrl)) return out
  for (const m of elements(html, ['a'])) {
    const id = m.attrs.match(/\bdata-id\s*=\s*["'](\d+)["']/i)?.[1]
    // 600자 넘으면 글 제목이 아닌 a 태그로 봄
    if (!id || !m.inner || m.inner.length > 600) continue
    const text = strip(m.inner)
    if (!text) continue
    const url = new URL(listUrl)
    url.pathname = url.pathname.replace('selectNttList.do', 'selectNttInfo.do')
    url.searchParams.set('nttSn', id)
    out.push({ href: url.toString(), text })
  }
  return out
}

/** id나 name이 formId인 폼의 input 값. 없으면 null */
function formFields(html: string, formId: string): Record<string, string> | null {
  const idRe = new RegExp(`(?:id|name)\\s*=\\s*["']${formId}["']`, 'i')
  for (const form of elements(html, ['form'])) {
    if (!idRe.test(form.attrs)) continue
    const fields: Record<string, string> = {}
    for (const tag of openTags(form.inner, 'input')) {
      const name = tag.match(/name\s*=\s*["']([^"']+)["']/i)?.[1]
      if (!name) continue
      fields[name] = strip(tag.match(/value\s*=\s*["']([^"']*)["']/i)?.[1] ?? '')
    }
    return fields
  }
  return null
}

/** 서울 dggb형: 목록은 boardFrm 폼을 POST로 보내 받고, 글은 fnView('게시판', '글번호') */
function dggbList(page: Page): PageReq | null {
  if (!/selectBoardListAjax\.do/.test(page.html)) return null
  const fields = formFields(page.html, 'boardFrm')
  if (!fields?.bbsId) return null
  const url = new URL('/dggb/module/board/selectBoardListAjax.do', page.url).toString()
  return { url, form: fields, title: '', human: page.url }
}

function dggbPosts(page: Page, fields: Record<string, string> | undefined, human: string): PageReq[] {
  const out: PageReq[] = []
  for (const a of anchors(page.html, page.url)) {
    const m = a.onclick.match(/fnView\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/)
    if (!m || !a.text) continue
    out.push({
      url: new URL('/dggb/module/board/selectBoardDetailAjax.do', page.url).toString(),
      form: { ...fields, bbsId: m[1], nttId: m[2] },
      title: a.text,
      human,
    })
  }
  return out
}

function formAction(html: string, formId: string): string | null {
  const idRe = new RegExp(`(?:id|name)\\s*=\\s*["']${formId}["']`, 'i')
  for (const tag of openTags(html, 'form')) if (idRe.test(tag)) return tag.match(/action\s*=\s*["']([^"']+)["']/i)?.[1] ?? null
  return null
}

const PAGE_KEYS = ['page', 'pageIndex', 'currPage', 'pageNo', 'cpage', 'pg', 'pageNum', 'nowPage']

/**
 * 게시판 2쪽 ~ (1+extra)쪽 요청. 편제표 글이 첫 쪽에서 밀려난 학교가 많음.
 * - 경기형(ntt): 목록 아래 pagingForm을 currPage만 바꿔 POST
 * - 주소에 쪽 번호가 있는 게시판(대전·강원형 등): 같은 경로의 쪽 링크
 */
export function nextPages(page: Page, extra = 2): PageReq[] {
  const out: PageReq[] = []
  if (/selectNttList\.do/.test(page.url)) {
    const fields = formFields(page.html, 'pagingForm')
    const action = formAction(page.html, 'pagingForm')
    const url = action ? abs(action, page.url) : null
    if (!fields || !url) return out
    for (let n = 2; n <= 1 + extra; n++)
      if (new RegExp(`goPaging\\(\\s*${n}\\s*\\)`).test(page.html)) out.push({ url, form: { ...fields, currPage: String(n) }, title: '', human: page.url })
    return out
  }
  const here = new URL(page.url)
  // 쪽 번호로 중복 제거. 같은 쪽 링크가 다른 파라미터로 여럿 걸려 있어도 한 번만
  const seenNo = new Set<number>()
  for (const a of anchors(page.html, page.url)) {
    if (!a.href) continue
    const u = new URL(a.href)
    if (u.origin !== here.origin || u.pathname !== here.pathname) continue
    for (const key of PAGE_KEYS) {
      const n = Number(u.searchParams.get(key))
      if (n >= 2 && n <= 1 + extra && !seenNo.has(n)) {
        seenNo.add(n)
        out.push({ url: u.toString(), title: '', human: u.toString() })
        if (out.length >= extra) return out
      }
    }
  }
  return out
}

/** 서울 dggb형 목록 2쪽부터, pageIndex만 바꿈 */
function dggbNext(list: PageReq, listPage: Page, extra = 2): PageReq[] {
  const out: PageReq[] = []
  if (!list.form) return out
  for (let n = 2; n <= 1 + extra; n++)
    if (new RegExp(`\\(\\s*['"]?${n}['"]?\\s*\\)`).test(listPage.html)) out.push({ ...list, form: { ...list.form, pageIndex: String(n) } })
  return out
}

/** 학교 사이트에 요청이 몰리지 않게 size개씩 */
async function inBatches<T, R>(items: T[], size: number, run: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(run))))
  return out
}

/** boardCnts형(대전·강원 등): goView('게시판', '글번호', '단계', '비밀', '상태', '쪽', ...) → /boardCnts/view.do */
export function boardCntsPosts(page: Page): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = []
  const list = new URL(page.url)
  if (!/\/boardCnts\//.test(list.pathname)) return out
  for (const a of anchors(page.html, page.url)) {
    const m = a.onclick.match(/goView\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'[^']*'\s*,\s*'(\w*)'\s*,\s*'(\d*)'/)
    if (!m || !a.text) continue
    const url = new URL('/boardCnts/view.do', page.url)
    url.search = new URLSearchParams({
      boardID: m[1],
      boardSeq: m[2],
      lev: m[3],
      searchType: 'null',
      statusYN: m[4] || 'W',
      page: m[5] || '1',
      s: list.searchParams.get('s') ?? '',
      m: list.searchParams.get('m') ?? '',
      opType: 'N',
    }).toString()
    if (!out.some((x) => x.href === url.toString())) out.push({ href: url.toString(), text: a.text })
  }
  return out
}

// ---- 첨부 파일·그림 ----

export interface FileRef {
  url: string
  name: string
}

const kindOf = (name: string, url: string): DocKind | null => {
  const s = `${name} ${url}`
  if (/\.pdf\b/i.test(s)) return 'pdf'
  if (/\.xlsx\b/i.test(s)) return 'xlsx'
  if (/\.hwpx?\b/i.test(s)) return 'hwp'
  return null
}

// 글자를 그대로 옮기는 본문 표가 가장 정확하고, 그림만 있는 것은 가장 낮게
const KIND_BONUS: Record<DocKind, number> = { pdf: 2, xlsx: 2, table: 3, images: 1, hwp: 2 }

/** 글 본문의 첨부 파일 주소 */
export function attachments(html: string, base: string): FileRef[] {
  const out: FileRef[] = []
  const push = (url: string | null, name: string) => {
    if (url && !out.some((x) => x.url === url)) out.push({ url, name: strip(name) })
  }
  // ntt형: DEXT5UPLOAD.AddUploadedFile('키', '파일명.pdf', '/upload/...pdf', ...) (학교에 따라 큰따옴표)
  // 길이 상한: 닫는 따옴표가 없을 때 역추적이 길어지지 않게
  for (const m of html.matchAll(/AddUploadedFile\(\s*(["'])[^"']{0,300}\1\s*,\s*(["'])(.{1,300}?)\2\s*,\s*(["'])(.{1,2048}?)\4/g)) push(abs(m[5], base), m[3])
  // 미리보기 함수에 들어 있는 절대 주소
  for (const m of html.matchAll(/preview\w{0,40}\(\s*'(https?:\/\/[^']{0,2048})'\s*,\s*'([^']{0,300})'/g)) push(abs(m[1], base), m[2])
  // dggb형: serverFileObj["name"] = "..."; serverFileObj["atchFileId"] = "FILE_..."; serverFileObj["fileSn"] = "4";
  for (const block of html.split(/var\s+serverFileObj\s*=\s*new\s+Object\(\)\s*;/).slice(1)) {
    const name = block.match(/serverFileObj\["name"\]\s*=\s*"([^"]+)"/)?.[1]
    const id = block.match(/serverFileObj\["atchFileId"\]\s*=\s*"([^"]+)"/)?.[1]
    const sn = block.match(/serverFileObj\["fileSn"\]\s*=\s*"([^"]+)"/)?.[1]
    if (name && id && sn) push(abs(`/dggb/board/boardFile/downFile.do?atchFileId=${encodeURIComponent(id)}&fileSn=${encodeURIComponent(sn)}`, base), name)
  }
  // 전자정부 표준 프레임워크: fn_egov_downFile('FILE_...', '0')
  for (const m of html.matchAll(/fn_egov_downFile\(\s*'([^']{0,300})'\s*,\s*'([^']{0,300})'\s*\)[^>]{0,1000}>([\s\S]{0,300}?)<\/a>/g))
    push(abs(`/cmm/fms/FileDown.do?atchFileId=${encodeURIComponent(m[1])}&fileSn=${encodeURIComponent(m[2])}`, base), m[3])
  // 일반 링크: 파일 확장자가 보이거나 다운로드 주소
  for (const a of anchors(html, base)) {
    if (!a.href) continue
    if (/\.(pdf|hwpx?|xlsx)(\?|$)/i.test(a.href) || /\.(pdf|hwpx?|xlsx)\b/i.test(a.text)) push(a.href, a.text)
    else if (/download|filedown|atchfile|file_down|getfile|fileDownload/i.test(a.href) && /\.(pdf|hwpx?|xlsx)/i.test(a.text)) push(a.href, a.text)
  }
  return out
}

const DECOR =
  /icon|ico_|logo|btn|banner|bg[_/]|visual|common|blank|loading|panorama|(sub|main|top)_?img|\/images\/(co|web|kor|main|sub)\/|\/img\/(co|common|main)/i
/** alt로 거르는 꾸밈 그림 (학교 전경 사진 등) */
const DECOR_ALT = /파노라마|전경|로고|배너|비주얼|메인\s*이미지|서브\s*이미지/
/** 글쓰기 편집기로 본문에 넣은 그림의 주소 */
const EDITOR = /editor|dext5|namo|ckeditor/i
/** 한 글에서 읽을 그림 수. 학과마다 표를 따로 붙인 특성화고가 있어 넉넉히 */
export const MAX_IMAGES = 6

export interface ContentImage {
  url: string
  /** 파일 이름·alt에 그 입학년도가 있음 (예: 0203_2026.png) */
  dated: boolean
}

/**
 * 본문에 붙인 큰 그림 (편제표를 그림으로 올린 학교가 있음).
 * cohort를 주면 이름에 연도가 적힌 그림은 그 해 것만
 */
export function contentImages(html: string, base: string, allow: (u: URL) => boolean, cohort?: number): ContentImage[] {
  const out: ContentImage[] = []
  for (const tag of openTags(html, 'img')) {
    const src = tag.match(/src\s*=\s*["']([^"']+)["']/i)?.[1]
    const url = src && !src.startsWith('data:') ? abs(src, base) : null
    if (!url || DECOR.test(url) || !/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) continue
    if (!allow(new URL(url))) continue
    let file = new URL(url).pathname.split('/').pop() ?? ''
    try {
      file = decodeURIComponent(file)
    } catch {
      // 깨진 % 표기면 그대로
    }
    const years = [...`${file} ${tag.match(/alt\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''}`.matchAll(/(?<!\d)(20\d\d)(?!\d)/g)].map((y) => Number(y[1]))
    if (cohort && years.length && !years.includes(cohort)) continue
    const dated = !!cohort && years.includes(cohort)
    const w = Number(tag.match(/width\s*[:=]\s*["']?(\d+)/i)?.[1] ?? 0)
    const h = Number(tag.match(/height\s*[:=]\s*["']?(\d+)/i)?.[1] ?? 0)
    const uploaded = /upload|editor|board|atch|file|bbs/i.test(url)
    if ((w && w < 400) || (h && h < 300) || (!uploaded && !(w >= 600) && !dated)) continue
    // 가로가 세로의 2.4배를 넘으면 표가 아니라 전경 사진
    if (w && h && w / h > 2.4) continue
    if (DECOR_ALT.test(tag.match(/alt\s*=\s*["']([^"']*)["']/i)?.[1] ?? '')) continue
    if (!out.some((x) => x.url === url)) out.push({ url, dated })
    if (out.length === 12) break
  }
  // 편집기 그림이 있으면 그것만 본문 그림 (나머지는 머리·옆 화면 그림)
  const body = out.filter((x) => EDITOR.test(x.url))
  return (body.length ? body : out).slice(0, MAX_IMAGES)
}

// ---- 주소 범위 ----

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, '')

/** 게시판·글 페이지는 홈페이지와 같은 호스트만, www. 차이는 무시 (같은 교육청 시스템의 다른 학교로 넘어가지 않게) */
export function sameHost(homepage: string): (url: URL) => boolean {
  let host = ''
  try {
    host = bareHost(new URL(homepage).hostname)
  } catch {
    return () => false
  }
  return (url: URL) => bareHost(url.hostname) === host
}

/** HTML 주석을 공백 한 칸으로. /<!--[\s\S]*?-->/g와 같은 결과, 닫는 -->가 없으면 나머지를 그대로 */
function dropComments(s: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const open = s.indexOf('<!--', i)
    if (open < 0) return out + s.slice(i)
    const close = s.indexOf('-->', open + 4)
    if (close < 0) return out + s.slice(i)
    out += `${s.slice(i, open)} `
    i = close + 3
  }
}

/** 넘김 주소를 찾을 때 훑는 앞부분 길이. 넘김은 <head>에 있고, 닫히지 않은 태그투성이 페이지도 빨리 끝내려고 */
const REDIRECT_HEAD = 64_000

/** 내용 없이 넘기기만 하는 첫 화면(JS location, meta refresh)이면 넘어갈 주소, 아니면 null */
export function softRedirect(raw: string, base: string): string | null {
  // 주석 속 옛 코드는 무시
  const html = dropComments(raw)
  const visible = strip(dropScripts(html))
  if (visible.length > 300) return null
  const head = html.slice(0, REDIRECT_HEAD)
  const target =
    head.match(/<meta[^>]{1,1000}http-equiv\s*=\s*["']?refresh["']?[^>]{0,1000}content\s*=\s*["']?\s*\d+\s*;\s*url\s*=\s*([^"'>\s]{1,2048})/i)?.[1] ??
    head.match(/location(?:\.href)?\s*=\s*["']([^"']{1,2048})["']/)?.[1] ??
    head.match(/location\.(?:replace|assign)\(\s*["']([^"']{1,2048})["']\s*\)/)?.[1]
  if (!target || /^javascript:/i.test(target)) return null
  return abs(target, base)
}

export interface Discovery {
  /** 리다이렉트를 따라간 뒤의 실제 첫 화면 주소 */
  entry: string
  candidates: DocCandidate[]
  /** 둘러볼 때 받은 쿠키. 파일 받을 때 같은 세션이 필요한 사이트가 있음 */
  jar?: CookieJar
}

/** 첨부를 받아도 되는 곳: 나이스 홈페이지 주소나 실제 첫 화면 주소와 같은 학교 사이트 */
export function fileSite(homepage: string, entry: string): (url: URL) => boolean {
  const checks = [sameSchoolSite(homepage), sameSchoolSite(entry)]
  return (url: URL) => checks.some((ok) => ok(url))
}

// 교육계획: '교육계획(서)' 게시판에 편제표를 올리는 학교가 많음 (서울·강원·경기 등)
const MENU_WORDS = /교육\s*과정|편제|편성표|배당표|입학생|선택\s*과목|과목\s*선택|학점제|교육\s*계획/
const MENU_SKIP =
  /방과\s*후|늘봄|돌봄|공동\s*교육과정|클러스터|주문형|연구\s*학교|선도\s*학교|자유\s*학기|진로\s*체험|급식|행사|학부모|특수\s*교육|유치원|교육청|교육지원청|사이버|원격|설명회|연수|동아리/

const menuScore = (text: string, cohort: number, track: string) => {
  let s = scoreTitle(text, cohort, track)
  if (/게시판|자료실|공지/.test(text)) s += 1
  if (/학년별|입학생|편제|편성|배당/.test(text)) s += 2
  if (/교육\s*계획/.test(text)) s += 1
  return s
}

const fileKey = (u: string) => {
  const x = new URL(u)
  return x.pathname + x.search
}

/** 첨부 주소에 든 올린 연·월(예: /upload/학교/bbs_1/2026/08/파일)을 비교용 숫자로. 없으면 0 */
export function uploadedAt(url: string): number {
  const m = url.match(/\/(20\d\d)\/(0?[1-9]|1[0-2])\//)
  return m ? Number(m[1]) * 12 + Number(m[2]) : 0
}

/** 파일 이름의 판 점수: V2·개정판 +1, 구버전·이전 판 -2 */
export function revisionBonus(name: string): number {
  // 변경후·수정·최종·(안)·변경 전은 scoreTitle이 이미 반영
  if (/구\s*버전|이전\s*판/.test(name)) return -2
  if (/[Vv]\s*\d|개정판/.test(name)) return 1
  return 0
}

/** 한 학교 홈페이지를 둘러보는 시간 상한 */
const SITE_DEADLINE = 75_000

export async function discover(
  homepage: string,
  cohort: number,
  given?: Fetcher,
  track = '',
  robots: (url: string) => Promise<void> = checkRobots,
): Promise<Discovery> {
  const jar = given ? undefined : new CookieJar()
  const fetcher = given ?? siteFetcher(Date.now() + SITE_DEADLINE, jar, robots)
  // 나이스 주소가 다른 도메인으로 넘기는 학교가 있다 (예: gen.hs.kr → jge.hs.kr).
  // 학교가 정한 이동이라 첫 화면을 찾을 때까지만 아무 공개 주소로 따라간다. 내부 IP·포트는 safeFetch가 막음
  const anyPublic = () => true
  let home = await fetcher(homepage, anyPublic)
  for (let hop = 0; hop < 3; hop++) {
    const next = softRedirect(home.html, home.url)
    if (!next || next === home.url) break
    home = await fetcher(next, anyPublic)
  }

  const pageChecks = [sameHost(homepage), sameHost(home.url)]
  const allowPage = (u: URL) => pageChecks.some((ok) => ok(u))
  // 첨부는 교육청 공용 서버(예: www.goehs.kr/upload/학교/...)에 올라가기도 해서 파일만 범위를 넓힘
  const allowFile = fileSite(homepage, home.url)
  const allow = (u: URL) => allowPage(u) || allowFile(u)
  const okPage = (href: string | null) => {
    try {
      return !!href && allowPage(new URL(href))
    } catch {
      return false
    }
  }

  const found: DocCandidate[] = []
  /** refetch: 주소만으로 다시 열 수 있는지. POST로 받은 글은 본문 표를 다시 못 열어 후보에서 뺌 */
  const collect = (page: Page, title: string, human: string, base: number, refetch: boolean) => {
    for (const f of attachments(page.html, page.url)) {
      const kind = kindOf(f.name, f.url)
      if (!kind || !allowFile(new URL(f.url))) continue
      // 글 제목이 여러 해를 묶었어도 파일 이름이 더 구체적이면 그쪽 점수
      const own = scoreTitle(f.name, cohort, track)
      const score = Math.max(base, own) + Math.min(3, own) + KIND_BONUS[kind]
      found.push({ url: f.url, kind, fileName: f.name || f.url.split('/').pop() || '', postTitle: title, postUrl: human, score, source: 'homepage' })
    }
    // 본문에 HTML 표로 넣은 편제표
    if (refetch) {
      const tables = curriculumTables(htmlTables(page.html))
      if (tables.length)
        found.push({
          url: page.url,
          kind: 'table',
          fileName: `${title || '교육과정'} (본문 표)`,
          postTitle: title,
          postUrl: human,
          score: base + KIND_BONUS.table,
          source: 'homepage',
        })
    }
    // 그림은 이름에 입학년도가 있거나 제목이 편제표를 가리킬 때만 (교육과정 소개 그림 등을 빼려고)
    const all = contentImages(page.html, page.url, allowFile, cohort)
    const dated = all.filter((i) => i.dated)
    const images = dated.length ? dated : scoreTitle(title, cohort, track) >= 3 ? all : []
    if (images.length)
      found.push({
        url: page.url,
        kind: 'images',
        images: images.map((i) => i.url),
        fileName: `${title} (그림 ${images.length}장)`,
        postTitle: title,
        postUrl: human,
        score: base + KIND_BONUS.images + (dated.length ? 3 : 0),
        source: 'homepage',
      })
  }

  // 1) 교육과정 메뉴 페이지
  const menu = new Map<string, { href: string; text: string; score: number }>()
  for (const a of anchors(home.html, home.url)) {
    if (!a.href || !okPage(a.href) || !MENU_WORDS.test(a.text) || MENU_SKIP.test(a.text) || a.text.length > 60) continue
    const score = menuScore(a.text, cohort, track)
    const prev = menu.get(a.href)
    if (score >= 1 && (!prev || prev.score < score)) menu.set(a.href, { href: a.href, text: a.text, score })
  }
  const menuPages = [...menu.values()].sort((a, b) => b.score - a.score).slice(0, 10)

  const openMenu = async (m: { href: string; text: string; score: number }) => {
    const page = await fetcher(m.href, allow).catch(() => null)
    if (!page) return null
    // 서울 dggb형: 목록은 따로 POST로
    const list = dggbList(page)
    const listPage = list ? await fetcher(list.url, allow, list.form).catch(() => null) : null
    return { menu: m, page, list, listPage }
  }
  const level1 = await inBatches(menuPages, 3, openMenu)

  // 1-2) 한 단계 더: '교육활동 > 교육과정 > 편제표'처럼 메뉴가 깊은 학교
  const seen = new Set([home.url, ...menuPages.map((m) => m.href)])
  const deeper = new Map<string, { href: string; text: string; score: number }>()
  for (const x of level1) {
    if (!x) continue
    for (const a of anchors(x.page.html, x.page.url)) {
      if (!a.href || seen.has(a.href) || !okPage(a.href) || !MENU_WORDS.test(a.text) || MENU_SKIP.test(a.text) || a.text.length > 60) continue
      const score = menuScore(a.text, cohort, track)
      const prev = deeper.get(a.href)
      if (score >= 1 && (!prev || prev.score < score)) deeper.set(a.href, { href: a.href, text: a.text, score })
    }
  }
  const level2 = await inBatches([...deeper.values()].sort((a, b) => b.score - a.score).slice(0, 6), 3, openMenu)

  // 2) 메뉴 페이지에 바로 붙은 파일·그림과 편제표 글 목록
  const posts = new Map<string, PageReq & { score: number }>()
  const addPost = (req: PageReq, score: number) => {
    const key = req.form ? `${req.url}#${req.form.nttId ?? ''}` : req.url
    if (score > 0 && !posts.has(key)) posts.set(key, { ...req, score })
  }
  // 게시판 글은 제목에 교육과정·편제표·교육계획이 들어간 것만
  const boardPost = (t: string) => STRONG.test(t) || /교육\s*과정|교육\s*계획/.test(t)
  /** 게시판 다음 쪽. listUrl은 글 주소를 만들 때 씀 */
  const more: { req: PageReq; listUrl: string; dggb?: Record<string, string> }[] = []
  for (const x of [{ page: home, menu: { text: '', score: 0, href: home.url }, list: null, listPage: null }, ...level1, ...level2]) {
    if (!x) continue
    const { page, menu: m } = x
    if (page !== home) collect(page, m.text, page.url, m.score, true)
    const boardPosts = [...nttPosts(page.html, page.url), ...boardCntsPosts(page)]
    for (const p of boardPosts) if (boardPost(p.text)) addPost({ url: p.href, title: p.text, human: p.href }, scoreTitle(p.text, cohort, track))
    for (const a of anchors(page.html, page.url))
      if (a.href && okPage(a.href) && (STRONG.test(a.text) || /입학생.*교육\s*과정|교육\s*과정.*(편성|편제|안내|공지)/.test(a.text)))
        addPost({ url: a.href, title: a.text, human: a.href }, scoreTitle(a.text, cohort, track))
    if (x.list && x.listPage) {
      for (const p of dggbPosts(x.listPage, x.list.form, page.url)) if (boardPost(p.title)) addPost(p, scoreTitle(p.title, cohort, track))
      for (const req of dggbNext(x.list, x.listPage)) more.push({ req, listUrl: page.url, dggb: x.list.form })
    }
    // 교육과정 메뉴의 게시판이면 2·3쪽도 (올해 편제표가 공지에 밀려 있는 학교가 많음)
    if (page !== home && boardPosts.length) for (const req of nextPages(page)) more.push({ req, listUrl: page.url })
  }
  const morePages = await inBatches(more, 3, async (b) => ({ b, page: await fetcher(b.req.url, allow, b.req.form).catch(() => null) }))
  for (const { b, page } of morePages) {
    if (!page) continue
    if (b.dggb) {
      for (const p of dggbPosts(page, b.dggb, b.listUrl)) if (boardPost(p.title)) addPost(p, scoreTitle(p.title, cohort, track))
      continue
    }
    for (const p of [...nttPosts(page.html, b.listUrl), ...boardCntsPosts(page)])
      if (boardPost(p.text)) addPost({ url: p.href, title: p.text, human: p.href }, scoreTitle(p.text, cohort, track))
  }

  // 3) 점수 높은 글을 열어 첨부 파일·그림 모으기
  const top = [...posts.values()].sort((a, b) => b.score - a.score).slice(0, 10)
  await inBatches(top, 3, async (p) => {
    if (/\.(pdf|hwpx?|xlsx)(\?|$)/i.test(p.url)) {
      const kind = kindOf(p.title, p.url) ?? 'pdf'
      found.push({ url: p.url, kind, fileName: p.title, postTitle: p.title, postUrl: p.human, score: p.score + KIND_BONUS[kind], source: 'homepage' })
      return
    }
    const page = await fetcher(p.url, allow, p.form).catch(() => null)
    if (page) collect(page, p.title, p.human, p.score, !p.form)
  })

  // 같은 해 편제표가 여럿이면 고친 판(파일 이름의 판 표시)과 가장 늦게 올린 것을 앞으로
  // fits: 이 입학년도 편제표로 보이는 파일 (파일 이름 점수 8 이상)
  const fits = (c: DocCandidate) => scoreTitle(c.fileName, cohort, track) >= 8
  const newest = Math.max(0, ...found.filter(fits).map((c) => uploadedAt(c.url)))
  for (const c of found) c.score += revisionBonus(c.fileName) + (newest && fits(c) && uploadedAt(c.url) === newest ? 1.5 : 0)

  const out: DocCandidate[] = []
  for (const c of found.sort((a, b) => b.score - a.score)) {
    if (c.score <= 0 || out.some((x) => fileKey(x.url) === fileKey(c.url))) continue
    // 같은 글이 메뉴 두 곳에 걸려 주소만 다른 경우: 파일 이름(6자 이상)·종류가 같으면 같은 파일
    if (c.fileName.length >= 6 && out.some((x) => x.kind === c.kind && x.fileName === c.fileName)) continue
    out.push(c)
  }
  return { entry: home.url, candidates: out.slice(0, 12), jar }
}
