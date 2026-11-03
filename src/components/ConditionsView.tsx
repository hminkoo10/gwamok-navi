import { useState } from 'react'
import type { Unit } from '../data/schema'
import { UNIV_BY_ID } from '../data/universities'
import type { UnitRoute } from '../engine/focus'
import type { Missing, Plan, UnitResult } from '../engine/plan'
import { offerIndex } from '../engine/plan'
import { clauseText, COVERAGE_LABEL, TERM_LABEL } from '../lib/format'
import { IconAlert, IconCheck } from './icons'

interface Props {
  plan: Plan
  /** 고른 분야·대학의 학과 전체 (뺀 학과 포함) */
  allUnits: Unit[]
  selectedIds: Set<string>
  onToggleUnit: (id: string) => void
  onSubject: (subject: string) => void
  /** 목표 전형에서 권장과목을 보지 않아 계산에서 뺀 학과 */
  skipped?: UnitRoute[]
  focusLabel?: string
}

export function ConditionsView({ plan, allUnits, selectedIds, skipped = [], focusLabel = '', onToggleUnit, onSubject }: Props) {
  const [onlyMissing, setOnlyMissing] = useState(false)
  const offered = offerIndex(plan.school)
  const groupLabel = new Map(plan.groups.map((g) => [g.group.id, `${TERM_LABEL[g.term]} ${g.group.label}`]))
  const shown = onlyMissing ? plan.units.filter((r) => !r.ok) : plan.units
  const removed = allUnits.filter((u) => !selectedIds.has(u.id))

  // 대학별로 묶기 (목표 대학 순서)
  const byUniv = new Map<string, UnitResult[]>()
  for (const r of shown) byUniv.set(r.unit.univ, [...(byUniv.get(r.unit.univ) ?? []), r])

  const reasonText = (m: Missing) => {
    if (m.reason === 'excluded') return '내가 뺀 과목이에요.'
    if (m.reason === 'not-offered') return '우리 학교 편제표에 없어요. 공동교육과정이나 온라인학교로 들을 수 있는지 학교에 물어보세요.'
    const where = (offered.get(m.subject) ?? [])
      .map((slot) => (slot.kind === 'group' ? groupLabel.get(slot.groupId) : slot.kind === 'track' ? `${TERM_LABEL[slot.term]} 세트` : null))
      .filter(Boolean)
      .join(', ')
    // 칸을 차지한 까닭(꼭 듣기 과목, 대신 고른 세트)을 알면 그대로 알려 줌
    if (m.cause === 'pinned' && m.by?.length) return `꼭 듣기로 한 ${m.by.join('·')}이(가) ${where} 칸을 차지했어요.`
    if (m.cause === 'other-set' && m.by?.length) return `${m.by.join('·')} 세트를 골라 들을 수 없어요.`
    return `${where} 칸을 다른 권장과목이 먼저 차지했어요.`
  }

  return (
    <div className="conds">
      <div className="toolbar">
        <label className="switch">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />다 못 채운 학과만
        </label>
        <span className="muted">학과 이름 옆 빼기를 누르면 계산에서 빠져요.</span>
      </div>

      {shown.length === 0 && <p className="empty-line">고른 학과의 권장과목을 모두 들을 수 있어요.</p>}

      <div className="cond-blocks">
        {[...byUniv].map(([univId, results]) => {
          const univ = UNIV_BY_ID.get(univId)
          const exam = results.every((r) => r.unit.id.startsWith('exam:'))
          return (
            <section key={univId} className="cond-univ-block">
              <h3 className="cond-univ-name">
                {univ?.name ?? '목표 전형 조건'}
                {exam && univ && <span className="pill">목표 전형</span>}
                {!exam && univ && univ.coverage !== 'official' && <span className="pill">{COVERAGE_LABEL[univ.coverage]}</span>}
              </h3>
              <div className="cond-list">
                {results.map((r) => {
                  const short = r.clauses.filter((c) => !c.ok).length
                  return (
                    <article key={r.unit.id} className={`cond${r.ok ? '' : ' is-warn'}`}>
                      <header className="cond-head">
                        <h4>{r.unit.name}</h4>
                        <span className={`badge${r.ok ? ' is-ok' : ' is-warn'}`}>
                          {r.clauses.length === 0 ? '지정 과목 없음' : r.ok ? '모두 가능' : `${short}개 조건 부족`}
                        </span>
                        <button type="button" className="btn-link" onClick={() => onToggleUnit(r.unit.id)} aria-label={`${r.unit.name} 계산에서 빼기`}>
                          빼기
                        </button>
                      </header>

                      {(r.unit.core || r.unit.rec) && (
                        <dl className="cond-src">
                          {r.unit.merged ? (
                            <div>
                              <dt>자료집 원문</dt>
                              <dd>{r.unit.core}</dd>
                            </div>
                          ) : (
                            <>
                              {r.unit.core && (
                                <div>
                                  <dt>핵심과목</dt>
                                  <dd>{r.unit.core}</dd>
                                </div>
                              )}
                              {r.unit.rec && (
                                <div>
                                  <dt>권장과목</dt>
                                  <dd>{r.unit.rec}</dd>
                                </div>
                              )}
                            </>
                          )}
                        </dl>
                      )}
                      {(r.unit.check || r.unit.legacy) && (
                        <p className="cond-flag">
                          {r.unit.legacy ? '옛 교육과정 과목명으로 적힌 부분은 조건에 넣지 못했어요. ' : ''}
                          {r.unit.check ? '해석이 애매한 칸이 있어요. 원문과 대학 입학처 안내를 함께 확인하세요.' : ''}
                        </p>
                      )}

                      {r.clauses.length === 0 ? (
                        <p className="cond-none">{r.unit.note ?? '이 학과는 따로 정한 과목이 없어요.'}</p>
                      ) : (
                        <ul className="clauses">
                          {r.clauses.map((c, i) => (
                            <li key={i} className={c.ok ? 'is-ok' : 'is-no'}>
                              <span className="cl-mark" aria-label={c.ok ? '들을 수 있음' : '부족'}>
                                {c.ok ? <IconCheck /> : <IconAlert />}
                              </span>
                              <div>
                                <span className="cl-text">{clauseText(c.clause)}</span>
                                {c.met.length > 0 && (
                                  <span className="cl-met">
                                    {c.met.map((m, j) => (
                                      <span key={m.subject}>
                                        <button type="button" className="inline-link" onClick={() => onSubject(m.subject)}>
                                          {m.subject}
                                        </button>{' '}
                                        {m.slot.kind === 'fixed' ? '(학교 지정)' : `(${TERM_LABEL[m.slot.term]})`}
                                        {j < c.met.length - 1 ? ', ' : ''}
                                      </span>
                                    ))}
                                  </span>
                                )}
                                {c.missing.map((m) => (
                                  <p key={m.subject} className="cl-miss">
                                    <button type="button" className="inline-link" onClick={() => onSubject(m.subject)}>
                                      {m.subject}
                                    </button>{' '}
                                    {reasonText(m)}
                                  </p>
                                ))}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.unit.note && r.clauses.length > 0 && <p className="cond-note">{r.unit.note}</p>}
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {skipped.length > 0 && (
        <section className="cond-skipped">
          <h3>
            {focusLabel} 기준으로 계산에서 뺀 학과 {skipped.length}
          </h3>
          <p className="muted">
            이 학과들은 {focusLabel}에서 학생부를 서류로 평가하지 않아 어떤 과목을 들었는지 보지 않아요. 목표 전형을 학생부종합으로 바꾸거나 학기별 추천의 목표
            전형 칸에서 "뺀 학과의 권장과목도 함께 채우기"를 켜면 다시 들어가요.
          </p>
          <ul>
            {skipped.map((r) => (
              <li key={r.unit.id}>
                <b>
                  {UNIV_BY_ID.get(r.unit.univ)?.short} {r.unit.name}
                </b>{' '}
                <span className="muted">
                  {r.kind === 'grades' ? '교과 성적만 반영' : '전형 점수(수능·논술 등)만 반영'}
                  {r.tracks.length ? ` · ${r.tracks.slice(0, 2).join(', ')}${r.tracks.length > 2 ? ` 외 ${r.tracks.length - 2}` : ''}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {removed.length > 0 && (
        <section className="removed">
          <h3>계산에서 뺀 학과 {removed.length}</h3>
          <ul>
            {removed.map((u) => (
              <li key={u.id}>
                <span>
                  {UNIV_BY_ID.get(u.univ)?.short} {u.name}
                </span>
                <button type="button" className="btn btn-sm" onClick={() => onToggleUnit(u.id)}>
                  다시 넣기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
