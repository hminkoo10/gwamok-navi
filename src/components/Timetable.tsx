import { useState } from 'react'
import type { TermId } from '../data/schema'
import { lockedBy, setPickSubject } from '../engine/choices'
import type { Plan, Reason } from '../engine/plan'
import type { Suggestion } from '../engine/suggest'
import { NO_RANK } from '../engine/focus'
import { termCredits } from '../engine/school'
import { setWhyText, TERM_LABEL, univShorts } from '../lib/format'
import { IconPin } from './icons'

const ALL_TERMS: TermId[] = ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2']

interface Props {
  plan: Plan
  reasons: Map<string, Reason>
  /** 선택 칸 id → 빈자리 추천 (앞쪽부터 빈자리 수만큼이 그 칸 추천) */
  suggestions: Map<string, Suggestion[]>
  /** 두 학기 세트 id → 진로와 가장 가까운 세트 번호 (아직 고르지 않은 세트만) */
  setHints?: Map<string, number>
  /** 세트 고르기: 그 세트 과목 하나를 꼭 듣기로 한다 */
  onPickSet?: (subject: string) => void
  /** 학생부교과를 목표로 하면 석차등급이 없는 과목을 표시한다 */
  markNoRank?: boolean
  onSubject: (subject: string) => void
  onGroup: (groupId: string) => void
}

function why(r: Reason | undefined): string {
  if (!r) return ''
  const parts: string[] = []
  if (r.units.length) {
    const names = univShorts(r.units)
    parts.push(names.length > 3 ? `${names.slice(0, 3).join(' ')} 외 ${names.length - 3}곳` : names.join(' '))
  } else if (r.before.length) parts.push(`${r.before.join(', ')} 앞 과목`)
  return parts.join(' ')
}

/** 꼭 듣기로 했지만 못 넣은 과목의 까닭 (세트 과목이면 무엇 때문인지 짚는다) */
function unplacedText(plan: Plan, s: string, locked: Map<string, string[]>): string {
  const by = locked.get(s)
  if (by?.length) return `${s}: 같은 세트의 ${by.join(', ')}을(를) 빼서 넣을 수 없어요. 그 과목을 다시 넣거나 ${s}의 꼭 듣기를 풀어 주세요.`
  for (const { track, setIndex } of plan.tracks) {
    if (setIndex === null || !track.sets.some((set) => set.items.some((it) => it.subject === s))) continue
    if (!track.sets[setIndex].items.some((it) => it.subject === s))
      return `${s}: ${track.label}에서는 세트를 하나만 고를 수 있어, 꼭 듣기로 한 다른 세트가 먼저 들어갔어요.`
  }
  return `${s}: 꼭 듣기로 했지만 들어갈 칸이 없어요. 같은 칸에서 꼭 듣기로 한 다른 과목을 풀거나 학교 편제표를 확인하세요.`
}

