import { describe, expect, it } from 'vitest'
import { BANSONG_2026 } from '../src/data/schools/bansong2026'
import { type School, TERMS } from '../src/data/schema'
import { termCredits } from '../src/engine/school'
import type { AiConfig } from './ai'
import { looksComplete, readFromUrl, type ReadResult, type ReadTarget, type SchoolRef, type Site, totalMismatch } from './curriculum'
import { attachments, contentImages, type Discovery, discover, nttPosts, scoreTitle, softRedirect, yearsIn } from './discover'
import { schoolTracks, schoolYear } from './neis'
import { importSystem } from './prompts'
import { pickPages } from './pdf-render'
import { CookieJar, dechunk, FetchBlocked, isPublicIp, parseRawResponse, type SafeResponse, sameSchoolSite } from './safe-fetch'
import { Accounts } from './accounts'
import { Store } from './store'
import { hwpxSection, makeZip, sessionFor, testApi } from './testing'

// 실제 경기 학교 홈페이지(goehs.kr) 구조를 줄여 옮긴 것
const MAIN = `
<ul>
  <li><a href="/bansong-h/na/ntt/selectNttList.do?mi=16618&amp;bbsId=9116" title='교육과정'><span>교육과정</span></a></li>
  <li><a id="16622" href="#?mi=16622" title='교육과정 클러스터'><span>교육과정 클러스터/주문형 강좌</span></a></li>
  <li><a href="/bansong-h/na/ntt/selectNttList.do?mi=1&amp;bbsId=1">방과후 교육과정</a></li>
  <li><a href="https://other-h.goehs.kr/other-h/na/ntt/selectNttList.do?mi=1&amp;bbsId=2">교육과정</a></li>
</ul>`
const LIST = `
<tr><td class="ta_l"><a href="javascript:" data-id="1296947" class="nttInfoBtn">
  2026학년도 2학년 2학기 진로탐구 프로젝트 학습 계획서 양식
</a></td><td><em class="mTit">작성자</em> 한**</td></tr>
<tr><td class="ta_l"><a href="javascript:" data-id="1250052" class="nttInfoBtn">
  2026학년도 교육과정 편제표
</a></td></tr>
<tr><td class="ta_l"><a href="javascript:" data-id="1164564" class="nttInfoBtn">2025학년도 1, 2, 3학년 최종 교육과정 편제표</a></td></tr>`
const POST_2026 = `
<script>
DEXT5UPLOAD.AddUploadedFile('5185', '2026 교육과정편제표(홈페이지 게시용).pdf', '/upload/bansong-h/ba/2026/03/FA7B.pdf', '217634', '5185', G_UploadID);
previewAjax('https://www.goehs.kr/upload/bansong-h/ba/2026/03/FA7B.pdf','2026 교육과정편제표(홈페이지 게시용).pdf');
</script>
<a href="https://evil.example/편제표.pdf">편제표.pdf</a>`
const POST_2025 = `<script>DEXT5UPLOAD.AddUploadedFile('1', '2025 편제표.hwp', '/upload/bansong-h/ba/2025/02/AAAA.hwp', '1', '1', G_UploadID);</script>`

/** 주소(POST면 주소+폼)에 들어 있는 글자로 페이지를 돌려주는 가짜 학교 사이트 */
function fakeSite(pages: Record<string, string>) {
  const seen: string[] = []
  const fetcher = async (url: string, allow: (u: URL) => boolean, form?: Record<string, string>) => {
    const key = form ? `${url} ${new URLSearchParams(form)}` : url
    seen.push(key)
    if (!allow(new URL(url))) throw new FetchBlocked('막힘')
    for (const [k, html] of Object.entries(pages)) if (key.includes(k)) return { url, html }
    throw new Error(`404 ${key}`)
  }
  return { fetcher, seen }
}

const BANSONG_PAGES = {
  'bansong-h.goehs.kr/bansong-h/main.do': MAIN,
  'bbsId=9116&nttSn=1250052': POST_2026,
  'bbsId=9116&nttSn=1164564': POST_2025,
  'selectNttList.do?mi=16618&bbsId=9116': LIST,
  'bansong-h.goehs.kr/': '<script>location.href="/bansong-h/main.do";</script>',
}

describe('내부 주소 막기', () => {
  it('사설·루프백·링크로컬·메타데이터 주소를 막는다', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1'])
      expect(isPublicIp(ip), ip).toBe(false)
    for (const ip of [
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      'fd00::1',
      'fe80::1%eth0',
      'ff02::1',
      '2002:7f00:1::',
      '64:ff9b::a00:1',
      'not-an-ip',
    ])
      expect(isPublicIp(ip), ip).toBe(false)
  })

  it('공인 주소는 통과', () => {
    for (const ip of ['8.8.8.8', '211.43.12.7', '2001:4860:4860::8888', '::ffff:8.8.8.8', '2002:808:808::']) expect(isPublicIp(ip), ip).toBe(true)
  })
})

describe('학교 사이트 범위', () => {
  it('경기: 학교 주소와 교육청 공용 파일 서버만', () => {
    const ok = sameSchoolSite('http://bansong-h.goehs.kr/')
    expect(ok(new URL('https://bansong-h.goehs.kr/upload/a.pdf'))).toBe(true)
    expect(ok(new URL('https://www.goehs.kr/upload/bansong-h/a.pdf'))).toBe(true)
    expect(ok(new URL('https://goehs.kr.evil.example/a.pdf'))).toBe(false)
    expect(ok(new URL('https://evilgoehs.kr/a.pdf'))).toBe(false)
  })

  it('hs.kr처럼 여러 학교가 같이 쓰는 끝 주소는 한 칸 더 본다', () => {
    const ok = sameSchoolSite('http://www.gaya.hs.kr')
    expect(ok(new URL('https://gaya.hs.kr/a.pdf'))).toBe(true)
    expect(ok(new URL('https://kaekeum.hs.kr/a.pdf'))).toBe(false)
    expect(ok(new URL('https://hs.kr/a.pdf'))).toBe(false)
    const seoul = sameSchoolSite('http://garak.sen.hs.kr')
    expect(seoul(new URL('https://garak.sen.hs.kr/a.pdf'))).toBe(true)
    expect(seoul(new URL('https://sen.hs.kr/a.pdf'))).toBe(true)
    expect(seoul(new URL('https://hs.kr/a.pdf'))).toBe(false)
  })
})

describe('쿠키', () => {
  it('받은 사이트와 그 하위 주소에만 돌려보낸다', () => {
    const jar = new CookieJar()
    jar.store(new URL('https://a.goehs.kr/x'), ['JSESSIONID=abc; Path=/; HttpOnly', 'evil=1; Domain=evil.example'])
    jar.store(new URL('https://www.goehs.kr/x'), ['WMONID=w; Domain=.goehs.kr'])
    expect(jar.header(new URL('https://a.goehs.kr/y'))).toBe('JSESSIONID=abc; WMONID=w')
    expect(jar.header(new URL('https://b.goehs.kr/y'))).toBe('WMONID=w')
    expect(jar.header(new URL('https://evil.example/'))).toBe('')
  })
})

