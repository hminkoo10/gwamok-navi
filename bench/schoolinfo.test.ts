// 학교알리미 공시에서 편제표 후보를 찾고, 받은 파일에서 표를 꺼내는 데까지(AI 없이) 점검한다.
// RUN_LIVE=1 LIVE_OUT=out.json npx vitest run bench/schoolinfo
import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { hangulTables } from '../server/hwp'
import { looksLikePdf } from '../server/pdf-render'
import { CookieJar, safeFetch } from '../server/safe-fetch'
import { schoolInfoCandidates, schoolInfoSite } from '../server/schoolinfo'
import { curriculumTables, subjectHits, xlsxGrids } from '../server/tables'
import { isZip, unzip } from '../server/zip'

const RUN = process.env.RUN_LIVE === '1'

const SCHOOLS = [
  { name: '강릉고등학교', office: 'K10', code: '7801092' },
  { name: '가락고등학교', office: 'B10', code: '7010057' },
  { name: '포항고등학교', office: 'R10', code: '8750133' },
  { name: '고창고등학교', office: 'P10', code: '8321197' },
  { name: '가은고등학교', office: 'R10', code: '8750075' },
  { name: '반송고등학교', office: 'J10', code: '7530847' },
  { name: '갈산고등학교', office: 'N10', code: '8140032' },
  { name: '가야고등학교', office: 'C10', code: '7150119' },
]

function inspect(body: Buffer): string {
  if (looksLikePdf(body)) return `PDF ${body.length}B`
  if (isZip(body)) {
    const names = [...unzip(body, (n) => n === 'xl/workbook.xml' || /^Contents\/section\d+\.xml$/i.test(n)).keys()]
    if (names.includes('xl/workbook.xml')) {
      const sheets = xlsxGrids(body)
      return `XLSX 시트 ${sheets.length}: ${sheets.map((s) => `${s.name}(과목 ${subjectHits(s.grid)})`).join(', ')}`
    }
  }
  const tables = hangulTables(body)
  const good = tables.filter((t) => curriculumTables([t.grid]).length)
  return `한글 표 ${tables.length}개 중 편제표 ${good.length}개: ${good
    .slice(0, 6)
    .map((t) => `[${t.caption.slice(-40)}] ${t.grid.length}x${t.grid[0]?.length} 과목${subjectHits(t.grid)}`)
    .join(' / ')}`
}

it.skipIf(!RUN)(
  '학교알리미 공시 파일',
  async () => {
    const results = []
    for (const s of SCHOOLS) {
      const t = Date.now()
      const jar = new CookieJar()
      try {
        const found = await schoolInfoCandidates(s, 2026, { jar, deadline: Date.now() + 60_000 })
        const top = found.candidates[0]
        let detail = ''
        if (top) {
          const res = await safeFetch(top.url, { allow: schoolInfoSite, jar, maxBytes: 25_000_000, timeoutMs: 40_000 })
          try {
            detail = inspect(res.body)
          } catch (e) {
            detail = `읽기 실패: ${(e as Error).message}`
          }
        }
        results.push({
          school: s.name,
          ms: Date.now() - t,
          id: found.id,
          files: found.candidates.map((c) => `${c.score} ${c.kind} ${c.fileName}`),
          top: detail,
        })
      } catch (e) {
        results.push({ school: s.name, ms: Date.now() - t, error: (e as Error).message })
      }
    }
    if (process.env.LIVE_OUT) writeFileSync(process.env.LIVE_OUT, JSON.stringify(results, null, 1))
  },
  600_000,
)
