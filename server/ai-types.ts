// AI 호출에 함께 쓰는 형식과 오류 (ai.ts·ai-anthropic.ts가 서로를 불러오지 않게 따로 둔다)

/** openai: OpenAI 호환 주소, anthropic: Claude API, google: Gemini API (Google AI Studio 키, OpenAI 호환 주소로 부른다) */
export type AiKind = 'openai' | 'anthropic' | 'google'

export interface AiConfig {
  kind: AiKind
  /** 화면·기록에 보이는 연결 이름 (키는 담지 않는다) */
  name: string
  baseUrl: string
  apiKey: string
  model: string
  visionModel: string
  /** 일부 모델은 max_tokens 대신 max_completion_tokens만 받는다 (openai만) */
  maxTokensParam: 'max_tokens' | 'max_completion_tokens'
  /** response_format json_object (openai만) */
  jsonMode: boolean
  /** 추론 강도. openai·google은 reasoning_effort, anthropic은 output_config.effort로 보낸다. 기능별로 따로 둔다 */
  textEffort?: string
  visionEffort?: string
}

export class AiError extends Error {
  readonly status: number
  /** 관리자 연결 시험에만 보여 주는 짧은 원인 (HTTP 상태·오류 종류. 키나 계정 정보는 넣지 않는다) */
  readonly detail: string

  constructor(status: number, message: string, detail = '') {
    super(message)
    this.status = status
    this.detail = detail
  }
}

export interface ChatRequest {
  system: string
  user: string
  /** data: URL 이미지 */
  images?: string[]
  /** 그림이 없어도 표 옮기기처럼 어려운 일은 비전 모델(더 강한 모델)로 보낸다 */
  heavy?: boolean
  maxTokens: number
  timeoutMs: number
  /** 앞선 답과 그 답에 대한 지적. 같은 대화로 이어서 다시 묻는다 */
  followUp?: { answer: string; text: string }
}