describe('형식이 틀린 응답', () => {
  const CRLF = '\r\n'
  it('헤더 이름 뒤 공백, 청크 본문을 너그럽게 읽는다', () => {
    const head = [
      'HTTP/1.1 200 OK',
      'Server: Apache',
      'Set-Cookie: A=1; path=/',
      'Set-Cookie: B=2',
      'P3P : CP="ALL"',
      'Transfer-Encoding: chunked',
      'Content-Type: text/html',
    ]
    const raw = Buffer.from(`${head.join(CRLF)}${CRLF}${CRLF}5${CRLF}hello${CRLF}6${CRLF} world${CRLF}0${CRLF}${CRLF}`, 'latin1')
    const r = parseRawResponse(raw)
    expect(r?.status).toBe(200)
    expect(r?.headers.p3p).toBe('CP="ALL"')
    expect(r?.headers['set-cookie']).toEqual(['A=1; path=/', 'B=2'])
    expect(r?.body.toString()).toBe('hello world')
  })

  it('청크라고 해 놓고 그냥 보낸 본문은 그대로 둔다', () => {
    expect(dechunk(Buffer.from('<!DOCTYPE html>'))).toBeNull()
    const head = ['HTTP/1.1 302 Found', 'Location: https://a.kr/', 'Transfer-Encoding: chunked']
    const r = parseRawResponse(Buffer.from(`${head.join(CRLF)}${CRLF}${CRLF}<html>moved</html>`))
    expect(r?.headers.location).toBe('https://a.kr/')
    expect(r?.body.toString()).toBe('<html>moved</html>')
  })

  it('상태 줄이 없으면 null', () => {
    expect(parseRawResponse(Buffer.from(`garbage${CRLF}${CRLF}`))).toBeNull()
  })
})

describe('첫 화면 넘김', () => {
  it('자바스크립트·meta refresh 넘김을 따라간다', () => {
    expect(softRedirect('<script>document.location.href="/main.do";</script>', 'http://a.cnehs.kr/')).toBe('http://a.cnehs.kr/main.do')
    expect(softRedirect(`<script> location.href ='intro.do'; </script>`, 'http://www.gaya.hs.kr/')).toBe('http://www.gaya.hs.kr/intro.do')
    expect(softRedirect('<meta http-equiv="refresh" content="0;url=https://korea.jge.hs.kr/main/main.php" />', 'http://korea.gen.hs.kr/')).toBe(
      'https://korea.jge.hs.kr/main/main.php',
    )
  })

  it('내용이 있는 페이지의 onclick 이동은 넘김으로 보지 않는다', () => {
    const page = `<p>${'학교 소개 '.repeat(80)}</p><button onclick="location.href='/x.do'">이동</button>`
    expect(softRedirect(page, 'http://a.hs.kr/')).toBeNull()
  })
})

describe('편제표 글 찾기', () => {
  it('제목 점수: 해당 입학년도 편제표가 가장 높고 다른 해 입학생 자료는 낮다', () => {
    expect(scoreTitle('2026학년도 입학생 교육과정 편제표', 2026)).toBeGreaterThan(scoreTitle('2026학년도 교육과정 편제표', 2026))
    expect(scoreTitle('2025학년도 입학생 교육과정 편제표', 2026)).toBeLessThan(scoreTitle('2026학년도 교육과정 편제표', 2026))
    expect(scoreTitle('2026학년도 교육과정 설명회 안내', 2026)).toBeLessThan(scoreTitle('2026학년도 교육과정 편제표', 2026))
  })

  it('두 자리 연도와 연도 범위', () => {
    expect(yearsIn('2024~2026학년도 교육과정 단위 배당표')).toEqual(expect.arrayContaining([2024, 2025, 2026]))
    expect(yearsIn('26학년도 입학생 교육과정')).toContain(2026)
    expect(scoreTitle('26학년도 입학생 교육과정(일반학급)', 2026)).toBeGreaterThan(scoreTitle('25학년도 입학생 교육과정(일반학급)', 2026))
    expect(scoreTitle('25학년도 입학생 교육과정(일반학급)', 2026)).toBeLessThanOrEqual(0)
    expect(scoreTitle('2024~2026학년도 교육과정 단위 배당표', 2026)).toBeGreaterThan(0)
  })

  it('goehs 목록: data-id가 a 태그 안에 있다', () => {
    const posts = nttPosts(LIST, 'https://bansong-h.goehs.kr/bansong-h/na/ntt/selectNttList.do?mi=16618&bbsId=9116')
    expect(posts.map((p) => p.text)).toEqual([
      '2026학년도 2학년 2학기 진로탐구 프로젝트 학습 계획서 양식',
      '2026학년도 교육과정 편제표',
      '2025학년도 1, 2, 3학년 최종 교육과정 편제표',
    ])
    expect(posts[1].href).toBe('https://bansong-h.goehs.kr/bansong-h/na/ntt/selectNttInfo.do?mi=16618&bbsId=9116&nttSn=1250052')
  })

  it('첨부 파일: 업로드 함수·미리보기·일반 링크', () => {
    const files = attachments(POST_2026, 'https://bansong-h.goehs.kr/bansong-h/na/ntt/selectNttInfo.do?nttSn=1')
    expect(files.map((f) => f.url)).toEqual([
      'https://bansong-h.goehs.kr/upload/bansong-h/ba/2026/03/FA7B.pdf',
      'https://www.goehs.kr/upload/bansong-h/ba/2026/03/FA7B.pdf',
      'https://evil.example/%ED%8E%B8%EC%A0%9C%ED%91%9C.pdf',
    ])
  })

  it('첫 화면 → 교육과정 게시판 → 편제표 글 → PDF', async () => {
    const { fetcher, seen } = fakeSite(BANSONG_PAGES)
    const found = await discover('http://bansong-h.goehs.kr/', 2026, fetcher)
    expect(found.entry).toBe('http://bansong-h.goehs.kr/bansong-h/main.do')
    expect(found.candidates[0]).toMatchObject({
      url: 'http://bansong-h.goehs.kr/upload/bansong-h/ba/2026/03/FA7B.pdf',
      kind: 'pdf',
      fileName: '2026 교육과정편제표(홈페이지 게시용).pdf',
      postTitle: '2026학년도 교육과정 편제표',
    })
    const urls = found.candidates.map((c) => c.url)
    // 같은 파일의 공용 서버 주소는 합치고, 다른 사이트 파일은 빼고, HWP는 뒤로 간다
    expect(urls.filter((u) => u.includes('FA7B'))).toHaveLength(1)
    expect(urls.some((u) => u.includes('evil.example'))).toBe(false)
    expect(found.candidates.at(-1)?.kind).toBe('hwp')
    // 다른 학교 게시판, 방과후, 진로탐구 글은 열지 않는다
    expect(seen.some((u) => u.includes('other-h'))).toBe(false)
    expect(seen.some((u) => u.includes('bbsId=1&') || u.endsWith('bbsId=1'))).toBe(false)
    expect(seen.some((u) => u.includes('1296947'))).toBe(false)
  })
})

