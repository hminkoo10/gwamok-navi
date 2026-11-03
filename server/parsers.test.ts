import { describe, expect, it } from 'vitest'
import { attachments, contentImages, nttPosts, softRedirect } from './discover'
import { verdict } from './robots'
import { imageSize } from './pdf-render'
import { CookieJar, parseRawResponse } from './safe-fetch'
import { codePoint, htmlTables, xlsxGrids } from './tables'
import { makeZip } from './testing'

// 공격자가 올린 거대한(1~3MB) HTML·파일이 이벤트 루프를 오래 붙잡지 못하는지 확인한다 (ReDoS).
// 초선형 정규식을 쓰던 때는 아래 입력들이 수 초~수 분 걸렸다. 지금은 모두 선형이라 1초 안에 끝난다.

const timed = (fn: () => void): number => {
  const s = performance.now()
  fn()
  return performance.now() - s
}
const BUDGET = 1500 // ms. 로컬 실측 최악 약 0.3초, 나머지는 CI 여유

describe('초선형 입력 방어 (ReDoS)', () => {
  const base = 'https://school.hs.kr/main.do'
  const big = (unit: string, mb = 2) => unit.repeat(Math.floor((mb * 1024 * 1024) / unit.length))

  it('attachments: 닫히지 않은 <a>·preview·AddUploadedFile가 가득해도 빠르다', () => {
    expect(timed(() => attachments(big('<a>'), base))).toBeLessThan(BUDGET)
    expect(timed(() => attachments(big('<a '), base))).toBeLessThan(BUDGET)
    expect(timed(() => attachments(big('preview'), base))).toBeLessThan(BUDGET)
    expect(timed(() => attachments(big("AddUploadedFile('a','b','c'"), base))).toBeLessThan(BUDGET)
  })

  it('contentImages: 닫히지 않은 <img가 가득해도 빠르다', () => {
    expect(timed(() => contentImages(big('<img '), base, () => true, 2026))).toBeLessThan(BUDGET)
  })

  it('softRedirect: <, <!--, <script><meta 가 가득해도 빠르다', () => {
    expect(timed(() => softRedirect(big('<'), base))).toBeLessThan(BUDGET)
    expect(timed(() => softRedirect(big('<!--'), base))).toBeLessThan(BUDGET)
    expect(timed(() => softRedirect(`<script>${big('<meta')}</script>`, base))).toBeLessThan(BUDGET)
  })

  it('htmlTables: 닫히지 않은 <table>/<tr>/<td>·거대한 칸이 있어도 빠르다', () => {
    expect(timed(() => htmlTables(big('<table>')))).toBeLessThan(BUDGET)
    expect(timed(() => htmlTables(`<table><tr><td>${big('<')}</td></tr></table>`))).toBeLessThan(BUDGET)
  })

  it('nttPosts: 닫히지 않은 <a가 가득해도 빠르다', () => {
    expect(timed(() => nttPosts(big('<a '), 'https://s.hs.kr/selectNttList.do'))).toBeLessThan(BUDGET)
  })

  it('robots: * 가 많은 규칙도 되짚지 않는다 (예전 12개에 4초)', () => {
    const rule = `/${'*a'.repeat(30)}b`
    const path = `/${'a'.repeat(5000)}`
    expect(timed(() => verdict([{ agents: ['*'], allow: [], disallow: [rule] }], path))).toBeLessThan(BUDGET)
  })
})

describe('robots glob 맞추기 (동작 유지)', () => {
  const one = (rule: string, path: string) => verdict([{ agents: ['*'], allow: [], disallow: [rule] }], path)
  it('* 와 끝의 $ 를 전과 같이 다룬다', () => {
    expect(one('/boardCnts/', '/boardCnts/list.do?x=1')).toBe('disallow')
    expect(one('/*.hwp$', '/upload/a.hwp')).toBe('disallow')
    expect(one('/*.hwp$', '/upload/a.hwpx')).toBe('allow')
    expect(one('/a/*/c', '/a/bbb/c/d')).toBe('disallow')
    expect(one('/a/*/c$', '/a/b/c/d')).toBe('allow')
    expect(one('/only', '/other')).toBe('allow')
  })
})

