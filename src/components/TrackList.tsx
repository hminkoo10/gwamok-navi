import { useMemo } from 'react'
import type { AdmissionPlan } from '../data/schema'
import { type RatedTrack, rulesFor, STATUS_LABEL, subjectWeight, TYPE_LABEL } from '../engine/admissions'
import { RecordList, StagesTable, SuneungTable } from './AdmissionDetail'
import { MAX_PICKS, pickKey } from '../engine/picks'
import { useApp } from '../lib/app'
import { safeHref } from '../lib/href'
import { mySeatsIn, mySeatsText, myUnitsAt, recruitsMine, unitSeatText, useUnitSeats } from '../lib/selection'

/** 한 대학의 전형 목록. 펼치면 자격·방법·수능 최저·과목 선택 영향, 오른쪽 버튼으로 원서 후보에 담기 */
export function TrackList({ rated, plan }: { rated: RatedTrack[]; plan: AdmissionPlan }) {
  const { store } = useApp()
  const { picks, majors, unitIds } = store.prefs
  const full = picks.length >= MAX_PICKS
  // 내 학과를 이 전형으로 몇 명 뽑는지 (모집단위별 인원표가 있는 대학만)
  const seats = useUnitSeats()?.[plan.univ]
  const mine = useMemo(() => (seats ? myUnitsAt(plan.univ, majors, unitIds).filter((u) => seats[u.id]) : []), [seats, plan.univ, majors, unitIds])
  if (!rated.length) return <p className="hint">조건에 맞는 전형이 없어요.</p>
  return (
    <ul className="adm-list">
      {rated.map(({ track: t, result }) => {
        const weight = subjectWeight(t)
        const rules = rulesFor(plan, t)
        const key = pickKey(plan.univ, t.id)
        const on = picks.includes(key)
        const my = mine.length ? mySeatsIn(seats, mine, t.id) : null
        return (
          <li key={t.id} className={`adm is-${result.status}${on ? ' is-picked' : ''}`}>
            <details>
              <summary>
                <span className={`adm-badge is-${result.status}`}>{STATUS_LABEL[result.status]}</span>
                <span className="adm-name">{t.name}</span>
                <span className="adm-meta">
                  {t.type === '수능' ? '수능' : TYPE_LABEL[t.type]} · {t.period}
                  {t.quota === '정원외' ? ' · 정원외' : ''}
                  {t.seats !== null ? ` · ${t.seats.toLocaleString('ko-KR')}명` : ''}
                  {my &&
                    (my.total ? (
                      <b className="my-seats"> · {mySeatsText(my)}</b>
                    ) : (
                      <span className={`my-seats${recruitsMine(my) ? '' : ' is-none'}`}> · {mySeatsText(my)}</span>
                    ))}
                </span>
                <span className="adm-method">{t.method}</span>
              </summary>
              <div className="adm-body">
                {result.reasons.length > 0 && (
                  <ul className="adm-reasons">
                    {result.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
                {my && (
                  <p className="my-units">
                    <b>내 학과 모집인원</b>{' '}
                    {my.rows.map((r, i) => (
                      <span key={r.unit.id}>
                        {i > 0 && ' · '}
                        {r.unit.name} {unitSeatText(r.n)}
                      </span>
                    ))}
                    {my.open && (
                      <span className="my-units-note">인원 미정: 뽑기는 하지만 학과별 인원이 따로 없어요 (약간명, 수시에서 남은 인원, 계열 단위 모집 등).</span>
                    )}
                  </p>
                )}
                <dl className="kv">
                  <div>
                    <dt>지원 자격</dt>
                    <dd>{t.who}</dd>
                  </div>
                  <div>
                    <dt>전형 방법</dt>
                    <dd>{t.method}</dd>
                  </div>
                  <div>
                    <dt>수능 최저</dt>
                    <dd>{t.min ?? '없음'}</dd>
                  </div>
                  <div>
                    <dt>과목 선택 영향</dt>
                    <dd>
                      <span className={`weight is-${weight.level === '높음' ? 'high' : weight.level === '보통' ? 'mid' : 'low'}`}>{weight.level}</span>{' '}
                      {weight.text}
                      {t.subjects ? ` ${t.subjects}` : ''}
                    </dd>
                  </div>
                  {t.note && (
                    <div>
                      <dt>참고</dt>
                      <dd>{t.note}</dd>
                    </div>
                  )}
                  {t.interview && (
                    <div>
                      <dt>면접</dt>
                      <dd>{t.interview}</dd>
                    </div>
                  )}
                  {t.essay && (
                    <div>
                      <dt>논술</dt>
                      <dd>{t.essay}</dd>
                    </div>
                  )}
                  {t.docs && (
                    <div>
                      <dt>제출 서류</dt>
                      <dd>{t.docs}</dd>
                    </div>
                  )}
                </dl>
                {t.stages && t.stages.length > 0 && (
                  <div className="adm-sub">
                    <h4>단계별 선발</h4>
                    <StagesTable stages={t.stages} method={t.method} />
                  </div>
                )}
                {rules.suneung.length > 0 && (
                  <div className="adm-sub">
                    <h4>수능 반영 비율</h4>
                    <SuneungTable rules={rules.suneung} open />
                  </div>
                )}
                {rules.record.length > 0 && (
                  <div className="adm-sub">
                    <h4>학생부 반영 방법</h4>
                    <RecordList rules={rules.record} />
                  </div>
                )}
                <p className="adm-src">
                  {safeHref(plan.page ?? plan.url) ? (
                    <a href={safeHref(plan.page ?? plan.url)} target="_blank" rel="noreferrer noopener">
                      {plan.planTitle}
                    </a>
                  ) : (
                    plan.planTitle
                  )}{' '}
                  {/^[\d\s,~-]+$/.test(t.pages) ? `${t.pages}쪽` : t.pages}
                  {plan.ai && (plan.aiCheck ? ' · AI가 옮기고 AI가 검수함 (원문을 꼭 확인하세요)' : ' · AI가 옮김 (확인 전, 원문을 꼭 확인하세요)')}
                </p>
              </div>
            </details>
            <button
              type="button"
              className={`pick-btn${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={`${t.name} 원서 후보에 담기`}
              disabled={!on && full}
              title={!on && full ? `원서 후보는 ${MAX_PICKS}개까지 담을 수 있어요` : undefined}
              onClick={() => store.togglePick(key)}
            >
              {on ? '담음' : '담기'}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** 판정 표시 범례 */
export function StatusLegend() {
  return (
    <p className="adm-legend">
      <span>
        <b className="adm-badge is-ok">지원 가능</b> 대학이 적은 자격이 내 조건과 맞아요
      </span>
      <span>
        <b className="adm-badge is-check">확인 필요</b> 학교장 추천이나 자격 서류처럼 따로 확인할 게 있어요
      </span>
      <span>
        <b className="adm-badge is-no">지원 불가</b> 학교 유형·지역·자격이 맞지 않아요
      </span>
    </p>
  )
}
