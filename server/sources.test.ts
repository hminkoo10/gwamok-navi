import { describe, expect, it } from 'vitest'
import { paraText } from './hwp'
import { attachments, nextPages, revisionBonus, scoreTitle, uploadedAt } from './discover'
import { parseRobots, verdict } from './robots'
import { defaultSettings } from './settings'
import { CookieJar, type SafeResponse } from './safe-fetch'
import { disclosureFiles, eucKrPercent, schoolInfoCandidates, searchPairs } from './schoolinfo'

describe('학교알리미', () => {
  it('검색어를 EUC-KR로 인코딩한다', () => {
    expect(eucKrPercent('반송고등학교')).toBe('%B9%DD%BC%DB%B0%ED%B5%EE%C7%D0%B1%B3')
    expect(eucKrPercent('서울과학고 a-b')).toBe('%BC%AD%BF%EF%B0%FA%C7%D0%B0%ED%20a-b')
  })

  it('검색 결과에서 학교알리미 식별값과 나이스 학교 코드를 짝짓는다', () => {
    const html = `<script> var schulCd = "c6ad5e0f-54d0-4a34-bf19-2c401d9169a7"; var sdSchulCode = "7010057"; var lctnScCd = "01"; </script>
      <script> var schulCd = "acecb049-4bb3-4347-bf65-cd88cbeab743";
      var sdSchulCode = "7010240"; </script>`
    expect(searchPairs(html)).toEqual([
      { id: 'c6ad5e0f-54d0-4a34-bf19-2c401d9169a7', code: '7010057' },
      { id: 'acecb049-4bb3-4347-bf65-cd88cbeab743', code: '7010240' },
    ])
  })

  const DISCLOSURE = `<select><option value="20261" selected>(1차) 2026년 04월</option><option value="20251">(1차) 2025년 04월</option></select>
    <a href="#" onclick="getEiFile14('2');" title="2026학년도 입학생 교육과정 학점 배당표(2022 개정 교육과정)_가락고.pdf pdf문서 첨부파일">2026학년도 …pdf(376 KB)</a>
    <a href="#" onclick="getEiFile14('1');" title="2025학년도 입학생 교육과정 학점 배당표(2022 개정 교육과정)_가락고.pdf pdf문서 첨부파일">…</a>
    <a href="#" onclick="getEiFile14('4');" title="2026학년도 학교교육과정 편성·운영 계획.hwp hwp문서 첨부파일">…</a>`

  it('공시 조각에서 첨부 파일과 회차를 읽는다', () => {
    expect(disclosureFiles(DISCLOSURE, 2026)).toEqual({
      chasu: '1',
      files: [
        { seq: '2', name: '2026학년도 입학생 교육과정 학점 배당표(2022 개정 교육과정)_가락고.pdf' },
        { seq: '1', name: '2025학년도 입학생 교육과정 학점 배당표(2022 개정 교육과정)_가락고.pdf' },
        { seq: '4', name: '2026학년도 학교교육과정 편성·운영 계획.hwp' },
      ],
    })
  })

  it('나이스 코드가 맞는 학교의 공시 파일을 입학년도에 맞춰 순서를 매긴다', async () => {
    const calls: string[] = []
    const fake = async (url: string, opts: { rawForm?: string }): Promise<SafeResponse> => {
      calls.push(opts.rawForm ? `${url} ${opts.rawForm}` : url)
      const html = url.includes('Pneiss_f01_l0')
        ? `var schulCd = "00000000-0000-0000-0000-000000000000"; var sdSchulCode = "9999999";
           var schulCd = "c6ad5e0f-54d0-4a34-bf19-2c401d9169a7"; var sdSchulCode = "7010057";`
        : DISCLOSURE
      return { url, status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(html) }
    }
    const out = await schoolInfoCandidates(
      { name: '가락고등학교', office: 'B10', code: '7010057' },
      2026,
      { jar: new CookieJar(), deadline: Date.now() + 30_000, fetch: fake as never },
      new Date('2026-10-19T00:00:00+09:00'),
    )
    expect(out.id).toBe('c6ad5e0f-54d0-4a34-bf19-2c401d9169a7')
    expect(calls[0]).toContain('SEARCH_SIDO=1100000000')
    expect(calls[0]).toContain('SEARCH_KEYWORD=%B0%A1%B6%F4%B0%ED%B5%EE%C7%D0%B1%B3')
    // 2025학년도 입학생 배당표는 다른 해 표라 후보에서 뺀다 (그 표를 2026학년도 편제표로 옮겨 공유하지 않게)
    expect(out.candidates.map((c) => c.fileName)).toEqual([
      '2026학년도 입학생 교육과정 학점 배당표(2022 개정 교육과정)_가락고.pdf',
      '2026학년도 학교교육과정 편성·운영 계획.hwp',
    ])
    expect(out.candidates[0]).toMatchObject({ kind: 'pdf', source: 'schoolinfo' })
    expect(out.candidates[0].url).toBe(
      'https://www.schoolinfo.go.kr/servlets/EiFileDownLoad.do?SHL_IDF_CD=c6ad5e0f-54d0-4a34-bf19-2c401d9169a7&JG_BURYU_CD=JG020&JG_HANGMOK_CD=05&JG_GUBUN=1&JG_YEAR=2026&JG_CHASU=1&USE_YN=Y&FILE_SEQ=2',
    )
  })
})