describe('숫자 문자 참조 범위 넘침', () => {
  it('없는 코드(U+10FFFF 넘음·서로게이트·0)는 U+FFFD, 정상값은 그대로', () => {
    expect(codePoint(0x41)).toBe('A')
    expect(codePoint(0)).toBe('�')
    expect(codePoint(0xd800)).toBe('�')
    expect(codePoint(0x110000)).toBe('�')
    expect(codePoint(999999999999)).toBe('�')
  })
  it('표 칸의 &#x110000; 같은 값이 와도 던지지 않는다', () => {
    expect(() => htmlTables('<table><tr><td>&#x110000; &#999999999999; &#55296;</td></tr></table>')).not.toThrow()
    const [grid] = htmlTables('<table><tr><td>&#65;&#x42;</td></tr></table>')
    expect(grid[0][0]).toBe('AB')
  })
})

describe('쿠키 범위', () => {
  it('공용 끝 주소(hs.kr·.kr·seoul.kr) Domain 쿠키는 버린다', () => {
    const jar = new CookieJar()
    jar.store(new URL('https://evil.hs.kr/'), ['sid=leak; Domain=hs.kr', 'all=kr; Domain=.kr', 'r=1; Domain=seoul.kr', 'ok=1'])
    expect(jar.header(new URL('https://victim.hs.kr/'))).toBe('')
    expect(jar.header(new URL('https://evil.hs.kr/'))).toBe('ok=1')
  })
  it('정상 하위 도메인 Domain 쿠키는 그대로 둔다', () => {
    const jar = new CookieJar()
    jar.store(new URL('https://a.sujin.hs.kr/'), ['WMONID=w; Domain=sujin.hs.kr'])
    expect(jar.header(new URL('https://b.sujin.hs.kr/'))).toBe('WMONID=w')
  })
  it('쿠키 이름·값의 CR/LF/NUL은 떼어 낸다', () => {
    const jar = new CookieJar()
    jar.store(new URL('https://a.hs.kr/'), ['x=1\r\nSet-Cookie: y=2'])
    expect(jar.header(new URL('https://a.hs.kr/'))).toBe('x=1Set-Cookie: y=2')
  })
})

describe('raw 응답 헤더의 홑 CR', () => {
  it('헤더 값에 남은 CR/LF는 떼어 낸다 (헤더 쪼개기 방지)', () => {
    const raw = Buffer.from('HTTP/1.1 200 OK\r\nSet-Cookie: a=b\rx-injected: 1\r\nContent-Length: 0\r\n\r\n', 'latin1')
    const r = parseRawResponse(raw)
    expect(r?.headers['set-cookie']).toEqual(['a=bx-injected: 1'])
    expect(JSON.stringify(r?.headers)).not.toContain('\r')
  })
})

describe('이미지 머리글 크기', () => {
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(24)
    b.writeUInt32BE(0x89504e47, 0)
    b.writeUInt32BE(8, 8)
    b.write('IHDR', 12, 'latin1')
    b.writeUInt32BE(w, 16)
    b.writeUInt32BE(h, 20)
    return b
  }
  it('PNG 가로·세로를 디코딩 없이 읽는다', () => {
    expect(imageSize(png(1000, 1400))).toEqual({ w: 1000, h: 1400 })
    expect(imageSize(Buffer.from('not an image'))).toBeNull()
  })
})

describe('xlsx 합친 칸 상한', () => {
  it('mergeCell 2만 개가 있어도 빠르게 끝난다', () => {
    const merges = Array.from({ length: 20_000 }, () => '<mergeCell ref="A1:BH400"/>').join('')
    const buf = makeZip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="s" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData><mergeCells>${merges}</mergeCells></worksheet>`,
    })
    expect(timed(() => xlsxGrids(buf))).toBeLessThan(BUDGET)
  })
})
