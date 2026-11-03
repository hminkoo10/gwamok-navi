import admissions2028 from '../src/data/admissions2028.json'
import adiga2028 from '../src/data/adiga2028.json'
import { dirname } from 'node:path'
import { Accounts, AccountError, isAdmin, type User } from './accounts'
import { type AiConfig, aiConfig } from './ai'
import { AiProviders, keySecret } from './ai-providers'
import { UserAiKeys } from './user-keys'
import { Datasets } from './datasets'
import { HttpError } from './limits'
import { renderPdfPages } from './pdf-render'
import { downloadPlan, readPlanDoc } from './plan-files'
import { PlanImporter } from './plan-import'
import { PlanUpdater, type UpdateDeps } from './plan-update'
import { PlanVerifier } from './plan-verify'
import { SettingsStore } from './settings'
import { Store } from './store'
import { publicFetch } from './public-fetch'
import { withRelay } from './relay'
import { SourceWatch, type WatchSource } from './watch'

// 요청마다 넘기는 저장소·서비스 묶음과 로그인 확인.
// servicesFor가 원문 감시·갱신·전형 가져오기·검수를 서로 잇는다.

export interface ApiContext {
  ip: string
  env: Record<string, string | undefined>
  /** HTTPS 요청인지 (쿠키에 Secure를 붙일지) */
  secure?: boolean
}

export interface Services {
  store: Store
  accounts: Accounts
  settings: SettingsStore
  datasets: Datasets
  watch: SourceWatch
  updater: PlanUpdater
  /** 전형 자료가 없는 대학의 시행계획을 받아 AI로 옮긴다 */
  importer: PlanImporter
  /** AI가 옮긴 전형을 더 좋은 AI로 원문과 대조해 고친다 */
  verifier: PlanVerifier
  /** 관리자가 넣은 AI 연결 */
  ai: AiProviders
  /** 사용자가 등록한 Gemini API 키 (관리자가 '사용자 키로 AI 쓰기'를 켰을 때) */
  userKeys: UserAiKeys
}

export interface Call {
  req: Request
  url: URL
  ctx: ApiContext
  services: Services
  user: User | null
  /** 로그인 세션 토큰 (쿠키) */
  token: string | null
}

export type Route = (call: Call) => Promise<Response> | Response

/** 감시할 공식 원문: 대학별 전형계획 파일, 대교협 권장과목 자료집 */
export function officialSources(): WatchSource[] {
  const seen = new Set<string>()
  const list: WatchSource[] = []
  for (const p of admissions2028.plans) {
    const url = p.watch ?? p.url
    if (!url || seen.has(url)) continue
    seen.add(url)
    list.push({ key: `plan-${p.univ}`, univ: p.univ, title: p.planTitle, url })
  }
  list.push({ key: 'adiga-recommended', univ: '', title: adiga2028.source.title, url: adiga2028.source.url })
  return list
}

export function servicesFor(
  store: Store,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
  updateDeps?: Partial<UpdateDeps>,
): Services {
  const settings = new SettingsStore(store.db, env)
  const secret = keySecret(env, store.path === ':memory:' ? undefined : dirname(store.path))
  const ai = new AiProviders(store.db, secret)
  const userKeys = new UserAiKeys(store.db, secret)
  const datasets = new Datasets(store.db, admissions2028)
  // 원문 감시는 관리자가 더한 주소도 받으므로 운영에서는 공개 주소로만 잇는 fetch (시험은 넣어 준 가짜 fetch 그대로).
  // 해외 접속을 막는 한국 사이트(예: 조선대)는 한국 중계(KR_RELAY)로 다시 받는다
  const watch = new SourceWatch(store.db, officialSources(), withRelay(fetchImpl === globalThis.fetch ? publicFetch : fetchImpl))
  const updater = new PlanUpdater(store.db, datasets, {
    download: downloadPlan,
    read: readPlanDoc,
    render: renderPdfPages,
    ai: () => resolveAi(ai, env),
    // 하루 한도는 AI를 부르기 바로 앞에서 센다 (한 번 감시에 여러 곳이 바뀌어도, AI가 답하지 못해도 넘지 않게)
    limit: () => settings.get().dailyDataLimit,
    ...updateDeps,
  })
  // 대학 원문이 바뀌면 AI로 바뀐 곳을 찾는다 (설정에서 껐거나 하루 한도를 넘으면 관리자 알림만).
  // 여기서 한도를 먼저 보는 건 원문을 괜히 받지 않으려는 것, 한도는 updater가 지킨다
  watch.onChange = (source) => {
    if (!source.key.startsWith('plan-') || !source.univ) return
    const s = settings.get()
    if (!s.aiData || updater.usedToday() >= s.dailyDataLimit) return
    void updater.check(source.univ, { autoApply: s.autoApplyData }).then(
      (r) => r.state !== 'same' && console.log(`[data] ${source.univ}: ${r.state === 'skipped' ? r.reason : r.state}`),
      () => console.warn(`[data] ${source.univ}: 바뀐 곳을 찾지 못했어요.`),
    )
  }
  // 시험은 넣어 준 가짜 AI 설정을 그대로 쓴다
  const fixedAi = (): AiConfig | null | undefined => {
    const fixed = updateDeps?.ai
    return fixed === undefined ? undefined : typeof fixed === 'function' ? fixed() : fixed
  }
  const verifier = new PlanVerifier(store.db, datasets, {
    snapshot: (univ) => updater.snapshotDoc(univ),
    download: updateDeps?.download ?? downloadPlan,
    read: updateDeps?.read ?? readPlanDoc,
    ai: () => {
      const fixed = fixedAi()
      return fixed === undefined ? verifyAi(ai, env) : fixed
    },
    ...(updateDeps?.chat ? { chat: updateDeps.chat } : {}),
    enabled: () => settings.get().planVerify,
    limit: () => settings.get().dailyPlanVerifies,
    onReject: (univ, reason) => importer.reject(univ, reason),
  })
  const importer = new PlanImporter(store.db, datasets, {
    download: updateDeps?.download ?? downloadPlan,
    read: updateDeps?.read ?? readPlanDoc,
    // 그림으로 된 PDF는 쪽을 그림으로 그려 AI에 보냄
    render: updateDeps?.render ?? renderPdfPages,
    ai: () => {
      const fixed = fixedAi()
      return fixed === undefined ? importAi(ai, env) : fixed
    },
    ...(updateDeps?.chat ? { chat: updateDeps.chat } : {}),
    // 관리자가 따로 정하지 않았으면(기본값) 무료 Gemini 연결이 있을 때만 저절로 돈다. 유료 연결은 관리자가 시작해야 씀
    enabled: () => settings.get().planImport && (settings.isSet('planImport') || importAi(ai, env)?.kind === 'google'),
    limit: () => settings.get().dailyPlanImports,
    // 옮긴 대학도 원문 감시에 넣고 (바뀌면 바뀐 쪽만 AI로), 더 좋은 AI의 검수 차례에 넣는다
    onImported: (univ, plan, buf, doc) => {
      updater.baseline(univ, buf, doc)
      watch.ensure({ key: `plan-${univ}`, univ, title: plan.planTitle, url: plan.watch ?? plan.url })
      verifier.reset(univ)
      verifier.kick()
    },
  })
  return { store, accounts: new Accounts(store.db), settings, datasets, watch, updater, importer, verifier, ai, userKeys }
}

