import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AiConfig, AiKind } from './ai-types'

// 관리자가 화면에서 넣는 AI 연결 (OpenAI 호환 주소, Claude API, Gemini API).
// 키는 AES-256-GCM으로 암호화해 저장하고, 화면에는 끝 4자리만 보여 준다.
// 암호화 비밀값: 환경변수 AI_KEY_SECRET, 없으면 데이터 폴더의 ai-key.secret (처음에 무작위로 만든다).

export const ANTHROPIC_URL = 'https://api.anthropic.com'
/** Gemini API의 OpenAI 호환 주소 (ai.google.dev/gemini-api/docs/openai) */
export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

export interface AiProvider {
  id: number
  name: string
  kind: AiKind
  baseUrl: string
  model: string
  visionModel: string
  maxTokensParam: 'max_tokens' | 'max_completion_tokens'
  jsonMode: boolean
  textEffort: string
  visionEffort: string
  /** 키 끝 4자리 */
  keyHint: string
  /** 저장된 키를 지금 비밀값으로 풀 수 있는지 (비밀값이 바뀌면 키를 다시 넣어야 한다) */
  keyOk: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface ProviderInput {
  name: string
  kind: AiKind
  baseUrl: string
  model: string
  visionModel: string
  maxTokensParam: 'max_tokens' | 'max_completion_tokens'
  jsonMode: boolean
  textEffort: string
  visionEffort: string
  /** 새로 넣는 키 (고칠 때 비우면 그대로 둔다) */
  apiKey: string
}

export class ProviderError extends Error {}

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
/** Gemini 3 이후 모델이 받는 reasoning_effort (생각을 끄는 none은 2.5 Flash만 받아서 뺀다) */
const GEMINI_EFFORTS = ['minimal', 'low', 'medium', 'high']

const text = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        .replace(/[\p{Cc}\p{Cf}]/gu, '')
        .trim()
        .slice(0, max)
    : ''

/** 화면에서 받은 값을 검사해 정리한다. 키는 새로 만들 때만 꼭 있어야 한다 */
export function cleanProvider(raw: unknown, { requireKey }: { requireKey: boolean }): ProviderInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (o.kind !== 'anthropic' && o.kind !== 'openai' && o.kind !== 'google') throw new ProviderError('연결 종류를 골라 주세요.')
  const kind: AiKind = o.kind
  const name = text(o.name, 40)
  if (!name) throw new ProviderError('이름을 적어 주세요.')
  let baseUrl = text(o.baseUrl, 300).replace(/\/+$/, '')
  // Claude SDK는 주소 뒤에 /v1/messages를, 나머지는 /chat/completions를 붙인다
  if (kind === 'anthropic') baseUrl = baseUrl.replace(/\/v1$/, '') || ANTHROPIC_URL
  else baseUrl = baseUrl.replace(/\/chat\/completions$/, '') || (kind === 'google' ? GEMINI_URL : '')
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(baseUrl)) throw new ProviderError('주소는 https://로 시작하게 적어 주세요.')
  if (baseUrl.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(baseUrl))
    throw new ProviderError('키가 그대로 오가지 않게 https 주소만 받아요 (내 컴퓨터 주소만 http 허용).')
  const model = text(o.model, 100)
  if (!/^[\w.:/@-]{1,100}$/.test(model)) throw new ProviderError('모델 이름이 맞지 않아요.')
  const visionModel = text(o.visionModel, 100)
  if (visionModel && !/^[\w.:/@-]{1,100}$/.test(visionModel)) throw new ProviderError('이미지 읽기 모델 이름이 맞지 않아요.')
  const listed = kind === 'anthropic' ? CLAUDE_EFFORTS : kind === 'google' ? GEMINI_EFFORTS : null
  const effortOf = (v: unknown, label: string) => {
    const t = text(v, 20)
    if (!t) return ''
    if (listed ? !listed.includes(t) : !/^[a-z]{2,10}$/.test(t))
      throw new ProviderError(`${label} 값이 맞지 않아요.${listed ? ` (${listed.join(', ')} 중 하나)` : ''}`)
    return t
  }
  const apiKey = typeof o.apiKey === 'string' ? o.apiKey.trim() : ''
  if (apiKey && (apiKey.length < 8 || apiKey.length > 400 || /[\s\p{Cc}]/u.test(apiKey))) throw new ProviderError('키 형식이 맞지 않아요.')
  if (requireKey && !apiKey) throw new ProviderError('API 키를 넣어 주세요.')
  return {
    name,
    kind,
    baseUrl,
    model,
    visionModel,
    maxTokensParam: kind === 'openai' && o.maxTokensParam === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
    jsonMode: kind === 'openai' && o.jsonMode === true,
    textEffort: effortOf(o.textEffort, '글 읽기 추론 강도'),
    visionEffort: effortOf(o.visionEffort, '이미지 읽기 추론 강도'),
    apiKey,
  }
}

