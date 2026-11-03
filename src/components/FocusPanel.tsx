import { useState } from 'react'
import type { AdmissionPlan, School } from '../data/schema'
import { UNIV_BY_ID } from '../data/universities'
import { MAJOR_BY_ID } from '../data/majors'
import { type Focus, FOCUSES, myGroups, NO_RANK, SUNEUNG_2028, type UnitRoute } from '../engine/focus'
import { offerIndex } from '../engine/plan'
import { SuneungTable } from './AdmissionDetail'

interface Props {
  focus: Focus
  onChange: (f: Focus) => void
  univs: string[]
  byUniv: Map<string, AdmissionPlan>
  school: School
  loading: boolean
  /** 고른 학과마다 목표 전형에서 권장과목을 넣었는지 */
  routes: UnitRoute[]
  keepAll: boolean
  onKeepAll: (v: boolean) => void
}

const short = (univ: string) => UNIV_BY_ID.get(univ)?.short ?? univ

/** 목표 전형 고르기와, 그 전형에서 과목이 어떻게 쓰이는지 */
export function FocusPanel({ focus, onChange, univs, byUniv, school, loading, routes, keepAll, onKeepAll }: Props) {
  const current = FOCUSES.find((f) => f.id === focus) ?? FOCUSES[0]
  const plans = univs.map((u) => byUniv.get(u)).filter((p): p is AdmissionPlan => !!p)

  return (
    <section className="focus" aria-label="목표 전형">
      <div className="focus-head">
        <span className="field-label">목표 전형</span>
        <div className="chips" role="radiogroup" aria-label="목표 전형">
          {FOCUSES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={focus === f.id}
              className={`chip chip-sm${focus === f.id ? ' is-on' : ''}`}
              onClick={() => onChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="focus-help">{current.help}</p>

      {loading && focus !== '종합' && <p className="progress-line muted">전형 자료를 불러오는 중</p>}

      {focus !== '종합' && !loading && <RouteSummary focus={focus} routes={routes} keepAll={keepAll} onKeepAll={onKeepAll} />}
      {focus === '교과' && !loading && <RecordInfo school={school} plans={plans} />}
      {focus === '논술' && !loading && <EssayInfo plans={plans} />}
      {focus === '정시' && !loading && <SuneungInfo plans={plans} routes={routes} />}
    </section>
  )
}

/** 학과마다 목표 전형이 권장과목(과목 이수)을 보는지: 서류로 보면 넣고, 성적·수능만 보면 뺀다 */
function RouteSummary({ focus, routes, keepAll, onKeepAll }: { focus: Focus; routes: UnitRoute[]; keepAll: boolean; onKeepAll: (v: boolean) => void }) {
  if (!routes.length) return null
  const names = (kind: UnitRoute['kind']) => [...new Set(routes.filter((r) => r.kind === kind).map((r) => `${short(r.unit.univ)} ${r.unit.name}`))]
  const rows: [string, string, string[]][] = [
    ['넣음', '서류(학생부 정성평가)로 어떤 과목을 들었는지 봐요', names('record')],
    ['넣음', '이 전형으로 뽑지 않아 학생부종합 기준으로 봤어요', names('none')],
    ['뺌', '교과 성적(등급)만 반영해서 과목 이수는 보지 않아요', names('grades')],
    ['뺌', focus === '정시' ? '수능(실기) 점수만 봐요' : focus === '논술' ? '논술 성적 위주라 과목 이수는 보지 않아요' : '전형 점수만 봐요', names('exam')],
  ]
  const dropped = routes.some((r) => !r.keep)
  return (
    <div className="focus-routes">
      <p className="focus-routes-title">학과마다 이 전형에서 권장과목을 보는지</p>
      <ul className="focus-route-list">
        {rows
          .filter(([, , list]) => list.length)
          .map(([tag, why, list]) => (
            <li key={why}>
              <span className={`route-tag${tag === '뺌' ? ' is-out' : ''}`}>{tag === '뺌' && keepAll ? '함께 채움' : tag}</span>
              <span>
                {why}: {list.join(', ')}
              </span>
            </li>
          ))}
      </ul>
      {dropped && (
        <label className="switch">
          <input type="checkbox" checked={keepAll} onChange={(e) => onKeepAll(e.target.checked)} />뺀 학과의 권장과목도 함께 채우기 (수시도 같이 준비할 때)
        </label>
      )}
    </div>
  )
}

function RecordInfo({ school, plans }: { school: School; plans: AdmissionPlan[] }) {
  const offered = [...offerIndex(school).keys()].filter((s) => NO_RANK.has(s))
  return (
    <div className="focus-info">
      <p>
        {offered.length
          ? `이 학교 편제표에서 석차등급 없이 성취도(A~E)만 나오는 과목: ${offered.join(', ')}. 시간표에 '등급 없음'으로 표시했어요. 교과 성적을 등급으로 계산하는 대학에서는 이 과목이 성적에 들어가는 방식이 달라요.`
          : '이 학교 편제표에는 등급 없이 성취도만 나오는 사회·과학 융합선택 과목이 없어요.'}
      </p>
      <details className="focus-univ-list" open={plans.length <= 3}>
        <summary>대학별 학생부 반영 방법 ({plans.length}곳)</summary>
        <ul className="focus-list">
          {plans.map((p) => {
            const rule = p.record?.[0]
            return (
              <li key={p.univ}>
                <b>{short(p.univ)}</b>{' '}
                {rule ? (
                  <>
                    {rule.subjects}
                    {rule.achievement && <span className="muted"> · 성취도 과목: {rule.achievement}</span>}
                  </>
                ) : (
                  <span className="muted">학생부 반영 방법 자료 준비 중</span>
                )}
              </li>
            )
          })}
        </ul>
      </details>
    </div>
  )
}

function EssayInfo({ plans }: { plans: AdmissionPlan[] }) {
  return (
    <div className="focus-info">
      <p>대학 시행계획에 적힌 논술 출제 범위의 과목을 조건에 더했어요. 학과별 조건 탭에서 대학마다 '논술 출제 범위'로 볼 수 있어요.</p>
      <details className="focus-univ-list" open={plans.length <= 3}>
        <summary>대학별 논술 출제 범위 ({plans.length}곳)</summary>
        <ul className="focus-list">
          {plans.map((p) => {
            const essays = p.tracks.filter((t) => t.type === '논술')
            const text = essays.find((t) => t.essay)?.essay
            return (
              <li key={p.univ}>
                <b>{short(p.univ)}</b>{' '}
                {!essays.length ? (
                  <span className="muted">논술 전형이 없어요</span>
                ) : text ? (
                  text
                ) : (
                  <span className="muted">출제 범위 자료 준비 중 (원문: {essays[0].pages}쪽)</span>
                )}
              </li>
            )
          })}
        </ul>
      </details>
    </div>
  )
}

/** 넓은 화면에서만 첫 대학 표를 펼쳐 둔다. 휴대폰에서 펼쳐 두면 시간표가 한참 아래로 밀린다 */
const isWide = () => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 900px)').matches

function SuneungInfo({ plans, routes }: { plans: AdmissionPlan[]; routes: UnitRoute[] }) {
  const [wide] = useState(isWide)
  const first = wide ? plans.find((x) => x.suneung?.length)?.univ : undefined
  return (
    <div className="focus-info">
      <p>출제 과목: {SUNEUNG_2028.map((a) => `${a.area}(${a.subjects.join('·')})`).join(', ')}. 탐구는 1학년 공통과목이에요.</p>
      {plans.map((p) =>
        p.suneung?.length ? (
          <details key={p.univ} className="focus-univ" open={p.univ === first}>
            <summary>
              <b>{short(p.univ)}</b> 정시 영역별 반영 비율
            </summary>
            <SuneungTable
              rules={p.suneung}
              mine={(
                (set) => (r: (typeof p.suneung)[number]) =>
                  set.has(r)
              )(
                myGroups(
                  p.suneung,
                  routes.filter((x) => x.unit.univ === p.univ).map((x) => x.unit),
                  (m) => MAJOR_BY_ID.get(m)?.field,
                ),
              )}
            />
          </details>
        ) : (
          <p key={p.univ} className="muted small">
            {short(p.univ)}: 정시 반영 비율 자료 준비 중
          </p>
        ),
      )}
    </div>
  )
}
