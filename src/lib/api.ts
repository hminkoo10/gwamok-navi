import type { School, Term, TermId, Track } from '../data/schema'

// 서버 /api 호출. 서버가 없거나(정적 배포) 키가 없으면 AI 기능을 숨기고 키워드 검색만 쓴다.

export class ApiError extends Error {
  readonly status: number
  /** 서버가 오류와 함께 보낸 본문 (예: 409의 계정 설계) */
  readonly body: unknown

  constructor(status: number, message: string, body: unknown = null) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** 로그인이 끝났다는 신호 (서버가 401로 답하면 화면이 로그인 화면으로 보낸다) */
export const AUTH_LOST = 'gwamok:auth-lost'

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했어요.')
  }
  // 로그인해야 쓰는 서비스라, 세션이 끝났으면(만료·정지·다른 기기에서 탈퇴) 다시 로그인하게 한다
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(AUTH_LOST))
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !data) throw new ApiError(res.status, data?.error ?? '요청을 처리하지 못했어요.', data)
  return data
}

export const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** 서버가 알려 주는 기능 켜짐 여부와 공지 (관리자 설정에 따라 바뀐다) */
export interface Features {
  /** /api 서버가 있는지 (정적 배포면 없음) */
  server: boolean
  /** AI가 연결돼 있는지 */
  ai: boolean
  /** 지금 AI 공급자가 보낸 내용을 제품 개선에 쓰고 사람이 검토할 수 있는지 (Gemini API 무료 등급) */
  aiTraining: boolean
  /** 학교 편제표 자동 읽기 */
  read: boolean
  /** 올린 파일 읽기 */
  import: boolean
  /** 문장으로 분야 찾기 */
  match: boolean
  /** 편제표 자동 읽기·파일 읽기·문장으로 찾기를 각 사용자가 등록한 Gemini API 키로 하는지 (관리자 설정) */
  userKey: boolean
  /** Google 로그인을 쓸 수 있는지 (서버에 Google 앱 키가 있어야 한다) */
  login: boolean
  signup: boolean
  notice: string
}

export const NO_FEATURES: Features = {
  server: false,
  ai: false,
  aiTraining: false,
  read: false,
  import: false,
  match: false,
  userKey: false,
  login: false,
  signup: false,
  notice: '',
}

/**
 * 서버 기능 확인. /api가 아예 없는 정적 배포(/api/health가 404이거나 index.html이 옴)면 NO_FEATURES.
 * 서버에 닿지 못했거나 서버 오류면 ApiError를 던진다 (그때 로그인 없이 열어 주면 안 된다)
 */
export async function health(): Promise<Features> {
  let res: Response
  try {
    res = await fetch('/api/health')
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했어요.')
  }
  const json = (res.headers.get('content-type') ?? '').includes('json')
  if (!json && (res.status === 404 || res.ok)) return NO_FEATURES
  const h = (await res.json().catch(() => null)) as Partial<Features> | null
  if (!res.ok || !h || typeof h !== 'object') throw new ApiError(res.status, '서버에 연결하지 못했어요.')
  return {
    server: true,
    ai: !!h.ai,
    aiTraining: !!h.aiTraining,
    read: !!h.read,
    import: !!h.import,
    match: !!h.match,
    userKey: !!h.userKey,
    login: !!h.login,
    signup: h.signup !== false,
    notice: typeof h.notice === 'string' ? h.notice.slice(0, 200) : '',
  }
}

// ---- 계정 ----

/** owner: 대표 관리자 (관리자 지정·취소), admin: 지정된 관리자, user: 일반 */
export type Role = 'user' | 'admin' | 'owner'

/** 내 계정에 등록한 Gemini API 키 (키 값은 오지 않고 끝 4자리만) */
export interface AiKeyInfo {
  hint: string
  addedAt: string
  /** 서버가 지금 이 키를 쓸 수 있는지 (서버 비밀값이 바뀌면 다시 등록해야 한다) */
  ok: boolean
}

export interface Me {
  id: number
  /** 로그인한 Google 계정 이메일 */
  email: string
  /** 가입할 때 적은 실명 (예전에 가입한 사람은 빈 문자열) */
  name: string
  role: Role
  createdAt: string
  aiKey?: AiKeyInfo | null
}

export const isAdminRole = (role: Role) => role === 'admin' || role === 'owner'

export const ROLE_TEXT: Record<Role, string> = { owner: '대표 관리자', admin: '관리자', user: '일반 계정' }

/** Google 로그인을 시작하는 주소 (페이지를 옮긴다). 끝나면 next로 돌아온다 */
export const googleLoginUrl = (next?: string | null) => `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`

export const auth = {
  me: () => call<{ user: Me | null }>('/api/auth/me'),
  /** Google 로그인은 했지만 아직 가입 동의를 하지 않은 계정 */
  pending: () => call<{ pending: { email: string; next: string } | null }>('/api/auth/pending'),
  complete: (b: { agreeAge: boolean; agreePrivacy: boolean; name: string }) => call<{ user: Me; next: string }>('/api/auth/complete', postJson(b)),
  /** 내 이름(실명) 적기·바꾸기 */
  setName: (name: string) => call<{ user: Me }>('/api/me/name', postJson({ name })),
  logout: () => call<{ ok: boolean }>('/api/auth/logout', postJson({})),
  deleteAccount: () => call<{ ok: boolean }>('/api/auth/delete', postJson({ confirm: true })),
}

/** 내 Gemini API 키 등록·지우기 (등록할 때 서버가 Google에 짧게 물어 맞는 키인지 확인한다) */
export const myAiKey = {
  save: (apiKey: string) => call<{ aiKey: AiKeyInfo; note: string }>('/api/me/ai-key', postJson({ apiKey })),
  remove: () => call<{ aiKey: null }>('/api/me/ai-key/delete', postJson({})),
}

