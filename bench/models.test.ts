// 팩트챗 게이트웨이 모델 실측. 평소 `npm test`에서는 건너뛰고, RUN_BENCH=1일 때만 실제 API를 부른다.
// RUN_BENCH=1 BENCH_PART=import|match BENCH_MODELS=a,b BENCH_IMAGES=pages.json BENCH_OUT=out.json npx vitest run bench
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import type { School, Unit } from '../src/data/schema'
import { TERMS } from '../src/data/schema'
import { BANSONG_2026 } from '../src/data/schools/bansong2026'
import { UNIT_BY_ID } from '../src/data/units'
import { makePlan } from '../src/engine/plan'
import { schoolFromLoose, termCredits } from '../src/engine/school'
import { MAJOR_BY_ID } from '../src/data/majors'
import { extractJson } from '../server/ai'
import { MATCH_SYSTEM, importSystem } from '../server/prompts'

const RUN = process.env.RUN_BENCH === '1'

// 게이트웨이 /models 가격 ($ / 100만 토큰)
const PRICE: Record<string, [number, number]> = {
  'google/gemma-4-31B-it': [0.13, 0.38],
  'solar-mini4': [0.1, 0.4],
  'gpt-6-luna': [0.1, 0.5],
  'claude-haiku-5-5': [0.1, 0.5],
  'qwen3.8-flash': [0.15, 0.47],
  'glm-5.3-flash': [0.15, 0.5],
  'grok-4-1-fast': [0.2, 0.5],
  'gpt-5.6-luna': [0.2, 1.2],
  'deepseek-v4.1-flash': [0.3, 1.2],
  'seed-2-0-lite-260428': [0.25, 2.0],
  'gemini-3.5-flash-lite': [0.3, 2.5],
  'gemini-3.8-flash': [0.75, 3.75],
  'qwen3.7-plus': [0.4, 1.6],
  'solar-pro4': [0.3, 1.2],
  'claude-sonnet-5-5': [2, 10],
}

function readEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  )
}

interface Call {
  content: string
  ms: number
  prompt: number
  completion: number
  reasoning: number
  status: number
  error?: string
}

