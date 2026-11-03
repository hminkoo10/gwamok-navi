// AI 호출. 연결 세 가지:
// - openai: OpenAI 호환 Chat Completions 주소 (환경변수 AI_BASE_URL·AI_API_KEY·AI_MODEL, 또는 관리자가 넣은 연결)
// - anthropic: Claude Messages API (관리자가 넣은 연결, 공식 SDK: ai-anthropic.ts)
// - google: Gemini API (관리자가 넣은 Google AI Studio 키). Google 공식 OpenAI 호환 주소로 부른다
// 키는 서버에서만 쓰고 응답·기록에 절대 담지 않는다.

import { chatAnthropic } from './ai-anthropic'
import { type AiConfig, AiError, type ChatRequest } from './ai-types'

export { type AiConfig, AiError, type AiKind, type ChatRequest } from './ai-types'

const effort = (v: string | undefined) => {
  const t = v?.trim()
  return t && /^[a-z]{2,10}$/.test(t) ? t : undefined
}

/** 환경변수 연결 (관리자가 연결을 고르지 않았을 때) */
export function aiConfig(env: Record<string, string | undefined> = process.env): AiConfig | null {
  const baseUrl = env.AI_BASE_URL?.trim().replace(/\/+$/, '')
  const apiKey = env.AI_API_KEY?.trim()
  const model = env.AI_MODEL?.trim()
  if (!baseUrl || !apiKey || !model) return null
  if (!/^https?:\/\//.test(baseUrl)) return null
  return {
    kind: 'openai',
    name: '환경변수 설정',
    baseUrl,
    apiKey,
    model,
    visionModel: env.AI_VISION_MODEL?.trim() || model,
    maxTokensParam: env.AI_MAX_TOKENS_PARAM === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
    jsonMode: env.AI_JSON_MODE === '1',
    textEffort: effort(env.AI_REASONING_EFFORT),
    visionEffort: effort(env.AI_VISION_REASONING_EFFORT),
  }
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

/** Gemini는 생각에도 출력 토큰을 쓰므로(max_tokens = 생각 + 답) 짧은 요청도 최소 4096. 한 번에 받는 상한은 65,536 */
const GEMINI_MIN_TOKENS = 4096
const GEMINI_MAX_TOKENS = 65_536

type ErrorBody = { error?: { type?: unknown; code?: unknown; status?: unknown; message?: unknown } | string }

/** 공급자 오류 본문에서 짧은 오류 종류만 꺼낸다 (본문 전체에는 계정 정보가 섞일 수 있음) */
async function errorKind(res: Response): Promise<string> {
  const raw = (await res.json().catch(() => null)) as ErrorBody | ErrorBody[] | null
  // Gemini는 [{ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }]처럼 배열로 줄 때가 있다
  const e = (Array.isArray(raw) ? raw[0] : raw)?.error
  // 맞지 않는 키: Gemini는 400 INVALID_ARGUMENT에 'Please pass a valid API key'만 줌 (사용자 키 안내에 씀)
  if (typeof e === 'object' && e && typeof e.message === 'string' && /api key/i.test(e.message)) return 'API_KEY_INVALID'
  const kind = typeof e === 'object' && e ? ([e.code, e.status, e.type].find((v): v is string => typeof v === 'string') ?? '') : ''
  return /^[\w.-]{1,40}$/.test(kind) ? kind : ''
}

export async function chat(cfg: AiConfig, req: ChatRequest, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cfg.kind === 'anthropic') return chatAnthropic(cfg, req, fetchImpl)
  const maxTokens = cfg.kind === 'google' ? Math.min(Math.max(req.maxTokens, GEMINI_MIN_TOKENS), GEMINI_MAX_TOKENS) : req.maxTokens
  const content: string | Part[] = req.images?.length
    ? [{ type: 'text', text: req.user }, ...req.images.map((url): Part => ({ type: 'image_url', image_url: { url } }))]
    : req.user
  const body: Record<string, unknown> = {
    model: req.images?.length || req.heavy ? cfg.visionModel : cfg.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content },
      ...(req.followUp
        ? [
            { role: 'assistant', content: req.followUp.answer },
            { role: 'user', content: req.followUp.text },
          ]
        : []),
    ],
    [cfg.maxTokensParam]: maxTokens,
  }
  if (cfg.jsonMode) body.response_format = { type: 'json_object' }
  const level = req.images?.length || req.heavy ? cfg.visionEffort : cfg.textEffort
  if (level) body.reasoning_effort = level

  let res: Response
  try {
    res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs),
    })
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new AiError(timedOut ? 504 : 502, timedOut ? 'AI 응답이 너무 늦어요.' : 'AI 서버에 연결하지 못했어요.', timedOut ? 'timeout' : 'connection')
  }
  if (!res.ok) {
    // 오류 본문은 그대로 돌려주지 않는다 (계정 정보가 섞일 수 있음)
    const kind = await errorKind(res)
    const detail = `HTTP ${res.status}${kind ? ` ${kind}` : ''}`
    if (res.status === 429) throw new AiError(429, 'AI 사용량이 몰려 있어요. 잠시 후 다시 해 주세요.', detail)
    // 503: 모델에 요청이 몰림 (Gemini 새 모델에서 잦고 보통 잠깐)
    if (res.status === 503) throw new AiError(503, 'AI 서버에 요청이 몰려 있어요. 잠시 후 다시 해 주세요.', detail)
    throw new AiError(502, 'AI 서버가 오류를 냈어요.', detail)
  }
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null
  const raw = data?.choices?.[0]?.message?.content
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw.map((p) => (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string' ? p.text : '')).join('')
  throw new AiError(502, 'AI 응답을 읽지 못했어요.', 'no content')
}

/** 모델 답에서 JSON 객체 하나를 꺼낸다 (코드 블록·앞뒤 설명 허용) */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new AiError(502, 'AI 응답에 결과가 없어요.')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new AiError(502, 'AI 응답 형식이 맞지 않아요.')
  }
}
