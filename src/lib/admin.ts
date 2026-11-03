import { call, type Me, postJson } from './api'

// 관리 화면 API (관리자 로그인 필요)

export interface AdminUser extends Me {
  disabled: boolean
  lastLoginAt: string | null
  /** 계정에 설계를 저장했는지 */
  saved: boolean
}

export interface SettingField {
  key: string
  type: 'bool' | 'int' | 'text'
  group: string
  label: string
  help: string
  min?: number
  max?: number
}

export type SettingValues = Record<string, boolean | number | string>

export interface LogEntry {
  id: number
  /** admin: 관리자가 바꾼 것, user: 사용자가 한 일 */
  kind: 'admin' | 'user'
  /** 한 사람의 이메일. 탈퇴·삭제한 계정이면 그 사실만 */
  who: string
  /** 그 사람의 지금 이름 (없으면 빈 문자열) */
  name: string
  action: string
  target: string
  detail: string
  /** 짧은 사이 같은 일을 되풀이한 횟수 (한 줄로 묶음) */
  times: number
  createdAt: string
}

export interface Overview {
  users: { total: number; admins: number; disabled: number; new7d: number; active7d: number }
  sessions: number
  curricula: { schools: number; total: number; hidden: number; verified: number; openReports: number }
  usage: { read: number; import: number; match: number }
  limits: { read: number; import: number; match: number }
  ai: boolean
  /** 자기 Gemini API 키를 등록한 사람 수 */
  userKeys: number
  settings: SettingValues
  log: LogEntry[]
}

export interface CurriculumSummary {
  id: number
  office: string
  code: string
  cohort: number
  track: string
  schoolName: string
  region: string
  sourceTitle: string
  pageUrl: string
  method: string
  createdAt: string
  verified: boolean
  hidden: boolean
  reports: number
  openReports: number
}

export interface CurriculumItem {
  id: number
  office: string
  code: string
  cohort: number
  track: string
  schoolName: string
  region: string
  data: unknown
  sourceUrl: string
  pageUrl: string
  sourceTitle: string
  method: string
  model: string
  createdAt: string
  verified?: boolean
  hidden?: boolean
}