// 서울 dggb형 (가락고 구조를 줄여 옮김)
const SEOUL_MENU = `<a href="/92430/subMenu.do">교육과정</a><a href="/92431/subMenu.do">방과후학교 교육과정</a>`
const SEOUL_BOARD = `
<form id="boardFrm" name="boardFrm" action="/92430/subMenu.do" method="post">
  <input id="bbsId" name="bbsId" type="hidden" value="BBS_0000000000214115"/>
  <input name="bbsTyCode" type="hidden" value="base"/>
  <input name="pageIndex" type="hidden" value="1"/>
  <input id="nttId" name="nttId" />
</form>
<script>url = "/dggb/module/board/selectBoardListAjax.do";</script>`
const SEOUL_LIST = `
<a href="javascript:void(0);" onclick="fnView('BBS_0000000000214115', '27172256');">2026학년도 기준 교육과정 학점 배당표 공지</a>
<a href="javascript:void(0);" onclick="fnView('BBS_0000000000214115', '22535314');">2022학년도 교육과정 단위배당표</a>
<a href="javascript:void(0);" onclick="fnView('BBS_0000000000214115', '11111111');">급식 안내</a>`
const SEOUL_POST = `<script>
  var serverFileObj = new Object();
  serverFileObj["name"] = "2025학년도 입학생 교육과정 학점 배당표(2022 개정 교육과정)_가락고.pdf";
  serverFileObj["atchFileId"] = "FILE_000000012289106";
  serverFileObj["fileSn"] = "3";
  serverFileObjArray.push(serverFileObj);
  var serverFileObj = new Object();
  serverFileObj["name"] = "2026학년도 입학생 교육과정 학점 배당표(2022 개정 교육과정)_가락고.pdf";
  serverFileObj["atchFileId"] = "FILE_000000012289106";
  serverFileObj["fileSn"] = "4";
  serverFileObjArray.push(serverFileObj);
</script>`

describe('지역별 홈페이지 형식', () => {
  it('서울형: 목록과 글을 POST로 받아 첨부 파일을 찾는다', async () => {
    const { fetcher, seen } = fakeSite({
      'selectBoardDetailAjax.do bbsId=BBS_0000000000214115&bbsTyCode=base&pageIndex=1&nttId=27172256': SEOUL_POST,
      'selectBoardListAjax.do bbsId=BBS_0000000000214115': SEOUL_LIST,
      '/92430/subMenu.do': SEOUL_BOARD,
      'garak.sen.hs.kr': SEOUL_MENU,
    })
    const found = await discover('http://garak.sen.hs.kr', 2026, fetcher)
    expect(found.candidates[0]).toMatchObject({
      url: 'http://garak.sen.hs.kr/dggb/board/boardFile/downFile.do?atchFileId=FILE_000000012289106&fileSn=4',
      kind: 'pdf',
      postTitle: '2026학년도 기준 교육과정 학점 배당표 공지',
      postUrl: 'http://garak.sen.hs.kr/92430/subMenu.do',
    })
    // 2025 입학생 파일은 뒤로
    expect(found.candidates[1].fileName).toContain('2025학년도')
    expect(seen.some((u) => u.includes('92431') || u.includes('11111111'))).toBe(false)
  })

  it('제주형: 입학생 교육과정 페이지에 붙인 그림을 후보로 낸다', async () => {
    const menu = `<a href="javascript:;">교육과정</a>
      <a href="/namnyeong/cm/cntnts/cntntsView.do?mi=10205826&cntntsId=10220883">26학년도 입학생 교육과정(일반학급)</a>
      <a href="/namnyeong/cm/cntnts/cntntsView.do?mi=10206805&cntntsId=10221423">26학년도 입학생 교육과정(체육학급)</a>
      <a href="/namnyeong/cm/cntnts/cntntsView.do?mi=10205827&cntntsId=10220884">25학년도 입학생 교육과정(일반학급)</a>`
    const page = (n: string) => `<img src="/images/co/lg/ico_langKor.png" alt="한국어"><img src="/images/web/namnyeong/sub/s_visual.png">
      <img src="/upload/editor/x_free/20260519/IMG_${n}.png" style="width:1000px; height:1415px;" width="1000" height="1415">`
    const { fetcher } = fakeSite({
      'cntntsId=10220883': page('A'),
      'cntntsId=10221423': page('B'),
      'cntntsId=10220884': page('C'),
      'school.jje.go.kr/namnyeong/main.do': menu,
    })
    const found = await discover('https://school.jje.go.kr/namnyeong/main.do', 2026, fetcher)
    expect(found.candidates[0]).toMatchObject({
      kind: 'images',
      images: ['https://school.jje.go.kr/upload/editor/x_free/20260519/IMG_A.png'],
      postTitle: '26학년도 입학생 교육과정(일반학급)',
    })
    expect(found.candidates[1].postTitle).toContain('체육학급')
    // 다른 해 입학생 페이지는 후보로 내지 않는다
    expect(found.candidates.some((c) => c.postTitle.startsWith('25학년도'))).toBe(false)
  })

  it('그림 고르기: 아이콘·배너는 빼고 올린 큰 그림만', () => {
    const html = `<img src="/images/co/lg/ico_langKor.png"><img src="/upload/editor/a.png" width="1000"><img src="/upload/editor/tiny.png" width="80">
      <img src="data:image/png;base64,AAAA"><img src="https://evil.example/upload/b.png" width="1000">`
    const allow = (u: URL) => u.hostname === 'school.jje.go.kr'
    expect(contentImages(html, 'https://school.jje.go.kr/namnyeong/x', allow).map((i) => i.url)).toEqual(['https://school.jje.go.kr/upload/editor/a.png'])
  })

  it('그림 고르기: 학교 전경 사진은 빼고, 학과마다 붙인 표는 모두', () => {
    const tables = [1, 2, 3, 4, 5].map(
      (i) => `<img src="/dext5editordata/2026/08/20260828_15282050${i}_7666.png" alt="image.png" style="width: 1168px; height: 1895px;">`,
    )
    const html = `<img src="/upload/dimigo-h/logo/img_a.png" alt="한국디지털미디어고등학교">
      <img src='/upload/dimigo-h/subImg/img_b.png' alt='파노라마12 (1) (1).png'><img src="/upload/x/wide.png" style="width: 1600px; height: 500px;">${tables.join('')}`
    const got = contentImages(html, 'https://dimigo-h.goeas.kr/dimigo-h/na/ntt/selectNttInfo.do', () => true, 2026)
    expect(got.map((i) => i.url.split('/').pop())).toEqual([1, 2, 3, 4, 5].map((i) => `20260828_15282050${i}_7666.png`))
    expect(got.every((i) => !i.dated)).toBe(true)
  })

  it('파일 이름에 입학년도가 있는 그림은 그 해 것만 (인천형)', () => {
    const html = `<img src="/images/template/10414/sub/s_visual.png"><img src="/images/template/00602/sub/0203_2026.png?x=2">
      <img src="/images/template/00602/sub/0203_2025.png?x=2"><img src="/upload/2025/03/notice.png" width="800">`
    const got = contentImages(html, 'https://garim.icehs.kr/sub/info.do', () => true, 2026)
    expect(got).toEqual([
      { url: 'https://garim.icehs.kr/images/template/00602/sub/0203_2026.png?x=2', dated: true },
      { url: 'https://garim.icehs.kr/upload/2025/03/notice.png', dated: false },
    ])
  })
})