/** 계정에 저장한 설계와 그 판 (updatedAt: 저장할 때마다 커진다) */
export interface SavedData {
  data: unknown
  updatedAt: string
}

/** 페이지를 닫는 중에도 끝까지 보내는 요청(keepalive)의 본문 상한. 브라우저는 모두 합쳐 64KB까지만 받는다 */
const KEEPALIVE_MAX = 60_000

/** 오래 걸리는 요청은 끊고 다시 한다 (끊기지 않은 연결이 저장을 계속 붙잡지 않게) */
const timeout = (ms: number) => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined)

/** 계정에 저장한 설계 (고른 학교·분야·대학과 편제표) */
export const myData = {
  get: () => call<{ saved: SavedData | null }>('/api/me/data', { signal: timeout(20_000) }),
  /**
   * base: 이 탭이 마지막으로 받거나 저장한 판 (계정이 비어 있다고 알면 null). 계정 판이 다르면 서버가 409와 계정 설계를 돌려준다.
   * keepalive: 탭을 닫는 중이면 본문이 작을 때만 keepalive로 보낸다 (크면 보통 요청으로)
   */
  put: (data: unknown, base: string | null, opts: { keepalive?: boolean } = {}) => {
    const body = JSON.stringify({ data, base })
    const keepalive = !!opts.keepalive && new TextEncoder().encode(body).length <= KEEPALIVE_MAX
    return call<{ updatedAt: string }>('/api/me/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive,
      signal: timeout(30_000),
    })
  },
}

export function matchMajors(text: string) {
  return call<{ majors: { id: string; why: string }[] }>('/api/match', postJson({ text }))
}

export interface ImportResult {
  status: 'ready'
  terms: Term[]
  tracks: Track[]
  unknown: string[]
  credits: Record<TermId, number>
  variants: string[]
}

/** 학과·과정별 표가 여러 개라 골라야 할 때 */
export interface ImportChoose {
  status: 'choose'
  variants: string[]
}

export function importCurriculum(input: { text?: string; images?: string[]; cohort: number; track?: string }) {
  return call<ImportResult | ImportChoose>('/api/import', postJson(input))
}

export interface SchoolHit {
  office: string
  code: string
  /** 전형 자격에 쓰는 고교 유형 (일반고·자율고·특성화고·마이스터고·과학고·외고·국제고·예술고·체육고, 모르면 빈 문자열) */
  schoolType?: string
  name: string
  region: string
  address: string
  homepage: string
  type: string
}

export function searchSchools(q: string) {
  return call<{ schools: SchoolHit[] }>(`/api/schools?q=${encodeURIComponent(q)}`)
}

// ---- 학교 교육과정 자동 불러오기 ----

export interface SharedCurriculum {
  id: number
  school: School
  sourceUrl: string
  pageUrl: string
  sourceTitle: string
  createdAt: string
  /** 관리자가 원문과 맞춰 본 편제표 */
  verified?: boolean
}

export type CurriculumStatus = { status: 'none' } | { status: 'ready'; curriculum: SharedCurriculum; unknown?: string[] }

export interface Candidate {
  url: string
  kind: 'pdf' | 'xlsx' | 'images' | 'table' | 'hwp'
  source: 'homepage' | 'schoolinfo'
  fileName: string
  postTitle: string
  postUrl: string
}

export interface SchoolKey {
  office: string
  code: string
  cohort: number
  /** 학과·계열 (특성화고·특목고) */
  track?: string
}

/** 특성화고·특목고면 학과 목록, 일반고면 빈 목록 */
/** 학교의 학과·과정 (나이스 학급 정보). general: 일반 학급도 있는지 */
export interface TrackInfo {
  kind: string
  tracks: string[]
  /** 학과마다 그 학년 학급 수 */
  classes: Record<string, number>
  general: boolean
  generalClasses?: number
  source: 'classes' | 'majors' | 'none'
}

export function getTracks(office: string, code: string, cohort: number) {
  const q = new URLSearchParams({ office, code, cohort: String(cohort) })
  return call<TrackInfo>(`/api/school-tracks?${q}`)
}

export function getCurriculum(k: SchoolKey) {
  const q = new URLSearchParams({ office: k.office, code: k.code, cohort: String(k.cohort), track: k.track ?? '' })
  return call<CurriculumStatus>(`/api/curriculum?${q}`)
}

export function discoverCurriculum(k: SchoolKey) {
  return call<{ homepage: string; candidates: Candidate[]; notes: string[] }>('/api/curriculum/discover', postJson(k))
}

/** 표의 학기별 합계와 다르게 읽힌 학기 */
export interface Mismatch {
  term: string
  table: number
  read: number
}

export type ReadOutcome =
  | CurriculumStatus
  | { status: 'partial'; school: School; unknown: string[]; mismatch?: Mismatch[] }
  /** 문서에 학과·과정별 표가 여러 개라 골라야 할 때 */
  | { status: 'choose'; variants: string[]; url: string }

export function readCurriculum(k: SchoolKey & { url: string }, signal?: AbortSignal) {
  return call<ReadOutcome>('/api/curriculum/read', { ...postJson(k), signal })
}

export function reportCurriculum(id: number, reason: string) {
  return call<{ ok: boolean }>('/api/curriculum/report', postJson({ id, reason }))
}

// ---- 대입 자료 소식 ----

export interface DataUpdate {
  id: number
  dataset: string
  key: string
  summary: string
  createdAt: string
}

export function dataUpdates(limit = 30) {
  return call<{ entries: DataUpdate[] }>(`/api/data/updates?limit=${limit}`)
}
