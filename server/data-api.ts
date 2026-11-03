import { createHash } from 'node:crypto'
import { PlanError } from '../src/data/admissions-check'
import { json } from './http'
import { HttpError, readJson } from './limits'
import { ProposalConflict } from './plan-update'
import { type Call, currentAi, importAi, requireAdmin, type Route, verifyAi } from './services'

// 대입 자료 API: 누구나 받는 최신 판·판 번호·업데이트 소식, 관리자가 고치기·원문 감시.

const UNIV_RE = /^[a-z0-9-]{2,40}$/

/** 대학 전형 자료의 판 (편집기가 불러온 뒤 바뀌었는지 견줄 때) */
const planTag = (plan: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(plan ?? null))
    .digest('hex')
    .slice(0, 16)

export function dataRoutes(): Record<string, Route> {
  return {
    /** 최신 전형 자료. 판 번호를 ETag로 줘서 바뀌지 않았으면 304 */
    'GET /api/data/admissions': (call) => {
      const snap = call.services.datasets.admissions()
      const etag = `"${snap.version}"`
      if (call.req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-cache' } })
      return new Response(JSON.stringify(snap), {
        headers: { 'content-type': 'application/json; charset=utf-8', etag, 'cache-control': 'no-cache' },
      })
    },

    /** 화면이 자주 묻는 가벼운 판 번호 */
    'GET /api/data/version': (call) => json({ admissions: call.services.datasets.version() }),

    /** 대입 자료 업데이트 소식 */
    'GET /api/data/updates': (call) => {
      const n = Math.min(50, Math.max(1, Number(call.url.searchParams.get('limit')) || 20))
      return json({ entries: call.services.datasets.updates(n) })
    },

    // ---- 관리자 ----

    'GET /api/admin/data': (call) => {
      requireAdmin(call)
      const { datasets, watch } = call.services
      const snap = datasets.admissions()
      return json({
        admissions: {
          version: snap.version,
          updatedAt: snap.updatedAt,
          plans: snap.plans.map((p) => ({
            univ: p.univ,
            planTitle: p.planTitle,
            date: p.date,
            tracks: p.tracks.length,
            url: p.page ?? p.url,
            ai: p.ai ?? null,
            aiCheck: p.aiCheck ?? null,
          })),
          overrides: datasets.overrides(),
        },
        sources: watch.list(),
        pending: watch.pendingCount(),
        updates: datasets.updates(20),
        proposals: call.services.updater.list(30),
        checking: call.services.updater.checking(),
        ai: currentAi(call) !== null,
      })
    },

    'GET /api/admin/data/plan': (call) => {
      requireAdmin(call)
      const univ = call.url.searchParams.get('univ') ?? ''
      if (!UNIV_RE.test(univ)) throw new HttpError(400, '대학 id가 맞지 않아요.')
      const plan = call.services.datasets.plan(univ)
      return json({ plan, tag: planTag(plan) })
    },

    /** 한 대학 전형 자료를 고친다 (검사를 통과해야 저장, 판이 올라가 모두에게 바로 보인다) */
    'POST /api/admin/data/plan': async (call: Call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 400_000)) as { univ?: unknown; plan?: unknown; summary?: unknown; base?: unknown }
      const univ = typeof body.univ === 'string' && UNIV_RE.test(body.univ) ? body.univ : ''
      if (!univ) throw new HttpError(400, '대학 id가 맞지 않아요.')
      // 편집기를 연 뒤 다른 관리자가 고쳤거나 AI 제안이 반영됐으면 덮어쓰지 않는다 (base: 불러올 때 받은 판)
      if (typeof body.base === 'string' && body.base !== planTag(call.services.datasets.plan(univ)))
        throw new HttpError(409, '편집기를 연 뒤 이 대학 자료가 바뀌었어요. 다시 불러와서 고쳐 주세요.')
      const summary = typeof body.summary === 'string' ? body.summary.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
      try {
        const plan = call.services.datasets.setPlan(univ, body.plan, admin.email, summary)
        // 기다리는 AI 제안 중 이번에 고친 곳과 겹치는 것은 직접 확인으로 돌린다
        call.services.updater.revalidate(univ)
        call.services.accounts.log(admin, 'data.plan', univ, summary || `전형 ${plan.tracks.length}개`)
        return json({ plan, version: call.services.datasets.version() })
      } catch (e) {
        if (e instanceof PlanError) throw new HttpError(400, e.message)
        throw e
      }
    },

    'POST /api/admin/data/revert': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { univ?: unknown }
      const univ = typeof body.univ === 'string' && UNIV_RE.test(body.univ) ? body.univ : ''
      // 원문 기준과 기다리던 제안도 함께 정리한다 (다음 확인 때 배포한 자료와 지금 원문을 다시 견준다)
      if (!univ || !call.services.updater.revert(univ, admin.email)) throw new HttpError(404, '고친 자료가 없어요.')
      call.services.accounts.log(admin, 'data.revert', univ)
      return json({ ok: true, version: call.services.datasets.version() })
    },

    /** 대학 원문을 지금 받아 AI로 바뀐 곳을 찾는다 (오래 걸려서 시작만 하고 바로 답한다) */
    'POST /api/admin/data/proposals/check': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { univ?: unknown }
      const univ = typeof body.univ === 'string' && UNIV_RE.test(body.univ) ? body.univ : ''
      if (!univ || !call.services.datasets.plan(univ)) throw new HttpError(404, '대학 자료가 없어요.')
      if (!currentAi(call)) throw new HttpError(503, 'AI가 설정되지 않았어요.')
      const s = call.services.settings.get()
      // 여기서는 바로 알리려고 먼저 보고, 실제로 세는 것은 AI를 부르기 바로 앞이다 (updater.run)
      if (call.services.updater.usedToday() >= s.dailyDataLimit) throw new HttpError(429, '오늘 AI 확인 한도를 다 썼어요. 설정에서 한도를 늘릴 수 있어요.')
      call.services.accounts.log(admin, 'data.check', univ)
      void call.services.updater.check(univ, { autoApply: s.autoApplyData, by: admin.email }).catch(() => undefined)
      return json({ started: true, checking: call.services.updater.checking() })
    },

    'POST /api/admin/data/proposals/apply': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown }
      const id = typeof body.id === 'number' && Number.isInteger(body.id) ? body.id : 0
      try {
        const p = call.services.updater.apply(id, admin.email)
        if (!p) throw new HttpError(404, '반영할 수 있는 제안이 아니에요.')
        call.services.accounts.log(admin, 'data.apply', p.univ, p.summary)
        return json({ proposal: p, version: call.services.datasets.version() })
      } catch (e) {
        // 그 사이 같은 곳을 고쳐 반영하지 않았다 (제안은 직접 확인으로 돌아갔다)
        if (e instanceof ProposalConflict) throw new HttpError(409, e.message)
        if (e instanceof PlanError) throw new HttpError(400, e.message)
        throw e
      }
    },

    'POST /api/admin/data/proposals/dismiss': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { id?: unknown }
      const id = typeof body.id === 'number' && Number.isInteger(body.id) ? body.id : 0
      const p = call.services.updater.dismiss(id, admin.email)
      if (!p) throw new HttpError(404, '이미 정리한 제안이에요.')
      call.services.accounts.log(admin, 'data.dismiss', p.univ, p.summary)
      return json({ proposal: p })
    },

    // ---- 전형 없는 대학 가져오기 (시행계획을 받아 AI로 옮긴다) ----

    'GET /api/admin/data/imports': (call) => {
      requireAdmin(call)
      const ai = importAi(call.services.ai, call.ctx.env)
      const checker = verifyAi(call.services.ai, call.ctx.env)
      return json({
        rows: call.services.importer.list(),
        state: call.services.importer.state(),
        ai: ai ? { name: ai.name, model: ai.visionModel || ai.model } : null,
        // AI가 옮긴 대학의 검수 상태와 검수 AI
        checks: call.services.verifier.list(),
        verify: { ...call.services.verifier.state(), ai: checker ? { name: checker.name, model: checker.visionModel || checker.model } : null },
      })
    },

    /** 한 대학을 지금 검수한다 (오래 걸려서 시작만 하고 바로 답한다) */
    'POST /api/admin/data/verify/run': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { univ?: unknown }
      const univ = typeof body.univ === 'string' && UNIV_RE.test(body.univ) ? body.univ : ''
      if (!univ || !call.services.datasets.plan(univ)?.ai) throw new HttpError(404, 'AI가 옮긴 자료가 아니에요.')
      if (!verifyAi(call.services.ai, call.ctx.env)) throw new HttpError(503, '검수할 AI 연결이 없어요. AI 연결 탭에서 Claude 같은 연결을 넣어 주세요.')
      call.services.accounts.log(admin, 'data.review', univ)
      void call.services.verifier.verifyNow(univ).catch(() => undefined)
      return json({ started: true })
    },

    /** 켜면 바로 시작해서 하루 한도 안에서 한 시간마다 이어서 한다 */
    'POST /api/admin/data/imports/toggle': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { on?: unknown }
      if (typeof body.on !== 'boolean') throw new HttpError(400, '켜기·끄기 값이 맞지 않아요.')
      if (body.on && !importAi(call.services.ai, call.ctx.env)) throw new HttpError(503, 'AI가 설정되지 않았어요. AI 연결 탭에서 먼저 연결해 주세요.')
      // 관리자가 누른 것은 기본값과 같아도 적어 둔다 (그래야 무료 연결이 없을 때도 돈다)
      call.services.settings.save({ planImport: body.on }, { always: true })
      call.services.accounts.log(admin, 'data.import', '', body.on ? '가져오기 켬' : '가져오기 끔')
      if (body.on) call.services.importer.kick()
      return json({ state: call.services.importer.state() })
    },

    /** 한 대학을 지금 가져온다. 원문 주소를 주면 그 주소를 먼저 쓴다 (오래 걸려서 시작만 하고 바로 답한다) */
    'POST /api/admin/data/imports/run': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 2_000)) as { univ?: unknown; url?: unknown }
      const univ = typeof body.univ === 'string' && UNIV_RE.test(body.univ) ? body.univ : ''
      if (!univ || !call.services.importer.list().some((r) => r.univ === univ)) throw new HttpError(404, '가져올 대학이 아니에요.')
      if (typeof body.url === 'string' && body.url.trim()) {
        const url = body.url.trim()
        let ok = false
        try {
          ok = new URL(url).protocol === 'https:' && url.length <= 500
        } catch {
          ok = false
        }
        if (!ok) throw new HttpError(400, 'https로 시작하는 주소를 넣어 주세요.')
        call.services.importer.setUrl(univ, url)
      }
      if (!importAi(call.services.ai, call.ctx.env)) throw new HttpError(503, 'AI가 설정되지 않았어요. AI 연결 탭에서 먼저 연결해 주세요.')
      call.services.accounts.log(admin, 'data.import', univ, typeof body.url === 'string' && body.url.trim() ? '주소를 넣고 가져오기' : '가져오기')
      void call.services.importer.importNow(univ).catch(() => undefined)
      return json({ started: true })
    },

    /** AI가 옮긴 자료를 원문과 견줘 확인했다: 'AI가 옮김' 표시를 지운다 */
    'POST /api/admin/data/imports/verify': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { univ?: unknown }
      const univ = typeof body.univ === 'string' && UNIV_RE.test(body.univ) ? body.univ : ''
      const plan = univ ? call.services.datasets.plan(univ) : null
      if (!plan?.ai) throw new HttpError(404, 'AI가 옮긴 자료가 아니에요.')
      const next = { ...plan }
      delete next.ai
      delete next.aiCheck
      call.services.datasets.setPlan(univ, next, admin.email, '원문과 견줘 확인했어요')
      call.services.updater.revalidate(univ)
      call.services.accounts.log(admin, 'data.verify', univ)
      return json({ version: call.services.datasets.version() })
    },

    /** 원문 감시를 지금 돌린다 */
    'POST /api/admin/sources/check': async (call) => {
      const admin = requireAdmin(call)
      const result = await call.services.watch.checkAll()
      call.services.accounts.log(admin, 'sources.check', '', `확인 ${result.checked}곳, 바뀜 ${result.changed}곳`)
      return json({ ...result, sources: call.services.watch.list() })
    },

    'POST /api/admin/sources/ack': async (call) => {
      requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { key?: unknown }
      if (typeof body.key !== 'string' || !call.services.watch.acknowledge(body.key)) throw new HttpError(404, '원문을 찾지 못했어요.')
      return json({ ok: true })
    },

    'POST /api/admin/sources/add': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 2_000)) as { url?: unknown; title?: unknown; univ?: unknown }
      const url = typeof body.url === 'string' ? body.url.trim() : ''
      let ok = false
      try {
        const u = new URL(url)
        ok = u.protocol === 'https:' && url.length <= 500
      } catch {
        ok = false
      }
      if (!ok) throw new HttpError(400, 'https로 시작하는 주소를 넣어 주세요.')
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.replace(/\s+/g, ' ').trim().slice(0, 80) : url
      const univ = typeof body.univ === 'string' && (body.univ === '' || UNIV_RE.test(body.univ)) ? body.univ : ''
      const row = call.services.watch.add({ url, title, univ })
      call.services.accounts.log(admin, 'sources.add', title)
      return json({ source: row })
    },

    'POST /api/admin/sources/remove': async (call) => {
      const admin = requireAdmin(call)
      const body = (await readJson(call.req, 1_000)) as { key?: unknown }
      if (typeof body.key !== 'string' || !call.services.watch.remove(body.key)) throw new HttpError(404, '지울 수 있는 원문이 아니에요.')
      call.services.accounts.log(admin, 'sources.remove', body.key)
      return json({ ok: true })
    },
  }
}
