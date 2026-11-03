import { MAJOR_BY_ID } from '../src/data/majors'
import { cleanName, type User } from './accounts'
import { designChanges } from './design-log'
import { AiError, chat } from './ai'
import { cleanUserKey, userGeminiConfig } from './user-keys'
import { authUrl, exchangeCode, googleConfig, GoogleAuthError, type GoogleIdentity, isOwnerEmail, newNonce, pkce } from './google-auth'
import { clearSessionCookie, cookieName, json, readCookie, redirect, sessionCookie, shortCookie } from './http'
import { HttpError, RateLimiter, readJson } from './limits'
import { accountCall, type Call, requireUser, type Route } from './services'

// Google 로그인·가입 동의·로그아웃·탈퇴, 내 Gemini 키·이름, 계정에 설계 저장

/** 화면에 보내는 사용자 정보 */
export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt })

const NAME_RULE = '이름은 실명으로 2~30자, 글자로만 적어 주세요.'

/** 본인에게 보내는 정보. 등록한 Gemini 키 여부(끝 4자리) 포함 */
const meOf = (call: Call, u: User) => ({ ...publicUser(u), aiKey: call.services.userKeys.info(u.id) })

/** 계정에 저장하는 설계의 크기 상한, 글자 수 (학교 편제표 20개 정도) */
const MAX_DATA = 400_000

/** FLOW: 로그인을 시작한 브라우저인지 맞춰 보는 쿠키, PENDING: 첫 로그인의 가입 동의를 기다리는 쿠키 */
const FLOW_COOKIE = 'gwamok_oauth'
const PENDING_COOKIE = 'gwamok_pending'

/**
 * 로그인 뒤 돌아갈 주소. 이 사이트의 화면 경로만 (다른 사이트·API로 못 보내게).
 * URL로 정리해 '/./api', '/.//x' 같은 우회를 풀고, 한글 등은 %로 바꿔 둔다 (Location 머리글에 그대로 넣으면 오류)
 */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length > 300 || !/^\/(?!\/)[^\s\\]*$/.test(next)) return '/'
  let u: URL
  try {
    u = new URL(next, 'http://next.invalid')
  } catch {
    return '/'
  }
  const path = `${u.pathname}${u.search}${u.hash}`
  if (u.origin !== 'http://next.invalid' || path.startsWith('//') || /^\/api(\/|$)/i.test(u.pathname) || path.length > 1_000) return '/'
  return path
}

/** 설계 속 목록의 길이 상한. 화면이 만드는 것보다 넉넉하게 (너무 길면 저장할 때마다 견주는 데 오래 걸림) */
const PREF_LISTS: Record<string, number> = { majors: 100, univs: 200, pinned: 500, excluded: 500, picks: 300, unitIds: 5000 }
const prefsFit = (p: Record<string, unknown>) =>
  Object.entries(PREF_LISTS).every(([k, max]) => p[k] === undefined || p[k] === null || (Array.isArray(p[k]) && (p[k] as unknown[]).length <= max))

/** 저장 한 번에 남기는 설계 기록 줄 수, 한 사람이 10분에 남기는 줄 수. 넘으면 한 줄로 모음 */
const LOG_ROWS_PER_SAVE = 8
const LOG_ROWS_PER_10MIN = 60

export interface AccountDeps {
  fetch: typeof fetch
}

/** 기록 칸에 넣을 한 줄. 사용자가 보낸 값이라 줄바꿈·제어 문자를 뺌 */
const oneLine = (x: unknown, max: number) =>
  typeof x === 'string'
    ? x
        .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

/**
 * 저장한 설계를 기록 한 줄로. 대상: 지금 고른 학교와 학과, 내용: 분야·대학·꼭 듣기·빼기·슬롯 수.
 * 화면이 보낸 값이라 모양을 믿지 않고, 분야는 아는 id만 이름으로 바꾼다
 */
