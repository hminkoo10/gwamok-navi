import { LruCache } from './limits'
import { FetchBlocked, safeFetch } from './safe-fetch'

// 학교 홈페이지의 robots.txt를 지킨다 (관리 설정 'robots.txt 지키기'를 켰을 때만. 기본은 끔).
// 편제표는 학교가 학생·학부모에게 알리려고 올린 공개 자료라, 끄면 막힌 곳까지 찾되 한 학교에 한꺼번에 3개까지만 요청한다.
// - 우리 이름(GwamokNavi) 또는 *에 걸린 Allow/Disallow를 가장 긴 규칙 기준으로 따른다 (구글 방식).
// - AI 봇(ClaudeBot, GPTBot 등)을 통째로 막은 사이트는 "AI로 처리하지 말라"는 뜻으로 보고 아예 읽지 않는다.
//   우리 서버도 받은 파일을 AI에 넘기기 때문이다.

export const OUR_AGENT = 'gwamoknavi'
const AI_AGENTS = new Set([
  'claudebot',
  'claude-web',
  'claude-user',
  'claude-searchbot',
  'anthropic-ai',
  'gptbot',
  'chatgpt-user',
  'oai-searchbot',
  'ccbot',
  'google-extended',
  'perplexitybot',
  'bytespider',
])

export interface RobotsGroup {
  agents: string[]
  allow: string[]
  disallow: string[]
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/).slice(0, 5000)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === 'allow' && value) current.allow.push(value)
    else if (key === 'disallow' && value) current.disallow.push(value)
  }
  return groups
}

/**
 * robots 규칙 하나가 경로에 맞는지 (* 와 끝의 $ 지원).
 * 정규식(* → .*)으로 바꾸면 '*'가 많을 때 되돌아가며 터지므로(12개에 4초) 글자를 앞으로만 맞춰 본다.
 * $ 없으면 규칙이 경로의 앞부분과 맞으면 되고, $ 있으면 끝까지 맞아야 한다.
 */
function matches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$')
  const pat = (anchored ? rule.slice(0, -1) : rule).replace(/\*+/g, '*')
  const m = pat.length
  const n = path.length
  let p = 0
  let i = 0
  let star = -1
  let mark = 0
  while (i < n) {
    if (p < m && pat[p] === '*') {
      star = p++ // '*'는 우선 빈 글자로 두고, 안 맞으면 한 글자씩 먹인다
      mark = i
    } else if (p < m && pat[p] === path[i]) {
      p++
      i++
    } else if (star >= 0) {
      p = star + 1
      i = ++mark
    } else return false
    if (!anchored && p === m) return true // 규칙을 끝까지 맞췄으면 경로 앞부분과 맞은 것
  }
  while (p < m && pat[p] === '*') p++
  return p === m
}

export type Verdict = 'allow' | 'disallow' | 'no-ai'

export function verdict(groups: RobotsGroup[], path: string): Verdict {
  const blocksAll = (g: RobotsGroup) => g.disallow.some((d) => d === '/' || d === '/*')
  if (groups.some((g) => g.agents.some((a) => AI_AGENTS.has(a)) && blocksAll(g))) return 'no-ai'
  const ours = groups.filter((g) => g.agents.some((a) => a.includes(OUR_AGENT)))
  const rules = ours.length ? ours : groups.filter((g) => g.agents.includes('*'))
  let best: { len: number; allow: boolean } | null = null
  for (const g of rules) {
    for (const a of g.allow) if (matches(a, path) && (!best || a.length >= best.len)) best = { len: a.length, allow: true }
    for (const d of g.disallow) if (matches(d, path) && (!best || d.length > best.len)) best = { len: d.length, allow: false }
  }
  return !best || best.allow ? 'allow' : 'disallow'
}

const cache = new LruCache<RobotsGroup[]>(2000, 6 * 3600_000)

async function rulesFor(origin: string): Promise<RobotsGroup[]> {
  const hit = cache.get(origin)
  if (hit) return hit
  let groups: RobotsGroup[] = []
  try {
    const res = await safeFetch(`${origin}/robots.txt`, {
      allow: (u) => u.origin === origin || u.hostname.replace(/^www\./, '') === new URL(origin).hostname.replace(/^www\./, ''),
      maxBytes: 300_000,
      timeoutMs: 6_000,
      accept: 'text/plain,*/*',
    })
    // 서버 오류면 잠시 전부 막힌 것으로 본다 (구글 방식). 없으면(4xx) 제한 없음.
    if (res.status >= 500) groups = [{ agents: ['*'], allow: [], disallow: ['/'] }]
    else if (res.status < 400 && !/<html/i.test(res.body.subarray(0, 512).toString('latin1'))) groups = parseRobots(res.body.toString('utf8'))
  } catch {
    groups = []
  }
  cache.set(origin, groups)
  return groups
}

/** 이 주소를 읽어도 되는지. 막혀 있으면 이유와 함께 FetchBlocked */
export async function checkRobots(url: string): Promise<void> {
  const u = new URL(url)
  const v = verdict(await rulesFor(u.origin), u.pathname + u.search)
  if (v === 'no-ai') throw new FetchBlocked('이 학교 홈페이지는 AI 처리를 허용하지 않아요.')
  if (v === 'disallow') throw new FetchBlocked('이 학교 홈페이지는 자동 접근을 허용하지 않아요.')
}
