import type { DatabaseSync } from 'node:sqlite'

// 관리자가 화면에서 바꾸는 운영 설정. 값은 저장소에 두고, 없으면 기본값(일부는 환경변수)을 쓴다.

export interface Settings {
  /** 모든 화면 위 공지. 빈 문자열이면 없음 */
  notice: string
  signupOpen: boolean
  /** 학교 편제표 자동 읽기 (학교알리미·홈페이지 파일을 AI로) */
  aiRead: boolean
  /** 학교 홈페이지에서도 편제표 찾기 (끄면 학교알리미 공시만) */
  homepageSearch: boolean
  /** 학교 홈페이지 robots.txt 지키기 (끄면 막힌 곳의 공개 교육과정 자료까지 찾음) */
  obeyRobots: boolean
  /** 사용자가 올린 파일·글을 AI로 읽기 */
  aiImport: boolean
  /** 진로 문장으로 분야 찾기 */
  aiMatch: boolean
  /** 편제표 자동 읽기·파일 읽기·문장으로 찾기에 서버 AI 대신 각 사용자가 등록한 Gemini 키를 씀 */
  userAiKey: boolean
  /** 사용자 키로 부를 Gemini 모델 */
  userAiModel: string
  dailyReadLimit: number
  dailyImportLimit: number
  dailyMatchLimit: number
  /** 원문 파일이 바뀌면 바뀐 쪽을 AI로 읽어 고칠 곳 제안 */
  aiData: boolean
  /** AI 제안이 자료 검사를 통과하면 관리자 확인 없이 반영 */
  autoApplyData: boolean
  dailyDataLimit: number
  /** 전형 자료가 없는 대학의 시행계획을 받아 AI로 옮겨 넣기 (하루 한도 안에서 차례로) */
  planImport: boolean
  dailyPlanImports: number
  /** AI가 옮긴 전형을 더 좋은 AI(유료 연결)로 원문과 대조해 고치고 확인 표시 */
  planVerify: boolean
  dailyPlanVerifies: number
}

export type SettingKey = keyof Settings

export interface SettingField {
  key: SettingKey
  type: 'bool' | 'int' | 'text'
  group: string
  label: string
  help: string
  min?: number
  max?: number
  /** 글 값이 맞아야 하는 모양 (정규식) */
  pattern?: string
}

