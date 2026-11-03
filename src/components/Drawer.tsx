import { useEffect, useRef } from 'react'
import { DESCRIPTIONS } from '../data/descriptions'
import { SUBJECT_BY_NAME } from '../data/subjects'
import { UNIV_BY_ID } from '../data/universities'
import { offerIndex, resolveSubjects, type Plan } from '../engine/plan'
import type { FieldScore } from '../engine/suggest'
import { clauseText, TERM_LABEL } from '../lib/format'
import { IconClose, IconPin } from './icons'

export type DrawerTarget = { kind: 'subject'; subject: string } | { kind: 'group'; groupId: string } | null

interface Props {
  target: DrawerTarget
  plan: Plan
  /** 진로 관련도 (전국 같은 분야 학과들이 권하는 정도) */
  scores: Map<string, FieldScore>
  onClose: () => void
  onOpen: (t: DrawerTarget) => void
  onTogglePin: (s: string) => void
  onToggleExclude: (s: string) => void
}

export function Drawer({ target, plan, scores, onClose, onOpen, onTogglePin, onToggleExclude }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (target && !d.open) d.showModal()
    if (!target && d.open) d.close()
  }, [target])

  const offered = offerIndex(plan.school)
  const groupById = new Map(plan.groups.map((g) => [g.group.id, g]))
  const wanted = new Map(plan.wanted.map((w) => [w.subject, w.units]))

  const slotText = (s: string) =>
    (offered.get(s) ?? []).map((slot) => {
      if (slot.kind === 'fixed') return `${TERM_LABEL[slot.term]} 모두 듣는 과목`
      if (slot.kind === 'track') return `${TERM_LABEL[slot.term]} 두 학기 세트`
      const g = groupById.get(slot.groupId)
      return `${TERM_LABEL[slot.term]} ${g?.group.label ?? ''} (${g?.group.pick ?? '?'}과목 선택)`
    })

  let body = null
  if (target?.kind === 'subject') {
    const s = target.subject
    const info = SUBJECT_BY_NAME.get(s)
    const taken = plan.taken.get(s)
    const places = [...new Set(slotText(s))]
    const fixed = taken?.kind === 'fixed'
    const canChoose = places.length > 0 && !fixed
    const requiring = plan.units.flatMap((r) => r.clauses.filter((c) => resolveSubjects(c.clause.subjects).includes(s)).map((c) => ({ r, c })))
    const pinned = plan.pinned.has(s)
    const excluded = plan.excluded.has(s)
    // 과목 이름은 공유 링크·편제표에서 온 글자라 hasOwn으로만 찾음 (__proto__ 같은 상속 속성 방지)
    const desc = Object.hasOwn(DESCRIPTIONS, s) ? DESCRIPTIONS[s] : ''

    body = (
      <>
        <header className="dr-head">
          <div>
            <h2>{s}</h2>
            <p className="dr-meta">{info ? `${info.area} · ${info.kind}` : '전문교과나 학교가 정한 과목'}</p>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">
            <IconClose />
          </button>
        </header>
        {desc && <p className="dr-desc">{desc}</p>}

        <dl className="dr-facts">
          <div>
            <dt>지금 계획</dt>
            <dd>
              {taken
                ? taken.kind === 'fixed'
                  ? `${TERM_LABEL[taken.term]} · 모두 듣는 과목`
                  : taken.kind === 'track'
                    ? `${TERM_LABEL[taken.term]} · 두 학기 세트`
                    : `${TERM_LABEL[taken.term]} · ${groupById.get(taken.groupId)?.group.label ?? ''}`
                : places.length
                  ? '들어 있지 않음'
                  : '이 학교 편제표에 없음'}
            </dd>
          </div>
          {places.length > 0 && (
            <div>
              <dt>들을 수 있는 곳</dt>
              <dd>
                {places.map((p) => (
                  <span key={p} className="dr-line">
                    {p}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {info?.after && (
            <div>
              <dt>먼저 들으면 좋은 과목</dt>
              <dd>
                {info.after.map((b) => {
                  const bt = plan.taken.get(b)
                  return (
                    <span key={b} className="dr-line">
                      <button type="button" className="inline-link" onClick={() => onOpen({ kind: 'subject', subject: b })}>
                        {b}
                      </button>{' '}
                      <span className="muted">{bt ? TERM_LABEL[bt.term] : offered.has(b) ? '계획에 없음' : '학교에 없음'}</span>
                    </span>
                  )
                })}
              </dd>
            </div>
          )}
        </dl>

        <h3 className="dr-sub">이 과목을 권하는 곳 {requiring.length > 0 && <span className="num">{new Set(requiring.map((x) => x.r.unit.id)).size}</span>}</h3>
        {requiring.length ? (
          <ul className="dr-reqs">
            {requiring.map(({ r, c }, i) => (
              <li key={`${r.unit.id}-${i}`}>
                <strong>
                  {UNIV_BY_ID.get(r.unit.univ)?.short} {r.unit.name}
                </strong>
                <span>{clauseText(c.clause)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">고른 학과 중에는 이 과목을 권하는 곳이 없어요.</p>
        )}

        {canChoose && (
          <div className="dr-actions">
            <button type="button" className={`btn ${pinned ? 'btn-primary' : ''}`} aria-pressed={pinned} onClick={() => onTogglePin(s)}>
              <IconPin /> {pinned ? '꼭 듣기 풀기' : '꼭 듣기'}
            </button>
            <button type="button" className="btn" aria-pressed={excluded} onClick={() => onToggleExclude(s)}>
              {excluded ? '다시 넣기' : '이 과목 빼기'}
            </button>
          </div>
        )}
      </>
    )
  } else if (target?.kind === 'group') {
    const g = groupById.get(target.groupId)
    if (g) {
      body = (
        <>
          <header className="dr-head">
            <div>
              <h2>{g.group.label}</h2>
              <p className="dr-meta">
                {TERM_LABEL[g.term]} · {g.group.pick}과목 선택 · 과목당 {g.group.credits}학점
              </p>
            </div>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="닫기">
              <IconClose />
            </button>
          </header>
          <p className="dr-desc">
            넣기를 누르면 그 과목을 꼭 듣는 것으로 하고(들어갈 칸은 추천이 정해요), 남은 칸은 추천이 다시 채워요. '권장'은 고른 학과 중 이 과목을 권하는 곳,
            '같은 분야'는 전국의 같은 분야 학과 중 이름으로 권하는 곳 수예요.
          </p>
          <ul className="dr-options">
            {[...g.group.options]
              .sort((a, b) => Number(g.chosen.includes(b)) - Number(g.chosen.includes(a)) || (scores.get(b)?.score ?? 0) - (scores.get(a)?.score ?? 0))
              .map((o) => {
                const n = wanted.get(o)?.length ?? 0
                const f = scores.get(o)
                const chosen = g.chosen.includes(o)
                const pinned = plan.pinned.has(o)
                return (
                  <li key={o} className={`dr-option${chosen ? ' is-on' : ''}`}>
                    <button type="button" className="dr-option-name" onClick={() => onOpen({ kind: 'subject', subject: o })}>
                      {o}
                    </button>
                    <span className="dr-badges">
                      {plan.excluded.has(o) && <em className="b-out">뺌</em>}
                      {chosen && !pinned && <em className="b-on">추천</em>}
                      {n > 0 && <em className="b-want">권장 {n}</em>}
                      {f && f.named > 0 && <em className="b-field">같은 분야 {f.named}</em>}
                      {f?.prior && !f.named && <em className="b-field">진로 관련</em>}
                    </span>
                    <button type="button" className={`btn btn-sm${pinned ? ' btn-primary' : ''}`} aria-pressed={pinned} onClick={() => onTogglePin(o)}>
                      {pinned ? '꼭 듣기' : '넣기'}
                    </button>
                  </li>
                )
              })}
          </ul>
        </>
      )
    }
  }

  return (
    <dialog
      ref={ref}
      className="drawer"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      aria-label="과목 정보"
    >
      <div className="drawer-body">{body}</div>
    </dialog>
  )
}
