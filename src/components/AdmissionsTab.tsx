import { useMemo, useState } from 'react'
import { UNIV_BY_ID } from '../data/universities'
import { contextOf, countByStatus, matchesTypes, profileSummary, ratePlan } from '../engine/admissions'
import { BUNDLED_NOTE, useAdmissions } from '../lib/admissions'
import { useApp } from '../lib/app'
import { Dialog } from './Dialog'
import { Link } from './Link'
import { PicksPanel } from './PicksPanel'
import { ProfileForm } from './ProfileForm'
import { StatusLegend, TrackList } from './TrackList'

/** 목표 대학들의 전형을 내 조건으로 본다 (내 과목 설계의 '전형' 탭) */
export function AdmissionsTab({ univIds }: { univIds: string[] }) {
  const { store } = useApp()
  const { prefs, school } = store
  const data = useAdmissions()
  const [showAll, setShowAll] = useState(false)
  const [editing, setEditing] = useState(false)
  const ctx = useMemo(() => contextOf(prefs.profile, school), [prefs.profile, school])

  const groups = useMemo(
    () =>
      univIds.map((id) => {
        const plan = data.byUniv.get(id)
        const rated = plan ? ratePlan(plan, ctx).filter(({ track }) => matchesTypes(track, prefs.profile.types)) : []
        return { id, plan, rated, counts: countByStatus(rated), visible: showAll ? rated : rated.filter((r) => r.result.status !== 'no') }
      }),
    [univIds, data.byUniv, ctx, prefs.profile.types, showAll],
  )
  const ok = groups.reduce((n, g) => n + g.counts.ok, 0)
  const check = groups.reduce((n, g) => n + g.counts.check, 0)

  return (
    <div className="adm-tab">
      <section className="my-cond">
        <div>
          <p className="field-label">내 조건</p>
          <p className="my-cond-text">{profileSummary(ctx, prefs.profile.status, prefs.profile.types)}</p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing(true)}>
          내 조건 바꾸기
        </button>
      </section>

      <PicksPanel />

      {data.bundled && <p className="fine">{BUNDLED_NOTE}</p>}
      {data.loading ? (
        <p className="progress-line muted">전형 자료를 불러오는 중</p>
      ) : (
        <div className="toolbar">
          <p>
            목표 대학에서 <strong>지원 가능 {ok}개</strong>, 확인 필요 {check}개
          </p>
          <label className="switch">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            지원할 수 없는 전형도 보기
          </label>
        </div>
      )}

      <StatusLegend />

      <div className="adm-groups">
        {groups.map((g) => (
          <section key={g.id} className="adm-group">
            <header className="adm-group-head">
              <h3>
                <Link to={`/universities/${g.id}`}>{UNIV_BY_ID.get(g.id)?.name ?? g.id}</Link>
              </h3>
              {g.plan && (
                <p className="adm-counts">
                  <span className="is-ok">지원 가능 {g.counts.ok}</span>
                  <span className="is-check">확인 필요 {g.counts.check}</span>
                  <span className="is-no">지원 불가 {g.counts.no}</span>
                </p>
              )}
            </header>
            {g.plan ? (
              <TrackList rated={g.visible} plan={g.plan} />
            ) : (
              <p className="hint">이 대학의 전형 자료는 아직 넣지 못했어요. 대학 입학처의 2028학년도 입학전형시행계획을 확인해 주세요.</p>
            )}
          </section>
        ))}
      </div>
      <p className="fine">판단은 시행계획에 적힌 자격만 본 것이에요. 학교장 추천 인원, 자격 서류, 최종 모집요강은 꼭 확인하세요.</p>

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
