import { schoolFromLoose } from '../src/engine/school'
import { AiError, aiConfig, chat } from './ai'
import { type AiProvider, cleanProvider, ProviderError } from './ai-providers'
import { type Role, type User } from './accounts'
import { publicUser } from './account-api'
import { intParam, json, queryParam } from './http'
import { HttpError, readJson } from './limits'
import { SETTING_FIELDS, SettingError } from './settings'
import { type Call, currentAi, requireAdmin, requireOwner, type Route, type Services } from './services'

// 관리 화면 API. 모두 관리자 로그인이 필요하고, 바꾸는 일은 관리 기록에 남긴다.

const PAGE = 50

export interface AdminDeps {
  /** 오늘 쓴 AI 호출 수 */
  usage: (services: Services) => { read: number; import: number; match: number }
  /** AI 연결 시험에 쓰는 fetch (테스트에서 바꿔 끼운다) */
  fetch: typeof fetch
}

const idOf = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : null)

/** 사용자 로그를 거르는 행동 묶음 (점으로 끝나면 그 앞부분이 같은 행동 모두) */
const LOG_GROUPS: Record<string, string[]> = {
  account: ['auth.', 'account.'],
  design: ['design.', 'plan.save'],
  curriculum: ['curriculum.'],
  ai: ['match', 'ai-key.'],
}

const ROLE_LABEL: Record<Role, string> = { owner: '대표 관리자', admin: '관리자', user: '일반' }

const KIND_LABEL: Record<AiProvider['kind'], string> = { openai: 'OpenAI 호환', anthropic: 'Claude', google: 'Gemini' }

/** 연결 오류를 HTTP 오류로 */
function providerCall<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof ProviderError) throw new HttpError(400, e.message)
    throw e
  }
}

/** AI 연결 화면에 보내는 것: 연결 목록(키는 끝 4자리만), 환경변수 설정 요약, 지금 쓰는 연결 */
function aiState(call: Call) {
  const env = aiConfig(call.ctx.env)
  let host = ''
  try {
    host = env ? new URL(env.baseUrl).host : ''
  } catch {
    host = ''
  }
  const using = currentAi(call)
  const active = call.services.ai.active()
  return {
    providers: call.services.ai.list(),
    env: env ? { host, model: env.model, visionModel: env.visionModel } : null,
    active: active?.id ?? null,
    using: using ? { name: using.name, kind: using.kind, model: using.model } : null,
    /** 고른 연결의 키를 풀 수 없어 AI가 꺼진 상태 */
    broken: !!active && !using,
  }
}