/** 키 암호화 비밀값 (32바이트) */
export function keySecret(env: Record<string, string | undefined>, dataDir?: string): Buffer {
  const fromEnv = env.AI_KEY_SECRET?.trim()
  if (fromEnv && fromEnv.length >= 16) return createHash('sha256').update(fromEnv).digest()
  if (!dataDir) return randomBytes(32)
  const file = join(dataDir, 'ai-key.secret')
  if (existsSync(file)) {
    const hex = readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex')
  }
  mkdirSync(dataDir, { recursive: true })
  const key = randomBytes(32)
  writeFileSync(file, `${key.toString('hex')}\n`, { mode: 0o600 })
  return key
}

interface Row {
  id: number
  name: string
  kind: string
  base_url: string
  model: string
  vision_model: string
  options: string
  key_enc: string
  key_hint: string
  active: number
  created_at: string
  updated_at: string
}

export class AiProviders {
  private db: DatabaseSync
  private secret: Buffer

  constructor(db: DatabaseSync, secret: Buffer) {
    this.db = db
    this.secret = secret
    db.exec(`create table if not exists ai_providers (
      id integer primary key,
      name text not null,
      kind text not null,
      base_url text not null,
      model text not null,
      vision_model text not null default '',
      options text not null default '{}',
      key_enc text not null,
      key_hint text not null,
      active integer not null default 0,
      created_at text not null,
      updated_at text not null
    )`)
  }

  private encrypt(plain: string): string {
    return sealKey(this.secret, plain)
  }

  private decrypt(stored: string): string | null {
    return openKey(this.secret, stored)
  }

