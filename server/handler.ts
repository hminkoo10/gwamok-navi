import { timingSafeEqual } from 'node:crypto'
import { FINE_MAJORS, MAJOR_BY_ID } from '../src/data/majors'
import { BANSONG_2026 } from '../src/data/schools/bansong2026'
import { checkSchool, schoolFromLoose } from '../src/engine/school'
import { accountRoutes } from './account-api'
import { adminRoutes } from './admin-api'
import { dataRoutes } from './data-api'
import { AiError, chat, extractJson } from './ai'
import { looksComplete, readFromUrl, type ReadResult, type ReadTarget, schoolByCode, type SchoolRef, type Site, variantsOf } from './curriculum'
import { SUBJECT_BY_NAME } from '../src/data/subjects'
import { type DocCandidate, type Discovery, discover, fileSite } from './discover'
import { json, readCookie, sessionCookieName } from './http'
import { DailyUsage, HttpError, LruCache, RateLimiter, readJson } from './limits'
import { type SchoolHit, schoolTracks, type SchoolTracks, schoolYear, searchSchools } from './neis'
import { MATCH_SYSTEM, importSystem } from './prompts'
import { checkRobots } from './robots'

/** obeyRobots가 꺼져 있을 때 */
const skipRobots = async () => {}

/** 진로 문장에 그대로 든 세부 학과 키워드(4글자 이상)로 고른 학과. 긴 키워드 순 최대 2개 */
export function keywordMajors(text: string): { id: string; why: string }[] {
  const t = text.replace(/\s+/g, '').toLowerCase()
  const hits: { id: string; kw: string }[] = []
  for (const f of FINE_MAJORS)
    for (const k of f.keywords) {
      const kk = k.replace(/\s+/g, '').toLowerCase()
      if (kk.length >= 4 && t.includes(kk) && !hits.some((h) => h.id === f.id)) hits.push({ id: f.id, kw: k })
    }
  return hits
    .sort((a, b) => b.kw.length - a.kw.length)
    .slice(0, 2)
    .map((h) => ({ id: h.id, why: h.kw }))
}
import { CookieJar, FetchBlocked } from './safe-fetch'
import { type InfoContext, type SchoolInfoResult, schoolInfoCandidates, schoolInfoSite } from './schoolinfo'
import { isAdmin } from './accounts'
import { ownKeyError, userGeminiConfig } from './user-keys'
import type { AiConfig } from './ai-types'
import { googleReady } from './google-auth'
import { type ApiContext, type Call, currentAi, prepareAccounts, type Route, type Services, servicesFor } from './services'
import { Store, type StoredCurriculum } from './store'

export type { ApiContext } from './services'

// /api/* 요청 처리. Node 서버와 Vite 개발 서버가 같은 함수를 쓴다.
// 여기는 편제표 찾기·읽기와 문장으로 분야 찾기. 계정·자료·관리 API는 account-api·data-api·admin-api

export interface ApiOptions {
  fetch?: typeof fetch
  /** 테스트용 메모리 저장소 (주면 원문 감시를 켜지 않음). 없으면 DATA_DIR/gwamok.db */
  store?: Store
  discover?: (homepage: string, cohort: number, track: string) => Promise<Discovery>
  schoolInfo?: (school: { name: string; office: string; code: string }, cohort: number, ctx: InfoContext, track: string) => Promise<SchoolInfoResult>
  read?: (school: SchoolRef, cohort: number, target: ReadTarget, site: Site, track: string) => Promise<ReadResult>
  robots?: (url: string) => Promise<void>
  /** 테스트용 학과 목록 */
  tracks?: (office: string, code: string, cohort: number) => Promise<SchoolTracks>
}

/** 한 학교·입학년도·학과의 편제표 후보 */
interface Found {
  candidates: DocCandidate[]
  homepage?: Discovery
  infoJar: CookieJar
  /** 출처별로 못 찾은 이유, 화면에 표시 */
  notes: string[]
}

const OFFICE_RE = /^[A-Z]\d{2}$/
const CODE_RE = /^\d{7}$/
/** 입학년도: 고3(학년도 − 2) ~ 예비 고1(학년도 + 1). 먼 해 편제표를 미리 공유해 두지 못하게 */
const cohortOf = (x: unknown) => {
  const year = schoolYear()
  return typeof x === 'number' && Number.isInteger(x) && x >= year - 2 && x <= year + 1 ? x : null
}
/** 학과·계열 이름: 글자·숫자·공백·일부 기호만, 30자까지 */
const trackOf = (x: unknown) =>
  typeof x === 'string'
    ? x
        .replace(/[^\p{L}\p{N} ·()-]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30)
    : ''

/** 사람이 원문과 대조한 편제표. 저장소를 처음 열 때 넣음 */
function seedVerified(store: Store): Store {
  store.seed({
    office: 'J10',
    code: '7530847',
    cohort: 2026,
    track: '',
    schoolName: BANSONG_2026.name,
    region: BANSONG_2026.region,
    data: { ...BANSONG_2026, id: 'neis-J10-7530847-2026' },
    sourceUrl: BANSONG_2026.source.url,
    pageUrl: BANSONG_2026.source.url,
    sourceTitle: BANSONG_2026.source.title,
  })
  return store
}

const publicCurriculum = (c: StoredCurriculum) => ({
  id: c.id,
  school: c.data,
  sourceUrl: c.sourceUrl,
  pageUrl: c.pageUrl,
  sourceTitle: c.sourceTitle,
  createdAt: c.createdAt,
  verified: !!c.verified || c.method === 'manual',
})

const MAX_TEXT = 20_000
const MAX_IMAGES = 4
/** data URL 글자 수. 화면이 긴 변 1800px JPEG로 줄여 보냄 (보통 한 장 1MB 안쪽) */
const MAX_IMAGE_CHARS = 3_000_000

