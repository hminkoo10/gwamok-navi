import { useEffect, useRef, useState } from 'react'
import { DATA_DATE } from '../data/meta'
import { isAdminRole, ROLE_TEXT } from '../lib/api'
import { shortSchool, useApp } from '../lib/app'
import { useUnseenUpdates } from '../lib/updates'
import { UNIV_BY_ID } from '../data/universities'
import { useLocation } from '../lib/router'
import { IconClose, IconMenu } from './icons'
import { Link } from './Link'

export type Section = 'home' | 'plan' | 'admissions' | 'universities' | 'help' | 'account' | 'admin' | 'other'

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="과목내비 처음으로">
      과목<span className="brand-mark">내비</span>
    </Link>
  )
}

/** 로그인한 사람 메뉴: 내 계정, 관리, 로그아웃 */
function AccountMenu() {
  const { user, signOut } = useApp()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { path } = useLocation()

  // 다른 곳을 누르거나 Esc면 닫음
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 페이지를 옮기면 닫음
  const [lastPath, setLastPath] = useState(path)
  if (lastPath !== path) {
    setLastPath(path)
    setOpen(false)
  }

  if (!user) return null
  return (
    <div className="acct" ref={box}>
      <button type="button" className="acct-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar" aria-hidden="true">
          {(user.name || user.email)[0]?.toUpperCase()}
        </span>
        <span className="acct-name">{user.name || user.email.split('@')[0]}</span>
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-head">
            <strong>{user.name || user.email}</strong>
            <span>
              {user.name ? `${user.email} · ` : ''}
              {ROLE_TEXT[user.role]}
            </span>
          </div>
          <Link to="/account" role="menuitem" className="acct-item">
            내 계정
          </Link>
          {isAdminRole(user.role) && (
            <Link to="/admin" role="menuitem" className="acct-item">
              관리
            </Link>
          )}
          <button type="button" role="menuitem" className="acct-item" onClick={() => void signOut()}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}

export function Header({ section }: { section: Section }) {
  const { store, user, authReady, features, signOut } = useApp()
  const [open, setOpen] = useState(false)
  const { path } = useLocation()
  const [lastPath, setLastPath] = useState(path)
  if (lastPath !== path) {
    setLastPath(path)
    setOpen(false)
  }
  // 로그인한 사람이 확인되기 전에는 이 기기에 남은 설계를 숨김 (다른 사람 것일 수 있음)
  const mine = authReady && (!!user || !features.server)
  const school = mine ? store.school : null
  const planTo = school && store.prefs.majors.length && store.prefs.univs.length ? '/plan' : '/start'
  const links: [string, string, Section][] = [
    [planTo, '내 과목 설계', 'plan'],
    ['/admissions', '전형 찾기', 'admissions'],
    ['/universities', '대학 권장과목', 'universities'],
    ['/help', '도움말', 'help'],
  ]
  const accounts = authReady && features.server
  // 로그인해야 쓰는 서비스라 로그인 전에는 '시작하기' 대신 로그인
  const guest = accounts && !user
  const onAuthPage = path === '/login' || path === '/signup'
  const loginTo = `/login?next=${encodeURIComponent(path)}`

  return (
    <header className="site-head">
      <div className="wrap head-in">
        <Brand />
        <nav className="nav" aria-label="주 메뉴">
          {links.map(([to, label, key]) => (
            <Link key={key} to={to} className={`nav-link${section === key ? ' is-on' : ''}`} aria-current={section === key ? 'page' : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="head-right">
          {guest ? (
            !onAuthPage && (
              <Link to={loginTo} className="btn btn-primary btn-sm">
                로그인
              </Link>
            )
          ) : school ? (
            <Link to="/start?step=school" className="head-school" title="학교 바꾸기">
              <span className="head-school-name">{shortSchool(school.name)}</span>
              <span className="head-school-meta">
                {school.cohort} 입학{school.track ? ` · ${school.track}` : ''}
              </span>
            </Link>
          ) : (
            path !== '/start' && (
              <Link to="/start" className="btn btn-primary btn-sm">
                시작하기
              </Link>
            )
          )}
          {accounts && user && <AccountMenu />}
          <button type="button" className="menu-btn" aria-expanded={open} aria-controls="mobile-nav" aria-label="메뉴" onClick={() => setOpen(!open)}>
            {open ? <IconClose /> : <IconMenu />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" className="mobile-nav" aria-label="주 메뉴">
          {links.map(([to, label, key]) => (
            <Link key={key} to={to} className={`mobile-link${section === key ? ' is-on' : ''}`}>
              {label}
            </Link>
          ))}
          {school && (
            <Link to="/start?step=school" className="mobile-link">
              학교 바꾸기 <span className="muted">{shortSchool(school.name)}</span>
            </Link>
          )}
          {accounts &&
            (user ? (
              <>
                <Link to="/account" className={`mobile-link${section === 'account' ? ' is-on' : ''}`}>
                  내 계정 <span className="muted">{user.email}</span>
                </Link>
                {isAdminRole(user.role) && (
                  <Link to="/admin" className={`mobile-link${section === 'admin' ? ' is-on' : ''}`}>
                    관리
                  </Link>
                )}
                <button type="button" className="mobile-link" onClick={() => void signOut()}>
                  로그아웃
                </button>
              </>
            ) : (
              <Link to={loginTo} className="mobile-link">
                로그인
              </Link>
            ))}
        </nav>
      )}
    </header>
  )
}

const readDismissed = () => {
  try {
    return sessionStorage.getItem('gwamok-navi:notice') ?? ''
  } catch {
    return ''
  }
}

/** 관리자 공지, 목표 대학 자료가 바뀌었다는 안내 */
export function NoticeBar() {
  const { features, store, user } = useApp()
  const { path } = useLocation()
  const [dismissed, setDismissed] = useState(readDismissed)
  const notice = features.notice
  const showNotice = !!notice && dismissed !== notice
  // 목표 대학 자료가 바뀌었을 때만, 로그인한 뒤에만 (이 기기에 남은 설계는 다른 사람 것일 수 있음)
  const targets = store.prefs.univs
  const { unseen, markSeen } = useUnseenUpdates(targets, features.server && !!user && targets.length > 0)
  const changed = path === '/updates' ? [] : unseen
  const names = [...new Set(changed.map((e) => UNIV_BY_ID.get(e.key)?.short ?? e.key))]
  if (!showNotice && !names.length) return null
  return (
    <div className="bars">
      {names.length > 0 && (
        <div className="bar is-info" role="status">
          <div className="wrap bar-in">
            <p>
              <strong>대입 정보</strong> 목표 대학 {names.slice(0, 3).join(', ')}
              {names.length > 3 ? ` 외 ${names.length - 3}곳` : ''}의 전형 자료가 바뀌었어요.
            </p>
            <Link to="/updates" className="bar-action" onClick={markSeen}>
              소식 보기
            </Link>
            <button type="button" className="bar-close" aria-label="알림 닫기" onClick={markSeen}>
              <IconClose />
            </button>
          </div>
        </div>
      )}
      {showNotice && (
        <div className="bar" role="status">
          <div className="wrap bar-in">
            <p>
              <strong>공지</strong> {notice}
            </p>
            <button
              type="button"
              className="bar-close"
              aria-label="공지 닫기"
              onClick={() => {
                setDismissed(notice)
                try {
                  sessionStorage.setItem('gwamok-navi:notice', notice)
                } catch {
                  // 저장 못 해도 닫음
                }
              }}
            >
              <IconClose />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Footer() {
  const { user } = useApp()
  return (
    <footer className="site-foot">
      <div className="wrap foot-in">
        <div className="foot-brand">
          <Brand />
          <p>대학 권장과목과 우리 학교 교육과정을 맞춰 보는 고교학점제 과목 선택 도우미</p>
        </div>
        <nav className="foot-links" aria-label="안내">
          <Link to="/help">도움말</Link>
          <Link to="/help#sources">자료 출처</Link>
          <Link to="/help#privacy">개인정보 안내</Link>
          <Link to="/universities">대학 권장과목</Link>
          <Link to="/admissions">전형 찾기</Link>
          <Link to="/updates">대입 정보 소식</Link>
          {user && isAdminRole(user.role) && <Link to="/admin">관리</Link>}
        </nav>
        <p className="foot-note">
          권장과목은 지원 자격이 아니고 대학 발표에 따라 바뀔 수 있어요. 지원하기 전에 대학 입학처 공지를 확인하세요. 자료 기준 {DATA_DATE}
        </p>
      </div>
    </footer>
  )
}