  private toProvider(r: Row): AiProvider {
    let opt: Record<string, unknown> = {}
    try {
      opt = JSON.parse(r.options) as Record<string, unknown>
    } catch {
      opt = {}
    }
    return {
      id: r.id,
      name: r.name,
      kind: r.kind === 'anthropic' || r.kind === 'google' ? r.kind : 'openai',
      baseUrl: r.base_url,
      model: r.model,
      visionModel: r.vision_model,
      maxTokensParam: opt.maxTokensParam === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
      jsonMode: opt.jsonMode === true,
      textEffort: typeof opt.textEffort === 'string' ? opt.textEffort : '',
      visionEffort: typeof opt.visionEffort === 'string' ? opt.visionEffort : '',
      keyHint: r.key_hint,
      keyOk: this.decrypt(r.key_enc) !== null,
      active: r.active === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }

  private row(id: number): Row | undefined {
    return this.db.prepare('select * from ai_providers where id = ?').get(id) as Row | undefined
  }

  list(): AiProvider[] {
    return (this.db.prepare('select * from ai_providers order by id').all() as unknown as Row[]).map((r) => this.toProvider(r))
  }

  byId(id: number): AiProvider | null {
    const r = this.row(id)
    return r ? this.toProvider(r) : null
  }

  private options(input: ProviderInput): string {
    return JSON.stringify({
      maxTokensParam: input.maxTokensParam,
      jsonMode: input.jsonMode,
      textEffort: input.textEffort,
      visionEffort: input.visionEffort,
    })
  }

  create(input: ProviderInput): AiProvider {
    if (!input.apiKey) throw new ProviderError('API 키를 넣어 주세요.')
    if ((this.db.prepare('select count(*) as n from ai_providers').get() as { n: number }).n >= 20) throw new ProviderError('연결은 20개까지 넣을 수 있어요.')
    const at = new Date().toISOString()
    const r = this.db
      .prepare(
        'insert into ai_providers (name, kind, base_url, model, vision_model, options, key_enc, key_hint, active, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
      )
      .run(input.name, input.kind, input.baseUrl, input.model, input.visionModel, this.options(input), this.encrypt(input.apiKey), hint(input.apiKey), at, at)
    return this.byId(Number(r.lastInsertRowid))!
  }

  update(id: number, input: ProviderInput): AiProvider {
    const old = this.row(id)
    if (!old) throw new ProviderError('연결을 찾지 못했어요.')
    // 저장된 키를 다른 서버로 보내게 바꾸지 못하게 한다 (관리자 세션을 뺏겨도 키는 못 빼 간다)
    if (!input.apiKey && (input.baseUrl !== old.base_url || input.kind !== old.kind)) throw new ProviderError('주소나 종류를 바꾸면 키를 다시 넣어 주세요.')
    const at = new Date().toISOString()
    this.db
      .prepare('update ai_providers set name = ?, kind = ?, base_url = ?, model = ?, vision_model = ?, options = ?, updated_at = ? where id = ?')
      .run(input.name, input.kind, input.baseUrl, input.model, input.visionModel, this.options(input), at, id)
    if (input.apiKey) this.db.prepare('update ai_providers set key_enc = ?, key_hint = ? where id = ?').run(this.encrypt(input.apiKey), hint(input.apiKey), id)
    return this.byId(id)!
  }

  remove(id: number): boolean {
    return Number(this.db.prepare('delete from ai_providers where id = ?').run(id).changes) > 0
  }

  /** 이 연결을 쓴다 (null이면 환경변수 설정으로 돌아간다) */
  select(id: number | null): void {
    if (id !== null && !this.row(id)) throw new ProviderError('연결을 찾지 못했어요.')
    this.db.exec('update ai_providers set active = 0 where active = 1')
    if (id !== null) this.db.prepare('update ai_providers set active = 1 where id = ?').run(id)
  }

  active(): AiProvider | null {
    const r = this.db.prepare('select * from ai_providers where active = 1 limit 1').get() as Row | undefined
    return r ? this.toProvider(r) : null
  }

  /** 호출에 쓸 설정 (키를 푼다). 고른 연결이 없으면 undefined, 골랐는데 키를 풀 수 없으면 null */
  config(id?: number): AiConfig | null | undefined {
    const r = id === undefined ? (this.db.prepare('select * from ai_providers where active = 1 limit 1').get() as Row | undefined) : this.row(id)
    if (!r) return id === undefined ? undefined : null
    const apiKey = this.decrypt(r.key_enc)
    if (!apiKey) return null
    const p = this.toProvider(r)
    return {
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey,
      model: p.model,
      visionModel: p.visionModel || p.model,
      maxTokensParam: p.maxTokensParam,
      jsonMode: p.jsonMode,
      textEffort: p.textEffort || undefined,
      visionEffort: p.visionEffort || undefined,
    }
  }
}

/** 키 끝 4자리 (짧은 키는 보이지 않게) */
export function keyHint(key: string): string {
  return key.length >= 12 ? `…${key.slice(-4)}` : '…'
}
const hint = keyHint

/** 키를 AES-256-GCM으로 감싼다 ("v1:" + base64(iv·태그·본문)) */
export function sealKey(secret: Buffer, plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', secret, iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`
}

/** 감싼 키를 푼다 (비밀값이 다르거나 망가졌으면 null) */
export function openKey(secret: Buffer, stored: string): string | null {
  if (!stored.startsWith('v1:')) return null
  try {
    const raw = Buffer.from(stored.slice(3), 'base64')
    const d = createDecipheriv('aes-256-gcm', secret, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