export const SETTING_FIELDS: SettingField[] = [
  { key: 'notice', type: 'text', group: '공지', label: '공지 문구', help: '모든 화면 맨 위에 띄워요. 비우면 공지가 없어요.', max: 200 },
  {
    key: 'signupOpen',
    type: 'bool',
    group: '회원',
    label: '회원가입 받기',
    help: '끄면 새 계정을 만들 수 없어요. 로그인해야 쓸 수 있으니 처음 온 사람은 쓸 수 없고, 이미 가입한 사람과 대표 관리자만 들어와요.',
  },
  {
    key: 'aiRead',
    type: 'bool',
    group: '편제표 자동 읽기',
    label: '자동 읽기 켜기',
    help: '학교알리미 공시와 학교 홈페이지에서 찾은 편제표 파일을 AI로 읽어요.',
  },
  {
    key: 'homepageSearch',
    type: 'bool',
    group: '편제표 자동 읽기',
    label: '학교 홈페이지도 찾기',
    help: '끄면 학교알리미 공시만 봐요.',
  },
  {
    key: 'obeyRobots',
    type: 'bool',
    group: '편제표 자동 읽기',
    label: 'robots.txt 지키기',
    help: '켜면 학교 홈페이지가 robots.txt로 막은 페이지·파일은 읽지 않아요. 끄면 공개된 교육과정 자료를 더 많이 찾아요. 어느 쪽이든 한 학교에 한꺼번에 3개까지만 요청해요.',
  },
  {
    key: 'dailyReadLimit',
    type: 'int',
    group: '편제표 자동 읽기',
    label: '하루 자동 읽기 한도',
    help: '서버 전체에서 하루에 AI로 읽는 파일 수예요.',
    min: 0,
    max: 10000,
  },
  { key: 'aiImport', type: 'bool', group: '파일 올려 읽기', label: '올린 파일 읽기 켜기', help: '사용자가 올린 편제표 사진·PDF·글을 AI로 읽어요.' },
  {
    key: 'dailyImportLimit',
    type: 'int',
    group: '파일 올려 읽기',
    label: '하루 파일 읽기 한도',
    help: '서버 전체에서 하루에 읽는 횟수예요.',
    min: 0,
    max: 10000,
  },
  {
    key: 'aiMatch',
    type: 'bool',
    group: '문장으로 분야 찾기',
    label: '문장으로 찾기 켜기',
    help: '"게임을 만들고 싶어요" 같은 문장으로 학과 분야를 찾아 줘요.',
  },
  {
    key: 'dailyMatchLimit',
    type: 'int',
    group: '문장으로 분야 찾기',
    label: '하루 문장 찾기 한도',
    help: '서버 전체에서 하루에 쓰는 횟수예요.',
    min: 0,
    max: 100000,
  },
  {
    key: 'userAiKey',
    type: 'bool',
    group: '사용자 Gemini API 키',
    label: '사용자 키로 AI 쓰기',
    help: '켜면 편제표 자동 읽기·파일 읽기·문장으로 찾기에 서버 AI 대신 각 사용자가 내 계정에 등록한 Google AI Studio(Gemini) API 키를 써요. 키를 등록하지 않은 사람은 이 기능들을 쓸 수 없고 등록 안내와 발급 방법을 봐요. 사용량은 각자의 무료 한도에서 빠지므로 위의 하루 한도는 세지 않아요. 대입 자료 자동 갱신은 계속 서버 AI를 써요.',
  },
  {
    key: 'userAiModel',
    type: 'text',
    group: '사용자 Gemini API 키',
    label: '사용자 키로 부를 모델',
    help: 'Google AI Studio 무료 등급에서 쓸 수 있는 Gemini 모델 이름이에요. 예: gemini-3.6-flash',
    max: 60,
    pattern: '^[\\w.:/@-]{1,60}$',
  },
  {
    key: 'aiData',
    type: 'bool',
    group: '대입 자료 자동 갱신',
    label: 'AI로 바뀐 곳 찾기',
    help: '대학 원문 파일이 바뀌면 새 파일을 받아 바뀐 쪽만 AI로 읽고, 고칠 곳을 대입 자료 탭에 올려요.',
  },
  {
    key: 'autoApplyData',
    type: 'bool',
    group: '대입 자료 자동 갱신',
    label: '검사를 통과하면 바로 반영',
    help: 'AI도 표를 잘못 읽을 수 있어요. 켜면 모집인원을 조금(20% 안) 고치거나 원문 쪽 번호만 바꾸는 제안처럼 작은 고침만 확인 없이 반영하고, 전형을 더하거나 빼는 것, 반영 비율·합계를 바꾸는 것은 제안으로 남겨요. 반영한 것은 대입 정보 소식에 남아요.',
  },
  {
    key: 'dailyDataLimit',
    type: 'int',
    group: '대입 자료 자동 갱신',
    label: '하루 AI 확인 한도',
    help: '하루에 AI로 읽는 대학 원문 수예요.',
    min: 0,
    max: 1000,
  },
  {
    key: 'planImport',
    type: 'bool',
    group: '대입 자료 자동 갱신',
    label: '전형 없는 대학 가져오기',
    help: '전형 자료가 없는 대학의 2028학년도 시행계획을 받아 AI로 옮겨 넣어요. 대학마다 AI를 3~6번 불러서 AI 연결에 Gemini(무료 키)가 있으면 그것으로 저절로 돌고, Gemini가 없으면 대입 자료 탭에서 가져오기 시작을 눌러야 지금 고른 연결로 돌아요. 옮긴 자료에는 원문을 확인하라는 표시가 붙어요.',
  },
  {
    key: 'dailyPlanImports',
    type: 'int',
    group: '대입 자료 자동 갱신',
    label: '하루에 가져올 대학 수',
    help: '하루에 시행계획을 AI로 옮기는 대학 수예요. 무료 Gemini 키는 하루 요청 수가 정해져 있어 너무 크게 잡지 마세요.',
    min: 0,
    max: 300,
  },
  {
    key: 'planVerify',
    type: 'bool',
    group: '대입 자료 자동 갱신',
    label: 'AI가 옮긴 전형 검수',
    help: 'AI가 옮긴 대학을 더 좋은 AI(Gemini가 아닌 연결, 예: Claude)가 원문과 대조해 틀린 곳을 고치고 AI 검수 표시를 붙여요. 대학마다 AI를 한두 번 불러 유료 연결이면 요금이 나와요.',
  },
  {
    key: 'dailyPlanVerifies',
    type: 'int',
    group: '대입 자료 자동 갱신',
    label: '하루에 검수할 대학 수',
    help: '하루에 AI로 검수하는 대학 수예요.',
    min: 0,
    max: 300,
  },
]