describe('학과·과정 (나이스)', () => {
  const now = new Date('2026-10-19T03:00:00Z')
  const fake = (rows: Record<string, { DDDEP_NM: string }[]>, seen: string[] = []) =>
    (async (url: RequestInfo | URL) => {
      const u = new URL(String(url))
      const service = u.pathname.split('/').pop() ?? ''
      seen.push(`${service} ${u.searchParams.get('AY') ?? ''} ${u.searchParams.get('GRADE') ?? ''}`.trim())
      const list = rows[service] ?? []
      return Response.json(list.length ? { [service]: [{}, { row: list }] } : { RESULT: { CODE: 'INFO-200' } })
    }) as typeof fetch

  it('그 입학년도가 올해 다니는 학년의 학급으로 지금 있는 학과를 센다', async () => {
    const seen: string[] = []
    const classInfo = [...Array(12).fill({ DDDEP_NM: '일반학과' }), { DDDEP_NM: '체육과' }]
    const t = await schoolTracks('T10', '9290076', 2025, undefined, fake({ classInfo }, seen), now)
    expect(seen).toEqual(['classInfo 2026 2'])
    expect(t).toEqual({ tracks: ['체육과'], classes: { 체육과: 1 }, general: true, generalClasses: 12, source: 'classes' })
  })

  it('예비 고1은 올해 1학년 학급을 보고, 학급 정보가 없으면 학과 정보로', async () => {
    const seen: string[] = []
    const majors = [{ DDDEP_NM: '공통과정' }, { DDDEP_NM: '해킹방어과' }, { DDDEP_NM: '해킹방어과' }, { DDDEP_NM: 'e-비즈니스과' }]
    const t = await schoolTracks('J10', '7530560', 2027, undefined, fake({ schoolMajorinfo: majors }, seen), now)
    expect(seen).toEqual(['classInfo 2026 1', 'schoolMajorinfo'])
    expect(t.tracks).toEqual(['해킹방어과', 'e-비즈니스과'])
    expect(t.general).toBe(true)
    expect(t.source).toBe('majors')
  })

  it('학년도는 3월에 바뀐다', () => {
    expect(schoolYear(new Date('2027-02-27T00:00:00Z'))).toBe(2026)
    expect(schoolYear(new Date('2027-03-02T00:00:00Z'))).toBe(2027)
  })

  it('학과를 정하면 그 학과 표만, 일반 학급이면 특별 학급이 아닌 표만 옮기게 한다', () => {
    expect(importSystem(2026, '체육과')).toContain('학과(과정): 체육과')
    expect(importSystem(2026, '일반학급')).toContain('일반 학급 표만 옮긴다')
    expect(importSystem(2026)).not.toContain('학과(과정)')
    expect(importSystem(2026)).toContain('variants')
  })
})

describe('PDF 쪽 고르기', () => {
  it('해당 입학년도 편제표 쪽을 고르고 다른 해 쪽은 뺀다', () => {
    const texts = [
      '표지 학교 교육과정',
      '2024학년도 입학생 교육과정 편제표 택1',
      '2026학년도 입학생 교육과정 편제표 택2',
      '2025학년도 입학생 편제표',
      '2026학년도 입학생 선택과목 안내',
    ]
    expect(pickPages(texts, 2026, 2)).toEqual([3, 5])
  })

  it('글자 층이 없는 스캔본이면 앞쪽부터', () => {
    expect(pickPages(['', '', '', '', ''], 2026, 3)).toEqual([1, 2, 3])
  })
})

describe('공유 저장소', () => {
  const sample = (over: Partial<Parameters<Store['insert']>[0]> = {}) => ({
    office: 'J10',
    code: '7530847',
    cohort: 2026,
    track: '',
    schoolName: '반송고등학교',
    region: '경기',
    data: { a: 1 },
    sourceUrl: 'https://bansong-h.goehs.kr/upload/a.pdf',
    pageUrl: 'https://bansong-h.goehs.kr/post',
    sourceTitle: '2026학년도 교육과정 편제표',
    method: 'school-site',
    model: 'm',
    ...over,
  })

  it('가장 최근 것을 돌려주고, 숨긴 것은 뺀다', () => {
    const db = new Store(':memory:')
    const a = db.insert(sample())
    const b = db.insert(sample({ sourceUrl: 'https://bansong-h.goehs.kr/upload/b.pdf', data: { a: 2 } }))
    expect(db.latest('J10', '7530847', 2026)?.id).toBe(b.id)
    expect(db.latest('J10', '7530847', 2026)?.data).toEqual({ a: 2 })
    expect(db.hide(b.id)).toBe(true)
    expect(db.latest('J10', '7530847', 2026)?.id).toBe(a.id)
    expect(db.latest('J10', '7530847', 2025)).toBeNull()
    expect(db.bySource('J10', '7530847', 2026, '', 'https://bansong-h.goehs.kr/upload/a.pdf')?.pageUrl).toBe('https://bansong-h.goehs.kr/post')
    db.report(a.id, '2-1 학점이 달라요')
    expect(db.stats()).toEqual({ schools: 1, reports: 1, total: 2, hidden: 1, verified: 0, openReports: 1 })
    db.close()
  })
})

describe('공유해도 될 만큼 읽혔는지', () => {
  it('반송고 실제 편제표는 통과, 빈 표나 학점이 이상한 표는 불통', () => {
    expect(looksComplete(BANSONG_2026)).toBe(true)
    const empty: School = { ...BANSONG_2026, terms: BANSONG_2026.terms.map((t) => ({ ...t, fixed: [], groups: [] })) }
    expect(looksComplete(empty)).toBe(false)
    const huge: School = {
      ...BANSONG_2026,
      terms: BANSONG_2026.terms.map((t) => ({ ...t, fixed: t.fixed.map((f) => ({ ...f, credits: 20 })) })),
    }
    expect(looksComplete(huge)).toBe(false)
    // 한 학기만 9학점 튀면 잘못 읽은 것
    const skewed: School = {
      ...BANSONG_2026,
      terms: BANSONG_2026.terms.map((t) => (t.id === '2-1' ? { ...t, fixed: [...t.fixed, { subject: '정치', credits: 9 }] } : t)),
    }
    expect(looksComplete(skewed)).toBe(false)
  })
})