async function call(env: Record<string, string>, model: string, effort: string | undefined, system: string, user: string, images: string[], maxTokens: number): Promise<Call> {
  const content = images.length ? [{ type: 'text', text: user }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] : user
  const body: Record<string, unknown> = { model, messages: [{ role: 'system', content: system }, { role: 'user', content }], max_tokens: maxTokens }
  if (effort) body.reasoning_effort = effort
  const t0 = Date.now()
  try {
    const res = await fetch(`${env.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    })
    const text = await res.text()
    const ms = Date.now() - t0
    let d: { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }; error?: { message?: string } }
    try {
      d = JSON.parse(text)
    } catch {
      return { content: '', ms, prompt: 0, completion: 0, reasoning: 0, status: res.status, error: text.slice(0, 120) }
    }
    const raw = d.choices?.[0]?.message?.content
    const out = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((p: { text?: string }) => p.text ?? '').join('') : ''
    return {
      content: out,
      ms,
      prompt: d.usage?.prompt_tokens ?? 0,
      completion: d.usage?.completion_tokens ?? 0,
      reasoning: d.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      status: res.status,
      error: res.ok ? undefined : (d.error?.message ?? text).slice(0, 160),
    }
  } catch (e) {
    return { content: '', ms: Date.now() - t0, prompt: 0, completion: 0, reasoning: 0, status: 0, error: String(e).slice(0, 120) }
  }
}

const cost = (model: string, c: Call) => {
  const [i, o] = PRICE[model] ?? [0, 0]
  return (c.prompt * i + c.completion * o) / 1e6
}

// ---------------------------------------------------------------------------
// 편제표 채점

function placements(s: School) {
  const fixed = new Set<string>()
  const choice = new Set<string>()
  for (const t of s.terms) {
    for (const f of t.fixed) {
      fixed.add(`${t.id}|${f.subject}`)
      if (f.alt) fixed.add(`${t.id}|${f.alt}`)
    }
    for (const g of t.groups) for (const o of g.options) choice.add(`${t.id}|${o}`)
  }
  for (const tr of s.tracks) for (const set of tr.sets) for (const it of set.items) choice.add(`${it.term}|${it.subject}`)
  return { fixed, choice }
}

function f1(gold: Set<string>, got: Set<string>) {
  let tp = 0
  for (const g of got) if (gold.has(g)) tp++
  const p = got.size ? tp / got.size : 0
  const r = gold.size ? tp / gold.size : 1
  return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0, missing: [...gold].filter((x) => !got.has(x)), extra: [...got].filter((x) => !gold.has(x)) }
}

const UNIT_SETS = [
  ['cau:소프트웨어학부'],
  ['cau:의학부', 'yonsei:의예과', 'korea:의과대학', 'snu:의예과'],
  ['korea:사이버국방학과', 'snu:컴퓨터공학부', 'yonsei:컴퓨터과학과'],
  ['yonsei:대기과학과', 'yonsei:생명과학부', 'cau:물리학과'],
  ['snu:인문계열 모집단위'],
  ['korea:전기전자공학부', 'yonsei:전기전자공학부'],
].map((ids) => ids.map((id) => UNIT_BY_ID.get(id) as Unit))

function planKey(s: School, units: Unit[]) {
  const p = makePlan(s, units)
  const taken = [...p.taken].filter(([, slot]) => slot.kind !== 'fixed').map(([sub, slot]) => `${sub}@${slot.term}`).sort()
  const ok = p.units.map((r) => `${r.unit.id}:${r.ok}`).sort()
  return JSON.stringify({ taken, ok })
}

function scoreSchool(gold: School, got: School) {
  const g = placements(gold)
  const x = placements(got)
  const fixed = f1(g.fixed, x.fixed)
  const choice = f1(g.choice, x.choice)
  const all = f1(new Set([...[...g.fixed].map((k) => `F|${k}`), ...[...g.choice].map((k) => `C|${k}`)]), new Set([...[...x.fixed].map((k) => `F|${k}`), ...[...x.choice].map((k) => `C|${k}`)]))
  let groupsExact = 0
  const goldGroups = gold.terms.flatMap((t) => t.groups.map((gr) => ({ term: t.id, gr })))
  for (const { term, gr } of goldGroups) {
    const cands = got.terms.find((t) => t.id === term)?.groups ?? []
    let best = 0
    let bestOk = false
    for (const c of cands) {
      const inter = c.options.filter((o) => gr.options.includes(o)).length
      const j = inter / new Set([...c.options, ...gr.options]).size
      if (j > best) {
        best = j
        bestOk = c.pick === gr.pick && c.credits === gr.credits
      }
    }
    if (best >= 0.9 && bestOk) groupsExact++
  }
  const credits = TERMS.filter((t) => termCredits(gold, t) === termCredits(got, t)).length / TERMS.length
  const planSame = UNIT_SETS.filter((units) => planKey(gold, units) === planKey(got, units)).length / UNIT_SETS.length
  return {
    allF1: all.f1,
    fixedF1: fixed.f1,
    choiceF1: choice.f1,
    groupsExact: groupsExact / goldGroups.length,
    credits,
    planSame,
    missing: all.missing.slice(0, 12),
    extra: all.extra.slice(0, 12),
  }
}

// ---------------------------------------------------------------------------
// 문장 검색 정답 (1순위로 맞으면 정답, also는 1순위로 나와도 봐줄 만한 답)
const GOLD: [string, string[], string[]][] = [
  ['해킹 대회 나가는 거 좋아해요', ['security'], ['cs']],
  ['게임 만드는 개발자가 되고 싶어', ['cs'], ['artTech']],
  ['아픈 사람 치료하는 의사', ['med'], []],
  ['반도체 회사 엔지니어', ['ee'], []],
  ['약국을 차리고 싶어요', ['pharm'], []],
  ['밤하늘 별 보는 게 좋아서 우주를 연구하고 싶어', ['earth'], ['physics']],
  ['멋진 건물을 설계하는 사람', ['arch'], []],
  ['로봇 만드는 거 좋아해요', ['mech'], ['ee', 'ai']],
  ['사람들 행동을 데이터로 분석하는 일', ['ai'], ['math']],
  ['환자를 돌보는 간호사', ['nursing'], []],
  ['변호사가 되고 싶어요', ['humanities'], []],
  ['전기차 배터리 소재를 연구하고 싶어', ['chemeng'], ['ee']],
  ['유전자를 연구해서 병을 고치고 싶어', ['bio'], ['med']],
  ['웹툰 플랫폼을 만들고 싶어요', ['cs'], ['artTech']],
  ['자율주행 자동차 개발', ['mech'], ['ai', 'ee', 'cs']],
  ['수학 문제 푸는 게 제일 재밌어', ['math'], []],
]

function parseMajors(text: string): string[] {
  try {
    const parsed = extractJson(text) as { majors?: { id?: unknown }[] }
    return (parsed.majors ?? []).map((m) => (typeof m?.id === 'string' ? m.id : '')).filter((id) => MAJOR_BY_ID.has(id))
  } catch {
    return []
  }
}

// 모델이름 또는 모델이름@effort
const configs = (process.env.BENCH_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const [model, effort] = s.split('@')
  return { model, effort }
})

describe.skipIf(!RUN)('게이트웨이 모델 실측', () => {
  it(
    'run',
    async () => {
      const env = readEnv()
      const part = process.env.BENCH_PART
      const budget = Number(process.env.BENCH_BUDGET ?? '0.6')
      let spent = 0
      const results: unknown[] = []

      if (part === 'import') {
        const images = JSON.parse(readFileSync(process.env.BENCH_IMAGES!, 'utf8')) as string[]
        for (const { model, effort } of configs) {
          if (spent > budget) {
            console.log(`budget reached, skip ${model}`)
            continue
          }
          const c = await call(env, model, effort, importSystem(2026), "첨부한 편제표 이미지를 옮겨 줘.", images, 32000)
          spent += cost(model, c)
          let score: ReturnType<typeof scoreSchool> | null = null
          let parseError = ''
          try {
            const school = schoolFromLoose(extractJson(c.content), { id: 'x', name: 'x', region: '', cohort: 2026 })
            score = scoreSchool(BANSONG_2026, school)
          } catch (e) {
            parseError = String(e).slice(0, 80)
          }
          const row = { model, effort: effort ?? '-', status: c.status, error: c.error, ms: c.ms, prompt: c.prompt, completion: c.completion, reasoning: c.reasoning, cost: cost(model, c), score, parseError }
          results.push(row)
          console.log(
            `${(model + (effort ? '@' + effort : '')).padEnd(30)} ${c.status} ${(c.ms / 1000).toFixed(1)}s in=${c.prompt} out=${c.completion}(r${c.reasoning}) $${cost(model, c).toFixed(4)} ` +
              (score
                ? `F1=${score.allF1.toFixed(3)} fixed=${score.fixedF1.toFixed(2)} choice=${score.choiceF1.toFixed(2)} groups=${score.groupsExact.toFixed(2)} credits=${score.credits.toFixed(2)} plan=${score.planSame.toFixed(2)}`
                : `FAIL ${c.error ?? parseError}`),
          )
        }
      }

      if (part === 'match') {
        for (const { model, effort } of configs) {
          let strict = 0
          let ok = 0
          let ms = 0
          let c$ = 0
          let fails = 0
          const wrong: string[] = []
          for (const [text, primary, also] of GOLD) {
            const c = await call(env, model, effort, MATCH_SYSTEM, text, [], 1000)
            ms += c.ms
            c$ += cost(model, c)
            const ids = parseMajors(c.content)
            if (!ids.length) fails++
            if (primary.includes(ids[0])) strict++
            if (primary.includes(ids[0]) || also.includes(ids[0])) ok++
            else wrong.push(`${text}→${ids.join('/') || '없음'}`)
          }
          spent += c$
          const row = { model, effort: effort ?? '-', strict: strict / GOLD.length, ok: ok / GOLD.length, avgMs: Math.round(ms / GOLD.length), cost: c$, fails, wrong }
          results.push(row)
          console.log(`${(model + (effort ? '@' + effort : '')).padEnd(30)} 정답 ${ok}/${GOLD.length} (엄격 ${strict}) 평균 ${(ms / GOLD.length / 1000).toFixed(1)}s 실패 ${fails} $${c$.toFixed(4)} 틀림: ${wrong.join(' | ')}`)
        }
      }

      console.log(`spent $${spent.toFixed(4)}`)
      if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(results, null, 1))
    },
    60 * 60 * 1000,
  )
})