describe('robots.txt', () => {
  it('전부 막은 사이트(서울·경북 학교 홈페이지)', () => {
    expect(verdict(parseRobots('User-agent: *\nDisallow: /'), '/92430/subMenu.do')).toBe('disallow')
  })

  it('AI 봇을 막은 사이트는 AI 처리 거부로 본다 (충북·울산)', () => {
    const txt = `# 차단내용 : 첨부파일, 문서뷰어, AI 로봇
User-agent: *
Disallow: /files/
Disallow: /_cmm/vi*/

User-agent: ClaudeBot
User-agent: GPTBot
Disallow: /`
    expect(verdict(parseRobots(txt), '/goesan-h/MABBIABAB/')).toBe('no-ai')
  })

  it('경로 규칙: 가장 긴 규칙, 같으면 허용', () => {
    const groups = parseRobots('User-agent: *\nDisallow: /boardCnts/\nAllow: /boardCnts/list.do\nDisallow: /*.hwp$')
    expect(verdict(groups, '/boardCnts/list.do?boardID=1')).toBe('allow')
    expect(verdict(groups, '/boardCnts/fileDown.do?fileSeq=a')).toBe('disallow')
    expect(verdict(groups, '/main.do')).toBe('allow')
    expect(verdict(groups, '/upload/a.hwp')).toBe('disallow')
    expect(verdict(groups, '/upload/a.hwpx')).toBe('allow')
  })

  it('우리 이름으로 된 규칙이 있으면 그것을 따른다', () => {
    const groups = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: GwamokNavi\nAllow: /')
    expect(verdict(groups, '/main.do')).toBe('allow')
  })

  it('비었거나 다른 봇만 막으면 허용', () => {
    expect(verdict(parseRobots(''), '/x')).toBe('allow')
    expect(verdict(parseRobots('User-agent: BadBot\nDisallow: /'), '/x')).toBe('allow')
  })
})

describe('한글 문단 글자', () => {
  it('8칸짜리 제어 문자(표·탭)를 건너뛰고 줄바꿈은 띄어쓰기로', () => {
    const units = [
      ...'국어'.split('').map((c) => c.charCodeAt(0)),
      11,
      ...Array(7).fill(0),
      9,
      ...Array(7).fill(0),
      ...'문학'.split('').map((c) => c.charCodeAt(0)),
      13,
    ]
    const buf = Buffer.alloc(units.length * 2)
    units.forEach((u, i) => buf.writeUInt16LE(u, i * 2))
    expect(paraText(buf)).toBe('국어 문학')
  })
})