const CFG: AiConfig = {
  kind: 'openai',
  name: 'test',
  baseUrl: 'https://ai.example.com/v1',
  apiKey: 'sk-test',
  model: 'text-model',
  visionModel: 'vision-model',
  maxTokensParam: 'max_tokens',
  jsonMode: false,
}
const REF: SchoolRef = { office: 'J10', code: '7530847', name: '반송고등학교', region: '경기', homepage: 'http://bansong-h.goehs.kr/' }
const PDF = Buffer.from('%PDF-1.7\n...')
const ANY_SITE: Site = { allow: () => true }

describe('파일 받아 읽기', () => {
  it('받은 PDF를 서버가 그려 비전 모델에 보내고 결과를 정리한다', async () => {
    const sent: Record<string, unknown>[] = []
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return Response.json({ choices: [{ message: { content: JSON.stringify({ terms: BANSONG_2026.terms, tracks: BANSONG_2026.tracks }) } }] })
    }) as typeof fetch
    const out = await readFromUrl(REF, 2026, { url: 'https://bansong-h.goehs.kr/upload/a.pdf', kind: 'pdf' }, ANY_SITE, CFG, {
      download: async (url) => ({ url, status: 200, contentType: 'application/pdf', body: PDF }) satisfies SafeResponse,
      render: async () => ({ images: ['data:image/jpeg;base64,AAAA'], pages: 3, used: [2] }),
      fetchImpl,
    })
    expect(out.data.id).toBe('neis-J10-7530847-2026')
    expect(out.data.name).toBe('반송고등학교')
    expect(out.unknown).toEqual([])
    expect(looksComplete(out.data)).toBe(true)
    expect(sent[0].model).toBe('vision-model')
  })

  it('PDF라던 파일이 깨진 한글 파일이면 AI를 부르지 않는다', async () => {
    let called = false
    const hwp = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    const job = readFromUrl(REF, 2026, { url: 'https://bansong-h.goehs.kr/upload/a.pdf', kind: 'pdf' }, ANY_SITE, CFG, {
      download: async (url) => ({ url, status: 200, contentType: 'application/octet-stream', body: hwp }),
      fetchImpl: (async () => {
        called = true
        return Response.json({})
      }) as typeof fetch,
    })
    await expect(job).rejects.toThrow(/한글/)
    expect(called).toBe(false)
  })

  it('한글(HWPX) 공시 파일은 표만 글로 옮겨 강한 모델에 보낸다', async () => {
    const rows = [
      ['교과', '과목', '1-1', '2-1'],
      ['국어', '공통국어1', '4', ''],
      ['국어', '문학', '', '4'],
      ['수학', '공통수학1', '4', ''],
      ['수학', '대수', '', '4'],
      ['영어', '공통영어1', '4', ''],
      ['과학', '물리학', '', '택1 3'],
      ['과학', '화학', '', '택1 3'],
      ['사회', '통합사회1', '4', ''],
      ['', '학점 합계', '29', '29'],
    ]
    const file = makeZip({ mimetype: 'application/hwp+zip', 'Contents/section0.xml': hwpxSection('2026학년도 입학생 교육과정 편제표', rows) })
    const sent: Record<string, unknown>[] = []
    let checked = ''
    const out = await readFromUrl(
      REF,
      2026,
      { url: 'https://www.schoolinfo.go.kr/servlets/EiFileDownLoad.do?FILE_SEQ=1', kind: 'hwp', source: 'schoolinfo' },
      { allow: () => true, check: async (u) => void (checked = u) },
      CFG,
      {
        download: async (url) => ({ url, status: 200, contentType: 'application/octet-stream', body: file }),
        fetchImpl: (async (_u: RequestInfo | URL, init?: RequestInit) => {
          sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
          return Response.json({ choices: [{ message: { content: JSON.stringify({ terms: BANSONG_2026.terms }) } }] })
        }) as typeof fetch,
      },
    )
    expect(checked).toContain('schoolinfo')
    expect(sent[0].model).toBe('vision-model')
    const user = String((sent[0].messages as { content: unknown }[])[1].content)
    expect(user).toContain('2026학년도 입학생 교육과정 편제표')
    expect(user).toContain('국어 | 공통국어1 | 4')
    expect(out.pages).toBe(1)
  })

  it('그림으로 올린 편제표는 그림을 받아 크기를 맞춘 뒤 보낸다', async () => {
    const got: string[] = []
    const sent: Record<string, unknown>[] = []
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const out = await readFromUrl(
      REF,
      2026,
      {
        url: 'https://school.jje.go.kr/namnyeong/page',
        kind: 'images',
        images: ['https://school.jje.go.kr/upload/a.png', 'https://school.jje.go.kr/upload/b.png'],
      },
      ANY_SITE,
      CFG,
      {
        download: async (url) => {
          got.push(url)
          return { url, status: 200, contentType: 'image/png', body: url.endsWith('b.png') ? Buffer.from('<html>') : png }
        },
        normalize: async () => 'data:image/jpeg;base64,BBBB',
        fetchImpl: (async (_u: RequestInfo | URL, init?: RequestInit) => {
          sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
          return Response.json({ choices: [{ message: { content: JSON.stringify({ terms: BANSONG_2026.terms }) } }] })
        }) as typeof fetch,
      },
    )
    expect(got).toHaveLength(2)
    // 그림이 아닌 응답은 버리고 그림 한 장만 보낸다
    const content = (sent[0].messages as { content: unknown }[])[1].content as { type: string }[]
    expect(content.filter((c) => c.type === 'image_url')).toHaveLength(1)
    expect(out.pages).toBe(1)
  })

  it('학기 합계가 표와 다르면 그 학기를 짚어 한 번 더 묻고, 고친 답을 쓴다', async () => {
    const totals = Object.fromEntries(TERMS.map((t) => [t, termCredits(BANSONG_2026, t)]))
    // 첫 답: 2학년 1학기 과목 하나를 2학기 열로 잘못 옮김
    const moved = structuredClone(BANSONG_2026.terms)
    const from = moved.find((t) => t.id === '2-1')!
    moved.find((t) => t.id === '2-2')!.fixed.push(from.fixed.shift()!)
    const answers = [
      { terms: moved, tracks: BANSONG_2026.tracks, totals },
      { terms: BANSONG_2026.terms, tracks: BANSONG_2026.tracks, totals },
    ]
    const sent: Record<string, unknown>[] = []
    const out = await readFromUrl(REF, 2026, { url: 'https://bansong-h.goehs.kr/upload/a.pdf', kind: 'pdf' }, ANY_SITE, CFG, {
      download: async (url) => ({ url, status: 200, contentType: 'application/pdf', body: PDF }),
      render: async () => ({ images: ['data:image/jpeg;base64,AAAA'], pages: 1, used: [1] }),
      fetchImpl: (async (_u: RequestInfo | URL, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return Response.json({ choices: [{ message: { content: JSON.stringify(answers[sent.length - 1]) } }] })
      }) as typeof fetch,
    })
    expect(sent).toHaveLength(2)
    const again = sent[1].messages as { role: string; content: unknown }[]
    expect(again.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(String(again[3].content)).toContain('2학년 1학기')
    expect(out.mismatch).toEqual([])
    expect(termCredits(out.data, '2-1')).toBe(totals['2-1'])
  })

  it('다시 물어도 합계가 안 맞으면 어긋난 학기를 알려 준다', async () => {
    const totals = Object.fromEntries(TERMS.map((t) => [t, termCredits(BANSONG_2026, t)]))
    let calls = 0
    const out = await readFromUrl(REF, 2026, { url: 'https://bansong-h.goehs.kr/upload/a.pdf', kind: 'pdf' }, ANY_SITE, CFG, {
      download: async (url) => ({ url, status: 200, contentType: 'application/pdf', body: PDF }),
      render: async () => ({ images: ['data:image/jpeg;base64,AAAA'], pages: 1, used: [1] }),
      fetchImpl: (async () => {
        calls++
        return Response.json({
          choices: [
            {
              message: { content: JSON.stringify({ terms: BANSONG_2026.terms, tracks: BANSONG_2026.tracks, totals: { ...totals, '3-1': totals['3-1'] + 5 } }) },
            },
          ],
        })
      }) as typeof fetch,
    })
    expect(calls).toBe(2)
    expect(out.mismatch).toEqual([{ term: '3-1', table: totals['3-1'] + 5, read: totals['3-1'] }])
  })
})

