// 실제 학교 홈페이지에서 편제표 후보를 찾는지 지역별로 점검한다. 평소에는 건너뛰고 RUN_LIVE=1일 때만 돈다.
// RUN_LIVE=1 LIVE_OUT=out.json npx vitest run bench/schools
import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { discover } from '../server/discover'

const RUN = process.env.RUN_LIVE === '1'

// 지역마다 다른 학교 홈페이지 시스템을 하나 이상 넣는다 (나이스 홈페이지 주소 그대로)
const SCHOOLS: [string, string][] = [
  ['경기 반송고 (ntt형, PDF)', 'http://bansong-h.goehs.kr/'],
  ['경기 가온고 (ntt형, 그림)', 'https://gaon-h.goean.kr'],
  ['서울 가락고 (dggb형, POST)', 'http://garak.sen.hs.kr'],
  ['부산 가야고', 'http://www.gaya.hs.kr'],
  ['대구 강북고 (본문 표)', 'https://gangbuk.dge.hs.kr/'],
  ['인천 가림고 (연도 붙은 그림)', 'http://garim.icehs.kr'],
  ['광주 고려고 (헤더 깨짐)', 'http://korea.gen.hs.kr/'],
  ['대전 대덕고 (boardCnts형)', 'http://daedeokhs.djsch.kr/'],
  ['울산 남창고 (본문 표)', 'http://namchang.hs.kr'],
  ['세종 도담고 (ntt형, PDF·엑셀)', 'http://dodam.sjeduhs.kr'],
  ['강원 강릉고 (boardCnts형, 엑셀)', 'http://ganggo.gwe.hs.kr'],
  ['충북 괴산고 (엑셀)', 'http://school.cbe.go.kr/goesan-h'],
  ['충남 갈산고', 'http://galsan.cnehs.kr'],
  ['전북 고창고', 'http://gochang.hs.kr'],
  ['전남 강진고', 'http://gangjin.hs.jne.kr'],
  ['경북 가은고', 'https://school.gyo6.net/gago'],
  ['경남 거제고 (본문 표)', 'https://geoje-h.gne.go.kr/'],
  ['제주 남녕고 (그림)', 'http://namnyeong.jje.hs.kr'],
]

it.skipIf(!RUN)(
  '지역별 학교 홈페이지 탐색',
  async () => {
    const results = await Promise.all(
      SCHOOLS.map(async ([name, home]) => {
        const t = Date.now()
        try {
          const d = await discover(home, Number(process.env.LIVE_COHORT ?? 2026))
          return { name, ms: Date.now() - t, found: d.candidates.length, top: d.candidates.slice(0, 3).map((c) => `${c.score} ${c.kind} ${c.postTitle} | ${c.fileName}`) }
        } catch (e) {
          return { name, ms: Date.now() - t, error: (e as Error).message }
        }
      }),
    )
    const found = results.filter((r) => 'found' in r && r.found).length
    console.log(`편제표 후보를 찾은 학교: ${found}/${SCHOOLS.length}`)
    if (process.env.LIVE_OUT) writeFileSync(process.env.LIVE_OUT, JSON.stringify(results, null, 1))
  },
  300_000,
)
