import { ACTION_LABEL, adminApi } from '../../lib/admin'
import { dateTime } from '../../lib/format'
import { useLoad } from '../../lib/hooks'

const SWITCHES: [string, string, string][] = [
  ['signupOpen', '회원가입', '받음|안 받음'],
  ['aiRead', '자동 읽기', '켬|끔'],
  ['homepageSearch', '학교 홈페이지 찾기', '켬|끔'],
  ['obeyRobots', '홈페이지 robots.txt', '지킴|무시'],
  ['aiImport', '올린 파일 읽기', '켬|끔'],
  ['aiMatch', '문장으로 찾기', '켬|끔'],
  ['userAiKey', '사용자 Gemini 키', '씀|안 씀'],
]

export function OverviewTab({ go }: { go: (tab: string) => void }) {
  const { data, error } = useLoad(() => adminApi.overview(), 'overview')
  if (error && !data) return <p className="form-error">{error}</p>
  if (!data) return <p className="progress-line muted">불러오는 중</p>
  const { users, curricula, usage, limits } = data

  const meter = (used: number, max: number) => (
    <span className="meter" aria-hidden="true">
      <span style={{ width: `${max ? Math.min(100, (used / max) * 100) : 100}%` }} />
    </span>
  )

  return (
    <div className="admin-overview">
      <div className="stat-grid">
        <button type="button" className="stat" onClick={() => go('users')}>
          <span className="stat-label">사용자</span>
          <strong className="stat-num num">{users.total.toLocaleString('ko-KR')}</strong>
          <span className="stat-sub">
            관리자 {users.admins} · 정지 {users.disabled}
          </span>
        </button>
        <div className="stat">
          <span className="stat-label">최근 7일</span>
          <strong className="stat-num num">+{users.new7d.toLocaleString('ko-KR')}</strong>
          <span className="stat-sub">
            새 가입 · 로그인한 사람 {users.active7d.toLocaleString('ko-KR')} · 로그인 유지 {data.sessions.toLocaleString('ko-KR')}
          </span>
        </div>
        <button type="button" className="stat" onClick={() => go('curricula')}>
          <span className="stat-label">공유 편제표</span>
          <strong className="stat-num num">{curricula.schools.toLocaleString('ko-KR')}</strong>
          <span className="stat-sub">
            학교·입학년도 · 확인됨 {curricula.verified} · 숨김 {curricula.hidden}
          </span>
        </button>
        <button type="button" className={`stat${curricula.openReports ? ' is-warn' : ''}`} onClick={() => go('reports')}>
          <span className="stat-label">처리할 신고</span>
          <strong className="stat-num num">{curricula.openReports.toLocaleString('ko-KR')}</strong>
          <span className="stat-sub">{curricula.openReports ? '편제표가 틀렸다는 신고가 있어요' : '없어요'}</span>
        </button>
      </div>

      <div className="admin-cols">
        <section className="panel-card">
          <h2 className="card-title">오늘 AI 사용량</h2>
          <p className="card-sub">
            {data.ai
              ? 'AI가 연결돼 있어요. 한도는 설정에서, 쓰는 AI는 AI 연결에서 바꿔요.'
              : 'AI가 연결돼 있지 않아요. AI 연결에서 연결을 추가하고 골라 주세요.'}{' '}
            <button type="button" className="btn-link" onClick={() => go('ai')}>
              AI 연결
            </button>
          </p>
          <ul className="usage">
            {(
              [
                ['편제표 자동 읽기', usage.read, limits.read],
                ['올린 파일 읽기', usage.import, limits.import],
                ['문장으로 찾기', usage.match, limits.match],
              ] as [string, number, number][]
            ).map(([label, used, max]) => (
              <li key={label}>
                <span>{label}</span>
                {meter(used, max)}
                <span className="num">
                  {used.toLocaleString('ko-KR')} / {max.toLocaleString('ko-KR')}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel-card">
          <h2 className="card-title">지금 설정</h2>
          <ul className="switch-list">
            {SWITCHES.map(([key, label, words]) => {
              const on = data.settings[key] === true
              const [yes, no] = words.split('|')
              return (
                <li key={key}>
                  <span>{label}</span>
                  <span className={`state${on ? ' is-on' : ''}`}>
                    {on ? yes : no}
                    {key === 'userAiKey' && on && ` · 등록 ${data.userKeys}명`}
                  </span>
                </li>
              )
            })}
          </ul>
          {typeof data.settings.notice === 'string' && data.settings.notice && <p className="card-sub">공지: {data.settings.notice}</p>}
          <button type="button" className="btn btn-sm" onClick={() => go('settings')}>
            설정 바꾸기
          </button>
        </section>
      </div>

      <section className="panel-card">
        <div className="card-head">
          <h2 className="card-title">최근 관리 기록</h2>
          <button type="button" className="btn-link" onClick={() => go('log')}>
            모두 보기
          </button>
        </div>
        {data.log.length ? (
          <ul className="log-list">
            {data.log.map((e) => (
              <li key={e.id}>
                <span className="log-time num">{dateTime(e.createdAt)}</span>
                <span>
                  <strong>{e.name || e.who}</strong> {ACTION_LABEL[e.action] ?? e.action}
                  {e.target && <span className="muted"> · {e.target}</span>}
                  {e.detail && <span className="muted"> · {e.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">아직 기록이 없어요.</p>
        )}
      </section>
    </div>
  )
}