describe('표 합계와 맞춰 보기', () => {
  const totals = Object.fromEntries(TERMS.map((t) => [t, termCredits(BANSONG_2026, t)]))

  it('맞으면 비어 있고, 창체가 들어간 합계처럼 모든 학기에 같은 차이는 봐준다', () => {
    expect(totalMismatch(BANSONG_2026, totals)).toEqual([])
    expect(totalMismatch(BANSONG_2026, Object.fromEntries(TERMS.map((t) => [t, totals[t] + 3])))).toEqual([])
  })

  it('학기마다 다르게 어긋난 곳만 짚는다', () => {
    expect(totalMismatch(BANSONG_2026, { ...totals, '2-1': totals['2-1'] + 4, '2-2': totals['2-2'] - 4 })).toEqual([
      { term: '2-1', table: totals['2-1'] + 4, read: totals['2-1'] },
      { term: '2-2', table: totals['2-2'] - 4, read: totals['2-2'] },
    ])
  })

  it('합계가 없거나 이상한 값이면 비교하지 않는다', () => {
    expect(totalMismatch(BANSONG_2026, undefined)).toEqual([])
    expect(totalMismatch(BANSONG_2026, { '1-1': 'x', '1-2': -3 })).toEqual([])
    expect(totalMismatch(BANSONG_2026, { '2-1': 99 })).toEqual([])
  })
})

// ---- API 흐름 ----

const ENV = { AI_BASE_URL: 'https://ai.example.com/v1', AI_API_KEY: 'sk-test', AI_MODEL: 'text-model', AI_VISION_MODEL: 'vision-model' }
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://app.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://app.test', ...headers },
    body: JSON.stringify(body),
  })

/** 나이스 학교 정보만 돌려주는 가짜 fetch */
const neis = (homepage = 'bansong-h.goehs.kr') =>
  (async () =>
    Response.json({
      schoolInfo: [
        { head: [] },
        { row: [{ ATPT_OFCDC_SC_CODE: 'J10', ATPT_OFCDC_SC_NM: '경기도교육청', SD_SCHUL_CODE: '7530847', SCHUL_NM: '반송고등학교', HMPG_ADRES: homepage }] },
      ],
    })) as unknown as typeof fetch

const FOUND: Discovery = {
  entry: 'https://bansong-h.goehs.kr/bansong-h/main.do',
  candidates: [
    {
      url: 'https://bansong-h.goehs.kr/upload/a.pdf',
      kind: 'pdf',
      fileName: '2026 편제표.pdf',
      postTitle: '2026학년도 교육과정 편제표',
      postUrl: 'https://bansong-h.goehs.kr/post/1',
      score: 9,
      source: 'homepage',
    },
  ],
}

function setup(read?: (s: SchoolRef, c: number, t: ReadTarget, site: Site) => Promise<ReadResult>) {
  const store = new Store(':memory:')
  let discoverCalls = 0
  let readCalls = 0
  const api = testApi({
    fetch: neis(),
    store,
    schoolInfo: async () => ({ id: null, candidates: [] }),
    robots: async () => {},
    discover: async () => {
      discoverCalls++
      return FOUND
    },
    read: async (s, c, t, site) => {
      readCalls++
      if (read) return read(s, c, t, site)
      return { data: { ...BANSONG_2026, id: 'x' }, unknown: [], sourceUrl: t.url, pages: 3, used: [2] }
    },
  })
  return { api, store, counts: () => ({ discoverCalls, readCalls }) }
}

const ctx = (ip = '1.1.1.1') => ({ ip, env: ENV })
const BODY = { office: 'J10', code: '7530847', cohort: 2026 }