const envInt = (env: Record<string, string | undefined>, name: string, fallback: number) => {
  const n = Number(env[name])
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

export function defaultSettings(env: Record<string, string | undefined> = {}): Settings {
  return {
    notice: '',
    signupOpen: true,
    aiRead: true,
    homepageSearch: true,
    obeyRobots: false,
    aiImport: true,
    aiMatch: true,
    userAiKey: false,
    userAiModel: 'gemini-3.6-flash',
    dailyReadLimit: envInt(env, 'DAILY_LIMIT_READ', 200),
    dailyImportLimit: envInt(env, 'DAILY_LIMIT_IMPORT', 300),
    dailyMatchLimit: envInt(env, 'DAILY_LIMIT_MATCH', 3000),
    aiData: true,
    autoApplyData: false,
    dailyDataLimit: envInt(env, 'DAILY_LIMIT_DATA', 30),
    planImport: true,
    dailyPlanImports: envInt(env, 'DAILY_LIMIT_PLAN_IMPORTS', 50),
    planVerify: true,
    dailyPlanVerifies: envInt(env, 'DAILY_LIMIT_PLAN_VERIFIES', 50),
  }
}

/** 한 값을 검사해 정리. 맞지 않으면 null */
export function cleanSetting(field: SettingField, value: unknown): string | number | boolean | null {
  if (field.type === 'bool') return typeof value === 'boolean' ? value : null
  if (field.type === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null
    if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) return null
    return value
  }
  if (typeof value !== 'string') return null
  // 줄바꿈·제어 문자는 빼고 한 줄로
  const text = value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, field.max ?? 200)
  return field.pattern && !new RegExp(field.pattern, 'u').test(text) ? null : text
}

export class SettingsStore {
  private db: DatabaseSync
  private cache: Settings | null = null
  private env: Record<string, string | undefined>

  constructor(db: DatabaseSync, env: Record<string, string | undefined> = {}) {
    this.db = db
    this.env = env
    db.exec('create table if not exists settings (key text primary key, value text not null, updated_at text not null)')
  }

  get(): Settings {
    if (this.cache) return this.cache
    const out = defaultSettings(this.env)
    const rows = this.db.prepare('select key, value from settings').all() as { key: string; value: string }[]
    for (const row of rows) {
      const field = SETTING_FIELDS.find((f) => f.key === row.key)
      if (!field) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(row.value)
      } catch {
        continue
      }
      const v = cleanSetting(field, parsed)
      if (v !== null) (out as unknown as Record<string, unknown>)[field.key] = v
    }
    this.cache = out
    return out
  }

  /** 관리자가 한 번이라도 저장한 설정인지 (아니면 기본값) */
  isSet(key: SettingKey): boolean {
    return !!this.db.prepare('select 1 from settings where key = ?').get(key)
  }

  /**
   * 바뀐 값만 저장하고 바뀐 항목 이름을 돌려준다. 맞지 않는 값이 하나라도 있으면 아무것도 저장하지 않음.
   * always: 기본값과 같아도 관리자가 고른 값으로 적어 둔다 (isSet으로 구별할 때)
   */
  save(input: Record<string, unknown>, opts: { always?: boolean } = {}): SettingKey[] {
    const now = this.get()
    const changes: [SettingField, string | number | boolean][] = []
    for (const [key, raw] of Object.entries(input)) {
      const field = SETTING_FIELDS.find((f) => f.key === key)
      if (!field) throw new SettingError(`없는 설정이에요: ${key.slice(0, 40)}`)
      const v = cleanSetting(field, raw)
      if (v === null) throw new SettingError(`${field.label} 값이 맞지 않아요.`)
      if (now[field.key] !== v || (opts.always && !this.isSet(field.key))) changes.push([field, v])
    }
    const at = new Date().toISOString()
    const put = this.db.prepare(
      'insert into settings (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at',
    )
    for (const [field, v] of changes) put.run(field.key, JSON.stringify(v), at)
    this.cache = null
    return changes.map(([f]) => f.key)
  }
}

export class SettingError extends Error {}
