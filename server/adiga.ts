import { safeFetch } from './safe-fetch'

// 대입정보포털 어디가(adiga.kr) 대학 상세에 있는 「대학입학전형 시행계획」 파일(대학이 대교협에 올린 것)의 받는 주소.
// 대학 코드(unvCd)로 2028학년도 상세 화면을 열어 파일 번호를 읽는다.

const HOST = 'www.adiga.kr'
const YEAR = '2028'

/** 상세 화면 파일 목록(#fileResult)에서 이름에 '시행계획'이 든 파일의 받는 주소. 없으면 null */
export function adigaFileUrl(html: string, code: string): string | null {
  const start = html.indexOf('id="fileResult"')
  if (start < 0) return null
  const end = html.indexOf('</ul>', start)
  // 따옴표가 &#39;로 적혀 있음
  const list = html.slice(start, end < 0 ? start + 20_000 : end).replace(/&#39;|&#x27;/g, "'")
  for (const m of list.matchAll(/onclick="fnUnvFileDownOne\(\s*'(\d{1,30})'\s*,\s*'(\d{1,5})'[^"]{0,200}"[^>]{0,200}>\s*<span>([\s\S]{0,200}?)<\/span>/g)) {
    const label = m[3].replace(/<[^>]*>|\s+/g, '')
    if (!label.includes('시행계획')) continue
    return `https://${HOST}/cmm/com/file/fileDown.do?fileId=${m[1]}&fileSn=${m[2]}&menuId=PCUVTINF2000&downLogYn=Y&unvCd=${code}&searchSyr=${YEAR}`
  }
  return null
}

/** 2028학년도 시행계획 파일 주소. 없거나 못 열면 null */
export async function adigaPlanUrl(code: string): Promise<string | null> {
  if (!/^\d{7}$/.test(code)) return null
  const page = `https://${HOST}/ucp/uvt/uni/univDetail.do?menuId=PCUVTINF2000&searchSyr=${YEAR}&unvCd=${code}`
  const r = await safeFetch(page, {
    allow: (u) => u.protocol === 'https:' && u.hostname === HOST,
    maxBytes: 3_000_000,
    timeoutMs: 30_000,
    accept: 'text/html',
  }).catch(() => null)
  return r?.status === 200 ? adigaFileUrl(r.body.toString('utf8'), code) : null
}