export function adminRoutes(deps: AdminDeps): Record<string, Route> {
  /**
   * 다른 사용자를 바꾸기 전 확인. 내 계정은 여기서 못 바꾸고, 대표 관리자는 누구도 못 바꾼다(OWNER_EMAIL로 정한다).
   * 관리자 계정을 정지·삭제하는 것은 대표 관리자만 한다
   */
  const targetUser = (call: Call, admin: User, id: unknown, what: string): User => {
    const uid = idOf(id)
    const user = uid ? call.services.accounts.byId(uid) : null
    if (!user) throw new HttpError(404, '사용자를 찾지 못했어요.')
    if (user.id === admin.id) throw new HttpError(400, `내 계정은 여기서 ${what} 수 없어요.`)
    if (user.role === 'owner') throw new HttpError(403, `대표 관리자 계정은 ${what} 수 없어요.`)
    if (user.role === 'admin' && admin.role !== 'owner') throw new HttpError(403, `관리자 계정은 대표 관리자만 ${what} 수 있어요.`)
    return user
  }

  return {
    'GET /api/admin/overview': (call) => {
      requireAdmin(call)
      const { accounts, store, settings } = call.services
      return json({
        users: accounts.stats(),
        sessions: accounts.activeSessions(),
        curricula: store.stats(),
        usage: deps.usage(call.services),
        limits: { read: settings.get().dailyReadLimit, import: settings.get().dailyImportLimit, match: settings.get().dailyMatchLimit },
        ai: currentAi(call) !== null,
        // 내 Gemini API 키를 등록한 사람 수 ('사용자 키로 AI 쓰기'를 켰을 때 본다)
        userKeys: call.services.userKeys.count(),
        settings: settings.get(),
        log: accounts.logs({ limit: 8, kind: 'admin' }).entries,
      })
    },

    // ---- 사용자 ----

    'GET /api/admin/users': (call) => {
      requireAdmin(call)
      const { users, total } = call.services.accounts.list({
        q: queryParam(call.url).toLowerCase(),
        role: call.url.searchParams.get('role') ?? '',
        status: call.url.searchParams.get('status') ?? '',
        offset: intParam(call.url, 'offset', 0),
        limit: PAGE,
      })
      return json({ users: users.map((u) => ({ ...publicUser(u), disabled: u.disabled, lastLoginAt: u.lastLoginAt, saved: u.saved })), total, page: PAGE })
    },

    /** 관리자 지정·취소: 대표 관리자만 한다 (지정된 관리자는 다른 사람을 관리자로 만들 수 없다) */
    'POST /api/admin/users/role': async (call) => {
      const owner = requireOwner(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown; role?: unknown }
      if (body.role !== 'admin' && body.role !== 'user') throw new HttpError(400, '권한을 골라 주세요.')
      const user = targetUser(call, owner, body.id, '바꿀')
      const { accounts } = call.services
      if (body.role !== user.role) {
        accounts.setRole(user.id, body.role)
        accounts.log(owner, body.role === 'admin' ? 'user.grant' : 'user.revoke', user.email, `${ROLE_LABEL[user.role]} → ${ROLE_LABEL[body.role]}`)
      }
      const now = accounts.byId(user.id)!
      return json({ user: { ...publicUser(now), disabled: now.disabled, lastLoginAt: now.lastLoginAt } })
    },

    /** 이용 정지·풀기 (관리자 계정은 대표 관리자만) */
    'POST /api/admin/users/update': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown; disabled?: unknown }
      if (typeof body.disabled !== 'boolean') throw new HttpError(400, '바꿀 내용이 없어요.')
      const user = targetUser(call, admin, body.id, '바꿀')
      const { accounts } = call.services
      if (body.disabled !== user.disabled) {
        accounts.setDisabled(user.id, body.disabled)
        accounts.log(admin, body.disabled ? 'user.disable' : 'user.enable', user.email)
      }
      const now = accounts.byId(user.id)!
      return json({ user: { ...publicUser(now), disabled: now.disabled, lastLoginAt: now.lastLoginAt } })
    },

    'POST /api/admin/users/delete': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown }
      const user = targetUser(call, admin, body.id, '지울')
      // 세션·설계·등록한 Gemini 키까지 함께 지운다
      call.services.accounts.remove(user.id)
      call.services.accounts.log(admin, 'user.delete', user.email)
      return json({ ok: true })
    },

    // ---- 설정 ----

    'GET /api/admin/settings': (call) => {
      requireAdmin(call)
      return json({ values: call.services.settings.get(), fields: SETTING_FIELDS })
    },

    'POST /api/admin/settings': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 4_000)) as { values?: unknown }
      if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) throw new HttpError(400, '설정 값이 맞지 않아요.')
      let changed: string[]
      try {
        changed = call.services.settings.save(body.values as Record<string, unknown>)
      } catch (e) {
        if (e instanceof SettingError) throw new HttpError(400, e.message)
        throw e
      }
      if (changed.length) {
        const labels = changed.map((k) => SETTING_FIELDS.find((f) => f.key === k)?.label ?? k)
        call.services.accounts.log(admin, 'settings', '', `바꾼 항목: ${labels.join(', ')}`)
      }
      return json({ values: call.services.settings.get(), changed })
    },

    // ---- AI 연결 ----

    'GET /api/admin/ai': (call) => {
      requireAdmin(call)
      return json(aiState(call))
    },

    'POST /api/admin/ai/create': async (call) => {
      const admin = requireAdmin(call)
      const body = await readJson(call.req, 4_000)
      const input = providerCall(() => cleanProvider(body, { requireKey: true }))
      const p = providerCall(() => call.services.ai.create(input))
      call.services.accounts.log(admin, 'ai.create', p.name, `${KIND_LABEL[p.kind]} · ${p.model}`)
      return json(aiState(call), 201)
    },

    /** 고친다. 키를 비워 보내면 저장된 키를 그대로 둔다 */
    'POST /api/admin/ai/update': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 4_000)) as { id?: unknown }
      const id = idOf(body.id)
      if (!id || !call.services.ai.byId(id)) throw new HttpError(404, '연결을 찾지 못했어요.')
      const input = providerCall(() => cleanProvider(body, { requireKey: false }))
      const p = providerCall(() => call.services.ai.update(id, input))
      call.services.accounts.log(admin, 'ai.update', p.name, `${KIND_LABEL[p.kind]} · ${p.model}${input.apiKey ? ' · 키 바꿈' : ''}`)
      return json(aiState(call))
    },

    'POST /api/admin/ai/delete': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown }
      const id = idOf(body.id)
      const p = id ? call.services.ai.byId(id) : null
      if (!p) throw new HttpError(404, '연결을 찾지 못했어요.')
      call.services.ai.remove(p.id)
      call.services.accounts.log(admin, 'ai.delete', p.name, p.active ? '쓰던 연결이라 환경변수 설정으로 돌아감' : '')
      return json(aiState(call))
    },

    /** 쓸 연결을 고른다 (id가 null이면 환경변수 설정) */
    'POST /api/admin/ai/select': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown }
      const id = body.id === null ? null : idOf(body.id)
      if (id === null && body.id !== null) throw new HttpError(400, '연결을 골라 주세요.')
      const p = id === null ? null : call.services.ai.byId(id)
      if (id !== null && !p) throw new HttpError(404, '연결을 찾지 못했어요.')
      if (p && !p.keyOk) throw new HttpError(409, '이 연결의 키를 풀 수 없어요. 키를 다시 넣어 주세요.')
      providerCall(() => call.services.ai.select(id))
      call.services.accounts.log(admin, 'ai.select', p ? p.name : '환경변수 설정', p ? `${KIND_LABEL[p.kind]} · ${p.model}` : '')
      return json(aiState(call))
    },

    /** 짧은 질문 하나로 연결을 시험한다 (id가 null이면 환경변수 설정). 실패 원인은 HTTP 상태·오류 종류만 보여 준다 */
    'POST /api/admin/ai/test': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown }
      const id = body.id === null ? null : idOf(body.id)
      if (id === null && body.id !== null) throw new HttpError(400, '연결을 골라 주세요.')
      const p = id === null ? null : call.services.ai.byId(id)
      if (id !== null && !p) throw new HttpError(404, '연결을 찾지 못했어요.')
      const cfg = id === null ? aiConfig(call.ctx.env) : call.services.ai.config(id)
      if (!cfg) throw new HttpError(400, id === null ? '환경변수에 AI 설정이 없어요.' : '이 연결의 키를 풀 수 없어요. 키를 다시 넣어 주세요.')
      const started = Date.now()
      let result: { ok: boolean; ms: number; reply?: string; error?: string; detail?: string }
      try {
        const out = await chat(cfg, { system: '숫자만 답한다.', user: '1+1=?', maxTokens: 64, timeoutMs: 60_000 }, deps.fetch)
        result = { ok: true, ms: Date.now() - started, reply: out.replace(/\s+/g, ' ').trim().slice(0, 40) }
      } catch (e) {
        if (!(e instanceof AiError)) throw e
        result = { ok: false, ms: Date.now() - started, error: e.message, detail: e.detail }
      }
      call.services.accounts.log(admin, 'ai.test', cfg.name, result.ok ? `성공 ${result.ms}ms` : `실패 ${result.detail || result.error}`)
      return json({ ...result, model: cfg.model })
    },

    // ---- 공유 편제표 ----

    'GET /api/admin/curricula': (call) => {
      requireAdmin(call)
      const { items, total } = call.services.store.list({
        q: queryParam(call.url),
        status: call.url.searchParams.get('status') ?? '',
        offset: intParam(call.url, 'offset', 0),
        limit: PAGE,
      })
      return json({ items, total, page: PAGE })
    },

    'GET /api/admin/curricula/item': (call) => {
      requireAdmin(call)
      const id = intParam(call.url, 'id', 0, 1e9)
      const item = id ? call.services.store.byId(id) : null
      if (!item) throw new HttpError(404, '편제표를 찾지 못했어요.')
      return json({ item })
    },

    'POST /api/admin/curricula/update': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown; hidden?: unknown; verified?: unknown }
      const id = idOf(body.id)
      const item = id ? call.services.store.byId(id) : null
      if (!item) throw new HttpError(404, '편제표를 찾지 못했어요.')
      const { store, accounts } = call.services
      const label = `${item.schoolName} ${item.cohort}${item.track ? ` ${item.track}` : ''} #${item.id}`
      if (typeof body.hidden === 'boolean' && body.hidden !== item.hidden) {
        store.setHidden(item.id, body.hidden)
        accounts.log(admin, body.hidden ? 'curriculum.hide' : 'curriculum.show', label)
      }
      if (typeof body.verified === 'boolean' && body.verified !== item.verified) {
        store.setVerified(item.id, body.verified)
        accounts.log(admin, body.verified ? 'curriculum.verify' : 'curriculum.unverify', label)
      }
      return json({ item: store.byId(item.id) })
    },

    /** 관리자가 고친 편제표: 새 판으로 저장하고(확인됨), 고치기 전 판은 숨긴다 */
    'POST /api/admin/curricula/edit': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 400_000)) as { id?: unknown; data?: unknown }
      const id = idOf(body.id)
      const item = id ? call.services.store.byId(id) : null
      if (!item) throw new HttpError(404, '편제표를 찾지 못했어요.')
      const before = (item.data && typeof item.data === 'object' ? item.data : {}) as Record<string, unknown>
      const school = schoolFromLoose(body.data, {
        id: typeof before.id === 'string' ? before.id : `neis-${item.office}-${item.code}-${item.cohort}${item.track ? `-${item.track}` : ''}`,
        name: item.schoolName,
        region: item.region,
        cohort: item.cohort,
      })
      if (!school.terms.some((t) => t.fixed.length || t.groups.length)) throw new HttpError(400, '과목이 하나도 없어요.')
      const data = { ...school, ...(item.track ? { track: item.track } : {}), source: before.source ?? school.source }
      const { store, accounts } = call.services
      const saved = store.insert({
        office: item.office,
        code: item.code,
        cohort: item.cohort,
        track: item.track,
        schoolName: item.schoolName,
        region: item.region,
        data,
        sourceUrl: item.sourceUrl,
        pageUrl: item.pageUrl,
        sourceTitle: item.sourceTitle,
        method: 'manual',
        model: '',
      })
      store.setVerified(saved.id, true)
      store.setHidden(item.id, true)
      accounts.log(admin, 'curriculum.edit', `${item.schoolName} ${item.cohort}${item.track ? ` ${item.track}` : ''} #${item.id} → #${saved.id}`)
      return json({ item: store.byId(saved.id) })
    },

    // ---- 신고 ----

    'GET /api/admin/reports': (call) => {
      requireAdmin(call)
      const { items, total } = call.services.store.reports({
        status: call.url.searchParams.get('status') ?? 'open',
        offset: intParam(call.url, 'offset', 0),
        limit: PAGE,
      })
      return json({ items, total, page: PAGE })
    },

    'POST /api/admin/reports/update': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown; resolved?: unknown }
      const id = idOf(body.id)
      if (!id || typeof body.resolved !== 'boolean') throw new HttpError(400, '요청이 맞지 않아요.')
      if (!call.services.store.setResolved(id, body.resolved)) throw new HttpError(404, '신고를 찾지 못했어요.')
      call.services.accounts.log(admin, body.resolved ? 'report.resolve' : 'report.reopen', `#${id}`)
      return json({ ok: true })
    },

    // ---- 기록 ----

    /** 관리 기록: 관리자가 바꾼 것과 사용자가 한 일. kind=admin|user로 거르고 q로 이메일·대상을 찾는다 */
    'GET /api/admin/log': (call) => {
      requireAdmin(call)
      const kind = call.url.searchParams.get('kind')
      const group = LOG_GROUPS[call.url.searchParams.get('group') ?? '']
      const { entries, total } = call.services.accounts.logs({
        offset: intParam(call.url, 'offset', 0),
        limit: PAGE,
        kind: kind === 'admin' || kind === 'user' ? kind : '',
        q: queryParam(call.url),
        actions: group,
      })
      return json({ entries, total, page: PAGE })
    },
  }
}
