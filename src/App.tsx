import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Footer, Header, NoticeBar, type Section } from './components/Shell'
import { watchAdmissions } from './lib/admissions'
import { ApiError, AUTH_LOST, auth, health, type Me, NO_FEATURES, type Features } from './lib/api'
import { AppContext, type AppCtx, type ToastAction } from './lib/app'
import { navigate, useLocation } from './lib/router'
import { NameGate } from './components/NameGate'
import { useAppState } from './lib/store'
import { AccountPage } from './pages/AccountPage'
import { AdminPage } from './pages/AdminPage'
import { AdmissionsPage } from './pages/AdmissionsPage'
import { GeminiKeyPage } from './pages/GeminiKeyPage'
import { HelpPage } from './pages/HelpPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlanPage } from './pages/PlanPage'
import { SignupPage } from './pages/SignupPage'
import { StartPage } from './pages/StartPage'
import { UniversitiesPage } from './pages/UniversitiesPage'
import { UniversityPage } from './pages/UniversityPage'
import { UpdatesPage } from './pages/UpdatesPage'

type Page = 'home' | 'start' | 'plan' | 'admissions' | 'updates' | 'universities' | 'help' | 'geminiKey' | 'login' | 'signup' | 'account' | 'admin' | 'notfound'
type Route = { page: Page } | { page: 'university'; id: string }

const PATHS: Record<string, Page> = {
  '/': 'home',
  '/start': 'start',
  '/plan': 'plan',
  '/admissions': 'admissions',
  '/updates': 'updates',
  '/universities': 'universities',
  '/help': 'help',
  '/help/gemini-key': 'geminiKey',
  '/login': 'login',
  '/signup': 'signup',
  '/account': 'account',
  '/admin': 'admin',
}

function route(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/'
  if (PATHS[p]) return { page: PATHS[p] }
  const m = p.match(/^\/universities\/([a-z0-9-]{2,40})$/)
  if (m) return { page: 'university', id: m[1] }
  return { page: 'notfound' }
}

const TITLE: Record<Route['page'], string> = {
  home: '과목내비 · 대학 권장과목에 맞춘 고교학점제 과목 선택',
  start: '시작하기 · 과목내비',
  plan: '내 과목 설계 · 과목내비',
  admissions: '전형 찾기 · 과목내비',
  updates: '대입 정보 소식 · 과목내비',
  universities: '대학 권장과목 · 과목내비',
  university: '대학 권장과목 · 과목내비',
  help: '도움말 · 과목내비',
  geminiKey: 'Gemini API 키 발급 방법 · 과목내비',
  login: '로그인 · 과목내비',
  signup: '회원가입 · 과목내비',
  account: '내 계정 · 과목내비',
  admin: '관리 · 과목내비',
  notfound: '없는 페이지 · 과목내비',
}

/** 로그인하지 않아도 보는 화면: 첫 화면, 도움말(개인정보 안내), 로그인·가입. 나머지는 로그인해야 본다 */
const OPEN_PAGES = new Set<Route['page']>(['home', 'help', 'geminiKey', 'login', 'signup', 'notfound'])
/** 서버에 닿지 못해도 보여 주는 화면 (로그인·가입은 서버가 있어야 한다) */
const NO_SERVER_PAGES = new Set<Route['page']>(['home', 'help', 'geminiKey', 'notfound'])

const SECTION: Record<Route['page'], Section> = {
  home: 'home',
  start: 'plan',
  plan: 'plan',
  admissions: 'admissions',
  updates: 'admissions',
  universities: 'universities',
  university: 'universities',
  help: 'help',
  geminiKey: 'help',
  login: 'account',
  signup: 'account',
  account: 'account',
  admin: 'admin',
  notfound: 'other',
}

