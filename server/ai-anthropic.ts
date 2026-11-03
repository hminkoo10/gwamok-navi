import Anthropic from '@anthropic-ai/sdk'
import { type AiConfig, AiError, type ChatRequest } from './ai-types'

// Claude Messages API (공식 SDK). 관리자가 'Claude' 연결을 골랐을 때만 쓴다.
// 편제표 옮기기처럼 답이 긴 요청이 있어 스트리밍으로 받고 마지막 메시지만 쓴다.

/** 최신 Claude 모델은 생각에도 출력 토큰을 써서, 짧은 요청도 이만큼은 둔다 (쓴 만큼만 과금된다) */
const MIN_OUTPUT_TOKENS = 4096

const IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type MediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

function imageBlock(url: string): Anthropic.ImageBlockParam {
  const m = IMAGE.exec(url)
  if (!m) throw new AiError(400, '이미지 형식이 맞지 않아요.', 'image')
  return { type: 'image', source: { type: 'base64', media_type: m[1] as MediaType, data: m[2] } }
}

/** SDK 오류를 앱 오류로. 사용자에게는 짧은 문장만, 관리자 시험에는 상태·종류만 */
function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e
  if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) return new AiError(504, 'AI 응답이 너무 늦어요.', 'timeout')
  if (e instanceof Anthropic.APIConnectionError) return new AiError(502, 'AI 서버에 연결하지 못했어요.', 'connection')
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { type?: unknown } } | undefined
    const type = typeof body?.error?.type === 'string' && /^[\w.-]{1,40}$/.test(body.error.type) ? ` ${body.error.type}` : ''
    const detail = `HTTP ${e.status ?? '?'}${type}`
    // 429 사용량 초과, 529 서버 과부하
    if (e.status === 429 || e.status === 529) return new AiError(429, 'AI 사용량이 몰려 있어요. 잠시 후 다시 해 주세요.', detail)
    return new AiError(502, 'AI 서버가 오류를 냈어요.', detail)
  }
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) return new AiError(504, 'AI 응답이 너무 늦어요.', 'timeout')
  return new AiError(502, 'AI 서버에 연결하지 못했어요.', 'unknown')
}

export async function chatAnthropic(cfg: AiConfig, req: ChatRequest, fetchImpl?: typeof fetch): Promise<string> {
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    // 비우면 SDK 기본 주소(api.anthropic.com)
    ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
    timeout: req.timeoutMs,
    maxRetries: 1,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
  const heavy = !!(req.images?.length || req.heavy)
  const images = (req.images ?? []).map(imageBlock)
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: images.length ? [...images, { type: 'text', text: req.user }] : req.user },
    ...(req.followUp
      ? ([
          { role: 'assistant', content: req.followUp.answer },
          { role: 'user', content: req.followUp.text },
        ] satisfies Anthropic.MessageParam[])
      : []),
  ]
  const effort = heavy ? cfg.visionEffort : cfg.textEffort
  try {
    const stream = client.messages.stream(
      {
        model: heavy ? cfg.visionModel : cfg.model,
        max_tokens: Math.max(req.maxTokens, MIN_OUTPUT_TOKENS),
        system: req.system,
        messages,
        ...(effort && EFFORTS.has(effort) ? { output_config: { effort: effort as Effort } } : {}),
      },
      { signal: AbortSignal.timeout(req.timeoutMs) },
    )
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new AiError(502, 'AI가 이 요청에 답하지 않았어요.', 'refusal')
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text) throw new AiError(502, 'AI 응답을 읽지 못했어요.', message.stop_reason === 'max_tokens' ? 'max_tokens' : 'no text')
    return text
  } catch (e) {
    throw toAiError(e)
  }
}
