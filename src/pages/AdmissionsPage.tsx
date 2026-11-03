import { useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog'
import { IconSearch } from '../components/icons'
import { Link } from '../components/Link'
import { PicksPanel } from '../components/PicksPanel'
import { ProfileForm } from '../components/ProfileForm'
import { ScheduleCard } from '../components/ScheduleCard'
import { StatusLegend, TrackList } from '../components/TrackList'
import { admissionYearOf } from '../data/schedule'
import { UNIV_BY_ID, UNIVERSITIES } from '../data/universities'
import { contextOf, countByStatus, matchesTypes, profileSummary, ratePlan } from '../engine/admissions'
import { norm } from '../engine/search'
import { BUNDLED_NOTE, useAdmissions } from '../lib/admissions'
import { useApp } from '../lib/app'
import { mySeatsIn, myUnitsAt, recruitsMine, useUnitSeats } from '../lib/selection'
import { dateTime } from '../lib/format'

type Scope = 'mine' | 'all'

export function AdmissionsPage() {
  const { store } = useApp()
  const { prefs, school } = store
  const data = useAdmissions()
  const [scope, setScope] = useState<Scope>(prefs.univs.length ? 'mine' : 'all')
  const [onlyOk, setOnlyOk] = useState(true)
  const [period, setPeriod] = useState<'' | '수시' | '정시'>('')
  const [noMin, setNoMin] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)
  // 학과별 인원표가 있는 대학에서는 내 학과를 뽑지 않는 전형을 거를 수 있다
  const seats = useUnitSeats()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(false)

  const ctx = useMemo(() => contextOf(prefs.profile, school), [prefs.profile, school])
  const query = norm(q.trim())

  const groups = useMemo(() => {
    const univs = scope === 'mine' && prefs.univs.length ? prefs.univs : UNIVERSITIES.map((u) => u.id)
    return univs
      .map((id) => {
        const plan = data.byUniv.get(id)
        const univ = UNIV_BY_ID.get(id)
        if (!plan || !univ) return null
        const rated = ratePlan(plan, ctx)
        const univSeats = seats?.[id]
        const mine = onlyMine && univSeats && prefs.majors.length ? myUnitsAt(id, prefs.majors, prefs.unitIds).filter((u) => univSeats[u.id]) : []
        const visible = rated.filter(
          ({ track: t, result }) =>
            matchesTypes(t, prefs.profile.types) &&
            (!onlyOk || result.status !== 'no') &&
            (!period || t.period === period) &&
            (!noMin || !t.min) &&
            (!mine.length || recruitsMine(mySeatsIn(univSeats, mine, t.id)!)) &&
            (!query || norm(`${univ.name} ${univ.short} ${t.name}`).includes(query)),
        )
        return { id, univ, plan, rated, visible, counts: countByStatus(rated.filter(({ track }) => matchesTypes(track, prefs.profile.types))) }
      })
      .filter((g): g is NonNullable<typeof g> => !!g && g.visible.length > 0)
  }, [scope, prefs.univs, prefs.profile.types, prefs.majors, prefs.unitIds, data.byUniv, ctx, onlyOk, period, noMin, onlyMine, seats, query])

  // 전형 자료가 없는 대학: 담은 대학 중에서만 이름을 보여 준다 (전체는 수가 많아 개수만)
  const missing = (scope === 'mine' && prefs.univs.length ? prefs.univs.map((id) => UNIV_BY_ID.get(id)).filter((u) => !!u) : []).filter(
    (u) => !data.byUniv.has(u.id),
  )
  const withPlans = UNIVERSITIES.filter((u) => data.byUniv.has(u.id)).length
  const total = groups.reduce((n, g) => n + g.visible.length, 0)

  return (
    <div className="wrap page admissions">
      <header className="page-head">
        <p className="eyebrow">2028 대입</p>
        <h1 className="page-title">전형 찾기</h1>
        <p className="page-sub">
          대학마다 다니는 학교와 내 조건에 따라 지원할 수 있는 전형이 달라요. 대학이 2026년 4월 발표한 「2028학년도 대학입학전형시행계획」으로 판단해요.
        </p>
        {data.updatedAt && <p className="fine">자료 최근 업데이트 {dateTime(data.updatedAt)}</p>}
        {school && admissionYearOf(school.cohort) > 2028 && (
          <p className="callout is-warn">
            {school.cohort}년 입학생은 {admissionYearOf(school.cohort)}학년도 입시를 봐요. 대학별 {admissionYearOf(school.cohort)}학년도 시행계획은{' '}
            {admissionYearOf(school.cohort) - 2}년 4월 말에 나와서, 그때까지는 2028학년도 전형으로 미리 봐요. 전형 이름·인원·수능 최저는 해마다 바뀔 수 있어요.
          </p>
        )}
      </header>

      <ScheduleCard cohort={school?.cohort} />

      <section className="my-cond">
        <div>
          <p className="field-label">내 조건</p>
          <p className="my-cond-text">
            {school ? `${school.name} · ` : ''}
            {profileSummary(ctx, prefs.profile.status, prefs.profile.types)}
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing(true)}>
          내 조건 바꾸기
        </button>
      </section>

      <div className="adm-layout">
        <div className="adm-main">
          <div className="adm-picks-inline">
            <PicksPanel />
          </div>

          <div className="admin-toolbar adm-filters">
            <div className="search">
              <IconSearch className="search-icon" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="대학이나 전형 이름" aria-label="대학이나 전형 이름" />
            </div>
            <div className="chips" role="group" aria-label="범위">
              <button
                type="button"
                className={`chip chip-sm${scope === 'mine' ? ' is-on' : ''}`}
                aria-pressed={scope === 'mine'}
                onClick={() => setScope('mine')}
                disabled={!prefs.univs.length}
              >
                목표 대학 {prefs.univs.length}곳
              </button>
              <button type="button" className={`chip chip-sm${scope === 'all' ? ' is-on' : ''}`} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
                모든 대학
              </button>
            </div>
            <div className="chips" role="group" aria-label="모집 시기">
              {(['', '수시', '정시'] as const).map((p) => (
                <button
                  key={p || 'all'}
                  type="button"
                  className={`chip chip-sm${period === p ? ' is-on' : ''}`}
                  aria-pressed={period === p}
                  onClick={() => setPeriod(p)}
                >
                  {p || '수시·정시'}
                </button>
              ))}
            </div>
            <label className="switch">
              <input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} />
              지원할 수 있는 것만
            </label>
            <label className="switch">
              <input type="checkbox" checked={noMin} onChange={(e) => setNoMin(e.target.checked)} />
              수능 최저 없는 것만
            </label>
            {prefs.majors.length > 0 && seats && Object.keys(seats).length > 0 && (
              <label className="switch" title="학과별 모집인원표를 옮긴 대학에서만 걸러요">
                <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />내 학과를 뽑는 전형만
              </label>
            )}
          </div>

          {data.loading && <p className="progress-line muted">전형 자료를 불러오는 중</p>}
          {data.error && <p className="form-error">{data.error}</p>}
          {data.bundled && <p className="fine">{BUNDLED_NOTE}</p>}
          {!data.loading && (
            <p className="hint">
              {groups.length ? `대학 ${groups.length}곳, 전형 ${total}개` : '조건에 맞는 전형이 없어요. 거르기를 줄이거나 내 조건을 확인해 주세요.'}
            </p>
          )}

          {groups.length > 0 && <StatusLegend />}

          <div className="adm-groups">
            {groups.map((g) => (
              <section key={g.id} className="adm-group">
                <header className="adm-group-head">
                  <h2>
                    <Link to={`/universities/${g.id}`}>{g.univ.name}</Link>
                  </h2>
                  <p className="adm-counts">
                    <span className="is-ok">지원 가능 {g.counts.ok}</span>
                    <span className="is-check">확인 필요 {g.counts.check}</span>
                    <span className="is-no">지원 불가 {g.counts.no}</span>
                  </p>
                </header>
                <TrackList rated={g.visible} plan={g.plan} />
              </section>
            ))}
          </div>

          {!data.loading && missing.length > 0 && (
            <p className="fine adm-missing">
              담은 대학 중 아직 전형 자료를 넣지 못한 대학: {missing.map((u) => u.short).join(', ')}. 대학 입학처의 2028학년도 입학전형시행계획을 확인해 주세요.
            </p>
          )}
          {!data.loading && !(scope === 'mine' && prefs.univs.length) && withPlans < UNIVERSITIES.length && (
            <p className="fine adm-missing">
              전형 자료는 대학 {withPlans}곳에 있어요. 나머지 {UNIVERSITIES.length - withPlans}곳은 대학 입학처의 2028학년도 입학전형시행계획을 확인해 주세요.
            </p>
          )}
        </div>
        <aside className="adm-aside" aria-label="내 원서 후보">
          <PicksPanel variant="aside" />
        </aside>
      </div>

      <Dialog
        open={editing}
        title="내 조건"
        mid
        onClose={() => setEditing(false)}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setEditing(false)}>
            다 했어요
          </button>
        }
      >
        <ProfileForm />
      </Dialog>
    </div>
  )
}