export interface ReportEntry {
  id: number
  curriculumId: number
  schoolName: string
  cohort: number
  track: string
  reason: string
  createdAt: string
  resolved: boolean
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export type AiKind = 'openai' | 'anthropic' | 'google'

/** 관리자가 넣은 AI 연결. 키는 끝 4자리(keyHint)만 온다 */
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
  keyHint: string
  keyOk: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface AiState {
  providers: AiProvider[]
  /** 환경변수(.env)에 적힌 연결 요약 (없으면 null) */
  env: { host: string; model: string; visionModel: string } | null
  active: number | null
  /** 지금 쓰는 연결. null이면 AI 꺼짐 */
  using: { name: string; kind: AiKind; model: string } | null
  /** 고른 연결의 키를 풀 수 없어 AI가 꺼진 상태 */
  broken: boolean
}

export interface AiProviderDraft {
  kind: AiKind
  name: string
  baseUrl: string
  model: string
  visionModel: string
  apiKey: string
  maxTokensParam: 'max_tokens' | 'max_completion_tokens'
  jsonMode: boolean
  textEffort: string
  visionEffort: string
}

export interface AiTestResult {
  ok: boolean
  ms: number
  model: string
  reply?: string
  error?: string
  detail?: string
}

export const adminApi = {
  overview: () => call<Overview>('/api/admin/overview'),

  users: async (params: { q?: string; role?: string; status?: string; offset?: number }): Promise<Page<AdminUser>> => {
    const r = await call<{ users: AdminUser[]; total: number; page: number }>(`/api/admin/users${qs(params)}`)
    return { items: r.users, total: r.total, page: r.page }
  },
  /** 관리자 지정·취소 (대표 관리자만) */
  setRole: (id: number, role: 'user' | 'admin') => call<{ user: AdminUser }>('/api/admin/users/role', postJson({ id, role })),
  /** 이용 정지·풀기 */
  setDisabled: (id: number, disabled: boolean) => call<{ user: AdminUser }>('/api/admin/users/update', postJson({ id, disabled })),
  deleteUser: (id: number) => call<{ ok: boolean }>('/api/admin/users/delete', postJson({ id })),

  settings: () => call<{ values: SettingValues; fields: SettingField[] }>('/api/admin/settings'),
  saveSettings: (values: SettingValues) => call<{ values: SettingValues; changed: string[] }>('/api/admin/settings', postJson({ values })),

  curricula: (params: { q?: string; status?: string; offset?: number }) => call<Page<CurriculumSummary>>(`/api/admin/curricula${qs(params)}`),
  curriculum: (id: number) => call<{ item: CurriculumItem }>(`/api/admin/curricula/item${qs({ id })}`),
  updateCurriculum: (id: number, patch: { hidden?: boolean; verified?: boolean }) =>
    call<{ item: CurriculumItem }>('/api/admin/curricula/update', postJson({ id, ...patch })),
  editCurriculum: (id: number, data: unknown) => call<{ item: CurriculumItem }>('/api/admin/curricula/edit', postJson({ id, data })),

  reports: (params: { status?: string; offset?: number }) => call<Page<ReportEntry>>(`/api/admin/reports${qs(params)}`),
  updateReport: (id: number, resolved: boolean) => call<{ ok: boolean }>('/api/admin/reports/update', postJson({ id, resolved })),

  ai: () => call<AiState>('/api/admin/ai'),
  createAi: (draft: AiProviderDraft) => call<AiState>('/api/admin/ai/create', postJson(draft)),
  updateAi: (id: number, draft: AiProviderDraft) => call<AiState>('/api/admin/ai/update', postJson({ id, ...draft })),
  deleteAi: (id: number) => call<AiState>('/api/admin/ai/delete', postJson({ id })),
  /** null이면 환경변수 설정을 쓴다 */
  selectAi: (id: number | null) => call<AiState>('/api/admin/ai/select', postJson({ id })),
  testAi: (id: number | null) => call<AiTestResult>('/api/admin/ai/test', postJson({ id })),

  /** kind: admin·user, group: 사용자 로그의 행동 묶음 (account·design·curriculum·ai) */
  log: async (p: { offset?: number; kind?: string; group?: string; q?: string } = {}): Promise<Page<LogEntry>> => {
    const r = await call<{ entries: LogEntry[]; total: number; page: number }>(`/api/admin/log${qs(p)}`)
    return { items: r.entries, total: r.total, page: r.page }
  },
}

export const ACTION_LABEL: Record<string, string> = {
  'user.grant': '관리자 지정',
  'user.revoke': '관리자 취소',
  'user.disable': '이용 정지',
  'user.enable': '정지 풀기',
  'user.delete': '사용자 지우기',
  settings: '설정 바꾸기',
  'curriculum.hide': '편제표 숨기기',
  'curriculum.show': '편제표 다시 보이기',
  'curriculum.verify': '편제표 확인 표시',
  'curriculum.unverify': '확인 표시 풀기',
  'curriculum.edit': '편제표 고치기',
  'report.resolve': '신고 처리',
  'report.reopen': '신고 다시 열기',
  'data.plan': '전형 자료 고치기',
  'data.revert': '전형 자료 되돌리기',
  'sources.check': '원문 확인',
  'sources.add': '감시 원문 추가',
  'sources.remove': '감시 원문 삭제',
  'data.check': 'AI로 원문 확인',
  'data.apply': 'AI 제안 반영',
  'data.dismiss': 'AI 제안 버리기',
  'data.import': '전형 가져오기',
  'data.verify': 'AI가 옮긴 자료 확인',
  'data.review': 'AI 검수',
  'ai.create': 'AI 연결 추가',
  'ai.update': 'AI 연결 고치기',
  'ai.delete': 'AI 연결 지우기',
  'ai.select': 'AI 연결 바꾸기',
  'ai.test': 'AI 연결 시험',
  // 사용자가 한 일
  'auth.signup': '가입',
  'auth.login': '로그인',
  'auth.logout': '로그아웃',
  'auth.delete': '탈퇴',
  'plan.save': '설계 저장',
  'curriculum.open': '편제표 불러오기',
  'curriculum.find': '편제표 찾기',
  'curriculum.read': '편제표 자동 읽기',
  'curriculum.import': '파일 올려 읽기',
  'curriculum.report': '편제표 신고',
  match: '문장으로 분야 찾기',
  'ai-key.save': 'Gemini 키 등록',
  'ai-key.delete': 'Gemini 키 지우기',
  'account.name': '이름 바꾸기',
  'design.school': '학교 고르기',
  'design.majors': '분야 고르기',
  'design.univs': '대학 고르기',
  'design.units': '학과 고르기',
  'design.pin': '꼭 듣기',
  'design.exclude': '빼기',
  'design.focus': '목표 전형',
  'design.keepAll': '권장과목 함께 채우기',
  'design.slot': '슬롯',
  'design.picks': '원서 후보',
  'design.profile': '내 조건',
  'design.curriculum': '편제표 직접 넣기',
}

export const METHOD_LABEL: Record<string, string> = {
  manual: '사람이 확인해 넣음',
  'school-site': '자동 읽기',
}

// ---- 대입 자료·원문 감시 ----

export interface WatchRow {
  key: string
  univ: string
  title: string
  url: string
  custom?: boolean
  status: string
  checkedAt: string | null
  changedAt: string | null
  pending: boolean
  detail: string
}

export interface ChangeLine {
  track: string
  field: string
  before: string
  after: string
}

export interface Proposal {
  id: number
  univ: string
  createdAt: string
  status: 'pending' | 'applied' | 'dismissed' | 'failed' | 'none'
  summary: string
  lines: ChangeLine[]
  pages: number[]
  detail: string
  decidedAt: string | null
  decidedBy: string
}

export interface DataOverview {
  admissions: {
    version: string
    updatedAt: string
    /** ai: AI가 옮기고 아직 사람이 확인하지 않은 자료면 옮긴 날, aiCheck: 더 좋은 AI가 원문과 대조해 검수한 날 */
    plans: { univ: string; planTitle: string; date: string; tracks: number; url: string; ai: string | null; aiCheck: string | null }[]
    overrides: { key: string; updatedAt: string; updatedBy: string }[]
  }
  sources: WatchRow[]
  pending: number
  updates: { id: number; dataset: string; key: string; summary: string; createdAt: string }[]
  proposals: Proposal[]
  /** 지금 AI로 확인 중인 대학 */
  checking: string[]
  /** 서버에 AI가 설정돼 있는지 */
  ai: boolean
}

/** 전형 자료가 없는 대학 가져오기: 대학별 진행 상태 */
export interface ImportRow {
  univ: string
  name: string
  status: 'waiting' | 'running' | 'done' | 'failed' | 'skipped'
  /** 원문 주소. 비어 있으면 대교협 저장소에서 대학 이름으로 찾는다 */
  url: string
  custom: boolean
  detail: string
  tracks: number
  tries: number
  updatedAt: string | null
}

/** AI가 옮긴 대학 하나의 검수 상태 */
export interface CheckRow {
  univ: string
  status: 'waiting' | 'running' | 'done' | 'failed'
  /** 고친 곳 수 */
  changes: number
  detail: string
  tries: number
  model: string
  updatedAt: string | null
}

export interface DataImports {
  checks: CheckRow[]
  /** 검수 상태. current: 지금 검수하는 대학, note: 멈춘 까닭, ai: 검수 AI */
  verify: { enabled: boolean; limit: number; doneToday: number; current: string | null; note: string; ai: { name: string; model: string } | null }
  rows: ImportRow[]
  /** model: 마지막으로 답한 모델 (무료 Gemini 한도에 걸리면 다른 무료 모델로 바뀐다) */
  state: { enabled: boolean; limit: number; doneToday: number; current: string | null; note: string; model: string }
  /** 지금 쓰는 AI 연결 (없으면 null) */
  ai: { name: string; model: string } | null
}

export const dataAdmin = {
  overview: () => call<DataOverview>('/api/admin/data'),
  imports: () => call<DataImports>('/api/admin/data/imports'),
  toggleImports: (on: boolean) => call<{ state: DataImports['state'] }>('/api/admin/data/imports/toggle', postJson({ on })),
  /** url을 주면 그 주소를 먼저 쓴다 */
  runImport: (univ: string, url?: string) => call<{ started: boolean }>('/api/admin/data/imports/run', postJson({ univ, url })),
  verifyPlan: (univ: string) => call<{ version: string }>('/api/admin/data/imports/verify', postJson({ univ })),
  /** 더 좋은 AI로 지금 검수 */
  reviewPlan: (univ: string) => call<{ started: boolean }>('/api/admin/data/verify/run', postJson({ univ })),
  /** tag: 불러온 판. 저장할 때 base로 돌려주면 그사이 바뀐 자료를 덮어쓰지 않는다 */
  plan: (univ: string) => call<{ plan: unknown; tag?: string }>(`/api/admin/data/plan?univ=${encodeURIComponent(univ)}`),
  savePlan: (univ: string, plan: unknown, summary: string, base?: string) =>
    call<{ version: string }>('/api/admin/data/plan', postJson({ univ, plan, summary, base })),
  revert: (univ: string) => call<{ ok: boolean }>('/api/admin/data/revert', postJson({ univ })),
  check: () => call<{ checked: number; changed: number; sources: WatchRow[] }>('/api/admin/sources/check', postJson({})),
  ack: (key: string) => call<{ ok: boolean }>('/api/admin/sources/ack', postJson({ key })),
  addSource: (url: string, title: string, univ: string) => call<{ source: WatchRow }>('/api/admin/sources/add', postJson({ url, title, univ })),
  removeSource: (key: string) => call<{ ok: boolean }>('/api/admin/sources/remove', postJson({ key })),
  checkPlan: (univ: string) => call<{ started: boolean; checking: string[] }>('/api/admin/data/proposals/check', postJson({ univ })),
  applyProposal: (id: number) => call<{ proposal: Proposal; version: string }>('/api/admin/data/proposals/apply', postJson({ id })),
  dismissProposal: (id: number) => call<{ proposal: Proposal }>('/api/admin/data/proposals/dismiss', postJson({ id })),
}