export function planSummary(d: { prefs: unknown; schools: unknown[]; plans: unknown[] }): { target: string; detail: string } {
  const p = (d.prefs ?? {}) as Record<string, unknown>
  const list = (x: unknown) => (Array.isArray(x) ? x : [])
  const school = d.schools.find((x) => !!x && typeof x === 'object' && (x as { id?: unknown }).id === p.schoolId) as
    { name?: unknown; track?: unknown } | undefined
  const name = oneLine(school?.name, 40)
  const track = oneLine(school?.track, 20)
  const majors = list(p.majors)
    .map((id) => (typeof id === 'string' ? MAJOR_BY_ID.get(id)?.name : undefined))
    .filter((x): x is string => !!x)
  const fields = majors.length > 2 ? `${majors.slice(0, 2).join(', ')} 외 ${majors.length - 2}` : majors.join(', ')
  const parts = [
    `분야 ${fields || '없음'}`,
    `대학 ${list(p.univs).length}곳`,
    `꼭 듣기 ${list(p.pinned).length}`,
    `빼기 ${list(p.excluded).length}`,
    `슬롯 ${Math.max(1, d.plans.length)}개`,
  ]
  return { target: name ? `${name}${track ? ` ${track}` : ''}` : '학교 고르기 전', detail: parts.join(' · ') }
}