describe('게시판 다음 쪽', () => {
  it('경기형 게시판은 목록 아래 pagingForm을 currPage만 바꿔 보낸다', () => {
    const html =
      '<form name="pagingForm" id="pagingForm" action="/s/na/ntt/selectNttList.do" method="post">' +
      '<input type="hidden" name="currPage" value="1" /><input type="hidden" name="mi" value="16618" /><input type="hidden" name="bbsId" value="9116" />' +
      '<a href="javascript:" onclick="goPaging(2)">2</a><a href="javascript:" onclick="goPaging(3)">3</a></form>'
    const reqs = nextPages({ url: 'https://x.goehs.kr/s/na/ntt/selectNttList.do?mi=16618&bbsId=9116', html })
    expect(reqs.map((r) => r.form?.currPage)).toEqual(['2', '3'])
    expect(reqs[0].url).toBe('https://x.goehs.kr/s/na/ntt/selectNttList.do')
    expect([reqs[0].form?.mi, reqs[0].form?.bbsId]).toEqual(['16618', '9116'])
  })

  it('주소에 쪽 번호가 있는 게시판은 같은 경로의 2·3쪽만 연다', () => {
    const html =
      '<a href="/boardCnts/list.do?boardID=1&page=2">2</a><a href="/boardCnts/list.do?boardID=1&page=3">3</a>' +
      '<a href="/boardCnts/list.do?boardID=1&page=4">4</a><a href="/other.do?page=2">다른 곳</a>'
    const reqs = nextPages({ url: 'https://y.es.kr/boardCnts/list.do?boardID=1&page=1', html })
    expect(reqs.map((r) => new URL(r.url).searchParams.get('page'))).toEqual(['2', '3'])
  })

  it('robots.txt는 기본으로 보지 않는다 (관리 설정에서 켤 수 있다)', () => {
    expect(defaultSettings().obeyRobots).toBe(false)
  })
})

describe('첨부 파일 찾기', () => {
  it('DEXT5 첨부 목록은 작은따옴표·큰따옴표 모두 읽는다', () => {
    const html =
      "<script>DEXT5UPLOAD.AddUploadedFile('a1', '2026 편제표.pdf', '/upload/s/na/bbs_1/2026/03/x.pdf', '100', 'a1', G_UploadID);" +
      'DEXT5UPLOAD.AddUploadedFile("b2", "2026학년도 입학생 교육과정 편제표_V4.hwpx", "/upload/s/na/bbs_1/2026/08/y.hwpx", "95847", "b2", G_UploadID);</script>'
    const files = attachments(html, 'https://s.goeay.kr/s/na/ntt/selectNttInfo.do?nttSn=1')
    expect(files.map((f) => f.name)).toEqual(['2026 편제표.pdf', '2026학년도 입학생 교육과정 편제표_V4.hwpx'])
    expect(files[1].url).toBe('https://s.goeay.kr/upload/s/na/bbs_1/2026/08/y.hwpx')
  })
})

describe('같은 해 편제표가 여러 개일 때', () => {
  it('나중에 고친 파일을 앞에 둔다', () => {
    expect(revisionBonus('2026학년도 입학생 교육과정 편제표_V4.hwpx')).toBe(1)
    expect(revisionBonus('2026학년도 입학생 교육과정 편제표 구버전.hwpx')).toBe(-2)
    // 변경후·변경전은 제목 점수가 다룬다
    expect(scoreTitle('2026학년도 입학생 교육과정 편제표 (변경후).hwpx', 2026)).toBeGreaterThan(
      scoreTitle('2026학년도 입학생 교육과정 편제표 (변경전).hwpx', 2026),
    )
    expect(revisionBonus('2026학년도 입학생 교육과정 편제표.pdf')).toBe(0)
    expect(uploadedAt('https://x.kr/upload/a/na/bbs_1/2026/08/u.hwpx')).toBeGreaterThan(uploadedAt('https://x.kr/upload/a/na/bbs_1/2026/03/u.pdf'))
    expect(uploadedAt('https://x.kr/files/u.pdf')).toBe(0)
  })
})
