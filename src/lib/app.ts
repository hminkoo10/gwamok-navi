import { createContext, useContext } from 'react'
import type { Features, Me } from './api'
import type { AppStore } from './store'

// 페이지들이 함께 쓰는 것: 저장된 선택, 서버 기능, 로그인한 사용자, 알림 띄우기

export interface AppCtx {
  store: AppStore
  /** 서버가 알려 준 기능 켜짐 여부와 공지 */
  features: Features
  user: Me | null
  /** 로그인 여부를 확인했는지 (확인 전에는 로그인 버튼을 감춘다) */
  authReady: boolean
  setUser: (user: Me | null) => void
  signOut: () => Promise<void>
  /** 아래쪽 알림. action을 주면 버튼(예: 되돌리기)을 붙이고 조금 더 오래 띄운다 */
  notify: (message: string, action?: ToastAction) => void
}

export interface ToastAction {
  label: string
  run: () => void
}

export const AppContext = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppContext가 없어요')
  return ctx
}

/** 관리자가 '사용자 키로 AI 쓰기'를 켰는데 쓸 수 있는 내 Gemini API 키가 없는지 (AI 기능 대신 등록 안내를 보인다) */
export function useNeedKey(): boolean {
  const { features, user } = useApp()
  return features.userKey && !user?.aiKey?.ok
}

/** 학교 이름 줄임: '반송고등학교' → '반송고' */
export const shortSchool = (name: string) => name.replace(/고등학교$/, '고').replace(/학교$/, '')

/** 로그인 뒤 돌아갈 주소: 이 사이트 안의 경로만 */
export const safeNext = (next: string | null) =>
  next && /^\/(?!\/)[^\s\\]*$/.test(next) && !next.startsWith('/login') && !next.startsWith('/signup') ? next : null