export function Timetable({ plan, reasons, suggestions, setHints, onPickSet, markNoRank = false, onSubject, onGroup }: Props) {
  const school = plan.school
  const locked = lockedBy(school, plan.excluded)
  const [showYear1, setShowYear1] = useState(false)
  const terms = ALL_TERMS.filter((t) => (showYear1 ? true : t !== '1-1' && t !== '1-2')).filter(
    (t) =>
      school.terms.some((x) => x.id === t && (x.fixed.length || x.groups.length)) ||
      school.tracks.some((tr) => tr.sets.some((s) => s.items.some((it) => it.term === t))),
  )

  return (
    <div className="tt-wrap">
      <div className="toolbar">
        <label className="switch">
          <input type="checkbox" checked={showYear1} onChange={(e) => setShowYear1(e.target.checked)} />
          1학년도 보기
        </label>
        <span className="legend">
          <span className="lg lg-chosen" /> 권장과목으로 고른 과목 <span className="lg lg-pin" /> 꼭 듣기 <span className="lg lg-free" /> 고를 칸
        </span>
      </div>
      <p className="tt-help">
        과목을 누르면 왜 골랐는지 보고, 꼭 듣거나 빼도록 바꿀 수 있어요. 고를 칸은 목표 학과 권장과목으로 채우고 남은 자리예요. 칸의 '추천'은 전국의 같은 분야
        학과들이 많이 권하는 과목이고, 칸을 누르면 직접 고를 수 있어요.
      </p>

      <div className="tt" style={{ ['--cols' as string]: terms.length }}>
        {terms.map((termId) => {
          const term = school.terms.find((t) => t.id === termId)
          const groups = plan.groups.filter((g) => g.term === termId)
          const tracks = plan.tracks
            .map((tp) => ({ tp, items: tp.track.sets.map((s) => s.items.filter((it) => it.term === termId)) }))
            .filter(({ items }) => items.some((list) => list.length))

          return (
            <section key={termId} className="tt-col" aria-label={TERM_LABEL[termId]}>
              <header className="tt-head">
                <h3>{TERM_LABEL[termId]}</h3>
                <span className="num">
                  {termCredits(
                    school,
                    termId,
                    plan.tracks.map((t) => t.setIndex),
                  )}
                  학점
                </span>
              </header>

              {groups.map((g) => (
                <div key={g.group.id} className="tt-block">
                  <div className="tt-block-head">
                    <span>{g.group.label}</span>
                    <span className="pick">{g.group.pick}과목 선택</span>
                  </div>
                  <ul className="slots">
                    {g.chosen.map((s) => {
                      const pinned = plan.pinned.has(s)
                      return (
                        <li key={s}>
                          <button type="button" className={`slot ${pinned ? 'is-pin' : 'is-chosen'}`} onClick={() => onSubject(s)}>
                            <span className="slot-name">
                              {pinned && <IconPin />}
                              {s}
                              {markNoRank && NO_RANK.has(s) && <em className="slot-tag">등급 없음</em>}
                            </span>
                            <span className="slot-why">{pinned && !reasons.get(s)?.units.length ? '내가 꼭 듣기로 함' : why(reasons.get(s))}</span>
                          </button>
                        </li>
                      )
                    })}
                    {Array.from({ length: g.free }, (_, i) => {
                      const hint = suggestions.get(g.group.id)?.[i]
                      return (
                        <li key={`free-${i}`}>
                          <button type="button" className={`slot is-free${hint ? ' has-hint' : ''}`} onClick={() => onGroup(g.group.id)}>
                            {hint ? (
                              <>
                                <span className="slot-name">
                                  <em className="slot-rec">추천</em>
                                  {hint.subject}
                                </span>
                                <span className="slot-why">{hint.prior ? '진로와 가까운 과목' : `같은 분야 ${hint.named}곳이 권해요`}</span>
                              </>
                            ) : (
                              <>
                                <span className="slot-name">원하는 과목</span>
                                <span className="slot-why">눌러서 고르기</span>
                              </>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}

              {tracks.map(({ tp, items }) => {
                // 뺀 과목이 든 세트는 고를 수 없다 (누르면 그 세트를 다시 넣고 고른다)
                const out = tp.track.sets.map((set) => set.items.some((it) => plan.excluded.has(it.subject)))
                const chosenWhy = (s: string) => {
                  const r = reasons.get(s)
                  if (plan.pinned.has(s)) return r?.units.length ? why(r) : '내가 꼭 듣기로 함'
                  return why(r) || setWhyText(plan, tp)
                }
                return (
                  <div key={tp.track.id} className="tt-block">
                    <div className="tt-block-head">
                      <span>{tp.track.label}</span>
                      <span className="pick">두 학기 세트</span>
                    </div>
                    <ul className="slots">
                      {tp.setIndex === null
                        ? items.map((list, si) => {
                            if (!list.length) return null
                            const hint = !out[si] && setHints?.get(tp.track.id) === si
                            return (
                              <li key={si}>
                                <button
                                  type="button"
                                  className={`slot is-free${hint ? ' has-hint' : ''}${out[si] ? ' is-out' : ''}`}
                                  onClick={() => onPickSet?.(setPickSubject(school, tp.track.id, si) ?? list[0].subject)}
                                >
                                  <span className="slot-name">
                                    {hint && <em className="slot-rec">추천</em>}
                                    {list.map((it) => it.subject).join('·')}
                                  </span>
                                  <span className="slot-why">{out[si] ? '뺀 세트 · 눌러서 다시 고르기' : '이 세트 고르기'}</span>
                                </button>
                              </li>
                            )
                          })
                        : items[tp.setIndex].map((it) => (
                            <li key={it.subject}>
                              <button
                                type="button"
                                className={`slot ${plan.pinned.has(it.subject) ? 'is-pin' : 'is-chosen'}`}
                                onClick={() => onSubject(it.subject)}
                              >
                                <span className="slot-name">
                                  {plan.pinned.has(it.subject) && <IconPin />}
                                  {it.subject}
                                </span>
                                <span className="slot-why">{chosenWhy(it.subject)}</span>
                              </button>
                            </li>
                          ))}
                    </ul>
                  </div>
                )
              })}

              {term && term.fixed.length > 0 && (
                <div className="tt-fixed">
                  <span className="tt-fixed-label">모두 듣는 과목</span>
                  <ul className="fixed-list">
                    {term.fixed.map((f) => (
                      <li key={f.subject}>
                        <button type="button" className="fixed-subject" onClick={() => onSubject(f.subject)}>
                          {f.alt ? `${f.subject}/${f.alt}` : f.subject}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )
        })}
      </div>

      {(plan.warnings.length > 0 || plan.unplacedPins.length > 0) && (
        <ul className="notes">
          {plan.unplacedPins.map((s) => (
            <li key={`u-${s}`}>{unplacedText(plan, s, locked)}</li>
          ))}
          {plan.warnings.map((w) => (
            <li key={`${w.subject}-${w.before}`}>
              {w.kind === 'not-offered'
                ? `${w.subject}: 앞 과목인 ${w.before}이(가) 이 학교 편제표에 없어요.`
                : w.kind === 'missing'
                  ? w.cause === 'excluded-prereq'
                    ? `${w.subject}: 앞 과목인 ${w.before}을(를) 내가 뺐어요.`
                    : w.cause === 'pinned' && w.by?.length
                      ? `${w.subject}: 앞 과목인 ${w.before}을(를) 넣을 칸을 꼭 듣기로 한 ${w.by.join('·')}이(가) 차지했어요.`
                      : w.cause === 'other-set' && w.by?.length
                        ? `${w.subject}: ${w.by.join('·')} 세트를 골라 앞 과목인 ${w.before}을(를) 들을 수 없어요.`
                        : `${w.subject}: 앞 과목인 ${w.before}을(를) 넣을 칸이 모자라요.`
                  : `${w.subject}: 앞 과목 ${w.before}보다 먼저 배치돼 있어요.`}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
