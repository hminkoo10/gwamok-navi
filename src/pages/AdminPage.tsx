import { Link } from '../components/Link'
import { isAdminRole } from '../lib/api'
import { useApp } from '../lib/app'
import { navigate, useLocation } from '../lib/router'
import { ActivityTab } from './admin/ActivityTab'
import { AiTab } from './admin/AiTab'
import { CurriculaTab } from './admin/CurriculaTab'
import { DataTab } from './admin/DataTab'
import { LogTab } from './admin/LogTab'
import { OverviewTab } from './admin/OverviewTab'
import { ReportsTab } from './admin/ReportsTab'
import { SettingsTab } from './admin/SettingsTab'
import { UsersTab } from './admin/UsersTab'

const TABS = [
  ['overview', '개요'],
  ['users', '사용자'],
  ['curricula', '편제표'],
  ['reports', '신고'],
  ['data', '대입 자료'],
  ['settings', '설정'],
  ['ai', 'AI 연결'],
  ['activity', '사용자 로그'],
  ['log', '관리 기록'],
] as const

type Tab = (typeof TABS)[number][0]

export function AdminPage() {
  const { user, authReady } = useApp()
  const { query } = useLocation()
  const tab: Tab = TABS.find(([id]) => id === query.get('tab'))?.[0] ?? 'overview'
  const go = (id: string) => navigate(id === 'overview' ? '/admin' : `/admin?tab=${id}`, { keepScroll: true })

  if (!authReady) return <div className="wrap gate" aria-busy="true" />
  if (!user)
    return (
      <div className="wrap gate">
        <h1 className="page-title">관리자 로그인이 필요해요</h1>
        <Link to="/login?next=%2Fadmin" className="btn btn-primary btn-lg">
          로그인
        </Link>
      </div>
    )
  if (!isAdminRole(user.role))
    return (
      <div className="wrap gate">
        <h1 className="page-title">관리자만 볼 수 있어요</h1>
        <p className="page-sub">{user.email} 계정은 관리 권한이 없어요.</p>
        <Link to="/" className="btn btn-lg">
          처음으로
        </Link>
      </div>
    )

  return (
    <div className="wrap page admin">
      <header className="page-head">
        <p className="eyebrow">관리</p>
        <h1 className="page-title">{TABS.find(([id]) => id === tab)?.[1]}</h1>
      </header>
      <div className="tabs" role="tablist" aria-label="관리 메뉴">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => go(id)}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab go={go} />}
        {tab === 'users' && <UsersTab />}
        {tab === 'curricula' && <CurriculaTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'data' && <DataTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'ai' && <AiTab />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'log' && <LogTab />}
      </div>
    </div>
  )
}