/** 서버 AI 1인 하루 횟수. 서버 전체 한도를 한 사람이 다 쓰지 못하게, 관리자는 제외 */
const PER_USER_DAILY = { read: 20, import: 15, match: 100 }
/** 한 학교 홈페이지를 새로 둘러보는 시간당 횟수, 전체 사용자 합계. 학교 사이트 부담 때문 */
const CRAWLS_PER_SCHOOL_HOUR = 12
/** 공유하지 않은 읽기 결과(덜 읽힘·학과 고르기)를 기억하는 시간. 같은 파일을 AI로 또 읽지 않게 */
const READ_RESULT_MS = 3 * 3600_000
/** 공유에 필요한 표준 과목 수. 전문 교과가 많은 특성화고·학과는 VOCATIONAL 쪽 */
const MIN_KNOWN = 8
const MIN_KNOWN_VOCATIONAL = 4
const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

/** 로그인 없이 부르는 주소: 기능 정보, Google 로그인·가입 동의·로그아웃, ADMIN_TOKEN 스크립트용 숨기기 */
export const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/auth/me',
  'GET /api/auth/google',
  'GET /api/auth/google/callback',
  'GET /api/auth/pending',
  'POST /api/auth/complete',
  'POST /api/auth/logout',
  'POST /api/admin/hide',
])

/** CSRF 막기: 다른 사이트에서 보낸 브라우저 요청 거부. curl 같은 직접 호출은 요청 제한으로 */
function sameOrigin(req: Request, url: URL, env: ApiContext['env']): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = req.headers.get('origin')
  if (!origin) return true
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allowed.includes(origin)) return true
  try {
    return new URL(origin).host === url.host
  } catch {
    return false
  }
}

