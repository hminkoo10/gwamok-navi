import { useMemo, useState } from 'react'
import { contextOf, countByStatus, profileSummary, ratePlan } from '../engine/admissions'
import { BUNDLED_NOTE, useAdmissions } from '../lib/admissions'
import { useApp } from '../lib/app'
import { safeHref } from '../lib/href'
import { Link } from './Link'
import { PlanRules } from './AdmissionDetail'
import { TrackList } from './TrackList'

/** 대학 한 곳의 2028 전형 (대학 페이지) */
export function UnivAdmissions({ univ }: { univ: string }) {
  const { store } = useApp()
  const { prefs, school } = store
  const data = useAdmissions()
  const [onlyOk, setOnlyOk] = useState(false)
  const ctx = useMemo(() => contextOf(prefs.profile, school), [prefs.profile, school])
  const plan = data.byUniv.get(univ)
  const rated = useMemo(() => (plan ? ratePlan(plan, ctx) : []), [plan, ctx])

  if (data.loading) return <p className="progress-line muted">전형 자료를 불러오는 중</p>
  if (!plan) return <p className="hint">이 대학의 2028 전형 자료는 아직 넣지 못했어요. 대학 입학처의 2028학년도 입학전형시행계획을 확인해 주세요.</p>
  const counts = countByStatus(rated)
  const seats = (period: string) => plan.tracks.filter((t) => t.period === period).reduce((n, t) => n + (t.seats ?? 0), 0)

  return (
    <div className="univ-adm">
      <section className="univ-info">
        <p>
          {safeHref(plan.page ?? plan.url) ? (
            <a href={safeHref(plan.page ?? plan.url)} target="_blank" rel="noreferrer noopener">
              {plan.planTitle}
            </a>
          ) : (
            plan.planTitle
          )}{' '}
          <span className="muted">· {plan.date} 발표</span>
        </p>
        {plan.ai && (
          <p className="hint">
            {plan.aiCheck
              ? 'AI가 시행계획 원문에서 옮기고, 다른 AI가 원문과 대조해 검수한 자료예요. 사람이 확인한 것은 아니어서 지원하기 전에 원문을 꼭 확인하세요.'
              : 'AI가 시행계획 원문에서 옮긴 자료예요. 아직 확인하지 않아 틀린 곳이 있을 수 있으니, 지원하기 전에 원문을 꼭 확인하세요.'}
          </p>
        )}
        {data.bundled && <p className="fine">{BUNDLED_NOTE}</p>}
        <p className="muted">
          전형 {plan.tracks.length}개 · 수시 {seats('수시').toLocaleString('ko-KR')}명 · 정시 {seats('정시').toLocaleString('ko-KR')}명 (정원외 포함, 모집단위별
          인원은 원문 참고)
        </p>
        {plan.changes.length > 0 && (
          <details className="changes">
            <summary>2027학년도와 달라진 점 {plan.changes.length}개</summary>
            <ul className="plain-list">
              {plan.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <PlanRules plan={plan} />

      <div className="toolbar">
        <p>
          {school || prefs.profile.schoolType ? (
            <>
              내 조건({profileSummary(ctx, prefs.profile.status, [])})으로 보면 지원 가능 <strong>{counts.ok}</strong> · 확인 필요 {counts.check} · 지원 불가{' '}
              {counts.no}
            </>
          ) : (
            <>
              학교를 고르면 지원할 수 있는 전형만 따로 볼 수 있어요. <Link to="/start">학교 고르기</Link>
            </>
          )}
        </p>
        <label className="switch">
          <input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} />
          지원할 수 있는 것만
        </label>
      </div>
      <TrackList rated={onlyOk ? rated.filter((r) => r.result.status !== 'no') : rated} plan={plan} />
    </div>
  )
}