/** 지금 쓸 AI: 관리자가 고른 연결, 안 골랐으면 환경변수 설정. 고른 연결의 키를 못 풀면 null (AI를 끈 것과 같음) */
export function resolveAi(ai: AiProviders, env: Record<string, string | undefined>): AiConfig | null {
  const chosen = ai.config()
  return chosen === undefined ? aiConfig(env) : chosen
}

export const currentAi = (call: Call): AiConfig | null => resolveAi(call.services.ai, call.ctx.env)

/**
 * 전형 가져오기용 AI: 저장된 Gemini 연결(무료 키)이 있으면 그것, 없으면 지금 연결.
 * 대학마다 여러 번 부르므로 유료 연결을 골라 두었어도 무료 연결이 있으면 그쪽으로
 */
export function importAi(ai: AiProviders, env: Record<string, string | undefined>): AiConfig | null {
  for (const p of ai.list()) {
    if (p.kind !== 'google' || !p.keyOk) continue
    const cfg = ai.config(p.id)
    if (cfg) return cfg
  }
  return resolveAi(ai, env)
}

/**
 * 검수용 AI: 가져오기(무료 Gemini)보다 좋은 연결. 지금 고른 연결이 Gemini가 아니면 그것,
 * Gemini를 골랐으면 저장된 다른 연결(Claude 먼저). 없으면 null (같은 무료 모델로 다시 보는 건 검수가 아님)
 */
export function verifyAi(ai: AiProviders, env: Record<string, string | undefined>): AiConfig | null {
  const active = resolveAi(ai, env)
  if (active && active.kind !== 'google') return active
  const others = ai.list().filter((p) => p.kind !== 'google' && p.keyOk)
  for (const p of [...others.filter((x) => x.kind === 'anthropic'), ...others.filter((x) => x.kind !== 'anthropic')]) {
    const cfg = ai.config(p.id)
    if (cfg) return cfg
  }
  return null
}

export function requireUser(call: Call): User {
  if (!call.user) throw new HttpError(401, '로그인이 필요해요.')
  return call.user
}

export function requireAdmin(call: Call): User {
  const user = requireUser(call)
  if (!isAdmin(user)) throw new HttpError(403, '관리자만 쓸 수 있어요.')
  return user
}

/** 대표 관리자만 (관리자 지정·취소) */
export function requireOwner(call: Call): User {
  const user = requireAdmin(call)
  if (user.role !== 'owner') throw new HttpError(403, '대표 관리자만 할 수 있어요.')
  return user
}

/** 계정 오류를 HTTP 오류로 */
export function accountCall<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof AccountError) throw new HttpError(e.status, e.message)
    throw e
  }
}

/**
 * 서버를 켤 때 대표 관리자를 OWNER_EMAIL(Google 계정 이메일)에 맞춘다.
 * 그 계정이 아직 없으면 처음 Google로 가입할 때 대표 관리자가 된다
 */
export function prepareAccounts(accounts: Accounts, env: Record<string, string | undefined>): void {
  accounts.syncOwner(env.OWNER_EMAIL ?? '')
  if (!env.OWNER_EMAIL?.trim()) console.warn('[auth] OWNER_EMAIL이 없어 대표 관리자가 없어요. 관리 화면을 쓰려면 .env에 적어 주세요.')
}