export default function App() {
  const [user, setUser] = useState<Me | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [features, setFeatures] = useState<Features>(NO_FEATURES)
  /** 서버에 닿지 못했다 (정적 배포가 아니라 연결·서버 오류). 로그인 없이 열어 주지 않고 다시 시도하게 한다 */
  const [down, setDown] = useState(false)
  const [toast, setToast] = useState<{ text: string; action?: ToastAction } | null>(null)
  const notify = useCallback((text: string, action?: ToastAction) => setToast({ text, action }), [])
  // 공유 링크로 들어오면 결과 화면으로. 공유받은 설계는 로그인하고 계정 설계를 합친 뒤에 연다
  const store = useAppState({
    onShared: () => navigate('/plan', { replace: true }),
    onNotice: notify,
    userId: user?.id ?? null,
    ready: authReady && (!!user || !features.server),
  })
  const { path, query } = useLocation()
  const r = route(path)

  // 로그인해야 쓸 수 있다: 서버가 있으면 첫 화면·도움말·로그인 말고는 로그인 화면으로 보내고, 로그인하면 돌아온다
  const open = OPEN_PAGES.has(r.page)
  const needLogin = !open && authReady && features.server && !user
  // 실명을 받기 전에 가입한 계정은 이름부터 받는다 (내 계정 화면은 탈퇴할 수 있게 열어 둔다)
  const needName = !open && r.page !== 'account' && !!user && !user.name
  const search = query.toString()
  const here = path + (search ? `?${search}` : '')
  useEffect(() => {
    if (needLogin) navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true })
  }, [needLogin, here])
  // 쓰는 중에 세션이 끝났으면(만료, 이용 정지, 다른 기기에서 탈퇴) 다시 로그인하게 한다.
  // 같이 쓰는 컴퓨터에 남지 않게 이 기기 설계도 지운다 (아직 못 올린 것은 같은 계정으로 다시 로그인할 때 올린다)
  const { sessionLost } = store
  useEffect(() => {
    if (!user) return
    const lost = () => {
      setUser(null)
      sessionLost()
      notify('로그인이 끝났어요. 다시 로그인해 주세요.')
    }
    window.addEventListener(AUTH_LOST, lost)
    return () => window.removeEventListener(AUTH_LOST, lost)
  }, [user, notify, sessionLost])

  /** 서버 기능과 로그인했는지 확인한다. 서버에 닿지 못하면 down (정적 배포로 보고 열어 주지 않는다) */
  const probe = useCallback(
    () =>
      health()
        .then(async (f) => {
          if (f.server) setUser((await auth.me()).user)
          setFeatures(f)
          setAuthReady(true)
        })
        .catch(() => setDown(true)),
    [],
  )
  useEffect(() => {
    void probe()
  }, [probe])
  const retry = useCallback(() => {
    setDown(false)
    void probe()
  }, [probe])
  // 인터넷이 돌아오면 다시 확인한다
  useEffect(() => {
    if (!down) return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [down, retry])

  useEffect(() => {
    document.title = TITLE[r.page]
  }, [r.page])

  // 관리자가 대입 자료를 고치면 열려 있는 화면도 새 자료로 바꾼다
  useEffect(() => watchAdmissions(() => notify('대입 정보가 업데이트됐어요.')), [notify])

  const { clearLocal, flushSync } = store
  const message = toast
  useEffect(() => {
    if (!message) return
    // 되돌리기 같은 버튼이 있으면 누를 틈을 더 준다
    const t = setTimeout(() => setToast(null), message.action ? 7000 : 2800)
    return () => clearTimeout(t)
  }, [message])

  // 과목 서랍 같은 모달이 열려 있어도 알림이 그 위에 보이게, 알림을 띄울 때마다 맨 위 층으로 다시 올린다
  const toastRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = toastRef.current
    if (!el || typeof el.showPopover !== 'function') return
    try {
      if (el.matches(':popover-open')) el.hidePopover()
      el.showPopover()
    } catch {
      // 팝오버를 못 쓰는 브라우저에서는 그냥 화면 아래에 띄운다
    }
  }, [message])

  const signOut = useCallback(async () => {
    // 로그아웃하면 이 기기 설계를 지우므로, 아직 계정에 못 올린 것이 있으면 먼저 올린다
    if (!(await flushSync()) && !confirm('계정에 저장하지 못한 변경이 있어요. 로그아웃하면 이 기기에서 지워져요. 그래도 로그아웃할까요?')) return
    try {
      await auth.logout()
    } catch (e) {
      // 세션이 이미 끝났으면(401) 로그아웃된 것이다. 서버가 세션을 끝냈는지 모르면 로그아웃했다고 하지 않는다
      if (!(e instanceof ApiError && e.status === 401)) {
        notify('로그아웃하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.')
        return
      }
    }
    setUser(null)
    clearLocal()
    notify('로그아웃했어요.')
    navigate('/')
  }, [clearLocal, flushSync, notify])

  const ctx = useMemo<AppCtx>(() => ({ store, features, user, authReady, setUser, signOut, notify }), [store, features, user, authReady, signOut, notify])

  return (
    <AppContext.Provider value={ctx}>
      <a className="skip" href="#main">
        본문으로
      </a>
      <div className="site">
        <NoticeBar />
        <Header section={SECTION[r.page]} />
        <main id="main" className="site-main">
          {down && !NO_SERVER_PAGES.has(r.page) ? (
            <div className="wrap gate" role="alert">
              <h1 className="page-title">서버에 연결하지 못했어요</h1>
              <p className="page-sub">인터넷 연결을 확인하고 다시 시도해 주세요.</p>
              <button type="button" className="btn btn-primary btn-lg" onClick={retry}>
                다시 시도
              </button>
            </div>
          ) : (!open || !NO_SERVER_PAGES.has(r.page)) && (!authReady || (!open && (needLogin || store.holding))) ? (
            // 로그인했는지 확인하는 동안(로그인·가입 화면도: 확인 전에는 '서버 기능이 꺼져 있다'고 잘못 보이지 않게),
            // 로그인 화면으로 옮기는 동안, 이 기기에서 처음 계정 설계를 받는 동안
            <div className="wrap gate" aria-busy="true" />
          ) : needName ? (
            <NameGate />
          ) : (
            <>
              {r.page === 'home' && <HomePage />}
              {r.page === 'start' && <StartPage />}
              {r.page === 'plan' && <PlanPage />}
              {r.page === 'admissions' && <AdmissionsPage />}
              {r.page === 'updates' && <UpdatesPage />}
              {r.page === 'universities' && <UniversitiesPage />}
              {r.page === 'university' && <UniversityPage id={r.id} />}
              {r.page === 'help' && <HelpPage />}
              {r.page === 'geminiKey' && <GeminiKeyPage />}
              {r.page === 'login' && <LoginPage />}
              {r.page === 'signup' && <SignupPage />}
              {r.page === 'account' && <AccountPage />}
              {r.page === 'admin' && <AdminPage />}
              {r.page === 'notfound' && <NotFoundPage />}
            </>
          )}
        </main>
        <Footer />
      </div>
      <div
        ref={toastRef}
        popover="manual"
        className={`toast${message ? ' is-on' : ''}${message?.action ? ' has-action' : ''}`}
        role="status"
        aria-live="polite"
      >
        {message?.text}
        {message?.action && (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              message.action?.run()
              setToast(null)
            }}
          >
            {message.action.label}
          </button>
        )}
      </div>
    </AppContext.Provider>
  )
}
