// 학교알리미 공시 파일을 실제 AI로 끝까지 읽어 본다 (비용 발생). 반송고는 손으로 옮긴 편제표와 비교한다.
// RUN_LIVE=1 LIVE_OUT=out.json npx vitest run bench/read
import { writeFileSync } from 'node:fs'
import { loadEnv } from 'vite'
import { it } from 'vitest'
import { TERMS } from '../src/data/schema'
import { BANSONG_2026 } from '../src/data/schools/bansong2026'
import { termCredits } from '../src/engine/school'
import { aiConfig } from '../server/ai'
import { looksComplete, readFromUrl } from '../server/curriculum'
import { CookieJar } from '../server/safe-fetch'
import { schoolInfoCandidates, schoolInfoSite } from '../server/schoolinfo'

const RUN = process.env.RUN_LIVE === '1'

const ALL = [
  { name: '반송고등학교', office: 'J10', code: '7530847', region: '경기' },
  { name: '고창고등학교', office: 'P10', code: '8321197', region: '전북' },
  { name: '포항고등학교', office: 'R10', code: '8750133', region: '경북' },
  { name: '가은고등학교', office: 'R10', code: '8750075', region: '경북' },
]
const SCHOOLS = process.env.LIVE_ONLY ? ALL.filter((s) => s.name.includes(process.env.LIVE_ONLY ?? '')) : ALL

/** 학기별 과목 이름 집합 */
const subjectsByTerm = (s: typeof BANSONG_2026) =>
  new Map(
    s.terms.map((t) => [t.id, new Set([...t.fixed.map((f) => f.subject), ...t.groups.flatMap((g) => g.options)])] as const),
  )

it.skipIf(!RUN)(
  '학교알리미 파일을 AI로 읽기',
  async () => {
    const cfg = aiConfig(loadEnv('development', process.cwd(), ''))
    if (!cfg) throw new Error('AI 설정 없음')
    const results = await Promise.all(
      SCHOOLS.map(async (s) => {
        const t = Date.now()
        try {
          const jar = new CookieJar()
          const found = await schoolInfoCandidates(s, 2026, { jar, deadline: Date.now() + 60_000 })
          const top = found.candidates[0]
          const out = await readFromUrl(
            { ...s, homepage: '' },
            2026,
            { url: top.url, kind: top.kind, source: 'schoolinfo' },
            { allow: schoolInfoSite, jar },
            cfg,
          )
          const credits = Object.fromEntries(TERMS.map((id) => [id, termCredits(out.data, id)]))
          let compare: string | undefined
          if (s.code === '7530847') {
            const want = subjectsByTerm(BANSONG_2026)
            const got = subjectsByTerm(out.data)
            let tp = 0
            let fp = 0
            let fn = 0
            for (const id of TERMS) {
              const w = want.get(id) ?? new Set()
              const g = got.get(id) ?? new Set()
              for (const x of g) {
                if (w.has(x)) tp++
                else fp++
              }
              for (const x of w) if (!g.has(x)) fn++
            }
            compare = `F1 ${((2 * tp) / (2 * tp + fp + fn)).toFixed(3)} (tp ${tp}, fp ${fp}, fn ${fn})`
          }
          const detail = process.env.LIVE_DETAIL ? out.data.terms.filter((x) => x.id.startsWith('2-')) : undefined
          return { school: s.name, ms: Date.now() - t, file: top.fileName, used: out.used, complete: looksComplete(out.data), credits, unknown: out.unknown, compare, detail }
        } catch (e) {
          return { school: s.name, ms: Date.now() - t, error: (e as Error).message }
        }
      }),
    )
    if (process.env.LIVE_OUT) writeFileSync(process.env.LIVE_OUT, JSON.stringify(results, null, 1))
  },
  600_000,
)