export function accountRoutes(deps: AccountDeps): Record<string, Route> {
  const limits = {
    start: new RateLimiter(30, 10 * 60_000),
    callback: new RateLimiter(30, 10 * 60_000),
    complete: new RateLimiter(10, 3600_000),
    remove: new RateLimiter(5, 3600_000),
    data: new RateLimiter(120, 10 * 60_000),
    // 등록할 때마다 Google에 실제로 물어 확인하므로 적게
    aiKey: new RateLimiter(10, 3600_000),
    name: new RateLimiter(10, 3600_000),
    designRows: new RateLimiter(LOG_ROWS_PER_10MIN, 10 * 60_000),
  }

  /** 요청이 들어온 주소. Google에서 돌아올 주소에 씀 (PUBLIC_URL이 있으면 그쪽) */
  const originOf = (call: Call) => `${call.ctx.secure ? 'https' : 'http'}://${call.url.host}`

  /** 새 세션 쿠키. 이 브라우저의 이전 세션은 끊음 */
  const newSession = (call: Call, user: User) => {
    if (call.token) call.services.accounts.revokeSession(call.token)
    return sessionCookie(call.services.accounts.createSession(user.id).token, !!call.ctx.secure)
  }

  return {
    'GET /api/auth/me': (call) => json({ user: call.user ? meOf(call, call.user) : null }),

    /** Google 로그인 시작: 계정 고르는 화면으로 */
    'GET /api/auth/google': (call) => {
      const secure = !!call.ctx.secure
      const cfg = googleConfig(call.ctx.env, originOf(call))
      if (!cfg) return redirect('/login?error=unavailable')
      if (!limits.start.take(call.ctx.ip)) return redirect('/login?error=busy')
      const { verifier, challenge } = pkce()
      const nonce = newNonce()
      const state = call.services.accounts.startFlow({ verifier, nonce, next: safeNext(call.url.searchParams.get('next')) })
      return redirect(authUrl(cfg, { state, nonce, challenge }), [shortCookie(FLOW_COOKIE, state, secure, 600)])
    },

    /** Google에서 돌아옴: 가입한 계정이면 로그인, 처음이면 가입 동의 화면으로 */
    'GET /api/auth/google/callback': async (call) => {
      const secure = !!call.ctx.secure
      const clearFlow = shortCookie(FLOW_COOKIE, '', secure, 0)
      const fail = (reason: string) => redirect(`/login?error=${reason}`, [clearFlow])
      const cfg = googleConfig(call.ctx.env, originOf(call))
      if (!cfg) return fail('unavailable')
      // 이 브라우저에서 시작한 로그인인지 쿠키로 맞춰 봄 (남이 만든 로그인 주소로 끌어들이기 방지). state는 한 번만.
      // 요청 수는 쿠키가 맞을 때만 센다 (아무 요청으로 같은 IP의 로그인을 막지 못하게)
      const state = call.url.searchParams.get('state') ?? ''
      if (!state || state !== readCookie(call.req, cookieName(FLOW_COOKIE, secure))) return fail('expired')
      if (!limits.callback.take(call.ctx.ip)) return fail('busy')
      const flow = call.services.accounts.takeFlow(state)
      if (!flow) return fail('expired')
      if (call.url.searchParams.has('error')) return fail('cancelled')
      let id: GoogleIdentity
      try {
        id = await exchangeCode(cfg, call.url.searchParams.get('code') ?? '', flow.verifier, flow.nonce, deps.fetch)
      } catch (e) {
        console.warn(`[auth] Google 로그인을 마치지 못했어요: ${e instanceof GoogleAuthError ? e.message : 'unknown'}`)
        return fail('failed')
      }
      const { accounts, settings } = call.services
      const owner = isOwnerEmail(call.ctx.env, id.email)
      const user = accounts.bySub(id.sub)
      if (user) {
        accounts.setEmail(user.id, id.email)
        accounts.syncOwner(call.ctx.env.OWNER_EMAIL ?? '')
        const fresh = accounts.byId(user.id)!
        if (fresh.disabled) return fail('disabled')
        accounts.activity(fresh, 'auth.login')
        return redirect(flow.next, [clearFlow, newSession(call, fresh)])
      }
      if (!settings.get().signupOpen && !owner) return fail('closed')
      const token = accounts.startPending({ sub: id.sub, email: id.email, next: flow.next })
      return redirect(`/signup?next=${encodeURIComponent(flow.next)}`, [clearFlow, shortCookie(PENDING_COOKIE, token, !!call.ctx.secure, 900)])
    },

    /** 가입 동의를 기다리는 Google 계정. 동의 화면에 이메일을 보여 줌 */
    'GET /api/auth/pending': (call) => {
      const token = readCookie(call.req, cookieName(PENDING_COOKIE, !!call.ctx.secure))
      const p = token ? call.services.accounts.pending(token) : null
      return json({ pending: p ? { email: p.email, next: p.next } : null })
    },

    /** 가입 동의를 받고 계정을 만든다 */
    'POST /api/auth/complete': async (call) => {
      const secure = !!call.ctx.secure
      const body = (await readJson(call.req, 1_000)) as { agreeAge?: unknown; agreePrivacy?: unknown; name?: unknown }
      if (body.agreeAge !== true || body.agreePrivacy !== true) throw new HttpError(400, '필수 항목에 동의해 주세요.')
      // 실명 필수 (관리자가 가입자를 알아보게)
      const name = cleanName(body.name)
      if (!name) throw new HttpError(400, NAME_RULE)
      const { accounts, settings } = call.services
      const token = readCookie(call.req, cookieName(PENDING_COOKIE, secure))
      const expired = '시간이 지났어요. Google 로그인을 다시 해 주세요.'
      // 요청 수는 가입 대기 쿠키가 맞을 때만 센다 (쿠키 없는 요청으로 같은 IP의 가입을 막지 못하게)
      if (!token || !accounts.pending(token)) throw new HttpError(400, expired)
      if (!limits.complete.take(call.ctx.ip)) throw new HttpError(429, '가입 요청이 너무 많아요. 잠시 후 다시 해 주세요.')
      const p = accounts.pending(token, { take: true })
      if (!p) throw new HttpError(400, expired)
      const owner = isOwnerEmail(call.ctx.env, p.email)
      if (!settings.get().signupOpen && !owner) throw new HttpError(403, '지금은 회원가입을 받지 않아요.')
      // 그사이 다른 창에서 가입을 마쳤으면 그 계정으로 로그인
      const existing = accounts.bySub(p.sub)
      if (existing?.disabled) throw new HttpError(403, '이용이 정지된 계정이에요.')
      if (existing && !existing.name) accounts.setName(existing.id, name)
      const user = existing
        ? accounts.byId(existing.id)!
        : accountCall(() => accounts.create({ sub: p.sub, email: p.email }, { role: owner ? 'owner' : 'user', name }))
      accounts.activity(user, existing ? 'auth.login' : 'auth.signup')
      const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      headers.append('set-cookie', newSession(call, user))
      headers.append('set-cookie', shortCookie(PENDING_COOKIE, '', secure, 0))
      return new Response(JSON.stringify({ user: meOf(call, user), next: p.next }), { status: existing ? 200 : 201, headers })
    },

    'POST /api/auth/logout': (call) => {
      if (call.user) call.services.accounts.activity(call.user, 'auth.logout')
      if (call.token) call.services.accounts.revokeSession(call.token)
      return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(!!call.ctx.secure) })
    },

    /** 탈퇴: 계정과 저장한 설계를 지움. 대표 관리자는 불가 */
    'POST /api/auth/delete': async (call) => {
      const user = requireUser(call)
      const body = (await readJson(call.req, 1_000)) as { confirm?: unknown }
      if (body.confirm !== true) throw new HttpError(400, '탈퇴에 동의해 주세요.')
      if (!limits.remove.take(`u:${user.id}`)) throw new HttpError(429, '요청이 너무 많아요. 잠시 후 다시 해 주세요.')
      if (user.role === 'owner') throw new HttpError(409, '대표 관리자 계정은 탈퇴할 수 없어요.')
      // 탈퇴도 기록. 계정을 지우면 이 사람의 기록은 누구였는지 모르게 바뀐다
      call.services.accounts.activity(user, 'auth.delete')
      // 세션·설계·등록한 Gemini 키까지 함께 지움
      call.services.accounts.remove(user.id)
      return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(!!call.ctx.secure) })
    },

    /**
     * 내 Gemini API 키 등록: 모양 검사 → 관리자가 정한 모델에 짧은 질문으로 확인 → 암호화해 저장.
     * 무료 한도·혼잡(429·503)으로 확인이 안 되면 맞는 키로 보고 저장하되 그 사실을 알린다
     */
    'POST /api/me/ai-key': async (call) => {
      const user = requireUser(call)
      const body = (await readJson(call.req, 2_000)) as { apiKey?: unknown }
      const apiKey = cleanUserKey(body.apiKey)
      if (!apiKey) throw new HttpError(400, 'API 키 모양이 맞지 않아요. Google AI Studio에서 복사한 키를 앞뒤 빈칸 없이 붙여 넣어 주세요.')
      if (!limits.aiKey.take(`u:${user.id}`)) throw new HttpError(429, '키 등록은 한 시간에 10번까지예요. 잠시 후 다시 해 주세요.')
      const { settings, userKeys, accounts } = call.services
      let note = ''
      try {
        await chat(
          userGeminiConfig(apiKey, settings.get().userAiModel),
          { system: '숫자만 답한다.', user: '1+1=?', maxTokens: 64, timeoutMs: 30_000 },
          deps.fetch,
        )
      } catch (e) {
        if (!(e instanceof AiError)) throw e
        const code = Number(/^HTTP (\d{3})/.exec(e.detail)?.[1] ?? 0)
        // 429·503이면 키 자체는 통과한 것
        if (code === 429 || code === 503)
          note = code === 429 ? '키는 맞지만 지금은 사용 한도에 걸려 있어요.' : '키는 맞지만 지금은 Gemini에 요청이 몰려 있어요.'
        else {
          accounts.activity(user, 'ai-key.save', '', `실패: ${e.detail || e.message}`, { mergeMinutes: 10 })
          throw new HttpError(
            400,
            e.detail === 'timeout' || e.detail === 'connection'
              ? 'Google에 연결하지 못해 키를 확인하지 못했어요. 잠시 후 다시 해 주세요.'
              : code === 400 || code === 401 || code === 403
                ? '맞지 않는 키예요. Google AI Studio에서 키를 끝까지 복사했는지, 지우거나 막힌 키는 아닌지 확인해 주세요.'
                : code === 404
                  ? '관리자가 정한 Gemini 모델을 쓸 수 없어 키를 확인하지 못했어요. 관리자에게 알려 주세요.'
                  : '키를 확인하지 못했어요. 잠시 후 다시 해 주세요.',
          )
        }
      }
      const info = userKeys.save(user.id, apiKey)
      if (!info) throw new HttpError(401, '로그인이 필요해요.')
      accounts.activity(user, 'ai-key.save', '', note ? '확인 보류 (한도·혼잡)' : '확인됨')
      return json({ aiKey: info, note })
    },

    'POST /api/me/ai-key/delete': (call) => {
      const user = requireUser(call)
      if (call.services.userKeys.remove(user.id)) call.services.accounts.activity(user, 'ai-key.delete')
      return json({ aiKey: null })
    },

    /** 실명 바꾸기. 예전에 이름 없이 가입한 사람도 여기서 적는다 */
    'POST /api/me/name': async (call) => {
      const user = requireUser(call)
      const body = (await readJson(call.req, 1_000)) as { name?: unknown }
      const name = cleanName(body.name)
      if (!name) throw new HttpError(400, NAME_RULE)
      if (!limits.name.take(`u:${user.id}`)) throw new HttpError(429, '이름은 한 시간에 10번까지 바꿀 수 있어요.')
      const { accounts } = call.services
      if (name !== user.name) {
        accounts.setName(user.id, name)
        accounts.activity(user, 'account.name', '', user.name ? '이름 바꿈' : '이름 적음')
      }
      return json({ user: meOf(call, accounts.byId(user.id)!) })
    },

    'GET /api/me/data': (call) => {
      const user = requireUser(call)
      return json({ saved: call.services.accounts.getData(user.id) })
    },

    /**
     * 설계 저장. base: 화면이 마지막으로 받거나 저장한 판의 저장 시각, 계정에 없다고 알면 null.
     * 그사이 다른 탭·기기가 먼저 저장했으면 덮지 않고 409와 지금 설계를 돌려준다 (화면이 합쳐 다시 저장).
     * base를 안 보내는 예전 화면은 그대로 덮어쓴다
     */
    'POST /api/me/data': async (call) => {
      const user = requireUser(call)
      const body = (await readJson(call.req, MAX_DATA + 1_000)) as { data?: unknown; base?: unknown }
      const data = body.data
      const bad = '저장할 내용이 맞지 않아요.'
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, bad)
      const d = data as { prefs?: unknown; schools?: unknown; plans?: unknown }
      if (!d.prefs || typeof d.prefs !== 'object' || Array.isArray(d.prefs) || !Array.isArray(d.schools) || d.schools.length > 20) throw new HttpError(400, bad)
      if (!prefsFit(d.prefs as Record<string, unknown>)) throw new HttpError(400, bad)
      // plans: 설계 슬롯 (화면 MAX_SLOTS와 같게)
      if (d.plans !== undefined && (!Array.isArray(d.plans) || d.plans.length > 10)) throw new HttpError(400, '슬롯은 10개까지 저장할 수 있어요.')
      if (body.base !== undefined && body.base !== null && typeof body.base !== 'string') throw new HttpError(400, bad)
      if (!limits.data.take(`u:${user.id}`)) throw new HttpError(429, '저장 요청이 너무 많아요. 잠시 후 다시 해 주세요.')
      const text = JSON.stringify({ prefs: d.prefs, schools: d.schools, plans: d.plans ?? [] })
      if (text.length > MAX_DATA) throw new HttpError(413, '저장할 내용이 너무 커요. 쓰지 않는 학교를 지워 주세요.')
      const { accounts } = call.services
      if (body.base !== undefined && body.base !== accounts.dataVersion(user.id))
        return json({ error: '다른 곳에서 먼저 저장했어요.', saved: accounts.getData(user.id) }, 409)
      const before = accounts.dataText(user.id)
      const updatedAt = accounts.putData(user.id, text)
      // 저장하는 사이 계정이 지워짐
      if (!updatedAt) throw new HttpError(401, '로그인이 필요해요.')
      // 사용자 기록: 이전 설계와 견줘 바뀐 것을 한 줄씩 (화면을 열 때 같은 내용을 다시 올린 것은 남기지 않음)
      if (before !== text) {
        const next = { prefs: d.prefs, schools: d.schools, plans: Array.isArray(d.plans) ? d.plans : [] }
        let prev: unknown = null
        try {
          prev = before ? JSON.parse(before) : null
        } catch {
          prev = null
        }
        if (!prev) {
          // 첫 저장: 아무것도 안 고른 빈 설계면 남기지 않음
          const p = (d.prefs ?? {}) as { schoolId?: unknown; majors?: unknown; univs?: unknown }
          const chosen = !!p.schoolId || (Array.isArray(p.majors) && p.majors.length > 0) || (Array.isArray(p.univs) && p.univs.length > 0)
          if (chosen) {
            const { target, detail } = planSummary(next)
            accounts.activity(user, 'plan.save', target, `처음 저장 · ${detail}`)
          }
        } else {
          // 한 번에 너무 많이 바뀌거나 아주 자주 바꾸면 나머지는 한 줄로 모음 (기록이 넘치지 않게)
          const changes = designChanges(prev, next)
          for (const [i, c] of changes.entries()) {
            if (i < LOG_ROWS_PER_SAVE && limits.designRows.take(`u:${user.id}`)) {
              accounts.activity(user, c.action, c.target, c.detail)
              continue
            }
            accounts.activity(user, 'plan.save', '설계', '한꺼번에 많이 바꿔 자세한 줄은 줄임', { mergeMinutes: 60 })
            break
          }
        }
      }
      return json({ updatedAt })
    },
  }
}