describe('/api/curriculum', () => {
  it('찾기 → 읽기 → 공유 저장 → 다음 사람은 바로 받는다', async () => {
    const { api, counts } = setup()
    const none = await api(new Request('http://app.test/api/curriculum?office=J10&code=7530847&cohort=2026'), ctx())
    expect(await none.json()).toEqual({ status: 'none' })

    const d = await api(post('/api/curriculum/discover', BODY), ctx())
    expect(d.status).toBe(200)
    const dj = (await d.json()) as { candidates: { url: string; kind: string }[] }
    expect(dj.candidates[0]).toMatchObject({ url: 'https://bansong-h.goehs.kr/upload/a.pdf', kind: 'pdf' })

    const r = await api(post('/api/curriculum/read', { ...BODY, url: dj.candidates[0].url }), ctx())
    expect(r.status).toBe(200)
    const rj = (await r.json()) as { status: string; curriculum: { school: School; pageUrl: string; sourceTitle: string } }
    expect(rj.status).toBe('ready')
    expect(rj.curriculum.pageUrl).toBe('https://bansong-h.goehs.kr/post/1')
    expect(rj.curriculum.school.source.url).toBe('https://bansong-h.goehs.kr/post/1')
    expect(rj.curriculum.sourceTitle).toBe('2026학년도 교육과정 편제표')

    const again = await api(new Request('http://app.test/api/curriculum?office=J10&code=7530847&cohort=2026'), ctx('2.2.2.2'))
    const aj = (await again.json()) as { status: string; curriculum: { school: School } }
    expect(aj.status).toBe('ready')
    expect(aj.curriculum.school.terms).toEqual(BANSONG_2026.terms)

    // 같은 파일을 다시 읽으라고 해도 AI를 다시 부르지 않는다
    await api(post('/api/curriculum/read', { ...BODY, url: dj.candidates[0].url }), ctx('3.3.3.3'))
    expect(counts()).toEqual({ discoverCalls: 1, readCalls: 1 })
  })

  it('서버가 그 학교 홈페이지에서 찾지 않은 파일은 읽지 않는다', async () => {
    const { api, counts } = setup()
    for (const url of ['https://other-h.goehs.kr/upload/b.pdf', 'https://bansong-h.goehs.kr/upload/fake.pdf', 'http://169.254.169.254/latest']) {
      const res = await api(post('/api/curriculum/read', { ...BODY, url }), ctx())
      expect(res.status, url).toBe(400)
    }
    expect(counts().readCalls).toBe(0)
  })

  it('덜 읽힌 표는 저장하지 않고 요청한 사람에게만 돌려준다', async () => {
    const { api, store } = setup(async (_s, _c, t) => ({
      data: { ...BANSONG_2026, terms: BANSONG_2026.terms.map((x) => (x.id === '3-2' || x.id === '3-1' ? { ...x, fixed: [], groups: [] } : x)) },
      unknown: [],
      sourceUrl: t.url,
      pages: 1,
      used: [1],
    }))
    await api(post('/api/curriculum/discover', BODY), ctx())
    const res = await api(post('/api/curriculum/read', { ...BODY, url: FOUND.candidates[0].url }), ctx())
    expect(((await res.json()) as { status: string }).status).toBe('partial')
    expect(store.latest('J10', '7530847', 2026)).toBeNull()
  })

  it('자동 읽기 한도: 10분에 8번(안내 문구), 관리자는 1인 한도에서 뺀다', async () => {
    // 파일을 받지 못한 읽기는 기억하지 않으므로 다시 할 때마다 센다
    const { api, store } = setup(async () => {
      throw new FetchBlocked('파일을 받지 못했어요 (500).')
    })
    await api(post('/api/curriculum/discover', BODY), ctx())
    const url = FOUND.candidates[0].url
    for (let i = 0; i < 8; i++) expect((await api(post('/api/curriculum/read', { ...BODY, url }), ctx('7.7.7.7'))).status).toBe(422)
    const blocked = await api(post('/api/curriculum/read', { ...BODY, url }), ctx('7.7.7.7'))
    expect(blocked.status).toBe(429)
    expect(((await blocked.json()) as { error: string }).error).toContain('10분에 8번')

    const cookie = sessionFor(store, { email: 'boss@example.com', role: 'owner' })
    for (let i = 0; i < 12; i++) {
      const res = await api(post('/api/curriculum/read', { ...BODY, url }, { cookie }), ctx('7.7.7.7'))
      expect(res.status).toBe(422)
    }
  })

  it('덜 읽힌 결과는 공유하지 않고 한동안 기억해, 같은 파일을 또 AI로 읽지 않는다', async () => {
    const partial = async (_s: SchoolRef, _c: number, t: ReadTarget) => ({
      data: { ...BANSONG_2026, terms: BANSONG_2026.terms.map((x) => (x.id === '3-2' || x.id === '3-1' ? { ...x, fixed: [], groups: [] } : x)) },
      unknown: [],
      sourceUrl: t.url,
      pages: 1,
      used: [1],
    })
    const { api, store, counts } = setup(partial)
    await api(post('/api/curriculum/discover', BODY), ctx())
    const url = FOUND.candidates[0].url
    for (let i = 0; i < 3; i++) {
      const res = await api(post('/api/curriculum/read', { ...BODY, url }), ctx())
      expect(res.status).toBe(200)
      expect(((await res.json()) as { status: string }).status).toBe('partial')
    }
    expect(counts().readCalls).toBe(1)
    expect(store.latest('J10', '7530847', 2026)).toBeNull()
  })

  it('동시에 같은 파일을 읽으면 AI는 한 번만', async () => {
    let release = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const { api, counts, store } = setup(async (_s, _c, t) => {
      await gate
      return { data: BANSONG_2026, unknown: [], sourceUrl: t.url, pages: 3, used: [2] }
    })
    const url = FOUND.candidates[0].url
    const a = api(post('/api/curriculum/read', { ...BODY, url }), ctx('1.1.1.1'))
    const b = api(post('/api/curriculum/read', { ...BODY, url }), ctx('2.2.2.2'))
    await new Promise((r) => setTimeout(r, 20))
    release()
    const [ra, rb] = await Promise.all([a, b])
    expect([ra.status, rb.status]).toEqual([200, 200])
    expect(counts().readCalls).toBe(1)
    expect(store.stats().schools).toBe(1)
  })

  it('학교 코드는 형식을 보고, 나이스에 없으면 404', async () => {
    const { api } = setup()
    const bad = await api(post('/api/curriculum/discover', { office: '../x', code: '1', cohort: 2026 }), ctx())
    expect(bad.status).toBe(400)
    const badCohort = await api(post('/api/curriculum/discover', { ...BODY, cohort: 1999 }), ctx())
    expect(badCohort.status).toBe(400)
    const empty = testApi({ fetch: (async () => Response.json({ RESULT: { CODE: 'INFO-200' } })) as unknown as typeof fetch, store: new Store(':memory:') })
    const missing = await empty(post('/api/curriculum/discover', BODY), ctx())
    expect(missing.status).toBe(404)
  })

  it('나이스에 홈페이지가 없어도 학교알리미 후보는 낸다', async () => {
    const info = { ...FOUND.candidates[0], url: 'https://www.schoolinfo.go.kr/servlets/EiFileDownLoad.do?FILE_SEQ=2', source: 'schoolinfo' as const }
    const api = testApi({
      fetch: neis(''),
      store: new Store(':memory:'),
      discover: async () => FOUND,
      schoolInfo: async () => ({ id: 'uuid', candidates: [info] }),
    })
    const res = await api(post('/api/curriculum/discover', BODY), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { candidates: { url: string; source: string }[]; notes: string[] }
    expect(body.candidates).toEqual([expect.objectContaining({ url: info.url, source: 'schoolinfo' })])
    expect(body.notes).toEqual(['나이스에 홈페이지 주소가 없어요.'])
  })

  it('학교알리미 파일은 학교알리미 주소로만 받는다', async () => {
    const info = { ...FOUND.candidates[0], url: 'https://www.schoolinfo.go.kr/servlets/EiFileDownLoad.do?FILE_SEQ=2', source: 'schoolinfo' as const }
    let seen: Site | null = null
    const api = testApi({
      fetch: neis(),
      store: new Store(':memory:'),
      discover: async () => ({ entry: 'https://bansong-h.goehs.kr/', candidates: [] }),
      schoolInfo: async () => ({ id: 'uuid', candidates: [info] }),
      read: async (_s, _c, t, site) => {
        seen = site
        return { data: BANSONG_2026, unknown: [], sourceUrl: t.url, pages: 1, used: [1] }
      },
    })
    const res = await api(post('/api/curriculum/read', { ...BODY, url: info.url }), ctx())
    expect(res.status).toBe(200)
    const site = seen as Site | null
    expect(site?.allow(new URL('https://www.schoolinfo.go.kr/x'))).toBe(true)
    expect(site?.allow(new URL('https://bansong-h.goehs.kr/x'))).toBe(false)
    expect(site?.check).toBeUndefined()
  })

  it('학과·과정별 편제표가 여러 개인데 고르지 않았으면 섞어 저장하지 않고 고르게 한다', async () => {
    const { api, store } = setup(async (_s, _c, t) => ({
      data: BANSONG_2026,
      unknown: [],
      sourceUrl: t.url,
      pages: 1,
      used: [1],
      variants: ['일반학급', '체육학급'],
    }))
    await api(post('/api/curriculum/discover', BODY), ctx())
    const res = await api(post('/api/curriculum/read', { ...BODY, url: FOUND.candidates[0].url }), ctx())
    expect(await res.json()).toMatchObject({ status: 'choose', variants: ['일반학급', '체육학급'] })
    expect(store.stats().total).toBe(0)
    // 학과를 골라 다시 읽으면 그 학과로 저장한다
    await api(post('/api/curriculum/discover', { ...BODY, track: '체육학급' }), ctx())
    const again = await api(post('/api/curriculum/read', { ...BODY, track: '체육학급', url: FOUND.candidates[0].url }), ctx())
    expect(((await again.json()) as { status: string }).status).toBe('ready')
    expect(store.latest('J10', '7530847', 2026, '체육학급')).not.toBeNull()
    expect(store.latest('J10', '7530847', 2026)).toBeNull()
  })

  it('학과·과정 목록은 일반고도 본다 (체육 학급)', async () => {
    const api = testApi({
      fetch: neis(),
      store: new Store(':memory:'),
      tracks: async (_o, _c, cohort) => ({ tracks: ['체육과'], classes: { 체육과: 1 }, general: true, generalClasses: 12, source: 'classes' as const, cohort }),
    })
    const res = await api(new Request('http://app.test/api/school-tracks?office=J10&code=7530847&cohort=2026'), ctx())
    expect(await res.json()).toMatchObject({ tracks: ['체육과'], general: true, generalClasses: 12, cohort: 2026 })
  })

  it('신고는 저장하고, 숨기기는 관리자 토큰이 있어야 한다', async () => {
    const { api, store } = setup()
    const saved = store.insert({
      office: 'J10',
      code: '7530847',
      cohort: 2026,
      track: '',
      schoolName: '반송고등학교',
      region: '경기',
      data: BANSONG_2026,
      sourceUrl: 'https://bansong-h.goehs.kr/upload/a.pdf',
      pageUrl: '',
      sourceTitle: '편제표',
      method: 'school-site',
      model: 'm',
    })
    const rep = await api(post('/api/curriculum/report', { id: saved.id, reason: '3-1 학점이 달라요' }), ctx())
    expect(rep.status).toBe(200)
    expect(store.stats().reports).toBe(1)

    const env = { ...ENV, ADMIN_TOKEN: 'admin-token-0123456789' }
    const noAuth = await api(post('/api/admin/hide', { id: saved.id }), { ip: '1.1.1.1', env })
    expect(noAuth.status).toBe(401)
    const wrong = await api(post('/api/admin/hide', { id: saved.id }, { authorization: 'Bearer admin-token-0123456788' }), { ip: '1.1.1.1', env })
    expect(wrong.status).toBe(401)
    const shortToken = await api(post('/api/admin/hide', { id: saved.id }, { authorization: 'Bearer short' }), {
      ip: '1.1.1.1',
      env: { ...ENV, ADMIN_TOKEN: 'short' },
    })
    expect(shortToken.status).toBe(401)
    const ok = await api(post('/api/admin/hide', { id: saved.id }, { authorization: 'Bearer admin-token-0123456789' }), { ip: '1.1.1.1', env })
    expect(ok.status).toBe(200)
    expect(store.latest('J10', '7530847', 2026)).toBeNull()
  })
})

describe('편제표 이용 기록', () => {
  it('찾기·읽기·불러오기·신고를 결과와 함께 남기고, 같은 실패는 한 줄로 모은다', async () => {
    const { api, store } = setup()
    await api(post('/api/curriculum/discover', BODY), ctx())
    await api(post('/api/curriculum/discover', BODY), ctx())
    const fake = 'https://bansong-h.goehs.kr/upload/fake.pdf'
    expect((await api(post('/api/curriculum/read', { ...BODY, url: fake }), ctx())).status).toBe(400)
    expect((await api(post('/api/curriculum/read', { ...BODY, url: fake }), ctx())).status).toBe(400)
    expect((await api(post('/api/curriculum/read', { ...BODY, url: FOUND.candidates[0].url }), ctx())).status).toBe(200)
    expect((await api(post('/api/curriculum/read', { ...BODY, url: FOUND.candidates[0].url }), ctx())).status).toBe(200)
    await api(new Request('http://app.test/api/curriculum?office=J10&code=7530847&cohort=2026'), ctx())
    expect((await api(post('/api/curriculum/report', { id: 1, reason: '3-1 학점이\n달라요' }), ctx())).status).toBe(200)
    const log = new Accounts(store.db).logs({ kind: 'user' }).entries
    expect(log.map((e) => [e.action, e.target, e.detail, e.times])).toEqual([
      ['curriculum.report', '편제표 #1', '3-1 학점이 달라요', 1],
      ['curriculum.open', '반송고등학교 2026', '공유 편제표 #1', 1],
      ['curriculum.read', '반송고등학교 2026', '파일 2026 편제표.pdf · 이미 읽어 둔 편제표 #1', 1],
      ['curriculum.read', '반송고등학교 2026', '파일 2026 편제표.pdf · 읽어서 공유 #1', 1],
      ['curriculum.read', '반송고등학교 2026', '실패: 이 학교 공시·홈페이지에서 찾은 파일만 읽을 수 있어요. 다른 파일은 직접 올려 주세요.', 2],
      ['curriculum.find', '반송고등학교 2026', '파일 후보 1개', 2],
    ])
    expect(new Set(log.map((e) => e.who))).toEqual(new Set(['student@example.com']))
  })
})