export function createApi(options: ApiOptions = {}) {
  const fetchImpl = options.fetch ?? fetch
  const limits = {
    match: new RateLimiter(20, 60_000),
    import: new RateLimiter(6, 10 * 60_000),
    schools: new RateLimiter(40, 60_000),
    curriculum: new RateLimiter(60, 60_000),
    discover: new RateLimiter(10, 60_000),
    read: new RateLimiter(8, 10 * 60_000),
    report: new RateLimiter(10, 3600_000),
  }

  // 저장소·계정·설정은 첫 요청 때 연다 (DATA_DIR를 env로 그때 받음)
  let services: Services | null = null
  let ready: Promise<void> | null = null
  const servicesOf = (env: ApiContext['env']): Services => {
    if (!services) {
      const store = options.store ?? seedVerified(new Store(`${env.DATA_DIR || './data'}/gwamok.db`))
      services = servicesFor(store, env, fetchImpl)
    }
    return services
  }
  const prepare = (env: ApiContext['env']) => {
    const s = servicesOf(env)
    ready ??= Promise.resolve()
      .then(() => prepareAccounts(s.accounts, env))
      .catch(() => console.warn('[auth] 대표 관리자를 맞추지 못했어요.'))
      .then(() => startWatch(s, env))
    return ready.then(() => s)
  }
  /** 원문 감시. 주기 WATCH_INTERVAL_HOURS, 기본은 운영 6시간·개발 끔, 테스트 저장소면 끔 */
  const startWatch = (s: Services, env: ApiContext['env']) => {
    const fallback = env.NODE_ENV === 'production' ? 6 : 0
    const hours = env.WATCH_INTERVAL_HOURS !== undefined && env.WATCH_INTERVAL_HOURS !== '' ? Number(env.WATCH_INTERVAL_HOURS) : fallback
    if (!Number.isFinite(hours) || hours <= 0 || options.store) return
    let first = true
    const run = () => {
      s.watch
        .checkAll()
        .then(
          (r) => {
            if (r.changed) console.log(`[watch] 원문 ${r.changed}곳이 바뀌었어요. 관리 화면에서 확인하세요.`)
            // 첫 회만: 대학 원문을 받아 다음 비교 기준으로 둔다
            if (!first) return
            first = false
            void s.updater
              .ensureBaselines(s.datasets.admissions().plans.map((p) => p.univ))
              .then((n) => n && console.log(`[data] 대학 원문 ${n}곳을 기준으로 받아 뒀어요.`))
              .catch(() => console.warn('[data] 대학 원문 기준을 받지 못했어요.'))
          },
          () => console.warn('[watch] 원문을 확인하지 못했어요.'),
        )
        .catch(() => console.warn('[watch] 원문 확인 뒤처리를 하지 못했어요.'))
    }
    setTimeout(run, 60_000).unref()
    setInterval(run, Math.max(1, hours) * 3600_000).unref()
    // 전형 없는 대학 가져오기·AI 전형 검수: 켜져 있으면 1시간마다 하루 한도 안에서 이어서
    setTimeout(() => {
      s.importer.kick()
      s.verifier.kick()
    }, 90_000).unref()
    setInterval(() => {
      s.importer.kick()
      s.verifier.kick()
    }, 3600_000).unref()
  }

  const trackCache = new LruCache<SchoolTracks>(2000, 24 * 3600_000)
  const schoolRefCache = new LruCache<SchoolRef>(2000, 24 * 3600_000)
  // 나이스에 없는 학교 코드. 잘못 기억해도 오래가지 않게 30분만
  const schoolMissCache = new LruCache<true>(2000, 30 * 60_000)
  // 학교별 둘러보기 줄 세우기. 학교 사이트에 동시에 여러 번 가지 않게
  const crawling = new Map<string, Promise<unknown>>()
  const crawlsPerSchool = new RateLimiter(CRAWLS_PER_SCHOOL_HOUR, 3600_000)
  const discovering = new Map<string, Promise<Found>>()
  // 공유하지 않은 읽기 결과 (덜 읽힘·학과 고르기·다른 해 표)
  const readResults = new LruCache<ReadResult>(500, READ_RESULT_MS)
  // 서버가 직접 찾은 파일 목록. 읽기는 여기 있는 파일만 받는다 (사용자가 준 주소는 안 믿음)
  const discovered = new LruCache<Found>(2000, 6 * 3600_000)
  // 같은 파일 동시 읽기는 AI 한 번으로 묶음
  const inflight = new Map<string, Promise<ReadResult>>()
  // 하루 사용량: 저장소에 기록, 한국 시간 날짜 기준, 재시작해도 이어 셈
  let usage: DailyUsage | null = null
  const usageOf = (s: Services) => (usage ??= new DailyUsage(s.store.db))
  /** 서버 AI 하루 한도 1회 차감 (서버 전체 + 1인 몫). 남았으면 null, 막히면 어느 쪽인지 */
  const takeDaily = (call: Call, what: keyof typeof PER_USER_DAILY, limit: number): 'mine' | 'all' | null => {
    const u = usageOf(call.services)
    const mine = call.user && !isAdmin(call.user) ? `u:${call.user.id}:${what}` : null
    if (mine && u.used(mine) >= PER_USER_DAILY[what]) return 'mine'
    if (!u.take(`all:${what}`, limit)) return 'all'
    if (mine) u.take(mine, Number.MAX_SAFE_INTEGER)
    return null
  }
  const dailyMessage = (why: 'mine' | 'all', all: string) => (why === 'mine' ? '오늘 쓸 수 있는 횟수를 다 썼어요. 내일 다시 해 주세요.' : all)
  const matchCache = new LruCache<{ id: string; why: string }[]>(500, 24 * 3600_000)
  const schoolCache = new LruCache<SchoolHit[]>(300, 24 * 3600_000)

  /** 요청 제한 키: 로그인하면 계정, 아니면 IP (같은 학교 학생은 IP를 함께 씀) */
  const limit = (name: keyof typeof limits, call: Call, message = '요청이 너무 많아요. 잠시 후 다시 해 주세요.') => {
    const key = call.user ? `u:${call.user.id}` : call.ctx.ip
    if (!limits[name].take(key)) throw new HttpError(429, message)
  }
  /** 관리 기록 남기기. mergeMinutes 안에 같은 대상·같은 일이면 한 줄로 모음 */
  const note = (call: Call, action: string, target: string, detail = '', mergeMinutes?: number) => {
    if (call.user) call.services.accounts.activity(call.user, action, target, detail, mergeMinutes ? { mergeMinutes } : {})
  }
  /**
   * 한 일을 결과와 함께 기록. 실패하면 화면에 보인 까닭을 남기고(같은 실패는 10분 동안 한 줄) 오류는 다시 던짐.
   * seen: 처리 중 알게 된 대상·입력 요약 (어디서 실패해도 아는 만큼 남게). mergeMinutes는 성공 기록을 모으는 시간
   */
  const recorded = async (call: Call, action: string, run: (seen: Seen) => Promise<{ res: Response; detail: string }>, mergeMinutes?: number) => {
    const seen: Seen = { target: '', input: '', own: false }
    try {
      const { res, detail } = await run(seen)
      note(call, action, seen.target, [seen.input, detail, seen.own ? '내 키' : ''].filter(Boolean).join(' · '), mergeMinutes)
      return res
    } catch (e) {
      const why = e instanceof HttpError || e instanceof AiError ? e.message : '서버 오류'
      note(call, action, seen.target, [seen.input, `실패: ${why}`, seen.own ? '내 키' : ''].filter(Boolean).join(' · '), 10)
      throw e
    }
  }

  /**
   * 사용자 기능(자동 읽기·파일 읽기·문장으로 찾기)용 AI. '사용자 키로 AI 쓰기'가 켜져 있으면 그 사람 Gemini 키, 아니면 서버 AI.
   * 키가 없으면 428 (화면이 키 등록 안내). own이면 서버 하루 한도를 세지 않음
   */
  const aiFor = (call: Call, what: string, seen?: Seen): { cfg: AiConfig | null; own: boolean } => {
    const settings = call.services.settings.get()
    if (!settings.userAiKey) return { cfg: currentAi(call), own: false }
    const key = call.user ? call.services.userKeys.key(call.user.id) : null
    if (!key) throw new HttpError(428, `${what}는 내 Gemini API 키로 해요. 내 계정에서 키를 등록해 주세요.`)
    if (seen) seen.own = true
    return { cfg: userGeminiConfig(key, settings.userAiModel), own: true }
  }
  /** AI 기능을 쓸 수 있는지. 사용자 키 모드면 서버 AI가 없어도 됨 */
  const aiOn = (call: Call) => call.services.settings.get().userAiKey || currentAi(call) !== null
  /** 사용자 키 AI 오류는 본인이 할 일을 알려 주는 문구로 */
  const ownError = (e: unknown, own: boolean) => (own && e instanceof AiError ? ownKeyError(e) : e)
  /** 기록용 대상·입력 요약, 사용자 키를 썼는지 */
  type Seen = { target: string; input: string; own: boolean }

  /** 기록용 '학교 입학년도 학과' */
  const schoolLabel = (name: string, cohort: number, track: string) => `${name} ${cohort}${track ? ` ${track}` : ''}`

  /** 편제표 AI 읽기 요청 제한. 관리자는 확인하느라 여러 번 읽어 제외 (서버 하루 한도는 그대로 셈) */
  const limitRead = (name: 'read' | 'import', call: Call) => {
    if (call.user && isAdmin(call.user)) return
    const max = name === 'read' ? '10분에 8번' : '10분에 6번'
    limit(name, call, `편제표 ${name === 'read' ? '자동 읽기' : '파일 읽기'}는 ${max}까지예요. 잠시 후 다시 해 주세요.`)
  }

  /** 문장으로 분야 찾기. 기록에는 찾은 분야만, 적은 문장은 안 남김. 10분 안에 또 찾으면 한 줄로 */
  const match = (call: Call) =>
    recorded(
      call,
      'match',
      async (seen) => {
        const res = await matchMajors(call, seen)
        const { majors } = (await res.clone().json()) as { majors: { id: string }[] }
        return { res, detail: majors.length ? `찾은 분야 ${majors.map((m) => MAJOR_BY_ID.get(m.id)?.name ?? m.id).join(', ')}` : '찾은 분야 없음' }
      },
      10,
    )

  async function matchMajors(call: Call, seen: Seen): Promise<Response> {
    const settings = call.services.settings.get()
    if (!settings.aiMatch || !aiOn(call)) throw new HttpError(503, '지금은 문장으로 찾기를 쓸 수 없어요. 키워드로 찾아 주세요.')
    const body = (await readJson(call.req, 4_000)) as { text?: unknown }
    const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : ''
    if (text.length < 2 || text.length > 200) throw new HttpError(400, '2~200자로 적어 주세요.')
    const key = text.toLowerCase()
    const cached = matchCache.get(key)
    if (cached) return json({ majors: cached })
    const { cfg, own } = aiFor(call, '문장으로 찾기', seen)
    if (!cfg) throw new HttpError(503, '지금은 문장으로 찾기를 쓸 수 없어요. 키워드로 찾아 주세요.')
    limit('match', call)
    const over = own ? null : takeDaily(call, 'match', settings.dailyMatchLimit)
    if (over) throw new HttpError(429, dailyMessage(over, '오늘 사용량을 다 썼어요. 키워드로 찾아 주세요.'))
    // 추론 모델은 생각에도 출력 토큰을 써서 넉넉히
    let out: string
    try {
      out = await chat(cfg, { system: MATCH_SYSTEM, user: text, maxTokens: 1200, timeoutMs: 25_000 }, fetchImpl)
    } catch (e) {
      throw ownError(e, own)
    }
    const parsed = extractJson(out) as { majors?: unknown }
    const majors: { id: string; why: string }[] = []
    for (const m of Array.isArray(parsed.majors) ? parsed.majors : []) {
      const id = m && typeof m === 'object' && 'id' in m && typeof m.id === 'string' ? m.id : ''
      if (!MAJOR_BY_ID.has(id) || majors.some((x) => x.id === id)) continue
      const whyRaw = m && typeof m === 'object' && 'why' in m && typeof m.why === 'string' ? m.why : ''
      majors.push({
        id,
        why: whyRaw
          .replace(/[\r\n\t]+/g, ' ')
          .trim()
          .slice(0, 40),
      })
      if (majors.length === 5) break
    }
    // 학과 키워드가 문장에 그대로 있으면 AI가 놓쳐도 맨 앞에 (예: '유치원 선생님' → 유아교육)
    for (const hit of keywordMajors(text).reverse())
      if (!majors.some((x) => x.id === hit.id)) {
        majors.unshift(hit)
        if (majors.length > 5) majors.pop()
      }
    matchCache.set(key, majors)
    return json({ majors })
  }

  /** 올린 파일 읽기. 기록에는 이미지 장수·글자 수와 결과만, 올린 내용은 안 남김 */
  const importCurriculum = (call: Call) => recorded(call, 'curriculum.import', (seen) => importFile(call, seen))

  async function importFile(call: Call, seen: Seen): Promise<{ res: Response; detail: string }> {
    const settings = call.services.settings.get()
    if (!settings.aiImport || !aiOn(call)) throw new HttpError(503, '지금은 파일 읽기를 쓸 수 없어요. 직접 입력해 주세요.')
    const { cfg, own } = aiFor(call, '파일 읽기', seen)
    if (!cfg) throw new HttpError(503, '지금은 파일 읽기를 쓸 수 없어요. 직접 입력해 주세요.')
    // 큰 본문을 다 받기 전에 요청 수부터 본다
    limitRead('import', call)
    const body = (await readJson(call.req, MAX_IMAGES * MAX_IMAGE_CHARS + MAX_TEXT * 4 + 2_000)) as {
      text?: unknown
      images?: unknown
      cohort?: unknown
      track?: unknown
    }
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : ''
    const images = Array.isArray(body.images) ? body.images : []
    seen.input = images.length ? `이미지 ${images.length}장` : `글 ${text.length.toLocaleString('ko-KR')}자`
    if (images.length > MAX_IMAGES) throw new HttpError(400, `이미지는 ${MAX_IMAGES}장까지 올릴 수 있어요.`)
    for (const img of images)
      if (typeof img !== 'string' || img.length > MAX_IMAGE_CHARS || !IMAGE_RE.test(img))
        throw new HttpError(400, '이미지 형식이 맞지 않아요. PNG, JPG, WEBP만 됩니다.')
    if (!text && !images.length) throw new HttpError(400, '편제표 파일이나 내용을 넣어 주세요.')
    const cohort = cohortOf(body.cohort) ?? schoolYear()
    const track = trackOf(body.track)
    seen.target = `${cohort}학년도 입학${track ? ` ${track}` : ''} 편제표`

    const over = own ? null : takeDaily(call, 'import', settings.dailyImportLimit)
    if (over) throw new HttpError(429, dailyMessage(over, '오늘 편제표 읽기 사용량을 다 썼어요. 직접 입력해 주세요.'))
    let out: string
    try {
      out = await chat(
        cfg,
        {
          system: importSystem(cohort, track),
          user: text ? `편제표 내용:\n${text}` : '첨부한 편제표 이미지를 옮겨 줘.',
          images: images as string[],
          // 한글 과목명이 토큰을 많이 먹어 큰 학교는 출력이 2만 토큰을 넘기도 함
          maxTokens: 32_000,
          timeoutMs: 180_000,
        },
        fetchImpl,
      )
    } catch (e) {
      throw ownError(e, own)
    }
    const raw = extractJson(out)
    const variants = variantsOf(raw)
    // 학과·과정별 표가 여럿인데 안 골랐으면 섞지 말고 고르게 함
    if (!track && variants.length >= 2) return { res: json({ status: 'choose', variants }), detail: `학과·과정을 골라야 함 (${variants.length}개)` }
    const school = schoolFromLoose(raw, { id: 'import', name: '불러온 학교', region: '', cohort })
    const filled = school.terms.some((t) => t.fixed.length || t.groups.length)
    if (!filled) throw new HttpError(422, '편제표에서 과목을 찾지 못했어요. 더 선명한 파일로 해 보세요.')
    const check = checkSchool(school)
    const subjects = new Set(school.terms.flatMap((t) => [...t.fixed.map((f) => f.subject), ...t.groups.flatMap((g) => g.options)])).size
    return {
      res: json({ status: 'ready', terms: school.terms, tracks: school.tracks, unknown: check.unknown, credits: check.credits, variants }),
      detail: `읽음 · 과목 ${subjects}개`,
    }
  }

  async function schools(call: Call): Promise<Response> {
    const q = (call.url.searchParams.get('q') ?? '').trim()
    if (q.length < 2 || q.length > 20 || !/^[가-힣A-Za-z0-9 ]+$/.test(q)) throw new HttpError(400, '학교 이름을 2자 이상 적어 주세요.')
    const cached = schoolCache.get(q)
    if (cached) return json({ schools: cached })
    limit('schools', call)
    let list: SchoolHit[]
    try {
      list = await searchSchools(q, call.ctx.env.NEIS_API_KEY, fetchImpl)
    } catch {
      throw new HttpError(502, '학교 검색 서버에 연결하지 못했어요.')
    }
    schoolCache.set(q, list)
    return json({ schools: list })
  }

  /**
   * 사용자가 보낸 학교 코드는 나이스로 다시 확인, 홈페이지 주소도 나이스 값만 믿음.
   * 나이스에 묻기 전에 요청 수를 셈 (코드를 바꿔 가며 나이스 한도를 쓰지 못하게). 나이스 오류는 캐시하지 않음
   */
  async function schoolRef(office: unknown, code: unknown, call: Call): Promise<SchoolRef> {
    if (typeof office !== 'string' || typeof code !== 'string' || !OFFICE_RE.test(office) || !CODE_RE.test(code))
      throw new HttpError(400, '학교 코드가 맞지 않아요.')
    const key = `${office}-${code}`
    const hit = schoolRefCache.get(key)
    if (hit) return hit
    if (schoolMissCache.get(key)) throw new HttpError(404, '나이스에서 이 학교를 찾지 못했어요.')
    limit('schools', call)
    let ref: SchoolRef | null
    try {
      ref = await schoolByCode(office, code, call.ctx.env.NEIS_API_KEY, fetchImpl)
    } catch {
      throw new HttpError(502, '나이스에서 학교 정보를 가져오지 못했어요.')
    }
    if (!ref) {
      schoolMissCache.set(key, true)
      throw new HttpError(404, '나이스에서 이 학교를 찾지 못했어요.')
    }
    schoolRefCache.set(key, ref)
    return ref
  }

  /**
   * 학과·과정 목록. 일반고에도 체육·예술처럼 편제표가 따로인 학급이 있어 모든 학교를 봄.
   * general: 일반 학급도 있는지 (있으면 화면에 '일반 학급' 선택지)
   */
  async function tracks(call: Call): Promise<Response> {
    const ref = await schoolRef(call.url.searchParams.get('office'), call.url.searchParams.get('code'), call)
    const cohort = cohortOf(Number(call.url.searchParams.get('cohort'))) ?? schoolYear()
    const key = `${ref.office}-${ref.code}-${cohort}`
    let found = trackCache.get(key)
    if (!found) {
      limit('schools', call)
      try {
        found = await (options.tracks ?? ((o, c, y) => schoolTracks(o, c, y, call.ctx.env.NEIS_API_KEY, fetchImpl)))(ref.office, ref.code, cohort)
      } catch {
        throw new HttpError(502, '나이스에서 학과 정보를 가져오지 못했어요.')
      }
      trackCache.set(key, found)
    }
    return json({ kind: ref.kind ?? '', ...found })
  }

  function curriculumGet(call: Call): Response {
    const { url } = call
    const office = url.searchParams.get('office') ?? ''
    const code = url.searchParams.get('code') ?? ''
    const cohort = cohortOf(Number(url.searchParams.get('cohort')))
    const track = trackOf(url.searchParams.get('track'))
    if (!OFFICE_RE.test(office) || !CODE_RE.test(code) || !cohort) throw new HttpError(400, '학교 코드가 맞지 않아요.')
    limit('curriculum', call)
    const found = call.services.store.latest(office, code, cohort, track)
    if (found) note(call, 'curriculum.open', schoolLabel(found.schoolName, cohort, track), `공유 편제표 #${found.id}`, 30)
    return json(found ? { status: 'ready', curriculum: publicCurriculum(found) } : { status: 'none' })
  }

  /**
   * 학교알리미 공시와 학교 홈페이지를 서버가 직접 둘러봐 편제표 후보를 모음 (6시간 기억).
   * 학교알리미는 모든 학교 의무 공시라 늘 보고, 홈페이지와 robots.txt 준수는 관리 설정에 따라
   */
  async function discoveryOf(ref: SchoolRef, cohort: number, track: string, call: Call): Promise<Found> {
    const { homepageSearch: homepageOn, obeyRobots } = call.services.settings.get()
    const key = `${ref.office}-${ref.code}-${cohort}-${track}-${homepageOn ? 'h' : ''}${obeyRobots ? 'r' : ''}-v2`
    const hit = discovered.get(key)
    if (hit) return hit
    const same = discovering.get(key)
    if (same) return same
    limit('discover', call)
    const school = `${ref.office}-${ref.code}`
    if (!crawlsPerSchool.take(school)) throw new HttpError(429, '이 학교 홈페이지를 지금 많이 찾고 있어요. 잠시 후 다시 해 주세요.')
    // 같은 학교를 다른 학과·설정으로 둘러보는 중이면 끝난 뒤에
    const before = crawling.get(school) ?? Promise.resolve()
    const run = before.catch(() => undefined).then(() => crawlSchool(ref, cohort, track, call, key))
    const tail = run.catch(() => undefined)
    crawling.set(school, tail)
    discovering.set(key, run)
    void tail.then(() => {
      discovering.delete(key)
      if (crawling.get(school) === tail) crawling.delete(school)
    })
    return run
  }

  async function crawlSchool(ref: SchoolRef, cohort: number, track: string, call: Call, key: string): Promise<Found> {
    const { homepageSearch: homepageOn, obeyRobots } = call.services.settings.get()
    const robots = obeyRobots ? (options.robots ?? checkRobots) : skipRobots
    const infoJar = new CookieJar()
    const [info, home] = await Promise.allSettled([
      (options.schoolInfo ?? ((s, c, x, t) => schoolInfoCandidates(s, c, x, new Date(), t)))(
        { name: ref.name, office: ref.office, code: ref.code },
        cohort,
        { jar: infoJar, deadline: Date.now() + 40_000 },
        track,
      ),
      !homepageOn
        ? Promise.reject(new FetchBlocked(''))
        : ref.homepage
          ? (options.discover ?? ((h, c, t) => discover(h, c, undefined, t, robots)))(ref.homepage, cohort, track)
          : Promise.reject(new FetchBlocked('나이스에 홈페이지 주소가 없어요.')),
    ])
    const notes: string[] = []
    const candidates: DocCandidate[] = []
    if (info.status === 'fulfilled') {
      candidates.push(...info.value.candidates)
      if (!info.value.id) notes.push('학교알리미에서 이 학교를 찾지 못했어요.')
      else if (!info.value.candidates.length) notes.push('학교알리미 공시에 읽을 수 있는 파일이 없어요.')
    } else notes.push(info.reason instanceof FetchBlocked ? info.reason.message : '학교알리미에 연결하지 못했어요.')
    if (home.status === 'fulfilled') candidates.push(...home.value.candidates)
    else if (homepageOn) notes.push(home.reason instanceof FetchBlocked ? home.reason.message : '학교 홈페이지를 열지 못했어요.')
    const found: Found = {
      candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 10),
      homepage: home.status === 'fulfilled' ? home.value : undefined,
      infoJar,
      notes: notes.filter(Boolean),
    }
    // 둘 다 연결 실패면 캐시하지 않음
    if (info.status === 'fulfilled' || home.status === 'fulfilled') discovered.set(key, found)
    return found
  }

  /** 편제표 파일 찾기. 30분 안에 같은 학교를 또 찾으면 기록 한 줄로 */
  const curriculumDiscover = (call: Call) => recorded(call, 'curriculum.find', (seen) => discoverFiles(call, seen), 30)

  async function discoverFiles(call: Call, seen: Seen): Promise<{ res: Response; detail: string }> {
    const body = (await readJson(call.req, 2_000)) as { office?: unknown; code?: unknown; cohort?: unknown; track?: unknown }
    const cohort = cohortOf(body.cohort)
    if (!cohort) throw new HttpError(400, '입학년도가 맞지 않아요.')
    const ref = await schoolRef(body.office, body.code, call)
    const track = trackOf(body.track)
    seen.target = schoolLabel(ref.name, cohort, track)
    const found = await discoveryOf(ref, cohort, track, call)
    const detail = found.candidates.length ? `파일 후보 ${found.candidates.length}개` : `파일 못 찾음${found.notes.length ? ` (${found.notes.join(' ')})` : ''}`
    const res = json({
      homepage: ref.homepage,
      candidates: found.candidates.map((c) => ({
        url: c.url,
        kind: c.kind,
        source: c.source,
        fileName: c.fileName,
        postTitle: c.postTitle,
        postUrl: c.postUrl,
      })),
      notes: found.notes,
    })
    return { res, detail }
  }

  /** 편제표 자동 읽기. 기록: 학교·파일 이름, 결과(공유·덜 읽힘 등) */
  const curriculumRead = (call: Call) => recorded(call, 'curriculum.read', (seen) => readCurriculum(call, seen))

  async function readCurriculum(call: Call, seen: Seen): Promise<{ res: Response; detail: string }> {
    const settings = call.services.settings.get()
    if (!settings.aiRead || !aiOn(call)) throw new HttpError(503, '지금은 자동 읽기를 쓸 수 없어요. 편제표 파일을 직접 올려 주세요.')
    const body = (await readJson(call.req, 4_000)) as { office?: unknown; code?: unknown; cohort?: unknown; track?: unknown; url?: unknown }
    const cohort = cohortOf(body.cohort)
    const track = trackOf(body.track)
    if (!cohort) throw new HttpError(400, '입학년도가 맞지 않아요.')
    if (typeof body.url !== 'string' || body.url.length > 2_000) throw new HttpError(400, '파일 주소가 맞지 않아요.')
    const ref = await schoolRef(body.office, body.code, call)
    seen.target = schoolLabel(ref.name, cohort, track)
    // 사용자가 준 주소가 아니라 서버가 이 학교 공시·홈페이지에서 찾은 파일인지로 판단.
    // 다른 학교 파일이나 아무 파일을 이 학교 편제표로 공유시키지 못하게
    const found = await discoveryOf(ref, cohort, track, call)
    const doc = found.candidates.find((c) => c.url === body.url)
    if (!doc) throw new HttpError(400, '이 학교 공시·홈페이지에서 찾은 파일만 읽을 수 있어요. 다른 파일은 직접 올려 주세요.')
    seen.input = `파일 ${(doc.fileName || doc.postTitle || doc.url).replace(/\s+/g, ' ').trim().slice(0, 60)}`

    const db = call.services.store
    const cached = db.bySource(ref.office, ref.code, cohort, track, doc.url)
    if (cached) return { res: json({ status: 'ready', curriculum: publicCurriculum(cached) }), detail: `이미 읽어 둔 편제표 #${cached.id}` }
    // 관리자가 숨긴 파일은 다시 읽지 않음 (다음 사람이 또 공유하지 않게)
    if (db.hiddenSource(ref.office, ref.code, cohort, track, doc.url))
      throw new HttpError(422, '관리자가 확인하고 숨긴 파일이에요. 다른 파일을 고르거나 편제표를 직접 입력해 주세요.')
    // 이미 공유된 편제표가 있으면 그것을 줌 (다른 파일로 바꿔 끼우지 못하게). 관리자는 확인용으로 다시 읽을 수 있음
    const isStaff = !!call.user && isAdmin(call.user)
    const shared = isStaff ? null : db.latest(ref.office, ref.code, cohort, track)
    if (shared) return { res: json({ status: 'ready', curriculum: publicCurriculum(shared) }), detail: `이미 공유된 편제표 #${shared.id}` }

    // 여기부터 AI. 사용자 키면 같은 파일도 사람마다 따로 읽음 (남의 키 오류를 받지 않게)
    const { cfg, own } = aiFor(call, '편제표 자동 읽기', seen)
    if (!cfg) throw new HttpError(503, '지금은 자동 읽기를 쓸 수 없어요. 편제표 파일을 직접 올려 주세요.')
    const key = `${own && call.user ? `u${call.user.id}-` : ''}${ref.office}-${ref.code}-${cohort}-${track}-${doc.url}`
    let job = inflight.get(key)
    const remembered = job ? undefined : readResults.get(key)
    if (remembered) job = Promise.resolve(remembered)
    if (!job) {
      limitRead('read', call)
      // 하루 한도는 파일을 받은 뒤 AI 직전에 셈 (못 받은 파일은 안 셈). 합계가 어긋나 다시 묻는 것도 셈
      const reserve = (followUp: boolean) => {
        const over = own ? null : takeDaily(call, 'read', settings.dailyReadLimit)
        if (!over) return true
        if (followUp) return false
        throw new HttpError(429, dailyMessage(over, '오늘 자동 읽기 사용량을 다 썼어요. 편제표 파일을 직접 올려 주세요.'))
      }
      const site: Site =
        doc.source === 'schoolinfo'
          ? { allow: schoolInfoSite, jar: found.infoJar }
          : {
              allow: fileSite(ref.homepage, found.homepage?.entry ?? ref.homepage),
              jar: found.homepage?.jar,
              check: settings.obeyRobots ? (options.robots ?? checkRobots) : undefined,
            }
      const target: ReadTarget = { url: doc.url, kind: doc.kind, images: doc.images, source: doc.source }
      job = options.read
        ? (reserve(false), options.read(ref, cohort, target, site, track))
        : readFromUrl(ref, cohort, target, site, cfg, { fetchImpl, reserve }, track)
      inflight.set(key, job)
      job.then(
        () => inflight.delete(key),
        () => inflight.delete(key),
      )
    }
    let result: ReadResult
    try {
      result = await job
    } catch (e) {
      if (e instanceof FetchBlocked) throw new HttpError(422, e.message)
      throw ownError(e, own)
    }
    // 공유하지 않는 결과는 한동안 기억 (공유한 것은 저장소에 있음)
    const remember = () => readResults.set(key, result)
    // 학과·과정별 표가 여럿인데 안 골랐으면 섞어 저장하지 말고 고르게 함
    if (!track && (result.variants?.length ?? 0) >= 2) {
      remember()
      return { res: json({ status: 'choose', variants: result.variants, url: doc.url }), detail: `학과·과정을 골라야 함 (${result.variants!.length}개)` }
    }
    // 과목이 하나도 없으면 편제표가 아닌 파일 (학과를 골랐으면 그 학과 표가 없는 파일)
    if (!result.data.terms.some((t) => t.fixed.length || t.groups.length)) {
      remember()
      throw new HttpError(422, track ? `이 파일에는 ${track} 편제표가 없어요.` : '이 파일에서 편제표를 찾지 못했어요.')
    }
    // 다른 해 입학생 표는 쓰지 않음
    if (result.year && result.year !== cohort) {
      remember()
      throw new HttpError(422, `이 파일은 ${result.year}학년도 입학생 편제표예요. 다른 파일을 고르거나 편제표를 직접 입력해 주세요.`)
    }
    const title = doc.postTitle.replace(/\s+/g, ' ').trim().slice(0, 120) || `${ref.name} 교육과정 편제표`
    const where = doc.source === 'schoolinfo' ? ref.name : `${ref.name} 홈페이지`
    const school = { ...result.data, ...(track ? { track } : {}), source: { title: `${where} · ${title}`, url: doc.postUrl } }
    // 알아본 표준 과목이 너무 적으면 잘못 읽은 것 (특성화고·학과는 전문 교과가 많아 기준을 낮춤)
    const subjects = new Set(school.terms.flatMap((t) => [...t.fixed.map((f) => f.subject), ...t.groups.flatMap((g) => g.options)]))
    const known = [...subjects].filter((n) => SUBJECT_BY_NAME.has(n)).length
    const vocational = !!track || /특성화|마이스터/.test(ref.kind ?? '')
    const fewKnown = known < (vocational ? MIN_KNOWN_VOCATIONAL : MIN_KNOWN)
    if (!looksComplete(school) || result.mismatch?.length || fewKnown) {
      remember()
      // 덜 읽혔거나 표의 합계와 다르면 공유하지 않고 요청한 사람에게만 돌려줌 (고쳐 쓰게)
      return {
        res: json({ status: 'partial', school, unknown: result.unknown, mismatch: result.mismatch ?? [] }),
        detail: result.mismatch?.length ? '합계가 맞지 않아 공유하지 않음' : '덜 읽혀 공유하지 않음',
      }
    }
    // 읽는 사이 다른 사람이 공유했는지 다시 확인 (동시 요청의 중복 저장 방지)
    const sharedNow = isStaff ? null : db.latest(ref.office, ref.code, cohort, track)
    if (sharedNow) return { res: json({ status: 'ready', curriculum: publicCurriculum(sharedNow) }), detail: `이미 공유된 편제표 #${sharedNow.id}` }
    const saved =
      db.bySource(ref.office, ref.code, cohort, track, doc.url) ??
      db.insert({
        office: ref.office,
        code: ref.code,
        cohort,
        track,
        schoolName: ref.name,
        region: ref.region,
        data: school,
        sourceUrl: doc.url,
        pageUrl: doc.postUrl,
        sourceTitle: title,
        method: 'school-site',
        model: cfg.visionModel,
        readBy: call.user?.id ?? 0,
      })
    return { res: json({ status: 'ready', curriculum: publicCurriculum(saved), unknown: result.unknown }), detail: `읽어서 공유 #${saved.id}` }
  }

  async function curriculumReport(call: Call): Promise<Response> {
    const body = (await readJson(call.req, 2_000)) as { id?: unknown; reason?: unknown }
    if (typeof body.id !== 'number' || !Number.isInteger(body.id) || typeof body.reason !== 'string' || !body.reason.trim())
      throw new HttpError(400, '무엇이 틀렸는지 적어 주세요.')
    limit('report', call)
    call.services.store.report(body.id, body.reason.trim())
    note(call, 'curriculum.report', `편제표 #${body.id}`, body.reason.replace(/\s+/g, ' ').trim().slice(0, 100))
    return json({ ok: true })
  }

  /** 스크립트용 공유 편제표 숨기기. ADMIN_TOKEN 16자 이상, 비교는 timingSafeEqual. 관리 화면은 로그인을 씀 */
  async function adminHide(call: Call): Promise<Response> {
    const token = call.ctx.env.ADMIN_TOKEN ?? ''
    const given = (call.req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const a = Buffer.from(given)
    const b = Buffer.from(token)
    if (token.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, '권한이 없어요.')
    const body = (await readJson(call.req, 1_000)) as { id?: unknown }
    if (typeof body.id !== 'number' || !Number.isInteger(body.id)) throw new HttpError(400, 'id가 필요해요.')
    return json({ ok: call.services.store.hide(body.id) })
  }

  /** 화면이 기능을 켜고 끄는 데 쓰는 공개 정보 */
  function health(call: Call): Response {
    const cfg = currentAi(call)
    const s = call.services.settings.get()
    // 사용자 키 모드면 서버 AI 없이도 켜짐
    const ai = cfg !== null || s.userAiKey
    return json({
      ai,
      // Gemini 무료 등급은 보낸 내용·답을 Google이 제품 개선에 쓰고 사람이 검토할 수 있음 (개인정보 안내용)
      aiTraining: s.userAiKey || cfg?.kind === 'google',
      // 자동 읽기·파일 읽기·문장으로 찾기를 각자 Gemini 키로 하는지
      userKey: s.userAiKey,
      // Google 로그인 가능 여부 (GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET)
      login: googleReady(call.ctx.env),
      read: ai && s.aiRead,
      import: ai && s.aiImport,
      match: ai && s.aiMatch,
      signup: s.signupOpen,
      notice: s.notice,
    })
  }

  const routes: Record<string, Route> = {
    'GET /api/health': health,
    'POST /api/match': match,
    'POST /api/import': importCurriculum,
    'GET /api/schools': schools,
    'GET /api/school-tracks': tracks,
    'GET /api/curriculum': curriculumGet,
    'POST /api/curriculum/discover': curriculumDiscover,
    'POST /api/curriculum/read': curriculumRead,
    'POST /api/curriculum/report': curriculumReport,
    'POST /api/admin/hide': adminHide,
    ...accountRoutes({ fetch: fetchImpl }),
    ...dataRoutes(),
    ...adminRoutes({
      usage: (s) => ({ read: usageOf(s).used('all:read'), import: usageOf(s).used('all:import'), match: usageOf(s).used('all:match') }),
      fetch: fetchImpl,
    }),
  }

  return async function handleApi(req: Request, ctx: ApiContext): Promise<Response> {
    const url = new URL(req.url)
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req, url, ctx.env)) throw new HttpError(403, '허용되지 않은 요청이에요.')
      const key = `${req.method} ${url.pathname}`
      const route = routes[key]
      if (!route) return json({ error: '없는 주소예요.' }, 404)
      const s = await prepare(ctx.env)
      const token = readCookie(req, sessionCookieName(!!ctx.secure))
      const user = token ? s.accounts.sessionUser(token) : null
      // PUBLIC_ROUTES 밖은 모두 로그인 필요
      if (!user && !PUBLIC_ROUTES.has(key)) return json({ error: '로그인이 필요해요.' }, 401)
      return await route({ req, url, ctx, services: s, user, token: user ? token : null })
    } catch (e) {
      if (e instanceof HttpError || e instanceof AiError) return json({ error: e.message }, e.status)
      console.error(`[api] ${req.method} ${url.pathname} failed`)
      return json({ error: '서버 오류가 났어요.' }, 500)
    }
  }
}
