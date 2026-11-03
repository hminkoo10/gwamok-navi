import { describe, expect, it } from 'vitest'
import { curriculumTables, gridText, htmlTables, subjectHits, xlsxGrids } from './tables'
import { makeZip } from './testing'
import { isZip, unzip, ZipError } from './zip'

// 울산 남창고 페이지의 표 모양을 줄여 옮긴 것
const TABLE = `
<table>
  <tr><th rowspan="2">교과(군)</th><th rowspan="2">구분</th><th rowspan="2">세부과목</th><th colspan="2">1학년</th><th colspan="2">2학년</th></tr>
  <tr><th>1학기</th><th>2학기</th><th>1학기</th><th>2학기</th></tr>
  <tr><td rowspan="3">국어</td><td>공통</td><td>공통국어1</td><td>4</td><td></td><td></td><td></td></tr>
  <tr><td>공통</td><td>공통국어2</td><td></td><td>4</td><td></td><td></td></tr>
  <tr><td>일반</td><td>문학</td><td></td><td></td><td>4</td><td></td></tr>
  <tr><td rowspan="2">수학</td><td>공통</td><td>공통수학1</td><td>4</td><td></td><td></td><td></td></tr>
  <tr><td>일반</td><td>대수</td><td></td><td></td><td>4</td><td></td></tr>
  <tr><td>과학</td><td>일반</td><td>물리학&nbsp;</td><td></td><td></td><td colspan="2">택1 3</td></tr>
  <tr><td>과학</td><td>일반</td><td>화학</td><td></td><td></td><td colspan="2">택1 3</td></tr>
  <tr><td>사회</td><td>공통</td><td>통합사회1</td><td>4</td><td></td><td></td><td></td></tr>
</table>
<table><tr><td>학교 연혁</td><td>1990</td></tr></table>`

describe('HTML 표', () => {
  it('합친 칸을 펼쳐 칸 위치를 맞춘다', () => {
    const [grid] = htmlTables(TABLE)
    expect(grid[0]).toEqual(['교과(군)', '구분', '세부과목', '1학년', '1학년', '2학년', '2학년'])
    expect(grid[1]).toEqual(['교과(군)', '구분', '세부과목', '1학기', '2학기', '1학기', '2학기'])
    expect(grid[3]).toEqual(['국어', '공통', '공통국어2', '', '4', '', ''])
    expect(grid[7]).toEqual(['과학', '일반', '물리학', '', '', '택1 3', '택1 3'])
  })

  it('과목 이름이 여럿 들어 있는 표만 편제표로 본다', () => {
    const grids = htmlTables(TABLE)
    expect(subjectHits(grids[0])).toBe(8)
    expect(curriculumTables(grids)).toHaveLength(1)
    const text = gridText(curriculumTables(grids))
    expect(text).toContain('국어 | 공통 | 공통국어1 | 4')
    expect(text).not.toContain('학교 연혁')
  })

  it('스크립트 안의 표 글자는 무시한다', () => {
    expect(htmlTables('<script>var s = "<table><tr><td>x</td></tr></table>"</script>')).toEqual([])
  })
})

describe('엑셀', () => {
  const xlsx = makeZip({
    'xl/workbook.xml':
      '<workbook><sheets><sheet name="2026 입학생" sheetId="1" r:id="rId1"/><sheet name="숨김" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml':
      '<sst><si><t>국어</t></si><si><t>공통국어1</t></si><si><r><t>공통</t></r><r><t>국어2</t></r></si><si><t>대수 &amp; 기하</t></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>4</v></c></row>' +
      '<row r="2"><c r="B2" t="s"><v>2</v></c><c r="D2" t="inlineStr"><is><t>택1</t></is></c></row>' +
      '<row r="3"><c r="B3" t="s"><v>3</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:A3"/></mergeCells></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
  })

  it('공유 문자열·서식 문자열·합친 칸을 읽고 숨긴 시트는 뺀다', () => {
    expect(isZip(xlsx)).toBe(true)
    const sheets = xlsxGrids(xlsx)
    expect(sheets.map((s) => s.name)).toEqual(['2026 입학생'])
    expect(sheets[0].grid).toEqual([
      ['국어', '공통국어1', '4', ''],
      ['국어', '공통국어2', '', '택1'],
      ['국어', '대수 & 기하', '', ''],
    ])
  })

  it('zip 목록이 이상하면 거절한다', () => {
    expect(() => unzip(Buffer.from('PK\x03\x04 broken'), () => true)).toThrow(ZipError)
    const big = makeZip({ 'a.txt': 'x'.repeat(1000) })
    expect(() => unzip(big, () => true, { maxEntryBytes: 100, maxTotalBytes: 100, maxEntries: 10 })).toThrow(ZipError)
  })
})
