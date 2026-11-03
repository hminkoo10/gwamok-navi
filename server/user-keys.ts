import type { DatabaseSync } from 'node:sqlite'
import { GEMINI_URL, keyHint, openKey, sealKey } from './ai-providers'
import { type AiConfig, AiError } from './ai-types'

// 사용자가 내 계정에 등록한 Google AI Studio(Gemini) API 키.
// 관리자 설정 '사용자 키로 AI 쓰기'가 켜지면 편제표 자동 읽기·파일 읽기·문장으로 찾기에 서버 AI 대신 이 키를 쓴다.
// 관리자 AI 연결과 같은 비밀값으로 AES-256-GCM 암호화해 저장하고, 화면에는 끝 4자리만 보여 준다.

/** 사용자 키의 기본 모델. 관리자 설정에서 바꿈 (Google AI Studio 무료 등급 모델) */
export const USER_AI_MODEL = 'gemini-3.6-flash'
export const MODEL_RE = /^[\w.:/@-]{1,60}$/

export interface UserKeyInfo {
  /** 키 끝 4자리 */
  hint: string
  addedAt: string
  /** 지금 비밀값으로 풀 수 있는지 (서버 비밀값이 바뀌면 다시 등록해야 함) */
  ok: boolean
}

/** 키 모양만 검사. 맞는 키인지는 등록할 때 Google에 짧게 물어 확인 */
export function cleanUserKey(raw: unknown): string | null {
  const key = typeof raw === 'string' ? raw.trim() : ''
  return /^[A-Za-z0-9._~+/=-]{20,200}$/.test(key) ? key : null
}

/** 사용자 키용 Gemini 연결. 문장으로 찾기는 생각을 줄이고(low), 표 옮기기는 모델 기본값으로 꼼꼼히 */
export function userGeminiConfig(apiKey: string, model: string): AiConfig {
  const m = MODEL_RE.test(model) ? model : USER_AI_MODEL
  return {
    kind: 'google',
    name: '내 Gemini API 키',
    baseUrl: GEMINI_URL,
    apiKey,
    model: m,
    visionModel: m,
    maxTokensParam: 'max_tokens',
    jsonMode: false,
    textEffort: 'low',
  }
}

/**
 * 사용자 키 호출 오류를 그 사람이 할 일이 보이는 말로 바꾼다 (키·계정 정보는 담지 않음).
 * 무료 등급 한도(429), 맞지 않거나 막힌 키(400 잘못된 키·401·403), 관리자가 정한 모델 없음(404)
 */
export function ownKeyError(e: AiError): AiError {
  const code = Number(/^HTTP (\d{3})/.exec(e.detail)?.[1] ?? 0)
  if (e.status === 429 || code === 429)
    return new AiError(429, '내 Gemini API 키의 사용 한도에 걸렸어요. 1분쯤 뒤에 다시 해 보고, 계속 안 되면 오늘 무료 한도를 다 쓴 거예요.', e.detail)
  if (code === 401 || code === 403 || /API_KEY/.test(e.detail))
    return new AiError(400, '등록한 Gemini API 키로 AI를 부르지 못했어요. 키를 지웠거나 막혔을 수 있어요. 내 계정에서 키를 다시 등록해 주세요.', e.detail)
  if (code === 404) return new AiError(502, '관리자가 정한 Gemini 모델을 지금 쓸 수 없어요. 관리자에게 알려 주세요.', e.detail)
  return e
}

export class UserAiKeys {
  private db: DatabaseSync
  private secret: Buffer

  constructor(db: DatabaseSync, secret: Buffer) {
    this.db = db
    this.secret = secret
    db.exec(`create table if not exists user_ai_keys (
      user_id integer primary key,
      key_enc text not null,
      key_hint text not null,
      created_at text not null
    )`)
  }

  private row(userId: number) {
    return this.db.prepare('select key_enc, key_hint, created_at from user_ai_keys where user_id = ?').get(userId) as
      { key_enc: string; key_hint: string; created_at: string } | undefined
  }

  info(userId: number): UserKeyInfo | null {
    const r = this.row(userId)
    return r ? { hint: r.key_hint, addedAt: r.created_at, ok: openKey(this.secret, r.key_enc) !== null } : null
  }

  /** 호출용 키. 없거나 못 풀면 null */
  key(userId: number): string | null {
    const r = this.row(userId)
    return r ? openKey(this.secret, r.key_enc) : null
  }

  /** 키를 확인하는 사이 계정이 지워졌으면 저장하지 않고 null (주인 없는 키가 다음 가입자에게 가지 않게) */
  save(userId: number, apiKey: string): UserKeyInfo | null {
    const at = new Date().toISOString()
    const res = this.db
      .prepare(
        'insert into user_ai_keys (user_id, key_enc, key_hint, created_at) select ?, ?, ?, ? where exists (select 1 from users where id = ?) on conflict(user_id) do update set key_enc = excluded.key_enc, key_hint = excluded.key_hint, created_at = excluded.created_at',
      )
      .run(userId, sealKey(this.secret, apiKey), keyHint(apiKey), at, userId)
    return Number(res.changes) > 0 ? this.info(userId) : null
  }

  remove(userId: number): boolean {
    return Number(this.db.prepare('delete from user_ai_keys where user_id = ?').run(userId).changes) > 0
  }

  /** 등록한 사람 수 (관리 화면) */
  count(): number {
    return (this.db.prepare('select count(*) n from user_ai_keys').get() as { n: number }).n
  }
}
